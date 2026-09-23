// The coach Classes tab's entity type (docs/refactor/BATCH_FGH_PLAN.md, App L-H) —
// moved verbatim from app/(coach)/classes/index.tsx.

export type CoachClass = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location_id: string;
  location_name: string;
  price_per_lesson: number;
  student_count: number;
};
