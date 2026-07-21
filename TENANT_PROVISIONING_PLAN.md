# Tenant Provisioning — Build Plan

_Written 2026-07-21. Platform-admin-only provisioning of a new business + its first
admin account._

> **STATUS: BUILT AND VERIFIED LOCALLY — NOT DEPLOYED.** All phases complete.
> 263 pgTAP (18 files, +19), 88 admin vitest (+12), 69 app jest, both apps
> typecheck under the §7.11 stubbed condition, and `verify-tenant-provisioning.mjs`
> passes **15/15** against both running UIs. The Deploy section below has not been
> executed. See **What actually happened** for three findings that changed the build.

## What actually happened (read before touching this again)

**1. RISK 3 fired for real, and my first mitigation missed it.** The plan said to copy
the overview body verbatim — but I copied it from `20260719002300`, the file whose name
you find first, not from `20260719002400`, which had already superseded it (`kind` → a
derived `shape`, `coaches_without_rate` → `staff_without_rate`). The migration silently
REVERTED both, and my own diff check passed because it diffed against the same wrong
source. It was caught only by dumping the live definition out of Postgres.
**The fix is structural and is now in the migration header: get the current definition
from the DATABASE, never from a guessed file —**
`SELECT pg_get_functiondef('public.platform_tenant_overview()'::regprocedure);`

**2. RISK 1's mitigation turned out to be structural, not vigilance.** `provision_tenant`
grants EXECUTE to `authenticated` only — **not `service_role`** — so a service-role call
fails with `permission denied for function` instead of silently passing the
`is_platform_admin()` gate against a NULL `auth.uid()`. The "don't use adminClient" rule
is now enforced by the grant rather than by remembering. Verified empirically: service
role REFUSED, tenant_admin REFUSED, platform_admin ALLOWED.

**3. RISK 5 fired for real.** The first end-to-end run produced an invite link with
`redirect_to=http://127.0.0.1:3000` — Supabase had **silently substituted `site_url`**
because `/accept-invite` was not in `additional_redirect_urls`. The link still worked; it
just dumped the new owner on the admin root instead of the password form. A missing
redirect URL fails quietly, not loudly. `config.toml` now carries the full list with a
comment saying to suspect it first.

**The gap this closes:** everything downstream of a tenant existing is built (RLS, join
codes, per-tenant billing, wages, packages). But **nothing can insert into `tenants`**
(`20260718000500_tenants.sql:184-190` grants only SELECT/UPDATE; there is no
`tenants_insert` policy and no `create_tenant` RPC), and **nothing can mint a
`tenant_admin`**. Every one that exists came from `seed.sql`, the one-time backfill, or
manual dashboard SQL. The admin panel has no signup page at all.

**The auth trigger already handles this and needs no change.** `handle_new_user()`
(`20260718000700_auth_trigger_tenant.sql:24-66`) accepts `role: 'tenant_admin'` plus an
`is_coach` flag that also creates the `coaches` row. It only refuses to *guess*:

```sql
IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
  RAISE EXCEPTION 'creating a % requires tenant_id in user_metadata — refusing to guess ...'
```

**That is the load-bearing ordering constraint: the tenant row must exist before the auth
user.** Two writes, no transaction across them — which is where RISK 2 lives.

## Settled decisions (do not re-litigate)

| Decision | Why |
|---|---|
| **Platform admin provisions; no public signup** | No platform billing and no approval step means an open door is spam tenants + squatted join codes. Tenant 2 is a hand-onboarded school. |
| **Invite link sent by US via Resend**, not Supabase Auth | `generateLink` returns the link without sending. Template is code-owned and unit-testable, no prod dashboard paste to drift, and resend is deterministic. |
| **Dedicated `/accept-invite` page** | `/reset-password`'s copy ("reset link", "Request New Link") is wrong for a first-time invitee and dead-ends them. |
| **Pending/resend surfaced on `/platform`** | An unaccepted invite leaves a live, joinable tenant with no operator. |
| **No delete path** | Deleting a tenant cascades into families, students, invoices, attendance. A destructive button on a support panel is worse than the rare typo. Fix via SQL. |
| **Slug auto-derived** | `slug` is referenced nowhere in either app — no route, no query. Only `NOT NULL UNIQUE`. |
| **Exactly ONE admin per tenant** | The role lives on `profiles.tenant_id`. Multiple admins is `BACKLOG.md:447`, which swaps this shortcut for a `tenant_members` join table. Do NOT build the join table here. |

---

## Phase 0 — Spike FIRST (blocks phase 3)

Against the local stack, confirm `auth.admin.generateLink({ type: 'invite', ... })`:

