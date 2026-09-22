// Data access for the Invoices page — every PostgREST `.from()` and the auth
// reads, as thin wrappers returning the raw `{ data, error }`. No mapping, no
// state, no logic beyond the query itself (the callers own error handling and
// row → entity mapping). Tier rule: dao/ imports the client and @/lib pure
// helpers only — never React, never ui/, never @/components.

import { supabase } from "@/lib/supabase";
import { ilikeContains } from "@/lib/tableSearch";
import { ROW_LIMIT } from "../constants";
import type { SearchField } from "../types";

export const getUser = () => supabase.auth.getUser();
export const getSession = () => supabase.auth.getSession();

export const fetchProfile = (userId: string) =>
  supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userId)
    .maybeSingle();

export const fetchTenant = (tenantId: string) =>
  supabase
    .from("tenants")
    .select(
      "display_name, auto_invoice_enabled, invoice_run_day, paynow_uen, paynow_mobile"
    )
    .eq("id", tenantId)
    .maybeSingle();

export const updateTenant = (
  tenantId: string,
  patch: Record<string, unknown>
) => supabase.from("tenants").update(patch).eq("id", tenantId);

// ── Coverage pre-flight (loadCoverage) ──────────────────────────────────────
// ⚠ NO `is_active` FILTER, DELIBERATELY — and `deactivated_at` comes with it.
// The ENGINE bills every class, active or not, and keeps a retired class's
// recorded sessions in its completeness gate (core.ts). While this query
// filtered `is_active`, a retired class holding an unmarked lesson blocked
// generation and was invisible to the dialog: the admin read "all marked",
// pressed Generate, and got a refusal naming a class on no screen they could
// reach — §8.32's deadlock on a visibility axis. computeClassCoverage() clamps
// a retired class's WEEKLY expectation at `deactivated_at` (a DATE, §7.109)
// while still reporting sessions that genuinely ran, which is the engine's rule
// exactly. §7.18.
export const fetchCoverageClasses = (tenantId: string) =>
  supabase
    .from("classes")
    .select("id, title, day_of_week, is_active, deactivated_at")
    .eq("tenant_id", tenantId);

export const fetchEnrolments = (classIds: string[]) =>
  supabase
    .from("student_class_enrolments")
    // unenrolled_at is needed as well as enrolled_at: who must be marked is a
    // question about the LESSON'S date, so an enrolment is a span, not a flag.
    // See EnrolmentSpan in lib/attendanceCompleteness.ts.
    .select("class_id, student_id, is_active, enrolled_at, unenrolled_at")
    .in("class_id", classIds);

export const fetchSessions = (classIds: string[], start: string, end: string) =>
  supabase
    .from("lesson_sessions")
    .select("id, class_id, session_date")
    .in("class_id", classIds)
    .gte("session_date", start)
    .lte("session_date", end);

// Trial AND make-up bookings. Without these this check and the ENGINE disagree:
// the engine expects a booked child on their lesson and refuses to seal, while
// the dialog would report the month all clear. §7.18 is exactly that divergence,
// and it cost a live underbill. Both kinds satisfy the same "expected at one
// lesson" contract, so the caller merges them into one bookings list.
export const fetchTrialBookings = (
  classIds: string[],
  start: string,
  end: string
) =>
  supabase
    .from("trial_bookings")
    .select("class_id, student_id, session_date")
    .in("class_id", classIds)
    .is("cancelled_at", null)
    .gte("session_date", start)
    .lte("session_date", end);

export const fetchMakeupBookings = (
  classIds: string[],
  start: string,
  end: string
) =>
  supabase
    .from("makeup_bookings")
    .select("class_id, student_id, session_date")
    .in("class_id", classIds)
    .is("cancelled_at", null)
    .gte("session_date", start)
    .lte("session_date", end);

// NB the attendance select is by SESSION, not by student, so a booked child's
// row is already included — no second query needed.
export const fetchAttendance = (sessionIds: string[]) =>
  supabase
    .from("attendance")
    .select("lesson_session_id, student_id")
    .in("lesson_session_id", sessionIds);

