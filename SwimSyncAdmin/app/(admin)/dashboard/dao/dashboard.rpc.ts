import { supabase } from "@/lib/supabase";

export function regenerateJoinCode(tenantId: string) {
  return supabase.rpc("regenerate_join_code", { p_tenant_id: tenantId });
}

/**
 * Payment-method chips for the mini-table. The CALLER keeps this
 * fire-and-forget (BATCH_E_PLAN.md RISK 5): a failed RPC means no chips,
 * never a broken dashboard.
 */
export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}
