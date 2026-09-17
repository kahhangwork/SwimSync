// Characterisation test (Admin L-C, BATCH_C_PLAN.md): pins the summary-row
// mapping as it was inline on accounting/page.tsx. It pins existing behaviour,
// so §7.25's prove-it-red rule does not apply (playbook §0).
import { describe, it, expect } from "vitest";
import { toSummary } from "./summaryRow";

describe("toSummary", () => {
  it("no row is null (the page then shows loading, never zeros)", () => {
    expect(toSummary(undefined)).toBeNull();
  });

  it("numeric strings become numbers", () => {
    const s = toSummary({ revenue: "190.00", net: "-5.50", wages_state: "final" })!;
    expect(s.revenue).toBe(190);
    expect(s.net).toBe(-5.5);
    expect(s.wages_state).toBe("final");
  });

  it("a withheld figure (null / missing) stays null, never 0", () => {
    const s = toSummary({ wages: null, wages_state: "run_payouts" })!;
    expect(s.wages).toBeNull();
    expect(s.net).toBeNull(); // key absent on the row
  });
});
