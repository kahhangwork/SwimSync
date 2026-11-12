// The public tokenized invoice page's entity type (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G) — moved verbatim from app/invoice/[token].tsx.

export interface PublicInvoice {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  amount: number;
  billing_month: string;
  status: string;
  paid_claimed_at: string | null;
  /** "YYYY-MM-DD" (SGT) — public-invoice v3 (20261112000100). */
  due_date: string;
  /** The database's verdict, served by public-invoice — never derived here. */
  is_overdue: boolean;
  students: string[];
}
