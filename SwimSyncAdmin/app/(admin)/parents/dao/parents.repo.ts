// Parents page — PostgREST table access. Thin functions returning the raw
// { data, error }; no logic, no mapping (that lives in domain/). See the tier
// boundary test: nothing outside dao/ may touch the supabase client.

import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";

// The rows each read returns. Every to-one embed is widened to `| null` — RLS
// nulls a hidden embed whatever the generated type says (§7.344) — and
// domain/parentsRows.ts keeps its `?.` / `??` / filter on each.
type FamilySelected = DataOf<typeof loadFamilies>[number];
export type FamilySelectRow = Omit<FamilySelected, "parents"> & {
  parents: RlsNullable<NonNullable<FamilySelected["parents"]>, "profiles"> | null;
};
export type FamilyProfile = NonNullable<NonNullable<FamilySelectRow["parents"]>["profiles"]>;
export type KidSelectRow = RlsNullable<DataOf<typeof loadKids>[number], "students">;

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
