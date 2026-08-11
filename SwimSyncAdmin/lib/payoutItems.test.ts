import { describe, it, expect } from "vitest";
import {
  buildLessonLines,
  summarisePayout,
  grossMatchesItems,
  type PayoutItem,
  type PayoutSummary,
  type SessionRosterRow,
} from "./payoutItems";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const T = "tttttttt-tttt-tttt-tttt-tttttttttttt";

function item(over: Partial<PayoutItem> & { id: string }): PayoutItem {
  return {
    lesson_session_id: "s1",
    class_title: "Tuesday Beginners",
    session_date: "2026-07-14",
    basis: "duration",
    minutes: 60,
    amount: 50,
    is_adjustment: false,
    original_period: null,
    ...over,
  };
}

describe("buildLessonLines — a lesson is a SET of items", () => {
  it("sums the base item and its adjustment into one lesson line", () => {
    // The shape that broke reading one row per lesson: UNIQUE is on
    // (payout_id, lesson_session_id, is_adjustment), so a corrected lesson has
    // two items in the SAME payout.
    const lines = buildLessonLines(
      [
        item({ id: "i1", amount: 50 }),
        item({
          id: "i2",
          amount: -10,
          is_adjustment: true,
          original_period: "2026-06",
        }),
      ],
      [],
      A
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(40);
    expect(lines[0].items).toHaveLength(2);
    expect(lines[0].hasAdjustment).toBe(true);
    expect(lines[0].adjustedPeriods).toEqual(["2026-06"]);
  });

  it("counts DISTINCT lessons, never items", () => {
    // Two items, one lesson. Counting items reports the month as busier than it
    // was — and the number sits directly beside the amount the coach is paid.
    const lines = buildLessonLines(
      [
        item({ id: "i1" }),
        item({ id: "i2", is_adjustment: true, amount: -50 }),
      ],
      [],
      A
    );
    expect(summarisePayout(lines).lessons).toBe(1);
  });

  it("does NOT count a clawback-only line as a lesson taught", () => {
    // The replaced coach's August payout for a July lesson B covered: one
    // negative adjustment and nothing else. Counting it printed "1" under
    // Lessons beside the money being taken back off them.
    const lines = buildLessonLines(
      [
        item({
          id: "i1",
          amount: -50,
          is_adjustment: true,
          original_period: "2026-07",
        }),
      ],
      [{ lesson_session_id: "s1", coach_id: B, role: "main" }],
      A
    );
    expect(summarisePayout(lines).lessons).toBe(0);
    expect(summarisePayout(lines).itemTotal).toBe(-50);
  });

  it("groups by lesson id, not by the class title snapshot", () => {
    // Two classes can share a title, and the title is a SNAPSHOT — the same
    // class renamed between months would otherwise split or merge lessons.
    const lines = buildLessonLines(
      [
        item({ id: "i1", lesson_session_id: "s1", session_date: "2026-07-07" }),
        item({ id: "i2", lesson_session_id: "s2", session_date: "2026-07-14" }),
      ],
      [],
      A
    );
    expect(lines).toHaveLength(2);
  });

  it("orders lessons by date so a month reads as a diary", () => {
    const lines = buildLessonLines(
      [
        item({ id: "i1", lesson_session_id: "s2", session_date: "2026-07-21" }),
        item({ id: "i2", lesson_session_id: "s1", session_date: "2026-07-07" }),
      ],
      [],
      A
    );
    expect(lines.map((l) => l.session_date)).toEqual([
      "2026-07-07",
      "2026-07-21",
    ]);
  });

  it("keeps the arithmetic in cents", () => {
    // 0.1 + 0.2 is 0.30000000000000004, and a wage total is read against a bank
    // statement.
    const lines = buildLessonLines(
      [
        item({ id: "i1", amount: 0.1 }),
        item({ id: "i2", amount: 0.2, is_adjustment: true }),
      ],
      [],
      A
    );
    expect(lines[0].amount).toBe(0.3);
  });
});

describe("buildLessonLines — the cover is a visible decision", () => {
  const covered: SessionRosterRow[] = [
    { lesson_session_id: "s1", coach_id: B, role: "main" },
    { lesson_session_id: "s1", coach_id: T, role: "shadow" },
  ];

  it("labels the substitute's own line as assigned", () => {
    const lines = buildLessonLines([item({ id: "i1" })], covered, B);
    expect(lines[0].kind).toBe("assigned");
  });

  it("labels the trainee's line as a shadow", () => {
    const lines = buildLessonLines([item({ id: "i1", amount: 20 })], covered, T);
    expect(lines[0].kind).toBe("shadow");
  });

  it("labels the REPLACED coach's clawback as reassigned", () => {
    // The line that is otherwise an unexplained deduction: coach A is not on
    // the roster, somebody else is the lesson's main, and A's item is negative.
    const lines = buildLessonLines(
      [
        item({
          id: "i1",
          amount: -50,
          is_adjustment: true,
          original_period: "2026-07",
        }),
      ],
      covered,
      A
    );
    expect(lines[0].kind).toBe("reassigned");
    expect(lines[0].amount).toBe(-50);
  });

  it("still labels a clawback after the cover has been CLEARED", () => {
    // The gap that made "corrected" a kind. Assign B, run payroll (A clawed
    // back), then clear the cover: the roster row is gone, so nothing explains
    // A's negative line any more. Falling through to "ordinary" renders a bare
    // negative number with no label at all.
    const lines = buildLessonLines(
      [
        item({
          id: "i1",
          amount: -50,
          is_adjustment: true,
          original_period: "2026-07",
        }),
      ],
      [], // cover cleared — no roster rows survive
      A
    );
    expect(lines[0].kind).toBe("corrected");
  });

  it("does not call a normally-corrected lesson a bare correction", () => {
    // A lesson that this period BOTH paid for and corrected still has a
    // non-adjustment item, so it is an ordinary lesson with a correction on it
    // — not the roster-less clawback above.
    const lines = buildLessonLines(
      [
        item({ id: "i1", amount: 50 }),
        item({ id: "i2", amount: -5, is_adjustment: true, original_period: "2026-06" }),
      ],
      [],
      A
    );
    expect(lines[0].kind).toBe("ordinary");
  });

  it("leaves an untouched lesson unlabelled", () => {
    // The absence rule: no roster row anywhere means nothing was decided, and
    // labelling it would imply a substitution that never happened.
    const lines = buildLessonLines([item({ id: "i1" })], [], A);
    expect(lines[0].kind).toBe("ordinary");
  });

  it("does not leak another lesson's roster onto this one", () => {
    // The rows arrive for the whole payout in one query. Matching on coach
    // alone would mark every one of B's lessons as a cover.
    const lines = buildLessonLines(
      [item({ id: "i1", lesson_session_id: "s9" })],
      covered,
      B
    );
    expect(lines[0].kind).toBe("ordinary");
  });

  it("does not call a lesson reassigned when the only roster rows are shadows", () => {
    // A shadowed lesson with no roster MAIN is still taught by the class's
    // coach under the absence rule — they were not replaced, and telling them
    // they were is the same error as hiding a real cover.
    const lines = buildLessonLines(
      [item({ id: "i1" })],
      [{ lesson_session_id: "s1", coach_id: T, role: "shadow" }],
      A
    );
    expect(lines[0].kind).toBe("ordinary");
  });
});

describe("buildLessonLines — adjustedPeriods", () => {
  it("dedupes, sorts and drops nulls across several corrections", () => {
    // Without all three, lineDetail renders "correcting 2026-07, 2026-06,
    // 2026-07" or trips over a null. One adjustment per test never exercised
    // any of it.
    const lines = buildLessonLines(
      [
        item({ id: "i1", amount: -5, is_adjustment: true, original_period: "2026-07" }),
        item({ id: "i2", amount: -5, is_adjustment: true, original_period: "2026-06" }),
        item({ id: "i3", amount: -5, is_adjustment: true, original_period: "2026-07" }),
        item({ id: "i4", amount: -5, is_adjustment: true, original_period: null }),
      ],
      [],
      A
    );
    expect(lines[0].adjustedPeriods).toEqual(["2026-06", "2026-07"]);
  });

  it("is empty when nothing is a correction", () => {
    const lines = buildLessonLines([item({ id: "i1" })], [], A);
    expect(lines[0].adjustedPeriods).toEqual([]);
    expect(lines[0].hasAdjustment).toBe(false);
  });
});

describe("summarisePayout", () => {
  it("separates the adjustment part from the total", () => {
    const lines = buildLessonLines(
      [
        item({ id: "i1", lesson_session_id: "s1", amount: 50 }),
        item({
          id: "i2",
          lesson_session_id: "s2",
          session_date: "2026-07-21",
          amount: -40,
          is_adjustment: true,
          original_period: "2026-06",
        }),
      ],
      [],
      A
    );
    // ONE lesson, not two: the second line is a correction to another month
    // and was not taught in this one.
    expect(summarisePayout(lines)).toEqual({
      lessons: 1,
      itemTotal: 10,
      adjustmentTotal: -40,
    });
  });

  it("is zero-everything for a payout with no items", () => {
    expect(summarisePayout([])).toEqual({
      lessons: 0,
      itemTotal: 0,
      adjustmentTotal: 0,
    });
  });
});

describe("grossMatchesItems", () => {
  const lines = buildLessonLines([item({ id: "i1", amount: 50 })], [], A);

  it("agrees when the breakdown adds up to the stored gross", () => {
    expect(grossMatchesItems(50, summarisePayout(lines))).toBe(true);
  });

  it("disagrees when it does not — the stored gross is what gets PAID", () => {
    expect(grossMatchesItems(150, summarisePayout(lines))).toBe(false);
  });

  it("does not invent a discrepancy out of a float artefact", () => {
    // Built by hand rather than through summarisePayout, which already rounds
    // to cents — routing it through the happy path made this test pass against
    // a naive `gross === itemTotal` comparison too, i.e. it proved nothing.
    // 0.1 + 0.2 is 0.30000000000000004, which is the artefact a real total can
    // carry if any caller ever sums outside toCents().
    const artefact: PayoutSummary = {
      lessons: 2,
      itemTotal: 0.1 + 0.2,
      adjustmentTotal: 0,
    };
    expect(artefact.itemTotal).not.toBe(0.3); // the artefact is real
    expect(grossMatchesItems(0.3, artefact)).toBe(true);
  });

  it("still catches a discrepancy a cent wide", () => {
    // The other side of rounding in cents: tolerant of float noise, NOT of a
    // real one-cent difference, which on a wage total is a genuine mismatch.
    const summary: PayoutSummary = {
      lessons: 1,
      itemTotal: 50.0,
      adjustmentTotal: 0,
    };
    expect(grossMatchesItems(50.01, summary)).toBe(false);
  });
});
