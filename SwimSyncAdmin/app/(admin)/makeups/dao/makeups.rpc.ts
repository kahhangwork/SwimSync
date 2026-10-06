// Postgres function calls for the Make-ups page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. book_makeup() holds every refusal (wrong category, own class, wrong
// weekday, an already-billed month, a multi-class child with no home named) and
// answers in plain sentences the page shows as-is — this layer must not
// pre-empt, default, or reshape them. Every args type is hand-written with all
// keys REQUIRED, and asserted against the generated Args so a renamed param is
// a compile error (§7.345).
import { supabase } from "@/lib/supabase";
import type { Assert, DataOf, Extends, Rpc } from "@/lib/database.overrides";

export function packageLiveBalances() {
  return supabase.rpc("package_live_balances");
}
export type LiveBalanceRow = DataOf<typeof packageLiveBalances>[number];

export type BookMakeupArgs = {
  p_class_id: string;
  p_session_date: string;
  p_student_id: string;
  /** Named, never derived, once the child has more than one class. NULL is
   *  fine for a single-class child and the RPC derives it there. */
  p_home_class_id: string | null;
};
type _CheckBookMakeup = Assert<Extends<BookMakeupArgs, Rpc<"book_makeup">["Args"]>>;
export function bookMakeup(args: BookMakeupArgs) {
  return supabase.rpc("book_makeup", args);
}

export type CancelMakeupBookingArgs = { p_booking_id: string };
type _CheckCancelMakeup = Assert<Extends<CancelMakeupBookingArgs, Rpc<"cancel_makeup_booking">["Args"]>>;
export function cancelMakeupBooking(args: CancelMakeupBookingArgs) {
  return supabase.rpc("cancel_makeup_booking", args);
}
