// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); pinned by monthLabel.test.ts.
//
// ⚠ Builds a LOCAL Date from its parts and names the month only — pinned by path
// in BOTH sgDisplay.drift.test.ts twins ("new Date(y, m - 1, 1)"), repointed here
// from the route (plan ⚠ R6). Correct in every zone; do NOT add a timeZone.

export function monthLabel(billingMonth: string): string {
  const [y, m] = billingMonth.split("-").map(Number);
  if (!y || !m) return billingMonth;
  return `${new Date(y, m - 1, 1).toLocaleString("en-SG", { month: "long" })} ${y}`;
}
