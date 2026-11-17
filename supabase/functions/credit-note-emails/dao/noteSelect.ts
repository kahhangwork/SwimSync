// The credit-note select list, moved verbatim out of core.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md
// B12) — a column list is a dao concern. core.ts re-exports it for the tests.

// ⚠ RISK 6 — snapshot fields ONLY. credit_notes.student_name is the note's own
// snapshot; class_title and session_date come from invoice_items, snapshotted at
// invoicing. §7.155: a resend weeks later must render what the invoice said, not what
// the records say now.
// PROHIBITION: this string must NOT grow students(full_name), classes(title), or
// lesson_sessions(session_date).
// ONE literal, never `+`-joined: a concatenation widens to `string` and loses the row
// type (§7.106). credit_note_email_state is a PostgREST computed column (20260927000100):
// the email state, computed in SQL so no lease maths happens in Deno.
export const NOTE_SELECT =
  "id, reference_number, amount, reason, status, applied_to_invoice_id, tenant_id, parent_id, invoice_item_id, lesson_session_id, student_name, invoice_items(class_title, session_date), parents(profiles(full_name, email)), tenants(display_name, logo_url), credit_note_email_state";
