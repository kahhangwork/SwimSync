/** The one column the scoped search targets — pushed into the DB as a bound
 *  `.ilike` so it reaches every note, not just the first 1000. */
export type SearchField = "student" | "parent" | "reference";

export type CreditNoteRow = {
  id: string;
  reference_number: string;
  student_id: string;
  student_name: string;
  parent_name: string;
  amount: number;
  reason: string | null;
  linked_invoice_id: string | null;
  created_at: string;
  status: string; // "applied" | "available" | "reversed"
  // ── Email delivery (docs/plans/CREDIT_NOTE_EMAIL_PLAN.md) ──────────────────
  email_sent_at: string | null;
  tenant_id: string;
  applied_to_invoice_id: string | null;
  /** ⚠ RISK 2 — status stays 'available' while a note is PARTLY drawn down. Counts
   *  LIVE draws only (reversed_at IS NULL): a voided-then-reactivated note carries
   *  reversed rows that are no longer "spent", so counting them would wrongly block
   *  the resend AND read as drawn on the void confirm (Item 3, RISK 6). */
  has_applications: boolean;
};

/** ⚠ RISK 4 — the viewer's OWN role and tenant, never a value off a row. */
export type Viewer = {
  role: string | null;
  tenantId: string | null;
  adminDisabled: boolean;
};