1. **creates** the auth user,
2. **fires `handle_new_user()` with our `data` intact** as `raw_user_meta_data`,
3. returns `action_link` **without sending an email**.

> ⚠ **RISK 4 MITIGATION — assert the metadata round-trip, don't assume it.**
> After the spike call, run:
> `SELECT raw_user_meta_data FROM auth.users WHERE email = '<spike>';`
> **Pass value: it contains all four of `role`, `full_name`, `tenant_id`, `is_coach`.**
> Then `SELECT role, tenant_id FROM profiles` and `SELECT 1 FROM coaches` for that id.
> **If `data` does not survive to `raw_user_meta_data`, STOP** and fall back to
> `createUser({ email_confirm: false, user_metadata })` + `generateLink({ type: 'recovery' })`.
> Do NOT write phase 3 before this is confirmed — the entire design rests on it.

---

## Phase 1 — Database (two migrations, additive only)

### `20260721000100_provision_tenant.sql`

```
provision_tenant(p_display_name TEXT, p_kind tenant_kind)
  RETURNS TABLE (tenant_id UUID, slug TEXT, join_code TEXT)
```

- `SECURITY DEFINER`, `SET search_path = public`, gated on `is_platform_admin()`.
- **RAISES on refusal** — deliberately unlike `platform_tenant_overview()`, which returns
  zero rows so a *read* tool never 500s. A silent no-op on a **write** looks like success.
- Join code via existing `generate_join_code()` in the retry-against-UNIQUE loop that
  `regenerate_join_code()` already uses.

> ⚠ **RISK 1 MITIGATION — the gate is the entire boundary; prove it fires.**
> - `REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM PUBLIC;`
>   then `GRANT EXECUTE ... TO authenticated`. **`CREATE FUNCTION` grants EXECUTE to
>   PUBLIC by default, which includes `anon`** (§7.20 family). This line is not optional.
> - **Do NOT add an `INSERT` grant on `tenants` and do NOT add a `tenants_insert`
>   policy.** The RPC stays the only door — same shape as `close_student_enrolment()`
>   and `set_students_active()`.
> - pgTAP must include cases **expected to FAIL** for parent, coach, `tenant_admin` and
>   anon. **Wrap every role probe in an explicit `BEGIN`/`COMMIT`** — `SET LOCAL ROLE`
>   outside a transaction is a no-op that runs as `postgres` and bypasses RLS, so every
>   case "passes" including the denials (§7.16).
> - **Assertion: `SELECT COUNT(*) FROM tenants` is unchanged after all four refusal
>   cases.** A gate that raises but still wrote is not a gate.

> ⚠ **RISK 8 MITIGATION — a slug that derives to empty violates NOT NULL.**
> Derivation is lowercase → non-alphanumeric to `-` → collapse → trim, collision-suffixed
> `-2`, `-3`. **A non-ASCII business name (entirely plausible in Singapore — a
> Chinese-named school) derives to the empty string.** Structural fallback: when the
> derived slug is empty, use `'tenant-' || substr(gen_random_uuid()::text, 1, 8)`.
> **pgTAP case: provision a tenant named `'游泳學校'` and assert a non-empty unique slug.**

### `20260721000200_platform_overview_admin_status.sql`

`DROP FUNCTION` + recreate `platform_tenant_overview()` with `admin_email TEXT` and
`admin_status TEXT` (`none` | `invited` | `active`). A `RETURNS TABLE` signature change
cannot use `CREATE OR REPLACE`.

- `admin_status` derives from `auth.users.last_sign_in_at IS NULL` — the honest signal
  that they actually got in, not merely that a row exists. Reading `auth.users` is fine:
  the function is already `SECURITY DEFINER` owned by `postgres` and its
  `is_platform_admin()` gate is unchanged.

> ⚠ **RISK 3 MITIGATION — a DROP+CREATE of a live support tool invites copy-paste drift.**
> - **Step:** run `supabase test db` and record the count BEFORE touching this file.
>   **Assertion: 244 before. After the migration + new tests, the total must be ≥ 244 —
>   a DECREASE means a test was silently lost to the signature change.**
> - **Step:** build the new body by copying the existing one verbatim and adding ONLY the
>   `LEFT JOIN profiles` / `LEFT JOIN auth.users` and the two new output columns. Do not
>   retype the aggregates. Then `diff` old vs new and confirm the only changes are the
>   additions.
> - **Named prohibition: do NOT "tidy" the existing aggregate subqueries while in here.**
>   Their comments record why they count rows-that-exist rather than deriving expected
>   lessons (§7.18 — a fourth copy of that rule caused a live underbill).
> - **Step:** the existing `platform_overview.test.sql` (24) must be updated and still
>   assert its original invariants — notably that FOUR caller shapes get zero rows and
>   that `last_attendance_date` is NULL, not 0, for a business that never marked anything.

