// Typed mirror of the backend repo's src/api.js.
//
// The backend (siapatodia8/dsa-hackathon-2026, main) is finished and this
// adapts to it exactly. Every column name here is theirs.
//
// Their volunteer flow, from supabase/add_volunteer_delivery_flow.sql:
//
//   claims (id, zone_id NULLABLE, restaurant_name, quantity, status,
//           delivery_mode, volunteer_name, drop_location_note, created_at)
//
//   delivery_mode 'self':      claimed -> delivered, zone required at insert
//   delivery_mode 'volunteer': requested -> accepted -> delivered, zone null
//                              until a volunteer chooses one
//
// The app only uses the volunteer path. What a `claims` row does NOT carry is
// where the food is, what it is, or when it can be collected -- see
// supabase/migration_003_pickup_details.sql for the columns that would fix
// that. Until it runs, those live in the browser that typed them (store.ts).

import { supabase } from "./supabase";

export type ClaimStatus = "requested" | "accepted" | "claimed" | "delivered" | "cancelled";

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
  zone_id: string | null;
  restaurant_name: string;
  quantity: number;
  status: ClaimStatus;
  delivery_mode: "self" | "volunteer";
  volunteer_name: string | null;
  drop_location_note: string | null;
  created_at: string;

  // From migration_003. Undefined until it is applied; the store falls back
  // to local annotations, so nothing here may be assumed present.
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  food_type?: string | null;
  pickup_from?: string | null;
  pickup_to?: string | null;
  pickup_note?: string | null;
}

function client() {
  if (!supabase) throw new Error("no backend configured");
  return supabase;
}

/**
 * All 8 zones, with the generated coverage columns.
 *
 * coverage_pct and coverage_status are computed in Postgres from
 * food_claimed, which their trigger keeps in sync with tonight's claims.
 * Reading them rather than recomputing is the point: the server's definition
 * of "tonight" comes from app_state, which is RLS-locked and unreadable from
 * here, so a client-side sum could not agree with it.
 */
export async function fetchZones(): Promise<ZoneRow[]> {
  const { data, error } = await client().from("zones").select("*").order("zone_id");
  if (error) throw error;
  return (data ?? []) as ZoneRow[];
}

/** Every claim, newest first. Their api.js reads per-zone and per-restaurant;
 *  this app needs the whole board to build the volunteer feed. */
export async function fetchClaims(): Promise<ClaimRow[]> {
  const { data, error } = await client()
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClaimRow[];
}

/** Their requestVolunteerPickup: a restaurant posts surplus with no zone. */
export async function insertRequest(input: {
  restaurant_name: string;
  quantity: number;
  extras: Record<string, unknown>;
}): Promise<ClaimRow> {
  const name = input.restaurant_name.trim();
  if (!name) throw new Error("insertRequest: restaurant_name is required");
  if (!(Number(input.quantity) > 0)) {
    throw new Error("insertRequest: quantity must be a positive number");
  }

  const { data, error } = await client()
    .from("claims")
    .insert({
      zone_id: null,
      restaurant_name: name,
      quantity: Number(input.quantity),
      delivery_mode: "volunteer",
      status: "requested",
      ...input.extras,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ClaimRow;
}

export async function patchClaim(id: string, patch: Record<string, unknown>): Promise<ClaimRow> {
  const { data, error } = await client()
    .from("claims")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ClaimRow;
}

/** True when the failure is "that column is not there", not "the network
 *  died" -- i.e. migration_003 has not been run. */
export function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return (
    !!e &&
    (e.code === "PGRST204" ||
      e.code === "42703" ||
      /column .* does not exist|schema cache/i.test(e.message ?? ""))
  );
}

// Their api.js comment: Supabase can report SUBSCRIBED slightly before the
// server finishes binding the replication filter, so a write made straight
// after subscribing can be missed. Same settle window here.
const REALTIME_SETTLE_MS = 1500;

// And a hard ceiling. `subscribe` can also report nothing at all, which left
// the promise pending forever and realtime silently never starting.
const REALTIME_GIVE_UP_MS = 8000;

/** Resolves to an unsubscribe function once the channel is genuinely ready. */
export function subscribeToClaims(onChange: () => void): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const sb = client();

    // Unique per call. Their api.js uses a fixed "claims-changes", which is
    // fine for one subscription per page -- but two channels sharing a topic
    // on one client leaves the second one's callback never firing, and in dev
    // StrictMode's double mount makes that easy to hit. The topic is a
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
