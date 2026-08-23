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
