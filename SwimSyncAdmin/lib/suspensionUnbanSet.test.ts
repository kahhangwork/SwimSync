import { describe, expect, it } from "vitest";
import { suspensionUnbanSet, type StaffProfile } from "./suspensionUnbanSet";

/**
 * ⚠ RISK 3 (WAVE_5_PLAN.md chunk 3): the unban set is (staff) MINUS
 * (individually disabled). Proven red by replacing the function body with
 * the naive mirror `return staff` — 3/6 fail (the deactivated admin, the
 * disabled pure coach, and the deactivated admin-who-coaches all get
 * resurrected). The cases that survive the sabotage are the inclusion pins:
 * they prove the exclusion never over-reaches.
 */

const admin = (id: string, disabledAt: string | null = null): StaffProfile => ({
  id,
  email: `${id}@test.local`,
  role: "tenant_admin",
  admin_disabled_at: disabledAt,
});
const coach = (id: string): StaffProfile => ({
  id,
  email: `${id}@test.local`,
  role: "coach",
  admin_disabled_at: null,
});

describe("suspensionUnbanSet (⚠ RISK 3)", () => {
  it("unbans every active staff member when nobody is individually disabled", () => {
    const staff = [admin("a1"), coach("c1"), coach("c2")];
    expect(suspensionUnbanSet(staff, [])).toEqual(staff);
  });

  it("keeps a deactivated admin banned", () => {
    const out = suspensionUnbanSet([admin("a1"), admin("a2", "2026-08-01")], []);
    expect(out.map((s) => s.id)).toEqual(["a1"]);
  });

  it("keeps a disabled PURE coach banned", () => {
    const out = suspensionUnbanSet([coach("c1"), coach("c2")], ["c2"]);
    expect(out.map((s) => s.id)).toEqual(["c1"]);
  });

  it("an admin-who-coaches follows their ADMIN half, not their coach row", () => {
    // Their coach half may be disabled (coaches.disabled_at set) while the
    // admin login must return — chunk 2's rule: the login belongs to the
    // admin role, and only deactivate-admin kills it.
    const out = suspensionUnbanSet([admin("aw1")], ["aw1"]);
    expect(out.map((s) => s.id)).toEqual(["aw1"]);
  });

  it("a deactivated admin-who-coaches stays banned even with a live coach row", () => {
    const out = suspensionUnbanSet([admin("aw1", "2026-08-01")], []);
    expect(out).toEqual([]);
  });

  it("handles the empty tenant", () => {
    expect(suspensionUnbanSet([], [])).toEqual([]);
  });
});
