// The roster screen's entity types (COACH_ROSTER_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/classes/[id]/roster.tsx. `Guest` / `Extra`
// name the two inline shapes the screen's useState generics spelled out.
import type { LessonProgress } from "@/lib/attendanceSummary";

export type Student = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  level_label: string | null;
  level_note: string | null;
  level_skills: string[];
};

export type Session = {
  id: string | null; // null = the lesson should have happened but was never marked
  session_date: string;
  progress: LessonProgress;
  /** "3 present · 2 cancelled (rain)", or "" when nothing is recorded. */
  summary: string;
  /** Cancelled in advance by the admin (cancel_lesson) — nothing to mark. */
  cancelled?: boolean;
  cancelReason?: string | null;
};

export type ClassInfo = {
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location_name: string;
};

export type Guest = { id: string; full_name: string; session_date: string };

export type Extra = { id: string; session_date: string; reason: string };
