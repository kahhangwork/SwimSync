import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PendingDebits } from "./PendingDebits";
import type { PendingDebit } from "../types";

// PendingDebits — the "Pending charges — not yet invoiced" panel
// (WAVE3_RENDER_TESTS_PLAN.md 1.2.3). Pure props. What is load-bearing:
//   • a row is a (parent, TENANT) pair — the same parent owing at two
//     businesses is two rows, two keys, and busy-ness never bleeds across;
//   • Write off acts on THAT row;
//   • an error is shown; an empty list shows no panel at all.
// Money values are distinct per row (RISK 8).
//
// MUTATION PROOFS (§7.25) — each applied to ui/PendingDebits.tsx via mutate.sh:
//   1. `const key = \`${row.parent_id}:${row.tenant_id}\`;` → `const key = row.parent_id;`
//      → RED: "the same parent at two businesses is two rows, and only one is busy"
//   2. `onClick={() => onWriteOff(row)}` → `onClick={() => onWriteOff(pendingDebits[0])}`
//      → RED: "Write off acts on THAT row"
//   3. `{pendingDebitError && (` → `{false && (`
//      → RED: "an error is shown"
//   4. `{pendingDebits.length > 0 && (` → `{true && (`
//      → RED: "no pending charges, no panel"

type Props = ComponentProps<typeof PendingDebits>;

const A: PendingDebit = { parent_id: "p1", tenant_id: "tA", parent_name: "Dan Ong", debit_balance: 12.5 };
const B: PendingDebit = { parent_id: "p1", tenant_id: "tB", parent_name: "Dan Ong", debit_balance: 7.25 };

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    pendingDebits: [A, B],
    writingOff: null,
    pendingDebitError: null,
    onWriteOff: vi.fn(),
    ...over,
  };
  render(<PendingDebits {...props} />);
  return props;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PendingDebits", () => {
  it("the same parent at two businesses is two rows, and only one is busy", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ writingOff: "p1:tB" });
    const items = within(screen.getByTestId("pending-debits")).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p span")?.textContent)).toEqual([
      "owes S$12.50",
      "owes S$7.25",
    ]);
    expect(items.map((li) => li.querySelector("p")?.firstChild?.textContent)).toEqual(["Dan Ong", "Dan Ong"]);
    const buttons = items.map((li) => within(li).getByRole("button") as HTMLButtonElement);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
    // React reports a duplicate key through console.error.
    expect(errors).toHaveBeenCalledTimes(0);
  });

  it("Write off acts on THAT row", () => {
    const props = setup();
    const items = screen.getAllByRole("listitem");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Write off" }));
    expect(props.onWriteOff).toHaveBeenCalledTimes(1);
    expect(props.onWriteOff).toHaveBeenCalledWith(B);
  });

  it("an error is shown", () => {
    setup({ pendingDebits: [], pendingDebitError: "A reason is required to write off a balance." });
    expect(screen.getByTestId("pending-debit-error").textContent).toBe(
      "A reason is required to write off a balance."
    );
  });

  it("no pending charges, no panel", () => {
    setup({ pendingDebits: [] });
    expect(screen.queryByTestId("pending-debits")).toBeNull();
    expect(screen.queryByTestId("pending-debit-error")).toBeNull();
  });
});
