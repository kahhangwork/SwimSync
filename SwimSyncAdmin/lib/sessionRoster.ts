// Who is teaching one lesson — for the admin's "Lesson Coaches" assignment page.
//
// THE ABSENCE RULE IS THE WHOLE MODEL, and it is the reason this file exists
// rather than the page reading `session_coaches` directly:
//
//     NO ROSTER ROW MEANS THE CLASS'S COACH IS THE MAIN COACH.
//
// `session_coaches` ships EMPTY (20260811000200), so on almost every lesson the
// answer to "who is teaching this?" is a row that does not exist. A screen that
// renders the table it queried shows a blank column for every lesson in the
// business and invites an admin to "fix" it by assigning the coach who was
// already teaching — creating roster rows whose only effect is to narrow
// `attendance_write` for no reason. The fallback is applied HERE, once, so no
// caller can forget it.
//
// ⚠ THE COACH THIS MODULE FALLS BACK TO IS `classes.coach_id`, AND THAT IS
// CORRECT HERE **BECAUSE THIS IS THE ACCESS AXIS, NOT THE MONEY AXIS.** The
// migration's header states the split: access follows the roster plus
// `classes.coach_id`; money follows `class_rate_on().paid_coach_id` and never
// `classes.coach_id`. Do not "make this consistent" with the wages page — the
// two disagree on purpose, and 20260719000800 exists because they were once the
// same query and handing a class over re-priced its entire unpaid history.
// The money-side twin of this file is `lib/payoutItems.ts`, which reads
// `classes.coach_id` nowhere at all.
//
// ⚠ THIS MODULE NEVER READS A CLOCK, in the shape `lib/classRoster.ts`
// established: a month is a required parameter. Deriving one here would
// reintroduce §7.7, where between 00:00 and 08:00 SGT the UTC date is the
// previous day — which for this screen would silently drop the first lesson of
// a month for eight hours out of every twenty-four.
//
// Pure — no Supabase, no React. The caller fetches the rows and passes them in.

import {
  dayOfWeekOf,
  expectedLessonDates,
  monthBounds,
  type DayOfWeek,
} from "./lessonDates";

/** A `session_coaches` row, as the admin reads it. */
export type SessionCoachRow = {
  id: string;
  lesson_session_id: string;
  coach_id: string;
  role: "main" | "shadow";
};

/** An existing `lesson_sessions` row for the class, within the month. */
export type LessonSessionRow = {
  id: string;
  session_date: string;
};

/** Whoever is teaching a lesson, roster row or fallback. */
export type RosterMain = {
  coach_id: string;
  name: string;
  /**
   * True when a roster row names them, false when they are the class's coach by
   * the absence rule. The distinction drives the screen's verbs: an assigned
   * main can be CLEARED back to the class's coach; a fallback main cannot be
   * cleared, because there is nothing to clear.
   */
  assigned: boolean;
  /**
   * An assigned main who is NOT the class's own coach — a genuine cover, and the
   * only case where somebody loses write on a lesson they would otherwise mark.
   * Rendered as a visible decision rather than a quietly different name.
   */
  is_cover: boolean;
  /** The `session_coaches.id` to delete when clearing. Null for the fallback. */
  row_id: string | null;
};

export type RosterShadow = {
  row_id: string;
  coach_id: string;
  name: string;
};

export type LessonRoster = {
  session_date: string;
  /**
   * ⚠ NULL IS THE ORDINARY CASE, NOT AN ERROR. `lesson_sessions` rows are
   * created LAZILY, by the coach, when attendance is first saved (PRD §7.5) —
   * so a future lesson, which is exactly the lesson an admin wants to arrange
   * cover for, has no row and no id at all. That is why assignment goes through
   * `assign_session_coach(class, DATE, coach, role)`, which resolves-or-creates,
   * and why this screen never handles a session id when writing.
   */
  session_id: string | null;
  main: RosterMain;
  shadows: RosterShadow[];
  /**
   * A lesson that is not on the class's weekday — an extra or rescheduled one
   * (`schedule_extra_lesson()` waives the weekday rule deliberately). Flagged
   * because it is otherwise indistinguishable from a typo in the list.
   */
  off_pattern: boolean;
};

