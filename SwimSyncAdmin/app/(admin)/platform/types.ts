// The Platform page's entity types, moved verbatim at Stage 1 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// They live at the FEATURE ROOT, never in dao/: the boundary test's check 1
// ("ui never imports dao") does not distinguish `import type` from a value
// import, so a ui/ component pulling a row type out of dao/ goes red. dao/ and
// ui/ both import these from here (playbook §1).

// One row of platform_tenant_overview(). Every figure is computed in Postgres:
// aggregating these in the browser is silently capped at max_rows = 1000, which
// is correct today and quietly wrong later (see the migration's header).
export type TenantRow = {
  tenant_id: string;
  display_name: string;
  join_code: string;
  active_students: number;
  active_classes: number;
  coaches: number;
  /** Coaches who do NOT own the business and have no rate — the ones payroll
   *  will pay nothing. The owner is excluded IN SQL (their profile role is
   *  tenant_admin), because an owner without a rate is the correct finished
   *  state for a private coach (PRD §7.13), not a warning.
   *
   *  This column has existed and been correct since 20260719002400. A browser
   *  scan that recomputed it lived here 2026-08-01 → 2026-08-04 on the belief
   *  that "the RPC has never returned this field"; the belief was backwards —
   *  `pg_get_functiondef` and platform_overview.test.sql §"SHAPE IS DERIVED"
   *  both say otherwise. Read the column. */
  staff_without_rate: number;
  /** NULL = nothing has EVER been marked. Renders as "never", never as a date. */
  last_attendance_date: string | null;
  sessions_this_month: number;
  sessions_fully_marked: number;
  last_month_billing: "sealed" | "open" | "never run";
  active_families: number;
  /** The business's own admin. NULL when it has none at all. */
  admin_email: string | null;
  /** Whether that admin has EVER signed in. A profiles row only proves an
   *  invite was issued — 'none' means the business is live and joinable with
   *  nobody able to operate it, which is a fault, not a blank. */
  admin_status: "none" | "invited" | "active";
  /** NULL = operating. Set = the platform kill switch is on: staff and
   *  parents dark, staff logins banned, engine skipping the tenant
   *  (WAVE_5_PLAN.md chunk 3). */
  suspended_at: string | null;
};

// One row of platform_tenant_admins() — the Change-owner dropdown feed.
export type TenantAdminOption = {
  profile_id: string;
  email: string;
  full_name: string;
  is_owner: boolean;
  /** Rendered but not selectable — the RPC refuses a deactivated target too;
   *  the disabled <option> just saves the round trip. */
  is_disabled: boolean;
};

export type StrandedParent = {
  parent_id: string;
  full_name: string | null;
  email: string | null;
  joined_at: string;
};

export type StudentRow = {
  id: string;
  full_name: string;
  tenant_id: string;
  assignment_status: string;
  is_active: boolean;
};

export type FamilyStatusRow = {
  parent_name: string;
  email: string;
  tenant_name: string;
  family_active: boolean;
  children: { full_name: string; is_active: boolean }[];
};
