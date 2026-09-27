import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { HeldTable } from "./HeldTable";
import type { Purchase } from "../types";

// HeldTable — "Who holds one". Each row is a package with money on it: the
// admin reconciles by reference, reads the LIVE balance (attended-not-yet-
// invoiced lessons already subtracted, flagged with *), and Extend/Cancel act on
// that one package. Pinned:
//   • rows show parent, children, package, reference and status;
//   • the live balance is used for an active package and the * appears only
//     when it differs from the invoiced balance;
//   • an expired active package says so (todayInSg, §7.7);
//   • Extend/Cancel exist ONLY on active rows and act on that row; busy locks them;
//   • the three empty states are distinct (loading / nobody / no match) and the
//     truncation notice shows when capped.
//
// MUTATION PROOFS (§7.25) — each applied to HeldTable.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `{p.status === "active" && (` (action cell) → `{true && (`
//      → RED: "Extend/Cancel only on an active package, and they act on that row"
//   2. `onClick={() => openExtend(p)}` → `openExtend(visibleHeld[0])`
//      → RED: "Extend/Cancel only on an active package, and they act on that row"
//   3. `{p.live_lessons_remaining} lesson` → `{p.lesson_count} lesson`
//      → RED: "an active package shows its LIVE balance …"
//   4. `p.expires_on < todayInSg()` → `p.expires_on > todayInSg()`
//      → RED: "an active package past its expiry says expired; a future one does not"
//   5. no-match branch `heldMatches.length === 0 ?` → `false ?`
//      → RED: "the three empty states are distinct"
//   6. `{!loading && capped && (` → `{false && (`
//      → RED: "a capped fetch is never a silent slice"
//   7. `disabled={busy}` on Cancel → removed
//      → RED: "busy locks Extend and Cancel"

function purchase(over: Partial<Purchase>): Purchase {
  return {
    id: "p1",
    parent_id: "par1",
    parent_name: "Alice Tan",
    name: "10-lesson pack",
    category_name: "Tadpoles",
    lesson_count: 10,
    rate_per_lesson: 30,
    total_value: 300,
    amount_payable: 300,
    discount_amount: 0,
    value_remaining: 240,
    live_value_remaining: 180,
    live_lessons_remaining: 6,
    status: "active",
    confirmed_at: null,
    product_id: "prod1",
    requested_at: "2026-08-01T02:00:00Z",
    start_date: "2026-08-02",
    expires_on: "2099-12-31",
    holiday_extension_days: 0,
    cancel_extension_days: 0,
    manual_extension_days: 0,
    reference_number: "PKG-2026-0001",
    offered_by: null,
    paid_claimed_at: null,
    superseded_by: null,
    public_token: null,
    children: "Mia, Max",
    ...over,
  };
}

const ALICE = purchase({});
const BOB = purchase({
  id: "p2",
  parent_name: "Bob Lim",
  reference_number: "PKG-2026-0002",
  status: "exhausted",
  value_remaining: 0,
  live_value_remaining: null,
  live_lessons_remaining: null,
  children: null,
  category_name: null,
});
const CAROL = purchase({
  id: "p3",
  parent_name: "Carol Ng",
  reference_number: "PKG-2026-0003",
  expires_on: "2020-01-31",
  // Live equals invoiced → no asterisk.
  value_remaining: 90,
  live_value_remaining: 90,
  live_lessons_remaining: 3,
  children: null,
  holiday_extension_days: 1,
  cancel_extension_days: 2,
});

type Props = ComponentProps<typeof HeldTable>;
function setup(over: Partial<Props> = {}) {
  const held = over.held ?? [ALICE, BOB, CAROL];
  const props: Props = {
    held,
    heldMatches: held,
    heldSearch: "",
    setHeldSearch: vi.fn(),
    loading: false,
    capped: false,
    busy: false,
    openExtend: vi.fn(),
    setCancelling: vi.fn(),
    setSaleModal: vi.fn(),
    refunds: new Map(),
    canEdit: true,
    openRefund: vi.fn(),
    openReverse: vi.fn(),
    ...over,
  };
  const utils = render(<HeldTable {...props} />);
  return { props, ...utils };
}

const row = (name: string) => within(screen.getByText(name).closest("tr")!);

