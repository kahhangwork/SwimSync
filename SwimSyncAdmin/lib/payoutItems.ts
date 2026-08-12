// What one coach is owed for one lesson — the money half of the roster wave.
//
// WHY THIS IS A SET AND NOT A ROW. Before the roster, a lesson produced at most
// one payout item for one coach, so "the lesson's line" and "the item" were the
// same object and the wages page read them as one. Both halves of that stopped
// being true on 2026-08-11:
//
//   • ACROSS payouts — a shadowed lesson writes an item into the main's payout
//     AND into each shadow's, because a payout is per-coach
//     (UNIQUE (tenant_id, coach_id, period_month)).
//   • WITHIN one payout — a correction to an already-paid month arrives as a
//     SECOND item on the same lesson, marked is_adjustment. The table's own
//     uniqueness admits it: UNIQUE (payout_id, lesson_session_id, is_adjustment).
//
// So a lesson's amount for a coach is the SUM of a set, and the number of
// lessons is the count of DISTINCT lesson ids — not the number of items, which
// double-counts every corrected lesson and reports a month as busier than it was.
//
// ⚠ THIS MODULE READS `classes.coach_id` NOWHERE, AND MUST NOT START.
// The migration's header splits the two axes: access follows the roster plus
// classes.coach_id; MONEY follows class_rate_on().paid_coach_id. 20260719000800
// exists because the two were once the same query, and handing a class over
// re-priced its entire unpaid history — coach A dropped to $0 and coach B was
// paid for four lessons they never taught. Every label below is therefore
// derived from the ROSTER ROWS ALONE, which is a fact about who was assigned and
// says nothing about who the class currently belongs to. The access-side twin of
// this file is `lib/sessionRoster.ts`, which does use classes.coach_id, and the
// two disagree on purpose.
//
// Pure — no Supabase, no React. The caller fetches the rows and passes them in.

/** A `coach_payout_items` row, as the admin reads it. */
export type PayoutItem = {
  id: string;
  lesson_session_id: string;
  /** Snapshot taken when the payout was built — a class may since be renamed. */
  class_title: string;
  session_date: string;
  /** 'duration' or 'flat' — why this line is the amount it is. */
  basis: string;
  minutes: number | null;
  amount: number;
  is_adjustment: boolean;
  /** The month a correction belongs to, e.g. "2026-07". Null on an ordinary item. */
  original_period: string | null;
};

/** A `session_coaches` row for a lesson this payout touches — the SUBSTITUTE.
 *
 * ⚠ NO `role`. Since 20260812000200 `session_coaches` holds substitutes only,
 * at most one per lesson. A shadow is a dated assignment to the whole CLASS, so
 * it cannot be read off a per-lesson row at all — the caller resolves which
 * lessons this coach shadowed and passes the ids in as `shadowedSessionIds`. */
export type SessionRosterRow = {
  lesson_session_id: string;
  coach_id: string;
};

/**
 * Why this coach has a line for this lesson. The whole point of the labels is
 * that a cover is a DECISION SOMEBODY MADE, visible as such — not a total that
 * quietly came out different from last month.
 */
export type LessonLineKind =
  /** No roster row anywhere on the lesson: the class's terms paid them, as always. */
  | "ordinary"
  /** An admin named this coach as the lesson's main — they taught it. */
  | "assigned"
  /** This coach was an assigned shadow OF THE CLASS on that date — they
   *  watched, at their own shadow rate. Derived from `class_shadow_coaches`
   *  by the caller, never from a per-lesson row. */
  | "shadow"
  /**
   * This coach is NOT on the lesson's roster but somebody else is its main.
   * This is the clawback side of a cover: the line will usually be a negative
   * adjustment, and without a label it reads as an unexplained deduction.
   */
  | "reassigned"
  /**
   * NOTHING BUT ADJUSTMENTS, AND THE ROSTER NO LONGER EXPLAINS WHY.
   *
   * The case that forced this kind into existence: an admin assigns B to cover
   * lesson L, payroll runs (A clawed back, B paid), and the admin then CLEARS
   * the cover. The roster row is gone, so L has no rows at all — and the next
   * payroll's negative line on B's payout would fall through to "ordinary" and
   * render with no label whatsoever. A bare negative number is precisely the
   * unexplained deduction this module exists to prevent, so a line made only of
   * corrections says so even when nothing is left to say who or why.
   */
  | "corrected";

export type LessonLine = {
  lesson_session_id: string;
  class_title: string;
  session_date: string;
  /** The SUM of every item in this payout for this lesson. */
  amount: number;
  /** The items themselves — an adjustment is summed, never summed AWAY. */
  items: PayoutItem[];
  kind: LessonLineKind;
  hasAdjustment: boolean;
  /** The months the corrections in this set belong to, deduped and sorted. */
  adjustedPeriods: string[];
};

/** Money is NUMERIC(10,2); keep the arithmetic in whole cents. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * One line per lesson, each carrying the full set of items behind it.
 *
 * Ordered by date and then class title, so a month reads as a diary. Two
 * classes can share a title, which is why the id — not the title — is what
 * groups.
 */
