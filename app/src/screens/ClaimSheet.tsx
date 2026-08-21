import { useState } from "react";
import type { Restaurant, Zone } from "../types";
import { addClaim } from "../lib/store";
import { stillNeeded } from "../lib/zones";
import { corner } from "../lib/streets";
import { fmt, todayStamp } from "../lib/format";
import { FOODS, DROP_WINDOWS } from "../lib/food";
import type { Claim } from "../types";
import BottomSheet, { type Snap } from "../components/BottomSheet";
import QuantityStepper from "../components/QuantityStepper";
import StatusPill from "../components/StatusPill";
import Button from "../components/Button";

interface Props {
  zone: Zone;
  claims: Claim[];
  account: Restaurant | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export default function ClaimSheet({ zone, claims, account, onClose, onDone }: Props) {
  const short = stillNeeded(claims, zone);
  const covered = short === 0;

  const [snap, setSnap] = useState<Snap>("full");
  // Default to what the zone actually needs, rounded to the nearest preset step.
  const [qty, setQty] = useState(Math.max(10, Math.min(200, Math.round(short / 5) * 5 || 25)));
  const [food, setFood] = useState<string | null>(null);
  const [when, setWhen] = useState<string>(DROP_WINDOWS[1]);
  const [who, setWho] = useState(account?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsName = !account && !who.trim();

  async function confirm() {
    setSaving(true);
    setErr(null);
    try {
      await addClaim({
        zone: zone.id,
        zone_name: zone.name,
        meals: qty,
        drop_window: when,
        food_description: food,
        // A registered account is authoritative: it is what the SB 1383 log
        // attributes the drop to, so a typed name can never override it.
        donor_name: account?.name ?? who.trim() ?? null,
        drop_date: todayStamp(),
        status: "claimed",
      });
      onDone(`Claimed ${zone.name} — ~${qty} servings`);
    } catch {
      setErr("That did not save. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      snap={snap}
      onSnapChange={setSnap}
      onClose={onClose}
      label={`Claim ${zone.name}`}
    >
      <div className="claimflow">
        <div className="claimhead">
          <StatusPill status={covered ? "covered" : "open"} style={{ alignSelf: "flex-start" }} />
          <span className="claimtitle">{zone.name}</span>
          <span className="claimsub">
            {corner(zone.landmark.a, zone.landmark.b)} ·{" "}
            {covered ? "already covered — anything extra helps" : `~${fmt(short)} meals still needed`}
          </span>
        </div>

        <QuantityStepper value={qty} onChange={setQty} unit="meals" />

        <div className="pickgroup">
          <span className="ss-label pick-label">What kind of food?</span>
          <div className="pickrow">
            {FOODS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFood(f)}
                className={`pick${f === food ? " on" : ""}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="pickgroup">
          <span className="ss-label pick-label">When will you drop it off?</span>
          <div className="pickrow">
            {DROP_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWhen(w)}
                className={`pick${w === when ? " on" : ""}`}
              >
                {w.replace(/^Tonight,\s*/, "")}
              </button>
            ))}
          </div>
        </div>

        {!account && (
          <div className="pickgroup">
            <span className="ss-label pick-label">Your business</span>
            <input
              className="finput"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Taquería Luna"
            />
            <span className="pick-help">Register once and you will never type this again.</span>
          </div>
        )}

        {err && <p className="errline">{err}</p>}

        <Button
          fullWidth
          disabled={!food || needsName || saving}
          disabledReason={
            !food
              ? "Pick what you’re bringing first"
              : needsName
                ? "Add your business name so the drop is attributed"
                : undefined
          }
          onClick={confirm}
        >
          {saving ? "Claiming…" : "Claim this zone"}
        </Button>
      </div>
    </BottomSheet>
  );
}
