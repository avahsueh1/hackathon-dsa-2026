// Claims store.
//
// Same adapter idea as the single-file build, but expressed as an external
// store so components subscribe with useSyncExternalStore instead of the page
// re-rendering itself. Reads stay synchronous against an in-memory cache;
// writes are optimistic and reconcile afterwards. A claim that fails to save
// is worse than one that appears instantly, but a button that does nothing for
// 400ms at closing time is worse than both.
//
// With no Supabase env vars this is localStorage and the demo works offline.

import { useSyncExternalStore } from "react";
import { supabase, hasBackend } from "./supabase";
import type { Claim, NewClaim } from "../types";

const KEY = "surplus-street-claims-v1";

let cache: Claim[] = [];
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  // A new array identity every time, so useSyncExternalStore sees the change.
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function readLocal(): Claim[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Claim[];
  } catch {
    return [];
  }
}

function writeLocal(list: Claim[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("claims could not be saved:", err);
  }
}

function localId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${listeners.size}`;
}

// ------------------------------------------------------------------- load

async function refresh(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    // A dead backend must not blank the screen mid-service.
    console.warn("could not load claims:", error.message);
    return;
  }
  cache = (data ?? []) as Claim[];
  emit();
}

let started = false;

export function initStore(): void {
  if (started) return;
  started = true;

  if (!supabase) {
    cache = readLocal();
    ready = true;
    emit();
    return;
  }

  // Realtime is the whole product: another restaurant claims a zone and every
  // other screen has to show it without a refresh.
  supabase
    .channel("claims-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, () => {
      void refresh();
    })
    .subscribe();

  void refresh().finally(() => {
    ready = true;
    emit();
  });
}

// ------------------------------------------------------------------ writes

export async function addClaim(input: NewClaim): Promise<void> {
  const optimistic: Claim = {
    ...input,
    id: localId(),
    created_at: new Date().toISOString(),
  };

  cache = [optimistic, ...cache];
  emit();

  if (!supabase) {
    writeLocal(cache);
    return;
  }

  // created_by is filled by the column default (auth.uid()) and enforced by
  // RLS, so it is deliberately not sent from the client.
  const { error } = await supabase.from("claims").insert({
    zone: input.zone,
    zone_name: input.zone_name,
    meals: input.meals,
    drop_window: input.drop_window,
    food_description: input.food_description,
    donor_name: input.donor_name,
    drop_date: input.drop_date,
    status: input.status,
  });

  if (error) {
    console.warn("claim did not save:", error.message);
    cache = cache.filter((c) => c.id !== optimistic.id);
    emit();
    throw error;
  }
  await refresh();
}

/** The schema has no DELETE policy on purpose -- cancelling must leave the
 *  SB 1383 trail intact, so it is a status change. */
export async function cancelClaim(id: string): Promise<void> {
  cache = cache.map((c) => (c.id === id ? { ...c, status: "cancelled" as const } : c));
  emit();

  if (!supabase) {
    writeLocal(cache);
    return;
  }
  const { error } = await supabase.from("claims").update({ status: "cancelled" }).eq("id", id);
  if (error) {
    console.warn("cancel did not save:", error.message);
    await refresh();
  }
}

export async function clearLocalClaims(): Promise<void> {
  if (hasBackend) return;
  cache = [];
  writeLocal(cache);
  emit();
}

// ------------------------------------------------------------------- read

const snapshot = () => cache;
const serverSnapshot = () => EMPTY;
const EMPTY: Claim[] = [];

export function useClaims(): Claim[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function isReady(): boolean {
  return ready;
}
