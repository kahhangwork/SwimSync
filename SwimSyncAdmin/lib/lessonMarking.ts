// Pure rules for the admin lesson page's attendance table — what a row may be
// set to, which rows may be edited, and what needs a confirm. The DB is the
// guard (window, weekday, holiday seam, credit lock); these only explain and
// pre-empt, and can never be STRICTER than the database about an EXISTING row:
// a correction is always allowed by guard_attendance_date, so a row that has a
// status stays editable whatever the date.

import { checkMarkableDate, type MarkableCheck } from "./attendanceWindow";
import type { DayOfWeek } from "./lessonDates";

export type DbStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free"
  | "holiday";

export const STATUS_LABEL: Record<DbStatus, string> = {
  present: "Present",
  absent: "Absent",
  cancelled_rain: "Cancelled (rain)",
  cancelled_coach: "Cancelled (coach)",
  trial_paid: "Trial (paid)",
  trial_free: "Trial (free)",
  holiday: "Public holiday",
};

export type RosterKind = "enrolled" | "trial" | "makeup";

/**
 * The statuses a row of this kind may take. Trial statuses are for TRIAL
 * guests only (PRD §7.6 — "if Trial is selected…" is about a trial child);
 * a make-up guest is marked like a member. Holiday is admin-only and the
 * admin is the one here, so it is offered to every kind.
 */
export function optionsForKind(kind: RosterKind): DbStatus[] {
  const base: DbStatus[] = ["present", "absent", "cancelled_rain", "cancelled_coach"];
  if (kind === "trial") return [...base, "trial_paid", "trial_free", "holiday"];
  return [...base, "holiday"];
}

/** The "Set all" choices — what makes sense for a whole lesson at once. */
export const SET_ALL_OPTIONS: DbStatus[] = ["present", "absent", "cancelled_rain", "cancelled_coach", "holiday"];

export type RowState = { studentId: string; kind: RosterKind; prev: DbStatus | null; next: DbStatus | null };

/**
 * How many rows would this save turn INTO holiday? That is a money-moving void
 * for each of those families (non-billable + package extension), so the page
 * confirms it, naming the number.
 */
export function holidayTransitions(rows: readonly RowState[]): number {
  return rows.filter((r) => r.next === "holiday" && r.prev !== "holiday").length;
}

/**
 * Can this date be marked at all, and can a NEW row be added on it?
 *
 * Returns the client affordance from checkMarkableDate for NEW rows; rows that
 * already exist are corrections and are always editable. `runsOnWeekday` and
 * `sessionExists` decide the deep-link refusal: a date the class does not run
 * on and that has no session row is not a lesson, and the page must not offer
 * to invent one (the DB would refuse anyway — assert_class_runs_on).
 */
export function lessonMarkability(opts: {
  date: string;
  today: string;
  classDayOfWeek: DayOfWeek;
  classTitle: string;
  sessionExists: boolean;
  windowFloor: string | null;
}): MarkableCheck {
  return checkMarkableDate({
    date: opts.date,
    today: opts.today,
    classDayOfWeek: opts.classDayOfWeek,
    classTitle: opts.classTitle,
    sessionExists: opts.sessionExists,
    windowFloor: opts.windowFloor,
  });
}

/** A row with a status is a correction (always editable); a new row needs the date to be markable. */
export function rowEditable(hasRow: boolean, newRowsAllowed: boolean): boolean {
  return hasRow || newRowsAllowed;
}

/** "Wednesday" from "wednesday" — for the refusal copy. */
export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
