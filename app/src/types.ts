// Shapes the Python pipeline actually emits. Kept narrow on purpose: if a
// build script changes a field name, tsc fails here rather than the UI
// rendering "undefined" at 9pm.

export type LonLat = [number, number];

export interface Zone {
  id: string;
  name: string;
  area: string;
  block_ids: string[];
  block_count: number;
  expected_tonight: number;
  band: "high" | "medium" | "low";
  centroid: LonLat;
  landmark: { a: string; b: string };
  trend_pct: number | null;
  services: { shelters: number; shelter_beds: number; clinics: number };
  model: {
    need_score: number;
    baseline_predicted: number;
    recent_311_count: number;
    recent_311_adjustment: number;
    baseline_confidence: string;
    baseline_observation_count: number;
    grouping_reason: string;
    as_of: string;
  };
}

export interface ZonesFile {
  as_of: string;
  basis: string;
  bands: { high: number; medium: number };
  privacy: string;
  total_expected: number;
  zones: Zone[];
}

export interface Block {
  id: string;
  area: string;
  neighborhood_source: string;
  streets: { n: string; e: string; s: string; w: string };
  centroid: LonLat;
  rings: LonLat[][];
}

export interface GeometryFile {
  bbox: [number, number, number, number];
  blocks: Block[];
}

// ------------------------------------------------------------------ claims
// These are the backend's column names, not ours -- see lib/backend.ts. The
// frontend was reshaped to match the schema rather than the schema reshaped
// to match the frontend.

export type ClaimStatus = "claimed" | "delivered" | "cancelled";

export interface Claim {
  id: string;
  zone_id: string;
  restaurant_name: string;
  quantity: number;
  status: ClaimStatus;
  created_at: string;

  /** Local annotations. The shared `claims` table has no column for either,
   *  so these live in this browser and are shown only on the device that
   *  entered them. Everyone sees the name and the quantity. */
  food?: string | null;
  drop_window?: string | null;
}

/** Server truth per zone. When a backend is connected these come straight
 *  from the generated `coverage_pct` / `coverage_status` columns, because the
 *  server's "tonight" window (app_state) is RLS-locked and cannot be
 *  reproduced client-side. Offline they are computed from local claims. */
export interface ZoneStat {
  claimed: number;
  expected: number;
  pct: number;                  // 0..1, capped for display
  covered: boolean;
  status: "uncovered" | "partial" | "covered";
}

export type ZoneStats = Record<string, ZoneStat>;

// ------------------------------------------------------------------ offers
// A restaurant posts what it has and when it can be collected. A volunteer
// collects it and decides which zone it goes to -- so food exists before it
// has a destination, and zone_id is null until the drop-off.

export type OfferStatus = "open" | "accepted" | "delivered" | "cancelled";

export interface Offer {
  id: string;
  restaurant_name: string;
  address: string;
  contact: string | null;
  food_type: string;
  quantity: number;
  notes: string | null;
  pickup_from: string;          // ISO
  pickup_to: string;            // ISO
  status: OfferStatus;
  volunteer_name: string | null;
  zone_id: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface NewOffer {
  restaurant_name: string;
  address: string;
  contact: string | null;
  food_type: string;
  quantity: number;
  notes: string | null;
  pickup_from: string;
  pickup_to: string;
}

// --------------------------------------------------------------------- role
// The two sides of the product. One device is one or the other; switching is
// possible but deliberate, because the screens have nothing in common.

export type Role = "restaurant" | "volunteer";

// ------------------------------------------------------------- restaurants
// The backend has no restaurants table and no auth, so registration is a
// local convenience only: it saves typing the business name on every claim.

export interface Restaurant {
  id?: string;
  name: string;
  address: string;
  business_type: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  typical_meals: number | null;
  surplus_days: string[];
}
