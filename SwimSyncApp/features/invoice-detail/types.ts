// The parent Invoice Detail screen's entity types (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G) — moved verbatim from app/(parent)/billing/invoice/[id].tsx.

export type InvoiceItem = {
  id: string;
  student_name: string;
  class_title: string;
  session_date: string;
  attendance_status: string;
  amount: number;
  /** The package that funded this line (its snapshotted name), or null for an
   *  ad-hoc line. From the package_applications ledger — a reversed draw
   *  reads as ad hoc, because that money went back to the package. */
  funded_by: string | null;
};

export type CreditNoteApplied = {
  id: string;
  reference_number: string;
  amount: number;
  reason: string | null;
};

export type InvoiceDetail = {
  id: string;
  /** `INV-YYYY-NNNN` — what the QR, the reminder and the bank statement say.
   *  Null only for rows written before the reference trigger existed. */
  reference_number: string | null;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  balance_adjustment: number;
  net_amount: number;
  status: "outstanding" | "paid";
  generated_at: string;
  paid_at: string | null;
  paid_claimed_at: string | null;
  items: InvoiceItem[];
  credit_notes: CreditNoteApplied[];
  coach_id: string | null;
  /** The business that issued this invoice — a parent may hold two for the
   *  same month, one per business, and the totals alone don't say which. */
  business_name: string;
};
