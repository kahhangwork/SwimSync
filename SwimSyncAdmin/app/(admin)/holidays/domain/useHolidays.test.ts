import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// useHolidays' two writes when the caller has NO business (Wave 8, NOT-A-GUARD
// sites 1–2). The old code sent `tenant_id: null`; the database refused it and
// the page said "Could not add that holiday." / "Could not import that file." —
// a message that pointed nowhere. Now the write is never sent and the page
// says why.

const { dao } = vi.hoisted(() => ({
  dao: {
    myTenantId: vi.fn(),
    loadExtensionDays: vi.fn(),
    loadHolidays: vi.fn(),
    loadVoidedRows: vi.fn(),
    markDayHoliday: vi.fn(),
    unmarkDayHoliday: vi.fn(),
    saveExtensionDays: vi.fn(),
    insertHoliday: vi.fn(),
    deleteHoliday: vi.fn(),
    upsertHolidays: vi.fn(),
  },
}));

vi.mock("../dao/holidays.repo", () => dao);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useHolidays test reached the real supabase client");
});

import { useHolidays } from "./useHolidays";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

beforeEach(() => {
  vi.clearAllMocks();
  dao.myTenantId.mockResolvedValue(null); // signed out / no business
  dao.loadHolidays.mockResolvedValue([]);
  dao.insertHoliday.mockResolvedValue({ code: "23502", error: "null value in column tenant_id" });
  dao.upsertHolidays.mockResolvedValue({ count: null, error: "null value in column tenant_id" });
});

async function mounted() {
  const h = renderHook(() => useHolidays());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("useHolidays with no business", () => {
  it("adding a holiday sends nothing and says the account has no business", async () => {
    const { result } = await mounted();
    act(() => {
      result.current.setNewDate("2026-12-25");
      result.current.setNewName("Christmas");
    });
    await act(async () => {
      await result.current.addHoliday();
    });
    expect(dao.insertHoliday).not.toHaveBeenCalled();
    expect(result.current.formError).toBe(NO_TENANT_MESSAGE);
    expect(result.current.busy).toBe(false);
  });

  it("importing a CSV sends nothing and says the account has no business", async () => {
    const { result } = await mounted();
    const file = { text: async () => "date,name\n2026-12-25,Christmas\n" };
    await act(async () => {
      await result.current.onCsvChosen({ target: { files: [file] } } as never);
    });
    expect(dao.upsertHolidays).not.toHaveBeenCalled();
    expect(result.current.error).toBe(NO_TENANT_MESSAGE);
    expect(result.current.busy).toBe(false);
  });
});
