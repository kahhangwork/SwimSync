// The referral-discount resolution rule, in TS — a MIRROR of the SQL
// (referral_discount_for + referral_discount_amount, migration 20260815000700),
// shared by the product form's "Inherits tenant default" label.
//
// ⚠ RISK 7 — this does NOT price an actual sale. Every money preview the admin
// acts on (Record-sale, Generate-all, the confirm modal) calls the
// preview_package_price RPC, the ONE source of truth, so a family's price is
// never computed two ways. This helper only explains which setting APPLIES for
// the product-form UI, and the vitest pins it against the same fixtures as the
// pgTAP so the two cannot drift.

export type DiscountType = "percent" | "amount";

export type ResolvedDiscount = {
  type: DiscountType | null;
  value: number;
  /** Where the applied setting came from — drives the form's helper text. */
  source: "product" | "tenant" | "none";
};

export function resolveReferralDiscount(
  product: {
    referral_discount_type: DiscountType | null;
    referral_discount_value: number | null;
  },
  tenant: {
    referral_enabled: boolean;
    referral_discount_type: DiscountType | null;
    referral_discount_value: number | null;
  },
): ResolvedDiscount {
  // Master switch first (D15): off ⇒ nothing, whatever the product override.
  if (!tenant.referral_enabled) return { type: null, value: 0, source: "none" };
  // A product override — including an explicit 0 (D4) — beats the tenant default.
  if (product.referral_discount_type != null) {
    return {
      type: product.referral_discount_type,
      value: product.referral_discount_value ?? 0,
      source: "product",
    };
  }
  if (tenant.referral_discount_type != null) {
    return {
      type: tenant.referral_discount_type,
      value: tenant.referral_discount_value ?? 0,
      source: "tenant",
    };
  }
  return { type: null, value: 0, source: "none" };
}

/** The dollar discount for a resolved (type, value) against a price, capped at
 *  the price and floored at 0 — mirrors referral_discount_amount(). */
export function computeReferralDiscount(
  type: DiscountType | null,
  value: number,
  total: number,
): number {
  const raw =
    type === "percent"
      ? Math.round((value * total) / 100 * 100) / 100
      : type === "amount"
        ? value
        : 0;
  return Math.min(total, Math.max(0, raw));
}

/** A short human label for a resolved discount, e.g. "10% off" / "S$25.00 off". */
export function discountLabel(type: DiscountType | null, value: number): string {
  if (type === "percent") return `${value}% off`;
  if (type === "amount") return `S$${value.toFixed(2)} off`;
  return "no discount";
}
