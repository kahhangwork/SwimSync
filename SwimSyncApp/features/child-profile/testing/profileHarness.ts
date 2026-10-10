// Test harness for the Child Profile screen's load (WAVE3_RENDER_TESTS_PLAN.md, Lane 2
// step 2.2) — saveHarness's shape (features/mark-attendance/testing/saveHarness.ts).
// Not a test file — jest's testMatch never runs it; the *.test.ts(x) files that wire it
// in do. One module-level log, `calls`, records every dao call IN ORDER.
//
// ⚠ TYPE-ONLY imports of the dao modules. The mock surface is declared over
// `keyof typeof Repo` / `Rpc`, so a dao export added later without a default here
// fails `npm run typecheck`. A VALUE import of either module (or of @/lib/supabase)
// would build the real client: never add one.
//
// ⚠ The money fakes MIRROR POSTGREST (plan RISK 2): `fetchOutstandingInvoices` and
// `fetchParentBalances` filter by the tenant argument WHEN ONE IS PASSED and return
// every business's rows when it is not. So a hook test that goes red against code
// which omits the tenant goes red because of the missing argument, not the fake.
//
// Wiring, the same in every file that uses this (paths relative to that file):
//   jest.mock("<rel>/dao/childProfile.repo", () => require("<rel>/testing/profileHarness").repoMock);
//   jest.mock("<rel>/dao/childProfile.rpc",  () => require("<rel>/testing/profileHarness").rpcMock);
//   jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "kid-A" }) }));
//   jest.mock("@/lib/supabase", () => require("<rel>/testing/profileHarness").supabaseTripwire);
import type * as Repo from "../dao/childProfile.repo";
import type * as Rpc from "../dao/childProfile.rpc";

export type Call = { fn: string; args: unknown[] };
export const calls: Call[] = [];

type Impl = (...args: any[]) => unknown;

// ── The fake database the money reads see ─────────────────────────────────
export type InvoiceRow = { parent_id: string; tenant_id: string; net_amount: string };
export type BalanceRow = { parent_id: string; tenant_id: string; credit_balance: string };
export const db: { invoices: InvoiceRow[]; balances: BalanceRow[] } = {
  invoices: [],
  balances: [],
};

/** kid-A, enrolled at business tA. Only the fields the hook and childDetailOf read. */
export const STUDENT = {
  id: "kid-A",
  full_name: "Anna Tan",
  date_of_birth: null,
  gender: null,
  tenant_id: "tA",
  tenant_levels: null,
  notes: null,
  assignment_status: "assigned",
  is_active: true,
  student_class_enrolments: [],
};

// ── Defaults — the REAL return shapes, read from dao/*.ts ──────────────────
// PostgREST builders resolve { data, error }.
const ok = (data: unknown = null) => async () => ({ data, error: null });

export function outstandingRows(parentId: string, tenantId?: string) {
  return db.invoices
    .filter((i) => i.parent_id === parentId)
    .filter((i) => tenantId === undefined || i.tenant_id === tenantId)
    .map((i) => ({ net_amount: i.net_amount }));
}

export function balancesRecord(parentId: string, tenantId?: string) {
  // The `parents` row with its embedded balances — an embed filter narrows the
  // EMBEDDED rows, never the parent row (PostgREST semantics).
  return {
    parent_tenant_balances: db.balances
      .filter((b) => b.parent_id === parentId)
      .filter((b) => tenantId === undefined || b.tenant_id === tenantId)
      .map((b) => ({ credit_balance: b.credit_balance })),
  };
}

const repoDefaults: { [K in keyof typeof Repo]: Impl } = {
  fetchStudentProfile: ok(STUDENT),
  fetchParentLink: ok({ parent_id: "parent-1" }),
  fetchOutstandingInvoices: async (parentId: string, tenantId?: string) => ({
    data: outstandingRows(parentId, tenantId),
    error: null,
  }),
  fetchParentBalances: async (parentId: string, tenantId?: string) => ({
    data: balancesRecord(parentId, tenantId),
    error: null,
  }),
  fetchGradeScale: ok([]),
  fetchSkillProgress: ok([]),
  fetchPackageOwner: ok(null),
};

// kid-A's coverage row, so a test can waitFor the fire-and-forget coverage setState
// (`coverage` turns defined) instead of letting it land after the test ends.
export const COVERAGE_ROW = {
  student_id: "kid-A",
  parent_id: "parent-1",
  tenant_id: "tA",
  coverage: "ad_hoc",
  lessons_remaining: null,
};

const rpcDefaults: { [K in keyof typeof Rpc]: Impl } = {
  fetchPackageCoverage: ok([COVERAGE_ROW]),
};

// Per-test replacements, cleared by resetHarness(). Recording stays in the wrapper,
// so an override can never silently stop a call reaching the log.
const overrides: Record<string, Impl> = {};

function recorded<D extends Record<string, Impl>>(defaults: D): { [K in keyof D]: jest.Mock } {
  const out = {} as { [K in keyof D]: jest.Mock };
  for (const name of Object.keys(defaults) as (keyof D & string)[]) {
    out[name] = jest.fn((...args: unknown[]) => {
      calls.push({ fn: name, args });
      return (overrides[name] ?? defaults[name])(...args);
    });
  }
  return out;
}

export const repoMock = recorded(repoDefaults);
export const rpcMock = recorded(rpcDefaults);

/** Replace one dao function's behaviour for the current test. */
export function when(name: keyof typeof Repo | keyof typeof Rpc, impl: Impl): void {
  overrides[name] = impl;
}

/** A TRIPWIRE, not a seam: any path that reaches the real client throws, so an
 *  unmocked call can never talk to a database a local .env points at. */
export const supabaseTripwire = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === "__esModule") return false;
      throw new Error(`test reached the real database client (.${String(p)}) — mock the dao seam`);
    },
  }
);

/** Call in every file's beforeEach. Clears the log, the fake rows and every override. */
export function resetHarness(): void {
  calls.length = 0;
  db.invoices = [];
  db.balances = [];
  for (const k of Object.keys(overrides)) delete overrides[k];
  for (const m of [...Object.values(repoMock), ...Object.values(rpcMock)]) m.mockClear();
}

/** The args of every recorded call to `fn`, in order. */
export function argsOf(fn: string, log: readonly Call[] = calls): unknown[][] {
  return log.filter((c) => c.fn === fn).map((c) => c.args);
}
