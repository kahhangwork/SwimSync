// Upcoming lessons for a parent — derived at read time from each active
// enrolment's weekday, NOT pre-generated sessions (docs/ARCHITECTURE.md §6).
//
// The projection is a pure weekday walk over the next few weeks. ⚠ RISK 4
// (WAVE_C_PLAN.md): expectedLessonDates has no holiday awareness, so a naive
// list would tell a parent to turn up on a day the business has declared the
// pool closed. tenant_public_holidays holds those dates and parents can read
// their own tenant's rows (RLS), so this helper subtracts them. Ad-hoc
// lesson_sessions cancellations are NOT reflected — that is a named follow-up,
// not covered here.
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

export type UpcomingLesson = {
  key: string;
  class_id: string;
  class_title: string;
  session_date: string; // YYYY-MM-DD
  time_label: string;
};

/** Every lesson a child is expected at from `today` through the horizon, one per
 *  (class, date), holiday dates removed, sorted ascending by date. */
export function computeUpcomingLessons(
  enrolments: UpcomingEnrolment[],
  today: string,
  holidays: ReadonlySet<string>,
): UpcomingLesson[] {
  const horizon = addDays(today, UPCOMING_HORIZON_DAYS);
  const out: UpcomingLesson[] = [];
  const seen = new Set<string>();
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
      });
    }
  }
  return out.sort((a, b) => a.session_date.localeCompare(b.session_date));
}
