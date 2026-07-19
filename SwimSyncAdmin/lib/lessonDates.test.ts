import { describe, it, expect } from "vitest";
// TWIN FILE: SwimSyncApp/lib/lessonDates.test.ts is identical except that it
// uses jest globals (this one imports the test API from vitest). Keep in sync.

import {
  todayInSg,
  toSgDate,
  formatSgDate,
  dayOfWeekOf,
  expectedLessonDates,
  monthBounds,
  backlogWindowStart,
  ageFromDob,
  previousBillingMonth,
} from "./lessonDates";

describe("ageFromDob", () => {
  it("counts whole years, not elapsed days", () => {
    expect(ageFromDob("2018-03-10", "2026-07-19")).toBe(8);
  });

  it("ages the child ON their birthday, not the day after", () => {
    expect(ageFromDob("2018-07-19", "2026-07-19")).toBe(8);
    expect(ageFromDob("2018-07-20", "2026-07-19")).toBe(7);
  });

  it("does not round up a birthday later this month", () => {
    // Same month, day not yet reached — the naive year-subtraction says 8.
    expect(ageFromDob("2018-07-31", "2026-07-19")).toBe(7);
  });

  it("does not round up a birthday later this year", () => {
    expect(ageFromDob("2018-12-01", "2026-07-19")).toBe(7);
  });

  it("ages a 29 February birthday on 1 March in a non-leap year", () => {
    // 2027 has no 29 Feb. Conventional treatment: they age on 1 March.
    expect(ageFromDob("2016-02-29", "2027-02-28")).toBe(10);
    expect(ageFromDob("2016-02-29", "2027-03-01")).toBe(11);
    // ...and on the day itself when the year does have one.
    expect(ageFromDob("2016-02-29", "2028-02-29")).toBe(12);
  });

  it("returns null rather than 0 for a missing DOB", () => {
    // date_of_birth is nullable, so rows predating the required-DOB rule exist.
    // Rendering these as 0 would put "0 years old" on a real roster.
    expect(ageFromDob(null, "2026-07-19")).toBeNull();
    expect(ageFromDob(undefined, "2026-07-19")).toBeNull();
    expect(ageFromDob("", "2026-07-19")).toBeNull();
  });

  it("returns null for a malformed or future DOB", () => {
    expect(ageFromDob("10-03-2018", "2026-07-19")).toBeNull();
    expect(ageFromDob("not-a-date", "2026-07-19")).toBeNull();
    // A future DOB is a typo, not an unborn swimmer — never a negative age.
    expect(ageFromDob("2027-01-01", "2026-07-19")).toBeNull();
  });

  it("is exact on the day of birth", () => {
    expect(ageFromDob("2026-07-19", "2026-07-19")).toBe(0);
  });
});

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

describe("previousBillingMonth", () => {
  // Invoices cover a COMPLETE calendar month, so today's own month is never it.
  it("is the month before today, not today's month", () => {
    expect(previousBillingMonth("2026-07-19")).toBe("2026-06");
    expect(previousBillingMonth("2026-07-01")).toBe("2026-06");
    expect(previousBillingMonth("2026-07-31")).toBe("2026-06");
  });

  it("rolls back over the year boundary", () => {
    expect(previousBillingMonth("2026-01-15")).toBe("2025-12");
    expect(previousBillingMonth("2026-01-01")).toBe("2025-12");
  });

  // THE BOUNDARY. July becomes billable at 00:00 SGT on 1 August. The input is
  // already an SGT date string (todayInSg()), so 1 August yields July — whereas
  // deriving from a UTC clock at that instant yields June, refusing the month
  // that has just become due. Same family as the timezone tests above.
  it("makes July billable on 1 August, the day it becomes due", () => {
    expect(previousBillingMonth("2026-08-01")).toBe("2026-07");
  });

  it("handles a 31-day month rolling back into a 30-day one", () => {
    expect(previousBillingMonth("2026-05-31")).toBe("2026-04");
  });

  it("returns an empty string for a malformed date rather than guessing", () => {
    expect(previousBillingMonth("nonsense")).toBe("");
    expect(previousBillingMonth("2026-13")).toBe("");
  });
});
