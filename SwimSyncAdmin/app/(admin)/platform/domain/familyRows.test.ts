// CHARACTERISATION tests (playbook §0): every case here pins behaviour that
// already existed inline in platform/page.tsx's handleFamilySearch before Stage
// 10 moved it. §7.25's prove-it-red rule therefore does not apply — these
// describe the status quo so the move can be shown not to have changed it.
//
// The case that earns its keep is "a parent at two businesses": it is the only
// thing standing between the tenant-narrowing and a silent wrong answer that
// looks exactly like data.

import { describe, expect, it } from "vitest";
import { buildFamilyRows, familyMessage } from "./familyRows";

const membership = (over: Record<string, unknown> = {}) => ({
  parent_id: "p1",
  tenant_id: "t1",
  is_active: true,
  tenants: { display_name: "Alpha Swim" },
  parents: { profile_id: "u1", profiles: { full_name: "Ada Parent", email: "ada@example.com" } },
  ...over,
});

const kid = (over: Record<string, unknown> = {}) => ({
  parent_id: "p1",
  students: { full_name: "Kid One", is_active: true, tenant_id: "t1" },
  ...over,
});

describe("buildFamilyRows", () => {
  it("renders a membership with no matching children as an empty list", () => {
    const rows = buildFamilyRows([membership()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].children).toEqual([]);
    expect(rows[0].parent_name).toBe("Ada Parent");
    expect(rows[0].tenant_name).toBe("Alpha Swim");
  });

  it("attributes a child only when BOTH parent_id and tenant_id match", () => {
    const rows = buildFamilyRows(
      [membership()],
      [
        kid(), // matches both
        kid({ parent_id: "p2" }), // right tenant, wrong parent
        kid({ students: { full_name: "Other Tenant Kid", is_active: true, tenant_id: "t2" } }),
      ]
    );
    expect(rows[0].children).toEqual([{ full_name: "Kid One", is_active: true }]);
  });

  it("degrades a missing embed to an em dash instead of throwing", () => {
    const rows = buildFamilyRows(
      [membership({ tenants: null, parents: null })],
      []
    );
    expect(rows[0].parent_name).toBe("—");
    expect(rows[0].email).toBe("—");
    expect(rows[0].tenant_name).toBe("—");
  });

  it("passes family_active through unchanged", () => {
    expect(buildFamilyRows([membership({ is_active: false })], [])[0].family_active).toBe(false);
    expect(buildFamilyRows([membership({ is_active: true })], [])[0].family_active).toBe(true);
  });

  it("gives a two-business parent two rows, each holding only that business's children", () => {
    const rows = buildFamilyRows(
      [
        membership(),
        membership({ tenant_id: "t2", tenants: { display_name: "Beta Swim" } }),
      ],
      [
        kid(),
        kid({ students: { full_name: "Kid Two", is_active: false, tenant_id: "t2" } }),
      ]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].tenant_name).toBe("Alpha Swim");
    expect(rows[0].children).toEqual([{ full_name: "Kid One", is_active: true }]);
    expect(rows[1].tenant_name).toBe("Beta Swim");
    expect(rows[1].children).toEqual([{ full_name: "Kid Two", is_active: false }]);
  });

  it("treats a null children result as no children, not as a crash", () => {
    expect(buildFamilyRows([membership()], null)[0].children).toEqual([]);
  });
});

describe("familyMessage", () => {
  it("says nothing for an ordinary non-empty result", () => {
    expect(familyMessage(3, false)).toBeNull();
  });

  it("reports an empty result", () => {
    expect(familyMessage(0, false)).toBe("No families matched.");
  });

  it("warns at the row cap", () => {
    expect(familyMessage(1000, false)).toBe(
      "Showing the first 1000 matches — refine your search."
    );
  });

  it("uses the singular when one family's children failed to load", () => {
    expect(familyMessage(1, true)).toBe(
      "Found 1 family, but their children could not be loaded — try again."
    );
  });

  it("uses the plural for more than one", () => {
    expect(familyMessage(2, true)).toBe(
      "Found 2 families, but their children could not be loaded — try again."
    );
  });

  it("lets the EMPTY-result message win over the failure message", () => {
    // Copied precedence, not chosen: inline, the kidsErr message was assigned
    // first and then overwritten by the count branches. Writing it the other way
    // round reads as more correct and is a behaviour change — this case is the
    // reason that mistake cannot land silently. (It was in fact made and caught
    // here while Stage 10 was being written.)
    expect(familyMessage(0, true)).toBe("No families matched.");
  });

  it("lets the CAP message win over the failure message too", () => {
    expect(familyMessage(1000, true)).toBe(
      "Showing the first 1000 matches — refine your search."
    );
  });
});
