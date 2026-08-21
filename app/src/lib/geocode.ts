// Turning a typed address into a point on the map, locally.
//
// A restaurant types "1202 Market St, East Village". A volunteer needs a pin.
// There is no geocoder here and calling one would be a network dependency on
// the one screen that has to work at 10pm on venue wifi -- so this matches the
// address against the block network the app already ships: 382 downtown blocks,
// each with its four bounding streets, its neighbourhood, and a centroid.
//
// The result is the middle of a block on the named street, which is right to
// within a block. That is honest for "drive here" and it never invents a
// location: no street match means no pin, and the offer simply lists instead.

import { GEOMETRY } from "./zones";
import { prettyStreet } from "./streets";

export interface Located {
  lat: number;
  lng: number;
  /** Which street matched, for showing the driver what we actually resolved. */
  matched: string;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

/** "Market St" -> also "market", so "1202 Market" matches too. */
function streetKeys(pretty: string): string[] {
  const full = norm(pretty);
  const bare = full.replace(/\s+(st|ave|blvd|dr|way|pl|rd|ct|ter|pkwy|aly|hwy|cir)$/, "");
  return bare && bare !== full ? [full, bare] : [full];
}

interface Entry {
  keys: string[];
  area: string;
  lat: number;
  lng: number;
}

let index: Entry[] | null = null;

function build(): Entry[] {
  if (index) return index;
  index = GEOMETRY.blocks.flatMap((b) => {
    const [lng, lat] = b.centroid;
    // A block is bounded by four streets; an address on any of them is on
    // this block.
    const names = [b.streets.n, b.streets.e, b.streets.s, b.streets.w]
      .map(prettyStreet)
      .filter(Boolean);
    if (!names.length) return [];
    return [{ keys: names.flatMap(streetKeys), area: norm(b.area), lat, lng }];
  });
  return index;
}

/**
 * Best-effort point for a typed address. Null when nothing matches, which is
 * the correct answer for "742 Fifth Ave, Los Angeles".
 */
export function locate(address: string): Located | null {
  const text = norm(address);
  if (!text) return null;

  const entries = build();

  // A neighbourhood in the address disambiguates streets that run the length
  // of downtown -- Market St crosses five zones.
  const areaHit = entries.find((e) => e.area && text.includes(e.area));
  const pool = areaHit ? entries.filter((e) => e.area === areaHit.area) : entries;

  let best: { entry: Entry; key: string } | null = null;
  for (const entry of pool) {
    for (const key of entry.keys) {
      if (key.length < 3 || !text.includes(key)) continue;
      // Longest match wins: "national ave" beats "national".
      if (!best || key.length > best.key.length) best = { entry, key };
    }
  }
  if (!best) return null;

  // Several blocks sit on the same street; the middle of them is a better
  // guess than whichever happened to be first in the file.
  const onStreet = pool.filter((e) => e.keys.includes(best!.key));
  const lat = onStreet.reduce((a, e) => a + e.lat, 0) / onStreet.length;
  const lng = onStreet.reduce((a, e) => a + e.lng, 0) / onStreet.length;

  return { lat, lng, matched: best.key };
}
