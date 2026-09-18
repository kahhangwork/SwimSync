import type { DayOfWeek } from "@/lib/lessonDates";

export type Booking = {
  id: string;
  session_date: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_title: string;
  marked: boolean;
};

export type ClassRow = { id: string; title: string; day_of_week: DayOfWeek };
export type Category = { id: string; name: string; rate: number | null };
