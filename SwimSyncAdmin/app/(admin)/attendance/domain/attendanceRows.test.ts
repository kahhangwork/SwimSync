import { describe, expect, it } from "vitest";
import type { LessonAttribution } from "@/lib/lessonAttribution";
import {
  applyAttribution,
  buildLessonRefs,
  filterRows,
  mapAttendanceRows,
  mapFilterClasses,
  mapMakeupData,
} from "./attendanceRows";
import type { AttendanceRow, RawAttendanceRow } from "../types";

// Characterisation test (playbook §2 stage 4): pins the embed-flattening, lesson
// de-dup, money-axis fold and client filters lifted from the Attendance page.

describe("mapAttendanceRows", () => {
  it("flattens the students/lesson_sessions/classes embed with fallbacks", () => {
    const data = [
      { id: "a1", status: "present", students: { id: "s1", full_name: "Amy" }, lesson_sessions: { id: "L1", session_date: "2026-08-01", classes: { id: "c1", title: "Dolphins" } } },
      { id: "a2", status: "absent", students: null, lesson_sessions: null },
    ];
    const out = mapAttendanceRows(data);
    expect(out[0]).toEqual({ id: "a1", student_id: "s1", student_name: "Amy", class_id: "c1", class_title: "Dolphins", session_date: "2026-08-01", status: "present", lesson_session_id: "L1" });
    expect(out[1].student_name).toBe("—");
    expect(out[1].class_title).toBe("—");
    expect(out[1].lesson_session_id).toBe("");
  });
});

describe("buildLessonRefs", () => {
  it("de-dups by lesson_session_id and lists distinct classes", () => {
    const raw: RawAttendanceRow[] = [
      { id: "a1", student_id: "s1", student_name: "Amy", class_id: "c1", class_title: "D", session_date: "2026-08-01", status: "present", lesson_session_id: "L1" },
      { id: "a2", student_id: "s2", student_name: "Bea", class_id: "c1", class_title: "D", session_date: "2026-08-01", status: "present", lesson_session_id: "L1" },
      { id: "a3", student_id: "s3", student_name: "Cy", class_id: "c2", class_title: "S", session_date: "2026-08-02", status: "present", lesson_session_id: "L2" },
      { id: "a4", student_id: "s4", student_name: "Di", class_id: "", class_title: "", session_date: "", status: "present", lesson_session_id: "" },
    ];
    const { lessons, classIds } = buildLessonRefs(raw);
    expect(lessons.map((l) => l.lesson_session_id)).toEqual(["L1", "L2"]);
    expect(classIds).toEqual(["c1", "c2"]);
  });
});

describe("applyAttribution", () => {
  const raw: RawAttendanceRow[] = [
    { id: "a1", student_id: "s1", student_name: "Amy", class_id: "c1", class_title: "D", session_date: "2026-08-01", status: "present", lesson_session_id: "L1" },
  ];
  it("folds an attribution in", () => {
    const attr = new Map<string, LessonAttribution>([
      ["L1", { main_coach_id: "co1", is_cover: true, shadow_coach_ids: ["co2"] } as LessonAttribution],
    ]);
    expect(applyAttribution(raw, attr)[0]).toMatchObject({ main_coach_id: "co1", is_cover: true, shadow_coach_ids: ["co2"] });
  });
  it("a null map (load failed) yields — everywhere", () => {
    const r = applyAttribution(raw, null)[0];
    expect(r.main_coach_id).toBeNull();
    expect(r.is_cover).toBe(false);
    expect(r.shadow_coach_ids).toEqual([]);
  });
});

describe("filterRows", () => {
  const row = (over: Partial<AttendanceRow>): AttendanceRow => ({
    id: "a", student_id: "s", student_name: "n", class_id: "c1", class_title: "D",
    session_date: "2026-08-01", status: "present", main_coach_id: "co1", is_cover: false, shadow_coach_ids: [],
    ...over,
  });
  const rows = [
    row({ id: "a1", main_coach_id: "co1", status: "present", class_id: "c1" }),
    row({ id: "a2", main_coach_id: "co2", status: "absent", class_id: "c2", shadow_coach_ids: ["co1"] }),
  ];
  it("All passes everything", () => {
    expect(filterRows(rows, { coachFilter: "All", statusFilter: "All", classFilter: "All" }).length).toBe(2);
  });
  it("coach matches main OR shadow", () => {
    expect(filterRows(rows, { coachFilter: "co1", statusFilter: "All", classFilter: "All" }).map((r) => r.id)).toEqual(["a1", "a2"]);
  });
  it("status and class narrow by exact value", () => {
    expect(filterRows(rows, { coachFilter: "All", statusFilter: "absent", classFilter: "All" }).map((r) => r.id)).toEqual(["a2"]);
    expect(filterRows(rows, { coachFilter: "All", statusFilter: "All", classFilter: "c1" }).map((r) => r.id)).toEqual(["a1"]);
  });
});

describe("mapFilterClasses + mapMakeupData", () => {
  it("labels inactive classes", () => {
    expect(mapFilterClasses([{ id: "c1", title: "D", is_active: true }, { id: "c2", title: "S", is_active: false }])).toEqual([
      { id: "c1", label: "D" },
      { id: "c2", label: "S (inactive)" },
    ]);
  });
  it("builds the enrolment set + own-classes map", () => {
    const { enrolmentSet, ownClassesByStudent } = mapMakeupData([], [
      { student_id: "s1", class_id: "c1" },
      { student_id: "s1", class_id: "c2" },
    ]);
    expect(enrolmentSet.has("s1:c1")).toBe(true);
    expect(ownClassesByStudent.get("s1")).toEqual(new Set(["c1", "c2"]));
  });
});
