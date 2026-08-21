import { useEffect, useMemo, useState } from "react";
import type { Pickup, ZoneStats } from "../types";
import { takePickup } from "../lib/store";
import { suggestZones, prettyDistance } from "../lib/zones";
import { activeRoute, assignToActive, useRoutes } from "../lib/routes";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import PickupMap from "../components/PickupMap";
import ProgressRing from "../components/ProgressRing";
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
  const routes = useRoutes();
  const [when, setWhen] = useState<When>("any");
  const [selected, setSelected] = useState<string | null>(null);
  // Two steps on purpose. Tapping a ping is asking "what is this?", not
  // "commit me to a destination" -- leading with four zone options answered a
  // question nobody had asked yet.
  const [step, setStep] = useState<"detail" | "destination">("detail");
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  // Closest-and-shortest first, recomputed for whichever pickup is selected.
  const suggestions = useMemo(
    () => (chosen ? suggestZones(stats, { lat: chosen.lat, lng: chosen.lng }).slice(0, 4) : []),
    [chosen, stats],
  );

  // A selection the filter just hid would leave the card describing a pickup
  // that is no longer on the map.
  useEffect(() => {
    if (selected && !open.some((p) => p.id === selected)) setSelected(null);
  }, [open, selected]);

  // Default to the suggestion, and never carry the previous pickup's choice --
  // or the previous pickup's step -- over to the next one.
  useEffect(() => {
    setZoneId(suggestions[0]?.zone.id ?? null);
    setStep("detail");
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalMeals = open.reduce((a, p) => a + p.quantity, 0);

  async function take() {
    if (!chosen || !zoneId) return;
    if (!volunteer) return onNeedName();
    setBusy(true);
    try {
      await takePickup(chosen.id, volunteer, zoneId);
      // Joins whichever route is open, creating the first one on demand so a
      // driver never has to start a route before they can take anything.
      assignToActive(chosen.id);
      setSelected(null);
      onAccepted();
    } finally {
      setBusy(false);
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
          <span className="ss-label">
            ▸ {routes.routes.length > 1 ? `${routes.routes.length} routes` : activeRoute().label} ·{" "}
            {route.length} {plural(route.length, "stop")} ·{" "}
            {fmt(route.reduce((a, p) => a + p.quantity, 0))} meals
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

          {step === "detail" ? (
            <Button fullWidth onClick={() => setStep("destination")}>
              Add to route
            </Button>
          ) : (
            <>
              <span className="ss-label pick-label dropq">
                Where do you want to drop it off?
              </span>

              <div className="dropchoices">
                {suggestions.map((s, i) => {
                  const on = zoneId === s.zone.id;
                  return (
                    <button
                      key={s.zone.id}
                      type="button"
                      className={`runzone${on ? " on" : ""}`}
                      onClick={() => setZoneId(s.zone.id)}
                    >
                      <ProgressRing
                        value={s.short <= 0 ? 1 : Math.min(1, chosen.quantity / s.short)}
                        covered={s.short <= 0}
                        size={32}
                      />
                      <span className="runzone-text">
                        <span className="runzone-name">
                          {s.zone.name}
                          {i === 0 && <span className="nearesttag">Suggested</span>}
                        </span>
                        <span className="runzone-sub">
                          {corner(s.zone.landmark.a, s.zone.landmark.b)}
                          {s.distance != null ? ` · ${prettyDistance(s.distance)} away` : ""}
                          {s.short > 0 ? ` · ${fmt(s.short)} short` : " · already covered"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="stopactions">
                <Button variant="quiet" size="md" onClick={() => setStep("detail")}>
                  Back
                </Button>
                <Button
                  disabled={!zoneId || busy}
                  disabledReason={!zoneId ? "Pick where it goes first" : undefined}
                  onClick={() => void take()}
                >
                  {busy ? "Adding…" : `Add to ${activeRoute().label}`}
                </Button>
              </div>
            </>
          )}
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
