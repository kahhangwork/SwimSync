import { supabase } from "@/lib/supabase";

// Three functions, not one (BATCH_E_PLAN.md RISK 8 / the levels precedent):
// the auth lookup, the tenant lookup and the write stay separate so the hook
// keeps the page's original call ORDER visible, and the 23505/23514 mapping
// stays where an admin-facing message belongs.

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function loadProfileTenantId(userId: string | undefined) {
  return supabase.from("profiles").select("tenant_id").eq("id", userId).single();
}

export function loadLocations() {
  // RLS scopes this to the caller's own business. Archived locations are
  // excluded — "delete" is archive, and an archived one is gone from the list.
  return supabase
    .from("locations")
    .select("id, name, address, notes, sort_order, classes(id, is_active)")
    .is("archived_at", null)
    .order("sort_order")
    .order("name");
}

type LocationPayload = {
  name: string;
  address: string | null;
  notes: string | null;
  sort_order: number;
  updated_at: string;
};

export function updateLocation(id: string, payload: LocationPayload) {
  return supabase.from("locations").update(payload).eq("id", id);
}

export function insertLocation(
  payload: LocationPayload,
  // May be undefined if the profile lookup failed — passed through exactly as
  // the page did it, so RLS refuses it and the caller shows its usual message.
  tenantId: string | undefined
) {
  return supabase.from("locations").insert({
    ...payload,
    // The caller's own business — RLS refuses any other value, and this is
    // what satisfies the WITH CHECK in the first place (the /levels shape).
    tenant_id: tenantId,
  });
}

export function archiveLocation(id: string) {
  return supabase
    .from("locations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}
