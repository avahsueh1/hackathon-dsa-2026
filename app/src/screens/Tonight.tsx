import type { Claim, Zone } from "../types";
import type { NeedLevel } from "../components/StatusPill";
import { ZONES, byUrgency, isCovered, stillNeeded, totals } from "../lib/zones";
import { fmt } from "../lib/format";
import ZoneRail from "../components/ZoneRail";
import ZoneCard from "../components/ZoneCard";
import Button from "../components/Button";
import { Hero } from "../components/MobileShell";

interface Props {
  claims: Claim[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClaim: (z: Zone) => void;
  onOpenMap: () => void;
}

export default function Tonight({ claims, selectedId, onSelect, onClaim, onOpenMap }: Props) {
  const t = totals(claims);
  const ordered = byUrgency(claims, ZONES.zones);

  // "Highest need" is a single zone, not a band: the one open zone with the
  // most still unclaimed. Marking three zones highest tells a driver nothing.
  const worst = ordered.find((z) => !isCovered(claims, z));

  const needOf = (z: Zone): NeedLevel =>
    z.id === worst?.id ? "highest" : z.band === "high" ? "high" : "steady";

  return (
    <>
      <ZoneRail zones={ZONES.zones} claims={claims} selectedId={selectedId} onSelect={onSelect} />

      <Hero
        label="Still unclaimed"
        value={fmt(t.short)}
        unit={`of ~${fmt(t.expected)} meals`}
        right={
          <Button variant="quiet" size="md" onClick={onOpenMap} style={{ whiteSpace: "nowrap" }}>
            See the map
          </Button>
        }
      />

      <div className="countrow">
        <span className="ss-label countrow-l">
          {t.open} open &middot; {t.covered} covered
        </span>
        <span className="countrow-r ss-num">{fmt(t.claimed)} claimed so far</span>
      </div>

      <div className="cardlist">
        {ordered.map((z) => (
          <ZoneCard
            key={z.id}
            zone={z}
            claims={claims}
            need={needOf(z)}
            selected={z.id === selectedId}
            onClaim={onClaim}
          />
        ))}

        <p className="fineprint">
          {ZONES.privacy} Need is what a zone is expected to want tonight, minus what
          restaurants have already claimed &mdash; currently{" "}
          {fmt(stillNeeded(claims, ordered[0]))} in the zone at the top.
        </p>
      </div>
    </>
  );
}
