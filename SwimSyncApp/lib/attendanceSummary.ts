// What happened at this lesson, as a coach's screen needs to say it.
//
// ── THIS IS THE DISPLAY LAYER. IT IS NOT THE BILLING GATE. ──────────────────
// attendanceCompleteness.ts answers "may this month be invoiced?" and is shared
// with the billing engine's Deno copy and the admin pre-flight. This file
// answers "what should the card say?" and nothing bills from it. The two
// deliberately disagree in exactly one place:
//
//   A class with NOBODY expected is "fully marked" to the billing gate — there
//   is nothing to collect, so it must not block a month. The same lesson shown
//   to a coach as a green "Marked" is a lie: nobody has marked anything, and
//   a coach who trusts it skips a class that may later gain a student.
//
// So the empty case is handled HERE, as its own `no-students` state, and
// attendanceCompleteness.ts is left alone. Making isLessonFullyMarked([],
// undefined) return false would have been the smaller diff and would have
// changed which months can be invoiced, for every tenant — unmarkedDates()
// depends on that vacuous true to skip dates nobody was enrolled for, and the
// engine depends on it to seal a month. A test in attendanceCompleteness.test.ts
// now pins it, so a future attempt breaks something that explains why.
//
// ── AND THE BUTTON FAILS SAFE TOWARDS NAGGING ───────────────────────────────
// Only `complete` may turn the solid "Mark Attendance" into a quiet "Edit
// attendance". Every other state — including any added later — keeps the loud
// one. Written as `kind === "complete"` rather than `kind !== "unmarked"` for
// that reason: a card that wrongly stops asking is a lesson that never gets
// marked, and an unmarked lesson blocks the month with no override (§8a).
// A card that nags unnecessarily is merely annoying. §7.64/§7.65 are what this
// screen's mistakes cost; the asymmetry is not accidental.

import { countMarked } from "./attendanceCompleteness";

export type DbStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free";

export type LessonProgress =
  /** Nobody is expected — no enrolments and no trial bookings on this date. */
  | { kind: "no-students" }
  /** Expected, nothing recorded, and the lesson has not finished yet. */
  | { kind: "upcoming" }
  /** Expected, nothing recorded, and the lesson is over. */
  | { kind: "unmarked" }
  | { kind: "partial"; marked: number; total: number }
  | { kind: "complete"; total: number };

/**
 * Which state is this lesson in?
 *
 * ⚠ THE BRANCH ORDER IS LOAD-BEARING. `no-students` is tested FIRST so an empty
 * expected set can never fall through to `complete` — see the header.
 *
 * `hasEnded` is only consulted when nothing at all has been recorded: one mark
 * before the class finishes means show progress, not "Upcoming".
 */
export function lessonProgress(
  expectedIds: readonly string[],
  markedIds: Set<string> | undefined,
  opts: { hasEnded: boolean }
): LessonProgress {
  const total = expectedIds.length;
  if (total === 0) return { kind: "no-students" };

  // countMarked counts only students who are EXPECTED and marked. A child who
  // has a row but has since left the class therefore cannot push a partial
  // lesson to complete, nor make it read "5 of 4".
  const marked = countMarked(expectedIds, markedIds);

  if (marked === 0) {
    return opts.hasEnded ? { kind: "unmarked" } : { kind: "upcoming" };
  }
  if (marked < total) return { kind: "partial", marked, total };
  return { kind: "complete", total };
}

/** Does this state mean the coach has finished with the lesson? */
export function isFinished(progress: LessonProgress): boolean {
  return progress.kind === "complete";
}

const STATUS_ORDER: DbStatus[] = [
  "present",
  "absent",
  "cancelled_rain",
  "cancelled_coach",
  "trial_paid",
  "trial_free",
];

/**
 * Lowercase labels for a breakdown line.
 *
 * Rain and coach stay DISTINCT: they are both "cancelled" to a human and
 * different to an invoice, and collapsing them on a coach's screen would hide
 * the one fact that decides whether the lesson is billable.
 *
 * Wording follows the parent app's STATUS_LABEL vocabulary so a family and a
 * coach describe the same row the same way.
 */
export const STATUS_LABEL: Record<DbStatus, string> = {
  present: "present",
  absent: "absent",
  cancelled_rain: "cancelled (rain)",
  cancelled_coach: "cancelled (coach)",
  trial_paid: "trial (paid)",
  trial_free: "trial (free)",
};

/**
 * Count each status among the students who were EXPECTED at this lesson.
 *
 * Scoped to the expected set on purpose, so the numbers here always add up to
 * the `marked` figure in `lessonProgress` — a breakdown summing to more than the
 * fraction beside it reads as a bug even when both are individually defensible.
 *
 * Zero counts are omitted; ordering is fixed (not by count) so the line does not
 * reshuffle between loads.
 */
export function summariseStatuses(
  expectedIds: readonly string[],
  statusByStudent: Map<string, DbStatus>
): { status: DbStatus; count: number }[] {
  const counts = new Map<DbStatus, number>();
  for (const id of expectedIds) {
    const status = statusByStudent.get(id);
    if (!status) continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return STATUS_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((status) => ({
    status,
    count: counts.get(status)!,
  }));
}

/**
 * "3 present · 2 cancelled (rain)", or "" when nothing is recorded.
 *
 * An empty string rather than a placeholder: the caller omits the whole line, so
 * a lesson with nothing recorded shows no dangling separator.
 */
export function formatSummary(
  counts: readonly { status: DbStatus; count: number }[]
): string {
  return counts
    .map((c) => `${c.count} ${STATUS_LABEL[c.status]}`)
    .join(" · ");
}

/** The chip's words for each state. `total` is the expected head-count. */
export function progressLabel(progress: LessonProgress): string {
  switch (progress.kind) {
    case "no-students": return "No students";
    case "upcoming":    return "Upcoming";
    case "unmarked":    return "Not marked";
    case "partial":     return `${progress.marked} of ${progress.total} marked`;
    case "complete":    return "Marked";
  }
}
