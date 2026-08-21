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

export function demoPickups(): Pickup[] {
  const stamp = new Date().toISOString();
  return SEEDS.map((s, i) => ({
    id: `demo-${i + 1}`,
    restaurant_name: s.restaurant_name,
    address: s.address,
    quantity: s.quantity,
    lat: s.lat,
    lng: s.lng,
    pickup_from: todayAt(s.from),
    pickup_to: todayAt(s.to),
    pickup_note: s.notes,
    status: "requested" as const,
    volunteer_name: null,
    zone_id: null,
    drop_location_note: null,
    created_at: stamp,
    demo: true,
  }));
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

export function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    /* private mode -- samples will reappear next load, which is harmless */
  }
}
