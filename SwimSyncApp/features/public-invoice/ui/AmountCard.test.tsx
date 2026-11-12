import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AmountCard } from "./AmountCard";
import type { PublicInvoice } from "../types";

// The public payment page (OVERDUE_INVOICES_PLAN.md Unit 4): the due line comes
// from public-invoice's due_date / is_overdue through lib/invoiceTag — Claimed
// beats Overdue (D4), a paid invoice shows none.
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: AmountCard test reached the real supabase client");
});

const inv = (over: Partial<PublicInvoice> = {}): PublicInvoice => ({
  business_name: "Orcas", paynow_uen: null, paynow_mobile: "91234567",
  reference: "INV-2026-0001", amount: 90, billing_month: "2026-10",
  status: "outstanding", paid_claimed_at: null, due_date: "2026-11-26",
  is_overdue: false, students: ["Ava"], ...over,
});

function setup(invoice: PublicInvoice) {
  const paid = invoice.status !== "outstanding";
  render(
    <AmountCard invoice={invoice} paid={paid} qrDataUrl={null} saveQr={jest.fn()}
      claimed={!!invoice.paid_claimed_at} claiming={false} claimPaid={jest.fn()} />
  );
}

it("an outstanding invoice says when it is due", () => {
  setup(inv());
  expect(screen.getByText("Due 26 Nov")).toBeTruthy();
});

it("past its due date it reads Overdue, in red", () => {
  setup(inv({ is_overdue: true }));
  expect(String(screen.getByText("Overdue — was due 26 Nov").props.className)).toContain(
    "text-status-danger-text"
  );
});

it("claimed beats overdue; paid shows no due line", () => {
  setup(inv({ is_overdue: true, paid_claimed_at: "2026-11-27T02:00:00Z" }));
  expect(screen.queryByText(/Overdue/)).toBeNull();
  expect(screen.getByText("Due 26 Nov")).toBeTruthy();
});

it("a paid invoice shows no due line", () => {
  setup(inv({ status: "paid" }));
  expect(screen.queryByText(/Due 26 Nov|was due/)).toBeNull();
});
