// Entity types for the Packages page, extracted verbatim at Stage 1 of the
// full-track refactor (docs/refactor/PACKAGES_REFACTOR_PLAN.md).

export type Category = {
  id: string;
  name: string;
  class_count: number;
  default_product_id: string | null;
  /** Default max students for a class in this category; NULL = no limit.
   *  Overridable per class on the Classes page (20260819000100). */
  default_capacity: number | null;
};

export type Product = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  validity_weeks: number;
  is_active: boolean;
  holder_count: number;
  /** One child only (true) or shared across siblings (false). Read at SALE —
   *  flipping it affects new sales only (single-child packages, D6). */
  single_child: boolean;
};

export type Purchase = {
  id: string;
  parent_id: string;
  parent_name: string;
  name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  total_value: number;
  /** What the family PAYS (referral discount applied). = total_value when
   *  none. The confirm/QR number the admin ticks against the bank (RISK 7). */
  amount_payable: number;
  discount_amount: number;
  value_remaining: number;
  live_value_remaining: number | null;
  live_lessons_remaining: number | null;
  status: string;
  /** When the business confirmed payment (NULL = never paid — a request, or a
   *  declined one). Only a cancelled package WITH this can be refunded. */
  confirmed_at: string | null;
  product_id: string;
  requested_at: string;
  start_date: string | null;
  expires_on: string | null;
  holiday_extension_days: number;
  cancel_extension_days: number;
  manual_extension_days: number;
  /** PKG-YYYY-NNNN (20260809000100). What an incoming PayNow line is matched
   *  back to — the parent's QR carries it as the bill reference. NOT NULL in
   *  the database; typed nullable only so a stale cached row cannot crash the
   *  page. */
  reference_number: string | null;
  /** Renewal-offer fields (Migration A). offered_by set ⇒ an admin OFFER, not a
   *  parent request. paid_claimed_at ⇒ the family tapped "I've paid".
   *  superseded_by ⇒ a newer row cancelled this open offer. */
  offered_by: string | null;
  paid_claimed_at: string | null;
  superseded_by: string | null;
  public_token: string | null;
  children: string | null;
  /** NULL = shared across the family. Set = a one-child package: only this
   *  child's lessons draw from it (20261010000100). */
  student_id: string | null;
  /** The one child's name — null for a shared package, or when RLS hides the
   *  embed (§7.344: the row still reads "One child"). */
  student_name: string | null;
};

export type ParentOption = { id: string; name: string };

/** A family's active child at this business — the one-child sale picker. */
export type ChildOption = { id: string; name: string };

/** A row of the Generate-all preview (from package_renewal_candidates), plus the
 *  admin's editable product/start choices and whether it is ticked. */
export type CandidateRow = {
  parent_id: string;
  parent_name: string;
  parent_phone: string | null;
  children: string | null;
  package_name: string | null;
  lessons_left: number | null;
  expires_on: string | null;
  expired_days_ago: number | null;
  original_product_id: string | null;
  suggested_product_id: string | null;
  has_open_offer: boolean;
  /** NULL = a FAMILY row (shared packages). Set = this child's own row (D8).
   *  Rows are keyed `${parent_id}:${student_id ?? "family"}` (RISK 4). */
  student_id: string | null;
  // admin-editable
  chosenProduct: string;
  chosenStart: string;
  include: boolean;
  // RISK 7 — the discounted price the offer WILL carry, from
  // preview_package_price (the one source of truth), so the preview equals the
  // WhatsApp price and the pay-page headline. Null until fetched.
  previewTotal: number | null;
  previewDiscount: number | null;
  previewPayable: number | null;
};

/** A LIVE (non-reversed) package refund (20260928000200). One per package at
 *  most; a correction is a reversal + a new row. */
export type LiveRefund = {
  id: string;
  parent_package_id: string;
  amount: number;
  refunded_on: string;
  note: string | null;
};
