import type { ReactNode } from "react";
import type { Role } from "../types";
import Button from "./Button";

/** The tabs differ by role, because the two sides share almost no screens. */

export type Tab =
  | "post" | "log"                          // restaurant
  | "pickups" | "run" | "map"               // volunteer
  | "account";                              // both

export interface TabDef {
  id: Tab;
  label: string;
  glyph: string;
}

const RESTAURANT_TABS: TabDef[] = [
  { id: "post", label: "Post", glyph: "＋" },
  { id: "log", label: "Donations", glyph: "≡" },
  { id: "account", label: "You", glyph: "◍" },
];

const VOLUNTEER_TABS: TabDef[] = [
  { id: "pickups", label: "Pickups", glyph: "◉" },
  { id: "run", label: "My run", glyph: "▸" },
  { id: "map", label: "Map", glyph: "◈" },
  { id: "account", label: "You", glyph: "◍" },
];

export function tabsFor(role: Role): TabDef[] {
  return role === "restaurant" ? RESTAURANT_TABS : VOLUNTEER_TABS;
}

interface Props {
  role: Role;
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
  role,
  tab,
  onTab,
  mode,
  onMode,
  title,
  status,
  degraded = false,
  children,
}: Props) {
  const tabs = tabsFor(role);

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
        {tabs.map((t) => {
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
