/**
 * What the Days-to-pay input shows, and what it says, after a save
 * (OVERDUE_INVOICES_PLAN.md ⚠ RISK 4) — runDaySaveOutcome's shape exactly.
 *
 * Decided from the value RE-READ from the database, never from the update's
 * error alone: an update RLS filters out returns no error and changes nothing.
 * guard_tenant_columns() refuses a role without billing edit with an error.
 * `storedRaw` is `undefined` when the re-read itself failed.
 */
export function paymentDaysOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(90, Math.trunc(n)) : 14;
}

export function paymentDaysSaveOutcome(
  wanted: number,
  updateError: string | null,
  storedRaw: unknown
): { days: number | null; message: string | null } {
  if (storedRaw === undefined) {
    return {
      days: null,
      message: updateError
        ? `Error: ${updateError} — reload to see the saved days to pay.`
        : "Could not confirm the days to pay saved — reload to check.",
    };
  }
  const stored = paymentDaysOf(storedRaw);
  if (updateError) return { days: stored, message: `Error: ${updateError}` };
  if (stored !== wanted) {
    return { days: stored, message: `Not saved — families still have ${stored} days to pay.` };
  }
  return { days: stored, message: null };
}
