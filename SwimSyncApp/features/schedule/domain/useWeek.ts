// The Schedule tab's week: the offset the arrows move, and every date the
// screen derives from it (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 3). Moved
// verbatim from app/(coach)/schedule/index.tsx.
//
// ⚠ RECOMPUTED ON EVERY RENDER, AND IT MUST STAY THAT WAY. No useMemo on
// `todayDate` / `nowMins`: a memoised clock is a FROZEN clock (the ⚠ OFFSET
// comment below). `bounds` is NOT here — it needs the load's `floor`, so it is
// derived after the load hook (never make this hook take `floor`).
import { useState } from "react";
import { todayInSg, formatSgDate } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";
import { mondayForOffset, weekBounds, weekLabel } from "@/lib/scheduleWeek";

export function useWeek() {
  // ⚠ AN OFFSET, NEVER A STORED MONDAY. `useState(startOfWeek(todayInSg()))`
  // evaluates ONCE, at mount — and this app is a home-screen PWA that stays
  // mounted for days. Survive a Sunday→Monday boundary with an absolute Monday
  // in state and it is now LAST week's: the TODAY section disappears and the
  // header quietly reads "Last week", so today's lessons are missing from the
  // coach's landing tab with nothing saying why. An offset re-derives from the
  // current `todayDate` on every render and self-corrects. A new axis on §7.7 —
  // not a wrong clock, a FROZEN one.
  const [weekOffset, setWeekOffset] = useState(0);

  // Everything below derives from this one date string, so the weekday we query
  // by can never disagree with the date we write attendance to.
  const todayDate = todayInSg();
  // Read ONCE per render, in Singapore, and passed to every comparison below.
  // The functions that use it take a number and cannot read a clock themselves,
  // so the device's timezone has no way in (§7.7, lib/timeOfDay.ts).
  const nowMins = nowMinutesInSg();
  const todayStr = formatSgDate(todayDate, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const selectedMonday = mondayForOffset(todayDate, weekOffset);
  const { start: weekStart, end: weekEnd } = weekBounds(selectedMonday);
  /** The ONLY definition of "this week" — see the weekOffset comment. */
  const showsTodaySection = weekOffset === 0;
  /** "" for weeks further out than last/this/next — the range speaks for itself. */
  const label = weekLabel(selectedMonday, todayDate);

  return {
    weekOffset,
    setWeekOffset,
    todayDate,
    nowMins,
    todayStr,
    weekStart,
    weekEnd,
    showsTodaySection,
    label,
  };
}
