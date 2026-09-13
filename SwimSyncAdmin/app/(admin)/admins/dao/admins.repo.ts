// Admins page — PostgREST table + auth reads. Thin wrappers; no logic, no mapping.

import { supabase } from "@/lib/supabase";

export function getUser() {
  return supabase.auth.getUser();
}

// Everything except invited-vs-active is client-readable under RLS (profiles,
// coaches, the owner column), so the table paints in one direct round-trip.
export function loadProfiles() {
  return supabase
    .from("profiles")
    .select("id, full_name, email, phone, admin_disabled_at")
    .eq("role", "tenant_admin")
    .order("created_at");
}

export function loadTenants() {
  return supabase.from("tenants").select("id, owner_profile_id");
}

export function loadCoaches() {
  return supabase.from("coaches").select("profile_id");
}
