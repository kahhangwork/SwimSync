// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-G) — a move, not a
// fix, so §7.25 does not apply.
import { formatDate } from "./formatDate";

describe("public package formatDate (characterisation)", () => {
  it("'YYYY-MM-DD' -> 'D Mon YYYY' by string parsing; null stays null; anything else passes through", () => {
    expect(formatDate("2026-09-01")).toBe("1 Sep 2026");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate("2026-13-01")).toBe("2026-13-01");
  });
});
