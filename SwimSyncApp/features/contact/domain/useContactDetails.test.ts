import { act, renderHook, waitFor } from "@testing-library/react-native";

// Wave 8 Bug-ledger row #1 (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md): the generated
// types flagged that every contact.repo call may receive `session?.id` = undefined
// (`.eq("profile_id", undefined)` sends `eq.undefined` → PostgREST 400). Written
// against the UNFIXED code to answer what a parent actually sees:
//   - the LOAD never runs without an id (the focus-effect guard), so `ready` stays
//     false — and contact.tsx renders only a spinner until `ready`, so the form and
//     its Save button never exist without an id;
//   - Save, if it were ever reached without an id, is a visible failure toast,
//     never a silent "saved".

const mockFetchAddress = jest.fn();
const mockFetchContact = jest.fn();
const mockUpdateAddress = jest.fn();
const mockUpdateContact = jest.fn();
jest.mock("../dao/contact.repo", () => ({
  fetchParentAddress: (...a: unknown[]) => mockFetchAddress(...a),
  fetchProfileContact: (...a: unknown[]) => mockFetchContact(...a),
  updateParentAddress: (...a: unknown[]) => mockUpdateAddress(...a),
  updateProfileContact: (...a: unknown[]) => mockUpdateContact(...a),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useContactDetails test reached the real supabase client");
});

const mockShowToast = jest.fn();
let mockSession: { id: string } | null = null;
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: { session: typeof mockSession; showToast: typeof mockShowToast }) => unknown) =>
    sel({ session: mockSession, showToast: mockShowToast }),
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  // Run the focus effect like a mount effect, re-running when the callback changes.
  useFocusEffect: (cb: () => void | (() => void)) => require("react").useEffect(cb, [cb]),
}));

import { useContactDetails } from "./useContactDetails";

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockFetchAddress.mockResolvedValue({ data: { address: "1 Pool Rd", postal_code: "123456" }, error: null });
  mockFetchContact.mockResolvedValue({ data: { full_name: "Pat Lee", phone: "91234567" }, error: null });
});

it("with no session id the load never runs, so the screen stays on its spinner (no form, no Save)", async () => {
  const { result } = renderHook(() => useContactDetails());
  await act(async () => {});
  expect(mockFetchAddress).not.toHaveBeenCalled();
  expect(mockFetchContact).not.toHaveBeenCalled();
  expect(result.current.ready).toBe(false);
});

it("with a session id the load runs with THAT id and the form becomes ready", async () => {
  mockSession = { id: "p1" };
  const { result } = renderHook(() => useContactDetails());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(mockFetchAddress).toHaveBeenCalledWith("p1");
  expect(mockFetchContact).toHaveBeenCalledWith("p1");
  expect(result.current.fullName).toBe("Pat Lee");
});

it("a Save reached without an id (unreachable through contact.tsx) fails VISIBLY — never a silent success", async () => {
  // What PostgREST answers `profile_id=eq.undefined` / `id=eq.undefined` with.
  const bad = { error: { code: "22P02", message: 'invalid input syntax for type uuid: "undefined"' } };
  mockUpdateAddress.mockResolvedValue(bad);
  mockUpdateContact.mockResolvedValue(bad);
  const { result } = renderHook(() => useContactDetails());
  act(() => result.current.setFullName("Pat Lee"));
  await act(() => result.current.handleSave());
  expect(mockUpdateAddress).toHaveBeenCalledWith(undefined, { address: null, postal_code: null });
  expect(mockUpdateContact).toHaveBeenCalledWith(undefined, { full_name: "Pat Lee", phone: null });
  expect(mockShowToast).toHaveBeenCalledWith("Could not save your details. Please try again.", "error");
  expect(mockShowToast).not.toHaveBeenCalledWith("Your details have been saved.", "success");
  expect(mockBack).not.toHaveBeenCalled();
});
