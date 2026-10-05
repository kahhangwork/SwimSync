// useParentHome — the money half of the parent Home load. Pinned: the HOME card is the
// FAMILY-WIDE total, on purpose (WAVE3_RENDER_TESTS_PLAN.md D5) — Credit sums the
// family's balance at every business, Outstanding sums every outstanding invoice the
// parent has, and the invoice read takes no tenant. The child profile card is the
// per-business one (features/child-profile).
//
// The dao seam is mocked inline (this feature has no testing/ harness): TYPE-ONLY dao
// imports, every call into one ordered log, and a @/lib/supabase tripwire. The dao's
// own `todayInSg` read goes with the mocked dao, so nothing here reads the clock.
//
// MUTATION PROOFS (§7.25) — applied through mutate.sh (restores from HEAD on exit):
//   domain/homeRows.ts
//   1. totalCredit reads only the first balance row (`balances.slice(0, 1).reduce(…)`)
//      → RED: "credit is the family total across every business"
//   2. totalOutstandingOf `sum + Number(…)` → `Math.max(sum, Number(…))`
//      → RED: "outstanding is every outstanding invoice the parent has"
//   domain/useParentHome.ts
//   3. `fetchOutstandingInvoices(parent.id)` → `fetchOutstandingInvoices(parent.id, "tA")`
//      → RED: "the invoice read is the parent's, with no business filter"
import { renderHook, act, waitFor } from "@testing-library/react-native";
import type * as Repo from "../dao/parentHome.repo";
import type * as Rpc from "../dao/parentHome.rpc";
import { useParentHome } from "./useParentHome";

type Impl = (...args: any[]) => unknown;
const mockCalls: { fn: string; args: unknown[] }[] = [];
const ok = (data: unknown = null) => async () => ({ data, error: null });

// The family: one parent with a balance and outstanding invoices at TWO businesses.
const PARENT = {
  id: "parent-1",
  parent_students: [],
  parent_tenant_balances: [{ credit_balance: "12.50" }, { credit_balance: "30.00" }],
};
const INVOICES = [{ net_amount: "40.00" }, { net_amount: "75.00" }];
const COVERAGE_ROW = {
  student_id: "kid-A",
  parent_id: "parent-1",
  tenant_id: "tA",
  coverage: "ad_hoc",
  lessons_remaining: null,
};

// Typed over keyof typeof the dao modules: a dao export added later without a
// default here fails `npm run typecheck`.
const mockRepoDefaults: { [K in keyof typeof Repo]: Impl } = {
  fetchParentHome: ok(PARENT),
  fetchUpcomingTrials: ok([]),
  fetchUpcomingMakeups: ok([]),
  fetchOutstandingInvoices: ok(INVOICES),
  fetchOpenClaims: ok([]),
  fetchSignupJoinCode: ok(null),
  clearSignupJoinCode: ok(null),
};
const mockRpcDefaults: { [K in keyof typeof Rpc]: Impl } = {
  fetchPackageCoverage: ok([COVERAGE_ROW]),
  dismissStudentClaim: ok(null),
  joinTenantByCode: ok(null),
};

// A FUNCTION DECLARATION (hoisted) returning a lazy module: the jest.mock factories
// run when the hook is imported — before the consts above exist — so the defaults
// are looked up at CALL time. Every call lands in the log first.
function mockRecorded(which: "repo" | "rpc") {
  return new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "__esModule") return true;
        const defaults: Record<string, Impl> = which === "repo" ? mockRepoDefaults : mockRpcDefaults;
        const impl = defaults[String(name)];
        if (!impl) throw new Error(`unmocked dao export: ${String(name)}`);
        return (...args: unknown[]) => {
          mockCalls.push({ fn: String(name), args });
          return impl(...args);
        };
      },
    }
  );
}

jest.mock("../dao/parentHome.repo", () => mockRecorded("repo"));
jest.mock("../dao/parentHome.rpc", () => mockRecorded("rpc"));
jest.mock("@/store/useAppStore", () => {
  const store = { session: { id: "profile-1" }, showToast: () => {} };
  return { useAppStore: (sel: any) => sel(store) };
});
jest.mock("@/lib/supabase", () => {
  throw new Error("test reached the real database client — mock the dao seam");
});

/** Run the load and wait for BOTH the awaited chain and the fire-and-forget coverage. */
async function load() {
  const hook = renderHook(() => useParentHome());
  await act(async () => {
    await hook.result.current.loadData();
  });
  await waitFor(() => {
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.covMap.size).toBe(1);
  });
  return hook.result;
}

beforeEach(() => {
  mockCalls.length = 0;
});

describe("useParentHome — the home card is family-wide (D5)", () => {
  it("credit is the family total across every business", async () => {
    const result = await load();
    expect(result.current.creditBalance).toEqual(42.5);
  });

  it("outstanding is every outstanding invoice the parent has", async () => {
    const result = await load();
    expect(result.current.totalOutstanding).toEqual(115);
  });

  it("the invoice read is the parent's, with no business filter", async () => {
    await load();
    expect(
      mockCalls.filter((c) => c.fn === "fetchOutstandingInvoices").map((c) => c.args)
    ).toEqual([["parent-1"]]);
  });
});
