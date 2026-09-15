// Pure deciders for package renewal OFFERS — kept out of the page component so
// they are unit-testable (PACKAGE_RENEWAL_AUTOMATION_PLAN.md, RISK 3 + Dec 5).

/** ⚠ RISK 3 — the confirm dialog must adopt the OFFER's own start_date, not the
 *  freshly-suggested one. The parent paid against "starts <offer.start_date>";
 *  re-suggesting at confirm time would silently move the validity window.
 *  A parent-created request has no start_date, so it falls back to suggested. */
export function defaultConfirmStart(
  rowStart: string | null,
  suggested: string,
): string {
  return rowStart ?? suggested;
}

export interface OfferProductCandidate {
  productId: string;
  isActive: boolean;
}

/** Decision 5 precedence for pre-selecting the product on a renewal offer:
 *    the family's ORIGINAL product (if still active)
 *      → the CATEGORY default
 *      → the ALL-CLASSES default
 *      → nothing (the row is skipped in Generate-all until the admin picks).
 *  Retired products are never offered. In Phase 1 the two defaults are null
 *  (Migration B introduces them), so this reduces to "original if active, else
 *  nothing". */
export function pickOfferProduct(
  original: OfferProductCandidate | null,
  categoryDefaultId: string | null,
  allClassesDefaultId: string | null,
): string | null {
  if (original && original.isActive) return original.productId;
  return categoryDefaultId ?? allClassesDefaultId ?? null;
}
