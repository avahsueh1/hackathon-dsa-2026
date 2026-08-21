import type { CSSProperties } from "react";
import type { Claim, Zone } from "../types";
import { claimsFor, coverage, isCovered, mealsFor } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt } from "../lib/format";
import StatusPill, { type NeedLevel } from "./StatusPill";
import Button from "./Button";

/** The workhorse. One zone, its status, and one action. */

interface Props {
  zone: Zone;
  claims: Claim[];
  need?: NeedLevel;
  selected?: boolean;
  onClaim: (z: Zone) => void;
  style?: CSSProperties;
}

export default function ZoneCard({ zone, claims, need = "steady", selected, onClaim, style }: Props) {
  const mine = claimsFor(claims, zone.id);
  const meals = mealsFor(claims, zone.id);
  const covered = isCovered(claims, zone);
  const pct = Math.round(coverage(claims, zone) * 100);
  const lead = mine.length ? mine[mine.length - 1] : null;

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
        <span className="zcard-need">~{fmt(zone.expected_tonight)} expected</span>
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
              lead.donor_name || "A restaurant",
              `~${fmt(meals)} servings`,
              lead.drop_window ? `arriving ${lead.drop_window.replace(/^Tonight,\s*/, "")}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : (
          <span className="zcard-meta open">
            {meals > 0 ? `~${fmt(meals)} of ~${fmt(zone.expected_tonight)} claimed` : "Nobody claimed this yet"}
          </span>
        )}
      </div>

      <div className="zprog">
        <div className="zprog-top">
          <span className={`ss-label zprog-pct${covered ? "" : " open"}`}>{pct}% covered</span>
          <span className="zcard-need">of ~{fmt(zone.expected_tonight)} needed</span>
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
