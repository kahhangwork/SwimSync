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
  students: string[];
}
