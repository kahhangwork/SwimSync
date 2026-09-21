import { supabase } from "@/lib/supabase";

/**
 * ⚠ `redirectTo` is passed IN by the caller, computed at call time (RISK 2/§7.41).
 * Nothing here may read `window` at module scope — these pages prerender at
 * `next build` — and the value itself must not be changed: Supabase's
 * additional_redirect_urls allow-list is exact-match, and a substituted URL
 * still "works" while landing the user nowhere useful.
 */
export function sendResetEmail(email: string, redirectTo: string) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
}
