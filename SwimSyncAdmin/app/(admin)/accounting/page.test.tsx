import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AccountingPage from "./page";

// Mutable fixture + spy-able supabase mock. `state` drives who the caller is and
// what the RPCs return; `rpcMock` lets us assert the ⚠ RISK 6 rule — no
// accounting RPC fires for a non-owner.
const { state, rpcMock } = vi.hoisted(() => {
  const state = {
    myId: "me",
    ownerId: "me",
    months: ["2026-07"] as string[],
    summary: null as Record<string, unknown> | null,
  };
  const rpcMock = vi.fn(async (name: string) => {
    if (name === "accounting_months") {
      return { data: state.months.map((m) => ({ billing_month: m })), error: null };
    }
    return { data: state.summary ? [state.summary] : [], error: null };
  });
  return { state, rpcMock };
});

// The signed-in admin's role (components/PermissionsProvider). Default: no
// accounting — so a non-owner is refused unless a test grants it.
const permState = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading",
  tenantId: "t1",
  isOwner: false,
  perms: { levels: { operations: "edit", profile: "none", admins: "none", pricing: "none",
    billing: "none", packages: "none", wages: "none", accounting: "none" } as Record<string, string> },
}));
vi.mock("@/components/PermissionsProvider", () => ({ usePermissions: () => permState }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: state.myId } } }) },
    from: () => ({
      select: async () => ({
        data: [{ id: "t1", owner_profile_id: state.ownerId }],
        error: null,
      }),
    }),
    rpc: rpcMock,
  },
}));

const FINAL = {
  revenue: "190.00", revenue_invoiced: "150.00", revenue_settlements: "40.00",
  revenue_gross: "180.00", revenue_package_applied: "10.00",
  revenue_credit_applied: "20.00", revenue_balance_adjustment: "15.00",
  outstanding: "100.00", wages: "180.00", net: "10.00", wages_state: "final",
  revenue_packages: "0.00", revenue_package_refunds: "0.00",
};

const RUN_PAYOUTS = {
  ...FINAL, wages: null, net: null, wages_state: "run_payouts",
};

beforeEach(() => {
  rpcMock.mockClear();
  state.myId = "me";
  state.ownerId = "me";
  state.months = ["2026-07"];
  state.summary = FINAL;
  permState.status = "ready";
  permState.perms.levels.accounting = "none";
});

describe("AccountingPage owner gate", () => {
  it("shows the owner-only notice to a co-admin and fires NO accounting RPC", async () => {
    state.ownerId = "someone-else"; // caller is not the owner
    render(<AccountingPage />);
    await screen.findByTestId("owner-only-notice");
    // The security property: a non-owner sees no figures...
    expect(screen.queryByTestId("tile-revenue")).toBeNull();
    // ...and the page never even asked the server for them (⚠ RISK 6).
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
  });

  it("shows figures to a co-admin whose ROLE includes Accounting", async () => {
    state.ownerId = "someone-else";
    permState.perms.levels.accounting = "view";
    render(<AccountingPage />);
    const revenue = await screen.findByTestId("tile-revenue");
    expect(revenue.textContent).toContain("S$190.00");
  });

  it("fires nothing and refuses nothing while the role is still loading", async () => {
    state.ownerId = "someone-else";
    permState.status = "loading";
    render(<AccountingPage />);
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
    expect(screen.queryByTestId("owner-only-notice")).toBeNull();
  });

  it("shows figures to the owner", async () => {
    render(<AccountingPage />);
    const revenue = await screen.findByTestId("tile-revenue");
    expect(revenue.textContent).toContain("S$190.00");
  });
});

describe("AccountingPage wages withholding", () => {
  it("run_payouts renders NO number for wages or net — only the prompt", async () => {
    state.summary = RUN_PAYOUTS;
    render(<AccountingPage />);
    const wages = await screen.findByTestId("tile-wages");
    const net = await screen.findByTestId("tile-net");
    expect(wages.textContent).toContain("Run coach payouts to see");
    // The load-bearing assertion: no dollar figure leaks into a withheld tile.
    expect(wages.textContent).not.toContain("S$");
    expect(net.textContent).not.toContain("S$");
  });

  it("final state shows the wage and net figures", async () => {
    render(<AccountingPage />);
    const wages = await screen.findByTestId("tile-wages");
    const net = await screen.findByTestId("tile-net");
    expect(wages.textContent).toContain("S$180.00");
    expect(net.textContent).toContain("S$10.00");
  });
});

describe("AccountingPage package revenue (Wave 2 U1)", () => {
  it("shows packages sold as its own line, apart from packages applied, with the basis note", async () => {
    state.summary = { ...FINAL, revenue: "460.00", revenue_packages: "270.00", net: "280.00" };
    render(<AccountingPage />);
    const revenue = await screen.findByTestId("tile-revenue");
    expect(revenue.textContent).toContain("S$460.00");
    expect(revenue.textContent).toContain("packages S$270.00");
    const sold = screen.getByText("+ Packages sold (paid this month)");
    expect(sold.nextElementSibling?.textContent).toBe("S$270.00");
    // W2: the invoice deduction keeps its own label, explained, never merged.
    const applied = screen.getByText("− Packages applied");
    expect(applied.getAttribute("title")).toMatch(/counted when sold/);
    expect(applied.nextElementSibling?.textContent).toBe("S$10.00");
    expect(screen.getByTestId("revenue-basis-note").textContent).toContain(
      "packages count the month they were paid",
    );
  });
});

describe("AccountingPage package refunds (Wave 2 U2)", () => {
  it("shows refunds as their own line, and a negative revenue as -S$", async () => {
    state.summary = {
      ...FINAL, revenue: "-50.00", revenue_invoiced: "0.00", revenue_settlements: "0.00",
      revenue_packages: "100.00", revenue_package_refunds: "150.00", wages: "0.00", net: "-50.00",
    };
    render(<AccountingPage />);
    const revenue = await screen.findByTestId("tile-revenue");
    expect(revenue.textContent).toContain("-S$50.00");
    expect(revenue.textContent).toContain("refunds S$150.00");
    const refunds = screen.getByText("− Package refunds (paid out this month)");
    expect(refunds.nextElementSibling?.textContent).toBe("S$150.00");
    expect(screen.getByText("= Revenue").nextElementSibling?.textContent).toBe("-S$50.00");
  });
});
