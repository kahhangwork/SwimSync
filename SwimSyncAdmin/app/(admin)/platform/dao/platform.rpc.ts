// Postgres function calls for the Platform page — every `.rpc()` this page makes.
// Stage 2/3 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. A function here wraps one RPC and returns its raw
// result. It does NOT re-implement, pre-validate, or second-guess what the RPC
// does: every one of these gates on is_platform_admin() ITSELF, and the page's
// own gate is a UX affordance, not the security boundary. A client-side check
// added here would be a second, weaker copy of a rule the database already owns.
//
// Their refusals surface VERBATIM to the operator — they are written for humans.
//
// dao/ is transport only: no React, no ui/, no @/components (fence check 2).

import { supabase } from "@/lib/supabase";

/**
 * One round trip for the whole overview.
 *
 * ⚠ The two results are returned RAW, as a pair, because the caller's handling
 * of them is deliberately ASYMMETRIC: the overview's error is surfaced, and the
 * stranded-parents error is swallowed. That is not an oversight to fix here — an
 * unchecked overview failure leaves the table empty, which reads as "no
 * businesses" (false reassurance on the one page that exists to show trouble),
 * while a stranded-parents failure just hides an advisory panel. Do NOT check
 * strandedRes.error in this file or in the caller.
 *
 * This replaced an N+1 loop of client-side counts. Two reasons, and the second
 * is the load-bearing one: the loop issued 2 queries per tenant, and more
 * importantly every client-side aggregate here is capped at max_rows = 1000
 * SILENTLY — no error, just fewer rows — while a platform admin reads every
 * tenant's data. Postgres has no such ceiling.
 */
export function loadOverview() {
  return Promise.all([
    supabase.rpc("platform_tenant_overview"),
    supabase.rpc("platform_stranded_parents"),
  ]);
}

/** The Change-owner dropdown feed: one business's admins. */
export function tenantAdmins(tenantId: string) {
  return supabase.rpc("platform_tenant_admins", { p_tenant_id: tenantId });
}

/** Move ownership of a business. Platform-admin only, enforced by the RPC. */
export function reassignOwner(tenantId: string, newOwnerProfileId: string) {
  return supabase.rpc("platform_reassign_owner", {
    p_tenant_id: tenantId,
    p_new_owner_profile_id: newOwnerProfileId,
  });
}

/**
 * Payment-method chips for the move tool's results.
 *
 * ⚠ DELIBERATELY NOT AWAITED by its caller — this returns the builder's promise
 * so the results table paints without waiting on the chips. Adding `await` here
 * or in the hook changes when the table renders, which is a behaviour change.
 *
 * Under a platform admin the RPC returns EVERY tenant's rows, each carrying its
 * tenant_id — the caller keys them per student, so a cross-tenant mixup is
 * structurally impossible.
 */
export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}

/** The cross-business move itself. The only write on this page that moves a child. */
export function reassignStudentTenant(studentId: string, tenantId: string) {
  return supabase.rpc("reassign_student_tenant", {
    p_student_id: studentId,
    p_tenant_id: tenantId,
  });
}
