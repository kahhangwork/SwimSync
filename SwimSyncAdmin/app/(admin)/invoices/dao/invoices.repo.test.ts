import { describe, it, expect, vi, beforeEach } from "vitest";

// fetchPendingDebits — the CLIENT half of the Pending charges tenant scope
// (PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md RISK 6; WAVE3_RENDER_TESTS_PLAN.md 1.2.1).
// The scope is enforced in TWO places: this query's `.eq("tenant_id", …)` and the
// parent_tenant_balances_select policy's `tenant_id = current_tenant_id()` arm.
// A platform admin sees every tenant's invoices on this page, so if the filter
// went, one tenant's pending debit could be listed — and written off — under
// another's Invoices page. This pins the client half only; pgTAP owns the policy.
//
// The supabase client is replaced by a CHAIN RECORDER: every builder method
// appends [name, ...args] to one log and returns the same proxy. The assertion is
// `toEqual` on the WHOLE log — a partial match (arrayContaining) would survive an
// added, dropped or reordered filter.
//
// MUTATION PROOFS (§7.25) — each applied to dao/invoices.repo.ts via mutate.sh:
//   1. `.eq("tenant_id", tenantId)` deleted from fetchPendingDebits
//      → RED: "reads one tenant's pending debits, and only debits"
//   2. `.eq("tenant_id", tenantId)` → `.eq("tenant_id", "x")`
//      → RED: "reads one tenant's pending debits, and only debits"
//   3. `.gt("debit_balance", 0)` → `.gte("debit_balance", 0)`
//      → RED: "reads one tenant's pending debits, and only debits"

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

import { fetchPendingDebits } from "./invoices.repo";

beforeEach(() => {
  log.length = 0;
});

describe("fetchPendingDebits", () => {
  it("reads one tenant's pending debits, and only debits", () => {
    fetchPendingDebits("tenant-A");
    expect(log).toEqual([
      ["from", "parent_tenant_balances"],
      ["select", "parent_id, tenant_id, debit_balance, parents(profiles(full_name))"],
      ["eq", "tenant_id", "tenant-A"],
      ["gt", "debit_balance", 0],
    ]);
  });
});
