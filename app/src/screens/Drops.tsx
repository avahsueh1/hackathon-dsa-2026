import { useMemo, useState } from "react";
import type { Claim } from "../types";
import { cancelClaim } from "../lib/store";
import { fmt, prettyDate } from "../lib/format";
import { LBS_PER_MEAL } from "../lib/food";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import { Hero } from "../components/MobileShell";

// California SB 1383 requires large food businesses to keep a donation record.
// This screen is that record -- which is why cancelling sets a status rather
// than deleting a row.

interface Props {
  claims: Claim[];
  onGoTonight: () => void;
}

export default function Drops({ claims, onGoTonight }: Props) {
  const [exported, setExported] = useState(false);

  const active = useMemo(() => claims.filter((c) => c.status !== "cancelled"), [claims]);
  const meals = active.reduce((a, c) => a + c.meals, 0);
  const lbs = Math.round(meals * LBS_PER_MEAL);

  function exportCsv() {
    const rows = [
      ["date", "zone", "restaurant", "servings", "est_lbs", "window", "food", "status"],
      ...claims.map((c) => [
        c.drop_date,
        c.zone_name,
        c.donor_name ?? "",
        String(c.meals),
        String(Math.round(c.meals * LBS_PER_MEAL)),
        c.drop_window,
        c.food_description ?? "",
        c.status,
      ]),
    ];
    const csv = rows
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
      <Hero label="Meals delivered" value={fmt(meals)} unit={`in ${active.length} drops`} />

      <div className="dropstats">
        <span className="ss-num dropstat">{fmt(lbs)} lbs diverted</span>
        <span className="dropstat muted">Your SB 1383 record</span>
      </div>

      <div className="dropexport">
        <Button variant="covered" fullWidth onClick={exportCsv} disabled={claims.length === 0}>
          Download this month&rsquo;s log
        </Button>
        {exported && <p className="dropdone">◉ Downloaded — surplus-street-log.csv</p>}
      </div>

      {claims.length ? (
        <div className="droplist">
          {claims.map((c) => (
            <div key={c.id} className={`droprow${c.status === "cancelled" ? " off" : ""}`}>
              <div className="droprow-top">
                <span className="drop-zone">{c.zone_name}</span>
                <span className="ss-num drop-meals">~{fmt(c.meals)}</span>
              </div>
              <span className="drop-meta">
                {[c.food_description, c.donor_name, c.drop_window].filter(Boolean).join(" · ")}
              </span>
              <span className="ss-num drop-sub">
                {prettyDate(c.drop_date)} · {Math.round(c.meals * LBS_PER_MEAL)} lbs
              </span>
              {c.status === "cancelled" ? (
                <span className="drop-cancelled">Cancelled — kept for the record</span>
              ) : (
                <div>
                  <Button variant="danger" size="md" onClick={() => void cancelClaim(c.id)}>
                    Cancel this drop
                  </Button>
                </div>
              )}
            </div>
          ))}
          <p className="fineprint">
            Every row, including cancelled ones, stays in the file. A compliance log with
            rows silently missing is worse than no log.
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
