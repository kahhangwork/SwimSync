// CHARACTERISATION TESTS, not proofs (plan §8). Every expectation here
// describes behaviour that already existed inline in page.tsx before Stage 4
// lifted it out; there is no fix for §7.25 to prove them red against. Their
// job is to pin the mapping so a later slice cannot quietly change what the
// table shows. The §7.28 nesting reads are the ones worth having.

import { describe, it, expect } from "vitest";
import {
  countLessons,
  toStudentRow,
  statusLabel,
  isUnclaimed,
  matchesFilters,
} from "./studentRows";
import type { StudentRow } from "../types";

const base = (over: Partial<StudentRow> = {}): StudentRow => ({
  id: "s1",
  full_name: "Anya",
  date_of_birth: null,
  level_id: null,
  level_label: null,
  assignment_status: "unassigned",
  is_active: true,
  inactivated_at: null,
  parent_id: "p1",
  parent_name: "Ms Tan",
  classes: [],
  class_title: null,
  coach_name: null,
  lessons: 0,
  ...over,
});

describe("countLessons", () => {
  it("tallies attendance rows per child and treats null as empty", () => {
    const m = countLessons([{ student_id: "a" }, { student_id: "b" }, { student_id: "a" }]);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
    expect(countLessons(null).size).toBe(0);
  });
});

describe("toStudentRow", () => {
  const row = {
    id: "s1",
    full_name: "Anya",
    date_of_birth: "2018-01-02",
    level_id: "L2",
    assignment_status: "assigned",
    is_active: true,
    inactivated_at: null,
    tenant_levels: { id: "L2", label: "Seahorse" },
    parent_students: [{ parents: { id: "p1", profiles: { full_name: "Ms Tan" } } }],
    student_class_enrolments: [
      {
        is_active: true,
        classes: {
          id: "c-wed",
          title: "Wed 5pm",
          day_of_week: "wednesday",
          start_time: "17:00:00",
          coaches: { profiles: { full_name: "Coach B" } },
        },
      },
      { is_active: false, classes: { id: "c-old", title: "Old", day_of_week: "monday", start_time: "09:00:00" } },
      {
        is_active: true,
        classes: { id: "c-mon", title: "Mon 9am", day_of_week: "monday", start_time: "09:00:00", coaches: null },
      },
    ],
  };

  it("reads level and parent off the JOINED rows (§7.28)", () => {
    const r = toStudentRow(row, new Map());
    expect(r.level_label).toBe("Seahorse");
    expect(r.parent_id).toBe("p1");
    expect(r.parent_name).toBe("Ms Tan");
  });

  it("keeps ALL active enrolments, weekday-ordered, and drops inactive ones", () => {
    const r = toStudentRow(row, new Map());
    expect(r.classes.map((c) => c.id)).toEqual(["c-mon", "c-wed"]);
    expect(r.classes[1]).toEqual({
      id: "c-wed",
      title: "Wed 5pm",
      coach_name: "Coach B",
      day: "wednesday",
      start: "5:00 PM",
    });
    expect(r.classes[0].coach_name).toBeNull();
  });

  it("uses the FIRST class in weekday order as the sort keys", () => {
    const r = toStudentRow(row, new Map());
    expect(r.class_title).toBe("Mon 9am");
    expect(r.coach_name).toBeNull();
  });

  it("keeps activity and assignment as two independent axes", () => {
    const r = toStudentRow({ ...row, is_active: false, assignment_status: "assigned" }, new Map());
    expect(r.is_active).toBe(false);
    expect(r.assignment_status).toBe("assigned");
  });

  it("renders a parentless child with an em dash and a null parent_id", () => {
    const r = toStudentRow({ ...row, parent_students: [] }, new Map([["s1", 3]]));
    expect(r.parent_id).toBeNull();
    expect(r.parent_name).toBe("—");
    expect(r.lessons).toBe(3);
    expect(isUnclaimed(r)).toBe(true);
  });
});

describe("statusLabel", () => {
  it("puts activity before assignment", () => {
    expect(statusLabel({ is_active: false, assignment_status: "assigned" })).toBe("Inactive");
    expect(statusLabel({ is_active: true, assignment_status: "assigned" })).toBe("Assigned");
    expect(statusLabel({ is_active: true, assignment_status: "unassigned" })).toBe("Unassigned");
  });
});

describe("matchesFilters", () => {
  const never = () => false;
  const always = () => true;

  it("All + no toggles matches everything", () => {
    expect(matchesFilters(base(), { statusFilter: "All", lowOnly: false, unclaimedOnly: false }, never)).toBe(true);
  });

  it("status filter compares against the badge label, not the enum", () => {
    const f = { statusFilter: "Inactive", lowOnly: false, unclaimedOnly: false };
    expect(matchesFilters(base({ is_active: false }), f, never)).toBe(true);
    expect(matchesFilters(base({ is_active: true }), f, never)).toBe(false);
  });

  it("lowOnly defers entirely to the passed-in verdict", () => {
    const f = { statusFilter: "All", lowOnly: true, unclaimedOnly: false };
    expect(matchesFilters(base(), f, never)).toBe(false);
    expect(matchesFilters(base(), f, always)).toBe(true);
  });

  it("unclaimedOnly keeps only parentless children", () => {
    const f = { statusFilter: "All", lowOnly: false, unclaimedOnly: true };
    expect(matchesFilters(base({ parent_id: null }), f, never)).toBe(true);
    expect(matchesFilters(base({ parent_id: "p1" }), f, never)).toBe(false);
  });
});
