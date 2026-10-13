// The parent Invoice Detail cards after UI restyle step 3.2. Pinned: the lesson
// line counts the invoice's lines ("3 lessons", "1 lesson", and "Lessons" — never
// "0 lessons" — for a line-less invoice); every amount is its own field; an invoice
// with no lines says so (BACKLOG S6: the breakdown used to render an empty card).
//
// MUTATION PROOFS (§7.25) — each applied to the named file and run red:
//   1. SummaryCard: `n === 1 ? "lesson" : "lessons"` → `"lessons"`
//      → RED: "one line reads 1 lesson"
//   2. SummaryCard: `n > 0 ? … : "Lessons"` → `${n} lessons` unconditionally
//      → RED: "a line-less invoice says so, and never 0 lessons"
//   3. LineItemsCard: the empty-state Text removed (`invoice.items.length === 0 ? null`)
//      → RED: "a line-less invoice says so, and never 0 lessons"
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SummaryCard } from "./SummaryCard";
import { LineItemsCard } from "./LineItemsCard";
import type { InvoiceDetail, InvoiceItem } from "../types";

jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: invoice detail cards reached the real supabase client");
});

const item = (id: string, amount: number): InvoiceItem => ({
  id, student_name: "Ava", class_title: "Dolphins", session_date: "2026-09-05",
  attendance_status: "present", amount, funded_by: null,
});

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: "i1", reference_number: "INV-2026-0001", billing_month: "2026-09",
  gross_amount: 105, package_applied: 0, credit_applied: 15, balance_adjustment: 0,
  net_amount: 90, status: "outstanding", generated_at: "2026-10-01T01:00:00Z",
  paid_at: null, paid_claimed_at: null,
  items: [item("a", 35), item("b", 35), item("c", 35)],
  credit_notes: [], coach_id: null, business_name: "Orcas", ...over,
});

it("counts the lines and prints each field as-is", () => {
  render(<SummaryCard invoice={invoice()} />);
  expect(screen.getByText("3 lessons")).toBeTruthy();
  expect(screen.getByText("S$105.00")).toBeTruthy();
  expect(screen.getByText("Credit")).toBeTruthy();
  expect(screen.getByText("−S$15.00")).toBeTruthy();
  expect(screen.getByText("To pay")).toBeTruthy();
  expect(screen.getByText("S$90.00")).toBeTruthy();
  expect(screen.queryByText(/Gross|Net Payable/)).toBeNull();
});

it("one line reads 1 lesson", () => {
  render(<SummaryCard invoice={invoice({ items: [item("a", 35)] })} />);
  expect(screen.getByText("1 lesson")).toBeTruthy();
});

it("a line-less invoice says so, and never 0 lessons", () => {
  const empty = invoice({ items: [] });
  render(
    <>
      <SummaryCard invoice={empty} />
      <LineItemsCard invoice={empty} />
    </>
  );
  expect(screen.getByText("Lessons")).toBeTruthy();
  expect(screen.queryByText(/0 lessons/)).toBeNull();
  expect(screen.getByText("No lessons are listed on this invoice.")).toBeTruthy();
});
