// The Packages feature's Postgres functions + the package-emails Edge Function
// binding + the tenant lookup. Stage 3 of
// docs/refactor/PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ THESE ARE NOT DATA ACCESS. The RPCs are business logic that lives in
// Postgres: multi-table atomic writes behind RLS, the referral trigger, the
// package guards (RISK 1/2/4/12). They sit apart from packages.repo.ts so that
// nobody ever reimplements one "for clarity" in TypeScript — in this codebase
// that is precisely how an override lands on a guard CLAUDE.md says must never
// have one.
//
//   The domain tier may ORCHESTRATE an rpc. It may never REPLACE one.
//
// The suggest/preview wrappers keep their try/catch + fail-open fallbacks here,
// verbatim: they are the ⚠ RISK 7 contract (never block a sale/preview), and
// they are the ONE source of truth so no hook re-implements them (RISK 4).

import { supabase } from "@/lib/supabase";
import { todayInSg } from "@/lib/lessonDates";

/** The caller's own business id. Every insert payload stamps tenant_id from
 *  here; RLS scopes reads without it. */
export async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.user.id)
    .single();
  return (data?.tenant_id as string | null) ?? null;
}

/** Live balances by package id — the RPC's number, never recomputed above. */
export const liveBalances = () => supabase.rpc("package_live_balances");

// Pre-fill a start date from the smart default. ⚠ RISK 7: this is only a
// suggestion — any failure falls back to today, never blocks the flow.
export async function fetchSuggestedStart(parentId: string, productId: string) {
  try {
    const { data, error: err } = await supabase.rpc("suggest_package_start", {
      p_parent_id: parentId,
      p_product_id: productId,
    });
    if (err || !data) return todayInSg();
    return String(data);
  } catch {
    return todayInSg();
  }
}

// ⚠ RISK 7 — the ONE source of truth for any pre-insert price preview. Never
// lesson_count × rate: that ignores the family's referral reward.
export async function fetchPreviewPrice(parentId: string, productId: string) {
  try {
    const { data, error: err } = await supabase.rpc("preview_package_price", {
      p_parent_id: parentId,
      p_product_id: productId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (err || !row) return null;
    return {
      total: Number(row.total_value),
      discount: Number(row.discount_amount),
      payable: Number(row.amount_payable),
    };
  } catch {
    return null;
  }
}

export const extendPackage = (packageId: string, days: number, reason: string) =>
  supabase.rpc("extend_package", {
    p_package_id: packageId,
    p_days: days,
    p_reason: reason,
  });

export const createPackageOffer = (
  parentId: string,
  productId: string,
  startDate: string
) =>
  supabase.rpc("create_package_offer", {
    p_parent_id: parentId,
    p_product_id: productId,
    p_start_date: startDate,
  });

export const renewalCandidates = () => supabase.rpc("package_renewal_candidates");

/** Fire a package-emails Edge Function call. Returns the promise WITHOUT a
 *  catch — the caller keeps its own `.catch(() => {})`, because these are all
 *  best-effort and must never block or fail the action that triggered them. */
export const invokePackageEmail = (body: Record<string, unknown>) =>
  supabase.functions.invoke("package-emails", { body });
