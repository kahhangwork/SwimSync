// Characterisation tests (Admin L-C, BATCH_C_PLAN.md): pin the rate/item row
// mapping and the money + line-detail labels as they were inline on
// wages/page.tsx. They pin existing behaviour, so §7.25's prove-it-red rule does
// not apply (playbook §0).
import { describe, it, expect } from "vitest";
import { lineDetail, money, toCoachRow, toPayoutItems } from "./wageRows";
import type { LessonLine } from "./payoutItems";

describe("money", () => {
  it("puts a clawback's minus in front of the currency", () => {
    expect(money(-50)).toBe("−S$50.00");
    expect(money(12.5)).toBe("S$12.50");
    expect(money(0)).toBe("S$0.00");
  });
});

describe("toCoachRow", () => {
  const rate = (amount: string, from: string, role?: string) =>
    ({ amount, unit_minutes: 60, effective_from: from, ...(role ? { role } : {}) });

  it("⚠ the MAIN rate ignores a later-dated SHADOW rate; each takes its own latest", () => {
    const c = toCoachRow({
      id: "c1",
      profiles: [{ full_name: "Coach A" }],
      coach_rates: [
        rate("40", "2026-01-01", "main"),
        rate("45", "2026-06-01"), // role missing reads as main
        rate("20", "2026-08-01", "shadow"),
        rate("15", "2026-02-01", "shadow"),
      ],
    });
    expect(c.name).toBe("Coach A");
    expect(c.rate).toEqual({ amount: 45, unit_minutes: 60, effective_from: "2026-06-01" });
    expect(c.shadowRate).toEqual({ amount: 20, unit_minutes: 60, effective_from: "2026-08-01" });
  });

  it("no rates is 'not on payroll' (null), and a missing profile reads —", () => {
    const c = toCoachRow({ id: "c2", profiles: null, coach_rates: null });
    expect(c).toEqual({ id: "c2", name: "—", rate: null, shadowRate: null });
  });
});

describe("toPayoutItems", () => {
  it("numbers the amount and keeps every field", () => {
    expect(toPayoutItems({ coach_payout_items: [{ id: "i", lesson_session_id: "l", class_title: "T",
      session_date: "2026-09-01", basis: "per_minute", minutes: 45, amount: "30.00",
      is_adjustment: false, original_period: null }] })).toEqual([{ id: "i", lesson_session_id: "l",
      class_title: "T", session_date: "2026-09-01", basis: "per_minute", minutes: 45, amount: 30,
      is_adjustment: false, original_period: null }]);
    expect(toPayoutItems({})).toEqual([]);
  });
});

describe("lineDetail", () => {
  const line = (items: any[], adjustedPeriods: string[] = []) =>
    ({ items, adjustedPeriods } as unknown as LessonLine);

  it("several items read as an entry count; one flat item as the class flat rate", () => {
    expect(lineDetail(line([{}, {}]))).toBe("2 entries");
    expect(lineDetail(line([{ basis: "flat", minutes: 45 }]))).toBe("class flat rate");
  });
  it("minutes when known; an adjustment with no minutes shows none", () => {
    expect(lineDetail(line([{ basis: "per_minute", minutes: 45 }]))).toBe("45 min");
    expect(lineDetail(line([{ basis: "per_minute", minutes: null }], ["2026-07"]))).toBe("correcting 2026-07");
  });
  it("joins minutes and corrected periods with a middle dot", () => {
    expect(lineDetail(line([{ basis: "per_minute", minutes: 30 }], ["2026-06", "2026-07"])))
      .toBe("30 min · correcting 2026-06, 2026-07");
  });
});
