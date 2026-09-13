// CHARACTERISATION test (playbook §0): pins the behaviour the Parents page
// ALREADY had before the refactor — it is not a new rule, so §7.25's prove-it-
// red-first does not apply. If any of these change, a behaviour changed.

import { describe, expect, it } from "vitest";
import { activeChildCount, filterFamilies, toFamilyRows } from "./parentsRows";
import type { FamilyRow } from "../types";

describe("parents domain — pure mapping", () => {
  it("maps profile fields, defaulting missing ones to em-dash / null", () => {
    const rows = [
      { parent_id: "p1", tenant_id: "t1", is_active: true, inactivated_at: null, parents: { profiles: { full_name: "Amy", email: "a@x.sg", phone: "9" } } },
      { parent_id: "p2", tenant_id: "t1", is_active: false, inactivated_at: "2026-01-01", parents: { profiles: {} } },
    ];
    const fams = toFamilyRows(rows, []);
    expect(fams[0]).toMatchObject({ full_name: "Amy", email: "a@x.sg", phone: "9", is_active: true });
    expect(fams[1]).toMatchObject({ full_name: "—", email: "—", phone: null, inactivated_at: "2026-01-01" });
  });

  it("keeps only children at the same business as the parent's membership", () => {
    const rows = [{ parent_id: "p1", tenant_id: "t1", is_active: true, inactivated_at: null, parents: { profiles: { full_name: "Amy" } } }];
    const kids = [
      { parent_id: "p1", students: { id: "s1", full_name: "Kid A", is_active: true, tenant_id: "t1" } },
      { parent_id: "p1", students: { id: "s2", full_name: "Kid B", is_active: true, tenant_id: "t2" } }, // other business
      { parent_id: "pX", students: { id: "s3", full_name: "Other", is_active: true, tenant_id: "t1" } }, // other parent
    ];
    const fams = toFamilyRows(rows, kids);
    expect(fams[0].children.map((c) => c.id)).toEqual(["s1"]);
  });

  it("counts only active children", () => {
    const f = { children: [{ is_active: true }, { is_active: false }, { is_active: true }] } as unknown as FamilyRow;
    expect(activeChildCount(f)).toBe(2);
  });

  it("filters by name OR email, case-insensitively, and honours showInactive", () => {
    const fams = [
      { full_name: "Amy Tan", email: "amy@x.sg", is_active: true, children: [] },
      { full_name: "Ben Lee", email: "ben@x.sg", is_active: false, children: [] },
    ] as unknown as FamilyRow[];
    expect(filterFamilies(fams, "AMY", true).map((f) => f.full_name)).toEqual(["Amy Tan"]);
    expect(filterFamilies(fams, "ben@", true).map((f) => f.full_name)).toEqual(["Ben Lee"]);
    expect(filterFamilies(fams, "", false).map((f) => f.full_name)).toEqual(["Amy Tan"]); // inactive hidden
    expect(filterFamilies(fams, "", true)).toHaveLength(2);
  });
});
