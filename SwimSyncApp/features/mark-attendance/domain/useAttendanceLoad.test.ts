// load()'s CANCELLED branch — a regression test for the permanent spinner (BACKLOG,
// "A coach opening an admin-CANCELLED lesson gets a permanent spinner").
//
// The app has no hook renderer (no @testing-library, no react-test-renderer), so the
// hook is called as a plain function with React's useState/useRef replaced by a
// recorder: every setter call is logged, and state NEVER re-renders — which is exactly
// the closure load() runs in. That is what makes the second bug reproducible here: the
// `classTitle` state stays at its initial "" for the whole of load(), the same value a
// cold open sees.
//
// Proven red against the unfixed hook (§7.25): case 1 failed on `resolved` (never
// set, so isShowingDate(null, date) held the spinner), case 2 on the notice reading
// "cancelled this lesson" instead of the class's title.
import { isShowingDate } from "@/lib/attendanceSession";

type Call = { idx: number; value: unknown };
let mockSetterCalls: Call[] = [];
let mockStateIdx = 0;

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = mockStateIdx++;
      const value = typeof init === "function" ? (init as () => unknown)() : init;
      return [value, (v: unknown) => mockSetterCalls.push({ idx, value: v })];
    },
    useRef: (init: unknown) => ({ current: init }),
  };
});

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

// useState call order in the hook — the setter log is keyed by it.
const S = { classTitle: 0, resolved: 3, loading: 4, blocked: 5 } as const;

const DATE = "2026-09-05";

function lastSet(idx: number): unknown {
  const calls = mockSetterCalls.filter((c) => c.idx === idx);
  return calls.length ? calls[calls.length - 1].value : undefined;
}

async function runCancelledLoad(title: string, reason: string | null) {
  mockSetterCalls = [];
  mockStateIdx = 0;
  mockLoadClass.mockResolvedValue({
    data: { title, day_of_week: 6, coach_id: "coach-1", student_class_enrolments: [] },
  });
  mockLoadSession.mockResolvedValue({
    data: { id: "sess-1", cancelled_at: "2026-09-01T02:00:00+00:00", cancellation_reason: reason },
  });
  const hook = useAttendanceLoad("class-1", DATE);
  // The index map above is only valid if the hook still declares its state in
  // this order; the initial values pin it.
  expect(hook.classTitle).toBe("");
  expect(hook.resolved).toBeNull();
  expect(hook.blocked).toBeNull();
  await hook.load();
  // …and the loading flag is the one the branch drops on its way out.
  expect(lastSet(S.loading)).toBe(false);
}

describe("useAttendanceLoad — an admin-cancelled lesson", () => {
  it("1. resolves the date, so the spinner gives way to the notice", async () => {
    await runCancelledLoad("Tadpoles", null);

    const resolved = lastSet(S.resolved) as any;
    expect(resolved).toEqual({ date: DATE, sessionId: "sess-1" });
    // The route's render guard: this is what held the spinner forever.
    expect(isShowingDate(resolved, DATE)).toBe(true);

    const blocked = lastSet(S.blocked) as any;
    expect(blocked).toMatchObject({ ok: false, title: "This lesson was cancelled" });
  });

  it("2. names the LOADED class, not the stale classTitle state", async () => {
    await runCancelledLoad("Tadpoles", "Pool closed");

    expect(lastSet(S.classTitle)).toBe("Tadpoles");
    const blocked = lastSet(S.blocked) as any;
    expect(blocked.detail).toContain("cancelled Tadpoles on Sat, 5 Sept 2026 — Pool closed.");
    expect(blocked.detail).not.toContain("this lesson on");
  });
});
