// The admin lesson page's pure mapping — raw rows in, entities out. No React, no
// client. Moved verbatim out of the page's load effect at Stage 2 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md, and pinned by
// lessonDetailRows.test.ts (characterisation — plan §5 RISK 3/4).

import { toSgDate } from "@/lib/lessonDates";
import { expectedStudentsOn, studentsEnrolledOn, type EnrolmentSpan } from "@/lib/attendanceCompleteness";
import type { DbStatus, RosterKind } from "./lessonMarking";
import type { ClassInfo, CoachOpt, EligibleKid, RosterRow } from "../types";

/** The class row → ClassInfo (capacity falls back to its category's default). */
export function classInfoFrom(c: any): ClassInfo {
  return {
    id: c.id,
    title: c.title,
    day_of_week: c.day_of_week,
    start_time: c.start_time,
    end_time: c.end_time,
    location_name: c.locations?.name ?? "",
    coach_id: c.coach_id,
    category_id: c.category_id,
    colour: c.colour ?? null,
    capacity: c.capacity ?? c.class_categories?.default_capacity ?? null,
    is_active: c.is_active !== false,
    deactivated_at: c.deactivated_at ?? null,
  };
}

export function coachListFrom(rows: any[]): CoachOpt[] {
  return rows
    .map((x) => ({ id: x.id, name: x.profiles?.full_name ?? "Unknown coach" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The roster for one lesson. Who is expected: the SAME union the billing gate
 * uses (`expectedStudentsOn`), plus a marked row for any child no longer
 * expected.
 */
export function buildRoster(input: {
  date: string;
  enrolments: any[];
  trials: any[];
  makeups: any[];
  marks: Map<string, DbStatus>;
}): RosterRow[] {
  const { date, marks } = input;
  const spans: EnrolmentSpan[] = input.enrolments.map((e) => ({
    studentId: e.student_id,
    from: toSgDate(e.enrolled_at),
    until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
  }));
  const names = new Map<string, string>();
  for (const e of input.enrolments) names.set(e.student_id, e.students?.full_name ?? "Unknown");
  const guests: { id: string; student_id: string; kind: RosterKind; name: string }[] = [
    ...input.trials.map((b) => ({ id: b.id, student_id: b.student_id, kind: "trial" as const, name: b.students?.full_name ?? "Unknown" })),
    ...input.makeups.map((b) => ({ id: b.id, student_id: b.student_id, kind: "makeup" as const, name: b.students?.full_name ?? "Unknown" })),
  ];
  for (const g of guests) names.set(g.student_id, g.name);
  const bookedByDate = new Map<string, string[]>([[date, guests.map((g) => g.student_id)]]);
  const enrolledSet = new Set(studentsEnrolledOn(date, spans));
  const expected = expectedStudentsOn(date, spans, bookedByDate);
  const rows: RosterRow[] = expected.map((id) => {
    const g = guests.find((x) => x.student_id === id);
    return {
      studentId: id,
      name: names.get(id) ?? "Unknown",
      kind: enrolledSet.has(id) ? "enrolled" : g?.kind ?? "trial",
      bookingId: enrolledSet.has(id) ? null : g?.id ?? null,
      expected: true,
      prev: marks.get(id) ?? null,
    };
  });
  // A marked row for a child no longer expected (left the class) is still
  // shown, read-only-ish, so the admin sees it — and it is a correction.
  for (const [id, st] of marks) {
    if (!expected.includes(id)) rows.push({ studentId: id, name: names.get(id) ?? "Former student", kind: "enrolled", bookingId: null, expected: false, prev: st });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** Make-up candidates' pool: active children with ≥1 active enrolment in a real class. */
export function eligibleKidsFrom(kidRows: any[]): EligibleKid[] {
  return kidRows
    .filter((k) => k.is_active)
    .map((k) => {
      const enrolled = (k.student_class_enrolments ?? [])
        .filter((e: any) => e.is_active && e.classes)
        .map((e: any) => ({ id: e.classes.id, title: e.classes.title, category_id: e.classes.category_id }));
      if (enrolled.length === 0) return null;
      return { id: k.id, full_name: k.full_name, home_classes: enrolled, home_class_titles: enrolled.map((e: any) => e.title) };
    })
    .filter(Boolean) as EligibleKid[];
}

/**
 * Trial candidates: active children with NO active enrolment. ⚠ Unlike
 * eligibleKidsFrom, the `classes` join is NOT consulted — an active enrolment
 * whose class is hidden still disqualifies (plan §5 RISK 4).
 */
export function trialKidsFrom(kidRows: any[]): { id: string; full_name: string }[] {
  return kidRows
    .filter((k) => k.is_active && !(k.student_class_enrolments ?? []).some((e: any) => e.is_active))
    .map((k) => ({ id: k.id, full_name: k.full_name }));
}
