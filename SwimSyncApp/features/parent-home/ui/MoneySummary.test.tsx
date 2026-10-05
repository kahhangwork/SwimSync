// MoneySummary — the parent home's Outstanding Payment and Credit Balance cards.
// Pinned: each card renders only when its amount is > 0, shows exactly its own
// amount (distinct fixture values so a swapped amount cannot pass), and the
// outstanding subline says the figure is FAMILY-WIDE — the home card sums every
// child at every business on purpose (WAVE3_RENDER_TESTS_PLAN.md D5; the child
// profile card is the per-business one).
//
// MUTATION PROOFS (§7.25) — each applied to MoneySummary.tsx through mutate.sh
// (restores from HEAD on exit):
//   1. `{totalOutstanding > 0 && (` → `{totalOutstanding >= 0 && (`
//      → RED: "zero outstanding and zero credit render neither card"
//      → RED: "credit only: the outstanding card is absent"
//   2. `{creditBalance > 0 && (` → `{creditBalance >= 0 && (`
//      → RED: "outstanding only: the credit card is absent"
//   3. `S${totalOutstanding.toFixed(2)}` → `S${creditBalance.toFixed(2)}`
//      → RED: "outstanding card shows exactly its amount and says it is family-wide"
//   4. `S${creditBalance.toFixed(2)}` → `S${totalOutstanding.toFixed(2)}`
//      → RED: "credit card shows exactly its amount"
//   5. `Across all children — tap an invoice to pay` → `For this child — tap an invoice to pay`
//      → RED: "outstanding card shows exactly its amount and says it is family-wide"
import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import { MoneySummary } from "./MoneySummary";

type ReactTestInstance = ReturnType<typeof screen.getByText>;

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

/** The n-th HOST ancestor of an element (composite wrappers skipped). */
function hostAncestor(el: ReactTestInstance, n: number): ReactTestInstance {
  let node = el;
  while (n > 0) {
    node = node.parent!;
    if (typeof node.type === "string") n--;
  }
  return node;
}

/** The Card a title sits in: title Text → its icon row → the Card. */
function cardOf(title: string) {
  return hostAncestor(screen.getByText(title), 2);
}

describe("MoneySummary", () => {
  it("outstanding card shows exactly its amount and says it is family-wide", () => {
    render(<MoneySummary totalOutstanding={120} creditBalance={35.5} />);
    const card = within(cardOf("Outstanding Payment"));
    expect(card.getByText("S$120.00")).toBeTruthy();
    expect(card.queryByText("S$35.50")).toBeNull();
    expect(card.getByText("Across all children — tap an invoice to pay")).toBeTruthy();
  });

  it("credit card shows exactly its amount", () => {
    render(<MoneySummary totalOutstanding={120} creditBalance={35.5} />);
    const card = within(cardOf("Credit Balance"));
    expect(card.getByText("S$35.50")).toBeTruthy();
    expect(card.queryByText("S$120.00")).toBeNull();
    expect(card.getByText("Will be applied to your next invoice automatically")).toBeTruthy();
  });

  it("zero outstanding and zero credit render neither card", () => {
    render(<MoneySummary totalOutstanding={0} creditBalance={0} />);
    expect(screen.queryByText("Outstanding Payment")).toBeNull();
    expect(screen.queryByText("Credit Balance")).toBeNull();
  });

  it("outstanding only: the credit card is absent", () => {
    render(<MoneySummary totalOutstanding={120} creditBalance={0} />);
    expect(screen.getByText("Outstanding Payment")).toBeTruthy();
    expect(screen.getByText("S$120.00")).toBeTruthy();
    expect(screen.queryByText("Credit Balance")).toBeNull();
  });

  it("credit only: the outstanding card is absent", () => {
    render(<MoneySummary totalOutstanding={0} creditBalance={35.5} />);
    expect(screen.getByText("Credit Balance")).toBeTruthy();
    expect(screen.getByText("S$35.50")).toBeTruthy();
    expect(screen.queryByText("Outstanding Payment")).toBeNull();
  });
});
