import { useMemo, useState } from "react";
import type { Offer, ZoneStats } from "../types";
import { deliverAll, releaseOffer, routeAll } from "../lib/store";
import { ZONES, byUrgency, isCovered, stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import ZoneMap from "../components/ZoneMap";
import PickupMap from "../components/PickupMap";
import ProgressRing from "../components/ProgressRing";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

/**
 * The route: every stop you have taken, in the order you would drive them,
 * and then one decision about where the whole load goes.
 *
 * That last decision is the reason the product is split in two -- a kitchen
 * cannot know which corner is short at 10pm, but someone holding the food and
 * looking at the map can. Zones are ordered by what they still need, so the
 * obvious answer is at the top and the map is for when it is not obvious.
 *
 * One zone per route on purpose. A driver fills the car and empties it;
 * splitting a load across neighbourhoods is a second route, not a second
 * field on this screen.
 */

const ZONE_NAME = new Map(ZONES.zones.map((z) => [z.id, z.name]));

interface Props {
  offers: Offer[];
  stats: ZoneStats;
  volunteer: string | null;
  onFindWork: () => void;
}

export default function MyRun({ offers, stats, volunteer, onFindWork }: Props) {
  const [busy, setBusy] = useState(false);
  const [showZoneMap, setShowZoneMap] = useState(false);

  const stops = useMemo(
    () =>
      offers
        .filter((o) => o.status === "accepted" && (!volunteer || o.volunteer_name === volunteer))
        .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from)),
    [offers, volunteer],
  );

  const load = stops.reduce((a, o) => a + o.quantity, 0);
  const ranked = useMemo(() => byUrgency(stats, ZONES.zones), [stats]);

  // Any stop already routed sets the destination for the run.
  const zoneId = stops.find((o) => o.zone_id)?.zone_id ?? null;
  const chosen = zoneId ? (ZONES.zones.find((z) => z.id === zoneId) ?? null) : null;

  if (stops.length === 0) {
    return (
      <div className="dropempty">
        <EmptyState
          headline="No route yet."
          detail="Add stops from the Pickups map and they appear here, in the order you would drive them."
          actionLabel="Find pickups"
          onAction={onFindWork}
        />
      </div>
    );
  }

  return (
    <div className="runscreen">
      <div className="runhead">
        <span className="ss-label pick-label">Your route</span>
        <span className="runhead-big">
          {stops.length} {plural(stops.length, "stop")} · ~{fmt(load)} meals
        </span>
      </div>

      <PickupMap offers={[]} route={stops} selectedId={null} onSelect={() => {}} />

      <div className="stoplist">
        {stops.map((o, i) => (
          <div key={o.id} className="stoprow">
            <span className="stopnum">{i + 1}</span>
            <span className="stoprow-text">
              <span className="stoprow-name">{o.restaurant_name}</span>
              <span className="stoprow-sub">
                {windowLabel(o.pickup_from, o.pickup_to)} · {o.address}
              </span>
              {o.notes && <span className="stoprow-sub">{o.notes}</span>}
            </span>
            <span className="ss-num stoprow-qty">~{fmt(o.quantity)}</span>
            <Button variant="quiet" size="md" onClick={() => void releaseOffer(o.id)}>
              Drop
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="md" fullWidth onClick={onFindWork}>
          Add another stop
        </Button>
      </div>

      <div className="runpick">
        <span className="ss-label pick-label">
          {chosen ? "Dropping the whole load at" : "Where does it all go? Most short first."}
        </span>
      </div>

      <div className="runzones">
        {ranked.slice(0, 4).map((z) => {
          const short = stillNeeded(stats, z);
          const on = zoneId === z.id;
          return (
            <button
              key={z.id}
              type="button"
              className={`runzone${on ? " on" : ""}`}
              onClick={() => void routeAll(stops.map((s) => s.id), z.id)}
            >
              {/* How far THIS load goes towards that zone's remaining need --
                  the number that says where the car matters most. */}
              <ProgressRing
                value={short <= 0 ? 1 : Math.min(1, load / short)}
                covered={isCovered(stats, z)}
                size={34}
              />
              <span className="runzone-text">
                <span className="runzone-name">{z.name}</span>
                <span className="runzone-sub">
                  {corner(z.landmark.a, z.landmark.b)} ·{" "}
                  {short > 0
                    ? `${fmt(short)} short · your load covers ${Math.min(100, Math.round((load / short) * 100))}%`
                    : "already covered"}
                </span>
              </span>
            </button>
          );
        })}

        <Button
          variant="quiet"
          size="md"
          fullWidth
          onClick={() => setShowZoneMap((v) => !v)}
        >
          {showZoneMap ? "Hide the zone map" : "See all eight zones on the map"}
        </Button>
      </div>

      {showZoneMap && (
        <div className="runmap">
          <ZoneMap
            zones={ZONES.zones}
            stats={stats}
            focus={chosen}
            onSelect={(id) => void routeAll(stops.map((s) => s.id), id)}
          />
        </div>
      )}

      <div className="runactions">
        {chosen ? (
          <Button
            variant="covered"
            fullWidth
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deliverAll(stops.map((s) => s.id));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Saving…"
              : `Delivered ${stops.length} ${plural(stops.length, "stop")} to ${ZONE_NAME.get(chosen.id)}`}
          </Button>
        ) : (
          <Button fullWidth disabled disabledReason="Pick a zone above, or open the map">
            Choose where the load goes
          </Button>
        )}
      </div>
    </div>
  );
}
