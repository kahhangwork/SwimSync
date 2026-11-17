// Phase 1's reads, moved verbatim out of generateForTenant
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B5): the tenant's classes, make-ups, class and
// trial rates, then the batched per-table reads grouped for the class loop.
//
// Every read here happens BEFORE any invoice is written, and every error THROWS —
// exactly as before: a throw costs a retry and nothing else (index.ts records it
// as an error run). Never default a failed read to empty: a missing row is a
// missing line on an invoice.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import * as repo from "../dao/billing.repo.ts";
import { groupBy } from "./groupBy.ts";

/** Everything phase 1 read, as the class loop and phase 2 consume it (the B5
 *  slice contract — the only phase-1 values read after it). */
export type Phase1 = Awaited<ReturnType<typeof readPhase1>>;

export async function readPhase1(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  monthStart: string,
  monthEnd: string
) {
  // isolation: RLS does not apply to service_role — the tenant filter is in the dao.
  const { data: classes, error: clsErr } = await repo.readClasses(supabase, tenantId);

  if (clsErr) throw new Error(clsErr.message);

  // ── Make-up bookings: a child guests into ONE lesson of another class ─────
  // Loaded ONCE for the tenant, not per class like trials, because a booking
  // is resolved against its HOME class as well as its host.
  const { data: makeupRows, error: makeupErr } = await repo.readMakeups(supabase, tenantId, monthStart, monthEnd);

  if (makeupErr) throw new Error(makeupErr.message);

  // Effective-dated terms for those classes, fetched once rather than per
  // lesson. Scoped transitively by class_id — the classes query above is
  // already tenant-filtered, and RLS does not apply to service_role, so this
  // filter is the isolation.
  //
  // ⚠ IF YOU EVER RE-NARROW THE CLASSES SCAN ABOVE, RESTORE THE UNION HERE.
  // Until 2026-08-09 this `.in()` also carried
  // `...(makeupRows ?? []).map((m) => m.home_class_id)`, because the scan
  // filtered `.eq("is_active", true)`: a retired home class fell out of it, and
  // rateOn() (rates.ts — a hard throw, no fallback) then killed the whole run
  // for that tenant. The scan is no longer filtered, and book_makeup() derives
  // home_class_id from the child's own active enrolment — same tenant, by
  // construction — so every home class is already in `classes` and the arm was
  // unreachable.
  //
  // Removed rather than kept, and the reasoning is worth carrying: the arm's
  // guard was `makeups.test.ts:370`, which went VACUOUS the moment the scan
  // widened — measured, not predicted (with the arm deleted the makeups file
  // still passed 12/12, WAVE_1_PLAN.md's RISK 1 vacuity step). Dead code with
  // no test behind it, sitting in the money engine, reads as load-bearing to
  // the next person and is not. Its failure mode also argues for deletion:
  // a missing rate THROWS and stops the run — loud, and never a silent
  // underbill, which is the failure this whole change exists to prevent.
  const { data: classRates, error: rateErr } = await repo.readClassRates(supabase, classes);

  if (rateErr) throw new Error(rateErr.message);

  // ── Trial rates, per class category, effective-dated ──────────────────────
  // Loaded once for the tenant and resolved in memory, exactly like classRates.
  // A category with no rate is a REAL answer — "this business has not priced
  // trials" — and the caller falls back to the class rate. That is deliberately
  // unlike a missing CLASS rate, which is a hard failure (§6), because there the
  // only alternative would be silently charging 0.
  const { data: trialRates, error: trialRateErr } = await repo.readTrialRates(supabase, tenantId);

  if (trialRateErr) throw new Error(trialRateErr.message);

  // ── Batched phase-1 reads: one query per table for the whole tenant-month ──
  // Each replaces a query that used to run once per class inside the loop
  // below (see "Batched reads" at the top of this file). The loop body then
  // takes its class's slice from these maps, so it sees exactly the rows it
  // used to fetch. Same filters, same columns; the class_id filter became an
  // .in() over this tenant's classes, which is still the isolation (RLS does
  // not apply to service_role).
  // (Row types: types.ts — SessionRow … StudentNameRow.)

  const classIds = (classes ?? []).map((c) => c.id as string);
  const [allSessions, allBookings, allEnrolments] = await Promise.all([
    repo.readSessionsIn(supabase, classIds, monthStart, monthEnd),
    repo.readBookingsIn(supabase, classIds, monthStart, monthEnd),
    repo.readEnrolmentsIn(supabase, classIds),
  ]);

  // Per class, sessions in date order — what `.order("session_date")` gave the
  // per-class query. (class_id, session_date) is UNIQUE, so the order is total.
  const sessionsByClass = groupBy(allSessions, (s) => s.class_id);
  for (const list of sessionsByClass.values()) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  const bookingsByClass = groupBy(allBookings, (b) => b.class_id);
  const enrolmentsByClass = groupBy(allEnrolments, (e) => e.class_id);

  const attendanceBySession = groupBy(
    await repo.readAttendanceIn(supabase, allSessions.map((s) => s.id)),
    (a) => a.lesson_session_id
  );

  // Every student any class could bill: the per-class `billableStudentIds`
  // (enrolled ∪ attended) unioned across classes. Each class later takes only
  // the parent links of its OWN billable set, so reading the union changes no
  // class's rows — it only fetches them in one trip instead of one per class.
  const tenantBillableStudentIds = [
    ...new Set([
      ...allEnrolments.map((e) => e.student_id),
      ...[...attendanceBySession.values()].flat().map((a) => a.student_id),
    ]),
  ];
  const [allParentStudents, allBilledStudents] = await Promise.all([
    repo.readParentStudentsIn(supabase, tenantBillableStudentIds),
    repo.readStudentNamesIn(supabase, tenantBillableStudentIds),
  ]);
  const parentStudentsByStudent = groupBy(allParentStudents, (ps) => ps.student_id);
  // Names to snapshot onto each line (see InvoiceItem.student_name).
  const studentNameById = new Map(allBilledStudents.map((s) => [s.id, s.full_name]));

  return {
    classes,
    makeupRows,
    classRates,
    trialRates,
    sessionsByClass,
    bookingsByClass,
    enrolmentsByClass,
    attendanceBySession,
    parentStudentsByStudent,
    studentNameById,
  };
}
