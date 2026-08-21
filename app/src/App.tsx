import { useCallback, useEffect, useState } from "react";
import type { Zone } from "./types";
import { initStore, useClaims, addClaim } from "./lib/store";
import { initAccount, useAccount } from "./lib/account";
import { ZONES, stillNeeded, totals } from "./lib/zones";
import { todayStamp } from "./lib/format";

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
  const claims = useClaims();
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

  const select = useCallback(
    (id: string) => setSelectedId((prev) => (prev === id ? null : id)),
    [],
  );

  // Nothing rendered until we know which screen is right: a landing page that
  // flashes and vanishes reads as a bug.
  if (!booted) return <div className="device" aria-busy="true" />;

  if (onLanding) {
    return (
      <div className="device">
        <Landing
          claims={claims}
          onEnter={() => setOnLanding(false)}
          onRegister={() => {
            setTab("account");
            setOnLanding(false);
          }}
          onDemo={() => {
            // Covers the next open zone so the amber -> mint flip is visible
            // before anyone signs up.
            const next = ZONES.zones.find((z) => stillNeeded(claims, z) > 0);
            if (!next || totals(claims).open === 0) return;
            void addClaim({
              zone: next.id,
              zone_name: next.name,
              meals: stillNeeded(claims, next),
              drop_window: "Tonight, 8-9pm",
              food_description: "Prepared hot food",
              donor_name: "Demo Kitchen",
              drop_date: todayStamp(),
              status: "claimed",
            });
          }}
        />
      </div>
    );
  }

  return (
    <div className="device">
      <MobileShell
        tab={tab}
        onTab={setTab}
        mode={mode}
        onMode={() => setMode(mode === "field" ? "desk" : "field")}
        title={TITLES[tab]}
      >
        {tab === "tonight" && (
          <Tonight
            claims={claims}
            selectedId={selectedId}
            onSelect={select}
            onClaim={setClaiming}
            onOpenMap={() => setTab("map")}
          />
        )}
        {tab === "map" && (
          <MapScreen
            claims={claims}
            selectedId={selectedId}
            onSelect={select}
            onClaim={setClaiming}
          />
        )}
        {tab === "drops" && <Drops claims={claims} onGoTonight={() => setTab("tonight")} />}
        {tab === "account" && <Account onDone={() => setTab("tonight")} />}
      </MobileShell>

      {claiming && (
        <ClaimSheet
          zone={claiming}
          claims={claims}
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
