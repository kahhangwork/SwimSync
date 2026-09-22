// The marking screen's entity types (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/classes/[id]/attendance.tsx, comments included.

// "holiday" is READ-ONLY here: a public-holiday void is set by the tenant admin
// (mark_day_holiday) and the DB guard refuses a coach touching it. The coach sees
// it, never sets it — so it is excluded from the settable buttons, "Set all", the
// save validation, and the save payload below.
export type TopStatus = "unmarked" | "present" | "absent" | "cancelled" | "trial" | "holiday";
export type DBStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free"
  | "holiday";

export type StudentRow = {
  id: string;
  full_name: string;
  /** On this roster because of an attendance row or a booking, not an
   *  enrolment. */
  attendedOnly?: boolean;
  /** Booked for a trial on this date specifically. */
  isTrial?: boolean;
  /** Booked for a make-up on this date specifically — enrolled elsewhere,
   *  guesting for one lesson. Ordinary statuses only. */
  isMakeup?: boolean;
};

export type AttState = {
  top: TopStatus;
  sub: string | null; // "rain"|"coach" for cancelled; "paid"|"free" for trial
};

// `existingId` used to live here, carrying the attendance row's primary key so
// the save could "update in place". It never did that — onConflict on
// (lesson_session_id, student_id) is what matches an existing row — and sending
// the PK is what broke every partially-marked lesson (§7.67). Removed rather
// than left unused, so nothing puts `id` back in the payload.
