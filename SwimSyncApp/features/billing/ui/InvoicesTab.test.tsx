// InvoicesTab — the parent's invoice card after UI restyle step 3.1 (DESIGN.md's
// Pay-First and Plain Words rules). Pinned: each money line prints exactly its own
// field (distinct values, so a swapped field cannot pass) under the parent's words;
// a claimed invoice is tagged Claimed, never Paid, and still offers Pay; the claim
// is offered only until it is made.
//
// MUTATION PROOFS (§7.25) — each applied to InvoicesTab.tsx and run red:
//   1. `S$${inv.gross_amount.toFixed(2)}` → `S$${inv.net_amount.toFixed(2)}`
//      → RED: "each money line is its own field, in the parent's words"
//   2. `claimed ? "Claimed" : outstanding` → `outstanding`
//      → RED: "a claimed invoice is tagged Claimed and still offers Pay"
//   3. `label={outstanding ? "To pay" : "Total"}` → `label="Net Amount"`
//      → RED: "each money line is its own field, in the parent's words"
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { InvoicesTab } from "./InvoicesTab";
import type { Invoice } from "../types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: InvoicesTab test reached the real supabase client");
});

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: "i1",
  reference_number: "INV-2026-0001",
  billing_month: "2026-09",
  gross_amount: 120,
  package_applied: 20,
  credit_applied: 10,
  net_amount: 90,
  status: "outstanding",
  paid_claimed_at: null,
  tenant_id: "tA",
  business_name: "Orcas",
  ...over,
});

function setup(invoice: Invoice) {
  render(<InvoicesTab invoices={[invoice]} claimPaid={jest.fn()} claimingId={null} />);
}

it("each money line is its own field, in the parent's words", () => {
  setup(inv());
  expect(screen.getByText("Lessons")).toBeTruthy();
  expect(screen.getByText("S$120.00")).toBeTruthy();
  expect(screen.getByText("Package")).toBeTruthy();
  expect(screen.getByText("−S$20.00")).toBeTruthy();
  expect(screen.getByText("Credit")).toBeTruthy();
  expect(screen.getByText("−S$10.00")).toBeTruthy();
  expect(screen.getByText("To pay")).toBeTruthy();
  expect(screen.getByText("S$90.00")).toBeTruthy();
  expect(screen.queryByText(/Gross|Net/)).toBeNull();
});

it("an unpaid, unclaimed invoice is Outstanding and offers Pay, then the claim link", () => {
  setup(inv());
  expect(screen.getByText("Outstanding")).toBeTruthy();
  expect(screen.getByText("Pay via PayNow")).toBeTruthy();
  expect(screen.getByText("I've paid")).toBeTruthy();
});

it("a claimed invoice is tagged Claimed and still offers Pay", () => {
  setup(inv({ paid_claimed_at: "2026-10-01T02:00:00Z" }));
  expect(screen.getByText("Claimed")).toBeTruthy();
  expect(screen.queryByText("Outstanding")).toBeNull();
  expect(screen.queryByText("Paid")).toBeNull();
  expect(screen.getByText("Pay via PayNow")).toBeTruthy();
  expect(screen.queryByText("I've paid")).toBeNull();
});

it("a paid invoice shows Paid and Total, and no pay actions", () => {
  setup(inv({ status: "paid", net_amount: 90 }));
  expect(screen.getByText("Paid")).toBeTruthy();
  expect(screen.getByText("Total")).toBeTruthy();
  expect(screen.queryByText("Pay via PayNow")).toBeNull();
  expect(screen.queryByText("I've paid")).toBeNull();
});
