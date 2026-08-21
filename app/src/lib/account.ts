// Who this device is, per role.
//
// The backend has no restaurants table and no auth -- their RLS is
// deliberately trust-based for the demo, and we are not changing it. So this
// is local, and its only job is that nobody types their own name twice: the
// name it stores becomes offers.restaurant_name when a kitchen posts, and
// offers.volunteer_name when a driver takes a run.
//
// Keyed BY ROLE on purpose. One device can be both -- a restaurant owner who
// also drives -- and a single shared record meant switching to "volunteer"
// renamed the restaurant, so its own donation log came back empty. Two roles,
// two identities, one storage scheme.
//
// If auth lands later, only this file changes.

import { useSyncExternalStore } from "react";
import type { Restaurant, Role } from "../types";

const KEY: Record<Role, string> = {
  restaurant: "surplus-street-account-v1",   // unchanged, so existing users keep theirs
  volunteer: "surplus-street-volunteer-v1",
};

let activeRole: Role | null = null;
let current: Restaurant | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function read(role: Role): Restaurant | null {
  try {
    return JSON.parse(localStorage.getItem(KEY[role]) || "null") as Restaurant | null;
  } catch {
    return null;
  }
}

/** Point the store at a role's identity. Called on boot and whenever the role
 *  changes, so the name on screen always belongs to the side you are on. */
export function loadAccountFor(role: Role | null): Restaurant | null {
  activeRole = role;
  current = role ? read(role) : null;
  emit();
  return current;
}

/** Async on purpose: the landing gate awaits this, and keeping the signature
 *  promise-shaped means wiring real auth later does not turn callers inside out. */
export async function initAccount(role: Role | null): Promise<Restaurant | null> {
  return loadAccountFor(role);
}

export async function register(details: Restaurant): Promise<Restaurant> {
  if (!activeRole) throw new Error("register: no role chosen");
  current = details;
  try {
    localStorage.setItem(KEY[activeRole], JSON.stringify(details));
  } catch (err) {
    console.warn("account could not be saved:", err);
  }
  emit();
  return details;
}

export async function signOut(): Promise<void> {
  if (activeRole) {
    try {
      localStorage.removeItem(KEY[activeRole]);
    } catch {
      /* private mode -- nothing to clear */
    }
  }
  current = null;
  emit();
}

const snapshot = () => current;
const serverSnapshot = (): Restaurant | null => null;

export function useAccount(): Restaurant | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
