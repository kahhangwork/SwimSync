// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-G) — a move, not a
// fix, so §7.25 does not apply.
import { monthLabel } from "./monthLabel";

describe("monthLabel (characterisation)", () => {
  it("'YYYY-MM' -> month name + year; unparseable input is returned as-is", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthLabel("garbage")).toBe("garbage");
  });
});
