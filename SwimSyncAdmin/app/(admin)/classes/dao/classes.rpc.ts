// Postgres function calls for the Classes page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. The RPCs enforce the real rules (admin-gating, effective-dating,
// the retire refusals); this layer must not pre-empt, default, or reshape them.
//
// ⚠ RISK 1 — REQUIRED KEYS. Until Wave 8 the admin client was untyped, so a
// dropped, renamed or DEFAULTED key typechecked clean and silently mis-billed or
// mis-paid. The client is now typed with the generated `Database`, but generated
// Args make every DEFAULTed param OPTIONAL (§7.345) — so every wrapper below keeps
// its explicit args type with all keys REQUIRED (nullable where the server accepts
// null, never optional), and an `_Check` asserts it still fits the generated Args:
// a renamed param is a compile error, a dropped key is too.
import { supabase } from "@/lib/supabase";
import type { Assert, Enums, Extends, Rpc } from "@/lib/database.overrides";

// Fire-and-forget from the roster load: a failed RPC only means no chips.
export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}

export type AssignClassShadowArgs = {
  p_class_id: string;
  p_coach_id: string;
  p_effective_from: string | null;
};
type _CheckAssignClassShadowArgs = Assert<Extends<AssignClassShadowArgs, Rpc<"assign_class_shadow">["Args"]>>;
export function assignClassShadow(args: AssignClassShadowArgs) {
  return supabase.rpc("assign_class_shadow", args);
}

// ⚠ END, never DELETE. The row is what says the coach was assigned on the dates
// it covers, and pay re-reads that for every already-paid lesson — deleting it
// would claw back money genuinely earned. `p_effective_to: null` means "today"
// server-side; dropping the key is a DIFFERENT call, so it is required here.
export type EndClassShadowArgs = {
  p_class_id: string;
  p_coach_id: string;
  p_effective_to: string | null;
};
type _CheckEndClassShadowArgs = Assert<Extends<EndClassShadowArgs, Rpc<"end_class_shadow">["Args"]>>;
export function endClassShadow(args: EndClassShadowArgs) {
  return supabase.rpc("end_class_shadow", args);
}

// ⚠ set_class_terms, never a bare UPDATE. Price and coach are EFFECTIVE-DATED in
// class_rates (20260719000700); the RPC writes classes + class_rates in one
// transaction so schedule and billing terms cannot disagree. All 12 keys are
// required: `p_correct_in_place` decides whether history is rewritten (a
// correction) or a new period starts today (a change); `p_effective_from` is
// `null` for a correction; `p_location_name`/`p_location_address` are sent so
// the free-text columns agree with the FK through the expand window (RISK 1/1b).
// Defaulting any of these mis-values past lessons. The wrapper computes NONE of
// them — `p_effective_from`'s "correction ? null : today" ternary is HOOK
// logic (RISK 6: the dao reads no clock; the SGT date is computed by the caller).
export type SetClassTermsArgs = {
  p_class_id: string;
  p_title: string;
  p_day_of_week: Enums<"day_of_week">;
  p_start_time: string;
  p_end_time: string;
  p_location_name: string;
  p_price_per_lesson: number;
  p_coach_id: string;
  p_effective_from: string | null;
  p_correct_in_place: boolean;
  p_location_address: string | null;
  p_location_id: string;
};
type _CheckSetClassTermsArgs = Assert<Extends<SetClassTermsArgs, Rpc<"set_class_terms">["Args"]>>;
export function setClassTerms(args: SetClassTermsArgs) {
  return supabase.rpc("set_class_terms", args);
}

export type ScheduleExtraLessonArgs = {
  p_class_id: string;
  p_date: string;
  p_reason: string;
};
type _CheckScheduleExtraLessonArgs = Assert<Extends<ScheduleExtraLessonArgs, Rpc<"schedule_extra_lesson">["Args"]>>;
export function scheduleExtraLesson(args: ScheduleExtraLessonArgs) {
  return supabase.rpc("schedule_extra_lesson", args);
}

export type CancelLessonArgs = {
  p_class_id: string;
  p_date: string;
  p_reason: string;
};
type _CheckCancelLessonArgs = Assert<Extends<CancelLessonArgs, Rpc<"cancel_lesson">["Args"]>>;
export function cancelLesson(args: CancelLessonArgs) {
  return supabase.rpc("cancel_lesson", args);
}

export function deactivateClass(args: { p_class_id: string }) {
  return supabase.rpc("deactivate_class", args);
}

// ⚠ Cannot refuse, and must never grow a refusal — it is the only exit from a
// class blocking a billing month while being invisible everywhere else.
export function reactivateClass(args: { p_class_id: string }) {
  return supabase.rpc("reactivate_class", args);
}
