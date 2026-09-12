// Slice 1 (list, search, filters) — the PURE half. Stage 4 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// Everything here was lifted from page.tsx unchanged: the row → StudentRow
// mapping that load() applied, the attendance tally beside it, and the three
// predicates the toolbar filters on. No React, no client — so it is the part
// of the page that can finally be unit-tested (studentRows.test.ts).

import { formatTime } from "@/lib/utils";
import { WEEKDAY_ORDER } from "../constants";
import type { EnrolledClass, StudentRow } from "../types";

/** Lessons per child, for duplicate detection: a merge must keep the row
 *  holding the history, and merge_students() refuses the other direction
 *  outright — so offering it would be offering a refusal. */
export function countLessons(att: { student_id: string }[] | null): Map<string, number> {
  const lessonCount = new Map<string, number>();
  for (const a of att ?? []) {
    lessonCount.set(a.student_id, (lessonCount.get(a.student_id) ?? 0) + 1);
  }
  return lessonCount;
}

/**
 * One PostgREST row from `fetchStudents` → the shape the table renders.
 * `s` is `any` because the select is a string; every nesting read below is a
 * §7.28 hazard — read off the JOINED row, never the student.
 */
export function toStudentRow(s: any, lessonCount: Map<string, number>): StudentRow {
  // ALL of them, weekday-ordered — not `.find()`. The chips are the only
  // place the admin can see that a child is in more than one class, so a
  // first-match read here would hide the state this whole wave creates.
  const classes: EnrolledClass[] = (s.student_class_enrolments ?? [])
    .filter((e: any) => e.is_active && e.classes)
    .map((e: any) => ({
      id: e.classes.id,
      title: e.classes.title,
      coach_name: e.classes.coaches?.profiles?.full_name ?? null,
      day: e.classes.day_of_week ?? null,
      start: e.classes.start_time ? formatTime(e.classes.start_time) : null,
    }))
    .sort(
      (a: EnrolledClass, b: EnrolledClass) =>
        WEEKDAY_ORDER.indexOf(a.day ?? "") - WEEKDAY_ORDER.indexOf(b.day ?? "") ||
        (a.start ?? "").localeCompare(b.start ?? "")
    );
  return {
    id: s.id,
    full_name: s.full_name,
    date_of_birth: s.date_of_birth,
    level_id: s.level_id,
    // Read off the JOINED tenant_levels row, not off the student — the
    // select is `any`, so the wrong nesting level typechecks and renders
    // every student unlevelled (§7.28).
    level_label: s.tenant_levels?.label ?? null,
    // Two INDEPENDENT axes now. This used to collapse them —
    // `s.is_active ? s.assignment_status : "inactive"` — which is exactly
    // the ambiguity the active/inactive work removed: a child can be
    // active but unassigned (a new signup awaiting a class).
    assignment_status: s.assignment_status,
    is_active: s.is_active,
    inactivated_at: s.inactivated_at,
    parent_id: s.parent_students?.[0]?.parents?.id ?? null,
    parent_name: s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
    classes,
    // Sort keys only — see the type. First in weekday order.
    class_title: classes[0]?.title ?? null,
    coach_name: classes[0]?.coach_name ?? null,
    lessons: lessonCount.get(s.id) ?? 0,
  };
}

/** Activity is the outer question ("still a customer?"), assignment the inner
 *  one ("in a class?"). An inactive child's assignment is not interesting. */
export function statusLabel(s: Pick<StudentRow, "is_active" | "assignment_status">): string {
  if (!s.is_active) return "Inactive";
  if (s.assignment_status === "assigned") return "Assigned";
  return "Unassigned";
}

/** A child added by a coach before their parent registered. Derived from the
 *  ABSENCE of a parent_students row rather than a stored flag — the join table
 *  is the fact, and a flag beside it would only ever go stale. */
export const isUnclaimed = (s: { parent_id: string | null }) => s.parent_id === null;

export type ListFilters = {
  statusFilter: string;
  lowOnly: boolean;
  unclaimedOnly: boolean;
};

/**
 * The refinements over whatever the fetch returned (the matched set when
 * searching, else the first 1000). Search itself is applied in the DATABASE.
 * `runningLow` is the SQL `low` verdict (⚠ RISK 10) — passed in, never
 * re-derived here.
 */
export function matchesFilters(
  s: StudentRow,
  f: ListFilters,
  runningLow: (s: StudentRow) => boolean
): boolean {
  const label = statusLabel(s);
  const matchStatus = f.statusFilter === "All" || label === f.statusFilter;
  const matchLow = !f.lowOnly || runningLow(s);
  const matchUnclaimed = !f.unclaimedOnly || isUnclaimed(s);
  return matchStatus && matchLow && matchUnclaimed;
}
