import { act, renderHook } from "@testing-library/react-native";

// The nightly's coach-settings red (run 43533390943, 2026-11-14): the upload
// button was pressable before loadCoach settled. canEditQr starts false, so an
// early press told a private coach "your school manages the payment QR code"
// and opened no picker — the driver timed out waiting for the file chooser.
//
// MUTATION PROOFS (§7.25) — each applied, run, reverted:
//   1. handleUploadQR: `if (uploading || !qrReady) return;` → `if (uploading) return;`
//      → RED: "a press before the load settles does nothing — no wrong-reason toast, no picker"
//   2. loadCoach: drop `setQrReady(true)` from the finally
//      → RED: four tests — every one that presses after the load, plus the first's
//        closing `qrReady` assertion (the button would never enable)
//   3. handleUploadQR: put the canEditQr guard back above the tenantId guard
//      → RED: "a failed load still settles, and says the business was not found"

const mockFetchCoach = jest.fn();
const mockFetchTenantPaynow = jest.fn();
const mockFetchProfileRole = jest.fn();
const mockFetchCanEditBilling = jest.fn();
jest.mock("../dao/coachSettings.repo", () => ({
  fetchCoach: (...a: unknown[]) => mockFetchCoach(...a),
  fetchTenantPaynow: (...a: unknown[]) => mockFetchTenantPaynow(...a),
  fetchProfileRole: (...a: unknown[]) => mockFetchProfileRole(...a),
  fetchCanEditBilling: (...a: unknown[]) => mockFetchCanEditBilling(...a),
  updateTenantQrUrl: jest.fn(),
}));
jest.mock("../dao/coachSettings.storage", () => ({
  readImageBytes: jest.fn(),
  uploadQrImage: jest.fn(),
  qrPublicUrl: jest.fn(),
}));
jest.mock("../dao/coachSettings.auth", () => ({ signOut: jest.fn() }));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useCoachSettings test reached the real supabase client");
});

const mockLaunch = jest.fn();
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => Promise.resolve({ granted: true }),
  launchImageLibraryAsync: (...a: unknown[]) => mockLaunch(...a),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@/lib/confirm", () => ({ confirmAction: jest.fn() }));

const mockShowToast = jest.fn();
const mockSession = { id: "u1", email: "coach@x.sg", fullName: "Marcus" };
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: object) => unknown) =>
    sel({ session: mockSession, showToast: mockShowToast, clearSession: jest.fn() }),
}));

import { useCoachSettings } from "./useCoachSettings";

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchCoach.mockResolvedValue({ data: { id: "c1", tenant_id: "t1" }, error: null });
  mockFetchTenantPaynow.mockResolvedValue({ data: { paynow_qr_url: null, paynow_uen: null, paynow_mobile: null } });
  mockFetchProfileRole.mockResolvedValue({ data: { role: "tenant_admin" } });
  mockFetchCanEditBilling.mockResolvedValue({ data: true });
  mockLaunch.mockResolvedValue({ canceled: true, assets: [] });
});

it("a press before the load settles does nothing — no wrong-reason toast, no picker", async () => {
  let release!: (v: { data: boolean }) => void;
  mockFetchCanEditBilling.mockReturnValue(new Promise((r) => { release = r; }));
  const { result } = renderHook(() => useCoachSettings());
  let load!: Promise<void>;
  act(() => { load = result.current.loadCoach(); });
  expect(result.current.qrReady).toBe(false);

  await act(() => result.current.handleUploadQR());
  expect(mockShowToast).not.toHaveBeenCalled();
  expect(mockLaunch).not.toHaveBeenCalled();

  await act(async () => { release({ data: true }); await load; });
  expect(result.current.qrReady).toBe(true);
});

it("once loaded, a press opens the picker", async () => {
  const { result } = renderHook(() => useCoachSettings());
  await act(() => result.current.loadCoach());
  expect(result.current.qrReady).toBe(true);
  await act(() => result.current.handleUploadQR());
  expect(mockLaunch).toHaveBeenCalledTimes(1);
  expect(mockShowToast).not.toHaveBeenCalled();
});

it("a school coach without Billing: Edit is told the school manages it", async () => {
  mockFetchCanEditBilling.mockResolvedValue({ data: false });
  const { result } = renderHook(() => useCoachSettings());
  await act(() => result.current.loadCoach());
  await act(() => result.current.handleUploadQR());
  expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/^Your school manages/), "error");
  expect(mockLaunch).not.toHaveBeenCalled();
});

it("a failed load still settles, and says the business was not found", async () => {
  mockFetchCoach.mockResolvedValue({ data: null, error: { message: "boom" } });
  const { result } = renderHook(() => useCoachSettings());
  await act(() => result.current.loadCoach());
  expect(result.current.qrReady).toBe(true);
  await act(() => result.current.handleUploadQR());
  expect(mockShowToast).toHaveBeenCalledWith("Could not find your business account.", "error");
  expect(mockLaunch).not.toHaveBeenCalled();
});
