import { useState, type FormEvent } from "react";
import type { Restaurant } from "../types";
import { register, signOut, useAccount } from "../lib/account";
import { hasBackend } from "../lib/supabase";
import Button from "../components/Button";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TYPES = ["Restaurant", "Cafe", "Caterer", "Grocery", "Hotel", "Other"];

const EMPTY: Restaurant = {
  name: "",
  address: "",
  business_type: "Restaurant",
  contact_name: "",
  email: "",
  phone: "",
  typical_meals: null,
  surplus_days: [],
};

export default function Account({ onDone }: { onDone: () => void }) {
  const account = useAccount();
  const [f, setF] = useState<Restaurant>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (account) {
    return (
      <div className="cardlist">
        <div className="zcard">
          <span className="ss-label reg-eyebrow">Registered</span>
          <span className="zcard-title">{account.name}</span>
          <span className="zcard-sub">{account.address}</span>
          <span className="zcard-sub">
            {account.contact_name} · {account.email}
          </span>
          {account.surplus_days.length > 0 && (
            <span className="zcard-sub">Usually has surplus: {account.surplus_days.join(", ")}</span>
          )}
          <p className="fineprint">
            Every drop you claim is attributed to this business in your SB 1383 log, and you
            will not be asked to type the name again.
            {hasBackend
              ? " Your contact details are private to your account."
              : " Saved in this browser only until the backend is connected."}
          </p>
          <Button variant="danger" fullWidth onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const valid =
    f.name.trim() !== "" &&
    f.address.trim() !== "" &&
    f.contact_name.trim() !== "" &&
    f.email.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await register({ ...f, name: f.name.trim(), email: f.email.trim() });
      onDone();
    } catch {
      setErr("Could not register. Check your connection and try again.");
      setSaving(false);
    }
  }

  function toggleDay(d: string) {
    setF((p) => ({
      ...p,
      surplus_days: p.surplus_days.includes(d)
        ? p.surplus_days.filter((x) => x !== d)
        : [...p.surplus_days, d],
    }));
  }

  return (
    <form className="cardlist" onSubmit={submit}>
      <div className="zcard">
        <span className="ss-label reg-eyebrow">Register your business</span>
        <span className="zcard-sub">
          One minute, once. It fills in your name on every future drop and keeps your donation
          log attributed correctly.
        </span>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="rname">Business name</label>
          <input id="rname" className="finput" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </div>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="raddr">Address</label>
          <input id="raddr" className="finput" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required />
        </div>

        <div className="pickgroup">
          <span className="ss-label pick-label">Type of business</span>
          <div className="pickrow">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`pick${f.business_type === t ? " on" : ""}`}
                onClick={() => setF({ ...f, business_type: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="rcontact">Who should we contact?</label>
          <input id="rcontact" className="finput" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} required />
        </div>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="remail">Email</label>
          <input id="remail" type="email" className="finput" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </div>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="rphone">Phone (optional)</label>
          <input id="rphone" type="tel" className="finput" value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="rmeals">Typical surplus, in servings (optional)</label>
          <input
            id="rmeals"
            type="number"
            min={0}
            className="finput"
            value={f.typical_meals ?? ""}
            onChange={(e) => setF({ ...f, typical_meals: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>

        <div className="pickgroup">
          <span className="ss-label pick-label">Which nights do you usually have surplus?</span>
          <div className="pickrow">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={`pick${f.surplus_days.includes(d) ? " on" : ""}`}
                onClick={() => toggleDay(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="errline">{err}</p>}

        <Button
          type="submit"
          fullWidth
          disabled={!valid || saving}
          disabledReason={!valid ? "Name, address, contact and email are required" : undefined}
        >
          {saving ? "Registering…" : "Register"}
        </Button>
      </div>
    </form>
  );
}
