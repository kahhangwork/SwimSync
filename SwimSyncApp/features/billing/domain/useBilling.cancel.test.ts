import { act, renderHook } from "@testing-library/react-native";

// BACKLOG *Cancelling a package request has no confirmation*: Cancel must ASK
// before it sends (confirmAction — never Alert.alert, a no-op on RN-web), and a
// business-prepared offer (`offered_by`) says what declining costs.

const mockCancel = jest.fn();
const mockConfirm = jest.fn();
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: object) => unknown) => sel({ session: { id: "u1" }, showToast: jest.fn() }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...a: unknown[]) => mockConfirm(...a) }));
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
  insertPackageRequest: jest.fn(),
  cancelPackageRequest: (...a: unknown[]) => mockCancel(...a),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: reached the real supabase client");
});

import { useBilling } from "./useBilling";
import type { ParentPackage } from "../types";

const PKG = { id: "pk1", business_name: "Orcas", offered_by: null } as unknown as ParentPackage;

beforeEach(() => {
  mockCancel.mockReset().mockResolvedValue({ error: null });
  mockConfirm.mockReset();
});

it("asks first, and sends nothing until confirmed", async () => {
  const { result } = renderHook(() => useBilling());
  await act(async () => { result.current.cancelRequest(PKG); });
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(mockCancel).not.toHaveBeenCalled();

  const onConfirm = mockConfirm.mock.calls[0][2] as () => Promise<void>;
  await act(async () => { await onConfirm(); });
  expect(mockCancel).toHaveBeenCalledWith("pk1");
});

it("a business-prepared offer names the business and what declining costs", async () => {
  const { result } = renderHook(() => useBilling());
  await act(async () => { result.current.cancelRequest({ ...PKG, offered_by: "coach1" }); });
  expect(mockConfirm.mock.calls[0][1]).toMatch(/^Discard the package Orcas prepared for you.*ask them to prepare it again/);
});

it("a failed cancel is shown inline", async () => {
  mockCancel.mockResolvedValue({ error: { message: "boom" } });
  const { result } = renderHook(() => useBilling());
  await act(async () => { result.current.cancelRequest(PKG); });
  await act(async () => { await (mockConfirm.mock.calls[0][2] as () => Promise<void>)(); });
  expect(result.current.packageError).toBe("Could not cancel that request.");
});
