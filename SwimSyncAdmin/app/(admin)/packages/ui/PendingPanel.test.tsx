import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PendingPanel } from "./PendingPanel";
import type { Purchase } from "../types";

// PendingPanel — "Awaiting confirmation". The admin ticks each row against the
// bank: the reference is what is on the statement and the price is what the
// family PAYS (amount_payable, referral discount applied — RISK 7), so both
// must show verbatim. "Payment received" starts a package's validity and its
// balance; it must act on THAT row and nothing else. Superseded offers are
// history — shown on request, never actionable.
//
// MUTATION PROOFS (§7.25) — each applied to PendingPanel.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `{money(p.amount_payable)}` → `{money(p.total_value)}` (pending row)
//      → RED: "each row shows parent, package, reference and the price the family pays"
//   2. `onClick={() => setConfirming(p)}` → `setConfirming(visiblePending[0])`
//      → RED: "Payment received / Decline act on that row"
//   3. `disabled={busy}` on Payment received → removed
//      → RED: "busy disables every action"
//   4. `useTableSort<Purchase>({ key: "requested_at" })` → `({ key: "parent_name" })`
//      → RED: "the oldest request is first — the longest wait is served next"
//   5. `{showSuperseded &&` → `{true &&`
//      → RED: "superseded offers stay hidden until asked for, and are never actionable"
//   6. `if (pending.length === 0 && superseded.length === 0) return null;` → removed
//      → RED: "renders nothing when there is nothing to confirm"

function purchase(over: Partial<Purchase>): Purchase {
  return {
    id: "p1",
    parent_id: "par1",
    parent_name: "Alice Tan",
    name: "10-lesson pack",
    category_name: null,
    lesson_count: 10,
    rate_per_lesson: 30,
    total_value: 300,
    amount_payable: 300,
    discount_amount: 0,
    value_remaining: 300,
    live_value_remaining: null,
    live_lessons_remaining: null,
    status: "pending",
    confirmed_at: null,
    product_id: "prod1",
    requested_at: "2026-09-10T02:00:00Z",
    start_date: null,
    expires_on: null,
    holiday_extension_days: 0,
    cancel_extension_days: 0,
    manual_extension_days: 0,
    reference_number: "PKG-2026-0001",
    offered_by: null,
    paid_claimed_at: null,
    superseded_by: null,
    public_token: null,
    children: null,
    ...over,
  };
}

const ALICE = purchase({});
const BOB = purchase({
  id: "p2",
  parent_id: "par2",
  parent_name: "Bob Lim",
  reference_number: "PKG-2026-0002",
  // Referral discount: pays 270 on a 300 pack.
  amount_payable: 270,
  discount_amount: 30,
  // Waiting longer than Alice.
  requested_at: "2026-09-01T02:00:00Z",
  offered_by: "admin1",
  paid_claimed_at: "2026-09-02T02:00:00Z",
});
const OLD_OFFER = purchase({
  id: "p3",
  parent_name: "Carol Ng",
  reference_number: "PKG-2026-0003",
  status: "cancelled",
  superseded_by: "p1",
});

type Props = ComponentProps<typeof PendingPanel>;
function setup(over: Partial<Props> = {}) {
  const props: Props = {
    pending: [ALICE, BOB],
    superseded: [],
    showSuperseded: false,
    setShowSuperseded: vi.fn(),
    busy: false,
    setConfirming: vi.fn(),
    setCancelling: vi.fn(),
    ...over,
  };
  const utils = render(<PendingPanel {...props} />);
  return { props, ...utils };
}

/** The <tr> holding a parent's name. */
const row = (name: string) => within(screen.getByText(name).closest("tr")!);
const bodyRows = () => screen.getAllByRole("row").slice(1); // drop the header

describe("PendingPanel", () => {
  it("renders nothing when there is nothing to confirm", () => {
    const { container } = setup({ pending: [], superseded: [] });
    expect(container.innerHTML).toBe("");
  });

  it("each row shows parent, package, reference and the price the family pays", () => {
    setup();
    expect(screen.getByText("Awaiting confirmation (2)")).toBeTruthy();
    const bob = row("Bob Lim");
    expect(bob.getByText("PKG-2026-0002")).toBeTruthy();
    expect(bob.getByText("10-lesson pack")).toBeTruthy();
    // Pays S$270.00 (discounted), not the S$300.00 list value.
    expect(bob.getByText("S$270.00")).toBeTruthy();
    expect(bob.getByText("−S$30.00")).toBeTruthy();
    expect(bob.queryByText("S$300.00")).toBeNull();
    expect(bob.getByText("Offer")).toBeTruthy();
    expect(bob.getByText("Claimed")).toBeTruthy();
    const alice = row("Alice Tan");
    expect(alice.getByText("PKG-2026-0001")).toBeTruthy();
    expect(alice.getByText("S$300.00")).toBeTruthy();
    expect(alice.queryByText("Offer")).toBeNull();
    expect(alice.queryByText("Claimed")).toBeNull();
  });

  it("a missing reference shows a dash, not a blank", () => {
    setup({ pending: [purchase({ reference_number: null })] });
    expect(row("Alice Tan").getByText("—")).toBeTruthy();
  });

  it("the oldest request is first — the longest wait is served next", () => {
    setup();
    const [first, second] = bodyRows();
    expect(within(first).getByText("Bob Lim")).toBeTruthy();
    expect(within(second).getByText("Alice Tan")).toBeTruthy();
  });

  it("Payment received / Decline act on that row", () => {
    const { props } = setup();
    fireEvent.click(row("Alice Tan").getByRole("button", { name: "Payment received" }));
    expect(props.setConfirming).toHaveBeenCalledWith(ALICE);
    fireEvent.click(row("Bob Lim").getByRole("button", { name: "Decline" }));
    expect(props.setCancelling).toHaveBeenCalledWith(BOB);
    expect(props.setConfirming).toHaveBeenCalledTimes(1);
    expect(props.setCancelling).toHaveBeenCalledTimes(1);
  });

  it("busy disables every action", () => {
    const { props } = setup({ busy: true });
    for (const b of screen.getAllByRole("button", { name: /Payment received|Decline/ })) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(props.setConfirming).not.toHaveBeenCalled();
    expect(props.setCancelling).not.toHaveBeenCalled();
  });

  it("superseded offers stay hidden until asked for, and are never actionable", () => {
    const hidden = setup({ superseded: [OLD_OFFER] });
    expect(screen.queryByText("Carol Ng")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show superseded (1)" }));
    const updater = (hidden.props.setShowSuperseded as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as (v: boolean) => boolean;
    expect(updater(false)).toBe(true);
    hidden.unmount();

    setup({ superseded: [OLD_OFFER], showSuperseded: true });
    const carol = row("Carol Ng");
    expect(carol.getByText("Superseded")).toBeTruthy();
    expect(carol.getByText("PKG-2026-0003")).toBeTruthy();
    expect(carol.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Hide superseded (1)" })).toBeTruthy();
  });

  it("a panel of only superseded offers still renders (count 0)", () => {
    setup({ pending: [], superseded: [OLD_OFFER] });
    expect(screen.getByText("Awaiting confirmation (0)")).toBeTruthy();
  });
});
