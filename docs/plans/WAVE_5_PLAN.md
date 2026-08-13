# Wave 5 — Admin authority

_Planned 2026-08-13. Backlog: `BACKLOG.md` → Build order → Wave 5 (items 12 and 13), plus
the platform-level tenant suspension row from the *Disable a COACH account* item's
control-levels table — pulled into this wave by the user 2026-08-13._

_Risk-reviewed 2026-08-13 (`/plan-review`, independent agent, findings verified against
code). The review found the first draft's parent-enforcement list FALSE (4 claimed paths;
≥12 exist), one RLS bypass, one unban-resurrection bug, and one undecided product
question — all folded in below, inline, marked `⚠ RISK n`. **The ⚠ blocks are steps,
assertions, and prohibitions — not commentary. Skipping one is skipping a step.**_

Three authority controls, one shipped pattern. The co-admin work (`20260806000100`, §8.31)
established the mechanism this wave reuses: authority cut by one clause in an identity
helper, an INVOKER guard trigger pinning the column against client writes (§7.38),
idempotent `SECURITY DEFINER` RPCs that gate themselves as their first act, and an
auth-layer ban applied non-atomically by an API route whose documented recovery is "press
the button again".

**Three chunks, strictly sequential, one migration in flight at a time (§7.55).** Each
chunk ships fully — migration alone onto `main` first (§11.9), pgTAP proven red, rollback
DOWN committed before deploy, grant dump after — before the next begins.

---

## Decisions (settled 2026-08-13 with the user — do not re-litigate)

| # | Decision | Consequence |
|---|---|---|
| 1 | Scope is **all three**: owner transfer, disable-a-coach, tenant suspension | Suspension leaves the backlog's "filed separately" state and ships here |
| 2 | Owner transfer is **platform-admin ONLY** — no self-service path | One RPC + one Platform-page action covers both handover and lost-owner. The tenant owner has no transfer button. Self-service can be added later if tenants multiply |
| 3 | The recovery/transfer UI lives on the **Platform page** | A per-row action on the Businesses table — the item's whole point is that dashboard SQL stops being the only remedy |
| 4 | Disabling a coach with active classes is **atomic**: the dialog requires a replacement, one RPC reassigns and disables in a single transaction | No half-done state. A refusal anywhere aborts the whole disable |
| 5 | Suspension blocks **staff AND parents** — that tenant's data disappears from its parents' app | Per-tenant, never account-level: a parent in two businesses keeps the other. Parents are never auth-banned |
| 6 | A suspended tenant gets **no new invoicing**; the engine skips it | Existing receivables are the owner's problem *before* suspension — see the accepted consequences below |
| 7 | Who disables a coach: **any active tenant admin**, not owner-only | Recorded in the backlog's control-levels table 2026-07-19 ("their own staffing"). The owner-lockout risk is closed by the sole-coach guard, not by the gate |
| 8 | **Already-sent invoice links keep working after suspension — forever** (⚠ RISK 4, settled 2026-08-13) | `public-invoice` is token-gated and RLS-blind by design; `invoices.public_token` has no expiry (`20260802000600:60-70`). Money can still come in on outstanding bills. **PROHIBITION: do NOT add a `suspended_at` check to `public-invoice`** — the user chose payability over consistency |

### Accepted consequences — recorded here, restated in UI copy

1. **Once suspended, a tenant's parents lose the app view of their invoices, but every
   already-sent `public-invoice` link keeps working indefinitely** (decision 8 — the
   first draft claimed links died too; that was false). The user's position, 2026-08-13:
   *"It will be the responsibility of the business owner to make sure that they settle
   all invoices before I suspend the tenant."* **STEP: the suspend confirm dialog must
   say exactly this shape: "The app goes dark for this business's staff and families.
   Already-sent invoice links keep working."**
