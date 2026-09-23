// The parent Attendance tab's entity types (docs/refactor/BATCH_FGH_PLAN.md, App L-H) —
// moved verbatim from app/(parent)/attendance/index.tsx.

export type DbStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free"
  | "holiday";

export type FilterOption = "All" | "Present" | "Absent" | "Cancelled" | "Trial";

export type AttendanceRecord = {
  id: string;
  status: DbStatus;
  session_date: string;
  class_title: string;
};

export type Child = {
  id: string;
  full_name: string;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
};
