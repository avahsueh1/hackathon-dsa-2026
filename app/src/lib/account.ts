// The registered restaurant.
//
// The backend has no restaurants table and no auth -- their RLS is
// deliberately trust-based for the demo, and we are not changing it. So this
// is local to the browser, and its only job is that a restaurant never types
// its own name again: the name it stores becomes claims.restaurant_name on
// every drop, which is what everyone else on the board sees.
//
// If auth lands later, only this file changes.

import { useSyncExternalStore } from "react";
import type { Restaurant } from "../types";

const KEY = "surplus-street-account-v1";

let current: Restaurant | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Async on purpose. The landing gate has to await this, and keeping the
 *  signature promise-shaped means wiring real auth later does not turn every
 *  caller inside out. */
export async function initAccount(): Promise<Restaurant | null> {
  try {
    current = JSON.parse(localStorage.getItem(KEY) || "null") as Restaurant | null;
  } catch {
    current = null;
  }
  emit();
  return current;
}

export async function register(details: Restaurant): Promise<Restaurant> {
  current = details;
  try {
    localStorage.setItem(KEY, JSON.stringify(details));
  } catch (err) {
    console.warn("account could not be saved:", err);
  }
  emit();
  return details;
}

export async function signOut(): Promise<void> {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode -- nothing to clear */
  }
  emit();
}

const snapshot = () => current;
const serverSnapshot = () => null;

export function useAccount(): Restaurant | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
