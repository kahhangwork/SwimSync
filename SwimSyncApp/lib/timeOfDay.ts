// Time of day, in Singapore, for the coach's screens.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// The Today screen decided whether a class was happening "now" with
//
//     const nowMins = now.getHours() * 60 + now.getMinutes();
//
// which is the DEVICE's local time, sitting directly beside a date derived from
// todayInSg(). Date and time-of-day could therefore disagree — the same
// §7.7 shape that shipped a real double-billing bug, in a new place. It only
// drove a cosmetic "Now" badge, so nobody noticed; the moment a card's status
// depends on "has this class ended yet", a device an hour behind SGT would show
// "Upcoming" on a lesson that finished, and the coach would never be told to
// mark it. That is exactly the hole the Unmarked Lessons safety net exists to
// close (§8i).
//
// ── THE SHAPE IS THE MITIGATION ─────────────────────────────────────────────
// Only nowMinutesInSg() is allowed to know about timezones. Everything that
// COMPARES times takes a plain `nowMinutes: number`, so those functions cannot
// read a clock and therefore cannot read the wrong one. There is one conversion
// in the coach app and it is unit-tested against fixed instants under several
// process timezones.
//
// ── WHY NOT lessonDates.ts ──────────────────────────────────────────────────
// Same reason attendanceWindow.ts is not there: that file is duplicated
// byte-identical in SwimSyncAdmin, and only the coach app cares what time of day
// it is. Adding to it would mean two edits and a twin that drifts.

/** Minutes since midnight in Asia/Singapore. */
export function nowMinutesInSg(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Some ICU builds render midnight as hour "24" with hour12:false. Left
  // unhandled that is 1440 minutes — past every class's end time — so every
  // lesson would read as ended. Normalise it to 0.
  const hour = get("hour") % 24;
  return hour * 60 + get("minute");
}

/** Minutes since midnight for a "HH:MM" or "HH:MM:SS" clock time. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Is `nowMinutes` inside [start, end]? Inclusive at both ends, matching the
 * behaviour of the expression this replaced.
 *
 * Takes a NUMBER, not a Date — see the header. Callers get it from
 * nowMinutesInSg().
 */
export function isNowInRange(
  start: string,
  end: string,
  nowMinutes: number
): boolean {
  return nowMinutes >= toMinutes(start) && nowMinutes <= toMinutes(end);
}

/**
 * Has a lesson finishing at `end` already finished?
 *
 * This is what separates "nothing to do yet" from "you owe me attendance". It
 * is deliberately keyed to the END of the class, not the start: a coach marks
 * at the end of a lesson, so a class in progress is still `Upcoming` rather
 * than already overdue.
 */
export function hasEndedInSg(end: string, nowMinutes: number): boolean {
  return nowMinutes > toMinutes(end);
}

/**
 * Has the lesson ON `date` finishing at `end` already finished, given `today`?
 *
 * The DATED generalisation of hasEndedInSg, for any screen showing more than
 * one day at a time. The coach Today screen only ever needed the same-day case
 * and hardcoded `true` for its backlog; a week view needs all three, and
 * getting the middle one wrong is what makes a future lesson render as
 * "Not marked" — nagging a coach about a lesson that has not happened.
 *
 *   date <  today  ->  true   (a past lesson has always ended)
 *   date >  today  ->  false  (a future one never has)
 *   date == today  ->  ask the clock, via hasEndedInSg
 *
 * Takes `today` and `nowMinutes` as PARAMETERS and reads no clock itself —
 * the rule this whole file exists to enforce (§7.7).
 */
export function hasLessonEnded(
  date: string,
  today: string,
  end: string,
  nowMinutes: number
): boolean {
  if (date < today) return true;
  if (date > today) return false;
  return hasEndedInSg(end, nowMinutes);
}
