// The parent Billing tab's entity types (docs/refactor/BATCH_FGH_PLAN.md, App L-G) —
// moved verbatim from app/(parent)/billing/index.tsx, comments included.

export type Tab = "Invoices" | "Packages" | "Credit Notes";

export type Invoice = {
  id: string;
  /** `INV-YYYY-NNNN` — what the QR, the reminder and the bank statement say.
   *  Null only for rows written before the reference trigger existed. */
  reference_number: string | null;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  net_amount: number;
  status: "outstanding" | "paid";
  /** When the parent said they had paid. A timestamped STATEMENT, never a
   *  status change (PRD §7.21) — the coach confirms against their bank.
   *  Fetched here, not only on the detail screen, because the list now
   *  carries the claim control too. */
  paid_claimed_at: string | null;
  /** Which business issued it. A parent may deal with several, and an
   *  ungrouped list gives no way to tell whose bill is whose. */
  tenant_id: string;
  business_name: string;
};

export type ParentPackage = {
  id: string;
  name: string;
  business_name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  total_value: number;
  /** What the family PAYS: total_value − discount_amount (referral). Distinct
   *  from total_value / value_remaining, which never move (D14). */
  amount_payable: number;
  discount_amount: number;
  status: "pending" | "active" | "cancelled";
  /** Set ⇒ the business prepared this as a renewal OFFER, not a parent request. */
  offered_by: string | null;
  expires_on: string | null;
  /** LIVE numbers from package_live_balances() — the stored balance minus
   *  lessons already attended but not yet invoiced. Never recomputed here:
   *  the RPC is the single derivation (PACKAGES_DESIGN.md ⚠ RISK 4). */
  live_lessons_remaining: number | null;
  live_value_remaining: number | null;
  holiday_extension_days: number;
  cancel_extension_days: number;
};

export type PackageProduct = {
  id: string;
  name: string;
  business_name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  validity_weeks: number;
};

export type CreditNote = {
  id: string;
  reference_number: string;
  amount: number;
  issued_at: string;
  original_status: string;
  corrected_status: string;
  reason: string | null;
  applied_to_invoice_id: string | null;
};

// ── The referral card (moved from components/ReferralSection.tsx) ──────────

export type Membership = {
  id: string;
  referral_code: string | null;
  referral_code_disabled_at: string | null;
  tenant_id: string;
  business_name: string;
};

export type Referral = {
  tenant_id: string;
  business_name: string;
  referee_first_name: string | null;
  status: string;
};
