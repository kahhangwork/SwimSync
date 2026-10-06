// Unassigned page — pure mapping, filtering, and display formatters. No React,
// no network. Carries the page's unit tests (unassignedRows.test.ts).

import type { ClassOption, Coach, Student } from "../types";
import type { ClassOptionRow, CoachSelectRow, UnassignedStudentRow } from "../dao/unassigned.repo";

export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Map the students query, dropping any child with an upcoming trial (a booking
// is not an enrolment — see the dao comment on loadUpcomingTrials).
export function toStudents(data: UnassignedStudentRow[], awaitingTrial: Set<string>): Student[] {
  return (data ?? [])
    .filter((s) => !awaitingTrial.has(s.id))
    .map((s) => ({
      id: s.id,
      full_name: s.full_name,
      parent_name: s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
    }));
}

export function toCoaches(data: CoachSelectRow[]): Coach[] {
  return (data ?? []).map((c) => ({
    id: c.id,
    full_name: c.profiles?.full_name ?? "Unknown",
  }));
}

export function toClassOptions(data: ClassOptionRow[]): ClassOption[] {
  return (data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    day_of_week: c.day_of_week,
    start_time: c.start_time,
    student_count: (c.student_class_enrolments ?? []).filter(
      (e) => e.is_active
    ).length,
  }));
}

export function filterStudents(students: Student[], search: string): Student[] {
  return students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.parent_name.toLowerCase().includes(search.toLowerCase())
  );
}
