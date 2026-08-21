import { useMemo, useState } from "react";
import type { Restaurant } from "../types";
import { postPickup } from "../lib/store";
import { PICKUP_WINDOWS, todayAt } from "../lib/food";
import { locate } from "../lib/geocode";
import QuantityStepper from "../components/QuantityStepper";
import Button from "../components/Button";

// Remembered for restaurants that post without registering, so the address is
// typed once rather than every night.
const LAST_ADDRESS_KEY = "surplus-street-last-address-v1";

function rememberAddress(a: string) {
  try {
    localStorage.setItem(LAST_ADDRESS_KEY, a);
  } catch {
    /* private mode -- it just will not be remembered */
  }
}

function lastAddress(): string {
  try {
    return localStorage.getItem(LAST_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

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
  const [win, setWin] = useState(PICKUP_WINDOWS[3]);
  const [notes, setNotes] = useState("");
  const [name, setName] = useState(account?.name ?? "");
  const [address, setAddress] = useState(account?.address || lastAddress());
  // Registered restaurants see their saved address rather than a blank field.
  // Editable, because "back door tonight, the front is being resurfaced" is a
  // real thing and the driver needs the right door.
  const [editingAddress, setEditingAddress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsName = !name.trim();
  const needsAddress = !address.trim();
  const located = useMemo(() => locate(address), [address]);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await postPickup({
        restaurant_name: name.trim(),
        address: address.trim(),
        quantity: qty,
        pickup_note: notes.trim() || null,
        // Resolved from the typed address against the block network the app
        // already ships. No map for a kitchen to fiddle with, and no pin on
        // the wrong street when it does not match.
        lat: located?.lat ?? null,
        lng: located?.lng ?? null,
        pickup_from: todayAt(win.from),
        pickup_to: todayAt(win.to),
      });
      rememberAddress(address.trim());
      setNotes("");
      setEditingAddress(false);
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
        )}

        {account && !editingAddress ? (
          <div className="savedrow">
            <span className="savedrow-text">
              <span className="ss-label pick-label">Collect from</span>
              <span className="savedval">{address}</span>
            </span>
            <Button variant="quiet" size="md" onClick={() => setEditingAddress(true)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="pickgroup">
            <label className="ss-label pick-label" htmlFor="oaddr">Pickup address</label>
            <input
              id="oaddr"
              className="finput"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Fifth Ave"
            />
            {account && (
              <span className="pick-help">
                Just for tonight — your saved address is {account.address}.
              </span>
            )}
          </div>
        )}

        {address.trim() !== "" && (
          <span className={`pick-help${located ? "" : " warn"}`}>
            {located
              ? `Drivers will see a pin on ${located.matched.replace(/\w/g, (c) => c.toUpperCase())}.`
              : "We could not place this on the downtown map — it will still be listed, just without a pin."}
          </span>
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
          disabled={needsName || needsAddress || saving}
          disabledReason={
            needsName
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
