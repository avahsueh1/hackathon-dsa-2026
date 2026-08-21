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

export type ClaimStatus = "claimed" | "delivered" | "cancelled";

export interface Claim {
  id: string;
  zone: string;
  zone_name: string;
  meals: number;
  drop_window: string;
  food_description: string | null;
  donor_name: string | null;
  drop_date: string;          // YYYY-MM-DD
  status: ClaimStatus;
  created_at: string;
}

export type NewClaim = Omit<Claim, "id" | "created_at">;

// ------------------------------------------------------------- restaurants

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
