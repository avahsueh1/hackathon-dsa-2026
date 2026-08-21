import { useMemo } from "react";
import Button from "../components/Button";
import ZoneMap from "../components/ZoneMap";
import type { ZoneStats } from "../types";
import { ZONES, totals } from "../lib/zones";
import { fmt } from "../lib/format";

interface Props {
  stats: ZoneStats;
  onEnter: () => void;
  onRegister: () => void;
  onDemo: () => void;
}

export default function Landing({ stats, onEnter, onRegister, onDemo }: Props) {
  const t = useMemo(() => totals(stats), [stats]);

  return (
    <div className="landing">
      <nav className="lnav">
        <span className="lmark">
          Surplus <span className="larrow">→</span> Street
        </span>
        <Button variant="secondary" size="md" onClick={onEnter}>
          Open the board
        </Button>
      </nav>

      <header className="lhero">
        <h1>Downtown throws away good food every night. This says where to take it.</h1>
        <p className="llede">
          There are <strong>{t.open} open zones</strong> tonight, about{" "}
          <strong>{fmt(t.short)} meals</strong> short. Claim one and everyone else can
          see someone is going.
        </p>

        {/* The real downtown, coloured by tonight's real coverage. A list of
            cross-streets means nothing to someone who has not seen the app;
            the shape of the city does. */}
        <div className="lpreview">
          <div className="lmap">
            <ZoneMap zones={ZONES.zones} stats={stats} interactive={false} />
          </div>
          <div className="lfoot">
            <span className={`statuspill${t.open === 0 ? " covered" : ""}`}>
              {t.covered} of {t.total} covered
            </span>
            <span className="fineprint">tonight, live</span>
          </div>
        </div>

        <div className="lcta">
          <Button fullWidth onClick={onRegister}>
            Register your restaurant
          </Button>
          <Button variant="secondary" fullWidth onClick={onDemo}>
            See what happens
          </Button>
          <Button variant="quiet" fullWidth onClick={onEnter}>
            Just show me tonight&rsquo;s board
          </Button>
        </div>
        <p className="fineprint">Free for restaurants. No app to install.</p>
      </header>

      <section className="lsection">
        <span className="eyebrow">How it works</span>
        <ol className="lsteps">
          <li className="lstep">
            <span className="lstepnum">1</span>
            <span className="lsteptitle">Claim a zone</span>
            <span className="lstepbody">
              One tap. The zone turns from amber to mint, and everyone else can see
              someone is going.
            </span>
          </li>
          <li className="lstep">
            <span className="lstepnum">2</span>
            <span className="lsteptitle">Bring what you have</span>
            <span className="lstepbody">
              Say roughly how many servings. Nobody counts hotel pans exactly at 10pm.
            </span>
          </li>
          <li className="lstep">
            <span className="lstepnum">3</span>
            <span className="lsteptitle">It writes your log</span>
            <span className="lstepbody">
              Every drop lands in your SB 1383 record. Download the month when the city
              asks.
            </span>
          </li>
        </ol>
      </section>

      <section className="lsection">
        <span className="eyebrow">Zones, not people</span>
        <h2 className="lh2">We never plot a person.</h2>
        <p className="lbody">
          The map shows zones, and the colours describe our coverage gaps — not where
          anyone sleeps. Amber does not mean danger and it does not mean people. It
          means no restaurant has claimed that zone yet.
        </p>
        <p className="fineprint">{ZONES.basis}</p>
      </section>

      <footer className="lfooter">
        <span>Surplus → Street · Downtown San Diego</span>
        <span>We coordinate food; we don't categorize people.</span>
      </footer>
    </div>
  );
}
