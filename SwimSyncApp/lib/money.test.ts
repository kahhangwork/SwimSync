// formatSgd — the app's one money formatter.
//
// MUTATION PROOFS (§7.25) — each applied to money.ts by hand, restored after:
//   1. drop the grouping replace          → RED: "groups thousands with commas" (+2 more)
//   2. `n < 0 ? "−"` → `n < 0 ? "-"`      → RED: "marks negatives with a minus sign, not a hyphen"
//   3. `Math.abs(n)` → `n`                → RED: "marks negatives…" (prints "−S$-40.00")
// `Number(amount)` → `amount as number` stays GREEN: Math.abs and `<` coerce a string
// anyway. The string test pins the CONTRACT (callers may pass one), not that line.
import { formatSgd } from "./money";

describe("formatSgd", () => {
  it("prints two decimals", () => {
    expect(formatSgd(0)).toBe("S$0.00");
    expect(formatSgd(55)).toBe("S$55.00");
    expect(formatSgd(35.5)).toBe("S$35.50");
  });

  it("groups thousands with commas", () => {
    expect(formatSgd(999.99)).toBe("S$999.99");
    expect(formatSgd(1260)).toBe("S$1,260.00");
    expect(formatSgd(1234567.8)).toBe("S$1,234,567.80");
  });

  it("marks negatives with a minus sign, not a hyphen", () => {
    expect(formatSgd(-40)).toBe("−S$40.00");
    expect(formatSgd(-1260)).toBe("−S$1,260.00");
  });

  it("accepts PostgREST's numeric strings", () => {
    expect(formatSgd("1260.5")).toBe("S$1,260.50");
  });
});
