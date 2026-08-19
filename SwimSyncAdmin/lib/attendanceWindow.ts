// Can attendance be marked for this date? — the client's copy of the rule.
//
// The DATABASE is where this is enforced (20260727000100_attendance_window_guard):
// two triggers, gated on the caller being `authenticated`, so a hand-typed URL
// or a direct PostgREST call is refused whatever the app does. RLS constrains
// WHOSE class a coach may write, never WHICH date, so without that migration
// the window was a UI convention rather than a rule.
//
// THE FLOOR IS PER BUSINESS, AND IT IS NOT THE CALENDAR. Since 20260806000200
// it is `markable_floor(tenant)` — the 1st of last month, or EARLIER if the
// business has months that were never sealed, so that billing a month late
// cannot strand a lesson nobody may record any more. Screens read it from
// `markable_window_start()` and hand it in as `windowFloor`. Anything that
// hardcodes "the 1st of last month" as the floor is now wrong.
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
 * The floor of the markable window, as the DATABASE computes it.
 *
 * Since 20260806000200 that is PER BUSINESS and follows `billing_periods`, not
 * the calendar: `markable_floor(tenant)` is the 1st of last month OR earlier,
 * reaching back to the month after the business's latest sealed one. Pass what
 * `markable_window_start()` returned as `serverFloor`; omit it and this falls
 * back to the calendar rule, which is what the database enforced before that
 * migration and therefore always a safe answer.
 *
 * NOTE this is deliberately looser than the coach roster's floor, which is
 * `max(that floor, earliest enrolment)`. The roster is choosing what to
 * OFFER and may be as tight as it likes; this is checking what will be
 * REFUSED, and refusing something the database would accept would be a bug
 * invented by the client. Passing `null` for the enrolment is what drops the
 * enrolment-aware half of backlogWindowStart().
 */
export function markableWindowStart(
  today: string,
  serverFloor?: string | null
): string {
  return backlogWindowStart(today, null, serverFloor);
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
  /**
   * The business's own floor from markable_window_start(). Optional on purpose:
   * a screen that has not fetched it yet, or whose fetch failed, gets the
   * calendar rule and refuses only what the database refused before
   * 20260806000200. It can never make this check STRICTER than the database.
   */
  windowFloor?: string | null;
}): MarkableCheck {
  const { date, today, classDayOfWeek, classTitle, sessionExists, windowFloor } =
    opts;

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

  const floor = markableWindowStart(today, windowFloor);
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
