import type { DayOfWeek } from "@/lib/lessonDates";

export type Booking = {
  id: string;
  session_date: string;
  student_id: string;
  student_name: string;
  class_title: string;
  marked: boolean;
};

export type ClassRow = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  category_id: string;
};

export type EligibleKid = {
  id: string;
  full_name: string;
  /** EVERY class the child is in. Since Wave 2 (`20260811000100`) a make-up
   *  needs to know WHICH of them it replaces — book_makeup() refuses to guess
   *  once there is more than one, because the class it picked would price the
   *  invoice line and decide package coverage. */
  home_classes: { id: string; title: string; category_id: string }[];
};

export type LivePackage = {
  parent_id: string;
  category_id: string | null;
  expires_on: string;
  live_lessons_remaining: number;
};
