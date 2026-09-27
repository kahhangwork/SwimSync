import { describe, expect, it } from "vitest";
import { NO_ACCESS } from "@/lib/permissions";
import { assignableRoles, defaultInviteRoleId, toRoleOptions } from "./adminRoles";

const roles = toRoleOptions(
  [
    { id: "full", name: "Full admin", standard_key: "full_admin" },
    { id: "desk", name: "Front desk", standard_key: "front_desk" },
    { id: "mgr", name: "Manager", standard_key: null },
  ],
  [
    ...["operations", "profile", "admins", "pricing", "billing", "packages", "wages", "accounting"]
      .map((area) => ({ role_id: "full", area, level: "edit" })),
    { role_id: "desk", area: "operations", level: "edit" },
    { role_id: "mgr", area: "operations", level: "edit" },
    { role_id: "mgr", area: "admins", level: "edit" },
  ]
);

describe("toRoleOptions", () => {
  it("builds a full grid per role, missing areas as none", () => {
    const desk = roles.find((r) => r.id === "desk")!;
    expect(desk.grid.operations).toBe("edit");
    expect(desk.grid.billing).toBe("none");
  });
});

describe("assignableRoles", () => {
  const mgrGrid = roles.find((r) => r.id === "mgr")!.grid;
  it("the owner may give every role", () => {
    expect(assignableRoles(roles, true, NO_ACCESS)).toHaveLength(3);
  });
  it("a Manager may give Front desk and Manager, never Full admin", () => {
    expect(assignableRoles(roles, false, mgrGrid).map((r) => r.id).sort()).toEqual(["desk", "mgr"]);
  });
});

describe("defaultInviteRoleId (P4)", () => {
  it("preselects Front desk", () => expect(defaultInviteRoleId(roles)).toBe("desk"));
  it("falls back to the first assignable role", () => {
    expect(defaultInviteRoleId(roles.filter((r) => r.id !== "desk"))).toBe("full");
  });
  it("is null when nothing is assignable", () => expect(defaultInviteRoleId([])).toBeNull());
});
