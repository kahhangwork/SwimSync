// Data access for the Accounting page — the ownership read, as thin functions
// returning the raw { data, error } for the caller to check. No mapping, no
// logic: the owner comparison lives in domain/useAccounting.
import { supabase } from "@/lib/supabase";

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function loadTenants() {
  return supabase.from("tenants").select("id, owner_profile_id");
}
