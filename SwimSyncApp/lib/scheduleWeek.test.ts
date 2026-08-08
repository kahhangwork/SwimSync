// ⚠ THE PROPERTY SWEEPS ARE THE POINT OF THIS FILE, NOT THE EXAMPLES.
//
// A new week-arithmetic module plus a test written from the same mental model
// is §7.94's exact shape: the RPC, its pgTAP file and its driver all made the
// same UTC assumption and therefore AGREED, so a 14-test file sat green over a
// live bug for three weeks. An off-by-one `startOfWeek` — Sunday landing on the
// FOLLOWING Monday, the classic — would be encoded identically in hand-written
// examples and in the implementation.
//
// So the sweeps below derive their truth from lib/lessonDates.ts, which is
// independently trusted: it is byte-identical to a twin in SwimSyncAdmin, has
// its own test file, and predates this work. Both sweeps were confirmed RED
// against a deliberately off-by-one startOfWeek before being accepted (§7.25).

import { dayOfWeekOf, expectedLessonDates, type DayOfWeek } from "./lessonDates";
import {
  addDays,
  canGoBack,
  canGoForward,
  lessonDatesInRange,
  mondayFirstIndex,
  mondayForOffset,
  selectableWeekOffsets,
  startOfWeek,
  weekBounds,
  weekLabel,
  weekdayOf,
} from "./scheduleWeek";

const ALL_DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** 400 consecutive dates from a Thursday, spanning leap day and year ends. */
function sweepDates(n = 400, from = "2026-01-01"): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

describe("startOfWeek — property sweep against lessonDates.dayOfWeekOf", () => {
  const dates = sweepDates();

  it("always lands on a Monday, for 400 consecutive dates", () => {
    const wrong = dates.filter((d) => dayOfWeekOf(startOfWeek(d)) !== "monday");
    expect(wrong).toEqual([]);
  });

  it("never moves forward — the week's Monday is on or before the date", () => {
    const wrong = dates.filter((d) => startOfWeek(d) > d);
    expect(wrong).toEqual([]);
  });

  it("always contains the date it was derived from", () => {
    const wrong = dates.filter((d) => d > addDays(startOfWeek(d), 6));
    expect(wrong).toEqual([]);
  });

  it("is idempotent — the Monday of a Monday is itself", () => {
    const wrong = dates.filter((d) => startOfWeek(startOfWeek(d)) !== startOfWeek(d));
    expect(wrong).toEqual([]);
  });

  it("spans exactly 7 days", () => {
    const wrong = dates.filter((d) => {
      const { start, end } = weekBounds(startOfWeek(d));
      return addDays(start, 6) !== end;
    });
    expect(wrong).toEqual([]);
  });

  // Sunday is the case an off-by-one gets wrong, and the only one, so it is
  // asserted on its own rather than left inside a sweep that could pass 6/7.
  it("takes SUNDAY back six days, not forward one", () => {
    expect(startOfWeek("2026-08-09")).toBe("2026-08-03"); // Sun -> prev Mon
    expect(dayOfWeekOf("2026-08-09")).toBe("sunday"); // the premise
  });

  it("leaves a Monday alone", () => {
    expect(startOfWeek("2026-08-03")).toBe("2026-08-03");
    expect(dayOfWeekOf("2026-08-03")).toBe("monday");
  });
});

