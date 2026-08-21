import { useMemo, useState } from "react";
import type { Pickup } from "../types";
import { cancelPickup } from "../lib/store";
import { ZONES } from "../lib/zones";
import { fmt, plural, prettyDate } from "../lib/format";
import { LBS_PER_MEAL, windowLabel } from "../lib/food";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { Hero } from "../components/MobileShell";

/**
 * What the restaurant gave away, and the file the city asks for.
 *
 * California SB 1383 requires large food businesses to keep a donation
 * record; this is it, which is why withdrawing an offer sets a status rather
 * than removing the row.
 */

const ZONE_NAME = new Map(ZONES.zones.map((z) => [z.id, z.name]));

interface Props {
  pickups: Pickup[];
  mine: string | null;
  onPost: () => void;
}

export default function RestaurantLog({ pickups, mine, onPost }: Props) {
  const [exported, setExported] = useState(false);

  const rows = useMemo(
    () => (mine ? pickups.filter((o) => o.restaurant_name === mine) : pickups),
    [pickups, mine],
  );

  // Only food that actually went out counts as donated.
  const delivered = rows.filter((o) => o.status === "delivered");
  const meals = delivered.reduce((a, o) => a + o.quantity, 0);
  const lbs = Math.round(meals * LBS_PER_MEAL);
  const pending = rows.filter((o) => o.status === "requested" || o.status === "claimed").length;

  function exportCsv() {
    const header = [
      "date", "restaurant", "servings", "est_lbs",
      "pickup_window", "status", "volunteer", "delivered_to_zone",
    ];
    const body = rows.map((o) => [
      o.created_at.slice(0, 10),
      o.restaurant_name,
      String(o.quantity),
      String(Math.round(o.quantity * LBS_PER_MEAL)),
      windowLabel(o.pickup_from, o.pickup_to),
      o.status,
      o.volunteer_name ?? "",
      o.zone_id ? (ZONE_NAME.get(o.zone_id) ?? o.zone_id) : "",
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "surplus-street-donations.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <>
      <Hero
        label="Meals donated"
        value={fmt(meals)}
        unit={`in ${delivered.length} ${plural(delivered.length, "drop")}`}
      />

      <div className="dropstats">
        <span className="ss-num dropstat">{fmt(lbs)} lbs diverted</span>
        <span className="dropstat muted">
          {pending > 0 ? `${pending} still to collect` : "Nothing outstanding"}
        </span>
      </div>

      <div className="dropexport">
        <Button variant="covered" fullWidth onClick={exportCsv} disabled={rows.length === 0}>
          Download the log (CSV)
        </Button>
        {exported && <p className="dropdone">◉ Downloaded — surplus-street-donations.csv</p>}
      </div>

      {rows.length ? (
        <div className="droplist">
          {rows.map((o) => (
            <div key={o.id} className={`droprow${o.status === "cancelled" ? " off" : ""}`}>
              <div className="droprow-top">
                <span className="drop-zone">~{fmt(o.quantity)} meals</span>
                <span className="ss-num drop-meals">
                  {Math.round(o.quantity * LBS_PER_MEAL)} {plural(Math.round(o.quantity * LBS_PER_MEAL), "lb")}
                </span>
              </div>

              <span className="drop-meta">
                Pickup {windowLabel(o.pickup_from, o.pickup_to)}
                {o.volunteer_name ? ` · ${o.volunteer_name}` : ""}
                {o.zone_id ? ` · to ${ZONE_NAME.get(o.zone_id) ?? o.zone_id}` : ""}
              </span>

              <span className="ss-num drop-sub">
                {prettyDate(o.created_at.slice(0, 10))} ·{" "}
                {Math.round(o.quantity * LBS_PER_MEAL)} {plural(Math.round(o.quantity * LBS_PER_MEAL), "lb")}
              </span>

              <div className="droprow-actions">
                <StatusPill
                  status={o.status === "delivered" ? "covered" : o.status === "claimed" ? "unconfirmed" : "open"}
                >
                  {o.status === "delivered"
                    ? "Delivered"
                    : o.status === "claimed"
                      ? `${o.volunteer_name ?? "A volunteer"} is collecting`
                      : o.status === "cancelled"
                        ? "Withdrawn"
                        : "Waiting for a volunteer"}
                </StatusPill>

                {o.status === "requested" && (
                  <Button variant="danger" size="md" onClick={() => void cancelPickup(o.id)}>
                    Withdraw
                  </Button>
                )}
              </div>
            </div>
          ))}

          <p className="fineprint">
            Withdrawn offers stay in the file. A compliance log with rows silently
            missing is worse than no log.
          </p>
        </div>
      ) : (
        <div className="dropempty">
          <EmptyState
            headline="Nothing posted yet."
            detail="Post what you have at the end of service and a volunteer will come and get it."
            actionLabel="Post surplus"
            onAction={onPost}
          />
        </div>
      )}
    </>
  );
}
