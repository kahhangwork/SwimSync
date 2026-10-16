import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useTrials.handleBook — a NEW child's gender is required, never pre-selected (20261016000100; user 2026-10-16).
// Every admin-added child before this had no gender: add_unclaimed_student took none.
//
// RED FIRST (§7.25) against useTrials before this change: "a new child without a gender…" → addUnclaimedStudent
// was called; "…the gender chosen is sent" → p_gender missing from the call.

const { repo, rpc, start } = vi.hoisted(() => {
  const ok = (data: unknown = []) => vi.fn(() => Promise.resolve({ data, error: null }));
  return {
    repo: {
      getAuthUser: ok({ user: null }),
      profileTenant: ok(null),
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

async function filled() {
  const h = renderHook(() => useTrials());
  await settle();
  act(() => {
    h.result.current.setBookClass("c1");
    h.result.current.setBookDate("2026-10-17");
    h.result.current.setBookName("Ethan Tan");
    h.result.current.setBookPhone("9123 4567");
  });
  return h.result;
}

describe("useTrials.handleBook — a new child's gender", () => {
  it("starts with no gender chosen", async () => {
    const result = await filled();
    expect(result.current.bookGender).toBe("");
  });

  it("a new child without a gender is refused before anything is sent", async () => {
    const result = await filled();
    const n = rpc.addUnclaimedStudent.mock.calls.length;
    await act(() => result.current.handleBook());
    expect(rpc.addUnclaimedStudent.mock.calls.length).toBe(n);
    expect(result.current.bookError).toBe("Choose the child's gender.");
  });

  it("with a gender chosen, the gender chosen is sent", async () => {
    const result = await filled();
    act(() => result.current.setBookGender("female"));
    await act(() => result.current.handleBook());
    expect(rpc.addUnclaimedStudent).toHaveBeenLastCalledWith(
      expect.objectContaining({ p_full_name: "Ethan Tan", p_kind: "trial", p_gender: "female" })
    );
  });

  it("an EXISTING child needs no gender — they are already on file", async () => {
    const result = await filled();
    act(() => result.current.setBookExisting("s1"));
    const n = rpc.bookTrial.mock.calls.length;
    await act(() => result.current.handleBook());
    expect(rpc.bookTrial.mock.calls.length).toBe(n + 1);
    expect(result.current.bookError).toBeNull();
  });
});
