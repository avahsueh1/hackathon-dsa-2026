import { useCallback, useEffect, useState } from "react";
import type { Role } from "./types";
import { initStore, useBoard } from "./lib/store";
import { initAccount, loadAccountFor, useAccount } from "./lib/account";
import { initRole, setRole, useRole } from "./lib/role";
import { hasBackend } from "./lib/supabase";

import MobileShell, { tabsFor, type Tab } from "./components/MobileShell";
import Toast from "./components/Toast";
import Landing from "./screens/Landing";
import RoleGate from "./screens/RoleGate";
import PostOffer from "./screens/PostOffer";
import RestaurantLog from "./screens/RestaurantLog";
import Pickups from "./screens/Pickups";
import MyRun from "./screens/MyRun";
import MapScreen from "./screens/MapScreen";
import Account from "./screens/Account";

const TITLES: Record<Tab, string> = {
  post: "Post surplus",
  log: "Your donations",
  pickups: "Pickups",
  run: "My run",
  map: "The map",
  account: "Your account",
};

export default function App() {
  const { offers, stats, ready, live, offersShared, error } = useBoard();
  const account = useAccount();
  const role = useRole();

  const [booted, setBooted] = useState(false);
  const [onLanding, setOnLanding] = useState(true);
  const [tab, setTab] = useState<Tab>("pickups");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<"field" | "desk">("field");

  // The gate has to wait for the account to resolve. Doing this synchronously
  // is the bug that made a registered restaurant see the landing page on every
  // open -- even locally the promise settles a microtask after the first paint.
  useEffect(() => {
    initStore();
    const r = initRole();
    void initAccount(r).then((acct) => {
      if (acct || r) setOnLanding(false);
      if (r) setTab(r === "restaurant" ? "post" : "pickups");
      setBooted(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const toggle = useCallback(
    (id: string) => setSelectedId((prev) => (prev === id ? null : id)),
    [],
  );

  const pickRole = useCallback((r: Role) => {
    setRole(r);
    // Swap to that role's identity, so a restaurant that also drives does not
    // come back to its own donation log under the driver's name.
    loadAccountFor(r);
    setTab(r === "restaurant" ? "post" : "pickups");
  }, []);

  if (!booted || !ready) return <div className="device" aria-busy="true" />;

  if (onLanding) {
    return (
      <div className="device">
        <Landing
          stats={stats}
          onEnter={() => setOnLanding(false)}
          onRegister={() => {
            pickRole("restaurant");
            setOnLanding(false);
          }}
          onDemo={() => {
            pickRole("volunteer");
            setOnLanding(false);
          }}
        />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="device">
        <RoleGate onPick={pickRole} />
      </div>
    );
  }

  // A tab from the other role's bar would otherwise survive a switch.
  const validTabs = tabsFor(role).map((t) => t.id);
  const safeTab: Tab = validTabs.includes(tab) ? tab : validTabs[0];

  const status = error
    ? error
    : !hasBackend
      ? "This browser only · downtown San Diego"
      : !offersShared
        ? "Zones live · offers on this device"
        : live
          ? "Live board · downtown San Diego"
          : "Connected · downtown San Diego";

  return (
    <div className="device">
      <MobileShell
        role={role}
        tab={safeTab}
        onTab={setTab}
        mode={mode}
        onMode={() => setMode(mode === "field" ? "desk" : "field")}
        title={TITLES[safeTab]}
        status={status}
        degraded={!!error}
      >
        {safeTab === "post" && (
          <PostOffer
            account={account}
            onPosted={() => {
              setTab("log");
              setToast("Posted — a volunteer will pick it up");
            }}
          />
        )}

        {safeTab === "log" && (
          <RestaurantLog
            offers={offers}
            mine={account?.name ?? null}
            onPost={() => setTab("post")}
          />
        )}

        {safeTab === "pickups" && (
          <Pickups
            offers={offers}
            volunteer={account?.name ?? null}
            onAccepted={() => setToast("Added to your route")}
            onNeedName={() => {
              setTab("account");
              setToast("Add your name so restaurants know who is coming");
            }}
            onOpenRoute={() => setTab("run")}
          />
        )}

        {safeTab === "run" && (
          <MyRun
            offers={offers}
            stats={stats}
            volunteer={account?.name ?? null}
            onFindWork={() => setTab("pickups")}
          />
        )}

        {safeTab === "map" && (
          <MapScreen stats={stats} selectedId={selectedId} onSelect={toggle} />
        )}

        {safeTab === "account" && <Account onDone={() => setTab(validTabs[0])} />}
      </MobileShell>

      {toast && (
        <div className="toastwrap">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}
