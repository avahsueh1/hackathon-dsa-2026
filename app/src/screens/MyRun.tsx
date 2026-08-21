import { useMemo, useState } from "react";
import type { Offer, ZoneStats } from "../types";
import { deliverOffer, releaseOffer, routeOffer } from "../lib/store";
import { ZONES, byUrgency, isCovered, stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import ZoneMap from "../components/ZoneMap";
import ProgressRing from "../components/ProgressRing";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";

/**
 * The run in progress: collect from here, then choose where it goes.
 *
 * Choosing the destination is the volunteer's job and the reason the product
 * is split in two -- a kitchen cannot know which corner is short at 10pm, but
 * someone holding the food and looking at the map can. Zones are ordered by
 * what they still need, so the obvious choice is the top one.
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

  const mine = useMemo(
    () =>
      offers.filter(
        (o) => o.status === "accepted" && (!volunteer || o.volunteer_name === volunteer),
      ),
    [offers, volunteer],
  );

  const run = mine[0] ?? null;

  const ranked = useMemo(() => byUrgency(stats, ZONES.zones), [stats]);

  if (!run) {
    return (
      <div className="dropempty">
        <EmptyState
          headline="No run in progress."
          detail="Take a pickup and it appears here, with the map for choosing where it goes."
          actionLabel="Find a pickup"
          onAction={onFindWork}
        />
      </div>
    );
  }

  const chosen = run.zone_id ? (ZONES.zones.find((z) => z.id === run.zone_id) ?? null) : null;

  return (
    <div className="runscreen">
      {/* Step one: where you are collecting from. */}
      <div className="runhead">
        <div className="mapsel-line">
          <StatusPill status="unconfirmed">Collecting</StatusPill>
          <span className="mapsel-name">{run.restaurant_name}</span>
        </div>
        <span className="mapsel-sub">
          {run.address} · {windowLabel(run.pickup_from, run.pickup_to)} · ~{fmt(run.quantity)}{" "}
          {plural(run.quantity, "meal")} of {run.food_type.toLowerCase()}
        </span>
        {run.notes && <span className="mapsel-sub">{run.notes}</span>}
      </div>

      {/* Step two: where it goes. */}
      <div className="runpick">
        <span className="ss-label pick-label">
          {chosen ? "Dropping at" : "Where does it go? Most short first."}
        </span>
      </div>

      <div className="runzones">
        {ranked.slice(0, 4).map((z) => {
          const short = stillNeeded(stats, z);
          const on = run.zone_id === z.id;
          return (
            <button
              key={z.id}
              type="button"
              className={`runzone${on ? " on" : ""}`}
              onClick={() => void routeOffer(run.id, z.id)}
            >
              {/* How far THIS run goes towards that zone's remaining need --
                  the number that tells a driver where their load matters most. */}
              <ProgressRing
                value={short <= 0 ? 1 : Math.min(1, run.quantity / short)}
                covered={isCovered(stats, z)}
                size={34}
              />
              <span className="runzone-text">
                <span className="runzone-name">{z.name}</span>
                <span className="runzone-sub">
                  {corner(z.landmark.a, z.landmark.b)} ·{" "}
                  {short > 0
                    ? `${fmt(short)} short · your run covers ${Math.min(100, Math.round((run.quantity / short) * 100))}%`
                    : "already covered"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="runmap">
        <ZoneMap
          zones={ZONES.zones}
          stats={stats}
          focus={chosen}
          onSelect={(id) => void routeOffer(run.id, id)}
        />
      </div>

      <div className="runactions">
        {chosen ? (
          <Button
            variant="covered"
            fullWidth
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deliverOffer(run.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : `Delivered to ${ZONE_NAME.get(chosen.id)}`}
          </Button>
        ) : (
          <Button fullWidth disabled disabledReason="Tap a zone above, or on the map">
            Choose a drop-off zone
          </Button>
        )}
        <Button variant="quiet" size="md" fullWidth onClick={() => void releaseOffer(run.id)}>
          Hand this run back
        </Button>
      </div>
    </div>
  );
}
