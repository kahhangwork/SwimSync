// The Schedule tab's per-class loop — the week's cards, the floor-scoped NEEDS
// MARKING set and the covered-out probe list — as a PURE function
// (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 2). The loop body is moved VERBATIM
// from loadData in app/(coach)/schedule/index.tsx, its inner closures
// (datesIn, roleAt, lessonAt) kept as inner closures; only the signature and
// the return are new.
//
// ⚠ NO CLOCK. `todayDate` and `nowMins` are PARAMETERS — the values the route
// read once per render (§7.7). Do not call todayInSg() / nowMinutesInSg() here.
//
// ⚠ `probeIds` IS RETURNED RAW — duplicates and all. fetchCoveredOutSessions
// dedupes BEFORE it applies MAX_PROBE; nobody else may dedupe or slice it.
import {
  toSgDate,
  type DayOfWeek,
} from "@/lib/lessonDates";
import {
  type EnrolmentSpan,
  isLessonFullyMarked,
  expectedStudentsOn,
} from "@/lib/attendanceCompleteness";
import { hasLessonEnded } from "@/lib/timeOfDay";
import {
  lessonProgress,
  summariseStatuses,
  formatSummary,
  splitExpected,
  isFinished,
} from "@/lib/attendanceSummary";
import { lessonDatesInRange } from "@/lib/scheduleWeek";
import {
  lessonRole,
  canMark,
  lessonKey,
  type LessonRole,
} from "@/lib/coachRoster";
import type { WeekLesson, BacklogItem } from "../types";
import type { CoachClass, SessionInfo } from "./scheduleIndex";

export type ScheduleInput = {
  coachClasses: CoachClass[];
  sessionByClassDate: Map<string, SessionInfo>;
  sessionDatesByClass: Map<string, string[]>;
  bookedByClassDate: Map<string, Map<string, string[]>>;
  rosteredDates: Map<string, string[]>;
  assignmentByLesson: Map<string, unknown>;
  weekStart: string;
  weekEnd: string;
  backlogFrom: string;
  todayDate: string;
  nowMins: number;
};

