// Postgres function calls for the Trials page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. book_trial() returns plain sentences for its refusals (already
// enrolled, holds a package, wrong weekday) that the page shows as-is — this
// layer must not pre-empt, default, or reshape them. The admin client is
// untyped, so every args type has all keys REQUIRED.
import { supabase } from "@/lib/supabase";

export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}

export type BookTrialArgs = {
  p_class_id: string;
  p_session_date: string;
  p_student_id: string;
};
export function bookTrial(args: BookTrialArgs) {
  return supabase.rpc("book_trial", args);
}

export type AddUnclaimedStudentArgs = {
  p_class_id: string;
  p_full_name: string;
  p_kind: "trial";
  p_session_date: string;
  p_contact_phone: string | null;
  p_contact_email: string | null;
};
export function addUnclaimedStudent(args: AddUnclaimedStudentArgs) {
  return supabase.rpc("add_unclaimed_student", args);
}

export type CancelTrialBookingArgs = { p_booking_id: string };
export function cancelTrialBooking(args: CancelTrialBookingArgs) {
  return supabase.rpc("cancel_trial_booking", args);
}