export const fetchStudentTenant = (studentId: string) =>
  supabase.from("students").select("tenant_id").eq("id", studentId).single();

export const insertSettlement = (payload: Record<string, unknown>) =>
  supabase.from("student_settlements").insert(payload);

export const fetchPendingDebits = (tenantId: string) =>
  supabase
    .from("parent_tenant_balances")
    .select("parent_id, tenant_id, debit_balance, parents(profiles(full_name))")
    .eq("tenant_id", tenantId)
    .gt("debit_balance", 0);

// The invoices list. PARENT search is a clean DB pushdown (invoice → ONE parent,
// so !inner narrows nothing wrong). STUDENT search is deliberately NOT pushed:
// an invoice has MANY items, and a `.ilike` on the invoice_items embed filters
// the returned items too — collapsing a multi-child invoice's student list to
// just the searched child, which would then misstate the WhatsApp reminder and
// CSV (a financial communication). So the items embed stays plain and student
// search runs client-side over the fetched set (bounded by the cap banner).
export const fetchInvoices = (term: string, searchField: SearchField) => {
  const parentEmbed =
    term !== "" && searchField === "parent"
      ? "parents!inner(profiles!inner(full_name, phone))"
      : "parents(profiles(full_name, phone))";

  let query = supabase
    .from("invoices")
    .select(
      `id, billing_month, gross_amount, package_applied, credit_applied, balance_adjustment, net_amount, status, reference_number, public_token, reminded_at, paid_claimed_at, ${parentEmbed}, invoice_items(student_name, students(full_name))`
    )
    .order("generated_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (term !== "" && searchField === "parent") {
    // Bound `.ilike`, so punctuation in a name is literal.
    query = query.ilike("parents.profiles.full_name", ilikeContains(term));
  }

  return query;
};

export const updateInvoiceReminded = (invoiceId: string, stamp: string) =>
  supabase.from("invoices").update({ reminded_at: stamp }).eq("id", invoiceId);

// ── Billing months card (docs/plans/BILLING_MONTHS_PLAN.md §6) ──────────────
// The seal per month. RLS (billing_periods_select) already scopes to the
// admin's business; the tenant filter is explicit anyway, as everywhere here.
export const fetchBillingPeriods = (tenantId: string) =>
  supabase
    .from("billing_periods")
    .select("billing_month, completed_at, invoices_issued")
    .eq("tenant_id", tenantId);

// The run log, newest first. 200 is far above any real need (≈1–5 runs a
// month, and refusals-to-attempt are never logged — runLog.ts ⚠ RISK 3).
export const fetchBillingRuns = (tenantId: string) =>
  supabase
    .from("billing_runs")
    .select(
      "id, billing_month, ran_at, mode, status, sealed, invoices_created, unclaimed_billable, earlier_unbilled_month, blocking, unclaimed_students, error, profiles(full_name)"
    )
    .eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false })
    .limit(200);

// Which months have ANY invoice — an open month whose runs predate the run log
// shows up through this. ⚠ RISK 10: PostgREST caps a read at 1,000 rows, so the
// read is bounded to recent months and ordered newest-first; an older month is
// either sealed or visible through a run row.
export const fetchInvoiceMonths = (tenantId: string, fromMonth: string) =>
  supabase
    .from("invoices")
    .select("billing_month")
    .eq("tenant_id", tenantId)
    .gte("billing_month", fromMonth)
    .order("billing_month", { ascending: false });

// ⚠ RISK 6: which of a stored run's unclaimed students have since been claimed
// (a parent registered). Read at the moment the admin opens the modal.
export const fetchClaimedStudentIds = (studentIds: string[]) =>
  supabase
    .from("parent_students")
    .select("student_id")
    .in("student_id", studentIds);

// …and which have a LIVE settlement (a reversed one no longer settles anything).
export const fetchLiveSettlements = (studentIds: string[]) =>
  supabase
    .from("student_settlements")
    .select("student_id, settled_through")
    .in("student_id", studentIds)
    .is("reversed_at", null);
