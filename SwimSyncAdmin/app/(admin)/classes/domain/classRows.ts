// Pure derivations for the Classes list — row mapping, filtering, sort
// accessors, small counts. No React, no client, no clock. Unit-tested in
// classRows.test.ts (characterisation — pins existing behaviour, playbook §0).
import { dayOfWeekOrder } from "@/lib/tableSort";
import type { ClassRow } from "../types";

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Map one raw PostgREST `classes` row to a ClassRow.
 *
 * ⚠ §7.28 — `c.is_active`, the CLASS's own flag, NOT `e.is_active`. `is_active`
 * exists on `students`, on `student_class_enrolments` AND on `classes`; the
 * student_count line directly below reads the ENROLMENT's flag. These two are
 * one character apart and mean entirely different things — reading the class
 * flag off the enrolment nesting typechecks clean and renders every class
 * retired. The four cases in classRows.test.ts pin exactly this (RISK 2).
 */
export function mapClassRow(c: any): ClassRow {
  return {
    id: c.id,
    coach_id: c.coach_id,
    title: c.title,
    coach_name: c.coaches?.profiles?.full_name ?? "—",
    day_of_week: c.day_of_week,
    start_time: c.start_time,
    end_time: c.end_time,
    // From the joined entity, not the free-text column (dropped in contract).
    location_name: c.locations?.name ?? "—",
    location_id: c.location_id,
    price_per_lesson: Number(c.price_per_lesson),
    category_id: c.category_id ?? null,
    capacity: c.capacity ?? null,
    category_default_capacity: c.class_categories?.default_capacity ?? null,
    colour: c.colour ?? null,
    // The ENROLMENT's flag — count only the active enrolments.
    student_count: (c.student_class_enrolments ?? []).filter(
      (e: any) => e.is_active
    ).length,
    // c.is_active, NOT e.is_active — see the §7.28 note above. `!== false` keeps
    // a legacy row (is_active absent, pre-deactivate_class()) ACTIVE; Boolean(…)
    // would retire every such row.
    is_active: c.is_active !== false,
    deactivated_at: c.deactivated_at ?? null,
  };
}

/**
 * The list toolbar's filter: retired toggle, location, and a title/coach search.
 * `locationFilter` is CLAMPED to "all" when no visible class carries it (a stale
 * filter whose classes are gone after a reload must not hide every row while the
 * dropdown shows no matching option).
 */
export function filterClasses(
  classes: ClassRow[],
  opts: { search: string; locationFilter: string; showRetired: boolean }
): ClassRow[] {
  const { search, locationFilter, showRetired } = opts;
  const locationFilterActive =
    locationFilter !== "" && classes.some((c) => c.location_id === locationFilter);
  const q = search.toLowerCase();
  return classes.filter(
    (c) =>
      (showRetired || c.is_active) &&
      (!locationFilterActive || c.location_id === locationFilter) &&
      (c.title.toLowerCase().includes(q) || c.coach_name.toLowerCase().includes(q))
  );
}

// Sort accessors for the class table's useTableSort.
export const classSortAccessors = {
  // Calendar order, not alphabetical — see dayOfWeekOrder.
  day_of_week: (c: ClassRow) => dayOfWeekOrder(c.day_of_week),
  // The enrolled count only. The badge reads "2+1"; sorting by the string would
  // order it as text, and sorting by enrolled+trials would rank a class of 2
  // with a guest above a class of 3 weekly students.
  student_count: (c: ClassRow) => c.student_count,
};

/**
 * Whether to warn that a coach's shadow rate does not cover a new assignment.
 *
 * ⚠ A DATE COMPARISON, NOT A BOOLEAN (the Coach.shadowRateFrom note in types.ts).
 * Payroll refuses when no shadow rate is in force ON the lesson's date, so "they
 * have a rate somewhere" is the wrong question — a rate dated AFTER the
 * assignment still blocks the whole business's payroll run months later. Met
 * here, at assignment time, it costs one sentence. `startsOn` is compared
 * lexically (YYYY-MM-DD) and `<=` is the boundary: a rate that starts ON the
 * assignment date covers it.
 *   "none" → the coach has no shadow rate at all
 *   "late" → the rate starts AFTER the assignment does
 *   null   → covered; show no warning
 */
export function shadowRateWarning(
  shadowRateFrom: string | null,
  startsOn: string
): "none" | "late" | null {
  if (!shadowRateFrom) return "none";
  if (shadowRateFrom <= startsOn) return null;
  return "late";
}

// Active / retired split for the header subtitle and the toggle badge.
export function countActiveRetired(classes: ClassRow[]): {
  active: number;
  retired: number;
} {
  const active = classes.filter((c) => c.is_active).length;
  return { active, retired: classes.length - active };
}
