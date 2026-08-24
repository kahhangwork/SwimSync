// Loads everything the admin calendar needs for a date range, as READS ONLY.
//
// ⚠ NO WRITE OF ANY KIND LIVES IN THIS FILE, and none may be added. The
// calendar never creates a `lesson_sessions` row — that row is the billing
// engine's "a lesson happened here" signal (pattern ∪ rows), so a phantom row
// on a date the class never ran is a billable lesson. The only writer is the
// lesson detail page's Save.
//
// Tenant scoping is RLS (every table here has a tenant-admin SELECT policy); no
// query carries a tenant_id filter. The money axis (who taught a lesson) is
// resolved from `session_coaches` + `class_rates` + `class_shadow_coaches` +
// `session_coach_absences`, exactly as the Attendance page does (§7.152).

import { supabase } from "./supabase";
import {
  chunk,
  type BuildInput,
  type CalendarAttendance,
  type CalendarClass,
  type DateRange,
} from "./calendarLessons";
import type { SubstituteRow } from "./lessonAttribution";
import type { DayOfWeek } from "./lessonDates";

export type CalendarData = Omit<BuildInput, "range" | "today" | "nowMinutes"> & {
  /** `coaches.id → name` (already in BuildInput) plus the list for the filter. */
  coachOptions: { id: string; name: string }[];
};

export type CalendarLoad =
  | { ok: true; data: CalendarData }
  | { ok: false; error: string };

const ROW_LIMIT = 1000; // PostgREST's default page; hitting it means we are blind past it