describe("lessonDatesInRange — proven EQUAL to expectedLessonDates, not merely similar", () => {
  it("with no bookings and no sessions it equals expectedLessonDates, every weekday, 60 weeks", () => {
    const mismatches: string[] = [];
    for (const dow of ALL_DAYS) {
      for (let w = 0; w < 60; w++) {
        const monday = addDays("2026-01-05", w * 7); // a Monday
        const { start, end } = weekBounds(monday);
        const mine = lessonDatesInRange(dow, start, end);
        const theirs = expectedLessonDates(dow, start, end);
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          mismatches.push(`${dow} ${start}: ${mine} vs ${theirs}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("a whole week contains exactly one lesson for each weekday", () => {
    const { start, end } = weekBounds("2026-08-03");
    for (const dow of ALL_DAYS) {
      expect(lessonDatesInRange(dow, start, end)).toHaveLength(1);
    }
  });

  it("adds a booking on a date the weekday would never produce", () => {
    // A trial booked on Wednesday for a Saturday class.
    const dates = lessonDatesInRange(
      "saturday",
      "2026-08-03",
      "2026-08-09",
      ["2026-08-05"]
    );
    expect(dates).toEqual(["2026-08-05", "2026-08-08"]);
  });

  it("adds an off-schedule session date the weekday would never produce", () => {
    const dates = lessonDatesInRange(
      "saturday",
      "2026-08-03",
      "2026-08-09",
      [],
      ["2026-08-06"]
    );
    expect(dates).toEqual(["2026-08-06", "2026-08-08"]);
  });

  it("clips bookings and sessions to the range — both ends", () => {
    const dates = lessonDatesInRange(
      "saturday",
      "2026-08-03",
      "2026-08-09",
      ["2026-07-29", "2026-08-20"],
      ["2026-07-30", "2026-08-21"]
    );
    expect(dates).toEqual(["2026-08-08"]);
  });

  it("dedupes a booking that falls on the class's own weekday", () => {
    const dates = lessonDatesInRange(
      "saturday",
      "2026-08-03",
      "2026-08-09",
      ["2026-08-08"],
      ["2026-08-08"]
    );
    expect(dates).toEqual(["2026-08-08"]);
  });

  it("returns [] when from is after to", () => {
    expect(lessonDatesInRange("monday", "2026-08-09", "2026-08-03")).toEqual([]);
  });
});

describe("mondayForOffset — the frozen-clock mitigation", () => {
  it("offset 0 is always the week containing today", () => {
    for (const d of sweepDates(40, "2026-08-01")) {
      expect(mondayForOffset(d, 0)).toBe(startOfWeek(d));
    }
  });

  it("offset -1 and +1 step exactly one week", () => {
    expect(mondayForOffset("2026-08-08", -1)).toBe("2026-07-27");
    expect(mondayForOffset("2026-08-08", 0)).toBe("2026-08-03");
    expect(mondayForOffset("2026-08-08", 1)).toBe("2026-08-10");
  });

  // The bug an ABSOLUTE stored Monday would have: mounted on Sunday, still
  // running on Monday. With an offset the answer moves with the day, so the
  // TODAY section never silently disappears.
  it("offset 0 self-corrects across a Sunday->Monday boundary", () => {
    const sunday = "2026-08-09";
    const monday = "2026-08-10";
    expect(mondayForOffset(sunday, 0)).toBe("2026-08-03");
    expect(mondayForOffset(monday, 0)).toBe("2026-08-10");
    // An absolute Monday captured on Sunday would still read 2026-08-03 here,
    // putting "today" outside the shown week.
    expect(mondayForOffset(monday, 0)).not.toBe(mondayForOffset(sunday, 0));
  });
});

describe("selectableWeekOffsets", () => {
  it("always allows next week", () => {
    expect(selectableWeekOffsets("2026-08-08", "2026-08-01").max).toBe(1);
  });

  it("reaches back to the week CONTAINING the floor", () => {
    // Floor 2026-07-01 is a Wednesday; its Monday is 2026-06-29.
    // Today 2026-08-08 -> this Monday 2026-08-03. That is 5 weeks.
    const { min } = selectableWeekOffsets("2026-08-08", "2026-07-01");
    expect(min).toBe(-5);
    expect(mondayForOffset("2026-08-08", min)).toBe("2026-06-29");
  });

  it("a floor inside this week means no backward travel", () => {
    expect(selectableWeekOffsets("2026-08-08", "2026-08-05").min).toBe(0);
  });

  it("never allows travel FORWARD past today via min", () => {
    // A floor in the future must not produce a positive min.
    expect(selectableWeekOffsets("2026-08-08", "2026-09-01").min).toBe(0);
  });

  it("a null floor degrades to the current week, never to unbounded", () => {
    expect(selectableWeekOffsets("2026-08-08", null)).toEqual({ min: 0, max: 1 });
    expect(selectableWeekOffsets("2026-08-08", undefined)).toEqual({ min: 0, max: 1 });
  });

  it("canGoBack / canGoForward respect the bounds", () => {
    const { min, max } = selectableWeekOffsets("2026-08-08", "2026-07-01");
    expect(canGoBack(min, min)).toBe(false);
    expect(canGoBack(min + 1, min)).toBe(true);
    expect(canGoForward(max, max)).toBe(false);
    expect(canGoForward(max - 1, max)).toBe(true);
  });
});

describe("weekLabel", () => {
  it("names the three weeks a coach would name", () => {
    expect(weekLabel("2026-08-03", "2026-08-08")).toBe("This week");
    expect(weekLabel("2026-07-27", "2026-08-08")).toBe("Last week");
    expect(weekLabel("2026-08-10", "2026-08-08")).toBe("Next week");
  });

  it("says nothing for weeks further out — the date range speaks for itself", () => {
    expect(weekLabel("2026-07-06", "2026-08-08")).toBe("");
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
  it("crosses a year boundary backwards", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("crosses a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("is independent of the ambient timezone", () => {
    // The whole file runs under whatever TZ the runner has; UTC-midnight
    // parsing is what makes this stable. A local-time implementation drifts
    // by a day west of Greenwich (§7.7).
    expect(addDays("2026-08-08", 0)).toBe("2026-08-08");
    expect(addDays("2026-08-08", 7)).toBe("2026-08-15");
  });
});

describe("degraded inputs — never throw, never invent a date", () => {
  it("startOfWeek passes a malformed date straight through", () => {
    expect(startOfWeek("not-a-date")).toBe("not-a-date");
  });
  it("addDays passes a malformed date straight through", () => {
    expect(addDays("", 3)).toBe("");
  });
  it("mondayFirstIndex reports -1 on a SHAPE it cannot parse", () => {
    expect(mondayFirstIndex("8 Aug 2026")).toBe(-1);
    expect(weekdayOf("2026/08/08")).toBeNull();
  });

  // Out-of-RANGE components are a different case from an out-of-shape string,
  // and this file deliberately does not claim to reject them: "2026-13-40"
  // matches the \d{4}-\d{2}-\d{2} shape and Date.UTC rolls it forward to
  // 2027-02-09. That is EXACTLY what lib/lessonDates.ts does with the same
  // input — the two must agree, and agreeing is worth more here than being
  // stricter alone would be. It is also not a live path: these strings come
  // from Postgres `date` columns and from todayInSg(), never from typing.
  it("rolls an out-of-range date forward, IDENTICALLY to lessonDates", () => {
    expect(weekdayOf("2026-13-40")).toBe(dayOfWeekOf("2026-13-40"));
    expect(weekdayOf("2026-13-40")).toBe("tuesday"); // 2027-02-09
  });
});

describe("mondayFirstIndex / weekdayOf agree with lessonDates.dayOfWeekOf", () => {
  it("across 400 consecutive dates", () => {
    const wrong = sweepDates().filter((d) => weekdayOf(d) !== dayOfWeekOf(d));
    expect(wrong).toEqual([]);
  });

  it("Monday is 0 and Sunday is 6", () => {
    expect(mondayFirstIndex("2026-08-03")).toBe(0);
    expect(mondayFirstIndex("2026-08-09")).toBe(6);
  });
});
