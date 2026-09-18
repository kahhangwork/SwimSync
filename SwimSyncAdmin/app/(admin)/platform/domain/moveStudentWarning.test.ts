import { describe, it, expect } from "vitest";
import { totalFamilyCredit } from "./moveStudentWarning";

describe("totalFamilyCredit — the credit a cross-business move would strand", () => {
  it("sums every linked parent's balance (⚠ RISK fable — not just one)", () => {
    expect(
      totalFamilyCredit([{ credit_balance: 40 }, { credit_balance: 12.5 }]),
    ).toBe(52.5);
  });

  it("coerces PostgREST's numeric-as-string", () => {
    expect(totalFamilyCredit([{ credit_balance: "40.00" }])).toBe(40);
  });

  it("treats a null/absent balance as zero", () => {
    expect(totalFamilyCredit([{ credit_balance: null }, { credit_balance: 8 }])).toBe(8);
  });

  it("is zero for a family with no balance rows", () => {
    expect(totalFamilyCredit([])).toBe(0);
  });
});
