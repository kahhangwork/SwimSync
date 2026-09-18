// Entity types for the admin lesson page (lessons/[classId]/[date]). Feature
// root, not lib/ — shared by this route's dao/, domain/ and ui/ only.

import type { DayOfWeek } from "@/lib/lessonDates";
import type { DbStatus, RosterKind } from "./domain/lessonMarking";

export type ClassInfo = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  location_name: string;
  coach_id: string;
  category_id: string;
  colour: string | null;
  capacity: number | null;
  is_active: boolean;
  deactivated_at: string | null;
};

export type RosterRow = {
  studentId: string;
  name: string;
  kind: RosterKind;
  /** The booking id for a guest (to cancel it). */
  bookingId: string | null;
  /** False for a marked row whose child is no longer expected (left the class). */
  expected: boolean;
  prev: DbStatus | null;
};

export type CoachOpt = { id: string; name: string };

export type EligibleKid = {
  id: string;
  full_name: string;
  home_classes: { id: string; title: string; category_id: string }[];
  home_class_titles: string[];
};
