import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useCategories' insert when the caller has NO business (Wave 8, NOT-A-GUARD
// site 8). The old code sent `tenant_id: (await rpc.myTenantId())!` — NULL; the
// database refused it and the banner said "Could not add that category." Now
// nothing is sent and the banner says why.

const { repo, rpc } = vi.hoisted(() => ({
  repo: { insertCategory: vi.fn() },
  rpc: { myTenantId: vi.fn() },
}));

vi.mock("../dao/packages.repo", () => repo);
vi.mock("../dao/packages.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useCategories test reached the real supabase client");
});

import { useCategories } from "./useCategories";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

const shared = { setBusy: vi.fn(), setError: vi.fn(), reload: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.myTenantId.mockResolvedValue(null); // signed out / no business
  repo.insertCategory.mockResolvedValue({ error: { code: "23502", message: "null tenant_id" } });
});

describe("useCategories with no business", () => {
  it("adding a category sends nothing and says the account has no business", async () => {
    const { result } = renderHook(() => useCategories(shared));
    act(() => result.current.setNewCategory("Squad"));
    await act(async () => {
      await result.current.addCategory();
    });
    expect(repo.insertCategory).not.toHaveBeenCalled();
    expect(shared.setError).toHaveBeenLastCalledWith(NO_TENANT_MESSAGE);
    expect(shared.setBusy).toHaveBeenLastCalledWith(false);
    expect(shared.reload).not.toHaveBeenCalled();
  });
});
