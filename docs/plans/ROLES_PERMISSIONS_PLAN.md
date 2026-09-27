# Roles & permissions — owner-defined roles for co-admins — plan

> **Status: IN PROGRESS — steps 0–1 done** (map: `ROLES_ENFORCEMENT_MAP.md`; migration A: `20260927000300_admin_roles.sql`,
> pgTAP `roles_permissions.test.sql`). **Built differently from §5.1, on purpose:** roles are seeded by an AFTER INSERT
> trigger on `tenants` (not inside `provision_tenant`); the seeded roles carry a `standard_key` so renaming one never
> breaks a lookup; "every co-admin holds a role" is a commit-time (deferred) check because `handle_new_user` decides
> ownership after inserting the profile; no `created_by` column (§7.90 — audit_log has it); **P6 moved from step 4 into
> A** because the new check would otherwise refuse an owner transfer; `assign_admin_role` with the full escalation guard
> is already in A (dormant — nobody holds `admins:edit` until the owner assigns *Full admin*). (written 2026-09-27 via `/plan-with-confidence`). Wave 1, lane 1 of `BACKLOG.md` →
> *Current build order*. Backlog item: *Split co-admin permissions*. Index: `docs/plans/README.md`.

## 1. The problem

Every co-admin holds the owner's full authority except admin management (PRD §4.3). A helper hired to run lessons can
generate invoices, void credit notes, reprice classes and — once refunds ship — move money out. The owner is hiring a
co-admin within ~3 months, so the split must exist before that hire, and before Wave 2 adds new money surfaces that would
otherwise have to be retrofitted.

## 2. Decisions (settled with the user, 2026-09-27)

