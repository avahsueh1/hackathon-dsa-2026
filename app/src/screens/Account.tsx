import { useState, type FormEvent } from "react";
import type { Restaurant } from "../types";
import { register, signOut, useAccount } from "../lib/account";
import { clearRole, useRole } from "../lib/role";
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
  const role = useRole();
  const volunteer = role === "volunteer";
  const [f, setF] = useState<Restaurant>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (account) {
    return (
      <div className="cardlist">
        <div className="zcard">
          <span className="ss-label reg-eyebrow">
            {volunteer ? "Driving as" : "Registered"}
          </span>
          <span className="zcard-title">{account.name}</span>
          {account.address && <span className="zcard-sub">{account.address}</span>}
          {(account.email || account.phone) && (
            <span className="zcard-sub">
              {[account.contact_name, account.email, account.phone].filter(Boolean).join(" · ")}
            </span>
          )}
          {account.surplus_days.length > 0 && (
            <span className="zcard-sub">Usually has surplus: {account.surplus_days.join(", ")}</span>
          )}
          <p className="fineprint">
            {volunteer
              ? "Restaurants see this name when you take their run."
              : "Every offer you post is attributed to this business in your donation log, and you will not be asked to type the name again."}
            {hasBackend ? "" : " Saved in this browser only."}
          </p>
          <Button variant="danger" fullWidth onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              clearRole();
              onDone();
            }}
          >
            Switch to {volunteer ? "posting surplus" : "driving"}
          </Button>
        </div>
      </div>
    );
  }

  const valid = volunteer
    ? f.name.trim() !== ""
    : f.name.trim() !== "" &&
      f.address.trim() !== "" &&
      f.contact_name.trim() !== "" &&
      f.email.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      // A volunteer only needs a name: it is what the restaurant sees when
      // someone takes their run.
      await register(
        volunteer
          ? { ...f, name: f.name.trim(), contact_name: f.name.trim(), address: "", surplus_days: [] }
          : { ...f, name: f.name.trim(), email: f.email.trim() },
      );
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
        <span className="ss-label reg-eyebrow">
          {volunteer ? "Who is driving?" : "Register your business"}
        </span>
        <span className="zcard-sub">
          {volunteer
            ? "Just a name, so a restaurant knows who is coming for their food. No login, no account."
            : "One minute, once. It fills in your name on every offer you post and keeps your donation log attributed correctly."}
        </span>

        <div className="pickgroup">
          <label className="ss-label pick-label" htmlFor="rname">
            {volunteer ? "Your name" : "Business name"}
          </label>
          <input id="rname" className="finput" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </div>

        {volunteer ? (
          <div className="pickgroup">
            <label className="ss-label pick-label" htmlFor="rphone">Phone (optional)</label>
            <input
              id="rphone"
              type="tel"
              className="finput"
              value={f.phone ?? ""}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
            <span className="pick-help">
              Only shown to the restaurant whose run you take.
            </span>
          </div>
        ) : (
          <>
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
          </>
        )}

        {err && <p className="errline">{err}</p>}

        {/* Reachable before registering too -- picking the wrong side on the
            role gate should not strand someone on a form they cannot use. */}
        <Button
          variant="quiet"
          size="md"
          fullWidth
          onClick={() => {
            clearRole();
            onDone();
          }}
        >
          Actually, I want to {volunteer ? "post surplus" : "drive"}
        </Button>

        <Button
          type="submit"
          fullWidth
          disabled={!valid || saving}
          disabledReason={
            !valid
              ? volunteer
                ? "Add your name so restaurants know who is coming"
                : "Name, address, contact and email are required"
              : undefined
          }
        >
          {saving ? "Saving…" : volunteer ? "Start driving" : "Register"}
        </Button>
      </div>
    </form>
  );
}
