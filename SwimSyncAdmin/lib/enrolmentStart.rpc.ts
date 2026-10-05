// The "Starts on" Postgres functions (20261005000100). Business logic lives in
// Postgres — surface its refusals verbatim; never reimplement a rule here.
//
// FAILURE MODE: `permission denied` (a grant gap on the cloud, §7.39) or the
// function's own sentence (future start, below the floor, already in the class,
// a later start past a marked lesson). Return the raw `{ data, error }`.

import { supabase } from "./supabase";

export type EnrolmentMode = "add" | "change";

/** { floor, today, last_sealed_month, day_of_week } for the picker. */
export const fetchStartBounds = (classId: string) =>
  supabase.rpc("enrolment_start_bounds", { p_class_id: classId });

/**
 * Add a child to a class (mode "add") or change an active enrolment's start
 * (mode "change"). `startsOn` null = today. The mode is EXPLICIT — "add" on a
 * class the child is already in is refused, never turned into an edit (RISK 2).
 */
export const setEnrolmentStart = (
  studentId: string,
  classId: string,
  startsOn: string | null,
  mode: EnrolmentMode
) =>
  supabase.rpc("set_enrolment_start", {
    p_student_id: studentId,
    p_class_id: classId,
    p_starts_on: startsOn,
    p_mode: mode,
  });
