// Typed mirror of the backend repo's src/api.js.
//
// The backend is a separate repo (siapatodia8/dsa-hackathon-2026) and is
// finished -- this file adapts to its schema exactly and changes nothing on
// that side. Every column name here is theirs.
//
// Their shapes, verbatim from supabase/schema.sql:
//
//   zones (zone_id PK, zone_name, baseline_predicted, recent_311_count,
//          recent_311_adjustment, food_claimed, need_score, need_tier,
//          need_label, model_as_of, geometry jsonb,
//          coverage_pct GENERATED, coverage_status GENERATED)
//
//   claims (id uuid, zone_id FK, restaurant_name, quantity, status, created_at)
//
// Note what claims does NOT have: no drop window, no food description, no
// restaurant table, no auth. Anything the UI collects beyond name + quantity
// is a local annotation -- see store.ts.

import { supabase } from "./supabase";

export interface ZoneRow {
  zone_id: string;
  zone_name: string;
  baseline_predicted: number;
  recent_311_count: number;
  recent_311_adjustment: number;
  food_claimed: number;
  need_score: number;
  need_tier: string;
  need_label: string;
  model_as_of: string | null;
  coverage_pct: number | null;
  coverage_status: "uncovered" | "partial" | "covered";
}

export interface ClaimRow {
  id: string;
  zone_id: string;
  restaurant_name: string;
  quantity: number;
  status: "claimed" | "delivered" | "cancelled";
  created_at: string;
}

function client() {
  if (!supabase) throw new Error("no backend configured");
  return supabase;
}

/**
 * All 8 zones: need model fields and the generated coverage fields.
 *
 * coverage_pct and coverage_status are computed in Postgres from
 * food_claimed, which a trigger keeps in sync with tonight's claims. Reading
 * them rather than recomputing client-side is the point: the server's
 * definition of "tonight" comes from app_state, which is RLS-locked and not
 * readable from here, so a client-side sum could not agree with it.
 *
 * `zones` deliberately has no Realtime publication on their side, so this is
 * refetched whenever a claim changes.
 */
export async function fetchZones(): Promise<ZoneRow[]> {
  const { data, error } = await client().from("zones").select("*").order("zone_id");
  if (error) throw error;
  return (data ?? []) as ZoneRow[];
}

/** Every claim, newest first. Their api.js reads per-zone; the board needs all. */
export async function fetchClaims(): Promise<ClaimRow[]> {
  const { data, error } = await client()
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClaimRow[];
}

/** Claim a zone. Mirrors their claimZone(), including its validation. */
export async function insertClaim(input: {
  zoneId: string;
  restaurantName: string;
  quantity: number;
}): Promise<ClaimRow> {
  const name = input.restaurantName.trim();
  if (!input.zoneId) throw new Error("claimZone: zoneId is required");
  if (!name) throw new Error("claimZone: restaurantName is required");
  if (!(Number(input.quantity) > 0)) {
    throw new Error("claimZone: quantity must be a positive number");
  }

  const { data, error } = await client()
    .from("claims")
    .insert({
      zone_id: input.zoneId,
      restaurant_name: name,
      quantity: Number(input.quantity),
      status: "claimed",
    })
    .select()
    .single();
  if (error) throw error;
  return data as ClaimRow;
}

/** Their schema has no DELETE policy: cancelling is a status change, so the
 *  claim history stays intact for the SB 1383 export. */
export async function setClaimStatus(
  claimId: string,
  status: ClaimRow["status"],
): Promise<ClaimRow> {
  const { data, error } = await client()
    .from("claims")
    .update({ status })
    .eq("id", claimId)
    .select()
    .single();
  if (error) throw error;
  return data as ClaimRow;
}

// Their api.js comment: Supabase can report SUBSCRIBED slightly before the
// server finishes binding the replication filter, so a write made straight
// after subscribing can be missed. Same settle window here.
const REALTIME_SETTLE_MS = 1500;

// And a hard ceiling. `subscribe` reports SUBSCRIBED / CHANNEL_ERROR /
// TIMED_OUT / CLOSED, but it can also report nothing at all -- which left the
// promise pending forever and the header stuck on "Connected" while realtime
// silently never started. A subscription that has not confirmed in this long
// is not going to.
const REALTIME_GIVE_UP_MS = 8000;

/** Resolves to an unsubscribe function once the channel is genuinely ready. */
export function subscribeToClaims(onChange: () => void): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const sb = client();

    // Unique per call. Their api.js uses a fixed "claims-changes", which is
    // fine for one subscription per page -- but two channels sharing a topic
    // on one client can leave the second one's callback never firing, and in
    // dev StrictMode's double mount makes that easy to hit. The topic is a
    // client-side name, so this changes nothing on their side.
    const topic = `claims-changes-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const channel = sb
      .channel(topic)
      .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, () => onChange())
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          setTimeout(
            () => finish(() => resolve(() => void sb.removeChannel(channel))),
            REALTIME_SETTLE_MS,
          );
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          finish(() => {
            void sb.removeChannel(channel);
            reject(err ?? new Error(`subscribeToClaims: ${status}`));
          });
        }
      });

    setTimeout(() => {
      finish(() => {
        void sb.removeChannel(channel);
        reject(new Error("subscribeToClaims: no status after 8s"));
      });
    }, REALTIME_GIVE_UP_MS);
  });
}
