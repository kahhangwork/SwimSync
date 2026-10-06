import type { DayOfWeek } from "@/lib/lessonDates";
import type { PickerClassRow, PickerCoachRow } from "../dao/substitutes.repo";

// Pure normalisation of the PostgREST picker rows, lifted verbatim from the
// page's loadPickers so the nested-join flattening can be characterised alone.

export type ClassRow = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  coach_id: string;
  coach_name: string;
  is_active: boolean;
};

export type Coach = { id: string; name: string };

/** Flatten `classes(coaches(profiles(full_name)))` — PostgREST returns the
 *  embed as either an object or a one-element array depending on the relation. */
export function mapClasses(rows: PickerClassRow[]): ClassRow[] {
  return rows.map((c) => {
    const coach = Array.isArray(c.coaches) ? c.coaches[0] : c.coaches;
    const prof = Array.isArray(coach?.profiles) ? coach.profiles[0] : coach?.profiles;
    return {
      id: c.id,
      title: c.title,
      day_of_week: c.day_of_week,
      coach_id: c.coach_id,
      coach_name: prof?.full_name ?? "Unknown coach",
      is_active: c.is_active,
    };
  });
}

export function mapCoaches(rows: PickerCoachRow[]): Coach[] {
  return rows.map((c) => {
    const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    return { id: c.id, name: prof?.full_name ?? "Unknown coach" };
  });
}
