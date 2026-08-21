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
  fetchOffers,
  fetchZones,
  insertClaim,
  insertOffer,
  isMissingTable,
  patchOffer,
  setClaimStatus,
  subscribeToClaims,
  subscribeToOffers,
  type ClaimRow,
} from "./backend";
import { ZONES } from "./zones";
import type { Claim, ClaimStatus, NewOffer, Offer, ZoneStats } from "../types";

const CLAIM_KEY = "surplus-street-claims-v1";
const NOTE_KEY = "surplus-street-claim-notes-v1";
const OFFER_KEY = "surplus-street-offers-v1";

interface Board {
  claims: Claim[];
  offers: Offer[];
  stats: ZoneStats;
  ready: boolean;
  live: boolean;
  /** True once the shared `offers` table has answered. False means the
   *  migration is not applied yet and offers are local to this browser. */
  offersShared: boolean;
  error: string | null;
}

let board: Board = {
  claims: [],
  offers: [],
  stats: {},
  ready: false,
  live: false,
  offersShared: false,
  error: null,
};
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

// ------------------------------------------------------------------ offers

function readLocalOffers(): Offer[] {
  try {
    return JSON.parse(localStorage.getItem(OFFER_KEY) || "[]") as Offer[];
  } catch {
    return [];
  }
}

function writeLocalOffers(list: Offer[]) {
  try {
    localStorage.setItem(OFFER_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("offers could not be saved:", err);
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random()}`;
}

/** Set once we know whether the shared table exists, so every later write
 *  goes to the same place the reads came from. */
let offersShared = false;

/** Asked and answered. Without this the app re-probes a table it already
 *  knows is missing on every single refresh, which is a 404 per poll. The
 *  answer only changes when someone runs the migration, and the handoff doc
 *  says to reload after that. */
let offersProbed = false;

async function loadOffers(): Promise<Offer[]> {
  if (!hasBackend) return readLocalOffers();
  if (offersProbed && !offersShared) return readLocalOffers();
  try {
    const rows = await fetchOffers();
    offersShared = true;
    offersProbed = true;
    return rows as Offer[];
  } catch (err) {
    if (isMissingTable(err)) {
      // The migration is not applied yet. A known state, not a failure --
      // run offers on this device so the app still works.
      offersShared = false;
      offersProbed = true;
      return readLocalOffers();
    }
    throw err;
  }
}

// ------------------------------------------------------------------- stats

/** Offline: derive coverage from local claims, local offers and the shipped
 *  zone model. */
function localStats(claims: Claim[], offers: Offer[] = board.offers): ZoneStats {
  const out: ZoneStats = {};
  for (const z of ZONES.zones) {
    const fromClaims = claims
      .filter((c) => c.zone_id === z.id && c.status !== "cancelled")
      .reduce((a, c) => a + c.quantity, 0);
    const fromOffers = offers
      .filter(
        (o) => o.zone_id === z.id && (o.status === "accepted" || o.status === "delivered"),
      )
      .reduce((a, o) => a + o.quantity, 0);
    const claimed = fromClaims + fromOffers;
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
    const [zoneRows, claimRows, offerRows] = await Promise.all([
      fetchZones(),
      fetchClaims(),
      loadOffers(),
    ]);

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

    // When offers are local the server's food_claimed cannot know about them,
    // so fold them in here. Once the migration lands the trigger does it and
    // this adds nothing, because routed offers are already in food_claimed.
    if (!offersShared) {
      for (const o of offerRows) {
        if (!o.zone_id || (o.status !== "accepted" && o.status !== "delivered")) continue;
        const st = stats[o.zone_id];
        if (!st) continue;
        st.claimed += o.quantity;
        st.pct = st.expected ? Math.min(1, st.claimed / st.expected) : 1;
        st.covered = st.expected ? st.claimed >= st.expected : true;
        st.status = st.covered ? "covered" : st.claimed > 0 ? "partial" : "uncovered";
      }
    }

    publish({
      claims: withNotes(claimRows),
      offers: offerRows,
      stats,
      ready: true,
      offersShared,
      error: null,
    });
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
let unsubscribeOffers: (() => void) | null = null;
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
    const offers = readLocalOffers();
    publish({
      claims,
      offers,
      stats: localStats(claims, offers),
      ready: true,
      live: false,
      offersShared: false,
    });
    return;
  }

  // The first refresh has to finish before we decide which channels to open:
  // it is what discovers whether the `offers` table exists. Firing it and
  // subscribing in parallel meant that on a slow connection the claims
  // subscription resolved first, read offersShared while it was still false,
  // and quietly never opened the offers channel for the rest of the session.
  void refresh().then(() => {
    // Realtime is the product: a restaurant posts surplus and it appears on
    // every driver's phone without a refresh. `zones` has no publication on
    // the backend's side, so any event refetches everything.
    const channels: Promise<unknown>[] = [
      subscribeToClaims(() => void refresh()).then((off) => {
        unsubscribeRealtime = off;
      }),
    ];

    if (offersShared) {
      channels.push(
        subscribeToOffers(() => void refresh()).then((off) => {
          unsubscribeOffers = off;
        }),
      );
    }

    Promise.all(channels)
      .then(() => publish({ live: true }))
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
  unsubscribeOffers?.();
  unsubscribeOffers = null;
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

// ----------------------------------------------------------- offer writes
// Every one of these goes through the same two paths: the shared table when
// the migration is applied, this browser when it is not. No screen knows
// which, so applying the migration changes nothing above this line.

async function writeOffer(id: string, patch: Partial<Offer>): Promise<void> {
  if (offersShared) {
    await patchOffer(id, patch);
    await refresh();
    return;
  }
  const offers = board.offers.map((o) => (o.id === id ? { ...o, ...patch } : o));
  writeLocalOffers(offers);
  publish({ offers, stats: localStats(board.claims, offers) });
}

/** A restaurant posts surplus: what, how much, and when it can be collected. */
export async function postOffer(input: NewOffer): Promise<void> {
  if (offersShared) {
    await insertOffer(input);
    await refresh();
    return;
  }
  const local: Offer = {
    ...input,
    id: newId(),
    status: "open",
    volunteer_name: null,
    zone_id: null,
    accepted_at: null,
    delivered_at: null,
    created_at: new Date().toISOString(),
  };
  const offers = [local, ...board.offers];
  writeLocalOffers(offers);
  publish({ offers, stats: localStats(board.claims, offers) });
}

/** A volunteer takes the run. It leaves everyone else's list. */
export function acceptOffer(id: string, volunteer: string): Promise<void> {
  return writeOffer(id, {
    status: "accepted",
    volunteer_name: volunteer,
    accepted_at: new Date().toISOString(),
  });
}

/** The volunteer chooses where it goes. This is the decision the whole split
 *  exists for, and the moment the food starts counting towards a zone. */
export function routeOffer(id: string, zoneId: string): Promise<void> {
  return writeOffer(id, { zone_id: zoneId });
}

export function deliverOffer(id: string): Promise<void> {
  return writeOffer(id, { status: "delivered", delivered_at: new Date().toISOString() });
}

/** Handing a run back: it returns to the feed for someone else. */
export function releaseOffer(id: string): Promise<void> {
  return writeOffer(id, {
    status: "open",
    volunteer_name: null,
    zone_id: null,
    accepted_at: null,
  });
}

/** No DELETE policy, by design -- withdrawing keeps the row for the log. */
export function cancelOffer(id: string): Promise<void> {
  return writeOffer(id, { status: "cancelled" });
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