describe("HeldTable", () => {
  it("rows show parent, children, package, reference and status", () => {
    setup();
    const alice = row("Alice Tan");
    expect(alice.getByText("Mia, Max")).toBeTruthy();
    expect(alice.getByText("PKG-2026-0001")).toBeTruthy();
    expect(alice.getByText("Active")).toBeTruthy();
    expect(alice.getByText(/Tadpoles/)).toBeTruthy();
    const bob = row("Bob Lim");
    expect(bob.getByText("PKG-2026-0002")).toBeTruthy();
    expect(bob.getByText("Exhausted")).toBeTruthy();
    expect(bob.getByText(/all classes/)).toBeTruthy();
  });

  it("an active package shows its LIVE balance, flagged * when it differs from the invoiced one", () => {
    setup();
    const alice = within(row("Alice Tan").getByTestId("live-remaining"));
    expect(alice.getByText(/6 lessons/)).toBeTruthy();
    expect(alice.getByText(/S\$180\.00/)).toBeTruthy();
    expect(alice.getByTitle("Includes lessons attended but not yet invoiced")).toBeTruthy();

    const carol = within(row("Carol Ng").getByTestId("live-remaining"));
    expect(carol.getByText(/3 lessons/)).toBeTruthy();
    expect(carol.queryByTitle("Includes lessons attended but not yet invoiced")).toBeNull();

    // Not active → the stored (invoiced) value, no live figure.
    expect(row("Bob Lim").queryByTestId("live-remaining")).toBeNull();
    expect(row("Bob Lim").getByText("S$0.00")).toBeTruthy();
  });

  it("an active package past its expiry says expired; a future one does not", () => {
    setup();
    expect(row("Carol Ng").getByText("expired")).toBeTruthy();
    expect(row("Alice Tan").queryByText("expired")).toBeNull();
    // Extensions are itemised under the expiry.
    expect(row("Carol Ng").getByText(/\+1 day · public holidays/)).toBeTruthy();
    expect(row("Carol Ng").getByText(/\+2 days · cancelled lessons/)).toBeTruthy();
  });

  it("Extend/Cancel only on an active package, and they act on that row", () => {
    const { props } = setup();
    expect(row("Bob Lim").queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(row("Carol Ng").getByRole("button", { name: "Extend" }));
    expect(props.openExtend).toHaveBeenCalledWith(CAROL);
    fireEvent.click(row("Alice Tan").getByRole("button", { name: "Cancel" }));
    expect(props.setCancelling).toHaveBeenCalledWith(ALICE);
    expect(props.openExtend).toHaveBeenCalledTimes(1);
    expect(props.setCancelling).toHaveBeenCalledTimes(1);
  });

  it("busy locks Extend and Cancel", () => {
    const { props } = setup({ busy: true });
    for (const b of screen.getAllByRole("button", { name: /^(Extend|Cancel)$/ })) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(props.openExtend).not.toHaveBeenCalled();
    expect(props.setCancelling).not.toHaveBeenCalled();
  });

  it("Record a sale opens the sale modal; search reports what was typed", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record a sale" }));
    expect(props.setSaleModal).toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByPlaceholderText("Search parent, package or ref…"), {
      target: { value: "PKG-2026-0002" },
    });
    expect(props.setHeldSearch).toHaveBeenCalledWith("PKG-2026-0002");
  });

  it("the three empty states are distinct", () => {
    const loading = setup({ loading: true });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    loading.unmount();

    const none = setup({ held: [] });
    expect(screen.getByText("Nobody holds a package yet.")).toBeTruthy();
    // No search box over an empty list; Record a sale is still offered.
    expect(screen.queryByPlaceholderText("Search parent, package or ref…")).toBeNull();
    expect(screen.getByRole("button", { name: "Record a sale" })).toBeTruthy();
    none.unmount();

    setup({ heldMatches: [], heldSearch: "zzz" });
    expect(screen.getByText("No held package matches “zzz”.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a capped fetch is never a silent slice", () => {
    const capped = setup({ capped: true });
    expect(screen.getByText(/Showing the first 1000 packages/)).toBeTruthy();
    capped.unmount();
    setup({ capped: false });
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });
});

// Refund cell (PACKAGE_REVENUE_REFUNDS_PLAN.md U2). Proven red by rendering
// <RefundCell> with canEdit hard-wired true (the view-only test fails) and by
// wiring Record refund to a no-op (the acts-on-that-row test fails).
describe("HeldTable refunds", () => {
  const CANCELLED = purchase({
    id: "p9",
    parent_name: "Dan Koh",
    reference_number: "PKG-2026-0009",
    status: "cancelled",
    confirmed_at: "2026-09-16T05:46:00Z",
    amount_payable: 350,
    live_value_remaining: null,
    live_lessons_remaining: null,
  });
  const REFUND = { id: "r1", parent_package_id: "p9", amount: 120, refunded_on: "2026-09-20", note: "moved" };

  it("a cancelled, paid package offers Record refund, acting on that row; active rows do not", () => {
    const { props } = setup({ held: [ALICE, CANCELLED] });
    expect(row("Alice Tan").queryByText("Record refund")).toBeNull();
    fireEvent.click(row("Dan Koh").getByText("Record refund"));
    expect(props.openRefund).toHaveBeenCalledWith(CANCELLED);
  });

  it("a recorded refund shows its amount and SGT date, with Reverse", () => {
    const { props } = setup({ held: [CANCELLED], refunds: new Map([["p9", REFUND]]) });
    const dan = row("Dan Koh");
    expect(dan.getByTestId("refund-recorded").textContent).toContain("Refunded S$120.00 on 20 Sept 2026");
    expect(dan.queryByText("Record refund")).toBeNull();
    fireEvent.click(dan.getByText("Reverse"));
    expect(props.openReverse).toHaveBeenCalledWith(CANCELLED, REFUND);
  });

  it("a view-only admin sees the refund but no Record or Reverse", () => {
    setup({ held: [CANCELLED], canEdit: false, refunds: new Map([["p9", REFUND]]) });
    expect(row("Dan Koh").getByTestId("refund-recorded")).toBeTruthy();
    expect(screen.queryByText("Reverse")).toBeNull();
    setup({ held: [purchase({ ...CANCELLED, id: "p10", parent_name: "Eve Ong" })], canEdit: false });
    expect(row("Eve Ong").queryByText("Record refund")).toBeNull();
  });

  it("a failed refunds read hides every refund control and says so", () => {
    setup({ held: [CANCELLED], refunds: null });
    expect(screen.queryByText("Record refund")).toBeNull();
    expect(screen.getByTestId("refunds-unavailable")).toBeTruthy();
  });
});
