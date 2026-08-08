// Sorting the coach's week into the four sections the Schedule tab renders.
//
// ⚠ NO CLOCK. `today` is a parameter (§7.7), like everything else in lib/.
//
// ⚠ THIS FILE DOES NOT DECIDE WHAT "NEEDS MARKING" MEANS, AND MUST NOT LEARN TO.
// The needs-marking set is FLOOR-scoped — every unmarked lesson from the
// business's markable_floor to today, regardless of which week is on screen —
// and it is built separately, over a different date range. If it were bucketed
// here it would silently become week-scoped, and a straggler three weeks old
// would be invisible unless the coach happened to navigate back to a week they
// have no reason to suspect. Unmarked attendance blocks invoice generation
// outright with no override; that is the hole HANDOVER §8i closed.
//
// What this file does is split ONE WEEK's lessons into today / coming up /
// done. De-duplication against the needs-marking list happens in the RENDER
// body, not here and not in loadData — two values derived in one render pass
// cannot disagree, two derived in different passes eventually always do.

export type ScheduleLesson = {
  classId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM(:SS)
  /** Anything else the card needs. Kept open so this module never has to
   *  change when the card gains a field — it sorts, it does not render. */
  [key: string]: unknown;
};

export type DayGroup<T> = { date: string; items: T[] };

export type WeekBuckets<T> = {
  today: T[];
  comingUp: DayGroup<T>[];
  done: DayGroup<T>[];
};

/** Ascending by start time, stable for equal times. */
function byStartTime<T extends ScheduleLesson>(a: T, b: T): number {
  return a.startTime.localeCompare(b.startTime);
}

function groupByDate<T extends ScheduleLesson>(
  lessons: T[],
  datesAscending: boolean
): DayGroup<T>[] {
  const byDate = new Map<string, T[]>();
  for (const l of lessons) {
    const bucket = byDate.get(l.date);
    if (bucket) bucket.push(l);
    else byDate.set(l.date, [l]);
  }
  const dates = [...byDate.keys()].sort();
  if (!datesAscending) dates.reverse();
  return dates.map((date) => ({
    date,
    items: [...(byDate.get(date) ?? [])].sort(byStartTime),
  }));
}

/**
 * Split one week's lessons into the three calendar sections.
 *
 * COMING UP is ascending — the next thing first, because it is a plan.
 * DONE is DESCENDING — most recent first, mirroring the Today screen's backlog
 * sort (`items.sort((a, b) => b.date.localeCompare(a.date))`), because it is a
 * record and the useful end is the near one.
 *
 * `today` may fall outside the week (the coach is looking at another week), in
 * which case `today` comes back empty and every lesson lands in comingUp or
 * done by comparison with the real date — no special case needed.
 */
export function bucketWeek<T extends ScheduleLesson>(
  lessons: readonly T[],
  today: string
): WeekBuckets<T> {
  const todays: T[] = [];
  const future: T[] = [];
  const past: T[] = [];

  for (const l of lessons) {
    if (l.date === today) todays.push(l);
    else if (l.date > today) future.push(l);
    else past.push(l);
  }

  return {
    today: [...todays].sort(byStartTime),
    comingUp: groupByDate(future, true),
    done: groupByDate(past, false),
  };
}