---

## Phase 2 — Email builder

`SwimSyncAdmin/lib/inviteEmail.ts` — pure HTML builder + Resend sender, mirroring
`generate-invoices/email.ts`. **SwimSync-branded**, because this is the platform inviting
a business owner — unlike invoice emails, which are the *business's* (PRD §7.10).

> ⚠ **RISK 5 MITIGATION — here the email IS the deliverable, so it must NOT no-op silently.**
> Invoice emails are deliberately a logged no-op without `RESEND_API_KEY` because billing
> must not depend on delivery. **This is the opposite case: an invite nobody receives means
> the business owner has no way in, and the UI would have said "Business created".**
> - The builder still no-ops without a key (so tests/local never send), but the sender
>   **returns `{ sent: false, reason }` rather than swallowing it**.
> - **Named prohibition: the route must NOT return plain `success: true` when
>   `sent === false`.** It returns the invite link in the response body so the platform
>   admin can copy it manually, and the UI renders that as a visible warning.
> - **Assertion: with `RESEND_API_KEY` unset, provisioning through the UI shows the
>   copyable-link warning state, not a green success toast.**

---

## Phase 3 — API routes

### `app/api/provision-tenant/route.ts`

1. Verify caller is `platform_admin` in TS.
2. Call `provision_tenant` **with the caller's token**.
3. `generateLink({ type: 'invite' })` with `{ role: 'tenant_admin', full_name, tenant_id, is_coach }`.
4. Send via Resend.
5. On any failure after step 2, **delete the tenant row**.

> ⚠ **RISK 1 MITIGATION (second half) — call the RPC as the CALLER, never as service role.**
> If step 2 uses `createAdminClient()`, `is_platform_admin()` evaluates against a
> superuser and **always passes** — the gate would exist and never fire. That is gotcha
> §7.8 exactly: *a safety gate that the only live caller bypasses is not a gate.*
> **Named prohibition: do NOT use the admin client for step 2.** Service role is used
> only for steps 3 and 5, which genuinely require it.

> ⚠ **RISK 2 MITIGATION — an orphan tenant is worse than a failed one.**
> A tenant created in step 2 whose invite fails in step 3 is **live and joinable with a
> valid join code, but has no operator** — a parent could join it and their children would
> land in a business nobody administers.
> - **Step:** wrap steps 3–4 in try/catch; on any throw, delete the tenant with the admin
>   client before returning the error.
> - **Step:** fault-inject it in a test. `generateLink` is called through a small seam, so
>   a stub that throws is enough — the same Proxy-shim approach used for the package
>   ledger write-failure test (§8.8). **Assertion: after the injected failure,
>   `SELECT COUNT(*) FROM tenants WHERE display_name = '<fixture>'` is 0.**
> - **Structural backstop:** `admin_status = 'none'` renders as a red **"no admin"** badge
>   on `/platform`, so any orphan that escapes the compensation is visible rather than
>   silent.

> ⚠ **RISK 6 MITIGATION — a typo'd email hands a stranger admin of a business.**
> The invite grants `tenant_admin` to whoever opens it. A mistyped address is a
> cross-tenant data exposure, not just a failed send.
> - **Step:** the modal requires the admin email **entered twice** and refuses on mismatch.
> - **Step:** the success panel displays the address the invite went to, verbatim.
> - **Step:** document the remedy in the plan's runbook section: the account is only
>   usable once a password is set, so while `admin_status = 'invited'` the fix is to
>   delete that auth user and re-invite.

### `app/api/resend-invite/route.ts`
Platform-admin only. Refuses when `admin_status = 'active'`. Generates a fresh link and
resends.

> ⚠ **RISK 2 MITIGATION (second half) — re-provisioning must not mint a second tenant.**
> **Step:** the provision route first checks whether a tenant with that admin email
> already exists in `invited` state and **re-invites instead of creating**. Without this,
> "the invite didn't arrive, let me try again" silently produces two businesses with two
> join codes.

---

## Phase 4 — UI (`/platform`)

**New business** modal: business name · private/school · admin's name · admin email
(×2, per RISK 6) · **"this person also teaches"**.

That last checkbox sets `is_coach` and is the one that matters — it decides whether the
trigger creates the `coaches` row, i.e. the private-coach-as-tenant-of-one shape.

