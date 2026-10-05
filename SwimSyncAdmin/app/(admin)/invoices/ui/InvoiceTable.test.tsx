import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { InvoiceTable } from "./InvoiceTable";
import type { InvoiceRow } from "../types";

// InvoiceTable — the admin's billing list. Pure props; the reads and writes live
// in useInvoiceList. What is load-bearing here (docs/plans/WAVE3_RENDER_TESTS_PLAN.md 1.1):
//   • the Package and Credit columns are DEDUCTIONS: −S$ (U+2212), each in its
//     own column — a swap or a dropped sign reads a refund as a charge;
//   • Mark Paid exists only on an OUTSTANDING row, and acts on THAT row;
//   • the busy state disables only the row being saved;
//   • the "parent says paid" / "chat opened" stamps are SGT dates, and only on an
//     outstanding row (on a paid row they are history, not a to-do);
//   • a failed load says the list is incomplete; the capped notice never
//     stands beside it; "no number" is a visible state, not a broken button.
// Fixture money values are DISTINCT per column so a text match cannot hit the
// wrong cell (plan rule, RISK 8).
//
// MUTATION PROOFS (§7.25) — each applied to InvoiceTable.tsx through the lane's
// mutate.sh (TZ=UTC, restore from HEAD on exit), each RED with the named test:
//   1. credit cell `inv.credit_applied` → `inv.package_applied`
//      → RED: "Package and Credit are each a −S$ deduction in their own column"
//   2. credit cell `−S$` → `S$` (sign dropped)
//      → RED: "Package and Credit are each a −S$ deduction in their own column"
//   3. `{inv.status === "outstanding" && (\n                    <div className="flex` → `{true && (`
//      → RED: "Mark Paid appears only on outstanding rows"
//   4. `onClick={() => onMarkPaid(inv.id)}` → `onClick={() => onMarkPaid(visible[0].id)}`
//      → RED: "Mark Paid acts on THAT row, once"
//   5. `disabled={markingPaid === inv.id}` → `disabled={markingPaid !== null}`
//      → RED: "while one row saves, only that row is busy"
//   6. `formatSgStamp(inv.paid_claimed_at, DMY)` →
//      `new Date(inv.paid_claimed_at).toLocaleDateString("en-SG", DMY)` (viewer-local)
//      → RED under TZ=UTC: "the parent-claimed stamp is the SGT date, on outstanding rows only"
//   7. `inv.status === "outstanding" && inv.paid_claimed_at` → `inv.paid_claimed_at`
//      → RED: "the parent-claimed stamp is the SGT date, on outstanding rows only"
//   8. `formatSgStamp(inv.reminded_at, DMY)}\n` (the stamp line) → viewer-local, as 6
//      → RED under TZ=UTC: "the chat-opened stamp is the SGT date, on outstanding rows only"
//   9. `onClick={() => onWhatsApp(inv)}` → `onClick={() => onWhatsApp(visible[0])}`
//      → RED: "WhatsApp and Link act on THAT row"
//  10. `{loadError && (` → `{false && (`
//      → RED: "a failed load says the list is incomplete, and hides the capped notice"
//  11. `!loading && !loadError && capped` → `!loading && capped`
//      → RED: "a failed load says the list is incomplete, and hides the capped notice"
//  12. `{inv.wa_number ? (` → `{true ? (`
//      → RED: "no usable number reads 'no number', never a WhatsApp button"
//
// NOTE the dev Mac runs at +08: proofs 6 and 8 cannot go red there. They were
// recorded under TZ=UTC (mutate.sh forces it; CI runs in UTC too).

type Props = ComponentProps<typeof InvoiceTable>;

// An SGT-midnight-straddling stamp: 01/10/2026 in Singapore, 30/09/2026 in UTC.
const STAMP = "2026-09-30T17:30:00Z";

function inv(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    billing_month: "2026-09",
    gross_amount: 120,
    package_applied: 15,
    credit_applied: 20,
    balance_adjustment: 0,
    net_amount: 85,
    status: "outstanding",
    parent_name: "Alice Tan",
    student_names: "Ben Tan",
    reference_number: "INV-2026-0001",
    public_token: "tok-1",
    reminded_at: null,
    paid_claimed_at: null,
    wa_number: "6591234567",
    raw_phone: "91234567",
    student_name_list: ["Ben Tan"],
    ...over,
  };
}

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    loading: false,
    loadError: null,
    capped: false,
    searchField: "parent",
    search: "",
    visible: [inv()],
    sort: { key: null, dir: "asc", toggle: vi.fn(), apply: (r) => [...r] },
    markingPaid: null,
    copiedLink: null,
    onMarkPaid: vi.fn(),
    onWhatsApp: vi.fn(),
    onCopyLink: vi.fn(),
    ...over,
  };
  const { unmount } = render(<InvoiceTable {...props} />);
  return { ...props, unmount };
}

/** Body rows only — row 0 is the header. */
function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

function cells(row: HTMLElement) {
  return within(row).getAllByRole("cell");
}

