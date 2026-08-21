import type { Claim, Zone, ZoneStats } from "../types";
import { ZONES, claimsFor, isCovered, mealsFor, stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import ZoneMap from "../components/ZoneMap";
import ZoneRail from "../components/ZoneRail";
import StatusPill from "../components/StatusPill";
import Button from "../components/Button";

interface Props {
  claims: Claim[];
  stats: ZoneStats;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClaim: (z: Zone) => void;
}

export default function MapScreen({ claims, stats, selectedId, onSelect, onClaim }: Props) {
  const focus = ZONES.zones.find((z) => z.id === selectedId) ?? null;
  const going = focus ? claimsFor(claims, focus.id) : [];
  const covered = focus ? isCovered(stats, focus) : false;

  return (
    <div className="mapscreen">
      <ZoneRail zones={ZONES.zones} stats={stats} selectedId={selectedId} onSelect={onSelect} compact />

      <ZoneMap zones={ZONES.zones} stats={stats} focus={focus} onSelect={onSelect} />

      {/* Tapping a zone puts its claim button here, in the legend's place
          rather than stacked below it -- down there the tab bar cut it off. */}
      {focus ? (
        <div className="mapsel">
          <div className="mapsel-line">
            <StatusPill status={covered ? "covered" : "open"} />
            <span className="mapsel-name">{focus.name}</span>
          </div>
          <span className="mapsel-sub">
            {corner(focus.landmark.a, focus.landmark.b)} ·{" "}
            {covered
              ? `~${fmt(mealsFor(stats, focus))} ${plural(mealsFor(stats, focus), "serving")} coming`
              : `~${fmt(stillNeeded(stats, focus))} still needed`}
            {going.length > 0 ? ` · ${going[0].restaurant_name}` : ""}
            {going.length > 1 ? ` +${going.length - 1}` : ""}
          </span>
          <Button variant={covered ? "secondary" : "primary"} fullWidth onClick={() => onClaim(focus)}>
            {covered ? "Add to this drop" : "Claim this zone"}
          </Button>
        </div>
      ) : (
        <div className="maplegend">
          <span>
            <span style={{ color: "var(--mint-ink)" }}>◉</span> fully covered
          </span>
          <span>
            <span style={{ color: "var(--amber-ink)" }}>◐</span> partly covered
          </span>
          <span>
            <span style={{ color: "#FF9A73" }}>○</span> nobody going yet
          </span>
        </div>
      )}
    </div>
  );
}
