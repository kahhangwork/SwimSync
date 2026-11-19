// Every PostgREST table read and write of the billing engine (generateInvoices /
// generateForTenant), moved verbatim out of core.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B2).
//
// THIN BY RULE: each function is the original query chain and nothing else. It
// returns the builder (awaited by the caller, so the request is sent at exactly the
// same point as before) or, for a batched read, the readPaged / readAllIn promise.
// No error handling here — every `if (error) throw` / fail-closed branch stays at
// its call site in the engine, unchanged by one character.
//
// TENANT ISOLATION LIVES IN THESE CHAINS. The engine runs with the service-role key,
// which bypasses RLS, so a dropped `.eq("tenant_id", …)` or class_id `.in()` here
// would put another tenant's rows on an invoice. The B-gate census compares every
// chain against the Part A sha.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import { readAllIn, readPaged } from "./paging.ts";

type Db = SupabaseClient<Database>;

// ── generateInvoices: the cron's tenant list ────────────────────────────────
export function listTenantIds(supabase: Db) {
  return supabase
    .from("tenants")
    .select("id")
    .order("id");
}

// ── Guards ──────────────────────────────────────────────────────────────────
export function readTenantSettings(supabase: Db, tenantId: string) {
  return supabase
    .from("tenants")
    .select("auto_invoice_enabled, invoice_run_day, suspended_at")
    .eq("id", tenantId)
    .maybeSingle();
}

export function readBillingPeriod(supabase: Db, billingMonth: string, tenantId: string) {
  return supabase
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", billingMonth)
      .eq("tenant_id", tenantId)
      .maybeSingle();
}

// ── Phase 1 ─────────────────────────────────────────────────────────────────
export function readClasses(supabase: Db, tenantId: string) {
  return supabase
    .from("classes")
    .select(
      "id, title, price_per_lesson, day_of_week, is_active, deactivated_at"
    )
    .eq("tenant_id", tenantId)   // isolation: RLS does not apply to service_role
    .order("id");
}

export function readMakeups(supabase: Db, tenantId: string, monthStart: string, monthEnd: string) {
  return supabase
    .from("makeup_bookings")
    .select("student_id, class_id, session_date, home_class_id")
    .eq("tenant_id", tenantId)
    .is("cancelled_at", null)
    .gte("session_date", monthStart)
    .lte("session_date", monthEnd);
}

/** Scoped transitively by class_id — `classes` is already tenant-filtered (see the
 *  call site for why the home-class union is gone). */
export function readClassRates(supabase: Db, classes: readonly { id: string }[] | null) {
  return supabase
    .from("class_rates")
    .select("class_id, price_per_lesson, paid_coach_id, effective_from")
    .in("class_id", [
      ...new Set((classes ?? []).map((c) => c.id as string)),
    ]);
}

export function readTrialRates(supabase: Db, tenantId: string) {
  return supabase
    .from("trial_rates")
    .select("category_id, rate, effective_from")
    .eq("tenant_id", tenantId);
}

export function readSessionsIn(supabase: Db, classIds: string[], monthStart: string, monthEnd: string) {
  return readAllIn(
      classIds,
      (ids) =>
        supabase
          .from("lesson_sessions")
          .select("id, class_id, session_date, cancelled_at", { count: "exact" })
          .in("class_id", ids)
          .gte("session_date", monthStart)
          .lte("session_date", monthEnd),
      "lesson_sessions"
    );
}

export function readBookingsIn(supabase: Db, classIds: string[], monthStart: string, monthEnd: string) {
  return readAllIn(
      classIds,
      (ids) =>
        supabase
          .from("trial_bookings")
          .select("id, class_id, student_id, session_date, category_id", { count: "exact" })
          .in("class_id", ids)
          .is("cancelled_at", null)
          .gte("session_date", monthStart)
          .lte("session_date", monthEnd),
      "trial_bookings"
    );
}

export function readEnrolmentsIn(supabase: Db, classIds: string[]) {
  return readAllIn(
      classIds,
      (ids) =>
        supabase
          .from("student_class_enrolments")
          .select("id, class_id, student_id, enrolled_at, unenrolled_at, is_active", { count: "exact" })
          .in("class_id", ids),
      "student_class_enrolments"
    );
}

