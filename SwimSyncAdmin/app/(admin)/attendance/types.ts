import type { DayOfWeek } from "@/lib/lessonDates";

// Shared types for the Attendance page. Kept here (not in dao/) so ui/ may
// import them without crossing the ui -> dao boundary (tierBoundaries check 1).

export type AttendanceRow = {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_title: string;
  session_date: string;
  status: string;
  // The MONEY axis (§7.152): who was PAID for this lesson, never
  // classes.coach_id. Ids, not names — the filter and sort key on these so two
  // coaches sharing a name cannot collapse (RISK 9). Null main = the cell shows
  // "—", either because no rate resolved or because an attribution load failed
  // (RISK 6/7 — never a name we could not stand behind).
  main_coach_id: string | null;
  is_cover: boolean;
  shadow_coach_ids: string[];
};

/** A raw attendance row before money-axis attribution is folded in. */
export type RawAttendanceRow = {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_title: string;
  session_date: string;
  status: string;
  lesson_session_id: string;
};

// Make-up booking, from an absent/cancelled row. The missed lesson's class is
// the HOME class; the admin picks a same-category HOST class + date to guest into.
export type MakeupClass = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  category_id: string;
  is_active: boolean;
};
