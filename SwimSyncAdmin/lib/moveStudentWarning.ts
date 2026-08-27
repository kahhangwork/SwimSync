// The advisory credit warning shown before moving a student between businesses
// (WAVE_C_SPOOL_PLAN.md Piece 3, client-side half).
//
// Credit NEVER crosses businesses (PRD §5.6): a cross-business move leaves any
// credit stranded at the OLD business, where it becomes unspendable. The move
// itself does not touch credit — this is a courtesy prompt so the platform admin
// can settle or spend it first, not a guard.

export type CreditBalanceRow = { credit_balance: number | string | null };

/**
 * The family's total spendable credit at ONE business — every linked parent's
 * balance row, summed.
 *
 * ⚠ RISK (fable): a student can have more than one parent, so a single-parent
 * read UNDER-warns. This sums across all the rows the caller passes (each
 * parent's balance at the student's current tenant), coercing PostgREST's
 * numeric-as-string.
 */
export function totalFamilyCredit(rows: readonly CreditBalanceRow[]): number {
  return rows.reduce((sum, r) => sum + Number(r.credit_balance ?? 0), 0);
}
