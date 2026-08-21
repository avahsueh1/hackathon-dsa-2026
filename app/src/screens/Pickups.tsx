import { useMemo, useState } from "react";
import type { Offer } from "../types";
import { acceptOffer } from "../lib/store";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import { Hero } from "../components/MobileShell";

/**
 * The volunteer's feed: what is available to collect, soonest first.
 *
 * Filtered by when you can drive, because a run you cannot make is noise. The
 * zone is deliberately absent here -- you pick up first and decide where it
 * goes afterwards, on the map, once you know what is still short.
 */

type When = "any" | "soon" | "later";

interface Props {
  offers: Offer[];
  volunteer: string | null;
  onAccepted: () => void;
  onNeedName: () => void;
}

export default function Pickups({ offers, volunteer, onAccepted, onNeedName }: Props) {
  const [when, setWhen] = useState<When>("any");
  const [busy, setBusy] = useState<string | null>(null);

  const open = useMemo(() => {
    const now = Date.now();
    const soonCutoff = now + 2 * 60 * 60 * 1000;
    return offers
      .filter((o) => o.status === "open")
      .filter((o) => {
        if (when === "any") return true;
        const from = new Date(o.pickup_from).getTime();
        return when === "soon" ? from <= soonCutoff : from > soonCutoff;
      })
      .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from));
  }, [offers, when]);

  const totalMeals = open.reduce((a, o) => a + o.quantity, 0);

  async function take(o: Offer) {
    if (!volunteer) return onNeedName();
    setBusy(o.id);
    try {
      await acceptOffer(o.id, volunteer);
      onAccepted();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Hero
        label="Waiting for a driver"
        value={fmt(totalMeals)}
        unit={`across ${open.length} ${plural(open.length, "pickup")}`}
      />

      <div className="pickgroup" style={{ padding: "0 var(--gutter) var(--s-3)" }}>
        <div className="pickrow">
          {(["any", "soon", "later"] as When[]).map((w) => (
            <button
              key={w}
              type="button"
              className={`pick${w === when ? " on" : ""}`}
              onClick={() => setWhen(w)}
            >
              {w === "any" ? "Any time" : w === "soon" ? "Next 2 hours" : "Later tonight"}
            </button>
          ))}
        </div>
      </div>

      {open.length === 0 ? (
        <div className="dropempty">
          <EmptyState
            headline={when === "any" ? "Nothing to collect yet." : "Nothing in that window."}
            detail={
              when === "any"
                ? "Restaurants post surplus at the end of service. This list fills up from about 8pm."
                : "Try a different time — there may be runs earlier or later tonight."
            }
            actionLabel={when === "any" ? undefined : "Show any time"}
            onAction={() => setWhen("any")}
          />
        </div>
      ) : (
        <div className="cardlist">
          {open.map((o) => (
            <div key={o.id} className="zcard">
              <div className="zcard-top">
                <span className="ss-label pickup-when">
                  ◷ {windowLabel(o.pickup_from, o.pickup_to)}
                </span>
                <span className="ss-num zcard-need">~{fmt(o.quantity)} meals</span>
              </div>

              <div className="zcard-body">
                <span className="zcard-title">{o.restaurant_name}</span>
                <span className="zcard-sub">{o.address}</span>
                <span className="zcard-meta open">
                  {o.food_type}
                  {o.notes ? ` · ${o.notes}` : ""}
                </span>
              </div>

              <Button fullWidth disabled={busy === o.id} onClick={() => void take(o)}>
                {busy === o.id ? "Taking…" : "I'll take this run"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
