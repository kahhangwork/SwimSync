import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useLocationForm's insert when the caller has NO business (Wave 8, NOT-A-GUARD
// site 7). The old code sent `loadProfileTenantId(auth.user?.id!)` then
// `insertLocation(payload, profile?.tenant_id!)`: signed out, both were
// undefined, the database refused, and the form said "Could not save. Please try
// again." Now nothing is sent and the form says why.

const { dao } = vi.hoisted(() => ({
  dao: {
    getAuthUser: vi.fn(),
    loadProfileTenantId: vi.fn(),
    insertLocation: vi.fn(),
    updateLocation: vi.fn(),
  },
}));

vi.mock("../dao/locations.repo", () => dao);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useLocationForm test reached the real supabase client");
});

import { useLocationForm } from "./useLocationForm";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

const deps = { locations: [], setBusy: vi.fn(), setError: vi.fn(), load: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  dao.getAuthUser.mockResolvedValue({ data: { user: null } }); // signed out
  dao.loadProfileTenantId.mockResolvedValue({ data: null, error: { message: "400" } });
  dao.insertLocation.mockResolvedValue({ error: { code: "42501", message: "RLS" } });
});

describe("useLocationForm with no business", () => {
  it("creating a location sends nothing and says the account has no business", async () => {
    const { result } = renderHook(() => useLocationForm(deps));
    act(() => result.current.openCreate());
    act(() => {
      result.current.setName("East Pool");
      result.current.setSortOrder("1");
    });
    await act(async () => {
      await result.current.save();
    });
    expect(dao.insertLocation).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenLastCalledWith(NO_TENANT_MESSAGE);
    expect(deps.setBusy).toHaveBeenLastCalledWith(false);
    expect(deps.load).not.toHaveBeenCalled();
  });
});