describe("InvoiceTable", () => {
  it("Package and Credit are each a −S$ deduction in their own column", () => {
    setup({
      visible: [
        inv({ id: "inv-1" }),
        inv({ id: "inv-2", package_applied: 0, credit_applied: 0, net_amount: 120 }),
      ],
    });
    const [withBoth, withNone] = bodyRows();
    const a = cells(withBoth);
    expect(a[3].textContent).toBe("S$120.00");
    expect(a[4].textContent).toBe("−S$15.00");
    expect(a[5].textContent).toBe("−S$20.00");
    expect(a[6].textContent).toBe("S$85.00");
    const b = cells(withNone);
    expect(b[4].textContent).toBe("—");
    expect(b[5].textContent).toBe("—");
  });

  it("the status chip reads Outstanding or Paid", () => {
    setup({
      visible: [inv({ id: "inv-1" }), inv({ id: "inv-2", status: "paid" })],
    });
    const [o, p] = bodyRows();
    expect(cells(o)[7].textContent).toBe("Outstanding");
    expect(cells(p)[7].textContent).toBe("Paid");
  });

  it("Mark Paid appears only on outstanding rows", () => {
    setup({
      visible: [inv({ id: "inv-1" }), inv({ id: "inv-2", status: "paid" })],
    });
    const [o, p] = bodyRows();
    expect(within(o).getByRole("button", { name: /Mark Paid/ })).toBeTruthy();
    expect(within(p).queryByRole("button", { name: /Mark Paid/ })).toBeNull();
    // A paid row carries no action at all — no WhatsApp, no Link.
    expect(within(p).queryAllByRole("button")).toEqual([]);
  });

  it("Mark Paid acts on THAT row, once", () => {
    const props = setup({
      visible: [
        inv({ id: "inv-1", parent_name: "Alice Tan" }),
        inv({ id: "inv-2", parent_name: "Chen Wei" }),
        inv({ id: "inv-3", parent_name: "Dana Lim" }),
      ],
    });
    fireEvent.click(within(bodyRows()[1]).getByRole("button", { name: /Mark Paid/ }));
    expect(props.onMarkPaid).toHaveBeenCalledTimes(1);
    expect(props.onMarkPaid).toHaveBeenCalledWith("inv-2");
  });

  it("while one row saves, only that row is busy", () => {
    setup({
      visible: [inv({ id: "inv-1" }), inv({ id: "inv-2" }), inv({ id: "inv-3" })],
      markingPaid: "inv-2",
    });
    const buttons = bodyRows().map(
      (r) => within(r).getAllByRole("button")[0] as HTMLButtonElement
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["Mark Paid", "Saving…", "Mark Paid"]);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, false]);
  });

  it("the parent-claimed stamp is the SGT date, on outstanding rows only", () => {
    setup({
      visible: [
        inv({ id: "inv-1", paid_claimed_at: STAMP }),
        inv({ id: "inv-2", status: "paid", paid_claimed_at: STAMP }),
        inv({ id: "inv-3" }),
      ],
    });
    const [claimed, paid, unclaimed] = bodyRows();
    expect(within(claimed).getByText("parent says paid 01/10/2026")).toBeTruthy();
    expect(within(paid).queryByText(/parent says paid/)).toBeNull();
    expect(within(unclaimed).queryByText(/parent says paid/)).toBeNull();
  });

  it("the chat-opened stamp is the SGT date, on outstanding rows only", () => {
    setup({
      visible: [
        inv({ id: "inv-1", reminded_at: STAMP }),
        inv({ id: "inv-2", status: "paid", reminded_at: STAMP }),
        inv({ id: "inv-3" }),
      ],
    });
    const [reminded, paid, never] = bodyRows();
    expect(within(reminded).getByText("chat opened 01/10/2026")).toBeTruthy();
    expect(within(paid).queryByText(/chat opened/)).toBeNull();
    expect(within(never).queryByText(/chat opened/)).toBeNull();
  });

  it("WhatsApp and Link act on THAT row", () => {
    const rows = [
      inv({ id: "inv-1", parent_name: "Alice Tan" }),
      inv({ id: "inv-2", parent_name: "Chen Wei" }),
    ];
    const props = setup({ visible: rows, copiedLink: "inv-2" });
    const second = bodyRows()[1];
    fireEvent.click(within(second).getByRole("button", { name: /WhatsApp/ }));
    fireEvent.click(within(second).getByRole("button", { name: /Copied/ }));
    expect(props.onWhatsApp).toHaveBeenCalledTimes(1);
    expect(props.onWhatsApp).toHaveBeenCalledWith(rows[1]);
    expect(props.onCopyLink).toHaveBeenCalledTimes(1);
    expect(props.onCopyLink).toHaveBeenCalledWith(rows[1]);
    // Only the copied row says so.
    expect(within(bodyRows()[0]).getByRole("button", { name: /Link/ }).textContent).toBe("Link");
  });

  it("no usable number reads 'no number', never a WhatsApp button", () => {
    setup({ visible: [inv({ wa_number: null })] });
    const row = bodyRows()[0];
    expect(within(row).getByText("no number")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /WhatsApp/ })).toBeNull();
  });

  it("a failed load says the list is incomplete, and hides the capped notice", () => {
    setup({ loadError: "boom", capped: true });
    expect(screen.getByText(/Could not load the invoices: boom\./).textContent).toContain(
      "do not read it as the full set"
    );
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("a capped list says how to reach past the limit", () => {
    setup({ capped: true });
    expect(screen.getByText(/Showing the first/).textContent).toBe(
      "Showing the first 1000 invoices. Search by parent to reach invoices past this limit."
    );
  });

  it("loading and empty each have their own line", () => {
    const { unmount } = setup({ loading: true });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Alice Tan")).toBeNull();
    unmount();
    setup({ visible: [] });
    expect(screen.getByText("No invoices found.")).toBeTruthy();
  });
});
