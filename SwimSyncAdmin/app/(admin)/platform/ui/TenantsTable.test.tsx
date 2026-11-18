import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TenantsTable } from "./TenantsTable";
import type { TenantRow } from "../types";

// TenantsTable — one inline action per row (DESIGN.md → Tables, 2026-11-18):
// the admin state's remedy inline (Resend while invited, Set owner while there
// is no admin); Change owner and Suspend/Unsuspend in the row's "…" menu, with
// the page's own handlers.
//
// MUTATION PROOFS (§7.25) — applied to TenantsTable.tsx, seen red, reverted:
//   1. menu Suspend's `tenantId: t.tenant_id` → `tenantId: tenants[0].tenant_id`
//      → RED: "Change owner and Suspend sit in THAT row's menu …"
//   2. `{t.admin_status !== "none" && (` (Change owner) → `{true && (`
//      → RED: "an ownerless business offers Set owner inline and no Change owner"

function tenant(over: Partial<TenantRow>): TenantRow {
  return {
    tenant_id: "t1",
    display_name: "Alpha Swim",
    join_code: "SWIM-AAAA",
    active_students: 3,
    active_classes: 1,
    coaches: 1,
    staff_without_rate: 0,
    last_attendance_date: "2026-11-01",
    sessions_this_month: 2,
    sessions_fully_marked: 2,
    last_month_billing: "sealed",
    active_families: 2,
    admin_email: "a@alpha.test",
    admin_status: "active",
    suspended_at: null,
    ...over,
  } as TenantRow;
}

function setup(tenants: TenantRow[]) {
  const props = {
    tenants,
    loadError: null,
    resending: null,
    onResend: vi.fn(),
    onChangeOwner: vi.fn(),
    onSuspend: vi.fn(),
  };
  render(<TenantsTable {...props} />);
  return props;
}

const row = (name: string) => within(screen.getByText(name).closest("tr")!);
const menu = (name: string) => {
  fireEvent.click(row(name).getByRole("button", { name: "More actions" }));
  return row(name);
};

describe("TenantsTable", () => {
  it("Change owner and Suspend sit in THAT row's menu, never inline", () => {
    const a = tenant({});
    const b = tenant({ tenant_id: "t2", display_name: "Bravo Swim" });
    const props = setup([a, b]);
    expect(row("Bravo Swim").queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(row("Bravo Swim").queryByRole("button", { name: "Change owner" })).toBeNull();
    fireEvent.click(menu("Bravo Swim").getByRole("button", { name: "Suspend" }));
    expect(props.onSuspend).toHaveBeenCalledWith({ tenantId: "t2", tenantName: "Bravo Swim", suspended: false });
    fireEvent.click(menu("Bravo Swim").getByRole("button", { name: "Change owner" }));
    expect(props.onChangeOwner).toHaveBeenCalledWith(b);
  });

  it("a suspended business offers Unsuspend in its menu", () => {
    const props = setup([tenant({ suspended_at: "2026-11-01T00:00:00Z" })]);
    expect(row("Alpha Swim").getByText("suspended")).toBeTruthy();
    fireEvent.click(menu("Alpha Swim").getByRole("button", { name: "Unsuspend" }));
    expect(props.onSuspend).toHaveBeenCalledWith({ tenantId: "t1", tenantName: "Alpha Swim", suspended: true });
  });

  it("an invited admin keeps Resend inline", () => {
    const props = setup([tenant({ admin_status: "invited" })]);
    fireEvent.click(row("Alpha Swim").getByRole("button", { name: "Resend" }));
    expect(props.onResend).toHaveBeenCalledWith("t1");
  });

  it("an ownerless business offers Set owner inline and no Change owner", () => {
    const t = tenant({ admin_status: "none", admin_email: null });
    const props = setup([t]);
    fireEvent.click(row("Alpha Swim").getByRole("button", { name: "Set owner" }));
    expect(props.onChangeOwner).toHaveBeenCalledWith(t);
    expect(menu("Alpha Swim").queryByRole("button", { name: "Change owner" })).toBeNull();
  });
});
