import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PACKAGE_FUNDED_REASON, type BillingMonthRow } from "@/lib/billingMonths";
import type { UndeliveredEmail } from "../domain/undeliveredEmails";
import { BillingMonthsCard } from "./BillingMonthsCard";

// The "may not have arrived" count on the Billing months card
// (docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.3). Load-bearing:
//   • the count shows on a month only when N > 0, and is absent otherwise;
//   • it shows on a CLOSED month too (a sealed month can still hold one);
//   • opening it lists each email with its own Resend, wired to that invoice;
//   • an invoice email in a month the card is not showing is still counted.

const month = (m: string, state: BillingMonthRow["state"] = "closed"): BillingMonthRow => ({
  month: m,
  state,
  needsAttention: false,
  reason: null,
  period: null,
  recentRuns: [],
});

const email = (invoiceId: string, billingMonth: string): UndeliveredEmail => ({
  invoiceId,
  billingMonth,
  reference: `INV-${invoiceId}`,
  parentName: `Parent ${invoiceId}`,
  claimedAt: "2026-09-01T02:00:00+00:00",
});

function renderCard(overrides: Partial<ComponentProps<typeof BillingMonthsCard>> = {}) {
  const props: ComponentProps<typeof BillingMonthsCard> = {
    rows: [month("2026-08"), month("2026-07")],
    loaded: true,
    loadError: null,
    showAll: false,
    setShowAll: vi.fn(),
    expanded: null,
    setExpanded: vi.fn(),
    staleNote: null,
    onSelectMonth: vi.fn(),
    onOpenUnclaimed: vi.fn(),
    onOpenBlocked: vi.fn(),
    undelivered: [],
    undeliveredError: null,
    resendingInvoice: new Set(),
    resendInvoiceError: {},
    onResendInvoice: vi.fn(),
    ...overrides,
  };
  render(<BillingMonthsCard {...props} />);
  return props;
}

describe("BillingMonthsCard — Nothing to bill (Wave 6 D2)", () => {
  it("labels a package-funded month and says Generate is optional", () => {
    renderCard({
      rows: [{ ...month("2026-08", "package_funded"), reason: PACKAGE_FUNDED_REASON }],
    });
    const row = screen.getByTestId("billing-month-2026-08");
    expect(row.getAttribute("data-state")).toBe("package_funded");
    expect(row.textContent).toMatch(/Nothing to bill/);
    expect(row.textContent).toMatch(/All package-funded\. Generate to close it for Accounting \(optional\)\./);
  });
});

describe("BillingMonthsCard — may not have arrived", () => {
  it("shows no count when no invoice email is MAY_HAVE_SENT", () => {
    renderCard();
    expect(screen.queryByText(/may not have arrived/)).toBeNull();
  });

  it("shows the count on the month that has them, on a closed month too, and only there", () => {
    renderCard({ undelivered: [email("a", "2026-08"), email("b", "2026-08")] });
    expect(screen.getByText("2 invoice emails may not have arrived")).toBeTruthy();
    expect(screen.getAllByText(/may not have arrived/)).toHaveLength(1);
  });

  it("opens a list with one Resend per email, each wired to its invoice", () => {
    const props = renderCard({ undelivered: [email("a", "2026-08"), email("b", "2026-08")] });
    expect(screen.queryByText("Parent a")).toBeNull();
    fireEvent.click(screen.getByText("2 invoice emails may not have arrived"));
    expect(screen.getByText("Parent a")).toBeTruthy();
    expect(screen.getByText("INV-b")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Resend" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(props.onResendInvoice).toHaveBeenCalledWith("b");
  });

  it("a resend in flight disables that row's button; its error shows inline", () => {
    renderCard({
      undelivered: [email("a", "2026-08"), email("b", "2026-08")],
      resendingInvoice: new Set(["a"]),
      resendInvoiceError: { b: "The email service refused it." },
    });
    fireEvent.click(screen.getByText("2 invoice emails may not have arrived"));
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The email service refused it.")).toBeTruthy();
  });

  it("counts an email in a month the card is not showing", () => {
    renderCard({ undelivered: [email("z", "2025-01")] });
    expect(screen.getByText(/1 invoice email may not have arrived in months not shown/)).toBeTruthy();
  });
});
