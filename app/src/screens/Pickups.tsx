import { useEffect, useMemo, useState } from "react";
import type { Pickup, ZoneStats } from "../types";
import { takePickup } from "../lib/store";
import { ZONES, suggestZones, prettyDistance } from "../lib/zones";
import { activeRoute, assignToActive } from "../lib/routes";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import PickupMap from "../components/PickupMap";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

/**
 * Where food is ready, and where it should go.
 *
 * Map first, list underneath. A pickup is a place you have to drive to, and a
 * list of addresses does not tell you which ones are on your way; pings on a
 * map do.
 *
 * Choosing the drop-off happens HERE, at pickup, not at delivery. Two reasons:
 * the zone's coverage moves the moment the food is spoken for, so no second
 * driver duplicates the run; and someone collecting in Little Italy wants to
 * know where it is going before they put it in the car, not after.
 */

/**
 * When a driver can actually go.
 *
 *   now    the window is open — you could collect this on the way home
 *   hour   starts within the hour, worth setting off for
 *   2h     the rest of the near future
 *   any    everything, including runs that are hours away
 *
 * "now" is the one that matters at 9pm: a run you can do this minute beats a
 * bigger one you would have to come back for.
 */
type When = "now" | "hour" | "soon" | "any";

/* Terse because four chips plus the meal count have to hold one row on a
   phone -- wrapped, they pushed the map down by a whole line. */
const WHEN_LABEL: Record<When, string> = {
  now: "Now",
  hour: "1 hr",
  soon: "2 hr",
  any: "All",
};

/* Spelled out where there is room for it: the empty state. */
const WHEN_PHRASE: Record<When, string> = {
  now: "open right now",
  hour: "in the next hour",
  soon: "in the next two hours",
  any: "at all",
};

interface Props {
  pickups: Pickup[];
  stats: ZoneStats;
  volunteer: string | null;
  onAccepted: () => void;
  onNeedName: () => void;
  onOpenRoute: () => void;
}

