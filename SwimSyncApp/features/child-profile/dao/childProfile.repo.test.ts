// childProfile.repo — the exact PostgREST chains of the two money reads (D5). The hook
// test mocks the dao, so it cannot see a filter added INSIDE the dao: delete the
// `tenant_id` filter here and the hook test stays green. This file pins the chain
// itself — `toEqual` on the WHOLE recorded list, so an added, dropped or reordered
// filter goes red (never a partial match).
//
// RED FIRST (§7.25) — against the pre-fix code (origin/main @ adbd429): both chains
// lacked their tenant filter.
//
// MUTATION PROOFS — applied to childProfile.repo.ts through mutate.sh (restores from HEAD):
//   1. delete `.eq("tenant_id", tenantId)`
//      → RED: "outstanding invoices: this parent, outstanding, at the child's business"
//   2. `.eq("tenant_id", tenantId)` → `.eq("tenant_id", parentId)`
//      → RED: "outstanding invoices: this parent, outstanding, at the child's business"
//   3. delete `.eq("parent_tenant_balances.tenant_id", tenantId)`
//      → RED: "credit: the parent's balance row at the child's business only"
import { fetchOutstandingInvoices, fetchParentBalances } from "./childProfile.repo";

// A chain RECORDER standing in for the client: every method call appends
// [name, ...args] and returns the same proxy. `then` is undefined so the builder is
// not thenable — nothing is awaited, nothing reaches a network.
const mockChain: unknown[][] = [];
jest.mock("@/lib/supabase", () => {
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "then") return undefined;
        return (...args: unknown[]) => {
          mockChain.push([name, ...args]);
          return proxy;
        };
      },
    }
  );
  return { supabase: proxy };
});

beforeEach(() => {
  mockChain.length = 0;
});

describe("childProfile.repo money chains", () => {
  it("outstanding invoices: this parent, outstanding, at the child's business", () => {
    fetchOutstandingInvoices("parent-1", "tA");
    expect(mockChain).toEqual([
      ["from", "invoices"],
      ["select", "net_amount"],
      ["eq", "parent_id", "parent-1"],
      ["eq", "status", "outstanding"],
      ["eq", "tenant_id", "tA"],
    ]);
  });

  it("credit: the parent's balance row at the child's business only", () => {
    fetchParentBalances("parent-1", "tA");
    expect(mockChain).toEqual([
      ["from", "parents"],
      ["select", "parent_tenant_balances(credit_balance)"],
      ["eq", "id", "parent-1"],
      ["eq", "parent_tenant_balances.tenant_id", "tA"],
      ["single"],
    ]);
  });
});
