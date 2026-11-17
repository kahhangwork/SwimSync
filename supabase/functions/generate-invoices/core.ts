// Core billing engine for generate-invoices, extracted from the HTTP handler
// so it can be unit/integration-tested directly (see core.test.ts). The
// Deno.serve handler in index.ts does auth + client creation, then calls this.
//
//   • AUTO   — respects the business's auto switch and run day, the billing_periods
//              sealed guard, and the attendance-completeness gate; seals the
//              month when fully processed.
//   • MANUAL — ignores the switch/seal/gate; bills whatever is marked now.
//
// Structure: TWO PHASES, and the split matters.
//   Phase 1 — loop the classes and TALLY billable items into a single
//             cross-class `parentItems` map. No invoice is written here.
//   Phase 2 — after every class is tallied, create ONE invoice per parent.
//
// Creating invoices inside the class loop (the previous shape) under-billed
// any parent with children in two different classes: the invoice was created
// during the first class they appeared in, and the "already has an invoice"
// guard then skipped them for the second — silently dropping those lessons.
// PRD 5.5 requires all of a parent's eligible lessons on one invoice.
//
// Auto mode additionally DEFERS a parent entirely when any class one of their
// children is enrolled in has incomplete attendance: a partial invoice would
// be locked in by that same already-exists guard on tomorrow's retry, losing
// the rest permanently. Better to bill nothing and retry than to bill wrong.
// Both modes apply available credit FIFO via the credit_applications ledger.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../_shared/database.overrides.ts";
import {
  APP_TIMEZONE,
  dateInTimeZone,
  earliestEnrolmentDate,
  expectedLessonDates,
  previousBillingMonth,
} from "./dates.ts";
import { rateOn } from "./rates.ts";
// The ONE definition of who is expected at a lesson. Duplicated byte-identically
// in both apps (§6) — three edits, diffable. Do not inline the union here.
import {
  type EnrolmentSpan,
  expectedStudentsOn,
  studentsEnrolledOn,
} from "./attendanceCompleteness.ts";
import { runGuards } from "./domain/guards.ts";
import { readPhase1 } from "./domain/phase1.ts";
import { BILLABLE } from "./constants.ts";
import * as repo from "./dao/billing.repo.ts";
import * as rpc from "./dao/billing.rpc.ts";
import type {
  BlockingLesson,
  CreatedInvoice,
  GenerateOptions,
  GenerateResult,
  RunTimings,
  UnclaimedStudent,
} from "./types.ts";
// Re-exported: index.ts, bench/run.ts and the tests import these from core.ts.
export { BILLABLE } from "./constants.ts";
export { readPaged } from "./dao/paging.ts";
export type {
  BlockingLesson,
  CreatedInvoice,
  CreatedInvoiceItem,
  GenerateOptions,
  GenerateResult,
  RunTimings,
  UnclaimedStudent,
} from "./types.ts";



/**
 * Generate invoices — for one tenant, or for every tenant independently.
 *
 * TENANT ISOLATION IN BILLING IS ENFORCED HERE, IN CODE. The engine runs with
 * the service-role key, which BYPASSES RLS entirely, so none of the policies in
 * 20260718000900 protect this path. Every query below is scoped by tenant_id
 * explicitly; if one is missed, the RLS work does not catch it.
 *
 * Each tenant is billed, gated, blocked and sealed in COMPLETE ISOLATION: one
 * school's forgotten lesson must never hold up an unrelated coach's invoices,
 * and one business finishing a month must never seal it for anyone else.
 */
export async function generateInvoices(
  supabase: SupabaseClient<Database>,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const billingMonthForResult =
    opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)
      ? opts.billing_month
      : previousBillingMonth(opts.now instanceof Date ? opts.now : new Date());

  // Scoped run: one tenant, and the result IS that tenant's result — the admin
  // panel's shape is unchanged.
  if (opts.tenant_id) {
    return await generateForTenant(supabase, opts.tenant_id, opts);
  }

  // Unscoped (cron): every tenant, independently.
  const { data: tenantRows, error: tErr } = await repo.listTenantIds(supabase);
  if (tErr) throw new Error(tErr.message);

  const perTenant: GenerateResult[] = [];
  for (const t of tenantRows ?? []) {
    perTenant.push(await generateForTenant(supabase, t.id as string, opts));
  }

  const created = perTenant.flatMap((r) => r.created ?? []);
  const blocking = perTenant.flatMap((r) => r.blocking ?? []);
  const invoicesCreated = perTenant.reduce((n, r) => n + (r.invoices_created ?? 0), 0);

  return {
    billing_month: billingMonthForResult,
    mode: opts.mode === "manual" ? "manual" : "auto",
    forced: opts.force === true,
    // An aggregate status, deliberately coarse: per-tenant detail is the thing
    // to act on, and flattening several tenants' outcomes into one word would
    // hide the tenant that actually needs attention.
    status: `processed ${perTenant.length} tenant(s)`,
    invoices_created: invoicesCreated,
    blocking,
    created,
    per_tenant: perTenant,
  };
}

