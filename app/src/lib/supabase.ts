// One client, created only if the env vars are present.
//
// The backend lives in a separate repo (siapatodia8/dsa-hackathon-2026) and may
// not be up yet, so the app has to run without it: with no VITE_SUPABASE_URL
// the store and the account fall back to localStorage and the demo still works
// end to end. Nothing else in the app branches on this -- only the two adapters
// below.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const hasBackend = supabase !== null;
