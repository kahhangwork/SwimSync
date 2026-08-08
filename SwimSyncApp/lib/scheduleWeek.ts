// Week arithmetic for the coach's Schedule tab — Monday-start, SGT-safe.
//
// ⚠ NOTHING HERE READS A CLOCK. `today` is always a parameter, the same
// discipline lib/weekOrder.ts and lib/attendanceWindow.ts follow. §7.7 shipped a
// real double-billing bug because a screen derived its weekday from a second
// `new Date()`; the mitigation is that the derivation cannot happen here at all.
//
// ⚠ THE WEEK IS HELD AS AN OFFSET, NOT AS A DATE. Every function below takes
// `today` and a `weekOffset` integer rather than a stored Monday. The coach app
// is a home-screen PWA that stays mounted for days: an absolute Monday captured
// in `useState` at mount is still last week's after the app survives a
// Sunday→Monday boundary, which would silently hide TODAY's lessons from the
// landing tab while the header read "Last week". An offset re-derives from the
// current `today` on every render and self-corrects. This is a new axis on §7.7
// — not a wrong clock, a FROZEN one.
//
// PRIVATE parseDate/formatDate, deliberately: lib/lessonDates.ts is
// byte-identical to its SwimSyncAdmin twin and does not export them, so
// exporting them there would be two edits and a drift risk. lib/timeOfDay.ts
// and lib/attendanceWindow.ts both carry the same small copy for the same
// reason. Never use `new Date(str).getDay()` — that is LOCAL time, §7.7's
// exact shape.

import { expectedLessonDates, type DayOfWeek } from "./lessonDates";

const DAY_MS = 86_400_000;

/** Monday-first, matching lib/weekOrder.ts's WEEK_ORDER and the Postgres
 *  `day_of_week` enum declaration order. Index 0 = Monday. */
