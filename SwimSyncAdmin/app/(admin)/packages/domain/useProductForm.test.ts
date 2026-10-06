import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useProductForm's insert when the caller has NO business (Wave 8, NOT-A-GUARD
// site 9). The old code sent `tenant_id: (await rpc.myTenantId())!` — NULL; the
// database refused it and the form said "Could not create the package." Now
// nothing is sent and the form says why.

const { repo, rpc } = vi.hoisted(() => ({
  repo: { insertProduct: vi.fn() },
  rpc: { myTenantId: vi.fn() },
}));

vi.mock("../dao/packages.repo", () => repo);
vi.mock("../dao/packages.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useProductForm test reached the real supabase client");
});

import { useProductForm } from "./useProductForm";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

const shared = { setBusy: vi.fn(), reload: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.myTenantId.mockResolvedValue(null); // signed out / no business
  repo.insertProduct.mockResolvedValue({ error: { code: "23502", message: "null tenant_id" } });
});

describe("useProductForm with no business", () => {
  it("creating a package sends nothing and says the account has no business", async () => {
    const { result } = renderHook(() => useProductForm(shared));
    act(() => result.current.openProductModal());
    act(() => {
      result.current.setPName("10-pack");
      result.current.setPLessons("10");
      result.current.setPRate("35");
    });
    await act(async () => {
      await result.current.saveProduct();
    });
    expect(repo.insertProduct).not.toHaveBeenCalled();
    expect(result.current.formError).toBe(NO_TENANT_MESSAGE);
    expect(shared.setBusy).toHaveBeenLastCalledWith(false);
    expect(result.current.productModal).toBe(true);
  });
});