> **Named prohibition: `kind` (private/school) must NOT drive the `is_coach` checkbox, and
> must never reach an RLS policy.** It is onboarding copy and future pricing only
> (`20260718000500_tenants.sql:36-38`). A school's owner may well teach. The moment
> authorization branches on `kind`, private and school become two products again.

Success panel shows the **join code** with a copy button — it is the only route in for
that business's parents. Table gains an **Admin** column: email + `invited`/`active`/`no
admin` badge + **Resend**.

---

## Phase 5 — `/accept-invite`

Mirrors `/reset-password`'s session-settling logic (it settles on any session, not
specifically `PASSWORD_RECOVERY`, so an invite token lands fine), with correct copy:
*"Welcome to SwimSync — set a password for &lt;Business&gt;"*, and a failure state saying
**ask your SwimSync contact for a new invite** rather than pointing at a forgot-password
form an invitee cannot use.

---

## Phase 6 — Fix `create-coach`

`app/api/create-coach/route.ts:26` admits `platform_admin` but line 48 passes
`tenant_id: profile.tenant_id`, which is **NULL for them** — so the trigger raises.
Restrict to `tenant_admin`: a platform admin has no tenant context, and guessing one is
precisely what the trigger refuses to do.

> ⚠ **RISK 7 MITIGATION — don't regress the working path while fixing the broken one.**
> **Step:** before changing it, create a coach as `tenant_admin` through the real UI and
> confirm it works. **Assertion: after the change, the same flow still succeeds, and a
> `platform_admin` caller now gets a clear 403 with a message naming why — not a 500 from
> the trigger.**

---

## Phase 7 — Config (not code; the easiest thing to forget)

- `config.toml` `additional_redirect_urls` += admin `/accept-invite` and `/reset-password`
  for local **and** prod.
- Production: the same allow-list in the Supabase dashboard.
- **`RESEND_API_KEY` into the admin's Vercel project** — it currently lives only in
  `supabase/functions/.env` and as a Supabase secret.

> ⚠ **RISK 5 MITIGATION (second half) — config is where this silently dies.**
> - **Named step: after editing `config.toml`, run `supabase stop && supabase start`.**
>   Auth settings are read only at boot; without the restart the invite link is rejected
>   and it looks like a code bug (HANDOVER §4).
> - **Note the existing latent problem:** `additional_redirect_urls` currently contains
>   `localhost:8081` and `swimsync://` (the Expo app) but **nothing for the admin panel**,
>   while `site_url` is `127.0.0.1:3000` and the admin dev server runs on
>   `localhost:3000`. The existing admin reset uses `window.location.origin`, so this may
>   already be broken locally. **Step: verify the admin's existing forgot-password flow
>   works locally BEFORE building on it** — otherwise you will debug your new invite
>   against a pre-existing fault.
> - **Local testing constraint:** `[auth.rate_limit].email_sent = 2` per hour. Raise it
>   temporarily or expect the third test invite to be throttled.

---

## Phase 8 — Tests

- **New pgTAP `tenant_provisioning.test.sql`:** refusal for parent/coach/tenant_admin/anon
  (in explicit transactions, per RISK 1); success for platform admin; join-code format +
  uniqueness; duplicate business names → distinct slugs; non-ASCII name → valid slug
  (RISK 8); `is_coach` true/false → `coaches` row present/absent (RISK 4);
  `admin_status` transitions none → invited → active.
- **Update `platform_overview.test.sql`** for the two new columns, preserving its
  original invariants (RISK 3).
- **vitest** for the invite-email builder: escaping, and `{ sent: false }` without a key
  (RISK 5).
- **UI driver `verify-tenant-provisioning.mjs`:** provision → `invited` badge → accept →
  `active` badge → the new admin logs in and **sees only their own business**.

> ⚠ **RISK 4 MITIGATION (second half) — prove the new admin can actually get in.**
> §7.19 is this exact failure: the tenancy backfill made the real coach a `tenant_admin`
> and login still branched on `role === "coach"`, so they were met with *"Unrecognised
> role"* — **locked out of production.** Capability is determined by which extension rows
> exist, not the enum.
> **Step: the driver must log the newly-provisioned admin into BOTH surfaces —** the
> admin web panel, and (when `is_coach` was checked) the mobile app, asserting they land
> on the coach UI rather than the unrecognised-role alert.

---

## Deploy

**EXPAND order — migrations first, then push** (this only adds; HANDOVER §7.27).

