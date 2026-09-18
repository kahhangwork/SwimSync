// Postgres functions the admin lesson page calls — every `.rpc()`, and nothing
// else. Stages 3–5 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. Each function is one `.rpc()` returning the raw
// `{ data, error }`. Every rule (future-only cancel, no guests, sealed month,
// capacity, the rate-paid coach refusal) is the FUNCTION's, and the page
// RENDERS its message rather than pre-empting it (§7.32: a limit only the admin
// screen applies is not a limit). Never re-implement one of those checks here
// or in domain/ to "save a round trip" — a client copy drifts from the guard.
//
// dao/ is transport only: no React, no ui/, no @/components (fence check 2).

import { supabase } from "@/lib/supabase";

/** Advance-cancel the whole lesson, with the reason parents and the coach see. */
export function cancelLesson(classId: string, date: string, reason: string) {
  return supabase.rpc("cancel_lesson", { p_class_id: classId, p_date: date, p_reason: reason });
}

export function restoreLesson(classId: string, date: string) {
  return supabase.rpc("restore_lesson", { p_class_id: classId, p_date: date });
}
