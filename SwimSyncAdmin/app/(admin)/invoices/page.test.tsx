import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// InvoicesPage — the tenant WIRING of the Pending charges read
// (WAVE3_RENDER_TESTS_PLAN.md 1.2.4; PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md RISK 6).
// The page resolves its own tenant and must load pending debits for THAT tenant
// — on first load and again after a generation run — and for no tenant at all
// when it resolves none (a platform admin). Every domain hook is mocked and every
// child component renders nothing: this pins the compose layer only, the way
// lessons/[classId]/[date]/page.test.tsx does.
//
// MUTATION PROOFS (§7.25) — each applied to page.tsx via mutate.sh:
//   1. `debits.loadPendingDebits(tid);` → `debits.loadPendingDebits("other");`
//      → RED: "loads pending debits for the tenant it resolved"
//   2. `if (tenantId) await debits.loadPendingDebits(tenantId);` → removed
//      → RED: "reloads them for the same tenant after a generation run"
//   3. `if (tid) {` → `if (true) {`
//      → RED: "loads none when it resolves no tenant"

const { h } = vi.hoisted(() => ({
  h: {
    tenantId: "tenant-A" as string | null,
    loadTenant: vi.fn(),
    loadPendingDebits: vi.fn(),
    listLoad: vi.fn(),
    afterGenerate: null as null | (() => Promise<void>),
  },
}));

/** Any property not named is a no-op function — the children are mocked away. */
const stub = (named: Record<string, unknown>) =>
  new Proxy(named, { get: (t, p) => (p in t ? (t as any)[p] : () => {}) });

vi.mock("./domain/useInvoiceList", () => ({
  useInvoiceList: () => stub({ load: h.listLoad, totalOutstanding: 0, visible: [], invoices: [] }),
}));
vi.mock("./domain/useTenantBilling", () => ({
  useTenantBilling: () =>
    stub({ tenantId: h.tenantId, isPlatformAdmin: false, businessName: null, loadTenant: h.loadTenant }),
}));
vi.mock("./domain/usePendingDebits", () => ({
  usePendingDebits: () => stub({ loadPendingDebits: h.loadPendingDebits }),
}));
vi.mock("./domain/useUnclaimed", () => ({ useUnclaimed: () => stub({}) }));
vi.mock("./domain/useOrphans", () => ({ useOrphans: () => stub({}) }));
vi.mock("./domain/useBillingMonths", () => ({ useBillingMonths: () => stub({}) }));
vi.mock("./domain/useGenerate", () => ({
  useGenerate: (opts: { afterGenerate: () => Promise<void> }) => {
    h.afterGenerate = opts.afterGenerate;
    return stub({});
  },
}));
// vi.mock is hoisted only when written out literally — not from a loop.
vi.mock("./ui/InvoiceToolbar", () => ({ InvoiceToolbar: () => null }));
vi.mock("./ui/InvoiceTable", () => ({ InvoiceTable: () => null }));
vi.mock("./ui/UnclaimedModal", () => ({ UnclaimedModal: () => null }));
vi.mock("./ui/OrphanReport", () => ({ OrphanReport: () => null }));
vi.mock("./ui/PendingDebits", () => ({ PendingDebits: () => null }));
vi.mock("./ui/GenerationPanel", () => ({ GenerationPanel: () => null }));
vi.mock("./ui/BillingMonthsCard", () => ({ BillingMonthsCard: () => null }));
vi.mock("./ui/ConfirmGenerateModal", () => ({ ConfirmGenerateModal: () => null }));
vi.mock("./ui/BlockedLessonsModal", () => ({ BlockedLessonsModal: () => null }));
vi.mock("./ui/ReminderQueue", () => ({ ReminderQueue: () => null }));
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: InvoicesPage test reached the real supabase client");
});

import InvoicesPage from "./page";

beforeEach(() => {
  h.tenantId = "tenant-A";
  h.loadTenant.mockReset().mockResolvedValue("tenant-A");
  h.loadPendingDebits.mockReset().mockResolvedValue(undefined);
  h.listLoad.mockReset().mockResolvedValue(undefined);
  h.afterGenerate = null;
});

describe("InvoicesPage — pending debits are read for the page's own tenant", () => {
  it("loads pending debits for the tenant it resolved", async () => {
    render(<InvoicesPage />);
    await waitFor(() => expect(h.loadPendingDebits).toHaveBeenCalledTimes(1));
    expect(h.loadPendingDebits).toHaveBeenCalledWith("tenant-A");
  });

  it("reloads them for the same tenant after a generation run", async () => {
    render(<InvoicesPage />);
    await waitFor(() => expect(h.loadPendingDebits).toHaveBeenCalledTimes(1));
    await h.afterGenerate!();
    expect(h.loadPendingDebits.mock.calls).toEqual([["tenant-A"], ["tenant-A"]]);
  });

  it("loads none when it resolves no tenant", async () => {
    h.tenantId = null;
    h.loadTenant.mockResolvedValue(null);
    render(<InvoicesPage />);
    await waitFor(() => expect(h.loadTenant).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    await h.afterGenerate!();
    expect(h.loadPendingDebits).not.toHaveBeenCalled();
  });
});
