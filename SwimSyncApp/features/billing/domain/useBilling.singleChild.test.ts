import { act, renderHook, waitFor } from "@testing-library/react-native";

// ⚠ RISK 8 — the request's refusals are INLINE text (never Alert.alert, a no-op on
// RN-web): a one-child product with no child is refused before sending, and the
// database's own sentence (23514) is shown as-is.

const mockInsert = jest.fn();
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: object) => unknown) => sel({ session: { id: "u1" }, showToast: jest.fn() }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/confirm", () => ({ confirmAction: jest.fn() }));
jest.mock("../dao/billing.api", () => ({ invokePackageEmail: jest.fn(async () => ({})) }));
jest.mock("../dao/billing.rpc", () => ({
  claimInvoicePaid: jest.fn(),
  fetchLiveBalances: jest.fn(async () => ({ data: [], error: null })),
}));
jest.mock("../dao/billing.repo", () => ({
  fetchParentId: jest.fn(async () => ({ data: { id: "p1" }, error: null })),
  fetchInvoices: jest.fn(async () => ({ data: [], error: null })),
  fetchCreditNotes: jest.fn(async () => ({ data: [], error: null })),
  fetchPackages: jest.fn(async () => ({ data: [], error: null })),
  fetchProducts: jest.fn(async () => ({ data: [], error: null })),
  fetchChildren: jest.fn(async () => ({ data: [], error: null })),
  insertPackageRequest: (...a: unknown[]) => mockInsert(...a),
  cancelPackageRequest: jest.fn(),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: reached the real supabase client");
});

import { useBilling } from "./useBilling";
import type { PackageProduct } from "../types";

const ONE: PackageProduct = { id: "oc5", tenant_id: "tA", single_child: true, name: "OC5", business_name: "Orcas",
  category_name: null, lesson_count: 5, rate_per_lesson: 30, validity_weeks: 20 };

async function loaded() {
  const h = renderHook(() => useBilling());
  await act(async () => { await h.result.current.loadData(); });
  return h;
}

beforeEach(() => mockInsert.mockReset());

it("a one-child product without a child is refused before sending", async () => {
  const { result } = await loaded();
  await act(async () => { await result.current.requestPackage(ONE, null); });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(result.current.packageError).toBe("Choose which child this package is for.");
});

it("the database's refusal sentence is shown inline", async () => {
  mockInsert.mockResolvedValue({ data: null, error: { code: "23514", message: "That child is not in this family." } });
  const { result } = await loaded();
  await act(async () => { await result.current.requestPackage(ONE, "ava"); });
  expect(mockInsert).toHaveBeenCalledWith("p1", "oc5", "ava");
  await waitFor(() => expect(result.current.packageError).toBe("That child is not in this family."));
});

it("a shared product sends null whatever it is passed (RISK 7)", async () => {
  mockInsert.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
  const { result } = await loaded();
  await act(async () => { await result.current.requestPackage({ ...ONE, single_child: false }, "ava"); });
  expect(mockInsert).toHaveBeenCalledWith("p1", "oc5", null);
  expect(result.current.packageError).toBe("Could not request that package. Please try again.");
});
