import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// usePackageSettings' read when signed out (Wave 8, NOT-A-GUARD site 10). The old
// code sent `fetchTenantPackageSettings(userRes.user?.id!)` — an `id=eq.undefined`
// query PostgREST rejects with a 400 — and then fell back to the defaults
// silently. The defaults and the silence are right (the page isn't broken, only
// unpersonalised); the doomed request is not. Now it is never sent.

const { repo, rpc } = vi.hoisted(() => ({
  repo: { getCurrentUser: vi.fn(), fetchTenantPackageSettings: vi.fn() },
  rpc: { fetchPackageCoverage: vi.fn() },
}));

vi.mock("../dao/students.repo", () => repo);
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: usePackageSettings test reached the real supabase client");
});

import { usePackageSettings } from "./usePackageSettings";

beforeEach(() => {
  vi.clearAllMocks();
  repo.getCurrentUser.mockResolvedValue({ data: { user: null } }); // signed out
  repo.fetchTenantPackageSettings.mockResolvedValue({ data: null, error: { message: "400 invalid uuid" } });
  rpc.fetchPackageCoverage.mockResolvedValue({ data: [] });
});

describe("usePackageSettings signed out", () => {
  it("sends no settings read, keeps the defaults, and still loads coverage", async () => {
    const { result } = renderHook(() => usePackageSettings());
    await act(async () => {
      await result.current.loadPackages();
    });
    expect(repo.fetchTenantPackageSettings).not.toHaveBeenCalled();
    expect(result.current.threshold).toBe("2");
    expect(result.current.expiryDays).toBe("14");
    expect(result.current.tenantId).toBeNull();
    expect(rpc.fetchPackageCoverage).toHaveBeenCalledTimes(1);
  });
});
