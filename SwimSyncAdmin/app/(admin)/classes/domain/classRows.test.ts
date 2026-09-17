// Characterisation tests (playbook §0) — they pin the behaviour the page
// already had before the Stage-4 extraction. The four mapClassRow cases are the
// ⚠ RISK 2 / §7.28 pin: the class flag and the enrolment flag are one character
// apart, and reading the wrong one renders every class retired. This is the
// structural mitigation that turns that slip from a nightly-day surprise into a
// red unit test in seconds.
import { describe, expect, it } from "vitest";
import {
  mapClassRow,
  filterClasses,
  countActiveRetired,
  capitalize,
  shadowRateWarning,
} from "./classRows";
import type { ClassRow } from "../types";

const base = {
  id: "c1",
  coach_id: "co1",
  title: "Sat Beginners",
  coaches: { profiles: { full_name: "Amy" } },
  day_of_week: "saturday",
  start_time: "09:00:00",
  end_time: "10:00:00",
  locations: { name: "East Pool" },
  location_id: "l1",
  price_per_lesson: "40",
  category_id: "cat1",
  capacity: null,
  class_categories: { default_capacity: 6 },
  colour: null,
  deactivated_at: null,
};

describe("mapClassRow — §7.28: c.is_active is the CLASS flag, not the enrolment's", () => {
  it("active class with a CLOSED enrolment → is_active true, student_count 0", () => {
    const row = mapClassRow({
      ...base,
      is_active: true,
      student_class_enrolments: [{ is_active: false }],
    });
    expect(row.is_active).toBe(true);
    expect(row.student_count).toBe(0);
  });

  it("RETIRED class with a LIVE enrolment → is_active false, student_count 1", () => {
    // The deactivation driver's fixture shape. If the map read the enrolment
    // flag as the class flag, this class would render active and Restore would
    // be offered on a live class.
    const row = mapClassRow({
      ...base,
      is_active: false,
      student_class_enrolments: [{ is_active: true }],
    });
    expect(row.is_active).toBe(false);
    expect(row.student_count).toBe(1);
  });

  it("legacy row with is_active ABSENT → active (the !== false default)", () => {
    // Pre-deactivate_class() rows have no is_active. Boolean(undefined) would
    // retire every one of them; `!== false` keeps them active.
    const { is_active: _omit, ...noFlag } = { ...base, is_active: undefined };
    const row = mapClassRow({ ...noFlag, student_class_enrolments: [] });
    expect(row.is_active).toBe(true);
  });

  it("no student_class_enrolments → student_count 0, no throw", () => {
    const row = mapClassRow({ ...base, is_active: true });
    expect(row.student_count).toBe(0);
  });

  it("reads coach/location/level off the JOINED rows, price as a number", () => {
    const row = mapClassRow({ ...base, is_active: true, student_class_enrolments: [] });
    expect(row.coach_name).toBe("Amy");
    expect(row.location_name).toBe("East Pool");
    expect(row.price_per_lesson).toBe(40);
    expect(row.category_default_capacity).toBe(6);
  });
});

const mk = (over: Partial<ClassRow>): ClassRow => ({
  id: "x",
  coach_id: "co",
  title: "T",
  coach_name: "Coach",
  day_of_week: "monday",
  start_time: "09:00:00",
  end_time: "10:00:00",
  location_name: "Pool",
  location_id: "l1",
  price_per_lesson: 40,
  category_id: "cat1",
  capacity: null,
  category_default_capacity: null,
  colour: null,
  student_count: 0,
  is_active: true,
  deactivated_at: null,
  ...over,
});

describe("filterClasses", () => {
  const active = mk({ id: "a", title: "Active", is_active: true, location_id: "l1" });
  const retired = mk({ id: "r", title: "Retired", is_active: false, location_id: "l2" });

  it("hides retired unless showRetired", () => {
    expect(
      filterClasses([active, retired], { search: "", locationFilter: "", showRetired: false })
    ).toEqual([active]);
    expect(
      filterClasses([active, retired], { search: "", locationFilter: "", showRetired: true })
    ).toHaveLength(2);
  });

  it("searches title AND coach, case-insensitively", () => {
    const byCoach = mk({ id: "z", title: "Zulu", coach_name: "Priya" });
    expect(
      filterClasses([active, byCoach], { search: "priy", locationFilter: "", showRetired: false })
    ).toEqual([byCoach]);
  });

  it("filters by location, but CLAMPS a stale location to all", () => {
    expect(
      filterClasses([active, retired], { search: "", locationFilter: "l1", showRetired: true })
    ).toEqual([active]);
    // l9 matches no class → clamp to all rather than hide everything.
    expect(
      filterClasses([active, retired], { search: "", locationFilter: "l9", showRetired: true })
    ).toHaveLength(2);
  });
});

describe("shadowRateWarning — §7.28 sibling: A DATE, NOT A BOOLEAN (RISK 4)", () => {
  it("no rate at all → none", () => {
    expect(shadowRateWarning(null, "2026-09-17")).toBe("none");
  });
  it("rate starts AFTER the assignment → late", () => {
    expect(shadowRateWarning("2026-10-01", "2026-09-17")).toBe("late");
  });
  it("rate starts before the assignment → null (covered)", () => {
    expect(shadowRateWarning("2026-09-01", "2026-09-17")).toBeNull();
  });
  it("rate starts ON the assignment date → null (<= boundary)", () => {
    expect(shadowRateWarning("2026-09-17", "2026-09-17")).toBeNull();
  });
});

describe("countActiveRetired / capitalize", () => {
  it("counts the split", () => {
    expect(
      countActiveRetired([mk({ is_active: true }), mk({ is_active: false }), mk({ is_active: true })])
    ).toEqual({ active: 2, retired: 1 });
  });
  it("capitalizes a weekday", () => {
    expect(capitalize("saturday")).toBe("Saturday");
  });
});
