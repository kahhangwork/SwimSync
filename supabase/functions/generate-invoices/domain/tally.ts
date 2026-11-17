// Phase 1's class loop, moved verbatim out of generateForTenant
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B6): per class, the completeness gate and the
// tally of billable lines into one cross-class map per parent.
//
// PURE AND SYNCHRONOUS — every row it reads was fetched by domain/phase1.ts, and
// it awaits nothing (it never did: the reads were batched on 2026-11-16). The only
// value it mutates that it does not own is `log`, pushed in the same order as
// before.

import { BILLABLE } from "../constants.ts";
import {
  APP_TIMEZONE,
  dateInTimeZone,
  earliestEnrolmentDate,
  expectedLessonDates,
} from "../dates.ts";
import { rateOn } from "../rates.ts";
// The ONE definition of who is expected at a lesson. Duplicated byte-identically
// in both apps (§6) — three edits, diffable. Do not inline the union here.
import {
  type EnrolmentSpan,
  expectedStudentsOn,
  studentsEnrolledOn,
} from "../attendanceCompleteness.ts";
import type { Database } from "../../_shared/database.overrides.ts";
import type { BlockingLesson, InvoiceItem } from "../types.ts";
import type { Phase1 } from "./phase1.ts";

/** The B6 slice contract: phase 1's rows plus the run's context in; the tally out. */
export type TallyInput = Phase1 & {
  tenantId: string;
  monthStart: string;
  monthEnd: string;
  todayDate: string;
  log: unknown[];
};

export function tallyClasses(input: TallyInput) {
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
    tenantId,
    monthStart,
    monthEnd,
    todayDate,
    log,
  } = input;

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
  // Billable lessons whose student has no parent account. Collected per class,
  // then reduced against settlements after the loop.
  const unclaimedAttendance: { student_id: string; session_date: string }[] = [];

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

  return {
    parentItems,
    deferredParents,
    blocking,
    classesIncomplete,
    classesComplete,
    unclaimedAttendance,
  };
}