> ⚠ **RISK 3 MITIGATION (deploy half) — the DROP window is real.**
> `platform_tenant_overview()` is DROPped and recreated in one migration, so it is
> transactional in Postgres — but the **admin panel deployed from `main` must not expect
> the new columns before `db push` runs.** With EXPAND order (migrate first) this is safe;
> **named prohibition: do NOT push to `main` before `supabase db push` completes.**
> §8's deploy got this backwards and shipped an admin calling an RPC that did not exist.
> - **Step:** take a backup before `db push` (scratchpad, not committed).
> - **Step:** after `db push`, run `supabase migration list` and confirm **nothing has an
>   empty `remote` column**.
> - **Step:** smoke `/platform` in production immediately after the push — it is the page
>   this migration rewrites.

---

## Pre-commit gate

Walk these before committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The three that matter most:**

- [x] **RISK 1** — pgTAP proves parent, coach, `tenant_admin` and anon are all REFUSED,
      each inside an explicit transaction, and `COUNT(*) FROM tenants` is unchanged after
      the refusals. **Mutation-tested**: deleting the gate fails tests 1, 2, 3 and 5 — and
      5 failing proves the ungated function actually wrote rows. The route calls
      `provision_tenant` with the **caller's** token, and the missing `service_role` grant
      makes the alternative fail loudly.
- [x] **RISK 2** — the fault-injected invite failure (a malformed address, which passes
      the route's checks but Supabase rejects) left **zero** tenant rows; re-provisioning
      an already-invited admin returned 409 pointing at Resend.
- [x] **RISK 4** — Phase 0's metadata round-trip confirmed all four keys survive to
      `raw_user_meta_data`, `is_coach` true/false produces/omits the `coaches` row, and
      the driver signs the new admin in, landing on `/dashboard`.
      For the mobile leg, the provisioned admin's shape was compared against the SEED
      coach, who logs into the Expo app today: `{role: tenant_admin, has_tenant: true,
      has_coach_row: true, has_parent_row: false}` — **byte-identical**. Since
      `lib/landing.ts` routes on which extension rows exist rather than on the enum, mobile
      cannot distinguish them. That is the argument; an actual Expo run is still the
      belt-and-braces and has NOT been done.

**The rest:**

- [x] **RISK 3** — 263 tests, up from 244; nothing lost. `platform_overview.test.sql`
      unchanged and still passing. **See finding 1 above — this one nearly shipped.**
- [x] **RISK 5** — with no `RESEND_API_KEY` the UI shows the copyable-link warning, not a
      success toast (driver asserts it). `config.toml` edited and the stack restarted; the
      redirect now resolves to `/accept-invite`.
      **Still open: `RESEND_API_KEY` in the admin's Vercel project, and the production
      redirect allow-list in the Supabase dashboard.** Both are deploy-time.
- [x] **RISK 6** — the modal requires the email twice (driver asserts the refusal); the
      success panel echoes the address.
- [x] **RISK 7** — verified both ways against the running route: a `tenant_admin` still
      creates a coach (200), and a `platform_admin` now gets a 403 naming why instead of a
      500 from deep inside the trigger.
- [x] **RISK 8** — `游泳學校` yields a valid unique `tenant-xxxxxxxx` slug; punctuation
      collapses; a blank name is refused.
- [x] Both apps typecheck under the §7.11 stubbed condition.
- [x] `grep -rn "tenants_insert\|GRANT INSERT.*tenants" supabase/migrations/` returns
      nothing — the RPC is still the only door.

## Outstanding before this can ship

1. *(optional belt-and-braces)* Drive an `is_coach` provisioned admin through the Expo
   app. Argued closed above by shape-equivalence with the seed coach, not by a UI run.
2. **Deploy config:** `RESEND_API_KEY` into the admin's Vercel project; `/accept-invite`
   and `/reset-password` into the production Supabase redirect allow-list. Without the
   first, provisioning in production silently falls back to copy-the-link.
3. **Docs:** PRD §4.4, HANDOVER §8.9 + §7 gotchas, BACKLOG, LOCAL_DEV_GUIDE.
4. **Deploy** per the EXPAND order above — migrations first, push last.

## Graduating to HANDOVER §7

Two findings here outlive this task and belong in *Gotchas already hit*, which
`/session-start` mandates reading every session:

1. **`CREATE FUNCTION` grants EXECUTE to PUBLIC by default, which includes `anon`.** The
   sibling of §7.20 ("a new table does NOT inherit RLS"). Every `SECURITY DEFINER`
   function needs an explicit `REVOKE ... FROM PUBLIC`.
2. **A two-write provisioning flow with no transaction across it needs a compensating
   delete**, because the intermediate state (a joinable business with no operator) is
   worse than either endpoint.
