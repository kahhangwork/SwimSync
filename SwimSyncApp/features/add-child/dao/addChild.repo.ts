// Every PostgREST read the Add Child screen makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). Raw builder, byte-identical to the chain it replaced in
// app/(parent)/home/add-child.tsx — the ⚠ is-active gating comment stays at the
// call site in domain/useAddChild.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchActiveJoinedTenants = () =>
  supabase
    .from("parent_tenants")
    .select("tenant_id, is_active, tenants(id, display_name)")
    .eq("is_active", true)
    .order("joined_at");
