import { useMemo, useState } from "react";
import type { Pickup, ZoneStats } from "../types";
import { deliverPickup, releasePickup, reroutePickup } from "../lib/store";
import { forgetRoute, newRoute, routeOf, setActive, useRoutes } from "../lib/routes";
import { ZONES, suggestZones, prettyDistance } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural, prettyDate } from "../lib/format";
import { windowLabel } from "../lib/food";
import PickupMap from "../components/PickupMap";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

/**
 * Your routes. One card per trip.
 *
 * A route is one load of the car: collect from two or three kitchens, empty
 * it, come back out. A driver does several in an evening, and running them
 * together into one endless list makes it impossible to see what is in the
 * boot right now. So each route is a unit, with its own map, its own stops
 * and its own total.
 *
 * Each stop already knows where it is going -- that was chosen at pickup, and
 * the zone has been counting the food ever since. Changing it is still
 * possible per stop, because a zone can fill up while you are on the road.
 */

const ZONE = new Map(ZONES.zones.map((z) => [z.id, z]));

interface Props {
  pickups: Pickup[];
  stats: ZoneStats;
  volunteer: string | null;
  onFindWork: () => void;
}

export default function MyRun({ pickups, stats, volunteer, onFindWork }: Props) {
  const routes = useRoutes();
  const [busy, setBusy] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState<string | null>(null);
  // One open at a time. On a phone, three expanded routes is three maps and a
  // lot of scrolling to find the stop you are standing outside.
  const [open, setOpen] = useState<string | null>(null);
  // Cancelling hands food back to the feed, so it asks once rather than
  // firing on the first tap.
  const [confirming, setConfirming] = useState<string | null>(null);

  const mine = useMemo(
    () =>
      pickups
        .filter((p) => p.status === "claimed" && (!volunteer || p.volunteer_name === volunteer))
        .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from)),
    [pickups, volunteer],
  );

  // Stops taken before routes existed, or whose route was discarded, still
  // have to appear somewhere rather than vanish out of the car.
  const grouped = useMemo(() => {
    const byRoute = new Map<string, Pickup[]>();
    const loose: Pickup[] = [];
    for (const p of mine) {
      const id = routeOf(routes, p.id);
      if (!id || !routes.routes.some((r) => r.id === id)) {
        loose.push(p);
        continue;
      }
      byRoute.set(id, [...(byRoute.get(id) ?? []), p]);
    }
    return { byRoute, loose };
  }, [mine, routes]);

  const live = routes.routes.filter((r) => (grouped.byRoute.get(r.id) ?? []).length > 0);
  const pendingRoute =
    routes.active && !live.some((r) => r.id === routes.active)
      ? (routes.routes.find((x) => x.id === routes.active) ?? null)
      : null;

  if (mine.length === 0 && !pendingRoute) {
    return (
      <div className="dropempty">
        <EmptyState
          headline="No routes yet."
          detail="Take a pickup from the map and it starts a route, with where it is going already decided."
          actionLabel="Find pickups"
          onAction={onFindWork}
        />
      </div>
    );
  }

  function renderStop(p: Pickup) {
    const zone = p.zone_id ? ZONE.get(p.zone_id) : null;
    const open = rerouting === p.id;
    const options = open ? suggestZones(stats, { lat: p.lat, lng: p.lng }).slice(0, 4) : [];

    return (
      <div key={p.id} className="stopcard">
        <div className="stoprow">
          <span className="stoprow-text">
            <span className="stoprow-name">{p.restaurant_name}</span>
            <span className="stoprow-sub">
              {windowLabel(p.pickup_from, p.pickup_to)} · {p.address}
            </span>
            {p.pickup_note && <span className="stoprow-sub">{p.pickup_note}</span>}
          </span>
          <span className="ss-num stoprow-qty">~{fmt(p.quantity)}</span>
        </div>

        <div className="stopdrop">
          <span className="stopdrop-text">
            <span className="ss-label pick-label">Dropping at</span>
            <span className="stopdrop-zone">{zone ? zone.name : "not chosen"}</span>
          </span>
          <Button variant="quiet" size="md" onClick={() => setRerouting(open ? null : p.id)}>
            {open ? "Keep" : "Change"}
          </Button>
        </div>

        {open && (
          <div className="dropchoices">
            {options.map((s) => (
              <button
                key={s.zone.id}
                type="button"
                className={`runzone${p.zone_id === s.zone.id ? " on" : ""}`}
                onClick={() => {
                  void reroutePickup(p.id, s.zone.id);
                  setRerouting(null);
                }}
              >
                <span className="runzone-text">
                  <span className="runzone-name">{s.zone.name}</span>
                  <span className="runzone-sub">
                    {corner(s.zone.landmark.a, s.zone.landmark.b)}
                    {s.distance != null ? ` · ${prettyDistance(s.distance)} away` : ""}
                    {s.short > 0 ? ` · ${fmt(s.short)} short` : " · covered"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="stopactions">
          <Button
            variant="covered"
            size="md"
            disabled={busy === p.id}
            onClick={async () => {
              setBusy(p.id);
              try {
                await deliverPickup(p.id);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === p.id ? "Saving…" : "Dropped off"}
          </Button>
          <Button variant="quiet" size="md" onClick={() => void releasePickup(p.id)}>
            Hand back
          </Button>
        </div>
      </div>
    );
  }

  function renderRoute(id: string, label: string, created: string, stops: Pickup[]) {
    const load = stops.reduce((a, p) => a + p.quantity, 0);
    const zones = Array.from(
      new Set(stops.map((p) => (p.zone_id ? (ZONE.get(p.zone_id)?.name ?? p.zone_id) : "unset"))),
    );
    const lastTo = stops.reduce(
      (latest, p) => (p.pickup_to > latest ? p.pickup_to : latest),
      stops[0].pickup_to,
    );
    const isActive = routes.active === id;
    // The route being added to opens by default -- it is the one you are
    // working. The rest are a summary until asked for.
    const isOpen = (open ?? routes.active) === id;

    return (
      <section key={id} className={`routecard${isActive ? " active" : ""}`}>
        <button
          type="button"
          className="routehead"
          aria-expanded={isOpen}
          onClick={() => setOpen(isOpen ? "" : id)}
        >
          <span className="routehead-top">
            <span className="routelabel">
              {label}
              {isActive && <span className="nearesttag">Adding to this</span>}
            </span>
            <span className="ss-num runhead-date">{prettyDate(created.slice(0, 10))}</span>
          </span>
          <span className="routesummary">
            <span className="ss-num routesummary-n">
              {stops.length} {plural(stops.length, "stop")} · ~{fmt(load)} meals
            </span>
            <span className="routechev" aria-hidden="true">
              {isOpen ? "▾" : "▸"}
            </span>
          </span>
          {/* Who is actually on this route. Collapsed, "2 stops" does not tell
              you whether the one you are outside is on it. */}
          <span className="routestopnames">
            {stops.map((p) => p.restaurant_name).join(" → ")}
          </span>
          {isOpen && (
            <span className="runhead-sub">
              Collect {windowLabel(stops[0].pickup_from, lastTo)} · dropping at{" "}
              {zones.length === 1 ? zones[0] : `${zones.length} zones`}
            </span>
          )}
        </button>

        {isOpen && (
          <>
            <PickupMap pickups={[]} route={stops} stats={stats} selectedId={null} onSelect={() => {}} />
            <div className="routestops">{stops.map(renderStop)}</div>
            <div className="routestops routestops-tail">
              {!isActive && (
                <Button variant="quiet" size="md" fullWidth onClick={() => setActive(id)}>
                  Add new stops to {label}
                </Button>
              )}

              {confirming === id ? (
                <div className="stopactions">
                  <Button variant="quiet" size="md" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    disabled={busy === id}
                    onClick={async () => {
                      setBusy(id);
                      try {
                        // Every stop goes back on the board for someone else,
                        // and the zones stop counting food that is not coming.
                        for (const p of stops) await releasePickup(p.id);
                        if (id !== "loose") forgetRoute(id);
                        setConfirming(null);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === id
                      ? "Cancelling…"
                      : `Hand back ${stops.length} ${plural(stops.length, "stop")}`}
                  </Button>
                </div>
              ) : (
                <Button variant="danger" size="md" fullWidth onClick={() => setConfirming(id)}>
                  Cancel {label}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="routelist">
      <div className="routetop">
        {/* Count what is actually on screen: the loose group and a
            just-started empty route are both cards the driver can see. */}
        <span className="ss-label pick-label">
          {(() => {
            const shown = live.length + (grouped.loose.length > 0 ? 1 : 0) + (pendingRoute ? 1 : 0);
            return `${shown} ${plural(shown, "route")}`;
          })()}
        </span>
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            newRoute();
            onFindWork();
          }}
        >
          + New route
        </Button>
      </div>

      {live.map((r) => renderRoute(r.id, r.label, r.created_at, grouped.byRoute.get(r.id) ?? []))}

      {grouped.loose.length > 0 &&
        renderRoute("loose", "Earlier stops", grouped.loose[0].created_at, grouped.loose)}

      {/* A route the driver just started. Shown empty so "+ New route" visibly
          did something rather than looking like a dead button. */}
      {pendingRoute && (
        <section className="routecard active">
          <header className="routehead">
            <div className="routehead-top">
              <span className="routelabel">
                {pendingRoute.label}
                <span className="nearesttag">Adding to this</span>
              </span>
              <span className="ss-num runhead-date">
                {prettyDate(pendingRoute.created_at.slice(0, 10))}
              </span>
            </div>
            <span className="runhead-sub">Nothing on it yet.</span>
          </header>
          <div className="routestops">
            <Button variant="secondary" size="md" fullWidth onClick={onFindWork}>
              Find a pickup
            </Button>
            <Button
              variant="quiet"
              size="md"
              fullWidth
              onClick={() => forgetRoute(pendingRoute.id)}
            >
              Discard this route
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