/**
 * Every lesson date of a class in a "YYYY-MM" month.
 *
 * The union of the two ways a lesson can exist, and BOTH halves are load-bearing:
 *
 *   • the weekly pattern — the lessons that *should* happen, which is the only
 *     source for a future lesson nobody has touched yet;
 *   • the `lesson_sessions` rows that already exist — which is the only source
 *     for an EXTRA or rescheduled lesson, because those are off-pattern by
 *     design and `expectedLessonDates()` cannot know about them.
 *
 * Dropping either half loses real lessons: pattern-only hides every extra
 * lesson, rows-only hides every lesson before its first attendance mark, which
 * is nearly all of them.
 *
 * Existing dates outside the month are ignored rather than trusted, so a caller
 * whose query forgot its range cannot smear another month into this one.
 */
export function lessonDatesInMonth(
  dayOfWeek: DayOfWeek,
  month: string,
  existingDates: readonly string[]
): string[] {
  const { start, end } = monthBounds(month);
  if (!start || !end) return [];

  const dates = new Set(expectedLessonDates(dayOfWeek, start, end));
  for (const d of existingDates) {
    if (d >= start && d <= end) dates.add(d);
  }

  // "YYYY-MM-DD" sorts lexically in chronological order.
  return [...dates].sort();
}

/**
 * Turn the raw rows into one described lesson per date.
 *
 * `classCoachName` is passed rather than looked up in `coachNames` because a
 * class can outlive its coach's row being readable, and a lesson whose teacher
 * renders as "—" is a lesson an admin will reassign for no reason.
 */
export function buildLessonRosters(input: {
  dates: readonly string[];
  dayOfWeek: DayOfWeek;
  sessions: readonly LessonSessionRow[];
  rosterRows: readonly SessionCoachRow[];
  coachNames: ReadonlyMap<string, string>;
  classCoachId: string;
  classCoachName: string;
}): LessonRoster[] {
  const {
    dates,
    dayOfWeek,
    sessions,
    rosterRows,
    coachNames,
    classCoachId,
    classCoachName,
  } = input;

  const sessionByDate = new Map(sessions.map((s) => [s.session_date, s.id]));

  const rosterBySession = new Map<string, SessionCoachRow[]>();
  for (const r of rosterRows) {
    const list = rosterBySession.get(r.lesson_session_id);
    if (list) list.push(r);
    else rosterBySession.set(r.lesson_session_id, [r]);
  }

  return dates.map((session_date) => {
    const session_id = sessionByDate.get(session_date) ?? null;
    const rows = session_id ? rosterBySession.get(session_id) ?? [] : [];

    // At most one, enforced by the `one_main_coach_per_session` partial unique
    // index. Taken as "the first" rather than asserted: a screen that throws on
    // impossible data is a screen that goes blank on a bug elsewhere.
    const mainRow = rows.find((r) => r.role === "main") ?? null;

    const main: RosterMain = mainRow
      ? {
          coach_id: mainRow.coach_id,
          name: coachNames.get(mainRow.coach_id) ?? "Unknown coach",
          assigned: true,
          is_cover: mainRow.coach_id !== classCoachId,
          row_id: mainRow.id,
        }
      : {
          coach_id: classCoachId,
          name: classCoachName,
          assigned: false,
          is_cover: false,
          row_id: null,
        };

    const shadows: RosterShadow[] = rows
      .filter((r) => r.role === "shadow")
      .map((r) => ({
        row_id: r.id,
        coach_id: r.coach_id,
        name: coachNames.get(r.coach_id) ?? "Unknown coach",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      session_date,
      session_id,
      main,
      shadows,
      off_pattern: dayOfWeekOf(session_date) !== dayOfWeek,
    };
  });
}

/**
 * The coaches still eligible to be added as a shadow on one lesson.
 *
 * Excludes the main — `session_coaches` is UNIQUE on (lesson, coach), so
 * offering them would produce a constraint error that reads as a bug rather
 * than as "they are already teaching it". Excludes existing shadows for the
 * same reason.
 *
 * The class's own coach IS offered when somebody else is covering: "A shadows
 * the substitute" is a real arrangement (a coach back from leave, watching), and
 * refusing it here would be this screen inventing a rule the database does not
 * have.
 */
export function assignableShadows(
  lesson: LessonRoster,
  coaches: readonly { id: string; name: string }[]
): { id: string; name: string }[] {
  const taken = new Set<string>([
    lesson.main.coach_id,
    ...lesson.shadows.map((s) => s.coach_id),
  ]);
  // Excluded by COACH ID, not by roster row, and that is the whole subtlety: a
  // fallback main holds no row, so a row-based check would happily offer the
  // class's own coach as a shadow of the lesson they are already teaching. The
  // resulting session says two contradictory things about the same person —
  // main by the absence rule, shadow by an actual row — and the write gate and
  // the pay path would then be reading different halves of it.
  return coaches.filter((c) => !taken.has(c.id));
}
