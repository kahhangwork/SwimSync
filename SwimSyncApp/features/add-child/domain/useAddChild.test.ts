import { act, renderHook, waitFor } from "@testing-library/react-native";

// useAddChild — gender is required and never pre-selected (BACKLOG *UI restyle
// leftovers*; user decision 2026-10-15). A default is a value the parent did not
// choose, and a child's profile cannot be deleted afterwards (PRD §7.14).
//
// RED FIRST (§7.25) — against the pre-fix hook (state defaulted to "Male"):
//   "the form starts with no gender selected"          → Expected: "", Received: "Male"
//   "Save without a gender is refused before the review" → reviewing was true

const mockFetchTenants = jest.fn();
const mockAddChild = jest.fn();
jest.mock("../dao/addChild.repo", () => ({
  fetchActiveJoinedTenants: (...a: unknown[]) => mockFetchTenants(...a),
}));
jest.mock("../dao/addChild.rpc", () => ({
  addChildOrClaim: (...a: unknown[]) => mockAddChild(...a),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useAddChild test reached the real supabase client");
});

const mockShowToast = jest.fn();
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: { session: { id: string }; showToast: typeof mockShowToast }) => unknown) =>
    sel({ session: { id: "parent-1" }, showToast: mockShowToast }),
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => require("react").useEffect(cb, [cb]),
}));

import { useAddChild } from "./useAddChild";

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchTenants.mockResolvedValue({
    data: [{ tenant_id: "t1", is_active: true, tenants: { id: "t1", display_name: "Little Orcas" } }],
    error: null,
  });
});

async function filledForm() {
  const hook = renderHook(() => useAddChild());
  await waitFor(() => expect(hook.result.current.tenantId).toBe("t1"));
  act(() => {
    hook.result.current.setName("Emma Tan");
    hook.result.current.setDob("2019-01-01");
  });
  return hook.result;
}

it("the form starts with no gender selected", async () => {
  const result = await filledForm();
  expect(result.current.gender).toBe("");
});

it("Save without a gender is refused before the review — nothing is sent", async () => {
  const result = await filledForm();
  await act(async () => {
    await result.current.handleSave();
  });
  expect(result.current.reviewing).toBe(false);
  expect(mockShowToast).toHaveBeenCalledWith("Choose the child's gender.", "error");
  expect(mockAddChild).not.toHaveBeenCalled();
});

it("with a gender chosen, Save opens the review", async () => {
  const result = await filledForm();
  act(() => result.current.setGender("Female"));
  await act(async () => {
    await result.current.handleSave();
  });
  expect(result.current.reviewing).toBe(true);
  expect(mockShowToast).not.toHaveBeenCalled();
});
