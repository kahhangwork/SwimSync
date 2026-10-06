// Pure: raw rows -> the checklist. Lifted verbatim from the page's load()
// (Admin L-D, BATCH_D_PLAN.md) so it gets the page's first unit tests.
import {
  groupRosterByLevel,
  roundProgress,
  type GradeLevel,
  type Level,
  type RosterStudent,
} from "@/lib/assessment";
import type {
  ClassRowIn,
  EnrolmentRow,
  LevelRow,
  ProgressRow,
} from "../dao/assessment.repo";
import type { ClassRow } from "../types";

export function toLevels(data: LevelRow[] | null): Level[] {
  return (data ?? []).map((l) => ({
    id: l.id,
    label: l.label,
    sort_order: l.sort_order,
    skills: l.tenant_level_skills ?? [],
  }));
}

export function studentIdsOf(enrolments: EnrolmentRow[] | null): string[] {
  return Array.from(
    new Set((enrolments ?? []).map((e) => e.students?.id).filter(Boolean))
  ) as string[]; // census: ui-cast (Wave 8) — `.filter(Boolean)` drops the undefined ids; TS does not narrow through it
}

/** `today` is the SGT day of week (dayOfWeekOf(todayInSg())), passed in so this
 *  never reads a clock (§7.7). */
export function buildClassRows(
  classes: ClassRowIn[],
  enrolments: EnrolmentRow[] | null,
  progressRows: ProgressRow[] | null,
  levels: Level[],
  scale: GradeLevel[],
  since: string,
  today: string | null
): ClassRow[] {
  const progressByStudent = new Map<string, ProgressRow[]>();
  for (const p of progressRows ?? []) {
    const list = progressByStudent.get(p.student_id) ?? [];
    list.push(p);
    progressByStudent.set(p.student_id, list);
  }

  const rosterByClass = new Map<string, RosterStudent[]>();
  for (const e of enrolments ?? []) {
    const s = e.students;
    if (!s) continue;
    const list = rosterByClass.get(e.class_id) ?? [];
    list.push({
      id: s.id,
      full_name: s.full_name,
      level_id: s.level_id,
      progress: progressByStudent.get(s.id) ?? [],
    });
    rosterByClass.set(e.class_id, list);
  }

  const built: ClassRow[] = classes.map((c) => {
    const roster = rosterByClass.get(c.id) ?? [];
    const p = roundProgress(groupRosterByLevel(roster, levels, scale, since));
    return {
      id: c.id,
      title: c.title,
      day_of_week: c.day_of_week,
      start_time: c.start_time,
      location: c.locations?.name ?? null,
      coach: c.coaches?.profiles?.full_name ?? null,
      assessed: p.assessedStudents,
      total: p.totalStudents,
      blocked: p.blockedStudents,
    };
  });

  // Today's classes lead — assessment usually follows a lesson. Everything
  // else keeps the query's day/time order beneath them.
  built.sort((a, b) => {
    const at = a.day_of_week === today ? 0 : 1;
    const bt = b.day_of_week === today ? 0 : 1;
    return at - bt || a.start_time.localeCompare(b.start_time);
  });

  return built;
}
