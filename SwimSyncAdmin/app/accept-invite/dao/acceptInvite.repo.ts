import { supabase } from "@/lib/supabase";

export function getSession() {
  return supabase.auth.getSession();
}

/**
 * ⚠ Returns the SUBSCRIPTION HANDLE (BATCH_E_PLAN.md RISK 2): the caller's
 * effect cleanup calls .unsubscribe() on it. Swallow it here and every mount
 * leaks a listener that outlives the page.
 */
export function onAuthStateChange(
  cb: (event: string, session: unknown) => void
) {
  return supabase.auth.onAuthStateChange(cb as any);
}

export function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function loadBusinessName() {
  return supabase
    .from("profiles")
    // The !tenant_id hint is load-bearing: tenants also points back at
    // profiles via owner_profile_id (20260806000100), so a bare
    // tenants(...) embed is ambiguous and PostgREST refuses it.
    .select("tenants!tenant_id(display_name)")
    .maybeSingle();
}
