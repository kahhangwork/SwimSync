import { act, renderHook, waitFor } from "@testing-library/react-native";

// useEditChild — gender is required and never pre-selected (BACKLOG *UI restyle
// leftovers*; user decision 2026-10-15). A child with no gender on file used to load
// as "Male", so ANY edit — fixing a typo in the name — silently saved them as male.
// 27 of 41 children on prod had no gender when this was found.
//
// RED FIRST (§7.25) — against the pre-fix hook (state defaulted to "Male"):
//   "a child with no gender on file loads with nothing selected"
//     → Expected: "", Received: "Male"
//   "Save without a gender is refused — nothing is written"
//     → updateChild called with { gender: "male", … }

const mockFetch = jest.fn();
const mockUpdate = jest.fn();
jest.mock("../dao/editChild.repo", () => ({
  fetchChildForEdit: (...a: unknown[]) => mockFetch(...a),
  updateChild: (...a: unknown[]) => mockUpdate(...a),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useEditChild test reached the real supabase client");
});

const mockShowToast = jest.fn();
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: { showToast: typeof mockShowToast }) => unknown) =>
    sel({ showToast: mockShowToast }),
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  useLocalSearchParams: () => ({ id: "kid-1" }),
  useFocusEffect: (cb: () => void | (() => void)) => require("react").useEffect(cb, [cb]),
}));

import { useEditChild } from "./useEditChild";

function child(gender: string | null) {
  return { data: { full_name: "Noah Lim", date_of_birth: "2019-09-09", gender, notes: null }, error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({ error: null });
});

it("a child with no gender on file loads with nothing selected", async () => {
  mockFetch.mockResolvedValue(child(null));
  const { result } = renderHook(() => useEditChild());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.gender).toBe("");
});

it("Save without a gender is refused — nothing is written", async () => {
  mockFetch.mockResolvedValue(child(null));
  const { result } = renderHook(() => useEditChild());
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    await result.current.handleSave();
  });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockShowToast).toHaveBeenCalledWith("Choose the child's gender.", "error");
  expect(mockBack).not.toHaveBeenCalled();
});

it("a recorded gender loads selected and is saved unchanged", async () => {
  mockFetch.mockResolvedValue(child("female"));
  const { result } = renderHook(() => useEditChild());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.gender).toBe("Female");
  await act(async () => {
    await result.current.handleSave();
  });
  expect(mockUpdate).toHaveBeenCalledWith("kid-1", expect.objectContaining({ gender: "female" }));
});

it("once a gender is chosen, Save writes it", async () => {
  mockFetch.mockResolvedValue(child(null));
  const { result } = renderHook(() => useEditChild());
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.setGender("Male"));
  await act(async () => {
    await result.current.handleSave();
  });
  expect(mockUpdate).toHaveBeenCalledWith("kid-1", expect.objectContaining({ gender: "male" }));
  expect(mockBack).toHaveBeenCalled();
});
