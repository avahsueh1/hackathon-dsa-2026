import { useMemo, useState } from "react";
import type { Pickup, ZoneStats } from "../types";
import { deliverPickup, releasePickup, reroutePickup } from "../lib/store";
import { ZONES, suggestZones, prettyDistance } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import PickupMap from "../components/PickupMap";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

/**
 * The route: every stop you have taken, in the order you would drive them.
 *
 * Each stop already knows where it is going -- that was chosen at pickup, and
 * the zone has been counting the food ever since. This screen is for driving
 * it: collect, drop, mark it done. Changing your mind is possible per stop,
 * because a zone can fill up while you are still on the road.
 */

const ZONE = new Map(ZONES.zones.map((z) => [z.id, z]));

interface Props {
  pickups: Pickup[];
  stats: ZoneStats;
  volunteer: string | null;
  onFindWork: () => void;
}

export default function MyRun({ pickups, stats, volunteer, onFindWork }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState<string | null>(null);

  const stops = useMemo(
    () =>
      pickups
        .filter((p) => p.status === "claimed" && (!volunteer || p.volunteer_name === volunteer))
        .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from)),
    [pickups, volunteer],
  );

  const load = stops.reduce((a, p) => a + p.quantity, 0);

  if (stops.length === 0) {
    return (
      <div className="dropempty">
        <EmptyState
          headline="No route yet."
          detail="Take a pickup from the map and it appears here, with where it is going already decided."
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

      <PickupMap pickups={[]} route={stops} selectedId={null} onSelect={() => {}} />

      <div className="stoplist">
        {stops.map((p, i) => {
          const zone = p.zone_id ? ZONE.get(p.zone_id) : null;
          const open = rerouting === p.id;
          const options = open
            ? suggestZones(stats, { lat: p.lat, lng: p.lng }).slice(0, 4)
            : [];

          return (
            <div key={p.id} className="stopcard">
              <div className="stoprow">
                <span className="stopnum">{i + 1}</span>
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
                <Button
                  variant="quiet"
                  size="md"
                  onClick={() => setRerouting(open ? null : p.id)}
                >
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
        })}

        <Button variant="secondary" size="md" fullWidth onClick={onFindWork}>
          Add another stop
        </Button>

        <p className="fineprint">
          These zones are already counting your food — nobody else will be sent to
          cover the same corner while you are on the road.
        </p>
      </div>
    </div>
  );
}