| # | Decision |
|---|---|
| D1 | **The owner sees and edits everything, always.** No role applies to the owner. |
| D2 | **Owner-defined roles.** A role is a named grid of **8 areas × None / View / Edit** *(was 11 — the four ops areas merged into one, user 2026-09-27, §3)*. Each co-admin holds exactly one role. |
| D3 | **Every area is either money or operations, never both** (the user's governing rule). The 8 areas are in §3. |
| D4 | **Everything is grantable**, Accounting and refunds included. The owner decides; the product does not restrict them. |
| D5 | **Three standard roles** seeded for every business: *Full admin*, *Operations assistant*, *Front desk* (§4) — plus a transitional *Co-admin (as before)* holding today's co-admins (P1). The owner may edit or delete them. They encode the norm: helpers do operations, money stays with the owner. |
| D6 | **"None" = page hidden + admin-only data refused by the server.** Reference data every staff member can already read (class list, levels, locations, coach names — the `current_tenant_id()` read policies) stays readable. The coach app keeps working. |
| D7 | **Small money details on operations pages stay visible** (a child's payment method, package lessons left, a family's balance). Only whole money pages and money actions are gated. |
| D8 | **Operations actions that move money by rule are allowed** to an operations role: an attendance correction in a billed month still auto-issues its credit note; an advance-cancel still extends a package. The money follows the recorded fact, and is audited. |
| D9 | **Admin management is grantable** (area *Admins & roles*). A co-admin with *Admins & roles: Edit* may invite, deactivate, reactivate and change the role of **any co-admin**, but **never the owner**. They may **assign** only roles that are **no stronger than their own** (escalation guard, §5.4), and they **cannot create or edit roles** — only the owner can. |
| D10 | **Scope: all 8 areas in one build** (not phased by area). Rollout is still staged by migration (§6), and is behaviour-preserving until the owner moves a co-admin off *Co-admin (as before)*. |

### Defaults chosen by the planner — **all accepted by the user, 2026-09-27**

- **P1** Existing co-admins are placed on a fourth standard role, **"Co-admin (as before)"** = every area Edit **except
  Accounting and Admins & roles = None** — exactly today's authority (PRD §4.3). *Full admin* would have been a silent
  privilege expansion (review finding #1, 2026-09-27). The owner moves them to another role when ready.
- **P2** Standard roles are **per-business copies** seeded at migration time (existing tenants) and by `provision_tenant`
  (new tenants). Editing one edits only that business's copy. There is no global "system role".
- **P3** A role in use **cannot be deleted** (refused with the holder count); reassign first.
- **P4** Inviting a co-admin **requires picking a role** in the invite form (default selection: *Front desk*, the weakest).
- **P5** View-only: edit controls are **hidden**, not disabled, with one line at the top of the page: *"View only — your role can't change this."*
- **P6** An owner transfer (`platform_reassign_owner`) leaves the old owner a co-admin on *Full admin*.
- **P7** Platform admin is unchanged **exactly where it is today and nowhere else**. `has_admin_area` does **not** admit
  platform admin; a call site whose current arm is `can_admin_tenant()` / `is_platform_admin() OR …` keeps that arm
  spelled out explicitly. ~20 RPCs (`void_credit_note`, `write_off_parent_balance`, `merge_students`, `cancel_lesson`,
  `book_*`, `rename_student`, …), accounting, admin management and the credit-note-emails note path (RISK 4) exclude
  platform admin today and must keep excluding it.
- **P8** Coaching authority is untouched: a co-admin who also coaches marks attendance through the coach arm
  (`current_coach_id()`), whatever their role.
- **P9** Two existing gaps are closed on the way (found by the research): `app/api/create-coach` and
  `app/api/generate-invoices` accept a **deactivated** admin (they check `role` only). Both get the area check.
- **P10** Every role create / edit / delete / assignment writes an `audit_log` row.
- **P11** *Accepted today, closed here:* **any coach who serves a family can UPDATE its invoices directly** —
  `invoices_update` admits `coach_serves_parent`, `authenticated` holds table-level UPDATE, and the only column pin
  (`pin_invoice_public_fields`) covers `reference_number`/`public_token`, so `net_amount`/`status` are writable.
  `confirm_invoice_paid` and `payment_records_insert` also admit the coach arm. The coach app shows **no** invoices
  (PRD §7.9), so the arm serves nothing. Step 0 confirms no caller uses it; migration C removes the coach arm from
  these three so money writes need `billing:edit`. *(A column grant is NOT an option: `table_grants.test.sql` assertion 6
  forbids any column-level grant to `authenticated` — found building lane 2's migration, 2026-09-27.)*
- **P12** `profiles_update` is tenant-wide: an Operations-edit role must **not** edit staff profiles. The admin arm of
  `profiles_update` is restricted to parent profiles under `operations`; staff profiles go under `admins`.

## 3. The 8 areas

> **Merged 2026-09-27 (user, during step 0).** The draft had four ops areas — Attendance & lessons, Students &
> families, Classes & setup, Coaches & cover. Step 0 found they all READ each other's tables (the roster needs student
> names, Students needs classes, Attendance needs cover), so a role with one and not another shows half-empty pages.
> The user's call: a combination that cannot work must not be settable, so the four are **one area, `operations`**.
> The rows below keep the four old headings for the page/table inventory; they are one grid row and one enum value.
>
> **Grid invariant that follows:** money pages also show child and class names, so **a role with any area above None
> must have `operations` ≥ View**. The Roles editor enforces it and `update_role_permissions` refuses the violation.

| # | Area (`admin_area` enum value) | Kind | Pages | Tables / RPCs it gates (headline) |
|---|---|---|---|---|
| 1a | `operations` — *Attendance & lessons* | ops | Attendance Log, Lessons, Calendar, Make-ups, Trials, Holidays, Change History | `tenant_public_holidays`, `attendance`, `lesson_sessions`, `session_coach_absences`, `audit_log` read, `makeup_bookings`, `trial_bookings` writes; `cancel_lesson`, `restore_lesson`, `schedule_extra_lesson`, `mark_day_holiday`, `unmark_day_holiday`, `book_makeup`, `book_trial`, `cancel_*_booking`, `unbilled_sealed_lessons` (view) |
| 1b | `operations` — *Students & families* | ops | Students, Parents, Unassigned, Parent Requests, Assessment | `students`, `student_class_enrolments`, `student_claims`, `student_skill_progress`, `skill_grade_levels`, `profiles` update; `add_unclaimed_student`, `*_student_claim`, `link_invited_parent`, `merge_students`, `rename_student`, `find_roster_duplicates`, `set_students_active`, `set_parent_tenant_active`, `close_student_enrolment`, `tenant_admin_has_member` |
| 1c | `operations` — *Classes & setup* | ops | Classes (schedule, not price), Levels, Locations | `classes` (a price on INSERT needs `pricing:edit` too — see §5.3), `class_categories`, `locations`, `tenant_levels`, `tenant_level_skills`; `deactivate_class`, `reactivate_class` |
| 1d | `operations` — *Coaches & cover* | ops | Coaches, Substitutes | `coaches` update, `session_coaches`, `class_shadow_coaches`; `assign_session_coach`, `set_session_main_coach`, `assign_class_shadow`, `end_class_shadow`, `disable_coach`, `reactivate_coach`; route `create-coach` |
| 2 | `profile` — Business profile | ops | Dashboard tenant card | `tenants` name / logo / join code columns; `regenerate_join_code` |
| 3 | `admins` — Admins & roles | ops | Admins, Roles | co-admin RPCs + API routes (§5.4) |
| 4 | `pricing` — Pricing | money | price fields on the class form, trial prices | `class_rates`, `class_rate_overrides`, `trial_rates`; `set_class_terms` (the price half — see §5.3) |
| 5 | `billing` — Billing & payments | money | Invoices, Credit Notes, billing months, WhatsApp queue | `invoices`, `invoice_items`, `credit_notes`, `credit_applications`, `billing_periods`, `billing_runs`, `payment_records`, `student_settlements`; `confirm_invoice_paid`, `void_credit_note`, `write_off_parent_balance`; `tenants` PayNow + run-day columns; storage bucket `paynow-qr`; route `generate-invoices`; edge `credit-note-emails` note path |
| 6 | `packages` — Packages & referrals | money | Packages, Referrals (+ refunds, Wave 2) | `package_products`, `parent_packages`, `package_*` read tables, `referrals`, `referral_rewards`; `create_package_offer`, `extend_package`, `preview_package_price`, `grant_referral_reward`, `void_referral_reward`, `set_referral_code_disabled`; edge `package-emails` offered/reward |
| 7 | `wages` — Wages | money | Wages | `coach_rates`, `coach_payouts`, `coach_payout_items`, `session_pay_overrides`; `generate_coach_payouts`, `mark_payout_paid` |
| 8 | `accounting` — Accounting | money | Accounting | `accounting_summary`, `accounting_months` (today owner-gated) |

`tenant_public_holidays` is written by the Holidays page → `operations`. The enforcement map (§6, step 1) is the
authority for every table and function; this table is the headline.

**Dashboard** is always visible; each tile renders only if its area is at least View.

## 4. Standard roles

| Area | Full admin | Operations assistant | Front desk |
|---|---|---|---|
| Operations | Edit | Edit | Edit |
| Business profile | Edit | Edit | None |
| Admins & roles | Edit | None | None |
| Pricing · Billing · Packages · Wages · Accounting | Edit | **None** | **None** |

A fourth, **"Co-admin (as before)"**, exists only to hold today's co-admins without changing their authority (P1):
every area Edit except **Accounting = None** and **Admins & roles = None**. The owner may delete it once empty.

*Front desk* lost its draft distinction (Classes/Coaches view-only) in the merge; it now differs from *Operations
assistant* only by Business profile. Kept as a starting point the owner can edit.

## 5. Design

### 5.1 Data (migration A — expand, dormant)

- `CREATE TYPE admin_area AS ENUM ('operations','profile','admins','pricing','billing','packages','wages','accounting')`, `CREATE TYPE admin_level AS ENUM ('none','view','edit')` (ordered, so
  `>=` compares levels).
- `tenant_roles (id, tenant_id, name, is_standard BOOLEAN, created_at, created_by, UNIQUE(tenant_id, name))`.
- `tenant_role_permissions (role_id → tenant_roles ON DELETE CASCADE, area admin_area, level admin_level,
  PRIMARY KEY(role_id, area))` — **all 8 rows always present** (a CHECK-by-trigger or a seed function guarantees it);
  a missing row is a bug, never an implicit None.
- `profiles.admin_role_id UUID REFERENCES tenant_roles` — **required for every non-owner `tenant_admin`** (a trigger
  enforces it, and that the role belongs to the profile's tenant); NULL for the owner and everyone else. A NULL on a
  co-admin would lock them out silently, so it is refused, not tolerated. **Extend
  `guard_profiles_privileges`** so a user cannot write it (it pins role / tenant_id / admin_disabled_at today).
- Seed: the three standard roles for every tenant; the transitional *Co-admin (as before)*; every current non-owner `tenant_admin` → that role (P1).
- `provision_tenant` seeds them for new tenants (read its body from the DB first — §7.40).
- `handle_new_user` (the auth trigger that creates an invited co-admin's profile from `user_metadata`) sets
  `admin_role_id` from the invite's metadata and **validates** it (role exists, same tenant). The escalation rule runs
  in the caller-side RPC the invite route calls first (§5.4), because the trigger has no caller.
- `platform_reassign_owner` gives the outgoing owner the *Full admin* role (P6) — it is in step 4.
- **`GRANT EXECUTE … TO authenticated`** on `has_admin_area`, `my_admin_permissions`, and every role RPC, in the same
  migration — a re-pointed policy calling an ungranted function throws `permission denied` (§7.87). Add the functions
  to whatever grant test covers EXECUTE (or a new `function_grants.test.sql`).
- RLS on the two new tables: **SELECT** for any active admin of the tenant (a co-admin must be able to read the grid of
  the roles they may assign); **no direct writes** — all writes go through RPCs. Matching `GRANT SELECT` (§7.87), and
  `table_grants.test.sql` must stay green.

### 5.2 The gate

```sql
has_admin_area(p_tenant UUID, p_area admin_area, p_level admin_level) RETURNS BOOLEAN
  -- SECURITY DEFINER, STABLE, search_path pinned
  --   NOT is_tenant_admin(p_tenant)                         → false  (keeps suspension + deactivation, one choke point;
  --                                                                   also false for platform admin — P7)
  --   is_tenant_owner(p_tenant)                             → true   (D1)
  --   else: the caller's role grants level >= p_level for p_area
```

Plus `my_admin_permissions(p_tenant) RETURNS TABLE(area, level)` for the admin app (owner → all Edit), so the UI reads
one RPC instead of re-deriving.

**Why one function, not per-area helpers:** the 68 policies and ~55 functions already funnel through three helpers;
swapping `is_tenant_admin(t)` for `has_admin_area(t, '<area>', 'view'|'edit')` is a mechanical, reviewable edit, and the
area is visible at every call site.

### 5.3 Re-pointing enforcement (migrations B–D)

Mechanical rule: a **SELECT** arm becomes `has_admin_area(t, area, 'view')`; a **write** arm (INSERT/UPDATE/DELETE/ALL)
becomes `…'edit'`; an RPC's `IF NOT is_tenant_admin(…)` becomes the area check for what it does. Arms that are not
admin arms (`coach_owns_class`, `coach_serves_parent`, `current_tenant_id()` reads) are **left alone** (D6, P8).

Three places need more than a swap:

1. **`tenants` UPDATE** — `authenticated` can UPDATE every column, under one row-level policy. Replace the admin arm
   with a `BEFORE UPDATE` trigger that compares OLD/NEW **for every column**, via an explicit column → area map, and
   **raises on any unmapped column** (deny by default). Known groups: profile (name, logo, join code, slug?) →
   `profile`; PayNow + invoice run day → `billing`; `rain_pays_coach`, `wage_run_day` → `wages`; `referral_*`,
   `package_expiry_warning_days`, `low_package_lessons`, `default_package_product_id`, `holiday_extension_days` →
   `packages`; counters (`invoice_counter`, `credit_note_counter`, `package_counter`), `id`, owner, suspension → **no
   client may write**. Step 0 lists every column from `information_schema`; the map lives in the migration.
   (Pattern: `guard_tenants_owner`. Detect the UPDATE-from-upsert case, §7.57.)
2. **`set_class_terms`** writes price *and* coach (`p_coach_id` sets both `classes.coach_id` and `paid_coach_id`).
   Checks are **additive, one per group that actually changes**, compared against `class_rate_on(v_from)` and the
   current row: rate changed → `pricing:edit`; coach, schedule or title changed → `operations:edit`. A call changing price
   and title needs both. The class form hides price fields without
   `pricing:view` and makes them read-only without `pricing:edit`.
2b. **Creating a class seeds its billing rate**: trigger `classes_seed_rate` → `seed_class_rate()` (SECURITY DEFINER)
   inserts a `class_rates` row from `NEW.price_per_lesson`. A class INSERT with a price therefore needs
   `pricing:edit` as well as `operations:edit` — enforced in that trigger (or a `create_class` RPC), not in the form.
3. **Owner-only RPCs** (`accounting_*`, admin management) move from `is_tenant_owner` to `has_admin_area(…,'accounting'|'admins',…)`
   — owner still passes via D1.

**Read every function body from the database before editing** (`pg_get_functiondef`, §7.40) — `CREATE OR REPLACE`
means the newest body lives in any later migration.

### 5.4 Admin management and the escalation guard

- Owner-only today: `deactivate_admin`, `reactivate_admin`, `remove_admin_role`, `prepare_admin_delete` + routes
  `invite-admin`, `resend-admin-invite`, `deactivate-admin`, `reactivate-admin`, `delete-admin` (`requireOwner`). They
  become `admins:edit`. `lib/adminManagementGate.ts` gains `requireArea(area, level)` backed by `has_admin_area` via
  the caller's JWT — **the server route must not re-implement the rule in TypeScript.**
- **Target rule — must be ADDED, it does not exist today:** every management RPC and route refuses when the target
  is `tenants.owner_profile_id`. Today the only guard is `p_profile_id = auth.uid()`, which protects the owner only
  because the caller must *be* the owner; `reactivate_admin` has no target check at all. Once a co-admin can call them,
  `deactivate_admin`, `prepare_admin_delete` and `remove_admin_role` (which demotes a coaching owner to `coach`) would
  lock the owner out. One pgTAP test per RPC.
- **Assignment rule (escalation guard):** `assign_admin_role(p_profile, p_role)` refuses unless the caller is the owner
  **or** `role_is_within(p_role, caller's role)` — every area level of the assigned role ≤ the caller's level. A
  co-admin cannot assign a role stronger than their own, including to themselves.
- **The same rule gates reactivate and resend-invite:** reactivating a co-admin, or resending a pending invitation,
  restores the target's existing role — so a non-owner caller needs `role_is_within(target's role, caller's role)`.
  Otherwise deactivate-then-reactivate is an escalation path.
- **Role CRUD is owner-only** (D9): `create_role`, `update_role_permissions`, `rename_role`, `delete_role` check
  `is_tenant_owner`. `delete_role` refuses while held (P3).
- Invite (P4): `invite-admin` takes a `role_id`, runs the assignment rule before generating the link.

### 5.5 Admin app (`SwimSyncAdmin/`)

- **One permissions context** in `app/(admin)/layout.tsx` (there is none today — each component loads its own
  profile): `usePermissions()` → `{ can(area, 'view'|'edit'), isOwner }` from `my_admin_permissions`.
- `lib/adminNav.ts`: each `NavItem` gains `area`; `navFor` filters on `can(area,'view')`. `RequiresTenant` refuses a
  direct URL to a page the role can't view, with a plain *"Your role doesn't include this page"* state.
- Per page: edit controls hidden without Edit (P5). Money pages are simply absent for an ops role.
- **New Roles page** (`/roles`, area `admins`): list roles + holder counts; owner edits the 8×3 grid; co-admins with
  `admins:view|edit` see it read-only.
- **Admins page:** a Role column; role picker on invite and per row (options filtered by the assignment rule —
  display only; the RPC is the boundary). Owner-only UI checks are replaced by `can('admins','edit')`.
- Accounting page: the `isOwner` gate becomes `can('accounting','view')`.

### 5.6 Coach app (`SwimSyncApp/`)

The PayNow editor in coach Settings (`features/coach-settings/`) shows today for any `role === 'tenant_admin'` and
ignores deactivation. It becomes `billing:edit` via the same RPC (add `my_admin_permissions` to its dao). Nothing else
in the coach app uses the admin arm (research §6) — verify with the enforcement map.

### 5.7 Edge functions

- `credit-note-emails` note path (`is_tenant_admin`) → `has_admin_area(t,'billing','edit')`. The session path
  (admin OR main coach) → `operations:edit` OR main coach.
- `package-emails` offered / referral reward (`can_admin_tenant`) → `packages:edit`.
- `generate-invoices` trusts the Next.js route (CRON_SECRET) — the route gets `billing:edit` (P9).
- The **invoice email resend** path added by the crash-safe email claim (lane 2, `CRASH_SAFE_EMAIL_CLAIM_PLAN.md` §3.2)
  is born on `is_tenant_admin`; re-point it to `billing:edit`. Whichever lane lands second does it — check at step 0.
- `generate-invoices/email.ts` `notifyGenerationBlocked` (~`:641-674`) emails **every profile of the tenant** with role
  coach / tenant_admin, plus the platform admin, that billing is blocked. Decide during step 0 whether co-admins
  without `billing:view` drop off (coaches stay — they are the ones who must mark). A recipient filter, not a
  permission check.

## 6. Sequence

Each migration on its own short `db/…` branch from the **root checkout**, landed on `main` alone, `supabase test db`
green, before the next (CLAUDE.md, §7.55). Behaviour is identical for every existing account after each step, because
all co-admins are on *Co-admin (as before)* (today's authority exactly) and the owner passes everything.

| Step | What | Gate |
|---|---|---|
| 0 | **Enforcement map.** Generate from the live local DB: every policy (`pg_policies`) and function (`pg_proc.prosrc`) referencing the three helpers, each assigned an area + level. Commit as `docs/plans/ROLES_ENFORCEMENT_MAP.md`. Review with the user if any row is ambiguous. | Every one of the 68 policies + ~55 functions has a row |
| 1 | Migration A: types, tables, `has_admin_area`, `my_admin_permissions`, seed, `profiles.admin_role_id` + guard, role RPCs, `provision_tenant` seeding | pgTAP: new `roles_permissions.test.sql` (§7) |
| 2 | Migration B: re-point `operations` + `profile` (policies + RPCs) | pgTAP matrix for both |
| 3 | Migration C: re-point **money** areas 4–8 (`pricing`…`accounting`) incl. the `tenants` trigger and `set_class_terms` split | pgTAP matrix for 4–8 |
| 4 | Migration D: admin management → `admins` area + escalation guard | pgTAP escalation tests |
| 5 | Edge functions (`credit-note-emails`, `package-emails`) — deploy one at a time, `supabase functions list` | Deno tests |
| 6 | Admin app + coach app (context, nav, pages, Roles page, Admins page, API routes incl. P9) | vitest + jest + typecheck |
| 7 | UI driver `verify-roles.mjs` + update `verify-admins.mjs` | red-then-green (§7.25) |
| 8 | Deploy: `/deploy` — migrations A–D → functions → apps to `main` last | remote grant dump (§7.39, §7.89) |

Steps 1–4 can each deploy to prod as they land (dormant). Step 6 is the first user-visible change.

## 7. Tests

- **pgTAP `roles_permissions.test.sql`:** seed creates 4 roles × 8 rows per tenant; the operations-≥-View invariant is refused; existing co-admins on *Co-admin (as before)* and still refused Accounting and admin management (`accounting_summary.test.sql`'s co-admin refusal stays green);
  `has_admin_area` truth table (owner, platform admin, deactivated admin, suspended tenant, each level); a user cannot
  write `admin_role_id`; role CRUD owner-only; `delete_role` refuses while held; cross-tenant role assignment refused.
- **pgTAP permission matrix:** for each area, a co-admin on a role with that area at None / View / Edit — SELECT
  returns rows only at View+, one representative write succeeds only at Edit. One table and one RPC per area minimum;
  every money table for "None ⇒ zero rows".
- **Escalation:** co-admin with `admins:edit` cannot assign a stronger role (to another or to self), cannot touch the
  owner, cannot create/edit roles; can deactivate any co-admin (D9).
- **Owner protection:** each management RPC and route refuses the owner as target (§5.4).
- **Platform-admin preservation:** a platform admin still passes exactly the call sites it passed before, and still
  fails the ~20 that exclude it (P7).
- **Behaviour-preservation:** the existing suites (`admin_management`, `owner_transfer`, `accounting_summary`,
  `tenant_suspension`, `rls_isolation`, `admin_marks_attendance`, …) pass unchanged after each migration — that is the
  proof nothing moved for an existing co-admin.
- **Deno:** the two edge-function gates.
- **vitest:** `navFor` filtering by area; `usePermissions`; Admins role picker filtering; Roles grid editor.
- **Driver `verify-roles.mjs`:** owner creates a role; invites a co-admin on *Front desk*; the co-admin sees only ops
  pages, gets the refusal state on `/invoices` by URL, cannot edit the business profile; owner upgrades them and the page appears.
  Prove red by reverting one policy re-point.
- **Every new test proven RED without its fix** (§7.25).

## 8. Risks

1. **A missed call site leaves an ops role with money access** — the whole feature's failure mode. The first review
   (2026-09-27) found three such paths the draft missed: the coach arm on invoices (P11), the class-create price
   trigger (§5.3 2b), and the 15+ money columns on `tenants` (§5.3 1). Mitigation: the
   step-0 map is exhaustive by query, not by grep; after migration C, re-run the query and assert **zero** remaining
   references to `is_tenant_admin` outside `has_admin_area` and the coach-arm helpers.
2. **Behaviour change for an existing co-admin** (a re-point that tightens by accident). Mitigation: existing suites unchanged
   after every step; nightly read before the app step merges (§7.1).
3. **Grants drift** (new tables/functions callable by nobody, or too many). Mitigation: GRANT in the same migration
   (§7.87), `table_grants.test.sql`, remote grant dump after deploy.
4. **`BEFORE UPDATE` on `tenants` also fires for upserts** (§7.57) — detect the update inside the trigger.
5. **Size.** L, ~1–2 weeks. Lane 2 (crash-safe email claim) touches different files and one tiny migration — land
   lane 2's migration first, then start migration A.

## 9. Out of scope

- Per-page (26-row) permissions; per-record permissions (e.g. one location only).
- Hiding reference data under None (D6 — would rewrite ~14 shared read policies).
- Roles for coaches or parents. The coach arm is unchanged.
- Refunds themselves (Wave 2) — they will be born under `packages`.

## 10. Graduate at `/update-docs`

PRD §4.3 (co-admin authority → roles); `docs/ARCHITECTURE.md` §6 (the gate function, one choke point); gotchas for
anything the build finds (next free numbers).
