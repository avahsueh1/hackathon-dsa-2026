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

  return (
    <div className="mapscreen">
      <ZoneRail zones={ZONES.zones} stats={stats} selectedId={selectedId} onSelect={onSelect} compact />

      <ZoneMap zones={ZONES.zones} stats={stats} focus={focus} onSelect={onSelect} />

      {focus && (
        <div className="mapsel">
          <div className="mapsel-text">
            <div className="mapsel-line">
              <StatusPill status={isCovered(stats, focus) ? "covered" : "open"} />
              <span className="mapsel-name">{focus.name}</span>
            </div>
            <span className="mapsel-sub">
              {corner(focus.landmark.a, focus.landmark.b)} ·{" "}
              {isCovered(stats, focus)
                ? `~${fmt(mealsFor(stats, focus))} ${plural(mealsFor(stats, focus), "serving")} coming`
                : `~${fmt(stillNeeded(stats, focus))} still needed`}
            </span>
            {going.length > 0 && (
              <span className="mapsel-sub">
                {going.length === 1
                  ? `${going[0].restaurant_name} is going`
                  : `${going[0].restaurant_name} and ${going.length - 1} other${
                      going.length > 2 ? "s" : ""
                    } are going`}
              </span>
            )}
          </div>
          <Button
            variant={isCovered(stats, focus) ? "secondary" : "primary"}
            fullWidth
            onClick={() => onClaim(focus)}
          >
            {isCovered(stats, focus) ? "Add to this drop" : "Claim this zone"}
          </Button>
        </div>
      )}
    </div>
  );
}
