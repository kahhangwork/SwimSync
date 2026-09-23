// Every Postgres function the parent Home tab calls (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). Raw builders, byte-identical to the calls they replaced.
//
// dao/ is transport only (fence check 2).

import { supabase } from "@/lib/supabase";

// Payment-method badges. RLS scopes the rows to this family.
export const fetchPackageCoverage = () => supabase.rpc("student_package_coverage");

export const dismissStudentClaim = (id: string) =>
  supabase.rpc("dismiss_student_claim", { p_claim_id: id });

export const joinTenantByCode = (code: string) =>
  supabase.rpc("join_tenant_by_code", {
    p_code: code,
  });
