// Can attendance be marked for this date? — the client's copy of the rule.
//
// The DATABASE is where this is enforced (20260727000100_attendance_window_guard):
// two triggers, gated on the caller being `authenticated`, so a hand-typed URL
// or a direct PostgREST call is refused whatever the app does. RLS constrains
// WHOSE class a coach may write, never WHICH date, so without that migration
// the window was a UI convention rather than a rule.
//
// THIS FILE IS THE AFFORDANCE, NOT THE GUARD. Its whole job is to fail early
// and in English, so a coach who reaches a bad date sees "that lesson is
// closed" instead of a roster that refuses to save with a Postgres error. If
// the two ever disagree, the database wins — and this file being WRONG can only
// ever be annoying, whereas the database being wrong would be a billing bug.
// The same relationship previousBillingMonth() has with the engine's month
// guard: the picker is an affordance, the engine is the rule.
//
// Deliberately NOT in lessonDates.ts: that file is duplicated byte-identical in
// both apps and only the coach app marks attendance.

import { backlogWindowStart, dayOfWeekOf, type DayOfWeek } from "./lessonDates";

export type MarkableCheck =
  | { ok: true }
  | { ok: false; title: string; detail: string };

/**
 * The floor of the markable window, as the DATABASE computes it: the 1st of
 * last month.
 *
 * NOTE this is deliberately looser than the coach roster's floor, which is
 * `max(1st of last month, earliest enrolment)`. The roster is choosing what to
 * OFFER and may be as tight as it likes; this is checking what will be
 * REFUSED, and refusing something the database would accept would be a bug
 * invented by the client. Passing `null` here is what drops the
 * enrolment-aware half of backlogWindowStart().
 */
export function markableWindowStart(today: string): string {
  return backlogWindowStart(today, null);
}

/**
 * Is `date` a lesson this coach may mark?
 *
 * `sessionExists` matters: a session that is already on the books was created
 * by something that passed the rule — including an off-schedule lesson the
 * admin scheduled deliberately (schedule_extra_lesson). Re-deriving the weekday
 * for those would refuse to mark the very lessons the override exists to
 * create, which is why the database's attendance trigger checks the window and
 * NOT the weekday.
 */
export function checkMarkableDate(opts: {
  date: string;
  today: string;
  classDayOfWeek: DayOfWeek;
  classTitle: string;
  sessionExists: boolean;
}): MarkableCheck {
  const { date, today, classDayOfWeek, classTitle, sessionExists } = opts;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      title: "That date isn't valid",
      detail: "Go back to the class and pick a lesson from the list.",
    };
  }

  if (date > today) {
    return {
      ok: false,
      title: "That lesson hasn't happened yet",
      detail:
        "Attendance can only be marked once a lesson has taken place. Come back on the day.",
    };
  }

  const floor = markableWindowStart(today);
  if (date < floor) {
    return {
      ok: false,
      title: "That lesson is closed",
      detail:
        `Attendance can be marked back to ${floor}. An earlier lesson sits behind ` +
        `an invoice that has already been sent, so a correction to it needs a ` +
        `credit note rather than a late mark — ask your admin.`,
    };
  }

  // An existing session has already been authorised; only a NEW one has to fall
  // on the class's own weekday.
  if (!sessionExists && dayOfWeekOf(date) !== classDayOfWeek) {
    return {
      ok: false,
      title: "That isn't a lesson day",
      detail:
        `${classTitle} runs on ${classDayOfWeek}, and ${date} is a ` +
        `${dayOfWeekOf(date) ?? "different day"}. If the lesson genuinely moved, ` +
        `your admin can schedule it as an extra lesson.`,
    };
  }

  return { ok: true };
}
