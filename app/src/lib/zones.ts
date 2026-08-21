// Everything derived from a zone plus tonight's claims. Pure functions on
// purpose: they are called during render and must never touch the store.

import zonesFile from "../data/zones.json";
import geometryFile from "../data/geometry.json";
import type { Claim, GeometryFile, Zone, ZoneStat, ZoneStats, ZonesFile } from "../types";

export const ZONES = zonesFile as unknown as ZonesFile;
export const GEOMETRY = geometryFile as unknown as GeometryFile;

/** Claims that still count -- cancelled ones stay in the log but not the maths. */
export function claimsFor(claims: Claim[], zoneId: string): Claim[] {
  return claims.filter((c) => c.zone_id === zoneId && c.status !== "cancelled");
}

const MISSING: ZoneStat = {
  claimed: 0,
  expected: 0,
  pct: 0,
  covered: false,
  status: "uncovered",
};

/** Coverage comes from the store, which gets it from the server when one is
 *  connected. Never recompute it here: the server's "tonight" window is not
 *  reproducible client-side, and two disagreeing numbers is worse than one. */
export function statOf(stats: ZoneStats, z: Zone): ZoneStat {
  return stats[z.id] ?? { ...MISSING, expected: z.expected_tonight };
}

export function coverage(stats: ZoneStats, z: Zone): number {
  return statOf(stats, z).pct;
}

export function isCovered(stats: ZoneStats, z: Zone): boolean {
  return statOf(stats, z).covered;
}

export function mealsFor(stats: ZoneStats, z: Zone): number {
  return statOf(stats, z).claimed;
}

export function expectedFor(stats: ZoneStats, z: Zone): number {
  const e = statOf(stats, z).expected;
  return e > 0 ? e : z.expected_tonight;
}

export function stillNeeded(stats: ZoneStats, z: Zone): number {
  return Math.max(0, expectedFor(stats, z) - mealsFor(stats, z));
}

/** Open zones first, then whichever still needs the most. */
export function byUrgency(stats: ZoneStats, zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) => {
    const ca = isCovered(stats, a);
    const cb = isCovered(stats, b);
    if (ca !== cb) return ca ? 1 : -1;
    return stillNeeded(stats, b) - stillNeeded(stats, a);
  });
}

export interface TonightTotals {
  expected: number;
  claimed: number;
  short: number;
  covered: number;
  open: number;
  total: number;
}

export function totals(stats: ZoneStats): TonightTotals {
  const zs = ZONES.zones;
  let expected = 0;
  let claimed = 0;
  let covered = 0;
  for (const z of zs) {
    expected += expectedFor(stats, z);
    claimed += mealsFor(stats, z);
    if (isCovered(stats, z)) covered++;
  }
  return {
    expected,
    claimed,
    short: Math.max(0, expected - claimed),
    covered,
    open: zs.length - covered,
    total: zs.length,
  };
}

// --------------------------------------------------------------- geometry

const blockById = new Map(GEOMETRY.blocks.map((b) => [b.id, b]));

/** Leaflet wants [lat, lng]; the pipeline emits [lon, lat]. One place to flip. */
export function zoneRings(z: Zone): [number, number][][] {
  const out: [number, number][][] = [];
  for (const id of z.block_ids) {
    const b = blockById.get(id);
    if (!b) continue;
    for (const ring of b.rings) {
      out.push(ring.map(([lon, lat]) => [lat, lon] as [number, number]));
    }
  }
  return out;
}

export function zoneCenter(z: Zone): [number, number] {
  return [z.centroid[1], z.centroid[0]];
}

/** Bounds over every block in every zone, for the initial fit. */
export function downtownBounds(): [[number, number], [number, number]] {
  const [w, s, e, n] = GEOMETRY.bbox;
  return [
    [s, w],
    [n, e],
  ];
}

// ------------------------------------------------------------- suggestions

/** Metres between two lat/lng, near enough. Equirectangular with a cos(lat)
 *  correction: over a few km of downtown the error is centimetres, and it
 *  costs one cosine instead of a haversine. */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const kx = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const dx = (bLng - aLng) * (Math.PI / 180) * kx;
  const dy = (bLat - aLat) * (Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy) * R;
}

export interface ZoneSuggestion {
  zone: Zone;
  /** Straight-line metres from the pickup, or null if we have no pin. */
  distance: number | null;
  short: number;
}

/**
 * Where to take this food, best first.
 *
 * Ranked by need, then broken by distance -- a driver standing in Little Italy
 * should not be sent to Barrio Logan for six more meals of coverage. Zones
 * that are already covered sink to the bottom whatever their distance.
 */
export function suggestZones(
  stats: ZoneStats,
  from: { lat: number | null; lng: number | null },
): ZoneSuggestion[] {
  const has = from.lat != null && from.lng != null;

  return ZONES.zones
    .map((zone) => ({
      zone,
      short: stillNeeded(stats, zone),
      distance: has
        ? metres(from.lat as number, from.lng as number, zone.centroid[1], zone.centroid[0])
        : null,
    }))
    .sort((a, b) => {
      const ac = a.short <= 0;
      const bc = b.short <= 0;
      if (ac !== bc) return ac ? 1 : -1;
      if (a.distance == null || b.distance == null) return b.short - a.short;
      // Need per kilometre driven: 300 meals eight blocks away beats 320 a
      // mile away, and the driver still gets sent where it matters.
      return b.short / Math.max(400, b.distance) - a.short / Math.max(400, a.distance);
    });
}

export function prettyDistance(m: number | null): string {
  if (m == null) return "";
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
