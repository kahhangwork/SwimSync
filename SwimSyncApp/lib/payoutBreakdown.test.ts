import {
  parsePayoutItems,
  breakdownByPayout,
  breakdownFor,
  formatPeriod,
  formatMoney,
  describeAdjustment,
  describeLessons,
} from "./payoutBreakdown";

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  payout_id: "p1",
  class_title: "Beginners 8:45",
  session_date: "2026-08-04",
  amount: "30.00",
  is_adjustment: false,
  original_period: null,
  ...over,
});

describe("parsePayoutItems", () => {
  it("reads PostgREST's numeric-as-string amount", () => {
    expect(parsePayoutItems([item()])[0].amount).toBe(30);
  });

  it("drops a row with an unusable amount rather than rendering NaN at a coach", () => {
    expect(parsePayoutItems([item({ amount: "not-a-number" })])).toEqual([]);
  });

  it("survives null, which is what supabase-js returns on an error", () => {
    expect(parsePayoutItems(null)).toEqual([]);
  });
});

describe("breakdownByPayout", () => {
  it("counts and sums the lessons of the payout's own month", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "30.00" }),
          item({ amount: "30.00", session_date: "2026-08-11" }),
        ])
      ),
      "p1"
    );
    expect(b.lessons).toBe(2);
    expect(b.lessonTotal).toBe(60);
    expect(b.adjustments).toEqual([]);
  });

  // §1.6's silent-money case, seen from the coach's phone: B covered a July
  // lesson that was recorded after July was paid, so the money arrives in
  // August's payout carrying the month it belongs to.
  it("separates a correction for an earlier month from this month's lessons", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "30.00" }),
          item({
            amount: "55.00",
            is_adjustment: true,
            original_period: "2026-07",
          }),
        ])
      ),
      "p1"
    );
    expect(b.lessons).toBe(1);
    expect(b.lessonTotal).toBe(30);
    expect(b.adjustments).toEqual([{ period: "2026-07", amount: 55 }]);
  });

  it("sums several corrections that belong to the same month", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "55.00", is_adjustment: true, original_period: "2026-07" }),
          item({ amount: "-40.00", is_adjustment: true, original_period: "2026-07" }),
        ])
      ),
      "p1"
    );
    // 55 − 40 nets to 15, and one line says so rather than two that need adding.
    expect(b.adjustments).toEqual([{ period: "2026-07", amount: 15 }]);
  });

  it("hides a correction that nets to nothing", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "40.00", is_adjustment: true, original_period: "2026-07" }),
          item({ amount: "-40.00", is_adjustment: true, original_period: "2026-07" }),
        ])
      ),
      "p1"
    );
    expect(b.adjustments).toEqual([]);
  });

  it("orders corrections oldest month first", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "10.00", is_adjustment: true, original_period: "2026-07" }),
          item({ amount: "20.00", is_adjustment: true, original_period: "2026-05" }),
        ])
      ),
      "p1"
    );
    expect(b.adjustments.map((a) => a.period)).toEqual(["2026-05", "2026-07"]);
  });

  it("keeps two coaches' — two payouts' — items apart", () => {
    const map = breakdownByPayout(
      parsePayoutItems([item(), item({ payout_id: "p2", amount: "50.00" })])
    );
    expect(breakdownFor(map, "p1").lessonTotal).toBe(30);
    expect(breakdownFor(map, "p2").lessonTotal).toBe(50);
  });

  it("answers with an empty breakdown for a payout whose items are absent", () => {
    expect(breakdownFor(breakdownByPayout([]), "p9")).toEqual({
      lessons: 0,
      lessonTotal: 0,
      adjustments: [],
    });
  });

  // An adjustment counted as a lesson would report the coach teaching it twice
  // AND make the lesson total disagree with the payout's own gross.
  it("never counts an adjustment as a lesson", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "55.00", is_adjustment: true, original_period: "2026-07" }),
        ])
      ),
      "p1"
    );
    expect(b.lessons).toBe(0);
    expect(b.lessonTotal).toBe(0);
  });

  it("adds money without float drift", () => {
    const b = breakdownFor(
      breakdownByPayout(
        parsePayoutItems([
          item({ amount: "0.10" }),
          item({ amount: "0.20" }),
        ])
      ),
      "p1"
    );
    expect(b.lessonTotal).toBe(0.3);
  });
});

describe("formatting", () => {
  it("names the month a correction belongs to", () => {
    expect(formatPeriod("2026-07")).toBe("July 2026");
  });

  it("says something true when the period is missing", () => {
    expect(formatPeriod(null)).toBe("an earlier month");
    expect(formatPeriod("nonsense")).toBe("an earlier month");
  });

  it("marks money going the other way with a minus sign, not a hyphen", () => {
    expect(formatMoney(55)).toBe("S$55.00");
    expect(formatMoney(-40)).toBe("−S$40.00");
  });

  it("describes a correction in one line", () => {
    expect(describeAdjustment({ period: "2026-07", amount: 55 })).toBe(
      "S$55.00 added for July 2026"
    );
    expect(describeAdjustment({ period: "2026-07", amount: -40 })).toBe(
      "−S$40.00 taken off for July 2026"
    );
  });

  it("pluralises lessons", () => {
    expect(describeLessons(1)).toBe("1 lesson");
    expect(describeLessons(3)).toBe("3 lessons");
  });
});