export default function Pickups({
  pickups,
  stats,
  volunteer,
  onAccepted,
  onNeedName,
  onOpenRoute,
}: Props) {
  const [when, setWhen] = useState<When>("any");
  const [selected, setSelected] = useState<string | null>(null);
  // Which zone is being written, so its row can say so. There is no separate
  // confirm: picking the zone IS the decision, and asking again after it was
  // just answered is one tap too many at 10pm.
  const [busy, setBusy] = useState<string | null>(null);

  const open = useMemo(() => {
    const now = Date.now();
    const hour = now + 60 * 60 * 1000;
    const twoHours = now + 2 * 60 * 60 * 1000;

    return pickups
      .filter((p) => p.status === "requested")
      .filter((p) => {
        if (when === "any") return true;
        const from = new Date(p.pickup_from).getTime();
        const to = new Date(p.pickup_to).getTime();
        // "Right now" means the window is open, not that it starts soon --
        // a pickup that opened an hour ago is still collectable.
        if (when === "now") return from <= now && to >= now;
        if (when === "hour") return from <= hour && to >= now;
        return from <= twoHours && to >= now;
      })
      .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from));
  }, [pickups, when]);

  const route = useMemo(
    () =>
      pickups.filter(
        (p) => p.status === "claimed" && (!volunteer || p.volunteer_name === volunteer),
      ),
    [pickups, volunteer],
  );

  const chosen = open.find((p) => p.id === selected) ?? null;

  // Where the route in progress is heading. One zone reads as a destination;
  // several is a count, because three names do not fit on one line.
  const heading = useMemo(() => {
    const names = Array.from(
      new Set(
        route
          .map((p) => p.zone_id)
          .filter(Boolean)
          .map((id) => ZONES.zones.find((z) => z.id === id)?.name ?? id),
      ),
    ) as string[];
    if (names.length === 0) return null;
    return names.length === 1 ? names[0] : `${names.length} zones`;
  }, [route]);

  // Closest zone that still needs food, for whichever pickup is selected.
  const suggested = useMemo(
    () => (chosen ? (suggestZones(stats, { lat: chosen.lat, lng: chosen.lng })[0] ?? null) : null),
    [chosen, stats],
  );

  // A selection the filter just hid would leave the card describing a pickup
  // that is no longer on the map.
  useEffect(() => {
    if (selected && !open.some((p) => p.id === selected)) setSelected(null);
  }, [open, selected]);

  const totalMeals = open.reduce((a, p) => a + p.quantity, 0);

  async function take(zoneId: string) {
    if (!chosen) return;
    if (!volunteer) return onNeedName();
    setBusy(zoneId);
    try {
      await takePickup(chosen.id, volunteer, zoneId);
      // Joins whichever route is open, creating the first one on demand so a
      // driver never has to start a route before they can take anything.
      assignToActive(chosen.id);
      setSelected(null);
      onAccepted();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pickupscreen">
      <div className="pickupbar">
        <span className="ss-label pickupbar-l">
          {fmt(totalMeals)} meals · {open.length} {plural(open.length, "pickup")}
        </span>
        <div className="pickrow">
          {(["now", "hour", "soon", "any"] as When[]).map((w) => (
            <button
              key={w}
              type="button"
              className={`pick tiny${w === when ? " on" : ""}`}
              onClick={() => setWhen(w)}
            >
              {WHEN_LABEL[w]}
            </button>
          ))}
        </div>
      </div>

      <PickupMap
        pickups={open}
        route={route}
        stats={stats}
        selectedId={selected}
        onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
      />

      {route.length > 0 && !chosen && (
        <button type="button" className="routebar" onClick={onOpenRoute}>
          <span className="routebar-text">
            <span className="ss-label">
              ▸ {activeRoute().label} · {route.length} {plural(route.length, "stop")} ·{" "}
              {fmt(route.reduce((a, p) => a + p.quantity, 0))} meals
            </span>
            {heading && <span className="routebar-to">Heading to {heading}</span>}
          </span>
          <span className="routebar-go">Open</span>
        </button>
      )}

      {open.length === 0 ? (
        <div className="pickuplist">
          <EmptyState
            headline={
              when === "any" ? "Nothing to collect yet." : `Nothing ${WHEN_PHRASE[when]}.`
            }
            detail={
              when === "any"
                ? "Restaurants post surplus at the end of service. This list fills up from about 8pm."
                : "There may be runs later tonight — try a wider window."
            }
            actionLabel={when === "any" ? undefined : "Show any time"}
            onAction={() => setWhen("any")}
          />
        </div>
      ) : chosen ? (
        <div className="pickupcard">
          <div className="pickupcard-top">
            <span className="ss-label pickup-when">
              ◷ {windowLabel(chosen.pickup_from, chosen.pickup_to)}
            </span>
            <span className="ss-num zcard-need">~{fmt(chosen.quantity)} meals</span>
          </div>
          <span className="pickupcard-name">
            {chosen.restaurant_name}
            {chosen.demo && <span className="demotag">Sample</span>}
          </span>
          <span className="zcard-sub">{chosen.address}</span>
          {chosen.pickup_note && (
            <span className="zcard-meta open">{chosen.pickup_note}</span>
          )}

          {/* No second question. The suggestion is the closest zone that still
              needs food, which is the right answer almost every time -- and
              when it is not, every stop on the route screen has a Change. */}
          {suggested && (
            <span className="dropsto">
              <span className="ss-label pick-label">Drops at</span>
              <span className="dropsto-zone">{suggested.zone.name}</span>
              <span className="dropsto-sub">
                {corner(suggested.zone.landmark.a, suggested.zone.landmark.b)}
                {suggested.distance != null ? ` · ${prettyDistance(suggested.distance)} away` : ""}
                {suggested.short > 0 ? ` · ${fmt(suggested.short)} short` : " · already covered"}
              </span>
            </span>
          )}

          <Button
            fullWidth
            disabled={!suggested || busy !== null}
            disabledReason={!suggested ? "No zone needs food right now" : undefined}
            onClick={() => suggested && void take(suggested.zone.id)}
          >
            {busy ? `Adding to ${activeRoute().label}…` : `Add to ${activeRoute().label}`}
          </Button>

          <span className="pick-help">You can change where it goes on your route.</span>
        </div>
      ) : (
        <div className="pickuplist">
          {open.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pickuprow"
              onClick={() => setSelected(p.id)}
            >
              <span className="ss-label pickup-when">
                {windowLabel(p.pickup_from, p.pickup_to)}
              </span>
              <span className="pickuprow-text">
                <span className="pickuprow-name">
                  {p.restaurant_name}
                  {p.demo && <span className="demotag">Sample</span>}
                </span>
                <span className="pickuprow-sub">{p.address}</span>
              </span>
              <span className="ss-num pickuprow-qty">~{fmt(p.quantity)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
