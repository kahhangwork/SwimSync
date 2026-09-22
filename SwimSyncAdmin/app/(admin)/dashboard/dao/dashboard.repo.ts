import { supabase } from "@/lib/supabase";

/**
 * The six metric counts, plus the inactive count.
 *
 * ONE function holding the whole `Promise.all` VERBATIM, not seven exported
 * builders for a hook to re-list (BATCH_E_PLAN.md RISK 5): re-listing them
 * elsewhere is exactly the edit that shifts the positional destructure below.
 */
export function countMetrics() {
  // ORDER IS THE CONTRACT: these are destructured POSITIONALLY, so a new
  // query goes on the END of both lists. Insert one in the middle and every
  // metric below it shifts by one — Outstanding Invoices would render the
  // credit-note count, silently, because they are all small plausible
  // integers on the first screen an admin sees.
  return Promise.all([
    // Active only. A child who has left is still a row — attendance and
    // invoices reference them forever (PRD §7.14) — so an unfiltered count
    // answers a bookkeeping question nobody asked and drifts upward as
    // families come and go.
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("assignment_status", "unassigned")
      .eq("is_active", true),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("status", "outstanding"),
    supabase
      .from("credit_notes")
      // A 'reversed' note was voided (20260818000100) — not live credit.
      .select("id", { count: "exact", head: true })
      .neq("status", "reversed"),
    supabase.from("coaches").select("id", { count: "exact", head: true }),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    // Appended LAST, per the note above.
    //
    // A head count, NOT `select("is_active")` counted in the browser:
    // PostgREST silently caps rows at max_rows = 1000, so a client-side
    // count would under-report with no error once a business passes it —
    // the trap already written up in platform/page.tsx. A head count is
    // exact at any size.
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("is_active", false),
  ]);
}

export function loadUnassigned() {
  return supabase
    .from("students")
    .select("id, full_name, parent_students(parents(profiles(full_name)))")
    .eq("assignment_status", "unassigned")
    .eq("is_active", true)
    .order("full_name")
    .limit(5);
}

export function loadOutstandingInvoices() {
  return supabase
    .from("invoices")
    .select("id, billing_month, net_amount, parents(profiles(full_name))")
    .eq("status", "outstanding")
    .order("generated_at", { ascending: false })
    .limit(5);
}

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function loadProfileTenantId(userId: string) {
  return supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
}

export function loadTenant(tenantId: string) {
  return supabase
    .from("tenants")
    .select("id, display_name, join_code")
    .eq("id", tenantId)
    .maybeSingle();
}

export function renameTenant(tenantId: string, displayName: string) {
  return supabase
    .from("tenants")
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
}

// ── The billing-months alert (docs/plans/BILLING_MONTHS_PLAN.md D1/D5) ───────
// The same three reads as the Invoices page's Billing months card, plus the run
// day. Kept lean — the alert needs each month's state and reason, not the runs'
// full history.
export function loadBillingMonthsInput(tenantId: string, fromMonth: string) {
  return Promise.all([
    supabase.from("tenants").select("invoice_run_day").eq("id", tenantId).maybeSingle(),
    supabase
      .from("billing_periods")
      .select("billing_month, completed_at, invoices_issued")
      .eq("tenant_id", tenantId),
    supabase
      .from("billing_runs")
      .select(
        "id, billing_month, ran_at, mode, status, sealed, invoices_created, unclaimed_billable, earlier_unbilled_month, blocking, unclaimed_students, error"
      )
      .eq("tenant_id", tenantId)
      .order("ran_at", { ascending: false })
      .limit(200),
    // ⚠ RISK 10: bounded and newest-first (PostgREST's 1,000-row cap).
    supabase
      .from("invoices")
      .select("billing_month")
      .eq("tenant_id", tenantId)
      .gte("billing_month", fromMonth)
      .order("billing_month", { ascending: false }),
  ]);
}
