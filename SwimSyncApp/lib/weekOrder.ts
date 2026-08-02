// Grouping the coach's class list by weekday, with today's classes first.
//
// ⚠ THE WEEKDAY IS A PARAMETER. Nothing in this file reads a clock, and nothing
// in it may start to. Pairing a local `getDay()` with a date derived some other
// way is what shipped a real double-billing bug (§7.7), and the fix that stuck
// was structural: `lib/timeOfDay.ts` made the comparison functions take a plain
// number so the device's timezone has no way in. Same shape here — the caller
// passes `dayOfWeekOf(todayInSg())`.

import type { DayOfWeek } from "./lessonDates";

/**
 * Monday-first, matching the declaration order of the Postgres `day_of_week`
 * ENUM (`20260309000100_initial_schema.sql:15`). That is not a coincidence to
 * preserve loosely: the classes query relies on `.order("day_of_week")` sorting
 * in week order rather than alphabetically, which is only true because the enum
 * is declared this way. This constant and that column must agree.
 */
export const WEEK_ORDER: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type WeekdayGroup<T> = {
  /** The weekday label, or the raw value for a day we don't recognise. */
  day: string;
  /** True for the one group matching `todayDow`. */
  isToday: boolean;
  items: T[];
};

/**
 * Group `items` by weekday: today's group first, the rest continuing in week
 * order and wrapping around the end of the week.
 *
 * - **Days with no items are omitted** — a coach who teaches Tuesday and
 *   Saturday sees two headers, not seven with five empty.
 * - **Input order is preserved within a day.** The query already sorts by
 *   `start_time`, so this is a stable regroup, never a re-sort.
 * - **An unrecognised weekday is kept, not dropped**, and sorts last. A class
 *   is the coach's livelihood; silently vanishing one because its day failed a
 *   string match is far worse than showing it in an odd position. (The column
 *   is an enum, so this should be unreachable — it is here so that if it ever
 *   becomes reachable, the failure is visible rather than silent.)
 * - **`todayDow === null`** (an unparseable date) falls back to plain week
 *   order with no group marked today. A list in the ordinary order beats no
 *   list.
 */
export function groupByWeekday<T>(
  items: T[],
  dayOf: (item: T) => string,
  todayDow: DayOfWeek | null
): WeekdayGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOf(item);
    const list = buckets.get(day);
    if (list) list.push(item);
    else buckets.set(day, [item]);
  }

  const start = todayDow ? WEEK_ORDER.indexOf(todayDow) : -1;
  const known =
    start < 0
      ? WEEK_ORDER
      : [...WEEK_ORDER.slice(start), ...WEEK_ORDER.slice(0, start)];

  const groups: WeekdayGroup<T>[] = [];
  for (const day of known) {
    const list = buckets.get(day);
    if (list && list.length > 0) {
      groups.push({ day, isToday: day === todayDow, items: list });
    }
  }

  // Anything whose weekday we did not recognise, in first-seen order.
  for (const [day, list] of buckets) {
    if (!(WEEK_ORDER as string[]).includes(day) && list.length > 0) {
      groups.push({ day, isToday: false, items: list });
    }
  }

  return groups;
}

/** "monday" → "Monday". Presentation only. */
export function weekdayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}
