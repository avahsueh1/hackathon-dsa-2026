import { useMemo } from "react";
import Button from "../components/Button";
import type { ZoneStats } from "../types";
import { ZONES, isCovered, stillNeeded, totals } from "../lib/zones";
import { corner } from "../lib/streets";
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

        <div className="lpreview">
          {ZONES.zones.slice(0, 5).map((z) => {
            const covered = isCovered(stats, z);
            return (
              <div key={z.id} className={`lrow${covered ? " covered" : ""}`}>
                <span className="lchip" />
                <span className="lname">{corner(z.landmark.a, z.landmark.b)}</span>
                <span className="lmeta">
                  {covered ? "covered" : `${fmt(stillNeeded(stats, z))} short`}
                </span>
              </div>
            );
          })}
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
