// The board: tonight's claims and each zone's coverage.
//
// Two sources, one shape. Connected, claims come from their `claims` table and
// coverage comes from the generated `coverage_pct` / `coverage_status` columns
// on `zones`. Offline, both are derived from localStorage. Components read
// through useBoard() and never learn which one is running.
//
// Why coverage is read rather than recomputed: their trigger sums only claims
// created since app_state.current_service_night_started_at, and app_state is
// RLS-locked with no policies. A client-side sum could not agree with the
// server's idea of "tonight", and two numbers that disagree at 10pm is worse
// than one number that comes from one place.

import { useSyncExternalStore } from "react";
import { hasBackend } from "./supabase";
import {
  fetchClaims,
  fetchZones,
  insertClaim,
  setClaimStatus,
  subscribeToClaims,
  type ClaimRow,
} from "./backend";
import { ZONES } from "./zones";
import type { Claim, ClaimStatus, ZoneStats } from "../types";

const CLAIM_KEY = "surplus-street-claims-v1";
const NOTE_KEY = "surplus-street-claim-notes-v1";

interface Board {
  claims: Claim[];
  stats: ZoneStats;
  ready: boolean;
  live: boolean;
  error: string | null;
}

let board: Board = { claims: [], stats: {}, ready: false, live: false, error: null };
const listeners = new Set<() => void>();

