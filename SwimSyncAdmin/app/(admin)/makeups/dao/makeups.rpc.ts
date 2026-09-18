// Postgres function calls for the Make-ups page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. book_makeup() holds every refusal (wrong category, own class, wrong
// weekday, an already-billed month, a multi-class child with no home named) and
// answers in plain sentences the page shows as-is — this layer must not
// pre-empt, default, or reshape them. The admin client is untyped, so every
// args type has all keys REQUIRED.
import { supabase } from "@/lib/supabase";

export function packageLiveBalances() {
  return supabase.rpc("package_live_balances");
}

export type BookMakeupArgs = {
  p_class_id: string;
  p_session_date: string;
  p_student_id: string;
  /** Named, never derived, once the child has more than one class. NULL is
   *  fine for a single-class child and the RPC derives it there. */
  p_home_class_id: string | null;
};
export function bookMakeup(args: BookMakeupArgs) {
  return supabase.rpc("book_makeup", args);
}

export type CancelMakeupBookingArgs = { p_booking_id: string };
export function cancelMakeupBooking(args: CancelMakeupBookingArgs) {
  return supabase.rpc("cancel_makeup_booking", args);
}