export function buildLessonLines(
  items: readonly PayoutItem[],
  rosterRows: readonly SessionRosterRow[],
  coachId: string,
  /** Lessons this coach was an assigned class shadow on, and was not marked
   *  absent from. Empty by default so every existing caller keeps its meaning. */
  shadowedSessionIds: ReadonlySet<string> = new Set()
): LessonLine[] {
  const bySession = new Map<string, PayoutItem[]>();
  for (const item of items) {
    const list = bySession.get(item.lesson_session_id);
    if (list) list.push(item);
    else bySession.set(item.lesson_session_id, [item]);
  }

  const lines: LessonLine[] = [];
  for (const [lesson_session_id, group] of bySession) {
    const cents = group.reduce((sum, i) => sum + toCents(i.amount), 0);
    const adjustments = group.filter((i) => i.is_adjustment);

    lines.push({
      lesson_session_id,
      // The snapshots agree across a lesson's items; the first is as good as
      // any, and is the one that exists even when the class has been deleted.
      class_title: group[0].class_title,
      session_date: group[0].session_date,
      amount: cents / 100,
      items: group,
      kind: lineKind(
        rosterRows,
        lesson_session_id,
        coachId,
        group,
        shadowedSessionIds
      ),
      hasAdjustment: adjustments.length > 0,
      adjustedPeriods: [
        ...new Set(
          adjustments
            .map((i) => i.original_period)
            .filter((p): p is string => Boolean(p))
        ),
      ].sort(),
    });
  }

  return lines.sort(
    (a, b) =>
      a.session_date.localeCompare(b.session_date) ||
      a.class_title.localeCompare(b.class_title)
  );
}

function lineKind(
  rosterRows: readonly SessionRosterRow[],
  sessionId: string,
  coachId: string,
  group: readonly PayoutItem[],
  shadowedSessionIds: ReadonlySet<string>
): LessonLineKind {
  const forSession = rosterRows.filter((r) => r.lesson_session_id === sessionId);
  const mine = forSession.find((r) => r.coach_id === coachId);

  // ⚠ SUBSTITUTE BEATS SHADOW, and the order here MIRRORS
  // coach_attribution_kind() (20260812000200 §7). A coach can be both — they
  // shadow the class all term and cover one lesson of it — and the database
  // pays them the substitute rate for that lesson. A label that said "shadow"
  // beside a substitute's amount would describe the money wrongly.
  if (mine) return "assigned";
  if (shadowedSessionIds.has(sessionId)) return "shadow";
  // No row of my own. If somebody ELSE is the lesson's substitute, this coach
  // was replaced on it — the usual reason a line goes negative.
  if (forSession.length > 0) return "reassigned";
  // Still no explanation, and nothing here but corrections. The roster may have
  // been cleared since the clawback was emitted, so there is no longer anything
  // to point at — but an unlabelled negative line is the worse outcome.
  if (group.every((i) => i.is_adjustment)) return "corrected";
  return "ordinary";
}

export type PayoutSummary = {
  /**
   * DISTINCT lessons this coach was actually PAID FOR IN THIS PERIOD — not
   * items, and not lines.
   *
   * ⚠ A LINE IS NOT ALWAYS A LESSON TAUGHT. A clawback for a lesson somebody
   * else covered produces a line made of nothing but a negative adjustment, and
   * counting it told the replaced coach they taught a lesson they did not, in
   * the column immediately beside the money taken off them. A corrected lesson
   * that this period also paid for still counts once — the item set has a
   * non-adjustment item in it.
   */
  lessons: number;
  /** What the lines add up to. */
  itemTotal: number;
  /** The adjustment part of that, so a correction is legible on its own. */
  adjustmentTotal: number;
};

export function summarisePayout(lines: readonly LessonLine[]): PayoutSummary {
  let cents = 0;
  let adjustmentCents = 0;
  let lessons = 0;

  for (const line of lines) {
    if (line.items.some((i) => !i.is_adjustment)) lessons++;
    for (const item of line.items) {
      cents += toCents(item.amount);
      if (item.is_adjustment) adjustmentCents += toCents(item.amount);
    }
  }

  return {
    lessons,
    itemTotal: cents / 100,
    adjustmentTotal: adjustmentCents / 100,
  };
}

/**
 * Does the payout's stored gross agree with the items behind it?
 *
 * Asked, and shown when the answer is no, because THE STORED TOTAL IS THE ONE
 * THAT GETS PAID. A page that renders a breakdown beside a total it never
 * checked will happily show six lines adding to $180 above the words "S$150.00"
 * and leave the admin to notice. Compared in cents: two NUMERIC(10,2) values
 * that differ by a rounding artefact are not a discrepancy worth alarming about,
 * and float subtraction invents them.
 */
export function grossMatchesItems(
  grossAmount: number,
  summary: PayoutSummary
): boolean {
  return toCents(grossAmount) === toCents(summary.itemTotal);
}
