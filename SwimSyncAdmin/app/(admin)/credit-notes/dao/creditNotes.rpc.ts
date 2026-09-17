// Postgres function + edge function calls for the Credit Notes page.
// ⚠ ORCHESTRATE, NEVER REPLACE: each wrapper passes its arguments THROUGH and
// computes nothing. void_credit_note re-checks authority + already-reversed and
// reopens any drawn invoice server-side; credit-note-emails re-checks authority
// and refuses an applied note on its own. This layer must not pre-empt, default,
// or reshape them. The admin client is untyped, so every args type has all keys
// REQUIRED.
import { supabase } from "@/lib/supabase";

// Payment-method chips: fire-and-forget, a failed RPC only means no chips.
export function studentPackageCoverage() {
  return supabase.rpc("student_package_coverage");
}

export type VoidCreditNoteArgs = { p_note_id: string; p_reason: string };
export function voidCreditNote(args: VoidCreditNoteArgs) {
  return supabase.rpc("void_credit_note", args);
}

export function resendCreditNoteEmail(creditNoteId: string) {
  return supabase.functions.invoke(
    "credit-note-emails",
    { body: { credit_note_id: creditNoteId } }
  );
}
