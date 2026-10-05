// useChildProfile — the money half of the Child Profile load (WAVE3_RENDER_TESTS_PLAN.md
// D5). The card shows ONE child, who belongs to ONE business, so Outstanding and Credit
// are that business's figures — never the family's total across every business (that is
// the HOME card's job, and it stays family-wide). Dao calls land in one ordered log
// (testing/profileHarness), whose money fakes filter by the tenant argument when one is
// passed and return every business's rows when it is not (mirroring PostgREST).
//
// RED FIRST (§7.25) — against the pre-fix code (origin/main @ adbd429), which read the
// family's figures across every business:
//   "outstanding and credit are the child's business's figures only"
//     → Expected: 40, Received: 115
//   "the money reads are scoped to the child's tenant"
//     → fetchOutstandingInvoices called with ["parent-1"], not ["parent-1", "tA"]
//   "no balance row at the child's business → credit is exactly 0, not B's credit"
//     → Expected: 0, Received: 30
//
// MUTATION PROOFS — applied through mutate.sh (restores from HEAD on exit):
//   useChildProfile.ts
//   1. invoice read passed `undefined` instead of the child's tenant
//      → RED: "outstanding and credit are the child's business's figures only"
//      → RED: "the money reads are scoped to the child's tenant"
//   2. credit read passed `undefined` instead of the child's tenant
//      → RED: "no balance row at the child's business → credit is exactly 0, not B's credit"
//   childFormat.ts
//   3. outstandingOf `sum + Number(…)` → `Math.max(sum, Number(…))`
//      → RED: "a sibling's outstanding invoice at the SAME business counts (family at this business)"
//   testing/profileHarness.ts
//   4. the invoice fake filters by tenant even when none is passed
//      → RED: "no tenant → every business's rows; a tenant → only that business's"
// Deleting the dao's own tenant filter leaves THIS file green (the dao is mocked) —
// dao/childProfile.repo.test.ts pins that.
//
// ⚠ `age` is never asserted: ageFromDob reads the real clock (§7.313).
import { renderHook, act, waitFor } from "@testing-library/react-native";
import {
  db,
  resetHarness,
  argsOf,
  outstandingRows,
  balancesRecord,
} from "../testing/profileHarness";
import { useChildProfile } from "./useChildProfile";

jest.mock("../dao/childProfile.repo", () => require("../testing/profileHarness").repoMock);
jest.mock("../dao/childProfile.rpc", () => require("../testing/profileHarness").rpcMock);
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "kid-A" }) }));
jest.mock("@/lib/supabase", () => require("../testing/profileHarness").supabaseTripwire);

/** The family: kid-A at business tA; the same parent also owes / holds credit at tB. */
function twoBusinesses() {
  db.invoices = [
    { parent_id: "parent-1", tenant_id: "tA", net_amount: "40.00" },
    { parent_id: "parent-1", tenant_id: "tB", net_amount: "75.00" },
  ];
  db.balances = [
    { parent_id: "parent-1", tenant_id: "tA", credit_balance: "12.50" },
    { parent_id: "parent-1", tenant_id: "tB", credit_balance: "30.00" },
  ];
}

/** Run the load and wait for BOTH the awaited chain and the fire-and-forget coverage. */
async function load() {
  const hook = renderHook(() => useChildProfile());
  await act(async () => {
    await hook.result.current.loadChild();
  });
  await waitFor(() => {
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.coverage?.coverage).toBe("ad_hoc");
  });
  return hook.result;
}

beforeEach(() => resetHarness());

describe("profileHarness money fakes (so a red comes from the missing argument)", () => {
  it("no tenant → every business's rows; a tenant → only that business's", () => {
    twoBusinesses();
    expect(outstandingRows("parent-1")).toEqual([{ net_amount: "40.00" }, { net_amount: "75.00" }]);
    expect(outstandingRows("parent-1", "tA")).toEqual([{ net_amount: "40.00" }]);
    expect(balancesRecord("parent-1")).toEqual({
      parent_tenant_balances: [{ credit_balance: "12.50" }, { credit_balance: "30.00" }],
    });
    expect(balancesRecord("parent-1", "tA")).toEqual({
      parent_tenant_balances: [{ credit_balance: "12.50" }],
    });
  });
});

describe("useChildProfile — balances are the child's business's (D5)", () => {
  it("outstanding and credit are the child's business's figures only", async () => {
    twoBusinesses();
    const result = await load();
    expect(result.current.child?.outstanding_amount).toEqual(40);
    expect(result.current.child?.credit_balance).toEqual(12.5);
  });

  it("the money reads are scoped to the child's tenant", async () => {
    twoBusinesses();
    await load();
    expect(argsOf("fetchOutstandingInvoices")).toEqual([["parent-1", "tA"]]);
    expect(argsOf("fetchParentBalances")).toEqual([["parent-1", "tA"]]);
  });

  it("no balance row at the child's business → credit is exactly 0, not B's credit", async () => {
    db.balances = [{ parent_id: "parent-1", tenant_id: "tB", credit_balance: "30.00" }];
    const result = await load();
    expect(result.current.child?.credit_balance).toEqual(0);
  });

  it("a sibling's outstanding invoice at the SAME business counts (family at this business)", async () => {
    // Invoices are per parent, not per child: the card shows what the family owes
    // THIS business. Pinned as-is for the PRD wording (plan RISK 11).
    db.invoices = [
      { parent_id: "parent-1", tenant_id: "tA", net_amount: "40.00" }, // kid-A's
      { parent_id: "parent-1", tenant_id: "tA", net_amount: "22.25" }, // a sibling's, same business
      { parent_id: "parent-1", tenant_id: "tB", net_amount: "75.00" },
    ];
    const result = await load();
    expect(result.current.child?.outstanding_amount).toEqual(62.25);
  });
});
