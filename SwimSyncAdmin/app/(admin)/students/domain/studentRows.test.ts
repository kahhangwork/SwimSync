// CHARACTERISATION TESTS, not proofs (plan §8). Every expectation here
// describes behaviour that already existed inline in page.tsx before Stage 4
// lifted it out; there is no fix for §7.25 to prove them red against. Their
// job is to pin the mapping so a later slice cannot quietly change what the
// table shows. The §7.28 nesting reads are the ones worth having.
//
// EXCEPT the blocks marked PROOF (2026-10-16, Active default + class-time sort).
// MUTATION PROOFS (§7.25), each applied to studentRows.ts and reverted:
//   1. chip sort on formatted `start` instead of `start_time` → RED "orders two classes on one day…"
//   2. drop the `"Active" ? s.is_active` branch                → RED both "Active …" tests
//   3. drop classSortKey's null guard                         → RED "is null — never a '-1' …"
//   4. drop the name from the key                             → RED "ascending: …" + "uses the FIRST class…"

import { describe, it, expect } from "vitest";
import { sortRows } from "@/lib/tableSort";
import {
  classSortKey,
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
  gender: null,
  level_id: null,
  level_label: null,
  assignment_status: "unassigned",
  is_active: true,
  inactivated_at: null,
  parent_id: "p1",
  parent_name: "Ms Tan",
  classes: [],
  class_sort_key: null,
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
    gender: "female",
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
  } as any; // partial rows (c-old has no coaches key): pin the `?.` fallbacks

  it("reads level and parent off the JOINED rows (§7.28)", () => {
    const r = toStudentRow(row, new Map());
    expect(r.level_label).toBe("Seahorse");
    expect(r.parent_id).toBe("p1");
    expect(r.parent_name).toBe("Ms Tan");
  });

  it("carries the gender through, so the Actions drawer can say when none is recorded", () => {
    expect(toStudentRow(row, new Map()).gender).toBe("female");
    expect(toStudentRow({ ...row, gender: null }, new Map()).gender).toBeNull();
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
      start_time: "17:00:00",
    });
    expect(r.classes[0].coach_name).toBeNull();
  });

  it("uses the FIRST class in weekday order as the sort keys", () => {
    const r = toStudentRow(row, new Map());
    expect(r.class_sort_key?.startsWith("0|09:00:00|")).toBe(true);
    expect(r.coach_name).toBeNull();
  });

  // PROOF — the old chip sort compared the FORMATTED start, so "10:15 AM"
  // came before "9:30 AM" (and "12:00 PM" before "9:00 AM").
  it("orders two classes on one day by real time, not by the formatted text", () => {
    const cls = (id: string, start_time: string) => ({
      is_active: true,
      classes: { id, title: id, day_of_week: "sunday", start_time, coaches: null },
    });
    const r = toStudentRow(
      { ...row, student_class_enrolments: [cls("late", "10:15:00"), cls("noon", "12:00:00"), cls("early", "09:30:00")] },
      new Map()
    );
    expect(r.classes.map((c) => c.id)).toEqual(["early", "late", "noon"]);
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

// PROOF — the default sort (user, 2026-10-16): earliest class by weekday
// Mon→Sun, then start time, then name; no class last in BOTH directions.
// Ordered THROUGH sortRows (localeCompare, numeric, base) — the comparator the
// table really uses — never by comparing key strings with `<`.
describe("classSortKey", () => {
  const ec = (day: string, start_time: string) =>
    ({ id: day + start_time, title: "", coach_name: null, day, start: null, start_time });
  const kid = (full_name: string, classes: ReturnType<typeof ec>[]) =>
    ({ full_name, key: classSortKey(classes, full_name) });

  const kids = [
    kid("Nobody", []),
    kid("Sunny", [ec("sunday", "08:45:00")]),
    kid("Zoe", [ec("monday", "10:15:00")]),
    kid("adam", [ec("monday", "10:15:00")]),
    kid("Mo", [ec("monday", "09:30:00")]),
  ];

  it("ascending: Monday before Sunday, earlier before later, then name (case-blind), no class last", () => {
    expect(sortRows(kids, (k) => k.key, "asc").map((k) => k.full_name)).toEqual([
      "Mo", "adam", "Zoe", "Sunny", "Nobody",
    ]);
  });

  it("descending reverses the classes but keeps the no-class child last", () => {
    expect(sortRows(kids, (k) => k.key, "desc").map((k) => k.full_name)).toEqual([
      "Sunny", "Zoe", "adam", "Mo", "Nobody",
    ]);
  });

  it("is null — never a '-1' or 'null' fragment — for no class, an unknown day, or no start", () => {
    expect(classSortKey([], "A")).toBeNull();
    expect(classSortKey([ec("someday", "09:00:00")], "A")).toBeNull();
    expect(classSortKey([{ ...ec("monday", "09:00:00"), start_time: null }], "A")).toBeNull();
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

  // PROOF — "Active" is not a badge label, so the old label compare matched nobody.
  it("Active keeps every active child, assigned or not, and no inactive one", () => {
    const f = { statusFilter: "Active", lowOnly: false, unclaimedOnly: false };
    expect(matchesFilters(base({ is_active: true, assignment_status: "assigned" }), f, never)).toBe(true);
    expect(matchesFilters(base({ is_active: true, assignment_status: "unassigned" }), f, never)).toBe(true);
    expect(matchesFilters(base({ is_active: false, assignment_status: "assigned" }), f, never)).toBe(false);
  });

  it("Active combines with Package running low", () => {
    const f = { statusFilter: "Active", lowOnly: true, unclaimedOnly: false };
    expect(matchesFilters(base({ is_active: true }), f, always)).toBe(true);
    expect(matchesFilters(base({ is_active: false }), f, always)).toBe(false);
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
