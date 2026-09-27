import { describe, expect, it } from "vitest";
import { toRoleRows } from "./rolesRows";

describe("toRoleRows", () => {
  const rows = toRoleRows(
    [{ id: "a", name: "Front desk", standard_key: "front_desk" }, { id: "b", name: "Mine", standard_key: null }],
    [{ role_id: "a", area: "operations", level: "edit" }, { role_id: "b", area: "billing", level: "view" }],
    [{ admin_role_id: "a" }, { admin_role_id: "a" }, { admin_role_id: null }]
  );
  it("counts holders per role", () => {
    expect(rows.find((r) => r.id === "a")!.holders).toBe(2);
    expect(rows.find((r) => r.id === "b")!.holders).toBe(0);
  });
  it("fills every area, missing as none", () => {
    expect(rows.find((r) => r.id === "a")!.grid.billing).toBe("none");
    expect(rows.find((r) => r.id === "b")!.grid.billing).toBe("view");
  });
});
