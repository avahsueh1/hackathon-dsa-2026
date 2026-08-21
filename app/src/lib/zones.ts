// Everything derived from a zone plus tonight's claims. Pure functions on
// purpose: they are called during render and must never touch the store.

import zonesFile from "../data/zones.json";
import geometryFile from "../data/geometry.json";
import type { Claim, GeometryFile, Zone, ZonesFile } from "../types";

export const ZONES = zonesFile as unknown as ZonesFile;
export const GEOMETRY = geometryFile as unknown as GeometryFile;

/** Claims that still count -- cancelled ones stay in the log but not the maths. */
export function claimsFor(claims: Claim[], zoneId: string): Claim[] {
  return claims.filter((c) => c.zone === zoneId && c.status !== "cancelled");
}

export function mealsFor(claims: Claim[], zoneId: string): number {
  return claimsFor(claims, zoneId).reduce((a, c) => a + c.meals, 0);
}

export function stillNeeded(claims: Claim[], z: Zone): number {
  return Math.max(0, z.expected_tonight - mealsFor(claims, z.id));
}

export function coverage(claims: Claim[], z: Zone): number {
  if (!z.expected_tonight) return 1;
  return Math.min(1, mealsFor(claims, z.id) / z.expected_tonight);
}

export function isCovered(claims: Claim[], z: Zone): boolean {
  // Floating point: 389.9999/390 is covered.
  return coverage(claims, z) >= 0.999;
}

/** Open zones first, then whichever still needs the most. */
export function byUrgency(claims: Claim[], zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) => {
    const ca = isCovered(claims, a);
    const cb = isCovered(claims, b);
    if (ca !== cb) return ca ? 1 : -1;
    return stillNeeded(claims, b) - stillNeeded(claims, a);
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

export function totals(claims: Claim[]): TonightTotals {
  const zs = ZONES.zones;
  const expected = zs.reduce((a, z) => a + z.expected_tonight, 0);
  const claimed = zs.reduce((a, z) => a + mealsFor(claims, z.id), 0);
  const covered = zs.filter((z) => isCovered(claims, z)).length;
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
