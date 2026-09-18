// CHARACTERISATION tests — they pin the admin lesson page's load mapping exactly
// as it behaved inline in page.tsx before Stage 2 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md moved it here. §7.25's
// prove-it-red rule does not apply: this is existing behaviour, not a new rule
// (playbook §0). Plan §5 RISK 3 (roster) and RISK 4 (the two kid filters).

import { describe, expect, it } from "vitest";
import { buildRoster, classInfoFrom, coachListFrom, eligibleKidsFrom, trialKidsFrom } from "./lessonDetailRows";
import type { DbStatus } from "./lessonMarking";

const DATE = "2026-09-19";
const enrol = (id: string, name: string | null, from = "2026-09-01", until: string | null = null) => ({
  student_id: id,
  enrolled_at: `${from}T00:00:00+08:00`,
  unenrolled_at: until ? `${until}T00:00:00+08:00` : null,
  students: name === null ? null : { full_name: name },
});
const booking = (id: string, studentId: string, name: string | null) => ({
  id,
  student_id: studentId,
  students: name === null ? null : { full_name: name },
});
const roster = (over: Partial<Parameters<typeof buildRoster>[0]> = {}) =>
  buildRoster({ date: DATE, enrolments: [], trials: [], makeups: [], marks: new Map(), ...over });

describe("buildRoster", () => {
  it("enrolled children: kind enrolled, no booking, expected, prev from marks, sorted by name", () => {
    const rows = roster({
      enrolments: [enrol("s2", "Zed"), enrol("s1", "Amy")],
      marks: new Map<string, DbStatus>([["s2", "present"]]),
    });
    expect(rows).toEqual([
      { studentId: "s1", name: "Amy", kind: "enrolled", bookingId: null, expected: true, prev: null },
      { studentId: "s2", name: "Zed", kind: "enrolled", bookingId: null, expected: true, prev: "present" },
    ]);
  });

  it("an enrolment's span is inclusive of its unenrol date and excludes one that ended before", () => {
    const rows = roster({
      enrolments: [enrol("s1", "Ends today", "2026-09-01", DATE), enrol("s2", "Ended", "2026-09-01", "2026-09-18"), enrol("s3", "Future", "2026-09-20")],
    });
    expect(rows.map((r) => r.studentId)).toEqual(["s1"]);
  });

  it("trial and make-up guests carry their kind, booking id and the booking's name", () => {
    const rows = roster({ trials: [booking("t1", "g1", "Trial Tia")], makeups: [booking("m1", "g2", "Makeup Max")] });
    expect(rows).toEqual([
      { studentId: "g2", name: "Makeup Max", kind: "makeup", bookingId: "m1", expected: true, prev: null },
      { studentId: "g1", name: "Trial Tia", kind: "trial", bookingId: "t1", expected: true, prev: null },
    ]);
  });

  it("an ENROLLED child who also has a guest booking that date is enrolled, with no booking id (no Cancel booking)", () => {
    const rows = roster({ enrolments: [enrol("s1", "Amy")], makeups: [booking("m1", "s1", "Amy")] });
    expect(rows).toEqual([{ studentId: "s1", name: "Amy", kind: "enrolled", bookingId: null, expected: true, prev: null }]);
  });

  it("a guest booking's name OVERWRITES the enrolment's name (guests are read second)", () => {
    const rows = roster({ enrolments: [enrol("s1", "Enrolment name")], trials: [booking("t1", "s1", "Booking name")] });
    expect(rows[0].name).toBe("Booking name");
  });

  it("a missing students join reads 'Unknown' for enrolments and guests alike", () => {
    const rows = roster({ enrolments: [enrol("s1", null)], trials: [booking("t1", "g1", null)] });
    expect(rows.map((r) => r.name)).toEqual(["Unknown", "Unknown"]);
  });

  it("a marked child no longer expected is appended read-only-ish: expected:false, enrolled, their last known name", () => {
    const rows = roster({
      enrolments: [enrol("s1", "Left Lee", "2026-09-01", "2026-09-10")],
      marks: new Map<string, DbStatus>([["s1", "absent"]]),
    });
    expect(rows).toEqual([{ studentId: "s1", name: "Left Lee", kind: "enrolled", bookingId: null, expected: false, prev: "absent" }]);
  });

  it("a marked child with no name source anywhere is 'Former student' — and sorts with everyone else", () => {
    const rows = roster({
      enrolments: [enrol("s1", "Amy"), enrol("s2", "Zed")],
      marks: new Map<string, DbStatus>([["gone", "holiday"]]),
    });
    expect(rows.map((r) => [r.name, r.expected])).toEqual([
      ["Amy", true],
      ["Former student", false],
      ["Zed", true],
    ]);
  });
});

