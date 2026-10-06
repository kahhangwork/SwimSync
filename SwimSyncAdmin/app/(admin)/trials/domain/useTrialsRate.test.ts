import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useTrials.handleSaveRate when the caller has NO business (Wave 8, NOT-A-GUARD
// site 11). loadAll() stores whatever tenant it found — null included — and the
// old code then sent `tenant_id: tenantId!`: NULL, which the database refused,
// and the rate row showed Postgres's own words. Now nothing is sent and the row
// says why.

const { repo, rpc, start } = vi.hoisted(() => {
  const ok = (data: unknown = []) => vi.fn(() => Promise.resolve({ data, error: null }));
  return {
    repo: {
      getAuthUser: ok({ user: null }), // signed out
      profileTenant: ok(null),
      loadActiveClasses: ok(),
      loadCategories: ok(),
      loadTrialRates: ok(),
      loadBookings: ok(),
      loadAttendance: ok(),
      loadStudents: ok(),
      loadFutureLiveTrial: ok(),
      insertTrialRate: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'null value in column "tenant_id"' } })
      ),
    },
    rpc: {
      studentPackageCoverage: ok(),
      bookTrial: ok(),
      addUnclaimedStudent: ok(),
      cancelTrialBooking: ok(),
    },
    start: {
      fetchStartBounds: vi.fn(() => Promise.resolve({ data: null, error: { message: "n/a" } })),
      setEnrolmentStart: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    },
  };
});
vi.mock("../dao/trials.repo", () => repo);
vi.mock("../dao/trials.rpc", () => rpc);
vi.mock("@/lib/enrolmentStart.rpc", () => start);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useTrials test reached the real supabase client");
});

import { useTrials } from "./useTrials";
import { NO_TENANT_MESSAGE } from "@/lib/noTenant";

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("useTrials.handleSaveRate with no business", () => {
  it("saving a trial price sends nothing and says the account has no business", async () => {
    const { result } = renderHook(() => useTrials());
    await settle();
    act(() => result.current.setRateDraft({ grp: "25" }));
    await act(() => result.current.handleSaveRate("grp"));
    expect(repo.insertTrialRate).not.toHaveBeenCalled();
    expect(result.current.rateError).toBe(NO_TENANT_MESSAGE);
    expect(result.current.rateBusy).toBeNull();
  });
});
