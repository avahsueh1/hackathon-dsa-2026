import { useEffect, useMemo, useState } from "react";
import type { Offer } from "../types";
import { acceptOffer } from "../lib/store";
import { fmt, plural } from "../lib/format";
import { windowLabel } from "../lib/food";
import PickupMap from "../components/PickupMap";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

/**
 * The volunteer's feed: where food is ready, and when.
 *
 * Map first, list underneath. A pickup is a place you have to drive to, and a
 * list of addresses does not tell you which ones are on your way; four pings
 * on a map does. The zone is deliberately absent -- you collect first and
 * decide where it goes afterwards, once you know what is still short.
 */

type When = "any" | "soon" | "later";

interface Props {
  offers: Offer[];
  volunteer: string | null;
  onAccepted: () => void;
  onNeedName: () => void;
  onOpenRoute: () => void;
}

export default function Pickups({ offers, volunteer, onAccepted, onNeedName, onOpenRoute }: Props) {
  const [when, setWhen] = useState<When>("any");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = useMemo(() => {
    const soonCutoff = Date.now() + 2 * 60 * 60 * 1000;
    return offers
      .filter((o) => o.status === "open")
      .filter((o) => {
        if (when === "any") return true;
        const from = new Date(o.pickup_from).getTime();
        return when === "soon" ? from <= soonCutoff : from > soonCutoff;
      })
      .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from));
  }, [offers, when]);

  // A selection that the filter just hid would leave the card showing a run
  // you cannot see on the map.
  useEffect(() => {
    if (selected && !open.some((o) => o.id === selected)) setSelected(null);
  }, [open, selected]);

  const totalMeals = open.reduce((a, o) => a + o.quantity, 0);
  const chosen = open.find((o) => o.id === selected) ?? null;

  // What is already on this driver's route, so the map can show both and the
  // bar can offer a way back to it.
  const route = useMemo(
    () =>
      offers.filter(
        (o) => o.status === "accepted" && (!volunteer || o.volunteer_name === volunteer),
      ),
    [offers, volunteer],
  );

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
    <div className="pickupscreen">
      <div className="pickupbar">
        <span className="ss-label pickupbar-l">
          {fmt(totalMeals)} meals · {open.length} {plural(open.length, "pickup")}
        </span>
        <div className="pickrow">
          {(["any", "soon", "later"] as When[]).map((w) => (
            <button
              key={w}
              type="button"
              className={`pick tiny${w === when ? " on" : ""}`}
              onClick={() => setWhen(w)}
            >
              {w === "any" ? "Any time" : w === "soon" ? "Next 2h" : "Later"}
            </button>
          ))}
        </div>
      </div>

      <PickupMap
        offers={open}
        route={route}
        selectedId={selected}
        onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
      />

      {route.length > 0 && (
        <button type="button" className="routebar" onClick={onOpenRoute}>
          <span className="ss-label">
            ▸ {route.length} {plural(route.length, "stop")} on your route ·{" "}
            {fmt(route.reduce((a, o) => a + o.quantity, 0))} meals
          </span>
          <span className="routebar-go">Open</span>
        </button>
      )}

      {open.length === 0 ? (
        <div className="pickuplist">
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
      ) : chosen ? (
        // The selected ping, in the sheet position: one run, all of it, and
        // the action.
        <div className="pickupcard">
          <div className="pickupcard-top">
            <span className="ss-label pickup-when">◷ {windowLabel(chosen.pickup_from, chosen.pickup_to)}</span>
            <span className="ss-num zcard-need">~{fmt(chosen.quantity)} meals</span>
          </div>
          <span className="pickupcard-name">
            {chosen.restaurant_name}
            {chosen.demo && <span className="demotag">Sample</span>}
          </span>
          <span className="zcard-sub">{chosen.address}</span>
          <span className="zcard-meta open">
            {chosen.food_type}
            {chosen.notes ? ` · ${chosen.notes}` : ""}
          </span>
          <Button fullWidth disabled={busy === chosen.id} onClick={() => void take(chosen)}>
            {busy === chosen.id
              ? "Adding…"
              : route.length > 0
                ? "Add this stop to my route"
                : "Start a route here"}
          </Button>
        </div>
      ) : (
        <div className="pickuplist">
          {open.map((o) => (
            <button
              key={o.id}
              type="button"
              className="pickuprow"
              onClick={() => setSelected(o.id)}
            >
              <span className="ss-label pickup-when">
                {windowLabel(o.pickup_from, o.pickup_to)}
              </span>
              <span className="pickuprow-text">
                <span className="pickuprow-name">
                  {o.restaurant_name}
                  {o.demo && <span className="demotag">Sample</span>}
                </span>
                <span className="pickuprow-sub">
                  {o.food_type} · {o.address}
                </span>
              </span>
              <span className="ss-num pickuprow-qty">~{fmt(o.quantity)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
