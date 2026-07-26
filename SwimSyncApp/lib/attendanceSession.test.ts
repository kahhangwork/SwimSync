import {
  resolveSessionForDate,
  isShowingDate,
  type ResolvedSession,
} from "./attendanceSession";

// The bug this file exists for, stated as a test: the screen is holding the
// session for 26 Jul because Expo Router reused it, and the coach is looking
// at 19 Jul. Writing to what is held is what put two children's attendance on
// the wrong lesson in production (§7.62).
const HELD_FOR_26TH: ResolvedSession = {
  date: "2026-07-26",
  sessionId: "b6288a37-a677-443f-9ccc-091ca89f7fc8",
};

describe("resolveSessionForDate", () => {
  it("refuses a session resolved for a DIFFERENT date", () => {
    expect(resolveSessionForDate(HELD_FOR_26TH, "2026-07-19")).toEqual({
      kind: "stale",
    });
  });

  it("never leaks the other date's id, whatever the caller does with it", () => {
    const r = resolveSessionForDate(HELD_FOR_26TH, "2026-07-19");
    expect(JSON.stringify(r)).not.toContain("b6288a37");
  });

  it("uses the session when it was resolved for this very date", () => {
    expect(resolveSessionForDate(HELD_FOR_26TH, "2026-07-26")).toEqual({
      kind: "use",
      sessionId: "b6288a37-a677-443f-9ccc-091ca89f7fc8",
    });
  });

  it("asks for a session to be created when this date resolved to none", () => {
    // Distinct from `stale`: this IS about the right date, there is simply no
    // lesson_sessions row yet. Keeping the two apart is what lets the ordinary
    // first-ever save skip a redundant lookup.
    expect(
      resolveSessionForDate({ date: "2026-07-19", sessionId: null }, "2026-07-19")
    ).toEqual({ kind: "create" });
  });

  it("treats 'nothing resolved yet' as stale, not as create", () => {
    expect(resolveSessionForDate(null, "2026-07-19")).toEqual({ kind: "stale" });
  });
});

describe("isShowingDate", () => {
  it("is false while the screen still holds another lesson", () => {
    expect(isShowingDate(HELD_FOR_26TH, "2026-07-19")).toBe(false);
  });

  it("is false before anything has loaded", () => {
    expect(isShowingDate(null, "2026-07-19")).toBe(false);
  });

  it("is true once this date's data has landed", () => {
    expect(isShowingDate({ date: "2026-07-19", sessionId: null }, "2026-07-19")).toBe(
      true
    );
  });
});
