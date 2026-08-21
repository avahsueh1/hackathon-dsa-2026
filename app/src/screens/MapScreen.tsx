import type { ZoneStats } from "../types";
import { ZONES, isCovered, mealsFor, stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, plural } from "../lib/format";
import ZoneMap from "../components/ZoneMap";
import ZoneRail from "../components/ZoneRail";
import StatusPill from "../components/StatusPill";

/**
 * Where the need is tonight. Read-only on purpose: under the split, food is
 * routed to a zone from a run you are already holding, not claimed out of
 * thin air from a map. This screen answers "where should I take it?" before
 * you have anything to take.
 */

interface Props {
  stats: ZoneStats;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function MapScreen({ stats, selectedId, onSelect }: Props) {
  const focus = ZONES.zones.find((z) => z.id === selectedId) ?? null;
  const covered = focus ? isCovered(stats, focus) : false;

  return (
    <div className="mapscreen">
      <ZoneRail zones={ZONES.zones} stats={stats} selectedId={selectedId} onSelect={onSelect} compact />

      <ZoneMap zones={ZONES.zones} stats={stats} focus={focus} onSelect={onSelect} />

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
          </span>
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
