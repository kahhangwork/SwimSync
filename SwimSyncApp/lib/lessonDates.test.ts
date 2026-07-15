// TWIN FILE: SwimSyncAdmin/lib/lessonDates.test.ts is identical except that it
// imports the test API from vitest (this one uses jest globals). Keep in sync.

import {
  todayInSg,
  toSgDate,
  formatSgDate,
  dayOfWeekOf,
  expectedLessonDates,
  monthBounds,
  backlogWindowStart,
} from "./lessonDates";

describe("expectedLessonDates", () => {
  it("returns every Saturday in July 2026", () => {
    // July 2026 starts on a Wednesday, so the Saturdays are the 4th onward.
    expect(expectedLessonDates("saturday", "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
  });

  it("includes both bounds when they land on the target weekday", () => {
    expect(expectedLessonDates("saturday", "2026-07-04", "2026-07-25")).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
  });

  it("returns the day itself for a single-day range on the weekday", () => {
    expect(expectedLessonDates("saturday", "2026-07-04", "2026-07-04")).toEqual([
      "2026-07-04",
    ]);
  });

  it("returns nothing for a single-day range off the weekday", () => {
    expect(expectedLessonDates("saturday", "2026-07-05", "2026-07-05")).toEqual([]);
  });

  it("returns nothing when from is after to", () => {
    expect(expectedLessonDates("saturday", "2026-07-31", "2026-07-01")).toEqual([]);
  });

  it("crosses a year boundary", () => {
    expect(expectedLessonDates("thursday", "2026-12-28", "2027-01-10")).toEqual([
      "2026-12-31",
      "2027-01-07",
    ]);
  });

  it("handles a leap day", () => {
    // 2028-02-29 is a Tuesday.
    expect(expectedLessonDates("tuesday", "2028-02-25", "2028-03-02")).toEqual([
      "2028-02-29",
    ]);
  });

  it("is independent of the ambient timezone", () => {
    const original = process.env.TZ;
    const expected = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"];
    // The pre-existing bug this guards against: deriving a weekday from a
    // UTC-parsed date read through a local getter is off by one west of UTC.
    for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway"]) {
      process.env.TZ = tz;
      expect(expectedLessonDates("saturday", "2026-07-01", "2026-07-31")).toEqual(
        expected
      );
    }
    process.env.TZ = original;
  });
});

describe("todayInSg", () => {
  it("returns the Singapore date, not the UTC date, just after SG midnight", () => {
    // 16:30 UTC on 31 Jul is 00:30 SGT on 1 Aug — toISOString() would say July.
    expect(todayInSg(new Date("2026-07-31T16:30:00Z"))).toBe("2026-08-01");
  });

  it("agrees with UTC once SG is past 08:00", () => {
    expect(todayInSg(new Date("2026-08-01T00:30:00Z"))).toBe("2026-08-01");
  });

  it("returns the Saturday date at 07:30 SGT on a Saturday", () => {
    // The live bug: getDay() said saturday while toISOString() said Friday's date.
    expect(todayInSg(new Date("2026-07-03T23:30:00Z"))).toBe("2026-07-04");
  });
});

describe("formatSgDate", () => {
  it("shows the date it was given, not a timezone-shifted one", () => {
    const original = process.env.TZ;
    // Regression: a plain toLocaleDateString on a UTC-midnight Date renders the
    // PREVIOUS day west of Greenwich. The label must never drift.
    for (const tz of ["UTC", "Asia/Singapore", "America/New_York", "Pacific/Midway"]) {
      process.env.TZ = tz;
      expect(formatSgDate("2026-07-18")).toBe("Sat, 18 Jul");
    }
    process.env.TZ = original;
  });

  it("accepts custom options and still pins UTC", () => {
    expect(
      formatSgDate("2026-07-18", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    ).toBe("Sat, 18 Jul 2026");
  });

  it("returns malformed input unchanged rather than 'Invalid Date'", () => {
    expect(formatSgDate("nonsense")).toBe("nonsense");
  });
});

describe("dayOfWeekOf", () => {
  it("names the weekday of a date string", () => {
    expect(dayOfWeekOf("2026-07-04")).toBe("saturday");
    expect(dayOfWeekOf("2026-07-01")).toBe("wednesday");
  });

  it("agrees with todayInSg at 07:30 SGT on a Saturday", () => {
    // The exact pairing that was broken: weekday and date must not disagree.
    const at0730Sgt = new Date("2026-07-03T23:30:00Z");
    expect(dayOfWeekOf(todayInSg(at0730Sgt))).toBe("saturday");
  });

  it("returns null for a malformed date", () => {
    expect(dayOfWeekOf("nonsense")).toBeNull();
  });
});

describe("toSgDate", () => {
  it("shifts a late-evening UTC timestamp to the next SG day", () => {
    expect(toSgDate("2026-07-03T18:00:00Z")).toBe("2026-07-04");
  });

  it("keeps a mid-day UTC timestamp on the same SG day", () => {
    expect(toSgDate("2026-07-04T02:00:00Z")).toBe("2026-07-04");
  });
});

describe("monthBounds", () => {
  it("handles a 31-day month", () => {
    expect(monthBounds("2026-07")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("handles a non-leap February", () => {
    expect(monthBounds("2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("handles a leap February", () => {
    expect(monthBounds("2028-02")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });
});

describe("backlogWindowStart", () => {
  it("floors at the first day of the previous month", () => {
    expect(backlogWindowStart("2026-08-01", null)).toBe("2026-07-01");
  });

  it("crosses a year boundary in January", () => {
    expect(backlogWindowStart("2026-01-15", null)).toBe("2025-12-01");
  });

  it("uses the enrolment date when it is later than the month floor", () => {
    expect(backlogWindowStart("2026-08-01", "2026-07-20")).toBe("2026-07-20");
  });

  it("uses the month floor when the enrolment is older", () => {
    expect(backlogWindowStart("2026-08-01", "2026-03-02")).toBe("2026-07-01");
  });
});
