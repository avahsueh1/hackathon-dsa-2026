import type { CSSProperties } from "react";
import type { Claim, Zone, ZoneStats } from "../types";
import { claimsFor, coverage, expectedFor, isCovered, mealsFor } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import StatusPill, { type NeedLevel } from "./StatusPill";
import Button from "./Button";

/** The workhorse. One zone, its status, and one action. */

interface Props {
  zone: Zone;
  claims: Claim[];
  stats: ZoneStats;
  need?: NeedLevel;
  selected?: boolean;
  onClaim: (z: Zone) => void;
  style?: CSSProperties;
}

export default function ZoneCard({ zone, claims, stats, need = "steady", selected, onClaim, style }: Props) {
  const mine = claimsFor(claims, zone.id);
  const meals = mealsFor(stats, zone);
  const expected = expectedFor(stats, zone);
  const covered = isCovered(stats, zone);
  const pct = Math.round(coverage(stats, zone) * 100);
  // claims come back newest first, so the most recent is at the head.
  const lead = mine.length ? mine[0] : null;

  return (
    <div
      className="zcard"
      style={{
        ...(selected ? { outline: "2px solid var(--blue)", outlineOffset: 2 } : null),
        ...style,
      }}
    >
      <div className="zcard-top">
        <StatusPill status={covered ? "covered" : "open"} need={covered ? undefined : need} />
        <span className="zcard-need">~{fmt(expected)} expected</span>
      </div>

      <div className="zcard-body">
        <span className="zcard-title">{zone.name}</span>
        <span className="zcard-sub">
          {corner(zone.landmark.a, zone.landmark.b)} · {zone.block_count} blocks
          {zone.services.shelters ? ` · ${zone.services.shelters} shelters` : ""}
        </span>
        {covered && lead ? (
          <span className="ss-num zcard-meta">
            {[
              lead.restaurant_name || "A restaurant",
              `~${fmt(meals)} ${plural(meals, "serving")}`,
              lead.drop_window ? `arriving ${lead.drop_window.replace(/^Tonight,\s*/, "")}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : (
          <span className="zcard-meta open">
            {meals > 0 ? `~${fmt(meals)} of ~${fmt(expected)} claimed` : "Nobody claimed this yet"}
          </span>
        )}
      </div>

      <div className="zprog">
        <div className="zprog-top">
          <span className={`ss-label zprog-pct${covered ? "" : " open"}`}>{pct}% covered</span>
          <span className="zcard-need">of ~{fmt(expected)} needed</span>
        </div>
        <div className="ztrack">
          <span className={covered ? "" : "open"} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Button variant={covered ? "secondary" : "primary"} fullWidth onClick={() => onClaim(zone)}>
        {covered ? "Add to this drop" : "Claim this zone"}
      </Button>
    </div>
  );
}
