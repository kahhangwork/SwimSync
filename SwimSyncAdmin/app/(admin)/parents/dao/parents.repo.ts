// Parents page — PostgREST table access. Thin functions returning the raw
// { data, error }; no logic, no mapping (that lives in domain/). See the tier
// boundary test: nothing outside dao/ may touch the supabase client.

import { supabase } from "@/lib/supabase";

// RLS scopes this to the caller's own business — parent_tenants_select hides
// other businesses' memberships, which is why no tenant filter is written here.
export function loadFamilies() {
  return supabase
    .from("parent_tenants")
    .select(
      "parent_id, tenant_id, is_active, inactivated_at, parents(profiles(full_name, email, phone))"
    );
}

export function loadKids(parentIds: string[]) {
  return supabase
    .from("parent_students")
    .select("parent_id, students(id, full_name, is_active, tenant_id)")
    .in(
      "parent_id",
      parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]
    );
}
