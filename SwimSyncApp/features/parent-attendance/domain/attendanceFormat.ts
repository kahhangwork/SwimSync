// The parent Attendance tab's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-H):
// the filter, the formatters and every row mapping loadAttendance / loadChildren
// did inline — moved VERBATIM out of app/(parent)/attendance/index.tsx and pinned
// by attendanceFormat.test.ts. No clock (`today` is always passed in), no client.
import {
  toSgDate,
  expectedLessonDates,
  formatSgStamp,
  type DayOfWeek,
} from "@/lib/lessonDates";
import type { DbStatus, FilterOption, AttendanceRecord, Child } from "../types";

export function matchesFilter(status: DbStatus, filter: FilterOption): boolean {
  if (filter === "All") return true;
  if (filter === "Present") return status === "present";
  if (filter === "Absent") return status === "absent";
  if (filter === "Cancelled") return status === "cancelled_rain" || status === "cancelled_coach";
  if (filter === "Trial") return status === "trial_paid" || status === "trial_free";
  return true;
}

export function formatDate(dateStr: string): string {
  return formatSgStamp(dateStr, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// 24h "17:00:00" → "5:00 PM". Same shape the parent home screen uses.
export function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function timeLabel(start: string | null, end: string | null): string {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s} – ${e}`;
  return s ?? "";
}

export function childrenOf(links: any[] | null): Child[] {
  return (links ?? []).map((l: any) => ({
    id: l.students.id,
    full_name: l.students.full_name,
    assignment_status: l.students.assignment_status,
    is_active: l.students.is_active,
  }));
}

export function recordsOf(data: any[] | null): AttendanceRecord[] {
  return (data ?? [])
    .map((a: any) => ({
      id: a.id,
      status: a.status as DbStatus,
      session_date: a.lesson_sessions?.session_date ?? "",
      class_title: a.lesson_sessions?.classes?.title ?? "Class",
    }))
    .sort((a: AttendanceRecord, b: AttendanceRecord) =>
      b.session_date.localeCompare(a.session_date)
    );
}

/** Each active enrolment paired with its (to-one) class, normalised. */
export function activeClassesOf(enrolments: any[] | null): { enr: any; cls: any }[] {
  return (enrolments ?? []).map((enr: any) => ({
    enr,
    cls: Array.isArray(enr.classes) ? enr.classes[0] : enr.classes,
  }));
}

/** Has any lesson fallen due since this child joined (ANY active enrolment)? */
export function hasExpectedLessonOf(activeClasses: { enr: any; cls: any }[], today: string): boolean {
  return activeClasses.some(({ enr, cls }) => {
    const day = cls?.day_of_week as DayOfWeek | undefined;
    return (
      !!day &&
      !!enr.enrolled_at &&
      expectedLessonDates(day, toSgDate(enr.enrolled_at), today).length > 0
    );
  });
}

export function enrolmentInputsOf(activeClasses: { enr: any; cls: any }[]) {
  return activeClasses
    .filter(({ cls }) => cls?.day_of_week && cls?.title)
    .map(({ cls }, i) => ({
      class_id: (cls.id as string) ?? `enr-${i}`,
      day_of_week: cls.day_of_week as DayOfWeek,
      class_title: cls.title as string,
      time_label: timeLabel(cls.start_time ?? null, cls.end_time ?? null),
    }));
}

export function makeupInputsOf(makeupRows: any[] | null) {
  return (makeupRows ?? []).map((m: any) => {
    const c = Array.isArray(m.classes) ? m.classes[0] : m.classes;
    return {
      // Fall back to the booking id (never null) rather than a shared literal,
      // so two same-date make-ups with an unreadable host class do not collapse
      // to one dedup key.
      class_id: (c?.id as string) ?? `makeup:${m.id}`,
      class_title: (c?.title as string) ?? "another class",
      session_date: m.session_date as string,
      time_label: timeLabel(c?.start_time ?? null, c?.end_time ?? null),
    };
  });
}

export function extraInputsOf(extraRows: any[] | null) {
  return (extraRows ?? []).map((s: any) => {
    const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    return {
      class_id: s.class_id as string,
      class_title: (c?.title as string) ?? "Extra lesson",
      session_date: s.session_date as string,
      time_label: timeLabel(s.start_time ?? null, s.end_time ?? null),
    };
  });
}

export function cancelledInputsOf(cancelledRows: any[] | null) {
  return (cancelledRows ?? []).map((s: any) => {
    const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    return {
      class_id: s.class_id as string,
      class_title: (c?.title as string) ?? "Lesson",
      session_date: s.session_date as string,
      time_label: timeLabel(s.start_time ?? null, s.end_time ?? null),
      reason: (s.cancellation_reason as string | null) ?? null,
    };
  });
}