export function buildSchedule({
  coachClasses,
  sessionByClassDate,
  sessionDatesByClass,
  bookedByClassDate,
  rosteredDates,
  assignmentByLesson,
  weekStart,
  weekEnd,
  backlogFrom,
  todayDate,
  nowMins,
}: ScheduleInput): {
  lessons: WeekLesson[];
  backlogItems: BacklogItem[];
  probeIds: string[];
} {
  const backlogItems: BacklogItem[] = [];
  const lessons: WeekLesson[] = [];
  /** Sessions of MY OWN classes that somebody else might have been rostered
   *  onto — see the probe below for why this list is short. */
  const probeIds: string[] = [];

  for (const { cls, owned, shadowed } of coachClasses) {
    const enrolments = cls.student_class_enrolments ?? [];
    // Who must be marked is a question about the LESSON'S date — a child who
    // joined last week was not expected at last month's lessons. See
    // EnrolmentSpan in lib/attendanceCompleteness.ts.
    const enrolmentSpans: EnrolmentSpan[] = enrolments.map((e: any) => ({
      studentId: e.student_id as string,
      from: toSgDate(e.enrolled_at),
      until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
    }));
    const bookedHere =
      bookedByClassDate.get(cls.id) ?? new Map<string, string[]>();
    const sessionDates = sessionDatesByClass.get(cls.id) ?? [];
    const bookedDates = [...bookedHere.keys()];
    const rosteredHere = rosteredDates.get(cls.id) ?? [];

    /**
     * Which dates of this class are MINE, inside a range.
     *
     * ⚠ THE TWO ARMS ARE NOT INTERCHANGEABLE. For my own class it is the
     * weekday recurrence, plus booking and session dates that fall off it
     * (an admin's extra lesson). For a class I am covering it is EXACTLY the
     * dates an admin rostered me onto — never the recurrence. A substitute
     * who covers one Tuesday is not owed a card for every Tuesday, and RLS
     * would return them no session for those dates anyway, so a recurrence
     * card there would be a permanently unmarkable "unmarked" lesson.
     */
    // ⚠ ONE NAMED PREDICATE, NOT TWO `||`s AT THE CALL SITE. A shadow sees
    // the class's WHOLE schedule, so their date source is the recurrence —
    // the same arm as an owner and the exact OPPOSITE of a substitute's.
    // Writing it inline invites somebody to widen the probe guard below to
    // match, and those are two different questions on adjacent lines.
    const showsWholeSchedule = owned || shadowed;

    const datesIn = (from: string, to: string): string[] =>
      showsWholeSchedule
        ? lessonDatesInRange(
            cls.day_of_week as DayOfWeek,
            from,
            to,
            bookedDates,
            sessionDates
          )
        : rosteredHere.filter((d) => d >= from && d <= to);

    /** My role on one date of this class, before the covered-out probe —
     *  one definition, used by the card and by the NEEDS MARKING filter, so
     *  a lesson cannot be badged one way and nagged the other. */
    const roleAt = (date: string) =>
      lessonRole({
        ownsClass: owned,
        isSubstitute: assignmentByLesson.has(lessonKey(cls.id, date)),
        isClassShadow: shadowed,
      });

    /** One (class, date) -> one card. Exactly ONE expectedStudentsOn call per
     *  pair in this file: two derivations of "who was expected here" is how
     *  the client became the only effective billing gate once before (§7.18). */
    const lessonAt = (date: string): WeekLesson => {
      const sess = sessionByClassDate.get(`${cls.id}:${date}`);
      // A lesson the admin cancelled in advance expects nobody ENROLLED — the
      // spans are withheld, the bookings are not (the same substitution the
      // engine makes, core.ts `unmarkedOn`; a live guest on a cancelled date
      // cannot exist, but if it did it must still show as owed a mark).
      const expected = sess?.cancelled
        ? expectedStudentsOn(date, [], bookedHere)
        : expectedStudentsOn(date, enrolmentSpans, bookedHere);
      // Students vs guests, split out of the SAME array that feeds the chip —
      // by subtraction, so the head-count and the chip's denominator cannot
      // disagree (the `2+1`-not-`3` rule, PRD §7.3/§7.17).
      const split = splitExpected(expected, bookedHere.get(date) ?? []);
      return {
        classId: cls.id,
        date,
        startTime: cls.start_time,
        endTime: cls.end_time,
        title: cls.title,
        location: cls.locations?.name ?? "—",
        locationId: cls.location_id ?? null,
        sessionId: sess?.id ?? null,
        // Past -> ended; future -> not; today -> ask the clock, keyed to the
        // class's END time because a coach marks at the end of a lesson.
        progress: lessonProgress(expected, sess?.markedStudentIds, {
          hasEnded: hasLessonEnded(date, todayDate, cls.end_time, nowMins),
        }),
        summary: formatSummary(
          summariseStatuses(expected, sess?.statusByStudent ?? new Map())
        ),
        students: split.students,
        guests: split.guests,
        // Provisional: `covered` is not known yet for my OWN classes — only
        // the database can answer that, and it is asked once, below, for the
        // handful of lessons where the answer can still change anything.
        role: roleAt(date),
        cancelled: sess?.cancelled ?? false,
      };
    };

    // ── THE SELECTED WEEK ────────────────────────────────────────────────
    // Every lesson in the week, marked or not — DONE needs the marked ones,
    // and a class with nobody enrolled still gets a card reading "No students"
    // rather than silently vanishing. (An empty roster is NOT "Marked": the
    // billing gate calls it complete and a card must not.)
    for (const date of datesIn(weekStart, weekEnd)) {
      const card = lessonAt(date);
      lessons.push(card);
      // ⚠ `owned`, NOT `showsWholeSchedule`. The covered-out probe answers
      // "has somebody else been made the main on MY lesson", and a shadowed
      // class is not mine — putting its sessions in would dilute a
      // subtraction whose every short answer HIDES a lesson that needs
      // marking (§7.138). Two different questions, adjacent lines.
      if (owned && card.sessionId && !isFinished(card.progress)) {
        probeIds.push(card.sessionId);
      }
    }

    // ── NEEDS MARKING — FLOOR-SCOPED, AND DELIBERATELY WEEK-INDEPENDENT ──
    // ⚠ THIS SET DOES NOT KNOW WHICH WEEK IS ON SCREEN, AND MUST NOT LEARN.
    // Its range is [class's own backlog floor, today] whatever the selector
    // says, so a straggler three weeks back is visible without the coach
    // having to navigate to a week they have no reason to suspect holds one.
    // Unmarked attendance blocks invoice generation outright with no override
    // — week-scoping this is the §8i hole reopened.
    //
    // Today is NOT skipped here. De-duplication against the TODAY section
    // happens in the RENDER body, over the same render's inputs, so the two
    // cannot disagree; doing it here would couple an async fetch to a
    // render-time fact and could leave today's lesson in neither section.
    // ⚠ THE LOWER BOUND IS THE BUSINESS-WIDE FLOOR, NOT THE PER-CLASS
    // ENROLMENT FLOOR — AND GETTING THAT WRONG DROPS A TRIAL.
    // The old Today screen bounded booking dates ABOVE only
    // (`[...bookedHere.keys()].filter(d => d <= todayDate)`) while bounding
    // session dates at both ends; extracting the union into
    // lessonDatesInRange applied both bounds to bookings too. With the
    // per-class `max(floor, earliestEnrolment)` as the lower bound, a class
    // that trialled a child on 15 Jul but took its first enrolment on 1 Aug
    // loses that unmarked trial from this list entirely — while
    // generate-invoices/core.ts unions booking dates with NO enrolment floor
    // and still blocks the month over it. §7.18 and §7.97, which this commit
    // wrote, reopened through the extraction itself.
    //
    // `backlogFrom` (floor only) restores it, and is strictly better than the
    // pre-extraction behaviour: unbounded-below also surfaced bookings BELOW
    // the marking floor, which nobody can record — a dead tap. Pre-enrolment
    // weekday dates are still suppressed, by `expected.length === 0` below.
    for (const date of datesIn(backlogFrom, todayDate)) {
      const sess = sessionByClassDate.get(`${cls.id}:${date}`);
      // Cancelled by the admin: nobody enrolled is owed a mark (see lessonAt).
      const expected = sess?.cancelled
        ? expectedStudentsOn(date, [], bookedHere)
        : expectedStudentsOn(date, enrolmentSpans, bookedHere);
      if (expected.length === 0) continue; // nobody to mark
      if (isLessonFullyMarked(expected, sess?.markedStudentIds)) continue;
      // A lesson that has not ENDED yet is not overdue — today's 5pm class at
      // midday is Upcoming, not a straggler.
      if (!hasLessonEnded(date, todayDate, cls.end_time, nowMins)) continue;
      // A lesson I am only SHADOWING is not mine to clear. The database
      // refuses my write (attendance_write is `coach_is_main_on_session`), so
      // nagging me produces a straggler nobody can answer — see canMark().
      if (!canMark(roleAt(date))) continue;
      // ⚠ `owned`, NOT `showsWholeSchedule` — see the probe note above.
      if (owned && sess) probeIds.push(sess.id);
      backlogItems.push({
        class_id: cls.id,
        class_title: cls.title,
        date,
        session_id: sess?.id ?? null,
        progress: lessonProgress(expected, sess?.markedStudentIds, {
          hasEnded: true,
        }),
        summary: formatSummary(
          summariseStatuses(expected, sess?.statusByStudent ?? new Map())
        ),
      });
    }
  }

  return { lessons, backlogItems, probeIds };
}

export function applyCoveredOut(
  backlogItems: BacklogItem[],
  lessons: WeekLesson[],
  coveredOut: Set<string>
): { ownBacklog: BacklogItem[]; weekCards: WeekLesson[] } {
  // A covered lesson LEAVES my NEEDS MARKING list and appears on the covering
  // coach's. Leaving it here shows a straggler I am not permitted to clear,
  // and unmarked attendance blocks the billing month with no override (§8i).
  const ownBacklog = backlogItems.filter(
    (b) => !(b.session_id && coveredOut.has(b.session_id))
  );
  // The week card STAYS — the lesson is still happening and the coach should
  // see their own class's day — it simply stops claiming to be theirs to mark
  // and says so through its badge.
  const weekCards = lessons.map((l) =>
    l.role === "owner" && l.sessionId && coveredOut.has(l.sessionId)
      ? { ...l, role: "covered" as LessonRole }
      : l
  );

  ownBacklog.sort((a, b) => b.date.localeCompare(a.date)); // most recent first
  return { ownBacklog, weekCards };
}
