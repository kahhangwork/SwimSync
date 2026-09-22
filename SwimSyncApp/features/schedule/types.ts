// The Schedule tab's entity types (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/schedule/index.tsx, comments included.
import type { LessonProgress } from "@/lib/attendanceSummary";
import type { LessonRole } from "@/lib/coachRoster";

/** One lesson on one date — the unit every section renders. */
export type WeekLesson = {
  /** scheduleBuckets sorts on these two; the rest is for the card. */
  classId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  locationId: string | null;
  sessionId: string | null;
  progress: LessonProgress;
  summary: string;
  students: number;
  guests: number;
  /** Who is teaching it. `owner` unless an admin has rostered somebody. */
  role: LessonRole;
  /** Cancelled in advance by the admin — shown struck, never marked. */
  cancelled: boolean;
};

/** A lesson that should have happened but has no complete attendance. */
export type BacklogItem = {
  class_id: string;
  class_title: string;
  date: string;
  session_id: string | null;
  /** Only ever `partial` or `unmarked` — a complete lesson is not here. */
  progress: LessonProgress;
  summary: string;
};
