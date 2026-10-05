import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useTrials.handleConvert → set_enrolment_start (Wave 4).
// ⚠ RISK 13: the future-live-trial read and its two-press guard stay BEFORE the
// RPC. A future trial on the first press must send NOTHING; the second press sends
// ONE atomic call (mode "add") — there is no separate status update any more.
// No beforeEach clear — see components/StartsOnField.test.tsx; counts are deltas.

const { repo, rpc, start } = vi.hoisted(() => {
  const ok = (data: unknown = []) => vi.fn(() => Promise.resolve({ data, error: null }));
  return {
    repo: {
      getAuthUser: ok({ user: { id: "u1" } }),
      profileTenant: ok({ tenant_id: "t1" }),
      loadActiveClasses: ok(),
      loadCategories: ok(),
      loadTrialRates: ok(),
      loadBookings: ok(),
      loadAttendance: ok(),
      loadStudents: ok(),
      loadFutureLiveTrial: ok(),
      insertTrialRate: ok(),
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

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const booking = { id: "b1", student_id: "s1", student_name: "Kai", class_id: "c1", class_title: "Mon 9am" } as any;

describe("useTrials.handleConvert", () => {
  it("RISK 13: a future live trial holds the first press — no RPC; the second sends ONE add", async () => {
    repo.loadFutureLiveTrial.mockImplementation(() =>
      Promise.resolve({ data: [{ session_date: "2099-01-01" }], error: null })
    );
    const { result } = renderHook(() => useTrials());
    await settle();
    act(() => result.current.openConvert(booking));
    await settle();
    const n = start.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.handleConvert());
    expect(start.setEnrolmentStart.mock.calls.length).toBe(n);
    expect(result.current.convertError).toContain("still has a trial booked");
    await act(() => result.current.handleConvert());
    expect(start.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", null, "add"]]);
  });

  it("no future trial → one add, today as null", async () => {
    repo.loadFutureLiveTrial.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    const { result } = renderHook(() => useTrials());
    await settle();
    act(() => result.current.openConvert(booking));
    await settle();
    const n = start.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.handleConvert());
    expect(start.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", null, "add"]]);
  });
});

