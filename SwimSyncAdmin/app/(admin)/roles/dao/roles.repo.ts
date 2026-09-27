// Roles page — PostgREST reads + the owner-only role RPCs. Thin wrappers.

import { supabase } from "@/lib/supabase";

export function loadRoles() {
  return supabase.from("tenant_roles").select("id, name, standard_key").order("name");
}

export function loadRolePermissions() {
  return supabase.from("tenant_role_permissions").select("role_id, area, level");
}

/** Who holds each role — co-admins of this business (profiles RLS scopes it). */
export function loadHolders() {
  return supabase
    .from("profiles")
    .select("admin_role_id")
    .eq("role", "tenant_admin")
    .not("admin_role_id", "is", null);
}

export function createRole(name: string, grid: Record<string, string>) {
  return supabase.rpc("create_role", { p_name: name, p_grid: grid });
}

export function updateRolePermissions(roleId: string, grid: Record<string, string>) {
  return supabase.rpc("update_role_permissions", { p_role_id: roleId, p_grid: grid });
}

export function renameRole(roleId: string, name: string) {
  return supabase.rpc("rename_role", { p_role_id: roleId, p_name: name });
}

export function deleteRole(roleId: string) {
  return supabase.rpc("delete_role", { p_role_id: roleId });
}
