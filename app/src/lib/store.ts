// The board: tonight's pickups and each zone's coverage.
//
// One shape, two sources. Connected, everything comes from the backend's
// `claims` table and coverage comes from the generated coverage_pct /
// coverage_status columns on `zones`. Offline, both are derived from
// localStorage. Components read through useBoard() and never learn which.
//
// Why coverage is read rather than recomputed: their trigger sums only claims
// created since app_state.current_service_night_started_at, and app_state is
// RLS-locked with no policies. A client-side sum could not agree with the
// server's idea of "tonight", and two numbers that disagree at 10pm is worse
// than one number that comes from one place.
//
// The pickup details -- address, coordinates, collection window --
// have no columns on `claims` yet (see
// supabase/migration_003_pickup_details.sql). Until that runs they are kept
// here, keyed by claim id, so the device that typed them still shows them and
// the shared board still carries the name, the quantity and the zone.

import { useSyncExternalStore } from "react";
import { hasBackend } from "./supabase";
import {
  fetchClaims,
  fetchZones,
  insertRequest,
  isMissingColumn,
  patchClaim,
  subscribeToClaims,
  type ClaimRow,
} from "./backend";
import { ZONES } from "./zones";
import { alreadySeeded, demoPickups, forgetSeeded, markSeeded } from "./seed";
import type { Pickup, NewPickup, ZoneStats } from "../types";

const LOCAL_KEY = "surplus-street-pickups-v1";
const DETAIL_KEY = "surplus-street-pickup-details-v1";

interface Board {
  pickups: Pickup[];
  stats: ZoneStats;
  ready: boolean;
  live: boolean;
  /** False while migration_003 has not been applied: pickup details are
   *  local to whoever typed them. */
  detailsShared: boolean;
  error: string | null;
}

let board: Board = {
  pickups: [],
  stats: {},
  ready: false,
  live: false,
  detailsShared: false,
  error: null,
};

const listeners = new Set<() => void>();

