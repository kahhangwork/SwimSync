// ============================================================
// Effective-dated class terms — what a lesson COST, on the day it happened.
//
// Split out of core.ts for the same reason as dates.ts: this is pure logic
// about money, and it must be unit-testable without a stack.
//
// WHY THIS EXISTS. core.ts used to price every item from the class's CURRENT
// `price_per_lesson`, read at generation time. Editing a class's price on
// 3 Aug therefore silently repriced every unbilled July lesson — an invoice
// derived from a value the lesson never had. Same family as the UTC-derived
// billing month: something that looks current being applied to the past.
//
// A lesson is now priced by its own `session_date`, so no later edit can
// reach back and change it.
// ============================================================

export type ClassRate = {
  class_id: string;
  price_per_lesson: number | string; // numeric arrives from PostgREST as string
  paid_coach_id: string;
  effective_from: string; // YYYY-MM-DD
};

export type ResolvedRate = {
  price: number;
  paidCoachId: string;
};

/**
 * The terms in force for `classId` on `date` — the row with the latest
 * `effective_from` that is on or before it.
 *
 * THROWS when nothing is in force, and that is deliberate: see below.
 *
 * Dates are compared as YYYY-MM-DD STRINGS, never parsed into Date objects.
 * Lexicographic order is chronological for this format, and it keeps the
 * function free of the timezone trap that has bitten this codebase twice
 * (the SGT day boundary in lessonDates, the UTC billing month in dates.ts).
 */
export function rateOn(
  rates: readonly ClassRate[],
  classId: string,
  date: string,
  classTitle = classId,
): ResolvedRate {
  let best: ClassRate | undefined;

  for (const r of rates) {
    if (r.class_id !== classId) continue;
    if (r.effective_from > date) continue; // not yet in force on this date
    if (!best || r.effective_from > best.effective_from) best = r;
  }

  // A MISSING RATE IS A HARD FAILURE, NEVER A FALLBACK.
  //
  // The tempting alternatives — default to 0, or fall back to
  // classes.price_per_lesson — are both the bug this module removes, and both
  // are the shape this codebase has now shipped three times: an absent value
  // silently coerced into a plausible-looking one. `Number(null)` turned an
  // unset invoice_run_day into day 1 (the most aggressive possible run day);
  // `Number("")` saved a blank wage rate as $0, which reads as "on payroll,
  // earns nothing". Here, 0 would issue a $0 invoice line for a lesson that
  // was actually taught — a silent underbill, and once the invoice exists that
  // lesson can never be billed again.
  //
  // Every class is guaranteed a floor-dated row ('2000-01-01') by the
  // seed_class_rate trigger and the backfill in 20260719000700, so reaching
  // this line means an invariant is broken, not that a rate is merely absent.
  // Failing loudly blocks the whole run, exactly like the completeness gate.
  if (!best) {
    throw new Error(
      `No class rate in force for "${classTitle}" on ${date}. Every class must ` +
        `have a floor-dated class_rates row; this one does not, so the lesson ` +
        `cannot be priced. Refusing to bill rather than guess an amount.`,
    );
  }

  const price = Number(best.price_per_lesson);
  if (!Number.isFinite(price)) {
    throw new Error(
      `Class rate for "${classTitle}" on ${date} is not a finite number ` +
        `(got ${JSON.stringify(best.price_per_lesson)}).`,
    );
  }

  return { price, paidCoachId: best.paid_coach_id };
}
