import { describe, it, expect } from "vitest";
import { datesForClass, toBookings, toCategories, toEligible } from "./trialRows";
import type { ClassRow } from "../types";

// Characterisation: pins what page.tsx computed before it moved here (Admin
// L-D). A change to any of these is a behaviour change, not a refactor.

describe("toCategories", () => {
  // `rates` arrive newest-first, as the query orders them.
  const rates = [
    { category_id: "grp", rate: "30", effective_from: "2026-10-01" }, // future: ignored
    { category_id: "grp", rate: "25", effective_from: "2026-09-01" }, // current
    { category_id: "grp", rate: "20", effective_from: "2026-01-01" }, // older: shadowed
    { category_id: "pvt", rate: 60, effective_from: "2026-09-18" }, // effective TODAY counts
  ];
  const cats = [
    { id: "grp", name: "Group" },
    { id: "pvt", name: "Private" },
    { id: "new", name: "Squad" },
  ];

  it("prices each category at the newest rate not dated in the future; unpriced = null", () => {
    expect(toCategories(cats, rates, "2026-09-18")).toEqual([
      { id: "grp", name: "Group", rate: 25 },
      { id: "pvt", name: "Private", rate: 60 },
      { id: "new", name: "Squad", rate: null },
    ]);
  });

  it("a category whose ONLY rows are in the future is unpriced", () => {
    expect(toCategories(cats, rates, "2026-08-31")[1].rate).toBeNull();
  });
});

describe("toBookings", () => {
  it("marks by student+date and carries class_id (Convert needs it)", () => {
    const books = [
      { id: "b1", session_date: "2026-09-12", student_id: "s1", class_id: "c1", students: { full_name: "Ann" }, classes: { title: "Sat" } },
      { id: "b2", session_date: "2026-09-19", student_id: null, class_id: null, students: null, classes: null },
    ];
    const att = [{ student_id: "s1", lesson_sessions: { session_date: "2026-09-12" } }];
    expect(toBookings(books, att)).toEqual([
      { id: "b1", session_date: "2026-09-12", student_id: "s1", student_name: "Ann", class_id: "c1", class_title: "Sat", marked: true },
      { id: "b2", session_date: "2026-09-19", student_id: "", student_name: "—", class_id: "", class_title: "—", marked: false },
    ]);
  });
});

describe("toEligible", () => {
  it("active children with NO active enrolment — the inverse of Make-ups", () => {
    expect(toEligible([
      { id: "a", full_name: "Free", is_active: true, student_class_enrolments: [{ is_active: false }] },
      { id: "b", full_name: "Enrolled", is_active: true, student_class_enrolments: [{ is_active: true }] },
      { id: "c", full_name: "Left", is_active: false, student_class_enrolments: [] },
      { id: "d", full_name: "Never", is_active: true, student_class_enrolments: null },
    ])).toEqual([
      { id: "a", full_name: "Free" },
      { id: "d", full_name: "Never" },
    ]);
  });
});

describe("datesForClass", () => {
  const classes: ClassRow[] = [{ id: "sat", title: "Sat", day_of_week: "saturday" }];
  it("the class's weekday from 21 days back to 70 ahead — no off-schedule extras", () => {
    const d = datesForClass(classes, "sat", "2026-09-18");
    expect(d[0]).toBe("2026-08-29");
    expect(d.at(-1)).toBe("2026-11-21");
    expect(d).toHaveLength(13);
    expect(datesForClass(classes, "nope", "2026-09-18")).toEqual([]);
  });
});
