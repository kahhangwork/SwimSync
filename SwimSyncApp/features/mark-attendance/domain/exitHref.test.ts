// CHARACTERISATION test (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1): pins the §7.65
// exit rule as it was inline on the route. §7.25 does not apply — a move, not a fix.
import { exitHrefOf } from "./exitHref";

describe("exitHrefOf (characterisation)", () => {
  it("from=roster -> back to that class's roster", () => {
    expect(exitHrefOf("roster", "c1")).toBe("/(coach)/classes/c1/roster");
  });

  it("everything else falls to the default arm — Schedule (the safety net)", () => {
    for (const from of ["schedule", "today", "", undefined]) {
      expect(exitHrefOf(from, "c1")).toBe("/(coach)/schedule");
    }
  });
});
