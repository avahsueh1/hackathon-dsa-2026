import type { Claim, Zone, ZoneStats } from "../types";
import type { NeedLevel } from "../components/StatusPill";
import { ZONES, byUrgency, isCovered, stillNeeded } from "../lib/zones";
import { fmt } from "../lib/format";
import ZoneRail from "../components/ZoneRail";
import ZoneCard from "../components/ZoneCard";

interface Props {
  claims: Claim[];
  stats: ZoneStats;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClaim: (z: Zone) => void;
}

export default function Tonight({ claims, stats, selectedId, onSelect, onClaim }: Props) {
  const ordered = byUrgency(stats, ZONES.zones);

  // "Highest need" is a single zone, not a band: the one open zone with the
  // most still unclaimed. Marking three zones highest tells a driver nothing.
  const worst = ordered.find((z) => !isCovered(stats, z));

  const needOf = (z: Zone): NeedLevel =>
    z.id === worst?.id ? "highest" : z.band === "high" ? "high" : "steady";

  return (
    <>
      <ZoneRail zones={ZONES.zones} stats={stats} selectedId={selectedId} onSelect={onSelect} />

      <div className="cardlist">
        {ordered.map((z) => (
          <ZoneCard
            key={z.id}
            zone={z}
            claims={claims}
            stats={stats}
            need={needOf(z)}
            selected={z.id === selectedId}
            onClaim={onClaim}
          />
        ))}

        <p className="fineprint">
          {ZONES.privacy} Need is what a zone is expected to want tonight, minus what
          restaurants have already claimed &mdash; currently{" "}
          {fmt(stillNeeded(stats, ordered[0]))} in the zone at the top.
        </p>
      </div>
    </>
  );
}