2. **⚠ RISK 5 — a disabled coach / suspended tenant's staff keep their
   `current_tenant_id()`-scoped reads for the lifetime of their current token** (tenants,
   profiles, coaches, parent_tenants, family balances, trial/makeup bookings, levels,
   packages, trial_rates — `20260718000900:46-49` feeds ~10 policy arms this wave does
   not touch). This is the same residue `20260806000100:25-33` accepted for one banned
   co-admin; the auth ban is the enforcement. **ASSERTION (chunk 2 AND chunk 3 pgTAP):
   pin the residue as EXPECTED — "disabled coach still passes a `current_tenant_id()`
   read = TRUE (accepted, token-lifetime, ban enforces)" — so a future session finds a
   documented decision, not a leak.** Closing it for real would be one clause in
   `current_tenant_id()`, but its call sites include audit stamping
   (`20260804000300:29`) and were not audited this wave — a future decision, not a
   default.

---

## What needs NO change — derived from the code on 2026-08-13, re-verified by /plan-review

- **`guard_tenants_owner()` stays byte-identical for chunk 1.** It refuses only
  `current_user = 'authenticated'` (`20260806000100:238`); a `SECURITY DEFINER` RPC runs
  as `postgres` and passes. That is the designed mechanism (§7.38). *(Chunk 3 extends the
  same function to pin `suspended_at` — an extension, not a rewrite.)*
- **`resend-invite` needs no code change for chunk 1.** It already keys strictly on
  `tenants.owner_profile_id` (`route.ts:62-70`, by design). Assert it, don't edit it.
- **`generate_coach_payouts` and wage history.** Disabling is forward-looking; the payout
  builder reads taught sessions and historical `class_rates.paid_coach_id`
  (`20260812000200:1096-1098`) and pays a disabled coach's past lessons unchanged. pgTAP
  pins this; no engine change.
- **`public-invoice` — nothing (decision 8).** The prohibition above is the record.
- **No new nav page.** All three UIs land on existing pages, so `platform-admin-scope`'s
  17-page nav pin (`verify-platform-admin-scope.mjs:114`) does not move.
- **`profiles.is_active` stays unenforced and unused, deliberately.** Same reasoning as
  the admin half (BACKLOG:1188): it is whole-account; an admin-who-coaches must keep
  admining when their coach half is disabled. Wave 5 adds a third per-role column.
- **No RPC signature changes anywhere in this wave** — new functions plus in-place body
  edits only, so §7.123's breakage class cannot occur. (`grep -rn '\.rpc('` run
  2026-08-13; HANDOVER §3's named callers untouched.)

---

## Chunk 1 — Owner transfer (S — about half a session)

**Migration `db/owner-transfer`, one file:**

1. **`audit_log_tenant_of()` gains a `WHEN 'Tenant'` arm** (returns `p_entity_id`
   itself). The ELSE arm RAISES on unknown entity types **by design** (§7.37,
   `20260806000100:295-300`) — a forgotten arm breaks the RPC that writes the row, not
   just the audit. Added here because chunk 1 writes the first `'Tenant'` row; chunk 3
   reuses it. Start the body from `pg_get_functiondef()` (§7.115).
2. **`platform_reassign_owner(p_tenant_id UUID, p_new_owner_profile_id UUID)`** —
   `SECURITY DEFINER`, first act `IF NOT is_platform_admin() THEN RAISE`. Refuses a
   target that is not `role = 'tenant_admin'`, not of `p_tenant_id`, or
   `admin_disabled_at IS NOT NULL`. Idempotent (already-owner → silent return, no audit
   row). Writes `tenants.owner_profile_id` (passes the guard as `postgres`), audit row
   `owner_reassigned` with old + new in `new_value`.
3. **`platform_tenant_admins(p_tenant_id UUID)`** — the candidate list for the dropdown:
   `(profile_id, email, full_name, is_owner, is_disabled)` for that tenant's
   `tenant_admin` profiles. Gated `is_platform_admin()` the same `WITH me AS … WHERE
   me.ok` way as `platform_tenant_overview()`. An RPC, not a service-role API route.
4. Grants: the standard triple on both (`REVOKE … FROM PUBLIC, anon, service_role;
   GRANT EXECUTE … TO authenticated`).

**pgTAP (`owner_transfer.test.sql`), before any UI, each clause proven red by sabotage:**
gate refusals (anon holds nothing; tenant admin, owner, coach, parent all refused on both
RPCs) · happy path moves the column · cross-tenant target refused · disabled target
refused · non-admin target refused · idempotent re-run writes no second audit row ·
`platform_tenant_overview()` reports the NEW owner's email/status after transfer (that is
the `resend-invite` keying, asserted at the SQL layer).

