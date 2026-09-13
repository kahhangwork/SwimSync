// CHARACTERISATION test (playbook §0): pins behaviour the Admins page already
// had. Not a new rule, so §7.25's prove-red-first does not apply.

import { describe, expect, it } from "vitest";
import { mergeStatuses, toAdminRows } from "./adminsRows";
import type { AdminRow } from "../types";

describe("admins domain — pure mapping", () => {
  it("maps profiles, flags owner + coach, and reads deactivated from the column", () => {
    const profiles = [
      { id: "p1", full_name: "Owner", email: "o@x.sg", phone: "1", admin_disabled_at: null },
      { id: "p2", full_name: "Coach Admin", email: "c@x.sg", phone: null, admin_disabled_at: null },
      { id: "p3", full_name: "Gone", email: "g@x.sg", phone: null, admin_disabled_at: "2026-01-01" },
    ];
    const rows = toAdminRows(profiles, "p1", new Set(["p2"]));
    expect(rows[0]).toMatchObject({ id: "p1", isOwner: true, isCoach: false, status: null });
    expect(rows[1]).toMatchObject({ id: "p2", isOwner: false, isCoach: true, status: null });
    expect(rows[2]).toMatchObject({ id: "p3", isOwner: false, status: "deactivated" });
  });

  it("merges phase-2 statuses, keeping the existing value when the server omits a row", () => {
    const rows = [
      { id: "p1", status: null },
      { id: "p2", status: "deactivated" },
    ] as AdminRow[];
    const merged = mergeStatuses(rows, [{ id: "p1", status: "active" } as AdminRow]);
    expect(merged[0].status).toBe("active");
    expect(merged[1].status).toBe("deactivated"); // untouched by the server
  });
});
