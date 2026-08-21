import { useState } from "react";
import type { Restaurant } from "../types";
import { postOffer } from "../lib/store";
import { FOODS, PICKUP_WINDOWS, todayAt } from "../lib/food";
import QuantityStepper from "../components/QuantityStepper";
import Button from "../components/Button";

/**
 * The restaurant's whole job. What, how much, and when someone can collect it.
 *
 * Deliberately no zone anywhere on this screen: a kitchen does not know which
 * corner needs food tonight and should not have to. That decision belongs to
 * the volunteer who is actually driving.
 */

interface Props {
  account: Restaurant | null;
  onPosted: () => void;
}

export default function PostOffer({ account, onPosted }: Props) {
  const [qty, setQty] = useState(25);
  const [food, setFood] = useState<string | null>(null);
  const [win, setWin] = useState(PICKUP_WINDOWS[3]);
  const [notes, setNotes] = useState("");
  const [name, setName] = useState(account?.name ?? "");
  const [address, setAddress] = useState(account?.address ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsName = !name.trim();
  const needsAddress = !address.trim();

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await postOffer({
        restaurant_name: name.trim(),
        address: address.trim(),
        contact: account?.phone ?? account?.email ?? null,
        food_type: food ?? FOODS[0],
        quantity: qty,
        notes: notes.trim() || null,
        pickup_from: todayAt(win.from),
        pickup_to: todayAt(win.to),
      });
      setFood(null);
      setNotes("");
      onPosted();
    } catch {
      setErr("That did not post. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="cardlist">
      <div className="zcard">
        <span className="ss-label reg-eyebrow">Post tonight&rsquo;s surplus</span>
        <span className="zcard-sub">
          Say what you have and when it can be collected. A volunteer takes it from
          there and decides which neighbourhood needs it most.
        </span>

        <QuantityStepper value={qty} onChange={setQty} unit="meals" />

        <div className="pickgroup">
          <span className="ss-label pick-label">What kind of food?</span>
          <div className="pickrow">
            {FOODS.map((f) => (
              <button
                key={f}
                type="button"
                className={`pick${f === food ? " on" : ""}`}
                onClick={() => setFood(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="pickgroup">
          <span className="ss-label pick-label">When can it be collected?</span>
          <div className="pickrow">
            {PICKUP_WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                className={`pick${w.label === win.label ? " on" : ""}`}
                onClick={() => setWin(w)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {!account && (
          <>
            <div className="pickgroup">
              <label className="ss-label pick-label" htmlFor="oname">Your business</label>
              <input
                id="oname"
                className="finput"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Taquería Luna"
              />
            </div>
            <div className="pickgroup">
              <label className="ss-label pick-label" htmlFor="oaddr">Pickup address</label>
              <input
                id="oaddr"
                className="finput"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Fifth Ave"
              />
            </div>
          </>
        )}

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="onotes">
            Anything the driver should know? (optional)
          </label>
          <input
            id="onotes"
            className="finput"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Back door on the alley, ask for Marco"
          />
        </div>

        {err && <p className="errline">{err}</p>}

        <Button
          fullWidth
          disabled={!food || needsName || needsAddress || saving}
          disabledReason={
            !food
              ? "Pick what you’re offering first"
              : needsName
                ? "Add your business name"
                : needsAddress
                  ? "Add the pickup address"
                  : undefined
          }
          onClick={submit}
        >
          {saving ? "Posting…" : "Post this surplus"}
        </Button>
      </div>
    </div>
  );
}