**UI (after the migration is live):** Platform page Businesses table — a **Change owner**
action beside the Admin cell (`platform/page.tsx:640-670`), dropdown fed by
`platform_tenant_admins`, confirm dialog naming both parties, then
`rpc("platform_reassign_owner", …)` and `loadTenants()`. Direct `rpc()` from the page is
the house pattern — the page gate is a UX affordance; the RPC is the boundary.

**Rollback:** `supabase/rollback/20260813_owner_transfer_DOWN.sql`, committed before
deploy, rehearsed (§7.93 — running it is the half that finds the bugs). DOWN restores
`audit_log_tenant_of` from `pg_get_functiondef()`, drops both new RPCs.

---

## Chunk 2 — Disable a coach (M — about one session) — ✅ SHIPPED 2026-08-13 (§8.50, `20260813000200`)

**Migration `db/disable-coach`, one file:**

1. **`coaches.disabled_at TIMESTAMPTZ`** — the coach twin of `admin_disabled_at`.
2. **`current_coach_id()` gains `AND disabled_at IS NULL`.** Sole definition is
   `20260309000600:32` (verified 2026-08-13) — but take the body from
   `pg_get_functiondef()` anyway (§7.115). ⚠ This is the blast-radius edit: every coach
   policy flows through it, which is why pgTAP lands before any UI.
3. **`guard_coaches_privileges()`** — INVOKER trigger on `coaches` pinning `disabled_at`
   (and `profile_id`/`tenant_id`), modelled on `guard_profiles_privileges()`. No coaches
   guard exists today (verified). **⚠ This guard is LOAD-BEARING, not belt-and-braces:
   `coaches_update`'s self-arm (`USING profile_id = auth.uid()`,
   `20260718000900:274-276`) would otherwise let a disabled coach clear their own
   `disabled_at`. ASSERTION: pgTAP case "a disabled coach's own UPDATE clearing
   `disabled_at` is refused" = PASS, proven red by disabling the trigger.** The guard
   ships in the SAME migration as the column — never later.