function publish(next: Partial<Board>) {
  board = { ...board, ...next };   // new identity, so useSyncExternalStore sees it
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

// -------------------------------------------------------- local annotations
// The shared table has no column for food type or drop window, and we are not
// changing the backend to add one. They are kept here, keyed by claim id, so
// the device that entered them still shows them.

type Note = { food?: string | null; drop_window?: string | null };

function readNotes(): Record<string, Note> {
  try {
    return JSON.parse(localStorage.getItem(NOTE_KEY) || "{}") as Record<string, Note>;
  } catch {
    return {};
  }
}

function saveNote(id: string, note: Note) {
  try {
    const all = readNotes();
    all[id] = note;
    localStorage.setItem(NOTE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn("claim note not saved:", err);
  }
}

function withNotes(rows: ClaimRow[]): Claim[] {
  const notes = readNotes();
  return rows.map((r) => ({ ...r, ...(notes[r.id] ?? {}) }));
}

// --------------------------------------------------------------- local mode

function readLocal(): Claim[] {
  try {
    return JSON.parse(localStorage.getItem(CLAIM_KEY) || "[]") as Claim[];
  } catch {
    return [];
  }
}

function writeLocal(list: Claim[]) {
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("claims could not be saved:", err);
  }
}

// ------------------------------------------------------------------- stats

/** Offline: derive coverage from local claims and the shipped zone model. */
function localStats(claims: Claim[]): ZoneStats {
  const out: ZoneStats = {};
  for (const z of ZONES.zones) {
    const claimed = claims
      .filter((c) => c.zone_id === z.id && c.status !== "cancelled")
      .reduce((a, c) => a + c.quantity, 0);
    const expected = z.expected_tonight;
    const pct = expected ? Math.min(1, claimed / expected) : 1;
    const covered = expected ? claimed >= expected : true;
    out[z.id] = {
      claimed,
      expected,
      pct,
      covered,
      status: covered ? "covered" : claimed > 0 ? "partial" : "uncovered",
    };
  }
  return out;
}

async function refresh(): Promise<void> {
  try {
    const [zoneRows, claimRows] = await Promise.all([fetchZones(), fetchClaims()]);

    const stats: ZoneStats = {};
    for (const r of zoneRows) {
      // Their denominator, so our percentage matches their coverage_pct.
      //
      // Rounded UP, never down. The raw value is fractional (Golden Hill is
      // 20.3), and a card that reads "~20 expected" has to be a number that
      // actually covers the zone -- claiming exactly 20 there left it at 99%
      // and still open, which is the card lying to a driver at 10pm. You
      // cannot bring 0.3 of a meal, so the ceiling is also the honest figure.
      const expected = Math.ceil(Number(r.baseline_predicted) + Number(r.recent_311_adjustment));
      const claimed = Number(r.food_claimed);
      stats[r.zone_id] = {
        claimed,
        expected,
        // coverage_pct is uncapped in storage on purpose (a zone can be
        // over-claimed); their schema says cap only on display.
        pct: Math.min(1, (Number(r.coverage_pct ?? 0) || 0) / 100),
        covered: r.coverage_status === "covered",
        status: r.coverage_status,
      };
    }

    publish({ claims: withNotes(claimRows), stats, ready: true, error: null });
  } catch (err) {
    // A dead backend must not blank the screen mid-service. Fall back to
    // whatever is already on screen, and say so.
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

// Slow on purpose. This is the safety net for when realtime does not come up,
// not a replacement for it: often enough that a second phone is not stuck on
// a stale board through a service, rare enough to be invisible.
const POLL_MS = 20000;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void refresh(), POLL_MS);
}

export function initStore(): void {
  if (started) return;
  started = true;

  if (!hasBackend) {
    const claims = readLocal();
    publish({ claims, stats: localStats(claims), ready: true, live: false });
    return;
  }

  void refresh();

  // Realtime is the product: another restaurant claims a zone and every other
  // phone has to show it without a refresh. `zones` has no publication on
  // their side, so a claims event refetches both.
  subscribeToClaims(() => void refresh())
    .then((off) => {
      unsubscribeRealtime = off;
      publish({ live: true });
    })
    .catch((err) => {
      // Polling is not as good, but a board that goes stale for twenty seconds
      // beats one that silently never updates again -- which is what used to
      // happen here, with the header sitting on "Connected" forever.
      console.warn("realtime unavailable, polling instead:", err);
      publish({ live: false });
      startPolling();
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

export interface NewClaim {
  zoneId: string;
  restaurantName: string;
  quantity: number;
  food?: string | null;
  dropWindow?: string | null;
}

export async function addClaim(input: NewClaim): Promise<void> {
  if (!hasBackend) {
    const local: Claim = {
      id: globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`,
      zone_id: input.zoneId,
      restaurant_name: input.restaurantName.trim(),
      quantity: input.quantity,
      status: "claimed",
      created_at: new Date().toISOString(),
      food: input.food ?? null,
      drop_window: input.dropWindow ?? null,
    };
    const claims = [local, ...board.claims];
    writeLocal(claims);
    publish({ claims, stats: localStats(claims) });
    return;
  }

  // Not optimistic against the server. The zone's coverage is computed by a
  // trigger we cannot predict from here -- guessing it and being wrong would
  // flip a zone to mint and then back, which is the one thing this screen
  // must never do. The insert plus refetch is a single round trip.
  const row = await insertClaim({
    zoneId: input.zoneId,
    restaurantName: input.restaurantName,
    quantity: input.quantity,
  });

  if (input.food || input.dropWindow) {
    saveNote(row.id, { food: input.food ?? null, drop_window: input.dropWindow ?? null });
  }
  await refresh();
}

async function changeStatus(id: string, status: ClaimStatus): Promise<void> {
  if (!hasBackend) {
    const claims = board.claims.map((c) => (c.id === id ? { ...c, status } : c));
    writeLocal(claims);
    publish({ claims, stats: localStats(claims) });
    return;
  }
  await setClaimStatus(id, status);
  await refresh();
}

/** Their schema has no DELETE policy: cancelling is a status change so the
 *  SB 1383 trail stays intact. */
export const cancelClaim = (id: string) => changeStatus(id, "cancelled");

/** Their trigger counts 'claimed' and 'delivered' alike, so marking a drop
 *  delivered does not change any zone's coverage. */
export const markDelivered = (id: string) => changeStatus(id, "delivered");

// ------------------------------------------------------------------- reads

const snapshot = () => board;
const serverSnapshot = () => board;

export function useBoard(): Board {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
