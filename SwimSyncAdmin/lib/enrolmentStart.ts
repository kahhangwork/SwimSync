// "Starts on" — the pure half of adding a child to a class from a date other than
// today, and of changing that date afterwards (Wave 4, 20261005000100;
// docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.4).
//
// The database decides what is ALLOWED (set_enrolment_start refuses a future
// start, one below markable_floor, one before a previous window, a later move
// past a mark). This file decides what the admin is TOLD before they press Save,
// from enrolment_start_bounds() — it never re-derives the floor (a second
// implementation would drift).
//
// ⚠ RISK 1: a backdate creates EXPECTED lessons, and an expected lesson nobody
// marks blocks that month's billing — and every later month waits for it. A
// business that has never billed has a floor months back (its creation date), so
// the warning covers EVERY past month, not only sealed ones, and a start in an
// earlier month that is not yet billed needs a second press.
//
// ⚠ RISK 6: moving a start LATER makes lessons stop being expected. That is not a
// way to clear the unmarked block — the fix for a lesson that didn't run stays
// "mark it cancelled". droppedDates() lists them so the dialog can say so.

import {
  expectedLessonDates,
  formatSgDate,
  type DayOfWeek,
} from "./lessonDates";

export interface StartBounds {
  floor: string;
  today: string;
  lastSealedMonth: string | null;
  dayOfWeek: DayOfWeek | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * enrolment_start_bounds() → StartBounds, or the TODAY-ONLY fallback when the
 * payload is missing or malformed (⚠ RISK 14: a bounds failure must leave the
 * Add working exactly as it did before this feature, never disable it).
 */
export function parseBounds(raw: unknown, today: string): StartBounds {
  const r = (raw ?? {}) as Record<string, unknown>;
  const floor = typeof r.floor === "string" && ISO.test(r.floor) ? r.floor : null;
  const t = typeof r.today === "string" && ISO.test(r.today) ? r.today : null;
  if (!floor || !t || floor > t) return todayOnly(today);
  const sealed =
    typeof r.last_sealed_month === "string" && /^\d{4}-\d{2}$/.test(r.last_sealed_month)
      ? r.last_sealed_month
      : null;
  const dow = DAYS.includes(r.day_of_week as DayOfWeek) ? (r.day_of_week as DayOfWeek) : null;
  return {
    floor,
    today: t,
    lastSealedMonth: sealed,
    dayOfWeek: dow,
  };
}

/** The fallback: the field can only say today, and there is nothing to warn about. */
export function todayOnly(today: string): StartBounds {
  return { floor: today, today, lastSealedMonth: null, dayOfWeek: null };
}

export interface StartBuckets {
  /** Lessons in months already billed (≤ lastSealedMonth). */
  sealed: string[];
  /** Lessons in EARLIER months not yet billed — each blocks that month. */
  unbilled: string[];
  /** Earlier lessons in the current month. */
  current: string[];
}

/** The class's lessons the chosen start creates BEFORE today, by billing state. */
export function bucketStart(bounds: StartBounds, start: string): StartBuckets {
  const out: StartBuckets = { sealed: [], unbilled: [], current: [] };
  if (!bounds.dayOfWeek || !ISO.test(start) || start >= bounds.today) return out;
  const thisMonth = bounds.today.slice(0, 7);
  for (const d of expectedLessonDates(bounds.dayOfWeek, start, bounds.today)) {
    if (d >= bounds.today) continue;
    const m = d.slice(0, 7);
    if (bounds.lastSealedMonth && m <= bounds.lastSealedMonth) out.sealed.push(d);
    else if (m < thisMonth) out.unbilled.push(d);
    else out.current.push(d);
  }
  return out;
}

export type WarningTone = "sealed" | "unbilled" | "quiet";
export interface StartWarning {
  tone: WarningTone;
  text: string;
}

const monthName = (m: string) => formatSgDate(`${m}-01`, { month: "long" });
const monthKeys = (dates: string[]) => [...new Set(dates.map((d) => d.slice(0, 7)))];
const monthsOf = (dates: string[]) => monthKeys(dates).map(monthName).join(", ");
const lessons = (n: number) => `${n} lesson${n === 1 ? "" : "s"}`;

/** What the admin reads under the date, most serious first. */
export function startWarnings(
  bounds: StartBounds,
  start: string,
  childName: string
): StartWarning[] {
  const b = bucketStart(bounds, start);
  const out: StartWarning[] = [];
  if (b.sealed.length > 0) {
    out.push({
      tone: "sealed",
      text:
        `${monthsOf(b.sealed)} ${monthKeys(b.sealed).length === 1 ? "is" : "are"} already billed. ` +
        `${lessons(b.sealed.length)} there will be listed under Unbilled lessons for the ` +
        `business owner to settle.`,
    });
  }
  if (b.unbilled.length > 0) {
    out.push({
      tone: "unbilled",
      text:
        `${childName} will be expected at ${lessons(b.unbilled.length)} in ${monthsOf(b.unbilled)}, ` +
        `which ${monthKeys(b.unbilled).length === 1 ? "hasn't" : "haven't"} been billed. Each must be marked ` +
        `(present, absent or cancelled) before ${monthName(b.unbilled[0].slice(0, 7))} can be ` +
        `billed, and every later month waits for it. The coach will see them to mark.`,
    });
  }
  if (b.current.length > 0) {
    out.push({
      tone: "quiet",
      text: `${lessons(b.current.length)} earlier this month will need marking.`,
    });
  }
  return out;
}

/** A start in an earlier, not-yet-billed month needs a second press (RISK 1). */
export function needsStartConfirmation(
  bounds: StartBounds,
  start: string,
  alreadyConfirmed: boolean
): boolean {
  return bucketStart(bounds, start).unbilled.length > 0 && !alreadyConfirmed;
}

/**
 * The class's weekday lessons in [oldStart, newStart) — the ones a LATER start
 * stops expecting (RISK 6). Empty when the new start is not later.
 */
export function droppedDates(
  dayOfWeek: DayOfWeek | null,
  oldStart: string,
  newStart: string
): string[] {
  if (!dayOfWeek || !ISO.test(oldStart) || !ISO.test(newStart) || newStart <= oldStart) return [];
  return expectedLessonDates(dayOfWeek, oldStart, newStart).filter((d) => d < newStart);
}
