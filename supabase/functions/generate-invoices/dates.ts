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
