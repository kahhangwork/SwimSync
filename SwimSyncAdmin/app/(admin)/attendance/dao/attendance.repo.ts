// dao/ — data access for the Attendance audit page. Transport only (no React,
// no presentation — tierBoundaries check 2). The client is bound here; the page
// and hook never import @/lib/supabase (check 4).
//
// Every read is RLS-scoped to the admin's tenant. The money-axis loads carry
// their own cap checks in the hook (RISK 6): PostgREST truncates at max_rows
// SILENTLY, so a full result degrades the Coach column to "—" rather than
// attributing from half the data.
import { supabase } from "@/lib/supabase";
import { ilikeContains } from "@/lib/tableSearch";
import type {
  AbsenceRow,
  ClassRateRow,
  ClassShadowRow,
  SubstituteRow,
} from "@/lib/lessonAttribution";
import { ROW_LIMIT } from "../constants";

// The rows the mapped reads return, typed from each select. The attendance
// read's embeds are all `!inner` (an inner join drops the row rather than
// nulling the embed), so they are not widened; the domain keeps its `?.` anyway.
type Rows<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;
export type FilterCoachRow = Rows<typeof loadFilterOptions>["coachRows"][number];
export type FilterClassRow = Rows<typeof loadFilterOptions>["classRows"][number];
export type MakeupClassRow = Rows<typeof loadMakeupData>["classRows"][number];
export type MakeupEnrolRow = Rows<typeof loadMakeupData>["enrolRows"][number];
export type AttendanceSelectRow = NonNullable<Rows<typeof loadAttendanceRows>["data"]>[number];

/** Payment-method coverage (RPC). */
export async function loadPackageCoverage(): Promise<unknown[]> {
  const { data } = await supabase.rpc("student_package_coverage");
  return data ?? [];
}

/** Coach + class dropdown options. Inactive classes are included and labelled.
 *  Return type inferred, so each row is typed from its select (Wave 8). */
export async function loadFilterOptions() {
  const [{ data: coachData, error: coachErr }, { data: classData, error: classErr }] =
    await Promise.all([
      supabase.from("coaches").select("id, profiles(full_name)"),
      supabase.from("classes").select("id, title, is_active").order("title"),
    ]);
  return {
    coachRows: coachData ?? [],
    classRows: classData ?? [],
    error: (coachErr ?? classErr)?.message ?? null,
  };
}

/** Make-up seed data: every class (incl. inactive) + every active enrolment.
 *  Return type inferred, so each row is typed from its select (Wave 8). */
export async function loadMakeupData() {
  const [{ data: cls }, { data: enrol }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, title, day_of_week, category_id, is_active")
      .order("title"),
    supabase
      .from("student_class_enrolments")
      .select("student_id, class_id")
      .eq("is_active", true),
  ]);
  return { classRows: cls ?? [], enrolRows: enrol ?? [] };
}

/** The main audit query. Range + scoped student search are applied in the DB. */
export async function loadAttendanceRows(opts: {
  dateFrom: string;
  dateTo: string;
  term: string;
}) {
  let query = supabase
    .from("attendance")
    .select(
      "id, status, students!inner(id, full_name), lesson_sessions!inner(id, session_date, classes!inner(id, title))"
    )
    // Ordering by the EMBEDDED date, not by the random UUID id.
    .order("lesson_sessions(session_date)", { ascending: false })
    .order("students(full_name)")
    .limit(ROW_LIMIT);

  if (opts.dateFrom) query = query.gte("lesson_sessions.session_date", opts.dateFrom);
  if (opts.dateTo) query = query.lte("lesson_sessions.session_date", opts.dateTo);
  const term = opts.term.trim();
  if (term) query = query.ilike("students.full_name", ilikeContains(term));

  const { data, error } = await query;
  return { data: data ?? null, error: error?.message ?? null };
}

/** The three money-axis inputs (substitutes tenant-wide, rates by class, shadows). */
export async function loadAttributionInputs(classIds: string[]): Promise<{
  subs: SubstituteRow[];
  rates: ClassRateRow[];
  shadows: ClassShadowRow[];
  error: string | null;
}> {
  const [subsRes, ratesRes, shadowsRes] = await Promise.all([
    supabase.from("session_coaches").select("lesson_session_id, coach_id"),
    // class_coach_terms, not class_rates — see lib/calendarData.ts (20261005000200).
    supabase.rpc("class_coach_terms", { p_class_ids: classIds }),
    supabase.from("class_shadow_coaches").select("class_id, coach_id, effective_from, effective_to"),
  ]);
  const error = (subsRes.error ?? ratesRes.error ?? shadowsRes.error)?.message ?? null;
  return {
    subs: (subsRes.data ?? []) as SubstituteRow[],
    rates: (ratesRes.data ?? []) as ClassRateRow[],
    shadows: (shadowsRes.data ?? []) as ClassShadowRow[],
    error,
  };
}

/** Shadow absences, keyed on the handful of shadow coaches (never lesson ids — 414). */
export async function loadShadowAbsences(
  shadowCoachIds: string[]
): Promise<{ data: AbsenceRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("session_coach_absences")
    .select("lesson_session_id, coach_id")
    .in("coach_id", shadowCoachIds);
  return { data: (data ?? null) as AbsenceRow[] | null, error: error?.message ?? null };
}

/** Book a make-up (RPC). book_makeup() holds every refusal in plain sentences. */
export async function bookMakeup(opts: {
  classId: string;
  date: string;
  studentId: string;
  homeClassId: string;
}): Promise<string | null> {
  const { error } = await supabase.rpc("book_makeup", {
    p_class_id: opts.classId,
    p_session_date: opts.date,
    p_student_id: opts.studentId,
    p_home_class_id: opts.homeClassId,
  });
  return error?.message ?? null;
}
