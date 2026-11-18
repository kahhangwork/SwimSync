import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { HeldTable } from "./HeldTable";
import type { Purchase } from "../types";

// HeldTable — "Who holds one". Each row is a package with money on it: the
// admin reconciles by reference, reads the balance (stored = live, since every
// lesson draws at marking), and Extend/Cancel act on that one package. Pinned:
//   • rows show parent, children, package, reference and status;
//   • an active package shows lessons left and its balance, one figure, no *;
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
//   3. `{p.lessons_remaining} lesson` → `{p.lesson_count} lesson`
//      → RED: "an active package shows lessons left and its stored balance …"
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
    value_remaining: 180,
    lessons_remaining: 6,
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
    student_id: null,
    student_name: null,
    carried_over_start: null,
    carried_over_lessons: null,
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
  lessons_remaining: 0,
  children: null,
  category_name: null,
});
const CAROL = purchase({
  id: "p3",
  parent_name: "Carol Ng",
  reference_number: "PKG-2026-0003",
  expires_on: "2020-01-31",
  value_remaining: 90,
  lessons_remaining: 3,
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
    checkBacklog: vi.fn(),
    checking: null,
    ...over,
  };
  const utils = render(<HeldTable {...props} />);
  return { props, ...utils };
}

const row = (name: string) => within(screen.getByText(name).closest("tr")!);
/** Open a row's "…" menu (its items render inside the row) and return the row. */
const menu = (name: string) => {
  fireEvent.click(row(name).getByRole("button", { name: "More actions" }));
  return row(name);
};

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

  it("an active package shows lessons left and its stored balance — one figure, no *", () => {
    setup();
    const alice = within(row("Alice Tan").getByTestId("live-remaining"));
    expect(alice.getByText(/6 lessons/)).toBeTruthy();
    expect(alice.getByText(/S\$180\.00/)).toBeTruthy();

    const carol = within(row("Carol Ng").getByTestId("live-remaining"));
    expect(carol.getByText(/3 lessons/)).toBeTruthy();
    expect(screen.queryByText("*")).toBeNull();
    expect(screen.queryByText(/Remaining balances are live/)).toBeNull();

    // Not active → the stored value only, no lessons figure.
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
    // Extend is the row's one inline action; Cancel sits in the "…" menu.
    expect(row("Alice Tan").queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(menu("Alice Tan").getByRole("button", { name: "Cancel" }));
    expect(props.setCancelling).toHaveBeenCalledWith(ALICE);
    expect(props.openExtend).toHaveBeenCalledTimes(1);
    expect(props.setCancelling).toHaveBeenCalledTimes(1);
  });

  // PRD §7.16, "Check marked lessons" — the activation question is asked once;
  // this re-asks it. Draw needs packages:edit, so the button does too.
  it("Check marked lessons: active rows only, packages:edit only, acts on that row", () => {
    const { props, unmount } = setup();
    const CHECK = { name: "Check marked lessons" };
    expect(row("Bob Lim").queryByRole("button", CHECK)).toBeNull();
    fireEvent.click(menu("Carol Ng").getByRole("button", CHECK));
    expect(props.checkBacklog).toHaveBeenCalledWith(CAROL);
    expect(props.checkBacklog).toHaveBeenCalledTimes(1);
    unmount();

    setup({ canEdit: false });
    // Cancel keeps the menu there; Check is not in it.
    expect(menu("Carol Ng").queryByRole("button", CHECK)).toBeNull();
  });

  it("a check in flight says so on its row and locks every row's Check", () => {
    const { props } = setup({ checking: ALICE.id });
    expect(menu("Alice Tan").getByRole("button", { name: "Checking…" })).toBeTruthy();
    const carol = menu("Carol Ng").getByRole("button", { name: "Check marked lessons" });
    expect((carol as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(carol);
    expect(props.checkBacklog).not.toHaveBeenCalled();
  });

  it("busy locks Extend and Cancel", () => {
    const { props } = setup({ busy: true });
    menu("Alice Tan");
    menu("Carol Ng");
    const locked = screen.getAllByRole("button", { name: /^(Extend|Cancel)$/ });
    expect(locked).toHaveLength(4); // never vacuous: 2 Extend inline + 2 Cancel in the menus
    for (const b of locked) {
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
    lessons_remaining: 0,
  });
  const REFUND = { id: "r1", parent_package_id: "p9", amount: 120, refunded_on: "2026-09-20", note: "moved" };

  it("a cancelled, paid package offers Record refund, acting on that row; active rows do not", () => {
    const { props } = setup({ held: [ALICE, CANCELLED] });
    expect(row("Alice Tan").queryByText("Record refund")).toBeNull();
    fireEvent.click(row("Dan Koh").getByText("Record refund"));
    expect(props.openRefund).toHaveBeenCalledWith(CANCELLED);
  });

  it("a recorded refund shows its amount and SGT date, with Reverse refund in the menu", () => {
    const { props } = setup({ held: [CANCELLED], refunds: new Map([["p9", REFUND]]) });
    const dan = row("Dan Koh");
    expect(dan.getByTestId("refund-recorded").textContent).toContain("Refunded S$120.00 on 20 Sept 2026");
    expect(dan.queryByText("Record refund")).toBeNull();
    expect(dan.queryByRole("button", { name: "Reverse refund" })).toBeNull();
    fireEvent.click(menu("Dan Koh").getByRole("button", { name: "Reverse refund" }));
    expect(props.openReverse).toHaveBeenCalledWith(CANCELLED, REFUND);
  });

  it("a view-only admin sees the refund but no Record or Reverse", () => {
    setup({ held: [CANCELLED], canEdit: false, refunds: new Map([["p9", REFUND]]) });
    expect(row("Dan Koh").getByTestId("refund-recorded")).toBeTruthy();
    expect(screen.queryByText(/Reverse/)).toBeNull();
    expect(row("Dan Koh").queryByRole("button", { name: "More actions" })).toBeNull();
    setup({ held: [purchase({ ...CANCELLED, id: "p10", parent_name: "Eve Ong" })], canEdit: false });
    expect(row("Eve Ong").queryByText("Record refund")).toBeNull();
  });

  it("a failed refunds read hides every refund control and says so", () => {
    setup({ held: [CANCELLED], refunds: null });
    expect(screen.queryByText("Record refund")).toBeNull();
    expect(screen.getByTestId("refunds-unavailable")).toBeTruthy();
  });
});
