import type { CsvColumn } from "@/lib/csv";
import { toSgDate } from "@/lib/lessonDates";
import type { CreditNoteRow, EmailDeliveryState } from "../types";
import type { NoteSelectRow } from "../dao/creditNotes.repo";

// A note voided by an un-correction (status 'reversed', 20260818000100) must NOT
// read as "Available" — it is no longer live credit. One helper so the label, the
// filter, the sort and the CSV all agree.
export function creditNoteStatusLabel(status: string): string {
  if (status === "applied") return "Applied";
  if (status === "reversed") return "Reversed";
  return "Available";
}

// CSV export — what's on screen (post-filter/sort). Amounts raw for summing;
// the linked invoice is exported as the full id (the table truncates it), date
// is the raw YYYY-MM-DD, and "Emailed" reflects whether the parent was notified.
export const CREDIT_NOTE_CSV_COLUMNS: CsvColumn<CreditNoteRow>[] = [
  { header: "Reference", value: (r) => r.reference_number },
  { header: "Student", value: (r) => r.student_name },
  { header: "Parent", value: (r) => r.parent_name },
  { header: "Amount", value: (r) => r.amount },
  { header: "Reason", value: (r) => r.reason },
  { header: "Linked Invoice", value: (r) => r.linked_invoice_id },
  { header: "Date", value: (r) => r.created_at },
  { header: "Status", value: (r) => creditNoteStatusLabel(r.status) },
  { header: "Emailed", value: (r) => (r.email_sent_at ? "yes" : "no") },
];

/** One credit_notes row (with its embeds) -> the table's row. */
export function toCreditNoteRow(cn: NoteSelectRow): CreditNoteRow {
  return {
    id: cn.id,
    reference_number: cn.reference_number,
    student_id: cn.students?.id ?? "",
    student_name: cn.student_name ?? cn.students?.full_name ?? "—",
    parent_name: cn.parents?.profiles?.full_name ?? "—",
    amount: Number(cn.amount),
    reason: cn.reason,
    linked_invoice_id: cn.applied_to_invoice_id,
    // The SINGAPORE date of the timestamptz — `.split("T")[0]` was its UTC date,
    // a day early for anything issued 00:00–07:59 SGT (Bug ledger #3, §7.7).
    // Guarded: toSgDate(null) is "1970-01-01" and an empty value throws.
    created_at: cn.issued_at ? toSgDate(cn.issued_at) : "—",
    status: cn.status,
    email_sent_at: cn.email_sent_at ?? null,
    // The computed column is always selected; the fallback only guards a row
    // shaped by hand (tests, or a select that forgot it).
    email_state:
      // census: ui-cast (Wave 8) — the computed column types as `string`; its SQL,
      // email_delivery_state(), returns exactly the EmailDeliveryState values.
      (cn.credit_note_email_state as EmailDeliveryState | null) ??
      (cn.email_sent_at ? "SENT" : "UNSENT"),
    tenant_id: cn.tenant_id,
    applied_to_invoice_id: cn.applied_to_invoice_id ?? null,
    has_applications: (cn.credit_applications ?? []).some(
      (a: { reversed_at: string | null }) => a.reversed_at === null
    ),
  };
}

// Resend one note's notification. The edge function re-checks authority and
// refuses an applied note on its own; this only stops a doomed press.
/** Human copy for the reasons the function can return. */
export function resendReasonLabel(reason: string): string {
  switch (reason) {
    case "already-applied":
      return "That credit has already been used on an invoice.";
    case "invoice-line-already-emailed":
      return "This lesson's credit was already emailed.";
    case "no-snapshot":
      return "That credit note is missing its invoice details.";
    case "tenant suspended":
      return "This business is suspended, so no email was sent.";
    case "not allowed":
      return "You do not administer this business.";
    default:
      return reason;
  }
}
