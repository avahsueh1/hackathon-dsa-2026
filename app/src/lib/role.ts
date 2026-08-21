// Which side of the product this device is.
//
// A restaurant posts surplus; a volunteer collects it and decides where it
// goes. The two share a data model and almost no screens, so the role is
// chosen once and kept, rather than being a mode you toggle mid-service.

import { useSyncExternalStore } from "react";
import type { Role } from "../types";

const KEY = "surplus-street-role-v1";

let current: Role | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function initRole(): Role | null {
  try {
    const raw = localStorage.getItem(KEY);
    current = raw === "restaurant" || raw === "volunteer" ? raw : null;
  } catch {
    current = null;
  }
  emit();
  return current;
}

export function setRole(role: Role): void {
  current = role;
  try {
    localStorage.setItem(KEY, role);
  } catch {
    /* private mode -- the choice just will not survive a reload */
  }
  emit();
}

export function clearRole(): void {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  emit();
}

const snapshot = () => current;
const serverSnapshot = (): Role | null => null;

export function useRole(): Role | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