describe("classInfoFrom", () => {
  const base = { id: "c1", title: "Rose", day_of_week: "saturday", start_time: "09:00", end_time: "10:00", coach_id: "k1", category_id: "cat" };

  it("maps the row; capacity falls back to the category default, then null; is_active is `!== false`", () => {
    expect(classInfoFrom({ ...base, locations: { name: "Pool A" }, colour: "sky", capacity: 5, is_active: true, deactivated_at: null })).toEqual({
      ...base,
      location_name: "Pool A",
      colour: "sky",
      capacity: 5,
      is_active: true,
      deactivated_at: null,
    });
    expect(classInfoFrom({ ...base, capacity: null, class_categories: { default_capacity: 8 } }).capacity).toBe(8);
    expect(classInfoFrom({ ...base }).capacity).toBeNull();
    expect(classInfoFrom({ ...base }).is_active).toBe(true);
    expect(classInfoFrom({ ...base, is_active: false }).is_active).toBe(false);
  });

  it("missing location / colour / deactivated_at read as '' / null / null", () => {
    const c = classInfoFrom({ ...base, locations: null });
    expect([c.location_name, c.colour, c.deactivated_at]).toEqual(["", null, null]);
  });
});

describe("coachListFrom", () => {
  it("names each coach from their profile ('Unknown coach' when missing), sorted by name", () => {
    expect(coachListFrom([{ id: "k2", profiles: { full_name: "Zoe" } }, { id: "k1", profiles: null }, { id: "k3", profiles: { full_name: "Ann" } }])).toEqual([
      { id: "k3", name: "Ann" },
      { id: "k1", name: "Unknown coach" },
      { id: "k2", name: "Zoe" },
    ]);
  });
});

describe("eligibleKidsFrom / trialKidsFrom — two filters that look alike (RISK 4)", () => {
  const cls = (id: string, title: string, category_id = "cat") => ({ id, title, category_id });
  const kids = [
    { id: "a", full_name: "Active two homes", is_active: true, student_class_enrolments: [{ is_active: true, classes: cls("c1", "Rose") }, { is_active: true, classes: cls("c2", "Lily") }] },
    { id: "b", full_name: "Inactive kid", is_active: false, student_class_enrolments: [{ is_active: true, classes: cls("c1", "Rose") }] },
    { id: "c", full_name: "Only ended enrolments", is_active: true, student_class_enrolments: [{ is_active: false, classes: cls("c1", "Rose") }] },
    { id: "d", full_name: "No enrolments", is_active: true, student_class_enrolments: null },
    { id: "e", full_name: "Hidden class", is_active: true, student_class_enrolments: [{ is_active: true, classes: null }] },
  ];

  it("eligible: active, with ≥1 active enrolment whose class join is present; home titles in order", () => {
    expect(eligibleKidsFrom(kids)).toEqual([
      {
        id: "a",
        full_name: "Active two homes",
        home_classes: [cls("c1", "Rose"), cls("c2", "Lily")],
        home_class_titles: ["Rose", "Lily"],
      },
    ]);
  });

  it("trial: active with NO active enrolment — a hidden-class enrolment still disqualifies (the join is not consulted)", () => {
    expect(trialKidsFrom(kids)).toEqual([
      { id: "c", full_name: "Only ended enrolments" },
      { id: "d", full_name: "No enrolments" },
    ]);
  });
});
