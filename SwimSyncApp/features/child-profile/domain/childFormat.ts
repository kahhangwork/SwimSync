// The Child Profile screen's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-F):
// the three formatters and the row mapping, moved VERBATIM out of
// app/(parent)/home/child/[id].tsx and pinned by childFormat.test.ts. No clock,
// no client.
import { formatSgStamp } from "@/lib/lessonDates";
import type { GradeLevel } from "@/lib/skillProgress";
import type { ChildDetail } from "../types";
import type {
  OutstandingInvoiceRow,
  ParentBalancesRow,
  SkillProgressRow,
  StudentProfileRow,
} from "../dao/childProfile.repo";

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
export function classesOf(student: StudentProfileRow): ChildDetail["classes"] {
  return (student.student_class_enrolments ?? [])
    .filter((e) => e.is_active && e.classes)
    .map((e) => {
      // census: ui-cast (Wave 8) — the filter above keeps only rows WITH a class.
      const cls = e.classes!;
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

export function outstandingOf(invoices: OutstandingInvoiceRow[] | null): number {
  return (invoices ?? []).reduce(
    (sum: number, inv) => sum + Number(inv.net_amount),
    0
  );
}

// Sums whatever balance rows the read returned. The child profile's read is
// already narrowed to the child's business, so this is that business's credit
// (D5) — unlike Home's family-wide total (features/parent-home/domain/homeRows).
export function creditOf(parentRecord: ParentBalancesRow | null): number {
  return (parentRecord?.parent_tenant_balances ?? []).reduce(
    (sum: number, b) => sum + Number(b.credit_balance ?? 0),
    0
  );
}

export function childDetailOf(
  student: StudentProfileRow,
  classes: ChildDetail["classes"],
  scaleRows: GradeLevel[] | null,
  progressRows: SkillProgressRow[] | null,
  outstandingAmount: number,
  creditBalance: number
): ChildDetail {
  return {
    id: student.id,
    full_name: student.full_name,
    date_of_birth: student.date_of_birth,
    gender: student.gender,
    // Read off tenant_levels, not off the student (§7.28). An object or null (RLS),
    // typed from the select since Wave 8 — the old `as any` is gone.
    level_label: student.tenant_levels?.label ?? null,
    level_note: student.tenant_levels?.note ?? null,
    // Kept unsorted here — summariseSkillProgress orders by sort_order/label at
    // render. Carry the id so grades can be paired to each skill.
    level_skills: (student.tenant_levels?.tenant_level_skills ?? []).map(
      (sk) => ({ id: sk.id, label: sk.label, sort_order: sk.sort_order })
    ),
    skill_grades: Object.fromEntries(
      (progressRows ?? []).map((p) => [p.skill_id, p.grade_level_id])
    ),
    scale: scaleRows ?? [],
    notes: student.notes,
    assignment_status: student.assignment_status,
    is_active: student.is_active,
    classes,
    outstanding_amount: outstandingAmount,
    credit_balance: creditBalance,
  };
}
