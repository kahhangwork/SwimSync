// The public tokenized package-offer page's entity type (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G) — moved verbatim from app/package/[token].tsx.

export interface PublicPackage {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  // amount is what's PAYABLE (discounted); total_value is the package's worth.
  amount: number;
  total_value: number;
  discount_amount: number;
  package_name: string;
  lesson_count: number;
  rate: number;
  start_date: string | null;
  valid_until_preview: string | null;
  status: string;
  paid_claimed_at: string | null;
}
