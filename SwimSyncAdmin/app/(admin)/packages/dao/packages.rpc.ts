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
import type { Assert, DataOf, Extends, Rpc } from "@/lib/database.overrides";

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
export type LiveBalanceRow = DataOf<typeof liveBalances>[number];

// Pre-fill a start date from the smart default. ⚠ RISK 7: this is only a
// suggestion — any failure falls back to today, never blocks the flow.
// p_student_id: the one child of a one-child sale (their enrolments and the
// packages usable by them); null for a shared product. Required here so no
// caller forgets it (§7.345).
export type SuggestPackageStartArgs = {
  p_parent_id: string;
  p_product_id: string;
  p_student_id: string | null;
};
type _CheckSuggest = Assert<Extends<SuggestPackageStartArgs, Rpc<"suggest_package_start">["Args"]>>;
export async function fetchSuggestedStart(parentId: string, productId: string, studentId: string | null) {
  try {
    const args: SuggestPackageStartArgs = {
      p_parent_id: parentId,
      p_product_id: productId,
      p_student_id: studentId,
    };
    const { data, error: err } = await supabase.rpc("suggest_package_start", args);
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

// p_student_id is REQUIRED (null = a shared/family offer): dropping it would
// silently turn a child's offer into a family one (RISK 4, §7.345).
export type CreatePackageOfferArgs = {
  p_parent_id: string;
  p_product_id: string;
  p_start_date: string;
  p_student_id: string | null;
};
type _CheckOffer = Assert<Extends<CreatePackageOfferArgs, Rpc<"create_package_offer">["Args"]>>;
export const createPackageOffer = (args: CreatePackageOfferArgs) =>
  supabase.rpc("create_package_offer", args);

// Change child (D4). The RPC is the authority on "unused" — a reversed draw
// restores the balance, so the balance cannot tell. Its refusals are sentences
// for the admin; the dialog shows error.message.
export type ReassignPackageChildArgs = { p_package: string; p_student: string };
type _CheckReassign = Assert<Extends<ReassignPackageChildArgs, Rpc<"reassign_package_child">["Args"]>>;
export const reassignPackageChild = (args: ReassignPackageChildArgs) =>
  supabase.rpc("reassign_package_child", args);

export const renewalCandidates = () => supabase.rpc("package_renewal_candidates");
export type RenewalCandidateRow = DataOf<typeof renewalCandidates>[number];

/** Fire a package-emails Edge Function call. Returns the promise WITHOUT a
 *  catch — the caller keeps its own `.catch(() => {})`, because these are all
 *  best-effort and must never block or fail the action that triggered them. */
export const invokePackageEmail = (body: Record<string, unknown>) =>
  supabase.functions.invoke("package-emails", { body });

// Refunds (20260928000200). The RPCs are the guard — amount cap, dates, closed
// months, one live refund — and their refusals are sentences meant for the
// admin; the modal shows error.message verbatim.
export const recordPackageRefund = (
  packageId: string,
  amount: number,
  refundedOn: string,
  note: string
) =>
  supabase.rpc("record_package_refund", {
    p_package: packageId,
    p_amount: amount,
    p_refunded_on: refundedOn,
    p_note: note || null,
  });

export const reversePackageRefund = (refundId: string) =>
  supabase.rpc("reverse_package_refund", { p_refund: refundId });

// Backdated activation (Wave 6 D5, migration A). Called only AFTER the
// activation write succeeded — the preview reads the package as active.
// ⚠ RISK 8: the preview is a dry run of the SAME matcher the draw uses, and the
// draw takes NO lesson list — it re-derives at call time and returns the count
// it drew (a second call draws 0). Never pass the preview rows back to it.
export const packageBacklogPreview = (packageId: string) =>
  supabase.rpc("package_backlog_preview", { p_package: packageId });

export const drawPackageBacklog = (packageId: string) =>
  supabase.rpc("draw_package_backlog", { p_package: packageId });