function publish(next: Partial<Board>) {
  board = { ...board, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

// ------------------------------------------------------- local detail store

type Detail = Partial<
  Pick<
    Pickup,
    "address" | "lat" | "lng" | "pickup_from" | "pickup_to" | "pickup_note"
  >
>;

function readDetails(): Record<string, Detail> {
  try {
    return JSON.parse(localStorage.getItem(DETAIL_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDetail(id: string, d: Detail) {
  try {
    const all = readDetails();
    all[id] = { ...all[id], ...d };
    localStorage.setItem(DETAIL_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn("pickup detail not saved:", err);
  }
}

/** Server row plus whatever detail this device knows about it. Server columns
 *  win once migration_003 makes them real. */
function hydrate(rows: ClaimRow[]): Pickup[] {
  const details = readDetails();
  return rows
    .filter((r) => r.delivery_mode === "volunteer")
    .map((r) => {
      const d = details[r.id] ?? {};
      return {
        id: r.id,
        restaurant_name: r.restaurant_name,
        quantity: Number(r.quantity),
        status: r.status,
        volunteer_name: r.volunteer_name,
        zone_id: r.zone_id,
        drop_location_note: r.drop_location_note,
        created_at: r.created_at,
        address: r.address ?? d.address ?? "",
        lat: r.lat ?? d.lat ?? null,
        lng: r.lng ?? d.lng ?? null,
        pickup_from: r.pickup_from ?? d.pickup_from ?? r.created_at,
        pickup_to: r.pickup_to ?? d.pickup_to ?? r.created_at,
        pickup_note: r.pickup_note ?? d.pickup_note ?? null,
      };
    });
}

// --------------------------------------------------------------- local mode

function readLocal(): Pickup[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as Pickup[];
  } catch {
    return [];
  }
}

function writeLocal(list: Pickup[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("pickups could not be saved:", err);
  }
}

function newId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Does this row live on this device rather than the shared board?
 *
 * Samples and anything posted while offline do. Routing writes on a global
 * "is there a backend" flag instead of on the row itself was a real bug:
 * taking a SAMPLE pickup sent PATCH /claims?id=eq.demo-1 to Supabase, which
 * matched nothing, so the pickup silently never joined the route.
 */
function isLocalRow(id: string): boolean {
  return id.startsWith("demo-") || id.startsWith("local-");
}

/** Samples, but only on a device that has never had any. Never inserted
 *  anywhere remote: fake surplus a real driver goes out for is the worst bug
 *  this product could have. */
function seedIfEmpty(existing: Pickup[]): Pickup[] {
  if (existing.length > 0 || alreadySeeded()) return existing;
  const demo = demoPickups();
  writeLocal(demo);
  markSeeded();
  return demo;
}

// ------------------------------------------------------------------- stats

/** Food counts toward a zone the moment a volunteer picks it up and says
 *  where it is going -- which is what the backend's trigger does too, since
 *  the app writes zone_id and status 'claimed' together. */
function counts(p: Pickup): boolean {
  return !!p.zone_id && (p.status === "claimed" || p.status === "delivered");
}

function localStats(pickups: Pickup[]): ZoneStats {
  const out: ZoneStats = {};
  for (const z of ZONES.zones) {
    const claimed = pickups
      .filter((p) => p.zone_id === z.id && counts(p))
      .reduce((a, p) => a + p.quantity, 0);
    const expected = z.expected_tonight;
    const covered = expected ? claimed >= expected : true;
    out[z.id] = {
      claimed,
      expected,
      pct: expected ? Math.min(1, claimed / expected) : 1,
      covered,
      status: covered ? "covered" : claimed > 0 ? "partial" : "uncovered",
    };
  }
  return out;
}

async function refresh(): Promise<void> {
  try {
    const [zoneRows, claimRows] = await Promise.all([fetchZones(), fetchClaims()]);
    const local = seedIfEmpty(readLocal());

    const stats: ZoneStats = {};
    for (const r of zoneRows) {
      // Their denominator, so our percentage matches their coverage_pct.
      //
      // Rounded UP, never down. The raw value is fractional (Golden Hill is
      // 20.3), and a card reading "~20 expected" has to be a number that
      // actually covers the zone -- bringing exactly 20 there left it at 99%
      // and still open, which is the card lying to a driver at 10pm.
      const expected = Math.ceil(
        Number(r.baseline_predicted) + Number(r.recent_311_adjustment),
      );
      stats[r.zone_id] = {
        claimed: Number(r.food_claimed),
        expected,
        // coverage_pct is uncapped in storage on purpose (a zone can be
        // over-claimed); their schema says cap only on display.
        pct: Math.min(1, (Number(r.coverage_pct ?? 0) || 0) / 100),
        covered: r.coverage_status === "covered",
        status: r.coverage_status,
      };
    }

    // Local rows are invisible to the server, so their contribution to a
    // zone has to be added here. Server rows are already in food_claimed.
    for (const p of local) {
      if (!counts(p)) continue;
      const st = stats[p.zone_id as string];
      if (!st) continue;
      st.claimed += p.quantity;
      st.pct = st.expected ? Math.min(1, st.claimed / st.expected) : 1;
      st.covered = st.expected ? st.claimed >= st.expected : true;
      st.status = st.covered ? "covered" : st.claimed > 0 ? "partial" : "uncovered";
    }

    publish({
      pickups: [...local, ...hydrate(claimRows)],
      stats,
      ready: true,
      error: null,
    });
  } catch (err) {
    // A dead backend must not blank the screen mid-service.
    console.warn("could not load the board:", err);
    publish({
      ready: true,
      error: "Showing the last data we had — the live board is unreachable.",
    });
  }
}

let started = false;
let unsubscribeRealtime: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Slow on purpose: the safety net for when realtime does not come up, not a
// replacement for it.
const POLL_MS = 20000;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void refresh(), POLL_MS);
}

export function initStore(): void {
  if (started) return;
  started = true;

  if (!hasBackend) {
    const pickups = seedIfEmpty(readLocal());
    publish({ pickups, stats: localStats(pickups), ready: true, live: false });
    return;
  }

  // The first refresh is awaited before opening the channel: subscribing in
  // parallel meant the subscription resolved against state that had not
  // loaded yet.
  void refresh().then(() => {
    subscribeToClaims(() => void refresh())
      .then((off) => {
        unsubscribeRealtime = off;
        publish({ live: true });
      })
      .catch((err) => {
        // Polling is not as good, but a board that goes stale for twenty
        // seconds beats one that silently never updates again.
        console.warn("realtime unavailable, polling instead:", err);
        publish({ live: false });
        startPolling();
      });
  });
}

export function teardownStore(): void {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  started = false;
}

// ------------------------------------------------------------------ writes

/** The columns migration_003 adds. Sent optimistically; if they are not there
 *  yet the insert is retried without them and the detail stays local. */
function extrasOf(p: NewPickup): Record<string, unknown> {
  return {
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    pickup_from: p.pickup_from,
    pickup_to: p.pickup_to,
    pickup_note: p.pickup_note,
  };
}

/** A restaurant posts surplus with no zone: their delivery_mode 'volunteer',
 *  status 'requested'. */
export async function postPickup(input: NewPickup): Promise<void> {
  if (!hasBackend) {
    const local: Pickup = {
      ...input,
      id: newId(),
      status: "requested",
      volunteer_name: null,
      zone_id: null,
      drop_location_note: null,
      created_at: new Date().toISOString(),
    };
    const pickups = [local, ...board.pickups];
    writeLocal(pickups);
    publish({ pickups, stats: localStats(pickups) });
    return;
  }

  let row: ClaimRow;
  try {
    row = await insertRequest({
      restaurant_name: input.restaurant_name,
      quantity: input.quantity,
      extras: extrasOf(input),
    });
    publish({ detailsShared: true });
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    // migration_003 is not applied. Post what the schema does have and keep
    // the rest here, rather than failing a post over a missing column.
    row = await insertRequest({
      restaurant_name: input.restaurant_name,
      quantity: input.quantity,
      extras: {},
    });
    publish({ detailsShared: false });
  }

  saveDetail(row.id, {
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    pickup_from: input.pickup_from,
    pickup_to: input.pickup_to,
    pickup_note: input.pickup_note,
  });
  await refresh();
}

async function write(id: string, patch: Record<string, unknown>): Promise<void> {
  if (!hasBackend || isLocalRow(id)) {
    const local = readLocal().map((p) => (p.id === id ? ({ ...p, ...patch } as Pickup) : p));
    writeLocal(local);
    if (!hasBackend) {
      publish({ pickups: local, stats: localStats(local) });
    } else {
      await refresh();
    }
    return;
  }

  try {
    await patchClaim(id, patch);
  } catch (err) {
    // Silently doing nothing is the worst outcome here: the driver believes
    // they have the run and nobody else can see it.
    console.warn("could not save that:", err);
    publish({ error: "That did not save — check your connection and try again." });
    throw err;
  }
  await refresh();
}

/**
 * A volunteer takes a pickup. No destination yet -- that is decided once, for
 * the whole route, after the stops are chosen.
 *
 * 'accepted' is exactly the backend's word for this state: a volunteer has it
 * and no zone is chosen. Their trigger counts 'claimed' and 'delivered', so an
 * accepted row correctly contributes nothing to coverage: food with no
 * destination is not covering anything yet.
 */
export function takePickup(id: string, volunteer: string): Promise<void> {
  return write(id, { status: "accepted", volunteer_name: volunteer, zone_id: null });
}

/**
 * Where the whole load is going. This is the moment the food starts counting
 * towards a zone -- writing zone_id and 'claimed' together is what their
 * trigger picks up.
 */
export async function setRouteDestination(ids: string[], zoneId: string): Promise<void> {
  for (const id of ids) await write(id, { status: "claimed", zone_id: zoneId });
}

/** Change your mind about the destination while still holding the food. */
export function reroutePickup(id: string, zoneId: string): Promise<void> {
  return write(id, { zone_id: zoneId, status: "claimed" });
}

export function deliverPickup(id: string, note?: string): Promise<void> {
  return write(id, {
    status: "delivered",
    ...(note ? { drop_location_note: note } : {}),
  });
}

/** Handing a run back: it returns to the feed for someone else. */
export function releasePickup(id: string): Promise<void> {
  return write(id, { status: "requested", volunteer_name: null, zone_id: null });
}

/** Is this pickup on somebody's route, destination decided or not? */
export function onARoute(p: Pickup): boolean {
  return p.status === "accepted" || p.status === "claimed";
}

/** No DELETE policy, by design -- withdrawing keeps the row for the log. */
export function cancelPickup(id: string): Promise<void> {
  return write(id, { status: "cancelled" });
}

// -------------------------------------------------------------- demo data
// One tap to a known-good state. At a venue, "it worked five minutes ago" is
// not a debugging strategy -- being able to reset the board in front of the
// audience is.

/** Replace every sample with a fresh evening. Local rows only: anything
 *  posted to the shared board is untouched. */
export async function loadDemoData(attributeTo?: string | null): Promise<void> {
  const kept = readLocal().filter((p) => !p.demo);
  const fresh = [...demoPickups(attributeTo), ...kept];
  writeLocal(fresh);
  markSeeded();
  if (hasBackend) {
    await refresh();
  } else {
    publish({ pickups: fresh, stats: localStats(fresh) });
  }
}

/** Take the samples away and leave them gone -- clearing has to survive the
 *  next load, or the seeder would put them straight back. */
export async function clearDemoData(): Promise<void> {
  const kept = readLocal().filter((p) => !p.demo);
  writeLocal(kept);
  markSeeded();
  if (hasBackend) {
    await refresh();
  } else {
    publish({ pickups: kept, stats: localStats(kept) });
  }
}

/** Only for "start completely fresh": samples return on the next load. */
export function resetSeedFlag(): void {
  forgetSeeded();
}

// ------------------------------------------------------------------- reads

const snapshot = () => board;

export function useBoard(): Board {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
