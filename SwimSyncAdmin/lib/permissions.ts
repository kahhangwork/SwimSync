// What a co-admin's ROLE lets them see and change (ROLES_PERMISSIONS_PLAN.md).
//
// The server is the boundary: every policy and RPC asks has_admin_area()
// (migrations 20260927000300–000600). This file is the AFFORDANCE — which
// pages the sidebar shows, which pages refuse by URL, which read-only. It reads
// the one RPC the server exposes for it, my_admin_permissions(tenant), and never
// re-derives the rule: the owner arrives as all-edit because the RPC says so.
//
// Pure so it can be unit-tested; components/PermissionsProvider does the fetch.

export const ADMIN_AREAS = [
  "operations",
  "profile",
  "admins",
  "pricing",
  "billing",
  "packages",
  "wages",
  "accounting",
] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export const ADMIN_LEVELS = ["none", "view", "edit"] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

/** Human labels, in the grid's display order. */
export const AREA_LABELS: Record<AdminArea, string> = {
  operations: "Operations",
  profile: "Business profile",
  admins: "Admins & roles",
  pricing: "Pricing",
  billing: "Billing & payments",
  packages: "Packages & referrals",
  wages: "Wages",
  accounting: "Accounting",
};

/** What each area covers — shown under its row in the Roles grid. */
export const AREA_HINTS: Record<AdminArea, string> = {
  operations: "Students, classes, lessons, attendance, coaches, trials, make-ups, holidays",
  profile: "Business name, logo, join code",
  admins: "Invite, deactivate and change the role of co-admins",
  pricing: "Class prices and trial prices",
  billing: "Invoices, credit notes, payments, PayNow",
  packages: "Packages, package settings, referrals",
  wages: "Coach rates and payouts",
  accounting: "Monthly revenue and cost figures",
};

export type Grid = Record<AdminArea, AdminLevel>;

export type Permissions = {
  /** Resolved from my_admin_permissions — every area present. */
  levels: Grid;
};

const RANK: Record<AdminLevel, number> = { none: 0, view: 1, edit: 2 };

export const NO_ACCESS: Grid = Object.fromEntries(
  ADMIN_AREAS.map((a) => [a, "none"])
) as Grid;

/** Rows from my_admin_permissions → a full grid. A missing area is NONE. */
export function permissionsFromRows(
  rows: readonly { area: string; level: string }[] | null | undefined
): Permissions {
  const levels: Grid = { ...NO_ACCESS };
  for (const r of rows ?? []) {
    if ((ADMIN_AREAS as readonly string[]).includes(r.area) &&
        (ADMIN_LEVELS as readonly string[]).includes(r.level)) {
      levels[r.area as AdminArea] = r.level as AdminLevel;
    }
  }
  return { levels };
}

/** Does this grid grant at least `level` on `area`? */
export function can(perms: Permissions, area: AdminArea, level: AdminLevel): boolean {
  return RANK[perms.levels[area]] >= RANK[level];
}

/**
 * The grid rule the server enforces in set_role_grid(): a role with ANY area
 * above none must hold operations at least view — every page shows student and
 * class names. Returns the message to show, or null when the grid is valid.
 */
export function gridProblem(grid: Grid): string | null {
  const anyAccess = ADMIN_AREAS.some((a) => a !== "operations" && grid[a] !== "none");
  if (anyAccess && grid.operations === "none") {
    return "A role with any access needs Operations at least View — every page shows student and class names.";
  }
  return null;
}

/** Every area of `role` is no stronger than `ref` — the escalation guard's shape. */
export function isWithin(role: Grid, ref: Grid): boolean {
  return ADMIN_AREAS.every((a) => RANK[role[a]] <= RANK[ref[a]]);
}