const MONDAY_FIRST: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Parse "YYYY-MM-DD" to a UTC-midnight epoch. NaN if malformed. */
function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a UTC-midnight epoch back to "YYYY-MM-DD". */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date` shifted by `n` days. Returns `date` unchanged if malformed. */
export function addDays(date: string, n: number): string {
  const ms = parseDate(date);
  if (Number.isNaN(ms)) return date;
  return formatDate(ms + n * DAY_MS);
}

/**
 * The MONDAY of the week containing `date`.
 *
 * getUTCDay() is 0 for Sunday, so Sunday must step back SIX days, not zero —
 * that off-by-one (Sunday landing on the *following* Monday) is the classic
 * failure here and is what the property sweep in the test file exists to catch.
 */
export function startOfWeek(date: string): string {
  const ms = parseDate(date);
  if (Number.isNaN(ms)) return date;
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7; // Sunday -> 6, Monday -> 0
  return formatDate(ms - backToMonday * DAY_MS);
}

/** The inclusive [start, end] of the week beginning at `monday`. */
export function weekBounds(monday: string): { start: string; end: string } {
  return { start: monday, end: addDays(monday, 6) };
}

/**
 * The Monday of the week `weekOffset` weeks from the one containing `today`.
 * `weekOffset === 0` is ALWAYS the current week, however long the screen has
 * been mounted — that is the whole point of holding an offset.
 */
export function mondayForOffset(today: string, weekOffset: number): string {
  return addDays(startOfWeek(today), weekOffset * 7);
}

/**
 * How far the coach may navigate, as offsets.
 *
 * BACKWARD stops at the week containing whatever lower bound the CALLER passes.
 * ⚠ That is not necessarily the marking floor. Callers pass
 * `backlogWindowStart(today, null, floor)`, which is the EARLIER of the floor
 * and the 1st of last month — so a business whose floor is newer than that
 * (one that has just sealed a month) is still offered weeks below its floor,
 * where the attendance screen will refuse the date. That is inherited from the
 * old backlog window and is deliberate: the floor can move EARLIER between a
 * render and a fetch, and a bound that only ever widens can never hide a lesson
 * the coach could still mark. Do not "fix" the caller to pass the raw floor
 * without re-reading §7.95 and markable_floor's LEAST argument.
 * FORWARD stops at the end of next week — a coach cannot act on anything
 * further out, and every extra week is another round trip.
 *
 * `floor` is `markable_floor` as fetched by lib/markableFloor.ts, which returns
 * null on EVERY failure path. A null floor degrades to "this week only
 * backwards"? No — it degrades to the same calendar rule the rest of the app
 * uses, which the CALLER supplies via backlogWindowStart(). Pass that, not raw
 * server output, so a failed fetch never TIGHTENS the window.
 */
export function selectableWeekOffsets(
  today: string,
  floor: string | null | undefined
): { min: number; max: number } {
  const max = 1; // through the end of next week
  if (!floor) return { min: 0, max };
  const thisMonday = startOfWeek(today);
  const floorMonday = startOfWeek(floor);
  const a = parseDate(thisMonday);
  const b = parseDate(floorMonday);
  if (Number.isNaN(a) || Number.isNaN(b)) return { min: 0, max };
  // Whole weeks between the two Mondays; negative because the floor is earlier.
  const min = Math.min(0, Math.round((b - a) / (7 * DAY_MS)));
  return { min, max };
}

export function canGoBack(weekOffset: number, min: number): boolean {
  return weekOffset > min;
}

export function canGoForward(weekOffset: number, max: number): boolean {
  return weekOffset < max;
}

/**
 * Label for the week selector: "This week" / "Last week" / "Next week" for the
 * three the coach actually names, and a date range otherwise.
 */
export function weekLabel(monday: string, today: string): string {
  const offset = Math.round(
    (parseDate(monday) - parseDate(startOfWeek(today))) / (7 * DAY_MS)
  );
  if (offset === 0) return "This week";
  if (offset === -1) return "Last week";
  if (offset === 1) return "Next week";
  return "";
}

/** The weekday of `date` as a Monday-first index (0 = Monday, 6 = Sunday). */
export function mondayFirstIndex(date: string): number {
  const ms = parseDate(date);
  if (Number.isNaN(ms)) return -1;
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** The weekday name of `date`, Monday-first table. Null if malformed. */
export function weekdayOf(date: string): DayOfWeek | null {
  const i = mondayFirstIndex(date);
  return i < 0 ? null : MONDAY_FIRST[i];
}

/**
 * WHICH LESSONS EXIST for one class in [from, to] — the union of three sources.
 *
 * Extracted verbatim from the coach Today screen's backlog loop so the Schedule
 * tab's two ranges (the floor-scoped NEEDS MARKING set and the selected week)
 * cannot drift from each other or from the original. It is the same union the
 * billing engine makes in generate-invoices/core.ts (`datesToCheck`), and it
 * has to be, because a date this misses is a lesson the coach never sees while
 * the engine still blocks the month on it. §7.18 is what happens when two
 * hand-written answers to this question disagree.
 *
 *  1. Derived weekday dates — the ordinary case.
 *  2. BOOKING dates (trials + make-ups). A trial on a date with no session row
 *     would otherwise never appear.
 *  3. Dates that ALREADY HAVE A SESSION. A lesson the admin scheduled off the
 *     class's weekday is not derivable from `day_of_week` at all.
 *
 * Bounds are inclusive; sources 2 and 3 are clipped to them. Ascending, deduped.
 */
export function lessonDatesInRange(
  dayOfWeek: DayOfWeek,
  from: string,
  to: string,
  bookedDates: Iterable<string> = [],
  sessionDates: Iterable<string> = []
): string[] {
  const inRange = (d: string) => d >= from && d <= to;
  return [
    ...new Set([
      ...expectedLessonDates(dayOfWeek, from, to),
      ...[...bookedDates].filter(inRange),
      ...[...sessionDates].filter(inRange),
    ]),
  ].sort();
}