4. **`disable_coach(p_coach_id UUID, p_replacement_coach_id UUID DEFAULT NULL)`** —
   `SECURITY DEFINER`, gated `is_tenant_admin(v_tenant)` (decision 7), same-tenant target
   only. Refusals, in order:
   - **the sole-coach-who-is-the-owner guard** — decided by *which extension rows exist*,
     never `role` (§7.19, §7.91): if the target's profile is the tenant's
     `owner_profile_id` and no other active coach exists, refuse.
   - active classes and no replacement → refuse, naming the classes.
   - replacement not an active same-tenant coach, or equal to the target → refuse.
   Then, in one transaction: reassign each active class via `set_class_terms()`
   (effective-dated from today — the caller's `auth.uid()` survives into the nested
   definer call, so its `can_admin_tenant` gate passes, verified `20260812000200:1029,
   1044`) · end the target's own active `class_shadow_coaches` rows (dated today, never
   deleted — Wave 3 RISK 12) · delete `session_coaches` overrides naming the target on
   **future-dated** sessions only (past rows are wage history) · set `disabled_at` ·
   audit row `coach_disabled`, entity `'Coach'` — **which needs a `WHEN 'Coach'` arm in
   `audit_log_tenant_of()`** (reads `coaches.tenant_id`), added in this migration.
   Idempotent: already-disabled → silent return.

   **⚠ RISK 7 — `set_class_terms()` has TWO money-guard refusals beyond the
   shadow-handover one the first draft named** (billing month sealed at/after current
   month `20260812000200:1127-1134`; a PAID coach payout for the current month or later
   `:1136-1145` — always reached, because reassignment moves `paid_coach_id`).
   Composition is the point (the transaction aborts atomically), but the UI must surface
   the underlying message plainly. **ASSERTION (pgTAP, both proven red):** (a) "disable
   with previous month sealed — the normal arrears state — succeeds" = PASS; (b)
   "disable while a current-month payout is Paid aborts atomically: coach NOT disabled,
   classes NOT moved, shadow rows NOT ended" = PASS.

   **⚠ RISK 8 — a PAST or TODAY session carrying a `session_coaches` override naming
   the target stays markable only by an ADMIN after the disable**
   (`coach_is_main_on_session()` resolves the override `20260812000200:521-532`; the
   disabled coach's `current_coach_id()` is NULL; the replacement is not main). An
   unmarked such lesson blocks the tenant's whole invoice run with no override
   (PRD §7.7). **ASSERTION (pgTAP): "past session with an override naming the disabled
   coach: replacement CANNOT mark, admin CAN, and the month completes once the admin
   marks" = PASS. STEP (UI): the disable dialog lists any UNMARKED override-carrying
   lessons of the target, labelled "marking these falls to you (admin) after
   disabling".**
5. **`reactivate_coach(p_coach_id UUID)`** — mirror, idempotent, **takes no refusals**
   beyond the gate (the `reactivate_class()` doctrine: the exit door never grows a
   lock). It does NOT hand classes back — the reassignment was effective-dated and
   stands; giving them back is a deliberate `set_class_terms` call by the admin.
6. **ASSERTION (pgTAP, staff-shape invariant):** no profile holds both a `parents` row
   and a staff `tenant_id` ("staff are single-tenant by construction",
   `20260309000100:24-33`, `20260806000100:175-182`) = 0 rows. Chunk 3's bulk ban leans
   on this; pin it here where the coach column lands.
7. Grants: standard triple on both RPCs.

**pgTAP (`coach_disable.test.sql`), proven red by sabotage:** `current_coach_id()` is
NULL for a disabled coach and their **coach-scoped** policies go dark (classes, schedule,
attendance write) — **while the `current_tenant_id()`-scoped reads stay lit, pinned as
EXPECTED per accepted consequence 2 (⚠ RISK 5)** · an admin-who-coaches keeps their
ADMIN authority when their coach half is disabled (BACKLOG:1188's mirror-image concern) ·
sole-owner-coach refusal · reassignment writes the effective-dated `class_rates` row ·
shadow rows end-dated, not deleted · future overrides cleared, past rows intact · a
disabled coach's taught lessons still produce payout items · the guard cases from step 3
· the two `set_class_terms` composition cases from step 4 · the override-marking case
from step 4 · idempotency · gates.

**API routes + UI:** `/api/disable-coach` and `/api/reactivate-coach` copy
`deactivate-admin/route.ts` exactly: caller-token RPC first, then ban/unban at the auth
layer **only for a PURE coach** (`role = 'coach'` — an admin-who-coaches is never
banned), `BAN_FOREVER`, read-back of `banned_until`, 500 → "press again" retry recovery
(the non-atomic pair is inherited and accepted; the retry idiom is the recovery). UI on
the admin **Coaches page**: Disable opens a dialog listing active classes (replacement
required when non-empty) and the ⚠ RISK 8 unmarked-override list; Reactivate on a
disabled row; refusal messages surfaced plainly, never as raw exceptions.

**Driver:** ban state is auth-layer and deliberately not pgTAP's job
(`admin_management.test.sql` precedent) — `verify-coach-disable.mjs` (or extend
`verify-admins.mjs`): disable a seeded pure coach → their login dies and the replacement
sees the class → reactivate → login returns.

**Rollback:** DOWN committed before deploy; restores `current_coach_id()` and
`audit_log_tenant_of()` bodies from `pg_get_functiondef()`, drops the RPCs, the guard,
the column.

---

## Chunk 3 — Tenant suspension (M — up to two sessions; the widest blast radius in the wave)

**Migration `db/tenant-suspension`, one file:**

1. **`tenants.suspended_at TIMESTAMPTZ`** + extend **`guard_tenants_owner()`** to also
   pin it (keep the trigger name).
2. **`tenant_suspended(p_tenant_id UUID) RETURNS BOOLEAN`** — `STABLE SECURITY DEFINER`,
   the single predicate everything else calls.
   **⚠ RISK 10 — ASSERTION: `tenant_suspended(NULL) = FALSE`, enforced with COALESCE in
   the body and pinned by a pgTAP case = PASS.** `coaches.tenant_id` is nullable
   (`20260718000500:129`) and `profiles.tenant_id` is NULL for parents and the platform
   admin; a NULL result in a policy USING clause fails closed and would black out a
   legacy row silently.
3. **Staff-side enforcement, two helper edits:**
   - `is_tenant_admin()` gains `AND NOT tenant_suspended(p_tenant_id)` — cuts every
     admin policy. `can_admin_tenant()` = that OR `is_platform_admin()`, so **the
     platform admin keeps full access** (required: unsuspending, oversight).
   - `current_coach_id()` gains `AND NOT tenant_suspended(tenant_id)`. **⚠ RISK 2 of
     the wave: this function is edited in chunk 2 AND here — STEP: start from
     `pg_get_functiondef()` against the live database, never from chunk 2's migration
     file (§7.115), and ASSERT both clauses in the post-edit body: pgTAP re-runs chunk
     2's "disabled coach is NULL" case in this suite = PASS.**
   - The `current_tenant_id()` residue is NOT cut — accepted consequence 2 (⚠ RISK 5);
     pin it in pgTAP here too, for a suspended tenant's staff.
4. **⚠ RISK 1 — parent-side enforcement. The first draft claimed four ownership-scoped
   paths; the verified surface is ≥12 policies + 1 RPC + 1 write arm. STEP — re-derive
   the list at implementation time; the command is the fact:**
   ```bash
   grep -n 'current_parent_id\|parent_owns_student\|parent_has_child_in_class' supabase/migrations/*.sql
   ```
   Then cut at **two helper choke points that ARE parent-only by construction** (both
   resolve `current_parent_id()` internally — the first draft's reason not to touch them
   was false):
   - **`parent_owns_student()`** (`20260309000600:37`) gains a suspension check via the
     student's tenant — covers attendance, enrolments, trial_bookings, makeup_bookings,
     students_select, **and the `students_update` parent WRITE arm**
     (`20260718000900:302-306`) in one edit.
   - **`parent_has_child_in_class()`** (latest body `20260802000300:63` — take
     `pg_get_functiondef()`) — covers sessions_select and classes_select.
   Plus **one edit per remaining direct `current_parent_id()` arm** (as of 2026-08-13:
   `invoices_select`, `invoice_items_select`, `credit_notes_select`,
   `payment_records_select`, `credit_applications_select`, `parent_packages_select` AND
   `parent_packages_update`, `parent_tenants_select`, `parent_tenant_balances_select`,
   `student_claims` select), and **the `claim_invoice_paid()` RPC gate**
   (`20260802000700:31-38` — otherwise a suspended tenant's parent can still write
   `paid_claimed_at`).
   **ASSERTION: one proven-red pgTAP case per policy arm AND per helper — a missed path
   fails silent, so the test list is the enumeration, not a sample. The two-tenant
   fixture parent must keep every one of these reads on their OTHER tenant.**
5. **⚠ RISK 2 (review) — `parent_tenants_insert` lets a parent (re)join a suspended
   tenant directly via PostgREST, bypassing any RPC refusal**
   (`WITH CHECK (parent_id = current_parent_id() OR is_platform_admin())`,
   `20260718000900:209-210` — no tenant condition at all). **STEP: add
   `AND NOT tenant_suspended(tenant_id)` to the parent arm of the WITH CHECK (keep the
   platform-admin arm). ASSERTION: proven-red pgTAP case of a direct insert = refused.**
6. **`join_tenant_by_code()`: ⚠ RISK 6 — the live body is `20260719001200:282-330`,
   NOT `20260719000200` (stale first-draft citation), and its `ON CONFLICT … DO UPDATE
   SET is_active = TRUE` arm REACTIVATES an inactivated membership — exactly how a
   formerly-active family of a suspended tenant would re-enter. STEP: author the edit
   from `pg_get_functiondef()`; the suspension refusal fires immediately after the
   `SELECT … INTO v_tenant`, BEFORE the insert/update, reusing the identical "that join
   code was not recognised" wording (the file's own anti-probing rule). ASSERTION: pgTAP
   case "a previously-joined, inactivated parent re-entering the code of a suspended
   tenant is refused with the generic wording" = PASS.**
7. **`suspend_tenant(p_tenant_id)` / `unsuspend_tenant(p_tenant_id)`** —
   platform-admin-gated, idempotent, audit rows on the `'Tenant'` arm from chunk 1.
   Standard grant triple.
8. **`platform_tenant_overview()` gains a `suspended_at` output column.** A return-type
   change **cannot** go through `CREATE OR REPLACE` — this is the one place the wave
   must `DROP` a function whose own header says "never DROP". **STEP: restate the full
   grant state (`20260806000100:566-567` / `20260719002400:137-139`) in the same
   migration file, adjacent to the DROP.** *(Post-`20260804000400/000700`
   default-privilege state means a forgotten regrant fails CLOSED — the platform page
   errors rather than leaks — so the failure is loud, but it is still a broken page.)*
   The post-deploy grant dump is the proof (§7.39, §7.89).

**Engine (`generate-invoices`):** add `suspended_at` to the tenant-settings `.select()`
in `generateForTenant` (`core.ts:277`) and return `status: "tenant_suspended"` beside
`auto_disabled` — one insertion covers both the cron loop and the admin button. Deno
suite **run twice** (§7.15), with a new case. **Deploy order: migrations → engine → apps
(§7.60) — land `main` last.**

**API routes:** `/api/suspend-tenant` bans the suspended tenant's **pure-staff**
accounts (`profiles.tenant_id = t AND role IN ('tenant_admin','coach')`, minus
admin-who-coaches per the chunk 2 rule; parents are NEVER banned — they are
multi-tenant), after the RPC, with read-back; the read-back loop reports **which**
accounts failed, not just "retry".
**⚠ RISK 3 — PROHIBITION on `/api/unsuspend-tenant`: it MUST NOT unban any profile with
`admin_disabled_at IS NOT NULL`, nor a coach whose `coaches.disabled_at IS NOT NULL`.
The unban set is (staff of tenant) MINUS (individually disabled) — a naive mirror of the
suspend route permanently resurrects logins that `deactivate-admin` or chunk 2 killed.**

**UI:** Platform page Suspend/Unsuspend row action; confirm dialog carries accepted
consequence 1's exact copy shape ("app goes dark … already-sent invoice links keep
working"); Suspended badge from the new overview column.

**pgTAP (`tenant_suspension.test.sql`):** the enumerated parent matrix from step 4 (one
case per arm, each proven red) · staff dark via both helper edits · the ⚠ RISK 5 residue
pinned as expected · `tenant_suspended(NULL) = FALSE` · the direct-insert refusal · the
rejoin refusal · platform admin still reads everything and can unsuspend · guard refuses
client writes to `suspended_at` · idempotency · overview reports the column · the chunk 2
"disabled coach" case re-run green.

**⚠ RISK 9 — Driver (`verify-tenant-suspension.mjs`):** the bulk ban/unban is the widest
auth-layer change in the product and pgTAP cannot see it. Fixture tenant + staff + a
two-tenant parent (per `check-fixture-roundtrip.sh` conventions): suspend → staff login
dies, the parent still sees their other business → unsuspend → staff login returns, and
**a fixture coach individually disabled before the suspend stays dead after the unsuspend
(the RISK 3 prohibition, proven in a browser)**. **PROHIBITION: the driver's teardown
must unsuspend even on failure — a suspended fixture tenant left on the shared local DB
breaks every sibling driver that logs in as its staff.**

**Rollback:** DOWN committed before deploy — the widest of the wave: restores every
edited function body (from `pg_get_functiondef()`), every edited policy, the overview
function WITH its grants, drops the column. Rehearse it: the full pre-change suite must
be green after DOWN.

---

## Deploy gates — every chunk, no exceptions

1. Migration authored on a `db/…` branch in the **root checkout** (never a worktree),
   landed on `main` **alone**, `supabase migration list --linked` remote column filled
   (`db push`'s own output proves nothing — the pgdelta stack trace is normal).
2. pgTAP green locally, every new clause proven red first (§7.25) — sabotage runs
   recorded in the test-file header, `admin_management.test.sql` style.
3. Rollback DOWN committed **before** the deploy, and rehearsed.
4. Post-deploy **remote grant dump** (§7.39, §7.89) — chunk 3's overview DROP makes this
   the load-bearing check of the wave.
5. Engine chunks: Deno suite ×2. App chunks: `npm run typecheck` both apps, vitest,
   affected drivers. A 200 proves nothing — grep the served bundle for a new
   user-visible string (§7.31; the admin cannot be grepped, use the §11.10 method).

---

## Pre-commit gate — walk before each chunk's `/commit-review`

**Highest value, called out (a box that cannot be ticked is a blocker):**

- [ ] **Chunk 3 only:** the parent-path grep was re-run TODAY and every hit is either
      edited or named in the pgTAP matrix (⚠ RISK 1 — the test list IS the enumeration)
- [ ] Every twice-edited function body (`current_coach_id`, `audit_log_tenant_of`,
      `join_tenant_by_code`, `parent_has_child_in_class`) was authored from
      `pg_get_functiondef()`, and the earlier chunk's pgTAP case re-runs green (⚠ RISKS
      2, 6)
- [ ] The unsuspend route excludes individually-disabled staff, and the driver proved it
      in a browser (⚠ RISK 3)

**The rest:**

- [ ] Every ⚠ ASSERTION in this file exists as a pgTAP/driver case and was proven red
- [ ] Both PROHIBITIONS honoured: no `suspended_at` check in `public-invoice`
      (decision 8); driver teardown unsuspends on failure (⚠ RISK 9)
- [ ] `coaches` guard shipped in the same migration as the column (chunk 2 step 3)
- [ ] Overview grants restated adjacent to its DROP; post-deploy dump clean
- [ ] Suspend dialog copy matches accepted consequence 1's shape
- [ ] Confirm-dialog / refusal messages surface `set_class_terms` composition errors
      plainly (⚠ RISK 7)

---

## Graduating on ship (for `/update-docs`)

- `PRD.md`: owner transfer under §4.4 (platform), coach disable under §7.13 or a new
  staff-lifecycle subsection, tenant suspension under §4.3/§4.4 — including decision 8's
  links-keep-working behaviour, which parents will observably rely on.
- `BACKLOG.md`: strike items 12 and 13 **and grep for their names** (the ⚠ at the top of
  Build order); move the suspension row out of the disable-coach item.
- `HANDOVER.md` §3: one verified row per chunk; DORMANT entries for coach-disable and
  suspension — production is a private coach (sole coach = owner), so chunk 2's headline
  path is unreachable there by its own guard, exactly like the substitute model (§7.131).
  Don't rediscover it as a bug.
- **Gotcha candidates for `docs/GOTCHAS.md` §7 (durable beyond this wave):** (a) the
  `current_tenant_id()` residue family — "cutting an identity helper does not cut the
  membership-scoped arms; the ban is the enforcement" (⚠ RISK 5); (b) the
  DROP-plus-regrant pattern for return-type changes on granted functions; (c) "the
  parent-side has no single choke point: ownership-scoped arms bypass tenant scoping —
  enumerate by grep, never from memory" (⚠ RISK 1).
