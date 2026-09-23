// The Join screen's one call — `join_tenant_by_code` (docs/refactor/BATCH_FGH_PLAN.md,
// app fence). Raw builder, byte-identical.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const joinTenantByCode = (code: string) =>
  supabase.rpc("join_tenant_by_code", {
    p_code: code,
  });
