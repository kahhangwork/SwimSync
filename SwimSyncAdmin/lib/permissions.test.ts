import { describe, expect, it } from "vitest";
import { can, gridProblem, isWithin, NO_ACCESS, permissionsFromRows, type Grid } from "./permissions";

const grid = (over: Partial<Grid>): Grid => ({ ...NO_ACCESS, ...over });

describe("permissionsFromRows", () => {
  it("fills every area, defaulting to none", () => {
    const p = permissionsFromRows([{ area: "billing", level: "view" }]);
    expect(p.levels.billing).toBe("view");
    expect(p.levels.operations).toBe("none");
    expect(Object.keys(p.levels)).toHaveLength(8);
  });

  it("ignores rows it does not recognise instead of trusting them", () => {
    const p = permissionsFromRows([{ area: "refunds", level: "edit" }, { area: "wages", level: "all" }]);
    expect(p.levels.wages).toBe("none");
  });

  it("treats no rows (a coach, a platform admin) as no access", () => {
    expect(permissionsFromRows(null).levels).toEqual(NO_ACCESS);
  });
});

describe("can", () => {
  const p = permissionsFromRows([
    { area: "operations", level: "edit" },
    { area: "billing", level: "view" },
  ]);
  it("edit implies view", () => expect(can(p, "operations", "view")).toBe(true));
  it("view does not imply edit", () => expect(can(p, "billing", "edit")).toBe(false));
  it("none refuses view", () => expect(can(p, "wages", "view")).toBe(false));
});

describe("gridProblem — mirrors set_role_grid()", () => {
  it("refuses money access with operations at none", () => {
    expect(gridProblem(grid({ billing: "edit" }))).toMatch(/Operations/);
  });
  it("accepts an all-none role", () => expect(gridProblem(NO_ACCESS)).toBeNull());
  it("accepts operations view with money", () => {
    expect(gridProblem(grid({ operations: "view", billing: "edit" }))).toBeNull();
  });
});

describe("isWithin — the escalation guard's shape", () => {
  const mgr = grid({ operations: "edit", admins: "edit" });
  it("a weaker role is within", () => expect(isWithin(grid({ operations: "view" }), mgr)).toBe(true));
  it("an equal role is within", () => expect(isWithin(mgr, mgr)).toBe(true));
  it("any stronger area is not", () => expect(isWithin(grid({ operations: "edit", billing: "view" }), mgr)).toBe(false));
});
