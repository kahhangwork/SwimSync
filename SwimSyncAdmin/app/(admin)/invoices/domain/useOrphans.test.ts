import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useOrphans' settle with NO signed-in user (Wave 8, NOT-A-GUARD site 3). The old
// code sent `recordedBy: user?.id!` — undefined, so the key was dropped, the
// database refused the NOT NULL column, and the panel showed Postgres's own
// words. Now the settlement is never sent and the panel says why.

const { repo, rpc } = vi.hoisted(() => ({
  repo: { getUser: vi.fn(), insertSettlement: vi.fn() },
  rpc: { unbilledSealedLessons: vi.fn() },
}));

vi.mock("../dao/invoices.repo", () => repo);
vi.mock("../dao/invoices.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useOrphans test reached the real supabase client");
});

import { useOrphans } from "./useOrphans";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";
import type { OrphanLine } from "../types";

const LINE = { student_id: "s1", billing_month: "2026-08", latest_session_date: "2026-08-29" } as OrphanLine;

beforeEach(() => {
  vi.clearAllMocks();
  repo.getUser.mockResolvedValue({ data: { user: null } }); // signed out
  repo.insertSettlement.mockResolvedValue({ error: { message: 'null value in column "recorded_by"' } });
  rpc.unbilledSealedLessons.mockResolvedValue({ data: [], error: null });
});

describe("useOrphans with no signed-in user", () => {
  it("settling a line sends nothing and says the account has no business", async () => {
    const { result } = renderHook(() => useOrphans("tenant-A"));
    await act(async () => {
      await result.current.handleSettleOrphan(LINE, "written_off", null);
    });
    expect(repo.insertSettlement).not.toHaveBeenCalled();
    expect(result.current.orphanError).toBe(NO_TENANT_MESSAGE);
    expect(result.current.orphanSettling).toBeNull();
  });
});
