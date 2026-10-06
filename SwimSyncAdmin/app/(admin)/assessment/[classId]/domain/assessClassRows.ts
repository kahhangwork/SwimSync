// Pure: raw rows -> the class header and the grid's inputs. Lifted verbatim from
// the page's load() (Admin L-D, BATCH_D_PLAN.md).
import type { Level, RosterStudent } from "@/lib/assessment";
import type {
  ClassInfoRow,
  EnrolmentRow,
  LevelRow,
  ProgressRow,
  StudentRow,
} from "../dao/assessClass.repo";
import type { ClassInfo } from "../types";

export function toClassInfo(c: ClassInfoRow): ClassInfo {
  return {
    title: c.title,
    day_of_week: c.day_of_week,
    start_time: c.start_time,
    location: c.locations?.name ?? null,
    tenant_id: c.tenant_id,
  };
}

export function toLevels(data: LevelRow[] | null): Level[] {
  return (data ?? []).map((l) => ({
    id: l.id,
    label: l.label,
    sort_order: l.sort_order,
    skills: l.tenant_level_skills ?? [],
  }));
}

export function studentsOf(enrolments: EnrolmentRow[] | null): StudentRow[] {
  return (enrolments ?? []).map((e) => e.students).filter(Boolean) as StudentRow[]; // census: ui-cast (Wave 8) — `.filter(Boolean)` drops the RLS-hidden nulls; TS does not narrow through it
}

export function toRoster(students: StudentRow[], progressRows: ProgressRow[] | null): RosterStudent[] {
  const byStudent = new Map<string, ProgressRow[]>();
  for (const p of progressRows ?? []) {
    const list = byStudent.get(p.student_id) ?? [];
    list.push(p);
    byStudent.set(p.student_id, list);
  }

  return students.map((s) => ({
    id: s.id,
    full_name: s.full_name,
    level_id: s.level_id,
    progress: byStudent.get(s.id) ?? [],
  }));
}

/** The progress bar's width, 0 when the class has no skills to grade. */
export function percentGraded(gradedSkills: number, totalSkills: number): number {
  return totalSkills === 0 ? 0 : Math.round((gradedSkills / totalSkills) * 100);
}
