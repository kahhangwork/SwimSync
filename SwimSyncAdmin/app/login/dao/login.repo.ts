import { supabase } from "@/lib/supabase";

export function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function loadProfileRole(userId: string) {
  return supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userId)
    .single();
}

// ⚠ Called ONLY from the role-refusal branch in domain/useLogin (RISK 1).
// Dropping it, or hoisting it out of that branch, leaves a coach's or parent's
// session live inside the admin panel.
export function signOut() {
  return supabase.auth.signOut();
}
