// The registered restaurant.
//
// Registering once removes the "Your business" field from every later claim,
// which is the actual payoff -- signup friction is only worth it if it buys
// something back. It is also what makes the SB 1383 log attribute a drop to
// the right business rather than to whatever was typed at 10pm.
//
// Supabase path: the restaurants table is owner-scoped by RLS, so "my
// restaurant" is just a select with no filter. Local path: one localStorage
// key. Both resolve through the same promise, so the landing gate never has to
// know which one it is waiting on.

import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import type { Restaurant } from "../types";

const KEY = "surplus-street-account-v1";

let current: Restaurant | null = null;
let resolved = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export async function initAccount(): Promise<Restaurant | null> {
  if (!supabase) {
    try {
      current = JSON.parse(localStorage.getItem(KEY) || "null") as Restaurant | null;
    } catch {
      current = null;
    }
    resolved = true;
    emit();
    return current;
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    resolved = true;
    emit();
    return null;
  }

  const { data, error } = await supabase.from("restaurants").select("*").maybeSingle();
  if (error) console.warn("could not load restaurant:", error.message);
  current = (data as Restaurant | null) ?? null;
  resolved = true;
  emit();
  return current;
}

export async function register(details: Restaurant): Promise<Restaurant> {
  if (!supabase) {
    current = details;
    try {
      localStorage.setItem(KEY, JSON.stringify(details));
    } catch (err) {
      console.warn("account could not be saved:", err);
    }
    emit();
    return details;
  }

  const { data, error } = await supabase
    .from("restaurants")
    .insert({
      name: details.name,
      address: details.address,
      business_type: details.business_type,
      contact_name: details.contact_name,
      email: details.email,
      phone: details.phone,
      typical_meals: details.typical_meals,
      surplus_days: details.surplus_days,
    })
    .select()
    .single();

  if (error) throw error;
  current = data as Restaurant;
  emit();
  return current;
}

export async function signOut(): Promise<void> {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode -- nothing to clear */
  }
  if (supabase) await supabase.auth.signOut();
  emit();
}

const snapshot = () => current;
const serverSnapshot = () => null;

export function useAccount(): Restaurant | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function accountResolved(): boolean {
  return resolved;
}
