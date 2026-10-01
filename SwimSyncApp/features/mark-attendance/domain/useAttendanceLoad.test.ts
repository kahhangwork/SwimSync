// load()'s CANCELLED branch — a regression test for the permanent spinner (BACKLOG,
// "A coach opening an admin-CANCELLED lesson gets a permanent spinner").
//
// The hook runs under @testing-library/react-native's renderHook (ported 2026-10-02
// from a hand-rolled React recorder, which existed because the app had no hook
// renderer then). load() is called from the INITIAL render's result — a cold open —
// so its closure holds the `classTitle` state at "", and stays there for the whole of
// load() even though setClassTitle runs inside it. That is what makes the second bug
// reproducible: the notice must take the LOADED title, not that state.
//
// Proven red against the unfixed hook (§7.25): case 1 failed on `resolved` (never
// set, so isShowingDate(null, date) held the spinner), case 2 on the notice reading
// "cancelled this lesson" instead of the class's title. RE-PROVEN after the port
// (2026-10-02): useAttendanceLoad.ts from 61426c8^ written to the working tree only
// (mutate.sh `rev`, restored from HEAD) → both cases red, for those same reasons.
import { act, renderHook } from "@testing-library/react-native";
import { isShowingDate } from "@/lib/attendanceSession";

jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: any) => unknown) => sel({ session: { id: "profile-1" } }),
}));

const mockLoadClass = jest.fn();
const mockLoadSession = jest.fn();
jest.mock("../dao/markAttendance.repo", () => ({
  loadClass: (...a: unknown[]) => mockLoadClass(...a),
  loadMyCoach: async () => ({ data: { id: "coach-1" } }),
  loadSession: (...a: unknown[]) => mockLoadSession(...a),
  loadAttendance: async () => ({ data: [] }),
  loadMakeupBookings: async () => ({ data: [] }),
  loadMyRosterRow: async () => ({ data: null }),
  loadTrialBookings: async () => ({ data: [] }),
}));

jest.mock("../dao/markAttendance.rpc", () => ({
  fetchFloor: async () => null,
  isActiveClassShadow: async () => ({ data: false }),
  isMainOnSession: async () => true,
  sessionShadowCoaches: async () => ({ data: [] }),
}));

// eslint-disable-next-line import/first
import { useAttendanceLoad } from "./useAttendanceLoad";

const DATE = "2026-09-05";

async function runCancelledLoad(title: string, reason: string | null) {
  mockLoadClass.mockResolvedValue({
    data: { title, day_of_week: 6, coach_id: "coach-1", student_class_enrolments: [] },
  });
  mockLoadSession.mockResolvedValue({
    data: { id: "sess-1", cancelled_at: "2026-09-01T02:00:00+00:00", cancellation_reason: reason },
  });
  const { result } = renderHook(() => useAttendanceLoad("class-1", DATE));
  // A cold open: nothing resolved, no title, nothing blocked.
  expect(result.current.classTitle).toBe("");
  expect(result.current.resolved).toBeNull();
  expect(result.current.blocked).toBeNull();
  // The INITIAL render's load — never after a rerender, or the closure would no
  // longer be a cold open's.
  const load = result.current.load;
  await act(async () => {
    await load();
  });
  // …and the loading flag is the one the branch drops on its way out.
  expect(result.current.loading).toBe(false);
  return result.current;
}

describe("useAttendanceLoad — an admin-cancelled lesson", () => {
  it("1. resolves the date, so the spinner gives way to the notice", async () => {
    const hook = await runCancelledLoad("Tadpoles", null);

    expect(hook.resolved).toEqual({ date: DATE, sessionId: "sess-1" });
    // The route's render guard: this is what held the spinner forever.
    expect(isShowingDate(hook.resolved, DATE)).toBe(true);

    expect(hook.blocked).toMatchObject({ ok: false, title: "This lesson was cancelled" });
  });

  it("2. names the LOADED class, not the stale classTitle state", async () => {
    const hook = await runCancelledLoad("Tadpoles", "Pool closed");

    expect(hook.classTitle).toBe("Tadpoles");
    const blocked = hook.blocked as any;
    expect(blocked.detail).toContain("cancelled Tadpoles on Sat, 5 Sept 2026 — Pool closed.");
    expect(blocked.detail).not.toContain("this lesson on");
  });
});
