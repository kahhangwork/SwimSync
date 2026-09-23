// The Child Profile screen's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-F):
// the three formatters and the row mapping, moved VERBATIM out of
// app/(parent)/home/child/[id].tsx and pinned by childFormat.test.ts. No clock,
// no client.
import { formatSgStamp } from "@/lib/lessonDates";
import type { GradeLevel } from "@/lib/skillProgress";
import type { ChildDetail } from "../types";

export function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function capitalize(str: string | null): string {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return formatSgStamp(dateStr, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Every ACTIVE enrolment with an embedded class, in PostgREST order (this
 *  screen never sorted them — unlike Home). */
export function classesOf(student: any): ChildDetail["classes"] {
  return (student.student_class_enrolments ?? [])
    .filter((e: any) => e.is_active && e.classes)
    .map((e: any) => {
      const cls: any = e.classes;
      return {
        coach_name: cls?.coaches?.profiles?.full_name ?? null,
        day: cls?.day_of_week ?? null,
        time: `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`,
        location: cls?.locations?.name ?? null,
        location_address: cls?.locations?.address ?? null,
        location_notes: cls?.locations?.notes ?? null,
      };
    });
}

export function outstandingOf(invoices: any[] | null): number {
  return (invoices ?? []).reduce(
    (sum: number, inv: any) => sum + Number(inv.net_amount),
    0
  );
}

// Summed across businesses — see the note in features/parent-home/domain/homeRows.
export function creditOf(parentRecord: any): number {
  return ((parentRecord as any)?.parent_tenant_balances ?? []).reduce(
    (sum: number, b: any) => sum + Number(b.credit_balance ?? 0),
    0
  );
}

export function childDetailOf(
  student: any,
  classes: ChildDetail["classes"],
  scaleRows: any[] | null,
  progressRows: any[] | null,
  outstandingAmount: number,
  creditBalance: number
): ChildDetail {
  return {
    id: student.id,
    full_name: student.full_name,
    date_of_birth: student.date_of_birth,
    gender: student.gender,
    // Cast because supabase-js infers a to-one embed as an ARRAY without an
    // !inner hint. Read off tenant_levels, not off the student (§7.28).
    level_label: (student as any).tenant_levels?.label ?? null,
    level_note: (student as any).tenant_levels?.note ?? null,
    // Kept unsorted here — summariseSkillProgress orders by sort_order/label at
    // render. Carry the id so grades can be paired to each skill.
    level_skills: ((student as any).tenant_levels?.tenant_level_skills ?? []).map(
      (sk: any) => ({ id: sk.id, label: sk.label, sort_order: sk.sort_order })
    ),
    skill_grades: Object.fromEntries(
      ((progressRows as any[]) ?? []).map((p) => [p.skill_id, p.grade_level_id])
    ),
    scale: (scaleRows as GradeLevel[]) ?? [],
    notes: student.notes,
    assignment_status: student.assignment_status,
    is_active: student.is_active,
    classes,
    outstanding_amount: outstandingAmount,
    credit_balance: creditBalance,
  };
}