async function generateForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const tStart = performance.now();
  const mode = opts.mode === "manual" ? "manual" : "auto";
  const force = opts.force === true;
  // Guarded so a stray `now` in a JSON body can never shift billing.
  const now = opts.now instanceof Date ? opts.now : new Date();

  // ── Guards: domain/guards.ts (B4) ─────────────────────────────────────────
  const guarded = await runGuards(supabase, tenantId, opts, mode, force, now);
  if ("stop" in guarded) return guarded.stop;
  const { billingMonth, monthStart, monthEnd } = guarded.go;

  // ── Phase 1: tally billable items across ALL classes ──────────────────────
  // Ordered so a mixed-class invoice's line items land in a stable order (they
  // are persisted to invoice_items and rendered in the email).
  //
  // INACTIVE CLASSES ARE INCLUDED, and `is_active` no longer means anything to
  // billing — it is SCHEDULING state. A class retired at month end used to drop
  // its already-taught lessons out of the run silently, a hole exactly where
  // someone is tidying up (BACKLOG #6).
  //
  // What this scan feeds is not only the tally: it also decides which classes
  // enter the completeness gate below, so widening it widens what can BLOCK a
  // month. That half is deliberately NOT widened — see `lastScheduledDate` in
  // the loop. Retired classes with nothing recorded and nothing due fall out at
  // the `continue` there — but THREE queries in, not one: sessions, bookings and
  // enrolments all run above it. A tenant that has retired sixty classes over
  // the years pays that on every run, for ever, and nothing prunes it. Filed
  // rather than fixed here: it is a cost, not a correctness bug, and the shape
  // that would fix it (a `deactivated_at` cut-off in the scan) is one more place
  // for the RISK 1 deadlock to hide.
  //
  // (2026-11-16: those per-class queries are now batched — one read per table
  // for the whole tenant-month — so a retired class no longer costs a round
  // trip. Only its in-memory pass remains, which is trivial.)
  const tGuards = performance.now();
  // ── Phase 1 reads: domain/phase1.ts (B5) ─────────────────────────────────
  const {
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
  } = await readPhase1(supabase, tenantId, monthStart, monthEnd);

  /** The rate in force for a category on a date, or null. */
  const trialRateFor = (categoryId: string, on: string): number | null => {
    const inForce = (trialRates ?? [])
      .filter(
        (r) => r.category_id === categoryId && String(r.effective_from) <= on
      )
      // String compare is correct and deliberate: both sides are YYYY-MM-DD,
      // which sorts lexicographically, so no Date is constructed and there is
      // no timezone to get wrong (§7.7).
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
    return inForce.length ? Number(inForce[0].rate) : null;
  };

  type InvoiceItem = {
    student_id: string;
    lesson_session_id: string;
    attendance_status: Database["public"]["Enums"]["attendance_status"];
    amount: number;
    class_title: string;
    session_date: string;
    // The name AS INVOICED. Snapshotted for the same reason class_title is:
    // an invoice is a document that gets sent, and it must not rewrite itself
    // when a child is renamed later. Reading it live is the same mistake as
    // reading classes.price_per_lesson at generation time.
    student_name: string | null;
  };

  const log: unknown[] = [];
  const created: CreatedInvoice[] = []; // newly-created invoices, for emailing
  // Billable items for the whole run, keyed by parent — the cross-class tally
  // that makes one-invoice-per-parent possible.
  const parentItems = new Map<string, InvoiceItem[]>();
  // Parents with a child enrolled in a class whose attendance is incomplete.
  // Tracked from ENROLMENTS, not from billable items: a class may contribute
  // zero items precisely because nobody marked it.
  const deferredParents = new Set<string>();
  // Lessons with unmarked attendance. Any entry here stops the whole run.
  const blocking: BlockingLesson[] = [];
  let classesIncomplete = 0; // classes skipped because attendance not fully marked
  // Classes this run actually reckoned with: had lessons recorded AND students
  // to bill, and passed the completeness gate. A month can only be SEALED if
  // this is > 0 — see the sealing block for why zero must never seal.
  let classesComplete = 0;
  let invoicesCreated = 0;
  // A month with a failed write must never be sealed — sealing would lock out
  // the very retry that would have fixed it.
  let invoiceWriteFailed = false;
  // Billable lessons whose student has no parent account. Collected per class,
  // then reduced against settlements after the loop.
  const unclaimedAttendance: { student_id: string; session_date: string }[] = [];

  // Today in the APP timezone, not UTC — the clamp below decides whether a
  // lesson counts as "should already have happened", and the UTC date is the
  // previous day in SGT before 08:00 (gotcha §7.7).
  const todayDate = dateInTimeZone(now, APP_TIMEZONE);

  for (const cls of classes ?? []) {
    // Sessions for this class within the billing month (batched above).
    const sessions = sessionsByClass.get(cls.id as string) ?? [];

    const sessionIds = (sessions ?? []).map((s) => s.id);
    const sessionDateMap: Record<string, string> = Object.fromEntries(
      (sessions ?? []).map((s) => [s.id, s.session_date])
    );
    const sessionByDate = new Map<string, string>(
      (sessions ?? []).map((s) => [s.session_date as string, s.id as string])
    );

    // ── Lessons the admin CANCELLED IN ADVANCE (cancel_lesson, 20260821000700) ──
    // A cancelled session expects nobody who is merely ENROLLED. It is still a
    // session row — it stays in `sessionIds` (so any attendance rows on it are
    // read and billed as usual) and in `sessionByDate` (so the date still
    // reaches the gate). What changes is only WHO is expected there: see
    // `expectedDates` and `unmarkedOn()` below, and the prohibition at each.
    const cancelledDates = new Set<string>(
      (sessions ?? [])
        .filter((s) => s.cancelled_at !== null && s.cancelled_at !== undefined)
        .map((s) => s.session_date as string)
    );

    // ── Trial bookings: a child expected at ONE lesson ──────────────────────
    // Not enrolled, so activeStudentIds does not contain them — but they must
    // be marked on their own date, and an unmarked one blocks the month like
    // anyone else. Cancelled bookings expect nobody.
    //
    // category_id comes from the BOOKING, never from classes.category_id: that
    // column is mutable, and re-tagging a class must not reprice a trial
    // already taught (see trial_bookings.category_id).
    // (batched above — this class's live bookings in the month)
    const bookings = bookingsByClass.get(cls.id as string) ?? [];

    const bookedByDate = new Map<string, string[]>();
    /** (student, date) → the category the trial was SOLD under. */
    const bookedCategory = new Map<string, string>();
    for (const b of bookings ?? []) {
      const d = b.session_date as string;
      const list = bookedByDate.get(d) ?? [];
      list.push(b.student_id as string);
      bookedByDate.set(d, list);
      bookedCategory.set(`${b.student_id}:${d}`, b.category_id as string);
    }

    // ── Make-up bookings for THIS class: same mechanism as trials ───────────
    // A make-up guest is expected at exactly one lesson and, like a trial,
    // an unmarked one must block the month — a booked child nobody marked is
    // a lost lesson (a lost package draw or lost ad-hoc revenue). Both maps
    // are merged into ONE bookingsByDate so expectedStudentsOn() and
    // datesToCheck stay on their existing contract — no edit to
    // attendanceCompleteness.ts, whose three copies are pinned byte-identical.
    /** (student, date) → the booking's home class, for pricing. */
    const makeupInfo = new Map<string, { homeClassId: string }>();
    // Lists COPIED, not aliased: new Map(bookedByDate) shares the arrays, and
    // pushing a make-up guest into a date that already holds a trial would
    // silently mutate bookedByDate too.
    const bookingsByDate = new Map<string, string[]>(
      [...bookedByDate].map(([d, list]) => [d, [...list]])
    );
    for (const m of makeupRows ?? []) {
      if (m.class_id !== cls.id) continue;
      const d = m.session_date as string;
      const list = bookingsByDate.get(d) ?? [];
      list.push(m.student_id as string);
      bookingsByDate.set(d, list);
      makeupInfo.set(`${m.student_id}:${d}`, {
        homeClassId: m.home_class_id as string,
      });
    }

    // Enrolments answer TWO different questions and the split matters.
    //
    //   enrolmentSpans  — "who must be marked ON THIS DATE" (the gate)
    //   activeStudentIds — "who is a current customer" (deferral, below)
    //   enrolled_at      — floors the expected-lesson window so a class is
    //                      never asked about lessons from before it had anyone
    //
    // The gate used to use activeStudentIds, which describes TODAY and was then
    // applied to every lesson in the month. A child who enrolled on the 20th
    // was therefore expected at the lessons on the 6th and 13th, had no rows
    // there, and blocked the whole month — with no override (§8a) and no way to
    // clear it except marking them at a lesson they were not enrolled for. See
    // attendanceCompleteness.ts and enrolmentSpans.test.ts.
    // (batched above — every enrolment of this class, any status)
    const enrolments = enrolmentsByClass.get(cls.id as string) ?? [];

    // Dates are Singapore-local. enrolled_at/unenrolled_at are TIMESTAMPTZ, so
    // slicing the ISO string would take the UTC date — a day early for anything
    // written between 00:00 and 08:00 SGT, which is §7.7's bug in a new place:
    // it would start a child's span a day before they joined, and if that day
    // is a lesson day the month blocks on a lesson they were never at.
    const enrolmentSpans: EnrolmentSpan[] = (enrolments ?? []).map((e) => ({
      studentId: e.student_id as string,
      from: dateInTimeZone(new Date(String(e.enrolled_at)), APP_TIMEZONE),
      until: e.unenrolled_at
        ? dateInTimeZone(new Date(String(e.unenrolled_at)), APP_TIMEZONE)
        : null,
    }));

    const activeStudentIds = (enrolments ?? [])
      .filter((e) => e.is_active)
      .map((e) => e.student_id);

    // ── Lessons that SHOULD have run this month ─────────────────────────────
    // lesson_sessions rows are created LAZILY by attendance marking (PRD §7.5),
    // so a lesson nobody touched has no row at all. A gate that inspects only
    // existing sessions cannot see it: the run bills the marked lessons,
    // reports the month complete and SEALS it, and that lesson can never be
    // billed afterwards (§11.6). Deriving the expected dates is the only way
    // the engine can tell "fully marked" from "never marked".
    //
    // Floored at the earliest enrolment — including INACTIVE ones, because a
    // child who has since left still attended lessons that ran. Clamped to
    // today so future lessons in the current month are not counted as gaps.
    // SGT date, like the spans above — NOT the raw UTC slice (§7.7, dates.ts).
    const earliestEnrolment = earliestEnrolmentDate(
      (enrolments ?? []).map((e) => e.enrolled_at),
      APP_TIMEZONE
    );
    const windowFrom =
      earliestEnrolment && earliestEnrolment > monthStart
        ? earliestEnrolment
        : monthStart;
    const windowTo = todayDate < monthEnd ? todayDate : monthEnd;

    // ── ...and clamped at the day the class stopped being SCHEDULABLE ───────
    // The tally above bills every class, active or not. This half must not
    // follow it. An inactive class with a live enrolment and no sessions would
    // otherwise expect a lesson on every weekly date, find nobody marked, and
    // block the month — and there is no way out: the block has no override by
    // design (§8a), and the class is invisible to every role who could clear it
    // (the coach class list, the coach Schedule tab and the admin Classes page
    // all filter `is_active`). That is §8.32's deadlock on a visibility axis
    // instead of a date axis, so markable_floor() does not rescue it.
    //
    // Three cases, and the third is why this is a date and not a boolean:
    //   active                     → schedulable to the end of the window
    //   deactivated on a date      → schedulable up to that date, not past it
    //   inactive, no date recorded → predates deactivate_class(); nothing is
    //                                known about when it stopped, so it expects
    //                                nothing. That is the conservative side of
    //                                the deadlock and it is also exactly how
    //                                such a class behaved before this change,
    //                                when the scan skipped it outright.
    //
    // Recorded sessions are unaffected either way: they stay in datesToCheck
    // below, so an unmarked lesson that genuinely ran still blocks.
    const lastScheduledDate: string | null = cls.is_active
      ? windowTo
      : cls.deactivated_at
      ? dateInTimeZone(new Date(String(cls.deactivated_at)), APP_TIMEZONE)
      : null;

    const expectedTo =
      lastScheduledDate === null || lastScheduledDate < windowFrom
        ? null
        : lastScheduledDate < windowTo
        ? lastScheduledDate
        : windowTo;

    // ⚠ NAMED PROHIBITION — cancelled dates may be subtracted ONLY from
    // `expectedDates`, the weekday PROJECTION. They must NEVER be filtered out
    // of the `sessionByDate` or `bookingsByDate` contributions to
    // `datesToCheck` below, and never from the billable set. This is the
    // `bookingsByDate` clamp (§7.18, the prohibition further down) under a new
    // name: a cancelled date that ALSO carries a live make-up/trial booking, or
    // real attendance rows, must still reach the gate — cancel_lesson() refuses
    // to create either state, but the engine must not have to trust that. A
    // cancelled session satisfies the gate the way a holiday mark does: via
    // `unmarkedOn()` returning nobody for it, which happens ONLY when the date
    // has no live booking. Subtracting from the union instead would trade a
    // loud block for a silent permanent underbill (§11.6: a sealed month's
    // lesson can never be billed after). The Deno test "cancelled date WITH a
    // live make-up booking ⇒ incomplete_attendance, NOT sealed" is the pin.
    const expectedDates = (activeStudentIds.length && expectedTo !== null
      ? expectedLessonDates(String(cls.day_of_week), windowFrom, expectedTo)
      : []
    ).filter((d) => !cancelledDates.has(d));

    // Nothing recorded, nothing due AND NOBODY BOOKED — this class has no
    // bearing on the month.
    //
    // ⚠ `bookingsByDate` IS THE THIRD TERM AND IT IS NOT OPTIONAL. Until
    // 20260810 this guard read enrolments and sessions only, so a class with no
    // ACTIVE enrolments but holding an unmarked trial or make-up booking was
    // skipped WHOLE — before the completeness gate below, which does union
    // booking dates in (see `datesToCheck`). The guest was neither billed nor
    // blocking; alone the run reported `nothing_to_bill`, but alongside a second
    // class that billed, the month SEALED and that lesson could never be
    // invoiced afterwards (§11.6). A silent permanent underbill, confirmed by
    // running it twice.
    //
    // THIS IS NOT ONLY ABOUT RETIRED CLASSES. An ACTIVE class whose students
    // have all been removed, holding one booked trial, is in exactly this state
    // — and that is the local seed's default shape (§7.100). Retiring a class
    // made it reachable by construction; it was never confined to it.
    //
    // The admin's pre-flight already had this right and the engine did not,
    // which is §7.18's divergence in its live form: `SwimSyncAdmin/lib/
    // classCoverage.ts` skips only when `activeStudentIds.length === 0 &&
    // bookedByDate.size === 0`. So for a guest-only class the Generate dialog
    // NAMED the missing date while the engine sailed past it. That file is the
    // reference implementation this line is being brought up to.
    //
    // ⚠ NAMED PROHIBITION — `bookingsByDate` MUST NOT BE CLAMPED. Not by
    // `lastScheduledDate`, not by `is_active`, not by anything. `expectedDates`
    // is clamped because it is a GUESS the engine makes from a weekday; a
    // booking row is explicit evidence that a named child was expected on a
    // named date, so it can never be spuriously generated and needs no bound.
    // A clamp was drafted and rejected: `lastScheduledDate` is null whenever
    // `is_active = false AND deactivated_at IS NULL`, so clamping would drop
    // every booking date for such a class and seal over the guest — trading a
    // loud block for the silent underbill this whole change exists to close.
    // That state is now impossible anyway (`classes_inactive_requires_
    // deactivated_at`, 20260810000100), and the state a clamp would have
    // defended against — a booking dated after `deactivated_at` — cannot be
    // created either: `book_makeup()`, `book_trial()` and
    // `schedule_extra_lesson()` all refuse an inactive class, and
    // `deactivate_class()` refuses to retire one that still owes a mark.
    if (!sessionIds.length && !expectedDates.length && !bookingsByDate.size) {
      continue;
    }

    // All attendance rows for these sessions (batched above)
    const attRows = sessionIds.flatMap((id) => attendanceBySession.get(id) ?? []);

    // Who gets BILLED is a different question from who must be marked. Billing
    // follows the attendance rows that actually exist, NOT the current
    // enrolment: a child unenrolled part-way through the month still attended
    // the lessons they attended, and must still be billed for them. Deriving
    // the billable set from active enrolments alone silently dropped those
    // lessons — one tap of "remove from class" would have cost a month's
    // revenue for that child.
    const attendedStudentIds = (attRows ?? []).map((a) => a.student_id);
    const billableStudentIds = [
      ...new Set([...activeStudentIds, ...attendedStudentIds]),
    ];

    // Nobody enrolled, nobody marked AND NOBODY BOOKED — nothing to bill or
    // check. Same hole as the guard above, one step further down: a guest-only
    // class clears that one via `bookingsByDate` and would then have died here,
    // because a booked-but-unmarked guest is in neither `activeStudentIds` nor
    // `attendedStudentIds`.
    //
    // ⚠ NAMED PROHIBITION — DO NOT FIX THIS BY WIDENING `billableStudentIds`.
    // The obvious edit is to union the booked ids into it. Do not: four things
    // downstream read that set — the `parent_students` lookup, the student-name
    // snapshot, `deferrableParentIds`, and the item loop — and widening it is
    // safe TODAY only by coincidence of the item loop iterating `parentStudents`
    // rather than `billableStudentIds`. Nothing pins that invariant, so the next
    // edit to the item loop turns a correct set into a wrong one silently.
    // Widen the GUARD, keep the SET's single meaning: "who can appear on an
    // invoice line for this class".
    //
    // A booked guest still reaches billing when they are MARKED, through
    // `attendedStudentIds` — which is the existing route and needs no help.
    // Unmarked, they must reach the gate and block, which is what this allows.
    if (!billableStudentIds.length && !bookingsByDate.size) continue;

    // ── Gate: every active student marked on every lesson that should have run ──
    // Checked over the UNION of expected dates and dates that actually have a
    // session: expected catches the lesson nobody touched, existing catches a
    // make-up held on some other weekday.
    const attSet = new Set(
      (attRows ?? []).map((a) => `${a.lesson_session_id}:${a.student_id}`)
    );
    const datesToCheck = [
      ...new Set<string>([
        ...expectedDates,
        ...sessionByDate.keys(),
        // A trial or make-up booked on a date with no session yet would
        // otherwise be invisible here — and an unmarked booking is exactly
        // what must block.
        ...bookingsByDate.keys(),
      ]),
    ].sort();

    /** Active students with no attendance row on `date`. No session at all
     *  means nobody is marked, which is the whole point of this gate. */
    const unmarkedOn = (date: string): string[] => {
      // Per DATE now, not per month: a trial booking is expected at exactly one
      // lesson, and an enrolment covers only the span it covers — a child who
      // joined on the 20th was never expected on the 6th.
      // expectedStudentsOn() is the shared definition — do not inline the union
      // (§7.18: four hand-written copies caused a live underbill).
      //
      // A CANCELLED lesson expects nobody enrolled — the spans are withheld, the
      // BOOKINGS are not (a live guest on a cancelled date is an impossible
      // state cancel_lesson() refuses; if it ever exists it must BLOCK, loudly,
      // not seal — see the prohibition above `expectedDates`). Still the shared
      // definition, called with no spans, so the booking half cannot drift.
      const expected = cancelledDates.has(date)
        ? expectedStudentsOn(date, [], bookingsByDate)
        : expectedStudentsOn(date, enrolmentSpans, bookingsByDate);
      const sessId = sessionByDate.get(date);
      if (!sessId) return expected;
      return expected.filter((s) => !attSet.has(`${sessId}:${s}`));
    };

    const complete = datesToCheck.every((d) => unmarkedOn(d).length === 0);

    // Parents of this class's students. Queried BEFORE the gate check because
    // the incomplete branch needs it to record who must be deferred. Covers
    // the billable set, which is wider than the enrolled set (see above).
    //
    // ⚠ AN EMPTY SET STILL MATTERS. Until 20260810 the guard above guaranteed
    // `billableStudentIds` was non-empty by here; a guest-only class — nobody
    // enrolled, nobody marked, one booked guest — now reaches this point with
    // an EMPTY set. The per-class query this replaced had to skip itself then,
    // because `.in("student_id", [])` renders as PostgREST `in.()`, a request
    // the server REJECTS (and `?? []` would have swallowed). The batched read
    // above sends no request for an empty id list (readAllIn), and the lookup
    // below yields [] for an empty set — same result, nothing to skip.
    //
    // Rows are this class's billable students' parent links, taken from the
    // tenant-wide batch — exactly the rows the per-class `.in()` returned.
    const parentStudents = billableStudentIds.flatMap(
      (id) => parentStudentsByStudent.get(id) ?? []
    );

    // Deferral applies only to parents of ACTIVELY enrolled children: a parent
    // whose child has left is not waiting on anyone to mark that child, so an
    // unmarked lesson for someone else's child shouldn't hold their invoice.
    const activeSet = new Set(activeStudentIds);
    const deferrableParentIds = new Set(
      (parentStudents ?? [])
        .filter((ps) => activeSet.has(ps.student_id))
        .map((ps) => ps.parent_id)
    );

    // Unmarked attendance BLOCKS generation, in every mode. An unmarked lesson
    // is unbillable and invisible, and once the parent has an invoice it can
    // never be added to it — so billing around it converts a fixable gap into
    // a permanent underbill. A lesson that genuinely did not run is recorded
    // with cancelled_rain/cancelled_coach (non-billable), which satisfies the
    // gate; there is no case that needs a bypass.
    //
    // `force` keeps its other meaning (skipping the sealed-month guard, the
    // documented reopen path) but no longer overrides this.
    if (!complete) {
      classesIncomplete++;
      for (const pid of deferrableParentIds) deferredParents.add(pid);
      for (const date of datesToCheck) {
        const unmarked = unmarkedOn(date);
        if (unmarked.length) {
          blocking.push({
            tenant_id: tenantId,
            class_id: cls.id,
            class_title: cls.title,
            session_date: date,
            unmarked_student_count: unmarked.length,
          });
        }
      }
      log.push({
        class_id: cls.id,
        title: cls.title,
        skipped: "incomplete_attendance",
        parents_deferred: deferrableParentIds.size,
      });
      continue;
    }

    // Past the gate with real lessons and real students: this class has been
    // genuinely reckoned with, whether or not it yields a billable item.
    classesComplete++;

    // ── What one billable lesson costs ─────────────────────────────────────
    // A PAID TRIAL is priced by the category the trial was SOLD under, on the
    // lesson's own date. Everything else — including a trial child marked
    // `present` — is the class's own effective-dated rate. The STATUS chooses
    // the price and the coach chooses the status.
    //
    // ⚠ `??`, NEVER `||`. An unpriced category returns NULL, which means "this
    // business has not priced trials" and must fall back to the class rate. With
    // `||` a rate of 0 would slip through to the fallback — and CHECK (rate > 0)
    // on trial_rates is the second layer that makes 0 unreachable at all. The
    // opposite failure matters just as much: NULL must not THROW, or a business
    // that never set a trial price could not bill anything.
    const priceFor = (
      status: string,
      studentId: string,
      sessionDate: string,
      c: { id: string; title: string }
    ): number => {
      const classPrice = rateOn(classRates ?? [], c.id, sessionDate, c.title).price;
      if (status === "trial_paid") {
        // The BOOKING's category, not the class's current one.
        const cat = bookedCategory.get(`${studentId}:${sessionDate}`);
        if (!cat) return classPrice;
        return trialRateFor(cat, sessionDate) ?? classPrice;
      }
      // A MAKE-UP GUEST pays their HOME class's effective-dated rate on the
      // lesson's own date — the make-up replaces their own missed lesson, so
      // their usual price applies, not the host's. Guarded by presence in
      // makeupInfo so no ordinary row can reach it, and by enrolment-wins: a
      // child booked as a guest and later transferred INTO the host class is
      // a member on that date and prices as one.
      const mk = makeupInfo.get(`${studentId}:${sessionDate}`);
      if (
        mk &&
        !studentsEnrolledOn(sessionDate, enrolmentSpans).includes(studentId)
      ) {
        return rateOn(
          classRates ?? [],
          mk.homeClassId,
          sessionDate,
          `the make-up guest's home class (booking into ${c.title})`
        ).price;
      }
      return classPrice;
    };

    // ── Tally this class's billable items into the cross-class map ──────────
    const attByKey: Record<string, Database["public"]["Enums"]["attendance_status"]> = Object.fromEntries(
      (attRows ?? []).map((a) => [
        `${a.lesson_session_id}:${a.student_id}`,
        a.status,
      ])
    );

    for (const ps of parentStudents ?? []) {
      for (const sessId of sessionIds) {
        const status = attByKey[`${sessId}:${ps.student_id}`];
        if (status && BILLABLE.has(status)) {
          let items = parentItems.get(ps.parent_id);
          if (!items) {
            items = [];
            parentItems.set(ps.parent_id, items);
          }
          // Priced by the LESSON'S OWN DATE, not the class's current price.
          // Throws if no rate is in force — see rates.ts for why that must
          // never degrade to 0 or to cls.price_per_lesson.
          const sessionDate = sessionDateMap[sessId];
          // A make-up guest's line carries a title marker so the parent's
          // invoice explains a host-class line at a home-class price.
          // Enrolment wins, as in priceFor: a member is not a guest. (The
          // booking's category snapshot matters only to package matching,
          // which happens at marking — package_candidates_for, §7.45.)
          const mk = makeupInfo.get(`${ps.student_id}:${sessionDate}`);
          const isGuest =
            !!mk &&
            !studentsEnrolledOn(sessionDate, enrolmentSpans).includes(
              ps.student_id
            );
          items.push({
            student_id: ps.student_id,
            lesson_session_id: sessId,
            attendance_status: status,
            amount: priceFor(status, ps.student_id, sessionDate, cls),
            class_title: isGuest ? `${cls.title} (make-up)` : cls.title,
            session_date: sessionDate,
            student_name: studentNameById.get(ps.student_id) ?? null,
          });
        }
      }
    }

    // ── Billable attendance with NOBODY TO BILL ─────────────────────────────
    // The loop above walks parentStudents, so a student with no parent_students
    // row is never visited and their lessons vanish from the run without a
    // trace. That is fine for the INVOICE (there is genuinely no parent to bill)
    // and fatal for the SEAL: a sealed month is never reprocessed, so when the
    // parent finally registers those lessons can never be billed at all.
    //
    // Collected here as a REPORT. It must not — and does not — touch
    // billableStudentIds, the item tally, or any invoice arithmetic; claimed
    // families bill exactly as they did before this existed (pinned by the
    // TRIPWIRE test in unclaimed.test.ts).
    const claimedStudentIds = new Set(
      (parentStudents ?? []).map((ps) => ps.student_id as string)
    );
    for (const a of attRows ?? []) {
      if (!BILLABLE.has(a.status)) continue;
      if (claimedStudentIds.has(a.student_id)) continue;
      unclaimedAttendance.push({
        student_id: a.student_id,
        session_date: sessionDateMap[a.lesson_session_id],
      });
    }
  }

  // ── Reduce unclaimed attendance against settlements ───────────────────────
  // A settlement says money for this student was received outside SwimSync, or
  // written off. It is EFFECTIVE-DATED: it covers attendance on or before
  // settled_through and nothing after, so settling once cannot blanket-
  // authorise every future lesson. A reversed settlement covers nothing —
  // reversal exists because a parent who turns up two months after a write-off
  // must be recoverable.
  const unclaimedStudentIds = [
    ...new Set(unclaimedAttendance.map((u) => u.student_id)),
  ];

  let unclaimedStudents: UnclaimedStudent[] = [];
  if (unclaimedStudentIds.length) {
    const { data: settlements } = await repo.readSettlements(supabase, unclaimedStudentIds);

    // Latest live settlement per student — the furthest date any of them covers.
    const coveredThrough = new Map<string, string>();
    for (const st of settlements ?? []) {
      const prev = coveredThrough.get(st.student_id as string);
      const through = st.settled_through as string;
      if (!prev || through > prev) {
        coveredThrough.set(st.student_id as string, through);
      }
    }

    // String comparison is correct and deliberate: both sides are YYYY-MM-DD,
    // which sorts lexicographically. No Date object is constructed, so there is
    // no timezone to get wrong (§7.7).
    const unsettled = unclaimedAttendance.filter((u) => {
      const through = coveredThrough.get(u.student_id);
      return !through || u.session_date > through;
    });

    if (unsettled.length) {
      const { data: names } = await repo.readUnsettledNames(supabase, unsettled);
      const nameById = new Map(
        (names ?? []).map((n) => [n.id as string, n.full_name as string])
      );

      const byStudent = new Map<string, string[]>();
      for (const u of unsettled) {
        const dates = byStudent.get(u.student_id) ?? [];
        dates.push(u.session_date);
        byStudent.set(u.student_id, dates);
      }

      unclaimedStudents = [...byStudent.entries()]
        .map(([student_id, dates]) => {
          const sorted = [...dates].sort();
          return {
            student_id,
            student_name: nameById.get(student_id) ?? null,
            lessons: sorted.length,
            earliest_session_date: sorted[0],
            latest_session_date: sorted[sorted.length - 1],
          };
        })
        .sort((a, b) =>
          a.earliest_session_date.localeCompare(b.earliest_session_date)
        );
    }
  }

  const unclaimedBillable = unclaimedStudents.reduce(
    (sum, u) => sum + u.lessons,
    0
  );

  // ── Hard stop: nothing generates while any lesson is unmarked ─────────────
  // All-or-nothing on purpose. Billing the classes that happen to be complete
  // would give those parents an invoice, and the already-exists guard would
  // then permanently block the unmarked lessons from ever reaching one — so a
  // partial run converts a fixable gap into lost money. Returning before phase
  // 2 means no invoice, no credit drawn, no email, nothing to unwind.
  if (blocking.length) {
    blocking.sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.class_title.localeCompare(b.class_title)
    );
    return {
      tenant_id: tenantId,
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "incomplete_attendance",
      invoices_created: 0,
      classes_still_incomplete: classesIncomplete,
      parents_deferred: deferredParents.size,
      // Reported even on the blocked path: an admin fixing unmarked lessons
      // should learn about the unclaimed ones in the same trip, not discover
      // them on the next run.
      unclaimed_billable: unclaimedBillable,
      ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
      sealed: false,
      blocking,
      message:
        `Cannot generate invoices for ${billingMonth}: ${blocking.length} lesson(s) still have unmarked attendance. Mark them — or mark them cancelled if the lesson did not run — then generate again.`,
      results: log,
      timings_ms: timingsSince(tStart, tGuards, performance.now(), null),
    };
  }

  // ── Lessons a package ALREADY paid for at marking ─────────────────────────
  // docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md. Attendance triggers draw
  // the package the moment a lesson is marked (package_candidates_for is the one
  // matching rule), so a drawn lesson is PAID and must never reach an invoice
  // line (the DB backstop on invoice_items would refuse it — PK002 — and fail
  // the run's write). The engine matches no package itself: the pay-at-the-run
  // matcher and its tenants.package_draw_at_marking switch were removed
  // (BACKLOG Wave 9 item 9). Every remaining item is ad-hoc at its class price.
  //
  // ⚠ FAIL CLOSED (RISK 1, §7.325): an unreadable drawn set returns
  // package_mode_unreadable — no invoice, no seal, never a throw (§7.265). Do NOT
  // default the drawn set to empty: that bills a lesson the family already paid
  // for.
  const itemSessionIds = [
    ...new Set([...parentItems.values()].flat().map((i) => i.lesson_session_id)),
  ];
  const drawnKeys = new Set<string>();
  // Chunked: an .in() list rides the URL, and a month of sessions can be long.
  for (let i = 0; i < itemSessionIds.length; i += 200) {
    const { data: drawnRows, error: drawnErr } = await repo.readDrawnChunk(supabase, itemSessionIds, i);
    if (drawnErr || !drawnRows) {
      return packageModeUnreadable(
        drawnErr ? drawnErr.message : "the package draws could not be read"
      );
    }
    for (const r of drawnRows) {
      drawnKeys.add(`${r.lesson_session_id}:${r.student_id}`);
    }
  }
  if (drawnKeys.size) {
    for (const [parentId, items] of parentItems) {
      parentItems.set(
        parentId,
        items.filter((i) => !drawnKeys.has(`${i.lesson_session_id}:${i.student_id}`))
      );
    }
  }

  function packageModeUnreadable(reason: string): GenerateResult {
    return {
      tenant_id: tenantId,
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "package_mode_unreadable",
      invoices_created: 0,
      sealed: false,
      message:
        `Could not read which lessons a package has already paid for (${reason}). ` +
        `No invoices were generated and the month was left open — generate again.`,
      results: log,
    };
  }

  const tTally = performance.now();

  // ── Phase 2: create ONE invoice per parent, across all their classes ──────
  // Two READS that used to run per parent are batched here, once for the
  // tenant-month: which parents already have an invoice, and every balance.
  // The WRITES stay per parent and in the same order — insert, items, credit —
  // so one parent's failed write still skips only that parent (and holds the
  // seal), exactly as before.
  //
  // What batching moves: these rows are read just before the loop instead of
  // just before each parent's insert — a window of one run (~ms on a
  // same-region call). Both reads were already only advisory:
  //   • "already has an invoice" — UNIQUE (parent_id, tenant_id, billing_month)
  //     is the real guard. A concurrent run that bills a parent inside the
  //     window makes THIS run's insert fail (logged, month not sealed by this
  //     run) instead of skipping it. No double bill either way.
  //   • the balance — an ESTIMATE; apply_credit_to_invoice locks and draws from
  //     the real rows. A credit note issued inside the window may be left for
  //     next month's invoice instead of this one (it is never lost or doubled).
  // ⚠ FAIL CLOSED: an unreadable existing-invoice set would bill duplicates
  // into the UNIQUE guard, and an unreadable balance would skip credit; both
  // throw (readPaged) before anything is written.
  const billingAny = [...parentItems.values()].some((items) => items.length > 0);
  const [existingInvoices, balanceRows] = billingAny
    ? await Promise.all([
        repo.readExistingInvoices(supabase, tenantId, billingMonth),
        repo.readBalances(supabase, tenantId),
      ])
    : [[], []];
  const alreadyInvoiced = new Set(existingInvoices.map((i) => i.parent_id));
  const balanceByParent = new Map(balanceRows.map((b) => [b.parent_id, b]));
  // Note: deferredParents can no longer be populated on a run that reaches
  // here (the hard stop above returns first). The check below is kept as an
  // inner guard — it is correct, it costs nothing, and it is the right
  // behaviour if the block is ever relaxed to per-parent.
  // Sorted for deterministic ordering across runs.
  for (const parentId of [...parentItems.keys()].sort()) {
    const items = parentItems.get(parentId)!;
    if (!items.length) continue;

    // A child of theirs sits in a class with unmarked attendance — bill
    // nothing this run rather than lock in a partial invoice.
    if (deferredParents.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "deferred_incomplete_class",
        pending_items: items.length,
      });
      continue;
    }

    // Chronological, so the invoice and its email read in lesson order even
    // when items come from several classes.
    items.sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.class_title.localeCompare(b.class_title) ||
        a.student_id.localeCompare(b.student_id)
    );

    // Skip if this parent already has an invoice for the billing month.
    // Cannot fire within a run any more (each parent is visited exactly
    // once) — this guards RE-RUNS: the daily cron on an unsealed month, or
    // a manual run after an auto one. Removing it reopens double-billing.
    // (batched above — one read for the tenant-month)
    if (alreadyInvoiced.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "already_exists",
      });
      continue;
    }

    // Credit available FROM THIS TENANT. Never crosses: a note earned at a
    // school is not spendable against a private coach's invoice, or one
    // business ends up paying another's bill. Pools freely across this parent's
    // children WITHIN the tenant.
    // (batched above; no row = no balance, as maybeSingle() returned null)
    const balanceRow = balanceByParent.get(parentId);

    const available = Number(balanceRow?.credit_balance ?? 0);
    // A DEBIT (parent owes us, from a voided-then-paid credit — 20260822000100)
    // is folded onto THIS invoice by apply_credit_to_invoice, which draws credit
    // against the debit-inclusive base so the two net. The values below are an
    // ESTIMATE for the insert; the RPC trues up net/credit/balance_adjustment.
    const debit = Number(balanceRow?.debit_balance ?? 0);
    // Every line is ad-hoc (a package-funded lesson was drawn at marking and
    // dropped above), so credit notes apply to the whole gross.
    const gross = items.reduce((s, i) => s + i.amount, 0);
    const credit = Math.min(available, Math.max(gross, 0));
    const net = gross - credit;

    // Insert invoice
    // package_applied 0 and status from net: see the dao. due_date comes back from the
    // BEFORE INSERT trigger — never sent, never computed here.
    const { data: invoice, error: invErr } = await repo.insertInvoice(
      supabase, parentId, tenantId, billingMonth, gross, credit, net
    );

    if (invErr || !invoice) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        error: invErr?.message ?? "invoice insert failed",
      });
      continue;
    }

    // Insert invoice items. A failure here is NOT cosmetic: the invoice row
    // (carrying gross) is already committed and there is no transaction across
    // these calls, so silently continuing would draw down credit and email a
    // parent an invoice with no line items — and the credit-note trigger,
    // which keys off invoice_items, could never fire for those lessons.
    // Stop before touching money.
    const { error: itemsErr } = await repo.insertInvoiceItems(supabase, items, invoice);

    if (itemsErr) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        invoice_id: invoice.id,
        error: `invoice_items insert failed: ${itemsErr.message}`,
      });
      continue;
    }

    // ── Draw credit + true up the invoice in ONE DB transaction (Item 2) ─────
    // apply_credit_to_invoice (20260818000200) locks the balance row and the
    // notes FOR UPDATE — serialising against the credit-note trigger's
    // un-correction, which also takes FOR UPDATE (20260818000100), and against
    // Item 3's void — draws FIFO, and writes the invoice's OWN
    // credit_applied/net_amount/status. It is idempotent per invoice, so the
    // §7.17 retry path cannot draw the same credit twice. The engine keeps only
    // the RETURNED allocation, for the email/log figures: `credit`/`net`
    // computed above were an ESTIMATE for the insert, which the RPC has now
    // trued up. They agree except when the pooled balance and the note ledger
    // disagree — exactly the double-decrement window this closes.
    // Only when the estimate drew something: with credit === 0 nothing is drawn
    // and the insert's credit_applied/net (both from the same estimate) are
    // already the truth, so there is no discrepancy to reconcile and no
    // double-draw window to guard — skip the round-trip.
    let creditApplied = credit;
    let balanceAdjustment = 0;
    let netApplied = gross - creditApplied;
    if (credit > 0 || debit > 0) {
      const { data: allocated, error: creditErr } = await rpc.applyCreditToInvoice(supabase, invoice);
      if (creditErr) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `apply_credit_to_invoice failed: ${creditErr.message}`,
        });
        continue;
      }
      creditApplied = Number(allocated ?? 0);
      // Re-read the trued-up invoice: the RPC folded any pending debit into
      // net_amount and set balance_adjustment. These — not the pre-fold estimate
      // — are the authoritative figures for the email/log.
      const { data: settled, error: readErr } = await repo.readSettledInvoice(supabase, invoice);
      if (readErr || !settled) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `re-read settled invoice failed: ${readErr?.message ?? "no row"}`,
        });
        continue;
      }
      balanceAdjustment = Number(settled.balance_adjustment ?? 0);
      netApplied = Number(settled.net_amount ?? netApplied);
    }

    invoicesCreated++;
    created.push({
      invoice_id: invoice.id,
      parent_id: parentId,
      tenant_id: tenantId,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      balance_adjustment: balanceAdjustment,
      net: netApplied,
      due_date: invoice.due_date as string,
      items: items.map((i) => ({
        student_id: i.student_id,
        session_date: i.session_date,
        class_title: i.class_title,
        amount: i.amount,
      })),
    });
    log.push({
      parent_id: parentId,
      invoice_id: invoice.id,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      net: netApplied,
    });
  }

  // ── Seal the billing month once it is genuinely finished ──────────────────
  // Mode-independent: an early MANUAL run that happens to complete the month
  // seals it too, so the daily cron then returns "already_complete" instead of
  // re-walking every class. (Previously only auto sealed, so a month finished
  // by hand stayed open and was reprocessed until the cron got to it.)
  //
  // Safe only because completeness is now measured even under force — without
  // that, a forced run would report 0 incomplete classes unconditionally and
  // seal every month regardless of reality, locking out unmarked lessons for
  // good. The four conditions are the whole safety property:
  //   • at least one class actually reckoned with (there WAS work to finish)
  //   • no class left unmarked          (nothing still to bill)
  //   • no parent deferred              (nobody skipped this run)
  //   • no failed invoice write         (nothing to retry)
  //
  // The first condition is what stops a VACUOUS seal. The other three are all
  // trivially true when the run found nothing at all — no classes yet, no
  // students yet, or (the common one) no lesson_sessions in the month, since
  // sessions are created lazily by attendance marking and therefore do not
  // exist for a month nobody has marked. Without this guard, running
  // generation on an empty or not-yet-marked month reported "0 invoices" and
  // then sealed it, locking out every real invoice that month would later
  // have produced. "Nothing happened" is not the same as "everything is
  // finished", and only the latter may close a month.
  //
  // If a month is ever sealed wrongly, delete its billing_periods row — see
  // INVOICE_RUNBOOK.md.
  // A FIFTH condition joins the four above: no billable lesson may be left
  // with nobody to bill. Without it a trial walk-in or an un-registered
  // family's lessons are dropped from the invoice AND the month closes over
  // them, so they can never be billed even after the parent registers — the
  // §7.8/§7.13/§7.32 permanent-underbill shape through a fourth door.
  //
  // The escape hatch is a SETTLEMENT, not an override: the admin records that
  // the money arrived outside SwimSync, or writes it off. Same philosophy as
  // the attendance gate — add a way to RECORD the thing, never a way to skip it.
  const monthFinished =
    classesComplete > 0 &&
    classesIncomplete === 0 &&
    deferredParents.size === 0 &&
    unclaimedBillable === 0 &&
    !invoiceWriteFailed;

  if (monthFinished) {
    // Sealed for THIS TENANT only. The key is (tenant_id, billing_month): a
    // single billing_month key would have let one business finishing July close
    // it for every other tenant, who would then silently bill nothing.
    //
    // DO NOTHING on conflict, not a plain insert: a forced run bypasses the
    // sealed-month guard, so a second one would otherwise hit a duplicate key.
    // The first seal is the true one — its invoices_issued reflects the run
    // that actually did the work.
    await repo.sealBillingMonth(supabase, tenantId, billingMonth, invoicesCreated);
  }

  return {
    tenant_id: tenantId,
    billing_month: billingMonth,
    mode,
    forced: force,
    invoices_created: invoicesCreated,
    classes_still_incomplete: classesIncomplete,
    // Every parent blocked by an incomplete class — NOT just those reaching
    // phase 2. A parent whose only class is unmarked is never tallied at all,
    // so counting inside the phase-2 loop reported 0 while the whole month was
    // blocked, which is exactly the silent case this number exists to surface.
    parents_deferred: deferredParents.size,
    unclaimed_billable: unclaimedBillable,
    ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
    sealed: monthFinished,
    status: monthFinished
      ? "complete — billing month sealed"
      : // Everything else is done; the only thing holding the month open is
      // attendance nobody can be invoiced for. Named distinctly so the admin
      // is told to invite a parent or record a settlement, rather than being
      // sent hunting for an unmarked lesson that does not exist.
      classesIncomplete === 0 && deferredParents.size === 0 && unclaimedBillable > 0
      ? `open — ${unclaimedBillable} billable lesson(s) have no parent account to bill`
      : // Nothing to reckon with at all. Called out as its own status because
      // it is NOT "attendance still incomplete" (there is no attendance to be
      // incomplete) and NOT a finished month — it usually means no lesson has
      // been marked for this month yet, or there are no classes/students.
      classesComplete === 0 && classesIncomplete === 0
      ? "nothing_to_bill"
      : mode === "manual"
      ? "manual run complete — month left open, attendance still incomplete"
      : deferredParents.size > 0
      ? `partial — ${deferredParents.size} parent(s) deferred, will retry tomorrow`
      : "partial — will retry tomorrow",
    ...(classesComplete === 0 && classesIncomplete === 0
      ? {
          message:
            `No lessons are recorded for ${billingMonth}, so there is nothing to invoice. ` +
            `The month has been left OPEN — generate again once attendance is marked.`,
        }
      : {}),
    results: log,
    created,
    timings_ms: timingsSince(tStart, tGuards, tTally, performance.now()),
  };
}

/** Whole milliseconds per part of a run; `tInvoices` null when phase 2 never ran. */
function timingsSince(
  tStart: number,
  tGuards: number,
  tTally: number,
  tInvoices: number | null
): RunTimings {
  const end = tInvoices ?? tTally;
  return {
    guards: Math.round(tGuards - tStart),
    tally: Math.round(tTally - tGuards),
    invoices: tInvoices === null ? 0 : Math.round(tInvoices - tTally),
    total: Math.round(end - tStart),
  };
}
