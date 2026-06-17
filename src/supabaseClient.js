import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSession } from "@clerk/clerk-react";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// Returns a Supabase client whose requests carry the current Clerk session token.
// Supabase validates that token via the native Clerk third-party auth integration,
// so RLS policies can read the Clerk user id from auth.jwt()->>'sub'.
// Must be called inside <ClerkProvider>. Returns null if Supabase isn't configured.
export function useClerkSupabaseClient() {
  const { session } = useSession();
  return useMemo(() => {
    if (!isSupabaseConfigured()) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      accessToken: async () => (session ? await session.getToken() : null),
    });
  }, [session]);
}
