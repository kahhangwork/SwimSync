// The Child Profile screen's entity type (docs/refactor/BATCH_FGH_PLAN.md, App L-F) —
// moved verbatim from app/(parent)/home/child/[id].tsx, comments included.
import type { GradeLevel, LevelSkill } from "@/lib/skillProgress";

export type ChildDetail = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  level_label: string | null;
  level_note: string | null;
  /** Skills of the CURRENT level, with ids so grades can be paired to them. */
  level_skills: LevelSkill[];
  /** skill_id → grade_level_id, this child's grades on the current level. */
  skill_grades: Record<string, string>;
  /** The business's grade scale, for the "n of m at <top>" computation. */
  scale: GradeLevel[];
  notes: string | null;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
  /** EVERY class, not "the" class — a child may hold several active enrolments
   *  since Wave 2 (`20260811000100`). This screen is where a parent goes to
   *  check the detail, so showing one of two is the worst of both. */
  classes: {
    coach_name: string | null;
    day: string | null;
    time: string | null;
    location: string | null;
    /** The location's street address + notes, shown so a parent knows where to
     *  go and any access detail (parking, which gate). From the entity. */
    location_address: string | null;
    location_notes: string | null;
  }[];
  outstanding_amount: number;
  credit_balance: number;
};