export async function loadCalendarData(range: DateRange): Promise<CalendarLoad> {
  const [classesRes, coachesRes, ratesRes, sessionsRes, enrolRes, trialsRes, makeupsRes, shadowsRes, holidaysRes] =
    await Promise.all([
      supabase
        .from("classes")
        .select(
          "id, title, day_of_week, start_time, end_time, location_id, locations(name), coach_id, colour, capacity, is_active, deactivated_at, class_categories(default_capacity)"
        ),
      supabase.from("coaches").select("id, profiles(full_name)"),
      supabase.from("class_rates").select("class_id, effective_from, paid_coach_id"),
      supabase
        .from("lesson_sessions")
        .select("id, class_id, session_date, off_schedule_reason, cancelled_at, cancellation_reason")
        .gte("session_date", range.from)
        .lte("session_date", range.to),
      // No is_active filter: the SPAN decides who was expected on a date
      // (the engine loads enrolments the same way, core.ts).
      supabase
        .from("student_class_enrolments")
        .select("student_id, class_id, enrolled_at, unenrolled_at, students(full_name)"),
      supabase
        .from("trial_bookings")
        .select("student_id, class_id, session_date, cancelled_at, students(full_name)")
        .gte("session_date", range.from)
        .lte("session_date", range.to)
        .is("cancelled_at", null),
      supabase
        .from("makeup_bookings")
        .select("student_id, class_id, session_date, cancelled_at, students(full_name)")
        .gte("session_date", range.from)
        .lte("session_date", range.to)
        .is("cancelled_at", null),
      supabase
        .from("class_shadow_coaches")
        .select("class_id, coach_id, effective_from, effective_to"),
      supabase
        .from("tenant_public_holidays")
        .select("holiday_date, name")
        .gte("holiday_date", range.from)
        .lte("holiday_date", range.to),
    ]);

  const firstErr =
    classesRes.error ?? coachesRes.error ?? ratesRes.error ?? sessionsRes.error ??
    enrolRes.error ?? trialsRes.error ?? makeupsRes.error ?? shadowsRes.error ?? holidaysRes.error;
  if (firstErr) return { ok: false, error: firstErr.message };

  const sessions = (sessionsRes.data ?? []) as BuildInput["sessions"];
  if (sessions.length >= ROW_LIMIT || (enrolRes.data ?? []).length >= ROW_LIMIT) {
    return {
      ok: false,
      error:
        "Too many records to show reliably (1000+ lessons in this range, or 1000+ enrolments) — narrow the range.",
    };
  }

  // Attendance + substitutes by session id, in ≤200-id chunks (URL length).
  const sessionIds = sessions.map((s) => s.id);
  const attendance: CalendarAttendance[] = [];
  const substitutes: SubstituteRow[] = [];
  for (const ids of chunk(sessionIds, 200)) {
    const [attRes, subRes] = await Promise.all([
      supabase.from("attendance").select("lesson_session_id, student_id, status").in("lesson_session_id", ids),
      supabase.from("session_coaches").select("lesson_session_id, coach_id").in("lesson_session_id", ids),
    ]);
    if (attRes.error) return { ok: false, error: attRes.error.message };
    if (subRes.error) return { ok: false, error: subRes.error.message };
    attendance.push(...((attRes.data ?? []) as CalendarAttendance[]));
    substitutes.push(...((subRes.data ?? []) as SubstituteRow[]));
  }

  // Absences only matter for coaches who shadow a class — keyed on that
  // handful, never on the lesson ids (same reasoning as the Attendance page).
  const shadows = (shadowsRes.data ?? []) as BuildInput["shadows"];
  let absences: BuildInput["absences"] = [];
  const shadowCoachIds = [...new Set(shadows.map((s) => s.coach_id))];
  if (shadowCoachIds.length > 0) {
    const { data, error } = await supabase
      .from("session_coach_absences")
      .select("lesson_session_id, coach_id")
      .in("coach_id", shadowCoachIds);
    if (error) return { ok: false, error: error.message };
    absences = (data ?? []) as BuildInput["absences"];
  }

  const classes: CalendarClass[] = (classesRes.data ?? []).map((c: any) => ({
    id: c.id,
    title: c.title,
    day_of_week: c.day_of_week as DayOfWeek,
    start_time: c.start_time,
    end_time: c.end_time,
    location_name: c.locations?.name ?? "",
    coach_id: c.coach_id,
    colour: c.colour ?? null,
    capacity: c.capacity ?? null,
    category_default_capacity: c.class_categories?.default_capacity ?? null,
    is_active: c.is_active !== false,
    deactivated_at: c.deactivated_at ?? null,
  }));

  const coachOptions = ((coachesRes.data ?? []) as any[])
    .map((c) => ({ id: c.id as string, name: (c.profiles?.full_name as string) ?? "Unknown coach" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const coachNames = new Map(coachOptions.map((c) => [c.id, c.name]));

  const enrolments: BuildInput["enrolments"] = ((enrolRes.data ?? []) as any[]).map((e) => ({
    student_id: e.student_id,
    class_id: e.class_id,
    enrolled_at: e.enrolled_at,
    unenrolled_at: e.unenrolled_at ?? null,
    full_name: e.students?.full_name ?? "Unknown",
  }));

  const bookings: BuildInput["bookings"] = [
    ...((trialsRes.data ?? []) as any[]).map((b) => ({
      kind: "trial" as const,
      student_id: b.student_id,
      class_id: b.class_id,
      session_date: b.session_date,
      cancelled_at: b.cancelled_at ?? null,
      full_name: b.students?.full_name ?? "Unknown",
    })),
    ...((makeupsRes.data ?? []) as any[]).map((b) => ({
      kind: "makeup" as const,
      student_id: b.student_id,
      class_id: b.class_id,
      session_date: b.session_date,
      cancelled_at: b.cancelled_at ?? null,
      full_name: b.students?.full_name ?? "Unknown",
    })),
  ];

  return {
    ok: true,
    data: {
      classes,
      sessions,
      enrolments,
      bookings,
      attendance,
      substitutes,
      classRates: (ratesRes.data ?? []) as BuildInput["classRates"],
      shadows,
      absences,
      coachNames,
      holidays: (holidaysRes.data ?? []) as BuildInput["holidays"],
      coachOptions,
    },
  };
}
