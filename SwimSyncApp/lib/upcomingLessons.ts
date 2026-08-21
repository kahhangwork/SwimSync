// Upcoming lessons for a parent — derived at read time from each active
// enrolment's weekday, NOT pre-generated sessions (docs/ARCHITECTURE.md §6).
//
// The projection is a pure weekday walk over the next few weeks. ⚠ RISK 4
// (WAVE_C_PLAN.md): expectedLessonDates has no holiday awareness, so a naive
// list would tell a parent to turn up on a day the business has declared the
// pool closed. tenant_public_holidays holds those dates and parents can read
// their own tenant's rows (RLS), so this helper subtracts them. A lesson the
// admin CANCELLED in advance (lesson_sessions.cancelled_at, 20260821000700) is
// passed in as an explicit row and rendered struck "Cancelled" — shown, not
// hidden, so the parent sees WHY there is no lesson that day.
//
// `today` is passed in, never read from a clock (§7.7).

import { expectedLessonDates, type DayOfWeek } from "./lessonDates";
import { addDays } from "./scheduleWeek";

export const UPCOMING_HORIZON_DAYS = 28;

export type UpcomingEnrolment = {
  class_id: string;
  day_of_week: DayOfWeek;
  class_title: string;
  /** Preformatted time range, e.g. "5:00 PM – 6:00 PM", or "" when unknown. */
  time_label: string;
};

/** A lesson that is not a weekly-recurring class occurrence — a booked make-up
 *  (guesting into another class) or an admin-scheduled off-schedule extra lesson.
 *  These are EVIDENCE (real rows), not a projection, so they are never subtracted
 *  by the holiday guess and win any (class, date) collision with the projection. */
export type UpcomingExplicit = {
  class_id: string;
  class_title: string;
  session_date: string; // YYYY-MM-DD
  time_label: string;
  /** Why the admin cancelled it — only meaningful on a `cancelled` row. */
  reason?: string | null;
};

export type UpcomingKind = "class" | "makeup" | "extra" | "cancelled";

export type UpcomingLesson = {
  key: string;
  class_id: string;
  class_title: string;
  session_date: string; // YYYY-MM-DD
  time_label: string;
  kind: UpcomingKind;
  /** The admin's cancellation reason on a `cancelled` row; null otherwise. */
  reason: string | null;
};

/** Every lesson a child is expected at from `today` through the horizon, one per
 *  (class, date), sorted ascending by date.
 *
 *  Three sources, in PRECEDENCE order — explicit rows are pushed FIRST so they win
 *  any (class, date) collision with the weekly projection (the projection dedups
 *  against `seen`, which is first-wins). This ordering is structural, not a comment
 *  to remember: a projected weekly date is a GUESS, a make-up/extra row is a booked
 *  fact, so the fact must be the one that survives — and a struck "Cancelled" row
 *  must never lose to a plain projected (or extra) one, which is why it goes first.
 *    1. `cancelled` — lessons the admin cancelled in advance, kind "cancelled" (struck)
 *    2. `makeups`   — booked make-ups (host class), kind "makeup"
 *    3. `extras`    — admin off-schedule lessons in the child's class, kind "extra"
 *    4. projection  — each enrolment's weekday walk, kind "class", holiday dates removed
 *
 *  Explicit rows are filtered to `today <= date <= horizon` but are NOT holiday-subtracted
 *  (evidence is not clamped by the holiday guess — the same principle as the engine's
 *  bookingsByDate). */
export function computeUpcomingLessons(
  enrolments: UpcomingEnrolment[],
  today: string,
  holidays: ReadonlySet<string>,
  makeups: readonly UpcomingExplicit[] = [],
  extras: readonly UpcomingExplicit[] = [],
  cancelled: readonly UpcomingExplicit[] = [],
): UpcomingLesson[] {
  const horizon = addDays(today, UPCOMING_HORIZON_DAYS);
  const out: UpcomingLesson[] = [];
  const seen = new Set<string>();

  // ── Explicit rows FIRST (RISK 6: explicit wins the collision) ──
  const pushExplicit = (rows: readonly UpcomingExplicit[], kind: UpcomingKind) => {
    for (const r of rows) {
      if (r.session_date < today || r.session_date > horizon) continue;
      const key = `${r.class_id}:${r.session_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        class_id: r.class_id,
        class_title: r.class_title,
        session_date: r.session_date,
        time_label: r.time_label,
        kind,
        reason: kind === "cancelled" ? (r.reason ?? null) : null,
      });
    }
  };
  // A cancellation is the strongest fact of the three: it wins over an extra
  // lesson on the same (class, date) — an extra that was later cancelled must
  // read "Cancelled", never "Extra lesson" (plan RISK 5).
  pushExplicit(cancelled, "cancelled");
  pushExplicit(makeups, "makeup");
  pushExplicit(extras, "extra");

  // ── Then the weekly projection ──
  for (const enr of enrolments) {
    for (const date of expectedLessonDates(enr.day_of_week, today, horizon)) {
      if (holidays.has(date)) continue; // ⚠ RISK 4 — the pool is closed that day
      const key = `${enr.class_id}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        class_id: enr.class_id,
        class_title: enr.class_title,
        session_date: date,
        time_label: enr.time_label,
        kind: "class",
        reason: null,
      });
    }
  }
  return out.sort((a, b) => a.session_date.localeCompare(b.session_date));
}
