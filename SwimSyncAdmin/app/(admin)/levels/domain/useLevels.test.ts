import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// useLevels' two inserts when the caller has NO business (Wave 8, NOT-A-GUARD
// sites 5–6). The old code resolved the tenant inline with two `!`s: signed out,
// profileTenant got `undefined` (an `id=eq.undefined` 400), the tenant_id key was
// dropped, the database refused, and the page said "Could not save. Please try
// again." / "Could not add that grade." Now nothing is sent and the page says why.

const { repo } = vi.hoisted(() => ({
  repo: {
    loadLevels: vi.fn(),
    loadGradeScale: vi.fn(),
    getAuthUser: vi.fn(),
    profileTenant: vi.fn(),
    insertLevel: vi.fn(),
    insertGrade: vi.fn(),
    updateLevel: vi.fn(),
  },
}));

vi.mock("../dao/levels.repo", () => repo);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useLevels test reached the real supabase client");
});

import { useLevels } from "./useLevels";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

beforeEach(() => {
  vi.clearAllMocks();
  repo.loadLevels.mockResolvedValue({ data: [] });
  repo.loadGradeScale.mockResolvedValue({ data: [] });
  repo.getAuthUser.mockResolvedValue({ data: { user: null } }); // signed out
  repo.profileTenant.mockResolvedValue({ data: null, error: { message: "400" } });
  repo.insertLevel.mockResolvedValue({ error: { code: "23502", message: "null tenant_id" } });
  repo.insertGrade.mockResolvedValue({ error: { code: "23502", message: "null tenant_id" } });
});

async function mounted() {
  const h = renderHook(() => useLevels());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("useLevels with no business", () => {
  it("creating a level sends nothing and says the account has no business", async () => {
    const { result } = await mounted();
    act(() => result.current.openCreate());
    act(() => result.current.setLabel("Seahorse"));
    await act(async () => {
      await result.current.save();
    });
    expect(repo.insertLevel).not.toHaveBeenCalled();
    expect(result.current.error).toBe(NO_TENANT_MESSAGE);
    expect(result.current.busy).toBe(false);
  });

  it("adding a grade sends nothing and says the account has no business", async () => {
    const { result } = await mounted();
    act(() => result.current.setNewGrade("Mastered"));
    await act(async () => {
      await result.current.addGrade();
    });
    expect(repo.insertGrade).not.toHaveBeenCalled();
    expect(result.current.scaleError).toBe(NO_TENANT_MESSAGE);
    expect(result.current.scaleBusy).toBe(false);
  });
});
