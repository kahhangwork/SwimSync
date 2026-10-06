import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useUnclaimed's settle when the caller is signed out, or the child's row cannot
// be read (Wave 8, NOT-A-GUARD site 4). The old code sent `tenantId:
// student?.tenant_id!` / `recordedBy: user?.id!` — undefined, so the keys were
// dropped, the database refused, and the modal showed Postgres's own words. Now
// the settlement is never sent and the modal says why.

const { repo } = vi.hoisted(() => ({
  repo: { getUser: vi.fn(), fetchStudentTenant: vi.fn(), insertSettlement: vi.fn() },
}));

vi.mock("../dao/invoices.repo", () => repo);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useUnclaimed test reached the real supabase client");
});

import { useUnclaimed, STUDENT_NOT_FOUND_MESSAGE } from "./useUnclaimed";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";
import type { UnclaimedStudent } from "../types";

const KID = { student_id: "s1", student_name: "Ann", latest_session_date: "2026-08-29" } as UnclaimedStudent;
const setGenResult = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  repo.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
  repo.fetchStudentTenant.mockResolvedValue({ data: { tenant_id: "tenant-A" }, error: null });
  repo.insertSettlement.mockResolvedValue({ error: { message: "null value in column" } });
});

async function settle() {
  const h = renderHook(() => useUnclaimed());
  await act(async () => {
    await h.result.current.handleSettle(KID, "written_off", null, "2026-08", setGenResult);
  });
  return h.result;
}

describe("useUnclaimed settle with nothing to settle against", () => {
  it("signed out: sends nothing and says the account has no business", async () => {
    repo.getUser.mockResolvedValue({ data: { user: null } });
    const result = await settle();
    expect(repo.insertSettlement).not.toHaveBeenCalled();
    expect(result.current.settleError).toBe(NO_TENANT_MESSAGE);
    expect(result.current.settling).toBeNull();
  });

  it("the child's row is missing: sends nothing and says so", async () => {
    repo.fetchStudentTenant.mockResolvedValue({ data: null, error: { message: "0 rows" } });
    const result = await settle();
    expect(repo.insertSettlement).not.toHaveBeenCalled();
    expect(result.current.settleError).toBe(STUDENT_NOT_FOUND_MESSAGE);
    expect(result.current.settling).toBeNull();
  });
});
