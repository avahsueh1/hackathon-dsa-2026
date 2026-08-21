import { useMemo, useState } from "react";
import type { Claim } from "../types";
import { cancelClaim, markDelivered } from "../lib/store";
import { hasBackend } from "../lib/supabase";
import { ZONES } from "../lib/zones";
import { fmt, plural, prettyDate } from "../lib/format";
import { LBS_PER_MEAL } from "../lib/food";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import { Hero } from "../components/MobileShell";

// California SB 1383 requires large food businesses to keep a donation record.
// This screen is that record -- which is why cancelling sets a status rather
// than deleting a row, matching the backend's deliberate lack of a DELETE
// policy.

const ZONE_NAME = new Map(ZONES.zones.map((z) => [z.id, z.name]));

interface Props {
  claims: Claim[];
  mine: string | null;
  onGoTonight: () => void;
}

export default function Drops({ claims, mine, onGoTonight }: Props) {
  const [exported, setExported] = useState(false);

  // The board is shared and has no accounts, so "my drops" is the claims
  // posted under this browser's registered business name. Without a
  // registration there is nothing to filter by, so it shows the whole board.
  const rows = useMemo(
    () => (mine ? claims.filter((c) => c.restaurant_name === mine) : claims),
    [claims, mine],
  );

  const active = useMemo(() => rows.filter((c) => c.status !== "cancelled"), [rows]);
  const meals = active.reduce((a, c) => a + c.quantity, 0);
  const lbs = Math.round(meals * LBS_PER_MEAL);

  const zoneName = (c: Claim) => ZONE_NAME.get(c.zone_id) ?? c.zone_id;

  function exportCsv() {
    const header = ["date", "zone", "restaurant", "servings", "est_lbs", "food", "window", "status"];
    const body = rows.map((c) => [
      c.created_at.slice(0, 10),
      zoneName(c),
      c.restaurant_name,
      String(c.quantity),
      String(Math.round(c.quantity * LBS_PER_MEAL)),
      c.food ?? "",
      c.drop_window ?? "",
      c.status,
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "surplus-street-log.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <>
      <Hero label="Meals delivered" value={fmt(meals)} unit={`in ${active.length} ${plural(active.length, "drop")}`} />

      <div className="dropstats">
        <span className="ss-num dropstat">{fmt(lbs)} lbs diverted</span>
        <span className="dropstat muted">
          {mine ? `${mine} · your SB 1383 record` : "Every drop on the board"}
        </span>
      </div>

      <div className="dropexport">
        <Button variant="covered" fullWidth onClick={exportCsv} disabled={rows.length === 0}>
          Download this month&rsquo;s log
        </Button>
        {exported && <p className="dropdone">◉ Downloaded — surplus-street-log.csv</p>}
      </div>

      {rows.length ? (
        <div className="droplist">
          {rows.map((c) => (
            <div key={c.id} className={`droprow${c.status === "cancelled" ? " off" : ""}`}>
              <div className="droprow-top">
                <span className="drop-zone">{zoneName(c)}</span>
                <span className="ss-num drop-meals">~{fmt(c.quantity)}</span>
              </div>
              <span className="drop-meta">
                {[c.restaurant_name, c.food, c.drop_window].filter(Boolean).join(" · ")}
              </span>
              <span className="ss-num drop-sub">
                {prettyDate(c.created_at.slice(0, 10))} ·{" "}
                {Math.round(c.quantity * LBS_PER_MEAL)}{" "}
                {plural(Math.round(c.quantity * LBS_PER_MEAL), "lb")}
                {c.status === "delivered" ? " · delivered" : ""}
              </span>

              {c.status === "cancelled" ? (
                <span className="drop-cancelled">Cancelled — kept for the record</span>
              ) : (
                <div className="droprow-actions">
                  {c.status === "claimed" && (
                    <Button variant="secondary" size="md" onClick={() => void markDelivered(c.id)}>
                      Mark delivered
                    </Button>
                  )}
                  <Button variant="danger" size="md" onClick={() => void cancelClaim(c.id)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ))}

          <p className="fineprint">
            Every row, including cancelled ones, stays in the file. A compliance log with
            rows silently missing is worse than no log.
            {hasBackend
              ? " Food type and drop time are recorded on this device only — the shared board carries the business and the quantity."
              : ""}
          </p>
        </div>
      ) : (
        <div className="dropempty">
          <EmptyState
            headline="No drops yet."
            detail="Claim a zone on Tonight and it lands here, with the SB 1383 columns already filled in."
            actionLabel="Go to Tonight"
            onAction={onGoTonight}
          />
        </div>
      )}
    </>
  );
}
