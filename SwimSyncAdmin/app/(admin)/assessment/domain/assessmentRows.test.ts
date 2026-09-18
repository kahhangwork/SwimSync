import { describe, it, expect } from "vitest";
import { buildClassRows, studentIdsOf, toLevels } from "./assessmentRows";
import type { GradeLevel } from "@/lib/assessment";

// Characterisation: pins what the page's load() computed before it moved here
// (Admin L-D). A change to any of these is a behaviour change, not a refactor.

const SCALE: GradeLevel[] = [
  { id: "g1", rank: 1, label: "Learning" },
  { id: "g2", rank: 2, label: "Mastered" },
];
const LEVELS = toLevels([
  { id: "L1", label: "Seahorse", sort_order: 1, tenant_level_skills: [{ id: "k1", label: "Kick", sort_order: 1 }] },
  { id: "L2", label: "Dolphin", sort_order: 2, tenant_level_skills: null },
]);

const classes = [
  { id: "c-mon", title: "Mon 9am", day_of_week: "monday", start_time: "09:00:00", locations: { name: "Pool A" }, coaches: { profiles: { full_name: "Coach K" } } },
  { id: "c-sat-late", title: "Sat 11am", day_of_week: "saturday", start_time: "11:00:00", locations: null, coaches: null },
  { id: "c-sat-early", title: "Sat 8am", day_of_week: "saturday", start_time: "08:00:00", locations: null, coaches: null },
];
const enrolments = [
  { class_id: "c-mon", students: { id: "s1", full_name: "Fresh", level_id: "L1" } },
  { class_id: "c-mon", students: { id: "s2", full_name: "Stale", level_id: "L1" } },
  { class_id: "c-mon", students: { id: "s3", full_name: "No level", level_id: null } },
  { class_id: "c-mon", students: null }, // an embed RLS hid: skipped, never a crash
  { class_id: "c-sat-late", students: { id: "s1", full_name: "Fresh", level_id: "L1" } },
];
const progress = [
  { student_id: "s1", skill_id: "k1", grade_level_id: "g2", graded_at: "2026-09-10T02:00:00Z" },
  { student_id: "s2", skill_id: "k1", grade_level_id: "g2", graded_at: "2026-01-01T02:00:00Z" },
];

describe("toLevels", () => {
  it("maps tenant_level_skills to skills, null to []", () => {
    expect(LEVELS).toEqual([
      { id: "L1", label: "Seahorse", sort_order: 1, skills: [{ id: "k1", label: "Kick", sort_order: 1 }] },
      { id: "L2", label: "Dolphin", sort_order: 2, skills: [] },
    ]);
    expect(toLevels(null)).toEqual([]);
  });
});

describe("studentIdsOf", () => {
  it("dedupes across classes and drops hidden embeds", () => {
    expect(studentIdsOf(enrolments)).toEqual(["s1", "s2", "s3"]);
    expect(studentIdsOf(null)).toEqual([]);
  });
});

describe("buildClassRows", () => {
  const rows = buildClassRows(classes, enrolments, progress, LEVELS, SCALE, "2026-09-01", "saturday");

  // total INCLUDES the unlevelled child (roundProgress: "including those with
  // nothing to grade"); blocked reports them apart.
  it("counts assessed / total / blocked per class against `since`", () => {
    const mon = rows.find((r) => r.id === "c-mon")!;
    expect(mon).toEqual({
      id: "c-mon", title: "Mon 9am", day_of_week: "monday", start_time: "09:00:00",
      location: "Pool A", coach: "Coach K", assessed: 1, total: 3, blocked: 1,
    });
    // An empty class is 0 of 0, and reads as such.
    expect(rows.find((r) => r.id === "c-sat-early")).toMatchObject({ assessed: 0, total: 0, blocked: 0, location: null, coach: null });
  });

  it("moves `since` and a stale grade stops counting", () => {
    const later = buildClassRows(classes, enrolments, progress, LEVELS, SCALE, "2026-09-15", "saturday");
    expect(later.find((r) => r.id === "c-mon")).toMatchObject({ assessed: 0, total: 3 });
  });

  it("puts TODAY's classes first, each group by start_time", () => {
    expect(rows.map((r) => r.id)).toEqual(["c-sat-early", "c-sat-late", "c-mon"]);
    const monday = buildClassRows(classes, enrolments, progress, LEVELS, SCALE, "2026-09-01", "monday");
    expect(monday.map((r) => r.id)).toEqual(["c-mon", "c-sat-early", "c-sat-late"]);
  });

  it("with no clock day (null), orders by start_time alone", () => {
    const none = buildClassRows(classes, enrolments, progress, LEVELS, SCALE, "2026-09-01", null);
    expect(none.map((r) => r.id)).toEqual(["c-sat-early", "c-mon", "c-sat-late"]);
  });
});
