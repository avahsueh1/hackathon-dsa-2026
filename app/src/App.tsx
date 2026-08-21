import { useCallback, useEffect, useState } from "react";
import type { Zone } from "./types";
import { initStore, useBoard, addClaim } from "./lib/store";
import { initAccount, useAccount } from "./lib/account";
import { hasBackend } from "./lib/supabase";
import { ZONES, stillNeeded, totals } from "./lib/zones";

import MobileShell, { type Tab } from "./components/MobileShell";
import Toast from "./components/Toast";
import Landing from "./screens/Landing";
import Tonight from "./screens/Tonight";
import MapScreen from "./screens/MapScreen";
import Drops from "./screens/Drops";
import Account from "./screens/Account";
import ClaimSheet from "./screens/ClaimSheet";

const TITLES: Record<Tab, string> = {
  tonight: "Tonight",
  map: "The map",
  drops: "My drops",
  account: "Your business",
};

export default function App() {
  const { claims, stats, ready, live, error } = useBoard();
  const account = useAccount();

  const [booted, setBooted] = useState(false);
  const [onLanding, setOnLanding] = useState(true);
  const [tab, setTab] = useState<Tab>("tonight");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<Zone | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<"field" | "desk">("field");

  // The gate has to wait for the account to resolve. Doing this synchronously
  // is the bug that made a registered restaurant see the landing page on every
  // open -- even locally the promise settles a microtask after the first paint.
  useEffect(() => {
    initStore();
    void initAccount().then((r) => {
      if (r) setOnLanding(false);
      setBooted(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // On the map, tapping the same zone twice clears it -- the map is still
  // there underneath, so there is something to go back to.
  const toggle = useCallback(
    (id: string) => setSelectedId((prev) => (prev === id ? null : id)),
    [],
  );

  // On Tonight, a ring is a question about geography: "where is this?".
  // Answer it by going to the map with that zone framed and its claim button
  // on screen. Selecting without moving only outlined a card further down the
  // list, which on a phone is off screen and reads as nothing happening.
  const showOnMap = useCallback((id: string) => {
    setSelectedId(id);
    setTab("map");
  }, []);

  // Wait for the account AND the first load of the board. A landing page that
  // flashes and vanishes reads as a bug, and so does a board that says
  // "8 open" for a beat before the real numbers arrive.
  if (!booted || !ready) return <div className="device" aria-busy="true" />;

  if (onLanding) {
    return (
      <div className="device">
        <Landing
          stats={stats}
          onEnter={() => setOnLanding(false)}
          onRegister={() => {
            setTab("account");
            setOnLanding(false);
          }}
          onDemo={() => {
            // Covers the next open zone so the amber -> mint flip is visible
            // before anyone signs up. On the shared board this is a real claim
            // that everyone sees, so it is labelled as a demo drop.
            const next = ZONES.zones.find((z) => stillNeeded(stats, z) > 0);
            if (!next || totals(stats).open === 0) return;
            void addClaim({
              zoneId: next.id,
              restaurantName: "Demo Kitchen",
              quantity: stillNeeded(stats, next),
              food: "Prepared hot food",
              dropWindow: "Tonight, 8-9pm",
            }).catch(() => setToast("Could not reach the board."));
          }}
        />
      </div>
    );
  }

  const status = error
    ? error
    : hasBackend
      ? live
        ? "Live board · downtown San Diego"
        : "Connected · downtown San Diego"
      : "This browser only · downtown San Diego";

  return (
    <div className="device">
      <MobileShell
        tab={tab}
        onTab={setTab}
        mode={mode}
        onMode={() => setMode(mode === "field" ? "desk" : "field")}
        title={TITLES[tab]}
        status={status}
        degraded={!!error}
      >
        {tab === "tonight" && (
          <Tonight
            claims={claims}
            stats={stats}
            selectedId={selectedId}
            onSelect={showOnMap}
            onClaim={setClaiming}
          />
        )}
        {tab === "map" && (
          <MapScreen
            claims={claims}
            stats={stats}
            selectedId={selectedId}
            onSelect={toggle}
            onClaim={setClaiming}
          />
        )}
        {tab === "drops" && (
          <Drops claims={claims} mine={account?.name ?? null} onGoTonight={() => setTab("tonight")} />
        )}
        {tab === "account" && <Account onDone={() => setTab("tonight")} />}
      </MobileShell>

      {claiming && (
        <ClaimSheet
          zone={claiming}
          stats={stats}
          account={account}
          onClose={() => setClaiming(null)}
          onDone={(msg) => {
            setClaiming(null);
            setToast(msg);
          }}
        />
      )}

      {toast && (
        <div className="toastwrap">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}
