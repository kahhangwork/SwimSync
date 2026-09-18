import { describe, it, expect } from "vitest";
import { percentGraded, studentsOf, toClassInfo, toLevels, toRoster } from "./assessClassRows";

// Characterisation: pins what the page's load() and render computed before
// they moved here (Admin L-D). A change is a behaviour change, not a refactor.

describe("toClassInfo", () => {
  it("flattens the location embed, null when absent", () => {
    const row = { title: "Sat", day_of_week: "saturday", start_time: "08:00:00", tenant_id: "t1", locations: { name: "Pool A" } };
    expect(toClassInfo(row)).toEqual({ title: "Sat", day_of_week: "saturday", start_time: "08:00:00", location: "Pool A", tenant_id: "t1" });
    expect(toClassInfo({ ...row, locations: null }).location).toBeNull();
  });
});

describe("toLevels", () => {
  it("maps tenant_level_skills to skills, null to []", () => {
    expect(toLevels([{ id: "L1", label: "A", sort_order: 1, tenant_level_skills: null }])).toEqual([
      { id: "L1", label: "A", sort_order: 1, skills: [] },
    ]);
    expect(toLevels(null)).toEqual([]);
  });
});

describe("studentsOf + toRoster", () => {
  it("drops hidden embeds and attaches each child's own progress", () => {
    const students = studentsOf([
      { students: { id: "s1", full_name: "A", level_id: "L1" } },
      { students: null },
      { students: { id: "s2", full_name: "B", level_id: null } },
    ]);
    expect(students.map((s) => s.id)).toEqual(["s1", "s2"]);
    const p1 = { student_id: "s1", skill_id: "k1", grade_level_id: "g1", graded_at: "2026-09-01T00:00:00Z" };
    expect(toRoster(students, [p1])).toEqual([
      { id: "s1", full_name: "A", level_id: "L1", progress: [p1] },
      { id: "s2", full_name: "B", level_id: null, progress: [] },
    ]);
    expect(studentsOf(null)).toEqual([]);
  });
});

describe("percentGraded", () => {
  it("is 0 with no skills (never NaN) and rounds otherwise", () => {
    expect(percentGraded(0, 0)).toBe(0);
    expect(percentGraded(1, 3)).toBe(33);
    expect(percentGraded(2, 3)).toBe(67);
    expect(percentGraded(3, 3)).toBe(100);
  });
});
