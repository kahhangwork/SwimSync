// Timezone-aware date helpers for the billing engine.
//
// The DEFAULT billing month (used by the daily cron, which POSTs an empty body)
// must be the calendar month *before today in the app's timezone* — NOT the UTC
// month. Edge Functions run in UTC, so deriving the month from new Date()'s
// local fields bills the wrong month at the SGT day boundary: the 1am SGT cron
// run is 17:00 UTC the day before, so on 1 Aug it would compute June, not July.
//
// This mirrors todayInSg() in SwimSyncApp/lib/lessonDates.ts (Intl.DateTimeFormat
// + formatToParts, DST-safe). It's duplicated Deno-side rather than imported from
// the app twin for the same reason the completeness rule is (Deno, no npm
// resolution). This file is the single timezone seam for the engine.

// The app's billing timezone. Single point of change; env-overridable so a
// future deployment can be re-homed without a code edit. Not per-tenant by
// design — a single configured timezone, sufficient while all usage is SGT.
export const APP_TIMEZONE = Deno.env.get("APP_TIMEZONE") ?? "Asia/Singapore";

/**
 * The calendar date "YYYY-MM-DD" of an instant in the given IANA timezone.
 * Assembled from formatToParts (not trusting format() to emit ISO). Mirrors
 * todayInSg().
 */
export function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Day of the month (1..31) at `now` in `timeZone`. */
export function dayOfMonthInTimeZone(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): number {
  return Number(dateInTimeZone(now, timeZone).split("-")[2]);
}

/** Fallback when app_settings has no usable invoice_run_day. */
export const DEFAULT_INVOICE_RUN_DAY = 7;

/**
 * Normalise a configured invoice_run_day into a usable day-of-month.
 *
 * Two different kinds of bad input, handled differently on purpose:
 *   • Missing or unparseable (null, "", junk) → the DEFAULT. Note Number(null)
 *     is 0, so coercing first would silently yield day 1 — the earliest
 *     possible run, i.e. exactly the too-early billing this setting exists to
 *     avoid. Same for a value below 1: intent is unclear, so prefer the safe
 *     default over the earliest day.
 *   • Above the range (29–31) → 28. Here intent IS clear ("late in the
 *     month"), so honour it as closely as February allows; 29–31 would
 *     silently never fire that month, which looks like "cron is broken".
 */
export function clampRunDay(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_INVOICE_RUN_DAY;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_INVOICE_RUN_DAY;
  const day = Math.trunc(n);
  if (day < 1) return DEFAULT_INVOICE_RUN_DAY;
  return Math.min(28, day);
}

/**
 * The billing month "YYYY-MM" = the calendar month before `now` in `timeZone`.
 * Month arithmetic is done on the extracted numbers, so it's offset- and
 * DST-safe and handles the year rollover (Jan → previous Dec) without a Date.
 */
export function previousBillingMonth(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): string {
  const [y, m] = dateInTimeZone(now, timeZone).split("-").map(Number); // m = 1..12
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

// ── Expected lesson dates ───────────────────────────────────────────────────
// Mirrors expectedLessonDates() in {SwimSyncApp,SwimSyncAdmin}/lib/lessonDates.ts.
// Duplicated Deno-side for the same reason as the rest of this file (no npm
// resolution in Edge Functions). If you change the derivation, change all three.
//
// The engine needs this because lesson_sessions rows are created LAZILY by
// attendance marking (PRD §7.5): a lesson nobody touched has no row at all, so
// a gate that only inspects existing sessions cannot see it. Deriving the dates
// a class SHOULD have run is the only way the engine can tell "fully marked"
// from "never marked".

export type DayOfWeek =
  | "sunday" | "monday" | "tuesday" | "wednesday"
  | "thursday" | "friday" | "saturday";

const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" as a UTC midnight instant. NaN if malformed. */
function parseDate(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Every occurrence of `dayOfWeek` in [from, to], inclusive, ascending.
 * Returns [] if from > to or either bound is malformed.
 */
export function expectedLessonDates(
  dayOfWeek: string,
  from: string,
  to: string
): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];

  const target = DAY_INDEX[dayOfWeek];
  if (target === undefined) return [];

  const offset = (target - new Date(start).getUTCDay() + 7) % 7;
  const dates: string[] = [];
  for (let ms = start + offset * DAY_MS; ms <= end; ms += 7 * DAY_MS) {
    dates.push(formatDate(ms));
  }
  return dates;
}
