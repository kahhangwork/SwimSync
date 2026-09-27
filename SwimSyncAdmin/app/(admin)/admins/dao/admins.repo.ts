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
    .select("id, full_name, email, phone, admin_disabled_at, admin_role_id")
    .eq("role", "tenant_admin")
    .order("created_at");
}

export function loadTenants() {
  return supabase.from("tenants").select("id, owner_profile_id");
}

// Roles are readable by any active admin of the business (tenant_roles_select).
export function loadRoles() {
  return supabase.from("tenant_roles").select("id, name, standard_key");
}

export function loadRolePermissions() {
  return supabase.from("tenant_role_permissions").select("role_id, area, level");
}

export function assignRole(profileId: string, roleId: string) {
  return supabase.rpc("assign_admin_role", { p_profile_id: profileId, p_role_id: roleId });
}

export function loadCoaches() {
  return supabase.from("coaches").select("profile_id");
}
