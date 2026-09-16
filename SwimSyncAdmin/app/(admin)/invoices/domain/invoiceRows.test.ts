// Characterisation tests for invoiceRows.ts — they pin the mapping/filter/label
// behaviour the Invoices page ALREADY had before Stage 4 (docs/refactor/
// INVOICES_REFACTOR_PLAN.md). Not §7.25 prove-red tests: the behaviour
// pre-exists; these lock it so the extraction cannot change it.

import { describe, expect, it } from "vitest";
import {
  formatBillingMonth,
  mapInvoiceRow,
  filterInvoices,
  invoiceLink,
  totalOutstanding,
} from "./invoiceRows";
import type { InvoiceRow } from "../types";

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "i1",
    billing_month: "2026-07",
    gross_amount: 100,
    package_applied: 0,
    credit_applied: 0,
    balance_adjustment: 0,
    net_amount: 100,
    status: "outstanding",
    parent_name: "Alice",
    student_names: "Bob",
    reference_number: "INV-2026-0001",
    public_token: "tok",
    reminded_at: null,
    paid_claimed_at: null,
    wa_number: "6591234567",
    raw_phone: "91234567",
    student_name_list: ["Bob"],
    ...overrides,
  };
}

describe("formatBillingMonth", () => {
  it("renders YYYY-MM as short month + year", () => {
    expect(formatBillingMonth("2026-07")).toBe("Jul 2026");
    expect(formatBillingMonth("2026-12")).toBe("Dec 2026");
  });
});

describe("mapInvoiceRow", () => {
  it("flattens embeds, de-dupes student names, coerces amounts to Number", () => {
    const mapped = mapInvoiceRow({
      id: "i9",
      billing_month: "2026-08",
      gross_amount: "80",
      package_applied: "10",
      credit_applied: "5",
      balance_adjustment: null,
      net_amount: "65",
      status: "paid",
      reference_number: "INV-2026-0009",
      public_token: "abc",
      reminded_at: "2026-08-01T00:00:00Z",
      paid_claimed_at: null,
      parents: { profiles: { full_name: "Carol", phone: "98765432" } },
      invoice_items: [
        { student_name: "Dave", students: { full_name: "ignored" } },
        { student_name: null, students: { full_name: "Eve" } },
        { student_name: "Dave", students: null }, // duplicate collapses
      ],
    });
    expect(mapped.gross_amount).toBe(80);
    expect(mapped.balance_adjustment).toBe(0);
    expect(mapped.parent_name).toBe("Carol");
    expect(mapped.student_names).toBe("Dave, Eve");
    expect(mapped.student_name_list).toEqual(["Dave", "Eve"]);
    expect(mapped.wa_number).toBe("6598765432");
  });

  it("falls back to em-dashes when embeds are missing", () => {
    const mapped = mapInvoiceRow({
      id: "i0",
      billing_month: "2026-08",
      gross_amount: 0,
      package_applied: 0,
      credit_applied: 0,
      net_amount: 0,
      status: "outstanding",
      invoice_items: [],
    });
    expect(mapped.parent_name).toBe("—");
    expect(mapped.student_names).toBe("—");
    expect(mapped.reference_number).toBe("—");
    expect(mapped.public_token).toBe("");
    expect(mapped.wa_number).toBeNull();
  });
});

describe("filterInvoices", () => {
  const rows = [
    row({ id: "a", parent_name: "Alice", student_names: "Bob", status: "outstanding", paid_claimed_at: null }),
    row({ id: "b", parent_name: "Zoe", student_names: "Yan", status: "paid", paid_claimed_at: null }),
    row({ id: "c", parent_name: "Cara", student_names: "Bobby", status: "outstanding", paid_claimed_at: "2026-08-01T00:00:00Z" }),
  ];

  it("student search matches on student_names, case-insensitive; parent search does not filter here", () => {
    expect(filterInvoices(rows, "student", "bob", "All").map((r) => r.id)).toEqual(["a", "c"]);
    // parent search is a DB pushdown, so client-side it is a no-op
    expect(filterInvoices(rows, "parent", "alice", "All").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("status filter: Paid / Outstanding / Claimed", () => {
    expect(filterInvoices(rows, "student", "", "Paid").map((r) => r.id)).toEqual(["b"]);
    expect(filterInvoices(rows, "student", "", "Outstanding").map((r) => r.id)).toEqual(["a", "c"]);
    // Claimed = outstanding AND paid_claimed_at set
    expect(filterInvoices(rows, "student", "", "Claimed").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("invoiceLink", () => {
  it("builds the tokenized public invoice URL", () => {
    expect(invoiceLink(row({ public_token: "xyz" }))).toBe(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "https://swimsync.sg"}/invoice/xyz`
    );
  });
});

describe("totalOutstanding", () => {
  it("sums net_amount of outstanding invoices only", () => {
    expect(
      totalOutstanding([
        row({ status: "outstanding", net_amount: 40 }),
        row({ status: "paid", net_amount: 100 }),
        row({ status: "outstanding", net_amount: 2.5 }),
      ])
    ).toBe(42.5);
  });
});