export function readAttendanceIn(supabase: Db, sessionIds: string[]) {
  return readAllIn(
      sessionIds,
      (ids) =>
        supabase
          .from("attendance")
          .select("id, lesson_session_id, student_id, status", { count: "exact" })
          .in("lesson_session_id", ids),
      "attendance"
    );
}

export function readParentStudentsIn(supabase: Db, studentIds: string[]) {
  return readAllIn(
      studentIds,
      (ids) =>
        supabase
          .from("parent_students")
          .select("id, parent_id, student_id", { count: "exact" })
          .in("student_id", ids),
      "parent_students"
    );
}

export function readStudentNamesIn(supabase: Db, studentIds: string[]) {
  return readAllIn(
      studentIds,
      (ids) =>
        supabase.from("students").select("id, full_name", { count: "exact" }).in("id", ids),
      "students"
    );
}

// ── Unclaimed attendance ────────────────────────────────────────────────────
export function readSettlements(supabase: Db, unclaimedStudentIds: string[]) {
  return supabase
      .from("student_settlements")
      .select("student_id, settled_through")
      .in("student_id", unclaimedStudentIds)
      .is("reversed_at", null);
}

export function readUnsettledNames(supabase: Db, unsettled: readonly { student_id: string }[]) {
  return supabase
        .from("students")
        .select("id, full_name")
        .in("id", [...new Set(unsettled.map((u) => u.student_id))]);
}

// ── Lessons a package already paid for ─────────────────────────────────────
export function readDrawnChunk(supabase: Db, itemSessionIds: string[], i: number) {
  return supabase
      .from("package_applications")
      .select("lesson_session_id, student_id")
      .in("lesson_session_id", itemSessionIds.slice(i, i + 200))
      .is("reversed_at", null);
}

// ── Phase 2 ─────────────────────────────────────────────────────────────────
export function readExistingInvoices(supabase: Db, tenantId: string, billingMonth: string) {
  return readPaged(
          () =>
            supabase
              .from("invoices")
              .select("id, parent_id", { count: "exact" })
              .eq("tenant_id", tenantId)
              .eq("billing_month", billingMonth),
          "id",
          "invoices (already billed)"
        );
}

export function readBalances(supabase: Db, tenantId: string) {
  return readPaged(
          () =>
            supabase
              .from("parent_tenant_balances")
              .select("parent_id, credit_balance, debit_balance", { count: "exact" })
              .eq("tenant_id", tenantId),
          "parent_id",
          "parent_tenant_balances"
        );
}

export function insertInvoice(
  supabase: Db,
  parentId: string,
  tenantId: string,
  billingMonth: string,
  gross: number,
  credit: number,
  net: number,
) {
  return supabase
      .from("invoices")
      .insert({
        parent_id: parentId,
        tenant_id: tenantId,
        billing_month: billingMonth,
        gross_amount: gross,
        package_applied: 0, // only pre-removal invoices carry a value here
        credit_applied: credit,
        net_amount: net,
        status: net === 0 ? "paid" : "outstanding",
      })
      // due_date comes back from the BEFORE INSERT trigger — never sent, never computed here.
      .select("id, due_date")
      .single();
}

export function insertInvoiceItems(
  supabase: Db,
  items: readonly Omit<Database["public"]["Tables"]["invoice_items"]["Insert"], "invoice_id">[],
  invoice: { id: string },
) {
  return supabase
      .from("invoice_items")
      .insert(items.map((i) => ({ invoice_id: invoice.id, ...i })));
}

export function readSettledInvoice(supabase: Db, invoice: { id: string }) {
  return supabase
        .from("invoices")
        .select("net_amount, balance_adjustment")
        .eq("id", invoice.id)
        .single();
}

/** DO NOTHING on conflict — see the seal block at the call site. */
export function sealBillingMonth(supabase: Db, tenantId: string, billingMonth: string, invoicesCreated: number) {
  return supabase.from("billing_periods").upsert(
      {
        tenant_id: tenantId,
        billing_month: billingMonth,
        invoices_issued: invoicesCreated,
        notes:
          invoicesCreated === 0
            ? "No billable sessions found for this month."
            : `All ${invoicesCreated} invoice(s) generated successfully.`,
      },
      { onConflict: "tenant_id,billing_month", ignoreDuplicates: true }
    );
}
