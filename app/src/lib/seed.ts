// Sample pickups, so the volunteer side has something in it before any real
// restaurant has posted.
//
// Seeded ONLY into local storage, and only when the shared `offers` table is
// not there and nothing has been posted on this device yet. It must never
// reach the shared board -- fake surplus that a real driver goes out for is
// the worst possible bug in this product.
//
// Every row is flagged `demo: true`, which is a local-only field the UI uses
// to mark the card. Coordinates are real downtown San Diego addresses so the
// pins land where the streets actually are.

import type { Pickup } from "../types";
import { todayAt } from "./food";

interface Seed {
  restaurant_name: string;
  address: string;
  quantity: number;
  notes: string | null;
  lat: number;
  lng: number;
  from: number;
  to: number;
}

const SEEDS: Seed[] = [
  {
    restaurant_name: "Kono's Cafe",
    address: "1720 India St, Little Italy",
    quantity: 40,
    notes: "Trays are heavy — bring a cart if you have one",
    lat: 32.7248, lng: -117.1690,
    from: 20, to: 21,
  },
  {
    restaurant_name: "Prep Kitchen",
    address: "630 Fifth Ave, Gaslamp",
    quantity: 25,
    notes: "Ask at the host stand",
    lat: 32.7118, lng: -117.1603,
    from: 21, to: 22,
  },
  {
    restaurant_name: "Taquería Luna",
    address: "1202 Market St, East Village",
    quantity: 30,
    notes: "Back door on the alley, ask for Marco",
    lat: 32.7108, lng: -117.1541,
    from: 22, to: 23,
  },
  {
    restaurant_name: "Bahn Thai",
    address: "1441 Ninth Ave, Cortez",
    quantity: 20,
    notes: null,
    lat: 32.7205, lng: -117.1583,
    from: 19, to: 20,
  },
  {
    restaurant_name: "Neighborhood",
    address: "777 G St, East Village",
    quantity: 35,
    notes: "Loading zone out front until 11",
    lat: 32.7112, lng: -117.1583,
    from: 21, to: 22,
  },
  {
    restaurant_name: "Café Virtuoso",
    address: "1616 National Ave, Barrio Logan",
    quantity: 15,
    notes: null,
    lat: 32.6982, lng: -117.1437,
    from: 18, to: 19,
  },
];

/**
 * Drops that already happened tonight.
 *
 * Without these every zone reads 0% and the map is a wall of amber, which
 * shows none of the thing the product is actually for -- the mix of covered,
 * part-covered and untouched that tells a driver where to go. Delivered, so
 * they count towards their zone the same way a real drop would.
 */
const DELIVERED: (Seed & { zone: string; volunteer: string })[] = [
  {
    restaurant_name: "Juniper & Ivy",
    address: "2228 Kettner Blvd, Little Italy",
    quantity: 60,
    notes: null,
    lat: 32.7276, lng: -117.1706,
    from: 18, to: 19,
    zone: "northwest_downtown",
    volunteer: "Maria O.",
  },
  {
    restaurant_name: "Lolita's Taco Shop",
    address: "202 Park Blvd, East Village",
    quantity: 85,
    notes: null,
    lat: 32.7096, lng: -117.1560,
    from: 18, to: 19,
    zone: "east_village_south",
    volunteer: "Maria O.",
  },
  {
    restaurant_name: "Cafe Chloe",
    address: "721 Ninth Ave, East Village",
    quantity: 45,
    notes: null,
    lat: 32.7133, lng: -117.1560,
    from: 19, to: 20,
    zone: "east_village_north",
    volunteer: "Devon P.",
  },
  {
    restaurant_name: "Bencotto",
    address: "750 W Fir St, Little Italy",
    quantity: 22,
    notes: null,
    lat: 32.7262, lng: -117.1697,
    from: 19, to: 20,
    zone: "outside_golden_hill",
    volunteer: "Devon P.",
  },
];

function base(s: Seed, id: string, stamp: string) {
  return {
    id,
    restaurant_name: s.restaurant_name,
    address: s.address,
    quantity: s.quantity,
    lat: s.lat,
    lng: s.lng,
    pickup_from: todayAt(s.from),
    pickup_to: todayAt(s.to),
    pickup_note: s.notes,
    drop_location_note: null,
    created_at: stamp,
    demo: true,
  };
}

/**
 * A whole evening, mid-service: four drops already made and six still waiting
 * for a driver.
 *
 * `attributeTo` renames one delivered drop to the signed-in restaurant, so
 * their donation log and CSV have something in them to show. Everything here
 * is local to this device and is never written to the shared board -- fake
 * surplus that a real driver goes out for is the worst bug this product
 * could have.
 */
export function demoPickups(attributeTo?: string | null): Pickup[] {
  const stamp = new Date().toISOString();

  const open: Pickup[] = SEEDS.map((s, i) => ({
    ...base(s, `demo-open-${i + 1}`, stamp),
    status: "requested" as const,
    volunteer_name: null,
    zone_id: null,
  }));

  const done: Pickup[] = DELIVERED.map((s, i) => ({
    ...base(
      i === 0 && attributeTo ? { ...s, restaurant_name: attributeTo } : s,
      `demo-done-${i + 1}`,
      stamp,
    ),
    status: "delivered" as const,
    volunteer_name: s.volunteer,
    zone_id: s.zone,
  }));

  return [...done, ...open];
}

/** Has this device ever been seeded? Kept separate from the pickup list so
 *  clearing every sample does not bring them straight back.
 *
 *  Versioned WITH the storage keys it guards. When the pickup list moved from
 *  ...-offers-v1 to ...-pickups-v1 this flag stayed behind, so upgrading
 *  devices had an empty list and a flag saying "already seeded" -- and no
 *  samples at all. Bump both together or neither. */
const SEEDED_KEY = "surplus-street-seeded-v2";

export function alreadySeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    return true; // no storage: behave as if seeded, rather than seed forever
  }
}

export function forgetSeeded(): void {
  try {
    localStorage.removeItem(SEEDED_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    /* private mode -- samples will reappear next load, which is harmless */
  }
}
