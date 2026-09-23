// The coach Classes tab's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-H): the
// time formatter and the class-row mapping, moved VERBATIM out of
// app/(coach)/classes/index.tsx and pinned by classesFormat.test.ts.
import type { CoachClass } from "../types";

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function classesOf(data: any[] | null): CoachClass[] {
  return (data ?? []).map((cls: any) => ({
    id: cls.id,
    title: cls.title,
    day_of_week: cls.day_of_week,
    start_time: cls.start_time,
    end_time: cls.end_time,
    location_id: cls.location_id,
    location_name: cls.locations?.name ?? "—",
    price_per_lesson: Number(cls.price_per_lesson),
    student_count: (cls.student_class_enrolments ?? []).filter(
      (e: any) => e.is_active
    ).length,
  }));
}
