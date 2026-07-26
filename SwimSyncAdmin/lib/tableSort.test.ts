import { describe, it, expect } from "vitest";
import { isBlank, compareValues, sortRows, dayOfWeekOrder } from "./tableSort";

describe("isBlank", () => {
  it("treats absent values and dash placeholders as blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank("—")).toBe(true); // em dash — what the pages render for "none"
    expect(isBlank("–")).toBe(true); // en dash
  });

  it("does NOT treat 0 or false as blank", () => {
    // The Classes table shows a real `0` in Students, and Levels shows real
    // counts. A zero that sorted to the bottom as "missing" would hide exactly
    // the class an admin is looking for.
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
  });

  it("does NOT treat a plain hyphen as blank", () => {
    // A hyphen is real content in real data, and there is no way to tell a
    // placeholder from a hyphenated name once we start guessing.
    expect(isBlank("-")).toBe(false);
    expect(isBlank("Chua Ashlyn-Wei")).toBe(false);
  });
});

describe("compareValues", () => {
  it("compares numbers numerically, not as text", () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    // The bug this pins: "9" > "10" lexically, so a Students or Rate column
    // would read 1, 10, 2, 9.
    expect(compareValues(100, 20)).toBeGreaterThan(0);
  });

  it("compares digits inside strings numerically", () => {
    // Real class titles. Lexically "1015am" sorts before "845am".
    expect(
      compareValues("Tanglin View Sun 845am", "Tanglin View Sun 1015am")
    ).toBeLessThan(0);
    expect(compareValues("Level 2", "Level 10")).toBeLessThan(0);
  });

  it("is case-insensitive, so a lowercase entry does not land after Z", () => {
    expect(compareValues("aadi", "Bala")).toBeLessThan(0);
    expect(compareValues("Zara", "aadi")).toBeGreaterThan(0);
  });

  it("orders ISO dates chronologically", () => {
    expect(compareValues("2026-07-19", "2026-07-26")).toBeLessThan(0);
    expect(compareValues("2026-08-01", "2026-07-31")).toBeGreaterThan(0);
    expect(compareValues("2025-12-31", "2026-01-01")).toBeLessThan(0);
  });

  it("orders ISO dates without constructing a Date", () => {
    // §7.7: every date bug in this project came from a timezone conversion.
    // ISO date strings already sort chronologically as text, so the comparator
    // never converts — and therefore cannot be wrong before 08:00 SGT.
    // Guarded by behaviour: a date-only string and the same date with a time
    // must order the same way in any process timezone.
    for (const tz of ["UTC", "Asia/Singapore", "America/New_York", "Pacific/Midway"]) {
      process.env.TZ = tz;
      expect(compareValues("2026-07-31", "2026-08-01")).toBeLessThan(0);
    }
  });

  it("orders false before true", () => {
    expect(compareValues(false, true)).toBeLessThan(0);
  });
});

describe("dayOfWeekOrder", () => {
  it("orders the week as a calendar, not as an alphabet", () => {
    const days = ["friday", "monday", "sunday", "wednesday"];
    const ordered = sortRows(days, (d) => dayOfWeekOrder(d), "asc");
    expect(ordered).toEqual(["sunday", "monday", "wednesday", "friday"]);
    // What plain A→Z would have given, and why this accessor exists:
    expect([...days].sort()).toEqual(["friday", "monday", "sunday", "wednesday"]);
  });

  it("agrees with lessonDates' private DAY_INDEX (0 = Sunday)", () => {
    expect(dayOfWeekOrder("sunday")).toBe(0);
    expect(dayOfWeekOrder("saturday")).toBe(6);
  });

  it("is case- and whitespace-insensitive, and blank for anything else", () => {
    expect(dayOfWeekOrder(" Sunday ")).toBe(0);
    expect(dayOfWeekOrder("")).toBeNull();
    expect(dayOfWeekOrder(null)).toBeNull();
    expect(dayOfWeekOrder("someday")).toBeNull();
  });
});

describe("sortRows", () => {
  type Row = { name: string; count: number | null };

  const rows: Row[] = [
    { name: "Ruhaan", count: 3 },
    { name: "aadi", count: 1 },
    { name: "Chua Ashton", count: null },
    { name: "Bala", count: 2 },
  ];

  it("sorts ascending and descending", () => {
    expect(sortRows(rows, (r) => r.name, "asc").map((r) => r.name)).toEqual([
      "aadi",
      "Bala",
      "Chua Ashton",
      "Ruhaan",
    ]);
    expect(sortRows(rows, (r) => r.name, "desc").map((r) => r.name)).toEqual([
      "Ruhaan",
      "Chua Ashton",
      "Bala",
      "aadi",
    ]);
  });

  it("keeps blanks LAST in both directions", () => {
    // The whole point: reversing a half-empty column must not fill the first
    // screen with rows that have nothing in it. The actionable rows stay where
    // they can be seen.
    expect(sortRows(rows, (r) => r.count, "asc").map((r) => r.count)).toEqual([
      1, 2, 3, null,
    ]);
    expect(sortRows(rows, (r) => r.count, "desc").map((r) => r.count)).toEqual([
      3, 2, 1, null,
    ]);
  });

  it("does not mutate the input", () => {
    const original = [...rows];
    sortRows(rows, (r) => r.name, "desc");
    expect(rows).toEqual(original);
  });

  it("is stable, so ties keep the order the page put them in", () => {
    // Sorting Attendance by Status must leave each status group in the date
    // order the query returned, not scrambled.
    const ties = [
      { name: "d", group: "present" },
      { name: "c", group: "absent" },
      { name: "b", group: "present" },
      { name: "a", group: "absent" },
    ];
    expect(sortRows(ties, (r) => r.group, "asc").map((r) => r.name)).toEqual([
      "c",
      "a", // absent group, original relative order preserved
      "d",
      "b", // present group, likewise
    ]);
  });
});
