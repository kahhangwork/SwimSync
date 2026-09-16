import type { LessonAttribution, LessonRef } from "@/lib/lessonAttribution";
import type { AttendanceRow, MakeupClass, RawAttendanceRow } from "../types";

// Pure mappings for the Attendance page, lifted verbatim from the page's loaders
// so the embed-flattening, lesson de-duplication, money-axis fold and client
// filters can be characterised alone.

export function mapFilterCoaches(rows: unknown[]): { id: string; full_name: string }[] {
  return (rows as any[]).map((c) => ({ id: c.id, full_name: c.profiles?.full_name ?? "Unknown" }));
}

export function mapFilterClasses(rows: unknown[]): { id: string; label: string }[] {
  return (rows as any[]).map((c) => ({
    id: c.id,
    label: c.is_active ? c.title : `${c.title} (inactive)`,
  }));
}

/** Flatten the make-up seed data into the class list + enrolment lookups. */
export function mapMakeupData(
  classRows: unknown[],
  enrolRows: unknown[]
): {
  makeupClasses: MakeupClass[];
  enrolmentSet: Set<string>;
  ownClassesByStudent: Map<string, Set<string>>;
} {
  const set = new Set<string>();
  const byStudent = new Map<string, Set<string>>();
  for (const e of enrolRows as any[]) {
    const sid = e.student_id as string;
    const cid = e.class_id as string;
    set.add(`${sid}:${cid}`);
    const own = byStudent.get(sid) ?? new Set<string>();
    own.add(cid);
    byStudent.set(sid, own);
  }
  return { makeupClasses: (classRows ?? []) as MakeupClass[], enrolmentSet: set, ownClassesByStudent: byStudent };
}

/** Flatten the attendance embed into raw rows (pre-attribution). */
export function mapAttendanceRows(data: unknown[]): RawAttendanceRow[] {
  return (data as any[]).map((a) => ({
    id: a.id,
    student_id: a.students?.id ?? "",
    student_name: a.students?.full_name ?? "—",
    class_id: a.lesson_sessions?.classes?.id ?? "",
    class_title: a.lesson_sessions?.classes?.title ?? "—",
    session_date: a.lesson_sessions?.session_date ?? "—",
    status: a.status,
    lesson_session_id: a.lesson_sessions?.id ?? "",
  }));
}

/** The distinct lessons behind the rows — one attribution per lesson. */
export function buildLessonRefs(rawRows: RawAttendanceRow[]): {
  lessons: LessonRef[];
  classIds: string[];
} {
  const lessonById = new Map<string, LessonRef>();
  for (const r of rawRows) {
    if (r.lesson_session_id && r.class_id && !lessonById.has(r.lesson_session_id)) {
      lessonById.set(r.lesson_session_id, {
        lesson_session_id: r.lesson_session_id,
        class_id: r.class_id,
        session_date: r.session_date,
      });
    }
  }
  const lessons = [...lessonById.values()];
  const classIds = [...new Set(lessons.map((l) => l.class_id))];
  return { lessons, classIds };
}

/** Fold the money-axis attribution into each row. A null map (load failed) shows
 *  "—" in every Coach cell rather than a name we could not stand behind (RISK 7). */
export function applyAttribution(
  rawRows: RawAttendanceRow[],
  attribution: Map<string, LessonAttribution> | null
): AttendanceRow[] {
  return rawRows.map((r) => {
    const at = attribution?.get(r.lesson_session_id);
    return {
      id: r.id,
      student_id: r.student_id,
      student_name: r.student_name,
      class_id: r.class_id,
      class_title: r.class_title,
      session_date: r.session_date,
      status: r.status,
      main_coach_id: at?.main_coach_id ?? null,
      is_cover: at?.is_cover ?? false,
      shadow_coach_ids: at?.shadow_coach_ids ?? [],
    };
  });
}

/** Client-side refinements over the DB fetch: coach (id, main OR shadow),
 *  status, class (id). Student search already ran in the DB. */
export function filterRows(
  rows: AttendanceRow[],
  opts: { coachFilter: string; statusFilter: string; classFilter: string }
): AttendanceRow[] {
  return rows.filter((a) => {
    const matchCoach =
      opts.coachFilter === "All" ||
      a.main_coach_id === opts.coachFilter ||
      a.shadow_coach_ids.includes(opts.coachFilter);
    const matchStatus = opts.statusFilter === "All" || a.status === opts.statusFilter;
    const matchClass = opts.classFilter === "All" || a.class_id === opts.classFilter;
    return matchCoach && matchStatus && matchClass;
  });
}
