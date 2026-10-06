import { act, renderHook } from "@testing-library/react-native";

// Load-bearing: fetched on the FIRST expand only (never with the tab, never
// again on re-open); a failed read is said and retried on the next expand.

const mockFetch = jest.fn();
jest.mock("../dao/billing.rpc", () => ({
  fetchPackageUsage: (...a: unknown[]) => mockFetch(...a),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: usePackageUsage test reached the real supabase client");
});

import { usePackageUsage } from "./usePackageUsage";

const ROW = { lesson_date: "2026-10-03", student_id: "s1", student_name: "Ava", class_title: "Dolphins",
  amount: 35, source: "marking", applied_at: "2026-10-03T09:00:00Z", reversed_at: null };

beforeEach(() => mockFetch.mockReset());

it("fetches nothing until a package is opened", () => {
  renderHook(() => usePackageUsage());
  expect(mockFetch).not.toHaveBeenCalled();
});

it("first open fetches that package; close + re-open does not fetch again", async () => {
  mockFetch.mockResolvedValue({ data: [ROW], error: null });
  const { result } = renderHook(() => usePackageUsage());

  await act(() => result.current.toggle("pkg-1"));
  expect(mockFetch).toHaveBeenCalledWith("pkg-1");
  expect(result.current.stateOf("pkg-1")).toMatchObject({ open: true, loading: false, error: null });
  expect(result.current.stateOf("pkg-1").rows).toHaveLength(1);

  await act(() => result.current.toggle("pkg-1"));
  expect(result.current.stateOf("pkg-1").open).toBe(false);
  await act(() => result.current.toggle("pkg-1"));
  expect(result.current.stateOf("pkg-1").open).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);

  expect(result.current.stateOf("pkg-2").open).toBe(false); // packages are independent
});

it("a failed read is said, and the next open retries", async () => {
  mockFetch.mockResolvedValueOnce({ data: null, error: { message: "42501" } });
  const { result } = renderHook(() => usePackageUsage());
  await act(() => result.current.toggle("pkg-1"));
  expect(result.current.stateOf("pkg-1").error).toMatch(/Couldn't load/);
  expect(result.current.stateOf("pkg-1").rows).toBeNull();

  mockFetch.mockResolvedValueOnce({ data: [ROW], error: null });
  await act(() => result.current.toggle("pkg-1")); // close
  await act(() => result.current.toggle("pkg-1")); // re-open → retry
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(result.current.stateOf("pkg-1")).toMatchObject({ error: null, loading: false });
});
