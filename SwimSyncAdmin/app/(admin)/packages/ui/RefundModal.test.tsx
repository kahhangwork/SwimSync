import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useRefund } from "../domain/useRefund";
import { RefundModal, ReverseRefundModal } from "./RefundModal";
import type { Purchase } from "../types";

// RefundModal + useRefund (PACKAGE_REVENUE_REFUNDS_PLAN.md U2). The RPC is the
// guard; the modal must (a) suggest NO amount, (b) show the server's refusal
// verbatim and STAY OPEN, (c) close and reload only on success, and (d) Reverse
// only through its own "Keep it / Reverse refund" dialog.
// Proven red: `setRefundError(error.message …)` → `setRefunding(null)` fails (b);
// `setAmount("")` → `setAmount(String(p.amount_payable))` fails (a).

const rpc = vi.hoisted(() => ({
  recordPackageRefund: vi.fn(),
  reversePackageRefund: vi.fn(),
}));
vi.mock("../dao/packages.rpc", () => rpc);

// The signed-in admin's role. canEdit must be false until permissions are
// KNOWN (fail closed) — proven red by dropping the `permsStatus === "ready"` term.
const permState = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading",
  tenantId: "t1",
  isOwner: false,
  perms: { levels: { packages: "edit" } as Record<string, string> },
}));
vi.mock("@/components/PermissionsProvider", () => ({ usePermissions: () => permState }));

const PKG = {
  id: "k1",
  parent_name: "Dan Koh",
  name: "10 Lesson Package",
  amount_payable: 350,
  confirmed_at: "2026-09-16T05:46:00Z",
  status: "cancelled",
} as Purchase;
const REFUND = { id: "r1", parent_package_id: "k1", amount: 120, refunded_on: "2026-09-20", note: null };

const reload = vi.fn();
function Harness() {
  const [busy, setBusy] = useState(false);
  const form = useRefund({ setBusy, reload });
  return (
    <>
      <span data-testid="can-edit">{String(form.canEdit)}</span>
      <button onClick={() => form.openRefund(PKG)}>open</button>
      <button onClick={() => form.openReverse(PKG, REFUND)}>open-reverse</button>
      <RefundModal form={form} busy={busy} />
      <ReverseRefundModal form={form} busy={busy} />
    </>
  );
}

beforeEach(() => {
  permState.status = "ready";
  permState.perms.levels.packages = "edit";
  rpc.recordPackageRefund.mockReset();
  rpc.reversePackageRefund.mockReset();
  reload.mockReset();
});

describe("RefundModal", () => {
  it("suggests no amount — only the ceiling, as a sentence", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const amount = screen.getByLabelText("Amount refunded (S$)") as HTMLInputElement;
    expect(amount.value).toBe("");
    expect(amount.placeholder).toBe("");
    expect(screen.getByTestId("refund-ceiling").textContent).toBe("Up to S$350.00 — what the family paid.");
  });

  it("a server refusal shows verbatim and the modal stays open", async () => {
    rpc.recordPackageRefund.mockResolvedValue({
      error: { message: "That month is closed — refunds can only be dated in an open month." },
    });
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText("Amount refunded (S$)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    await waitFor(() =>
      expect(screen.getByTestId("refund-error").textContent).toBe(
        "That month is closed — refunds can only be dated in an open month."
      )
    );
    expect(screen.getByText("Record a refund")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a blank amount is refused before the RPC", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(screen.getByTestId("refund-error").textContent).toBe("Enter the amount you refunded.");
    expect(rpc.recordPackageRefund).not.toHaveBeenCalled();
  });

  it("success sends the typed amount, date and trimmed note, closes and reloads", async () => {
    rpc.recordPackageRefund.mockResolvedValue({ error: null });
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText("Amount refunded (S$)"), { target: { value: "120.50" } });
    fireEvent.change(screen.getByLabelText("Date paid out"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "  moved  " } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(rpc.recordPackageRefund).toHaveBeenCalledWith("k1", 120.5, "2026-09-20", "moved");
    expect(screen.queryByText("Record a refund")).toBeNull();
  });
});

describe("ReverseRefundModal", () => {
  it("Keep it does nothing; Reverse refund calls the RPC for that refund", async () => {
    rpc.reversePackageRefund.mockResolvedValue({ error: null });
    render(<Harness />);
    fireEvent.click(screen.getByText("open-reverse"));
    fireEvent.click(screen.getByText("Keep it"));
    expect(rpc.reversePackageRefund).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("open-reverse"));
    fireEvent.click(screen.getByRole("button", { name: "Reverse refund" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(rpc.reversePackageRefund).toHaveBeenCalledWith("r1");
  });
});

describe("useRefund canEdit", () => {
  it("is true only with packages:edit, and false while permissions load", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByTestId("can-edit").textContent).toBe("true");
    unmount();
    permState.perms.levels.packages = "view";
    const second = render(<Harness />);
    expect(screen.getByTestId("can-edit").textContent).toBe("false");
    second.unmount();
    permState.perms.levels.packages = "edit";
    permState.status = "loading";
    render(<Harness />);
    expect(screen.getByTestId("can-edit").textContent).toBe("false");
  });
});
