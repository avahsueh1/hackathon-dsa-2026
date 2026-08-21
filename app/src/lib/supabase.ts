// One client.
//
// The URL and publishable key default to the backend repo's live project.
// They are committed there too, and their supabaseClient.js documents why
// that is safe: the key is the publishable/anon key, and Row Level Security
// on zones/claims -- not key secrecy -- controls what it can do. Never the
// service_role key.
//
// A .env can still override both, so pointing at a different project is a
// config change rather than a code change.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL || "https://agpfsxvgjzthuckmmuad.supabase.co";
const KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_dGYMR1Kfa_YU3H2yWOyb7Q__Q0E57Rg";

// Set VITE_SUPABASE_OFFLINE=1 to force the localStorage path -- useful for
// demoing on venue wifi that blocks outbound, and for testing the fallback.
const OFFLINE = import.meta.env.VITE_SUPABASE_OFFLINE === "1";

export const supabase: SupabaseClient | null =
  OFFLINE || !URL || !KEY
    ? null
    : createClient(URL, KEY, {
        // No auth system exists on the backend (their RLS is trust-based for
        // the demo), so there is no session to persist or refresh.
        auth: { persistSession: false, autoRefreshToken: false },
      });

export const hasBackend = supabase !== null;
