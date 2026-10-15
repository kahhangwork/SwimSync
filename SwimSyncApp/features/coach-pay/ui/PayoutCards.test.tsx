// PayoutCards — the coach's own pay (UI restyle step 2.6). Pinned: every figure is
// the payout's / the breakdown's own, printed as-is (plan 2.6 RISK 2: never a
// total recomputed in the UI); the amount is Ink, never green; the state is a
// tag — Paid = Success, Draft = neutral; a correction to a paid month still shows.
//
// MUTATION PROOFS (§7.25) — each applied to PayoutCards.tsx, run, reverted:
//   1. `formatSgd(p.gross_amount)` → `formatSgd(b.lessonTotal)`
//      → RED: "prints each payout's own figures"
//   2. `tone={paid ? "success" : "neutral"}` → `tone="neutral"`
//      → RED: "Paid is a Success tag, Draft a neutral one; money is Ink"
//   3. Deleted the `b.adjustments.map(…)` block
//      → RED: "a correction to an already-paid month is shown"
//   4. RED FIRST against the pre-lib/money.ts `S${….toFixed(2)}` (BACKLOG *UI restyle
//      leftovers*): "a four-figure month has a thousands separator"
//      → Unable to find an element with text: S$1,260.00
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { PayoutCards } from "./PayoutCards";
import type { PayoutBreakdown } from "@/lib/payoutBreakdown";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const payouts = [
  { id: "p1", period_month: "2026-09-01", gross_amount: 120, status: "paid" as const },
  { id: "p2", period_month: "2026-10-01", gross_amount: 80, status: "draft" as const },
];
const breakdowns = new Map<string, PayoutBreakdown>([
  ["p1", { lessons: 3, lessonTotal: 110, adjustments: [{ period: "2026-08-01", amount: 10 }] } as PayoutBreakdown],
  ["p2", { lessons: 2, lessonTotal: 80, adjustments: [] } as PayoutBreakdown],
]);

describe("PayoutCards", () => {
  it("prints each payout's own figures", () => {
    render(<PayoutCards myPayouts={payouts} breakdowns={breakdowns} />);
    expect(screen.getByText("S$120.00")).toBeTruthy();
    expect(screen.getByText("S$80.00")).toBeTruthy();
    expect(screen.getByText(/3 lessons · S\$\s*110\.00/)).toBeTruthy();
  });

  it("Paid is a Success tag, Draft a neutral one; money is Ink", () => {
    render(<PayoutCards myPayouts={payouts} breakdowns={breakdowns} />);
    expect(screen.getByText("Paid").props.className).toContain("text-status-success-text");
    expect(screen.getByText("Draft").props.className).toContain("text-status-neutral-text");
    expect(screen.getByText("S$120.00").props.className).toContain("text-ink");
    expect(screen.getByText("S$120.00").props.className).not.toMatch(/green|success/);
  });

  it("a four-figure month has a thousands separator", () => {
    const big = [{ id: "p3", period_month: "2026-09-01", gross_amount: 1260, status: "paid" as const }];
    const bigBreakdown = new Map<string, PayoutBreakdown>([
      ["p3", { lessons: 21, lessonTotal: 1260, adjustments: [] } as PayoutBreakdown],
    ]);
    render(<PayoutCards myPayouts={big} breakdowns={bigBreakdown} />);
    expect(screen.getByText("S$1,260.00")).toBeTruthy();
    expect(screen.getByText(/21 lessons · S\$1,260\.00/)).toBeTruthy();
  });

  it("a correction to an already-paid month is shown", () => {
    render(<PayoutCards myPayouts={payouts} breakdowns={breakdowns} />);
    expect(screen.getByText(/^Includes /)).toBeTruthy();
  });
});
