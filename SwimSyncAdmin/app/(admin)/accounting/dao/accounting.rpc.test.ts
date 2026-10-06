import { describe, it, expect, vi, beforeEach } from "vitest";

// The Accounting page's two MONEY reads, pinned call-by-call (§7.314; Wave 8
// RISK 4). Both are RPCs that refuse anyone but the owner server-side; this layer
// must pass its args THROUGH — a dropped or swapped p_month shows another
// month's P&L under this month's label.
//
// The supabase client is replaced by a CHAIN RECORDER: every call appends
// [name, ...args] to one log. The assertion is `toEqual` on the WHOLE log.
//
// MUTATION PROOFS (§7.25) — each applied by hand, seen red, reverted:
//   1. accountingSummary passes `{ ...args, p_month: "2026-01" }`
//      → RED: "accountingSummary passes the tenant and month through untouched"
//   2. `accounting_months` → `accounting_summary` in accountingMonths
//      → RED: "accountingMonths calls accounting_months with the tenant"

const { log } = vi.hoisted(() => ({ log: [] as unknown[][] }));

vi.mock("@/lib/supabase", () => {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        // Not a thenable — the test inspects the builder, it never awaits it.
        if (prop === "then") return undefined;
        return (...args: unknown[]) => {
          log.push([String(prop), ...args]);
          return chain;
        };
      },
    }
  );
  return { supabase: chain };
});

import { accountingMonths, accountingSummary } from "./accounting.rpc";

beforeEach(() => {
  log.length = 0;
});

describe("accounting RPCs", () => {
  it("accountingSummary passes the tenant and month through untouched", () => {
    accountingSummary({ p_tenant: "tenant-A", p_month: "2026-09" });
    expect(log).toEqual([["rpc", "accounting_summary", { p_tenant: "tenant-A", p_month: "2026-09" }]]);
  });

  it("accountingMonths calls accounting_months with the tenant", () => {
    accountingMonths({ p_tenant: "tenant-A" });
    expect(log).toEqual([["rpc", "accounting_months", { p_tenant: "tenant-A" }]]);
  });
});
