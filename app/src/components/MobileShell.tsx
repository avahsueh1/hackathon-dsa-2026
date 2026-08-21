import type { ReactNode } from "react";
import Button from "./Button";

export type Tab = "tonight" | "map" | "drops" | "account";

export const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: "tonight", label: "Tonight", glyph: "◉" },
  { id: "map", label: "Map", glyph: "◈" },
  { id: "drops", label: "Drops", glyph: "≡" },
  { id: "account", label: "You", glyph: "◍" },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  mode: "field" | "desk";
  onMode: () => void;
  title: string;
  /** Whether this phone is on the shared board or on its own. Worth a line of
   *  the header: a driver has to know if what they are looking at is what
   *  everyone else sees. */
  status: string;
  degraded?: boolean;
  children: ReactNode;
}

export default function MobileShell({
  tab,
  onTab,
  mode,
  onMode,
  title,
  status,
  degraded = false,
  children,
}: Props) {
  return (
    <>
      <header className="appheader">
        <div className="appheader-text">
          <span className="appheader-title">{title}</span>
          <span className={`appheader-status${degraded ? " degraded" : ""}`}>{status}</span>
        </div>
        <Button variant="quiet" size="md" onClick={onMode} style={{ whiteSpace: "nowrap" }}>
          {mode === "field" ? "Field" : "Desk"}
        </Button>
      </header>

      <main className="app-main">{children}</main>

      <nav role="tablist" className="tabbar">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => onTab(t.id)}>
              <span aria-hidden="true" className="tabglyph">
                {t.glyph}
              </span>
              <span className="ss-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

export function Hero({ label, value, unit, right }: {
  label: string;
  value: ReactNode;
  unit?: string;
  right?: ReactNode;
}) {
  return (
    <div className="hero">
      <div className="hero-text">
        <span className="ss-label hero-label">{label}</span>
        <span className="hero-line">
          <span className="ss-num hero-value">{value}</span>
          {unit && <span className="hero-unit">{unit}</span>}
        </span>
      </div>
      {right}
    </div>
  );
}
