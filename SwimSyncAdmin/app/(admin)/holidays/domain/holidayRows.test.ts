import { describe, expect, it } from "vitest";
import { buildVoidCounts, clampExtDays } from "./holidayRows";

// Characterisation test (playbook §2 stage 4): pins the void-count tally and the
// extension-days clamp lifted from the Holidays page.

describe("buildVoidCounts", () => {
  it("tallies rows per session_date and skips null joins", () => {
    const rows = [
      { lesson_sessions: { session_date: "2026-08-09" } },
      { lesson_sessions: { session_date: "2026-08-09" } },
      { lesson_sessions: { session_date: "2026-12-25" } },
      { lesson_sessions: null },
    ];
    expect(buildVoidCounts(rows)).toEqual({ "2026-08-09": 2, "2026-12-25": 1 });
  });

  it("is empty for no rows", () => {
    expect(buildVoidCounts([])).toEqual({});
  });
});

describe("clampExtDays", () => {
  it("clamps to 0..90 and truncates", () => {
    expect(clampExtDays(7)).toBe(7);
    expect(clampExtDays(-3)).toBe(0);
    expect(clampExtDays(120)).toBe(90);
    expect(clampExtDays(5.9)).toBe(5);
  });
});
