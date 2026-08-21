import type { Claim, Zone } from "../types";
import { ZONES, isCovered, mealsFor, stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt } from "../lib/format";
import ZoneMap from "../components/ZoneMap";
import ZoneRail from "../components/ZoneRail";
import StatusPill from "../components/StatusPill";
import Button from "../components/Button";

interface Props {
  claims: Claim[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClaim: (z: Zone) => void;
}

export default function MapScreen({ claims, selectedId, onSelect, onClaim }: Props) {
  const focus = ZONES.zones.find((z) => z.id === selectedId) ?? null;

  return (
    <div className="mapscreen">
      <ZoneRail zones={ZONES.zones} claims={claims} selectedId={selectedId} onSelect={onSelect} />

      <ZoneMap zones={ZONES.zones} claims={claims} focus={focus} onSelect={onSelect} />

      {focus && (
        <div className="mapsel">
          <div className="mapsel-text">
            <StatusPill status={isCovered(claims, focus) ? "covered" : "open"} />
            <span className="mapsel-name">{focus.name}</span>
            <span className="mapsel-sub">
              {corner(focus.landmark.a, focus.landmark.b)} ·{" "}
              {isCovered(claims, focus)
                ? `~${fmt(mealsFor(claims, focus.id))} servings coming`
                : `~${fmt(stillNeeded(claims, focus))} still needed`}
            </span>
          </div>
          <Button
            variant={isCovered(claims, focus) ? "secondary" : "primary"}
            fullWidth
            onClick={() => onClaim(focus)}
          >
            {isCovered(claims, focus) ? "Add to this drop" : "Claim this zone"}
          </Button>
        </div>
      )}
    </div>
  );
}
