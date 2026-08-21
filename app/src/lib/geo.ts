// Where the driver is.
//
// Distance is the thing a volunteer actually decides on -- "is this on my way"
// beats "is this a big load" every time -- so the pickup list leads with it.
//
// Everything degrades: permission denied, no GPS, http on a phone, all end up
// at `status: "off"` and the list falls back to showing the quantity instead.
// Nothing here is required for the app to work.

import { useEffect, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  /** Metres of reported uncertainty, for drawing the accuracy ring. */
  accuracy: number;
}

export type LocationStatus = "idle" | "asking" | "on" | "off";

export interface MyLocation {
  fix: Fix | null;
  status: LocationStatus;
  /** Ask again after a denial, since a phone can be moved indoors and back. */
  retry: () => void;
}

export function useMyLocation(enabled = true): MyLocation {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("off");
      return;
    }

    setStatus("asking");

    // watchPosition rather than getCurrentPosition: a driver moves, and the
    // distances are worth nothing if they were measured where they parked
    // twenty minutes ago.
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setStatus("on");
      },
      () => {
        // Denied, unavailable, or timed out -- all the same to the UI.
        setStatus("off");
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, attempt]);

  return { fix, status, retry: () => setAttempt((n) => n + 1) };
}

/** Metres between two points, near enough over a few km of downtown. */
export function metresBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const kx = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const dx = (bLng - aLng) * (Math.PI / 180) * kx;
  const dy = (bLat - aLat) * (Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy) * R;
}

/** Miles, because this is San Diego. Two decimals under a tenth of a mile is
 *  false precision on a straight-line estimate, so it says "0.1 mi" at most
 *  one decimal and switches to feet when it is genuinely close. */
export function prettyMiles(metres: number | null): string {
  if (metres == null) return "";
  const miles = metres * 0.000621371;
  if (miles < 0.1) return `${Math.round(metres * 3.28084 / 10) * 10} ft`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
