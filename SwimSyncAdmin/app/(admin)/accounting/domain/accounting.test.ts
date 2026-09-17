import { describe, it, expect } from "vitest";
import { moneyOrDash, formatMonth } from "./accounting";

describe("moneyOrDash", () => {
  it("formats a number as SGD with two decimals", () => {
    expect(moneyOrDash(190)).toBe("S$190.00");
    expect(moneyOrDash(10)).toBe("S$10.00");
  });

  it("groups thousands", () => {
    expect(moneyOrDash(1234.5)).toBe("S$1,234.50");
  });

  it("renders a withheld figure (null) as a dash — never S$0", () => {
    // The run_payouts case: null means WITHHELD, and must read as '—', not a
    // number, or it becomes the silent-understatement bug (⚠ RISK 1).
    expect(moneyOrDash(null)).toBe("—");
  });

  it("renders a genuine zero as S$0.00, not a dash", () => {
    // A rate-less tenant's wages ARE 0 — that is a real figure, not withheld.
    expect(moneyOrDash(0)).toBe("S$0.00");
  });

  it("puts a negative sign OUTSIDE the currency marker", () => {
    // Net goes negative when wages exceed revenue.
    expect(moneyOrDash(-1234.5)).toBe("-S$1,234.50");
  });
});

describe("formatMonth", () => {
  it("turns YYYY-MM into a readable month", () => {
    expect(formatMonth("2026-07")).toBe("July 2026");
    expect(formatMonth("2026-01")).toBe("January 2026");
  });

  it("passes a non-YYYY-MM string through unchanged", () => {
    expect(formatMonth("whatever")).toBe("whatever");
  });

  it("passes an out-of-range month through instead of rolling it over", () => {
    // '2026-13' must NOT become 'January 2026' (a silent mislabel).
    expect(formatMonth("2026-13")).toBe("2026-13");
    expect(formatMonth("2026-00")).toBe("2026-00");
  });
});
