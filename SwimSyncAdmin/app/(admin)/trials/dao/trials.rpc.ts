// Postgres function calls for the Trials page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. book_trial() returns plain sentences for its refusals (already
// enrolled, holds a package, wrong weekday) that the page shows as-is — this
// layer must not pre-empt, default, or reshape them. Every args type is
// hand-written with all keys REQUIRED, and asserted against the generated Args
// so a renamed param is a compile error (§7.345).
import { supabase } from "@/lib/supabase";
import type { Assert, Extends, Rpc } from "@/lib/database.overrides";

export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}

export type BookTrialArgs = {
  p_class_id: string;
  p_session_date: string;
  p_student_id: string;
};
type _CheckBookTrial = Assert<Extends<BookTrialArgs, Rpc<"book_trial">["Args"]>>;
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
type _CheckAddUnclaimed = Assert<Extends<AddUnclaimedStudentArgs, Rpc<"add_unclaimed_student">["Args"]>>;
export function addUnclaimedStudent(args: AddUnclaimedStudentArgs) {
  return supabase.rpc("add_unclaimed_student", args);
}

export type CancelTrialBookingArgs = { p_booking_id: string };
type _CheckCancelTrial = Assert<Extends<CancelTrialBookingArgs, Rpc<"cancel_trial_booking">["Args"]>>;
export function cancelTrialBooking(args: CancelTrialBookingArgs) {
  return supabase.rpc("cancel_trial_booking", args);
}
