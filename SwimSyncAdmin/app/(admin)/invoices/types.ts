/** The one column the scoped search targets — pushed into the DB as a bound
 *  `.ilike`, so it reaches every invoice, not just the first 1000. */
export type SearchField = "parent" | "student";

export type InvoiceRow = {
  id: string;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  /** A prior-period DEBIT (voided-then-paid credit) folded onto this invoice —
   *  net = gross − package − credit + balance_adjustment. */
  balance_adjustment: number;
  net_amount: number;
  status: string;
  parent_name: string;
  student_names: string; // first invoice item's student name(s)
  reference_number: string;
  public_token: string;
  /** When the admin last OPENED a WhatsApp chat for this invoice. It does
   *  not prove a message was sent — copy must read "chat opened". */
  reminded_at: string | null;
  /** The parent's "I've paid" claim — check the bank, then confirm. */
  paid_claimed_at: string | null;
  /** wa.me-ready "65XXXXXXXX", or null → the button reads "no number". */
  wa_number: string | null;
  /** What the parent actually typed — the queue's advisory when unusable. */
  raw_phone: string | null;
  student_name_list: string[];
};

/** Mirrors GenerateResult.unclaimed_students in the billing engine. */
export type UnclaimedStudent = {
  student_id: string;
  student_name: string | null;
  lessons: number;
  earliest_session_date: string;
  latest_session_date: string;
};

/** Mirrors unbilled_sealed_lessons() in the database — one line per
 *  (student, SEALED month). Same shape as UnclaimedStudent plus the month,
 *  because the admin needs the same thing in both places: enough to date a
 *  settlement. These lessons entered the month AFTER it was billed (backdated
 *  enrolment, backdated make-up, absent→present correction), so the engine can
 *  never see them — this standing report is the only thing that can. */
export type OrphanLine = UnclaimedStudent & { billing_month: string };

/** A parent's pending DEBIT — money owed from a voided-then-paid credit that has
 *  not yet been folded onto an invoice (§8.83). Keyed by (parent_id, tenant_id):
 *  a parent enrolled at two tenants has two balance rows, and this view is scoped
 *  to the admin's own tenant so tenant B's debit never attaches to tenant A. */
export type PendingDebit = {
  parent_id: string;
  tenant_id: string;
  parent_name: string;
  debit_balance: number;
};
