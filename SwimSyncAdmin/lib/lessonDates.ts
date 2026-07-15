// Lesson date maths — which lessons SHOULD have happened, in Singapore time.
//
// TWIN FILE: SwimSyncApp/lib/lessonDates.ts is byte-identical. Keep in sync.
// The two apps are separate npm projects with no shared package, so this is
// duplicated rather than extracted. It has NO imports to keep drift obvious.
//
// Date strings are always "YYYY-MM-DD". Never derive one via toISOString() —
// that yields the UTC date, which is the *previous* day in SGT (UTC+8) before
// 08:00 local. Use todayInSg()/toSgDate() instead.

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

// Index matches Date.prototype.getUTCDay(): 0 = Sunday.
const DAY_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_MS = 86_400_000;

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

/**
 * The calendar date in Asia/Singapore, regardless of the device's timezone.
 * Assembled from formatToParts rather than trusting format() to emit ISO —
 * Hermes' ICU is not worth betting an invoice on. Singapore has no DST.
 */
export function todayInSg(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The Singapore calendar date of a timestamptz ISO string (e.g. enrolled_at). */
export function toSgDate(iso: string): string {
  return todayInSg(new Date(iso));
}

/**
 * Format a "YYYY-MM-DD" for display, e.g. "Sat, 18 Jul".
 *
 * Parses AND formats as UTC, so the label always shows the date you passed in.
 * Callers cannot opt out of that: `new Date("2026-07-18").toLocaleDateString()`
 * formats a UTC midnight in the *device's* zone, which renders the previous day
 * anywhere west of Greenwich.
 */
export function formatSgDate(
  date: string,
  opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  }
): string {
  const ms = parseDate(date);
  if (Number.isNaN(ms)) return date;
  return new Date(ms).toLocaleDateString("en-SG", { ...opts, timeZone: "UTC" });
}

const DAY_NAMES: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * The weekday of a "YYYY-MM-DD" string. Derive the weekday from the same date
 * string the rest of the screen uses — reading it off a separate `new Date()`
 * lets the two disagree across a timezone boundary (which shipped a bug: a
 * screen listed Saturday's classes while writing attendance to Friday's date).
 */
export function dayOfWeekOf(date: string): DayOfWeek | null {
  const ms = parseDate(date);
  if (Number.isNaN(ms)) return null;
  return DAY_NAMES[new Date(ms).getUTCDay()];
}

/**
 * Every occurrence of `dayOfWeek` in [from, to], inclusive, ascending.
 * Returns [] if from > to or either bound is malformed.
 */
export function expectedLessonDates(
  dayOfWeek: DayOfWeek,
  from: string,
  to: string
): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];

  const target = DAY_INDEX[dayOfWeek];
  if (target === undefined) return [];

  // Step forward to the first occurrence on/after `from`, then every 7 days.
  const offset = (target - new Date(start).getUTCDay() + 7) % 7;
  const dates: string[] = [];
  for (let ms = start + offset * DAY_MS; ms <= end; ms += 7 * DAY_MS) {
    dates.push(formatDate(ms));
  }
  return dates;
}

/** First and last calendar date of a "YYYY-MM" billing month. */
export function monthBounds(billingMonth: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(billingMonth);
  if (!m) return { start: "", end: "" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  // Day 0 of the next month is the last day of this one — handles leap years.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${m[1]}-${m[2]}-01`,
    end: `${m[1]}-${m[2]}-${pad(lastDay)}`,
  };
}

/**
 * Lower bound for the coach's unmarked-lesson backlog:
 * max(first day of the previous month, earliest enrolment).
 *
 * The previous-month floor is the window the coach can still act on — once a
 * month is invoiced, a late-marked lesson is not added to the existing invoice
 * and needs a credit note instead, so surfacing older gaps would only train the
 * coach to ignore the list.
 */
export function backlogWindowStart(
  today: string,
  earliestEnrolmentDate: string | null
): string {
  const t = parseDate(today);
  if (Number.isNaN(t)) return earliestEnrolmentDate ?? "";

  const d = new Date(t);
  const prevMonthStart = formatDate(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)
  );

  if (!earliestEnrolmentDate) return prevMonthStart;
  // Both are "YYYY-MM-DD", so lexical comparison is chronological.
  return earliestEnrolmentDate > prevMonthStart
    ? earliestEnrolmentDate
    : prevMonthStart;
}
