// What is inside one month's pay — the coach's own half of `coach_payout_items`.
//
// ⚠ WHY THIS EXISTS NOW AND NOT BEFORE WAVE 3. Until the lesson-level roster
// (20260811000200) a coach's month was "my classes, at my rate", and a single
// total said everything. Two things can now change that total without the coach
// having taught differently:
//
//   · a lesson of somebody ELSE'S class that they covered, priced at their own
//     rate (decision 1), and
//   · a CORRECTION to an already-paid earlier month, which lands as an
//     `is_adjustment` item on the next payout carrying the month it belongs to.
//
// The correction is the one that matters. An admin who records a cover after
// July was paid moves money between two coaches in August — the plan's §1.6
// calls it "the only silent-money defect in the wave, invisible from every
// screen". A number that changes with no line explaining it is exactly the
// thing a coach cannot check, so this file turns the items into that line.
//
// ⚠ NO CLOCK AND NO FETCH, like everything else in lib/ (§7.7). `formatPeriod`
// builds a Date from explicit parts purely to name a month; it never reads one.

/** One row of `coach_payout_items`, flattened. */
export type PayoutItem = {
  payoutId: string;
  classTitle: string;
  /** YYYY-MM-DD */
  sessionDate: string;
  amount: number;
  isAdjustment: boolean;
  /** "YYYY-MM" — the month a correction belongs to, not the month it is paid
   *  in. Null on an ordinary item. */
  originalPeriod: string | null;
};

/** A correction, summed over every item that belongs to the same month. */
export type Adjustment = { period: string | null; amount: number };

export type PayoutBreakdown = {
  /** Lessons actually taught in this payout's own month. */
  lessons: number;
  lessonTotal: number;
  /** Corrections to EARLIER months, one entry per month, oldest first. */
  adjustments: Adjustment[];
};

const EMPTY: PayoutBreakdown = { lessons: 0, lessonTotal: 0, adjustments: [] };

export function parsePayoutItems(rows: readonly any[] | null): PayoutItem[] {
  const out: PayoutItem[] = [];
  for (const row of rows ?? []) {
    if (typeof row?.payout_id !== "string") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    out.push({
      payoutId: row.payout_id,
      classTitle: typeof row.class_title === "string" ? row.class_title : "",
      sessionDate: typeof row.session_date === "string" ? row.session_date : "",
      amount,
      isAdjustment: row.is_adjustment === true,
      originalPeriod:
        typeof row.original_period === "string" ? row.original_period : null,
    });
  }
  return out;
}

/**
 * Group items by payout.
 *
 * ⚠ AN ADJUSTMENT IS NOT A LESSON, AND MUST NOT BE COUNTED AS ONE. It is a
 * correction to a lesson already counted in a month that has been paid; adding
 * it to `lessons` would report a coach teaching a lesson twice, and adding it to
 * `lessonTotal` would make that total disagree with the payout's own
 * `gross_amount` in the one month where a coach is most likely to be checking.
 */
export function breakdownByPayout(
  items: readonly PayoutItem[]
): Map<string, PayoutBreakdown> {
  const byPayout = new Map<string, PayoutBreakdown>();
  const adjustmentsByPayout = new Map<string, Map<string | null, number>>();

  for (const item of items) {
    const b =
      byPayout.get(item.payoutId) ??
      ({ lessons: 0, lessonTotal: 0, adjustments: [] } as PayoutBreakdown);
    if (item.isAdjustment) {
      const perPeriod =
        adjustmentsByPayout.get(item.payoutId) ?? new Map<string | null, number>();
      perPeriod.set(
        item.originalPeriod,
        (perPeriod.get(item.originalPeriod) ?? 0) + item.amount
      );
      adjustmentsByPayout.set(item.payoutId, perPeriod);
    } else {
      b.lessons += 1;
      // Rounded at the point of accumulation: these are two-decimal money
      // values and a float sum of them drifts (0.1 + 0.2), which on a payslip
      // reads as the business being unable to add up.
      b.lessonTotal = round2(b.lessonTotal + item.amount);
    }
    byPayout.set(item.payoutId, b);
  }

  for (const [payoutId, perPeriod] of adjustmentsByPayout) {
    const b = byPayout.get(payoutId) ?? { lessons: 0, lessonTotal: 0, adjustments: [] };
    b.adjustments = [...perPeriod.entries()]
      .map(([period, amount]) => ({ period, amount: round2(amount) }))
      // A correction that nets to zero across a month is not news — it is two
      // items that cancel, and printing "S$0.00 correction" invites a question
      // with no answer.
      .filter((a) => a.amount !== 0)
      .sort((x, y) => (x.period ?? "").localeCompare(y.period ?? ""));
    byPayout.set(payoutId, b);
  }

  return byPayout;
}

/** The breakdown for one payout, or an empty one — never undefined, so a caller
 *  cannot render a payout whose items simply have not arrived as "0 lessons"
 *  differently from one that genuinely has none. */
export function breakdownFor(
  map: Map<string, PayoutBreakdown>,
  payoutId: string
): PayoutBreakdown {
  return map.get(payoutId) ?? EMPTY;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "2026-07" -> "July 2026". Falls back to the raw string, which is still
 *  truthful, rather than printing "Invalid Date" at a coach. */
export function formatPeriod(period: string | null): string {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return "an earlier month";
  const [year, month] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

/** "S$12.30", and "−S$12.30" for money going the other way. A minus sign
 *  rather than a hyphen: this is the one number a coach reads to find out they
 *  are being docked, and it should not look like a typo. */
export function formatMoney(amount: number): string {
  return amount < 0
    ? `−S$${Math.abs(amount).toFixed(2)}`
    : `S$${amount.toFixed(2)}`;
}

/** The one-line explanation of a correction, as the card prints it. */
export function describeAdjustment(a: Adjustment): string {
  const verb = a.amount < 0 ? "taken off for" : "added for";
  return `${formatMoney(a.amount)} ${verb} ${formatPeriod(a.period)}`;
}

/** "3 lessons" / "1 lesson". */
export function describeLessons(count: number): string {
  return count === 1 ? "1 lesson" : `${count} lessons`;
}
