// Grouping stops into routes.
//
// A route is one trip: load the car at two or three kitchens, empty it, come
// back out. A driver can do several in an evening, and they should not run
// together into one endless list.
//
// This is local. The backend's `claims` table has no column to hang a route
// off, and inventing one would mean changing a schema that is not ours -- so
// the grouping lives on the device doing the driving, which is also the only
// device that needs it. Everything a route is made of (which pickups, which
// zones, what was delivered) is on the shared board already; only the grouping
// is here.

import { useSyncExternalStore } from "react";

const KEY = "surplus-street-routes-v1";

export interface RouteMeta {
  id: string;
  label: string;
  created_at: string;
}

interface RouteState {
  routes: RouteMeta[];
  /** The one new pickups join. */
  active: string | null;
  /** pickup id -> route id */
  assign: Record<string, string>;
}

const EMPTY: RouteState = { routes: [], active: null, assign: {} };

let state: RouteState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("routes not saved:", err);
  }
}

function load(): RouteState {
  if (loaded) return state;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as RouteState | null;
    if (raw && Array.isArray(raw.routes)) state = raw;
  } catch {
    state = EMPTY;
  }
  return state;
}

function newId(): string {
  return `route-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Start a route and make it the one new pickups join. */
export function newRoute(): RouteMeta {
  load();
  const route: RouteMeta = {
    id: newId(),
    label: `Route ${state.routes.length + 1}`,
    created_at: new Date().toISOString(),
  };
  state.routes = [...state.routes, route];
  state.active = route.id;
  persist();
  emit();
  return route;
}

/** The route new pickups join, creating the first one on demand so a driver
 *  never has to press "new route" before they can take anything. */
export function activeRoute(): RouteMeta {
  load();
  const found = state.routes.find((r) => r.id === state.active);
  return found ?? newRoute();
}

export function setActive(id: string): void {
  load();
  if (!state.routes.some((r) => r.id === id)) return;
  state.active = id;
  persist();
  emit();
}

export function assignToActive(pickupId: string): string {
  const route = activeRoute();
  state.assign = { ...state.assign, [pickupId]: route.id };
  persist();
  emit();
  return route.id;
}

export function unassign(pickupId: string): void {
  load();
  if (!(pickupId in state.assign)) return;
  const next = { ...state.assign };
  delete next[pickupId];
  state.assign = next;
  persist();
  emit();
}

/** Drop a route once it has nothing in it. Renumbers nothing: "Route 2" stays
 *  Route 2 in a driver's head even after Route 1 is finished and gone. */
export function forgetRoute(id: string): void {
  load();
  state.routes = state.routes.filter((r) => r.id !== id);
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.assign)) if (v !== id) next[k] = v;
  state.assign = next;
  if (state.active === id) state.active = state.routes[state.routes.length - 1]?.id ?? null;
  persist();
  emit();
}

const snapshot = () => load();

export function useRoutes(): RouteState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Which route a pickup belongs to, or null if it predates routes. */
export function routeOf(st: RouteState, pickupId: string): string | null {
  return st.assign[pickupId] ?? null;
}
