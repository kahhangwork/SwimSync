// CHARACTERISATION test (playbook §0): pins behaviour the Unassigned page
// already had. Not a new rule, so §7.25's prove-red-first does not apply.

import { describe, expect, it } from "vitest";
import {
  capitalize,
  filterStudents,
  formatTime,
  toClassOptions,
  toCoaches,
  toStudents,
} from "./unassignedRows";
import type { Student } from "../types";

describe("unassigned domain — pure helpers", () => {
  it("formats 24h time to 12h am/pm", () => {
    expect(formatTime("09:30")).toBe("9:30 AM");
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("18:45")).toBe("6:45 PM");
  });

  it("capitalizes the first letter", () => {
    expect(capitalize("monday")).toBe("Monday");
  });

  it("maps students, drops those awaiting a trial, defaults parent to em-dash", () => {
    const data = [
      { id: "s1", full_name: "Amy", parent_students: [{ parents: { profiles: { full_name: "Mum" } } }] },
      { id: "s2", full_name: "Ben", parent_students: [] },
      { id: "s3", full_name: "Cara", parent_students: [{ parents: { profiles: { full_name: "Dad" } } }] },
    ];
    const out = toStudents(data, new Set(["s3"]));
    expect(out).toEqual([
      { id: "s1", full_name: "Amy", parent_name: "Mum" },
      { id: "s2", full_name: "Ben", parent_name: "—" },
    ]);
  });

  it("maps coaches, defaulting a missing name to Unknown", () => {
    expect(toCoaches([{ id: "c1", profiles: { full_name: "Coach A" } }, { id: "c2", profiles: null }])).toEqual([
      { id: "c1", full_name: "Coach A" },
      { id: "c2", full_name: "Unknown" },
    ]);
  });

  it("maps class options and counts only active enrolments", () => {
    const out = toClassOptions([
      { id: "cl1", title: "Fish", day_of_week: "monday", start_time: "09:00", student_class_enrolments: [{ is_active: true }, { is_active: false }] },
    ]);
    expect(out[0]).toMatchObject({ id: "cl1", title: "Fish", student_count: 1 });
  });

  it("filters by student OR parent name, case-insensitively", () => {
    const students = [
      { id: "s1", full_name: "Amy Tan", parent_name: "Mrs Tan" },
      { id: "s2", full_name: "Ben Lee", parent_name: "Mr Lee" },
    ] as Student[];
    expect(filterStudents(students, "TAN").map((s) => s.id)).toEqual(["s1"]);
    expect(filterStudents(students, "mr lee").map((s) => s.id)).toEqual(["s2"]);
  });
});
