// Every PostgREST read the Add Child screen makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). Raw builder, byte-identical to the chain it replaced in
// app/(parent)/home/add-child.tsx — the ⚠ is-active gating comment stays at the
// call site in domain/useAddChild.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";

export const fetchActiveJoinedTenants = () =>
  supabase
    .from("parent_tenants")
    .select("tenant_id, is_active, tenants(id, display_name)")
    .eq("is_active", true)
    .order("joined_at");

// Row type (Wave 8). `tenants` is a LEFT to-one embed RLS can null (§7.344) — the
// hook drops a null with `.filter(Boolean)`.
export type JoinedTenantRow = RlsNullable<DataOf<typeof fetchActiveJoinedTenants>[number], "tenants">;
