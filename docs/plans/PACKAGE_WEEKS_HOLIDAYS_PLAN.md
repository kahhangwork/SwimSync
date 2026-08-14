# Plan — weeks-based packages, per-purchase start/end dates, public-holiday auto-extension, manual extension

_Status: BUILT on the local stack, 2026-08-15 — all four phases (migrations
`20260814000400`–`20260815000300`), engine re-anchor, both apps, and tests. Verified:
pgTAP 1001 (only the pre-existing `coach_disable` date-flake red, which fails on clean
`main` too), Deno packages ×2, admin vitest 368, app jest 363, both typechecks. NOT yet
committed or deployed. Two findings to graduate to `docs/GOTCHAS.md` §7 at `/update-docs`:
(1) a SECURITY DEFINER function's `current_user` is always the owner, so the service-vs-client
seam is `auth.uid() IS NULL`, never `current_user`; (2) §7.115 bit again — `package_live_balances`
was re-derived from the ORIGINAL migration, silently reverting the make-up-category version
from `20260802000400`; always read the LIVE body via `pg_get_functiondef`. Deferred: a Phase C
Playwright driver (loud/ack UI is covered by vitest+jest+pgTAP; register one in the nightly later)._
_Settled with the user via `/plan-with-confidence` on 2026-08-14._
_Risk-reviewed via `/plan-review` on 2026-08-14 — mitigations are inlined under the steps
they govern, marked `⚠ RISK n`, ranked 1 (most product risk) → 7 (least). Walk the
pre-commit gate at the bottom before every phase's commit._

## What we're building

Prepaid packages sold in **weeks** (not months), with an explicit **start date** per
purchase (smart-defaulted from the parent's current coverage), an **end date that
auto-extends** by one week per holiday-affected week, made **loud with an Acknowledge
flow** on both the parent app and the admin panel, plus an **admin manual extend**.

Packages stay **per-parent** (one package covers all a parent's children in its
category, drawn down FIFO). This was a deliberate decision — see "Decisions" below.

## Decisions (locked with the user)

1. **Granularity: per-parent, unchanged.** No per-child packages. The "start for each
   kid" framing is served by the per-purchase start date + a default that accounts for
   how fast multiple kids deplete a package.
2. **Default start date = `min(forecast-exhaustion, effective-expiry) + 1 day`** of the
   parent's current coverage. Forecast-exhaustion simulates weekly draws from the
   parent's covered children's **current active enrolments**; with no enrolments, use
   the expiry date only. Computed at sale-form open, editable by the admin.
3. **Holiday calendar: admin-maintained per business**, plus a **CSV import** accepting
   the data.gov.sg format (`date,day,holiday` — we read `date` + `holiday`), with a
   **link to the data.gov.sg download page** next to the import button.
4. **PH extension recomputes live** (kids change class days mid-package; kids may not be
   enrolled at sale time). Extension is counted **per affected week** — each distinct
   week in the window with ≥1 holiday-hit lesson adds 7 days. This solves the "two
   classes both on a holiday in one week" edge case (→ +1 week, not +2) and self-scales
   to any number of kids/classes.
5. **Loud + Acknowledge.** Loud badge on both apps when the extension exceeds what that
   role acknowledged; Acknowledge sets it equal (quiet permanent note remains). A later
   holiday bump goes loud again. Parent and admin ack **independently**; admin gets
   **Acknowledge all**. **No email** in v1 — in-app only.
6. **Manual extend = days/weeks + reason + audit**, stacked on top of any holiday
   extension (not an absolute end-date override).

## The spine — one end-date formula, decided once

```
nominal_end   = start_date + validity_weeks × 7
effective end = nominal_end + (ph_extension_weeks × 7) + manual_extension_days
```

`parent_packages.expires_on` becomes this **effective** end, recomputed live, so the
billing engine and every card keep reading one field. The money/lesson balance
(`value_remaining`) is untouched — this feature is purely the **date axis**.

**Loud/ack rule:** a role sees the loud badge when
`ph_extension_weeks > ph_ack_weeks_<role>`. Ack sets `ph_ack_weeks_<role> =
ph_extension_weeks`.

## Schema changes

- `package_products`: `validity_months` → **`validity_weeks`** (INTEGER, CHECK > 0).
  Update `pin_package_product_terms()` (immutable-terms trigger). Convert existing rows
  `validity_weeks = round(validity_months × 52 / 12)`.

  > **⚠ RISK 3 MITIGATION — expand/contract, and the conversion may only ever LENGTHEN a
  > sold package, never shorten it.**
  > - **Do NOT rename the column.** `validity_months` is read by the deployed admin
  >   packages page (`SwimSyncAdmin/app/(admin)/packages/page.tsx`) and the parent billing
  >   screen (`SwimSyncApp/app/(parent)/billing/index.tsx`); migrations land first (§7.60),
  >   so a rename breaks both LIVE apps until the app deploy. Sequence: (1) ADD
  >   `validity_weeks` + backfill + make both triggers pin BOTH columns, all in one
  >   migration; (2) apps read/write `validity_weeks`; (3) drop `validity_months` in a
  >   LATER migration only after both apps are confirmed deployed. Three steps, three
  >   commits — one schema change in flight (§7.55).
  > - The `round()` on **products** is forward-facing only (fresh sales) — acceptable. The
  >   backfill on **parent_packages** (see below) must NOT use the product formula.
  > - Both trigger updates (`pin_package_product_terms`, `enforce_parent_package_lifecycle`)
  >   ship **in the same migration** as the column add — a trigger referencing a column
  >   state that doesn't exist makes every product/package UPDATE error in prod.
  > - Assertion: pgTAP proves `UPDATE package_products SET validity_weeks = …` on an
  >   existing product is rejected by the pin trigger (test fails before the trigger
  >   change, passes after — §7.25).
- `parent_packages`:
  - add **`start_date DATE`** (admin-set; the FIFO window start and the nominal-end anchor)
  - snapshot **`validity_weeks`** (replaces `validity_months`)
  - add `ph_extension_weeks INTEGER NOT NULL DEFAULT 0`
  - add `manual_extension_days INTEGER NOT NULL DEFAULT 0`
  - add `ph_ack_weeks_parent INTEGER NOT NULL DEFAULT 0`, `ph_ack_weeks_admin INTEGER NOT NULL DEFAULT 0`
  - `expires_on` = the effective formula above (written by the recompute path, never by clients)
  - Update `enforce_parent_package_lifecycle()`: allow the admin to set `start_date` at
    sale/confirm; keep `value_remaining` and the money-terms immutable; the new
    extension/ack fields move only via SECURITY DEFINER RPCs.

  > **⚠ RISK 1 MITIGATION — the new columns are parent-writable until the trigger pins
  > them. This is free money/time.** `parent_packages_update` RLS allows
  > `parent_id = current_parent_id()`, and the lifecycle trigger only pins the columns it
  > names — so without new pin clauses, any parent can PostgREST-update their own row to
  > `manual_extension_days = 365` or pre-ack nothing was announced. Structural fix, in the
  > SAME migration that adds the columns (never a later one):
  > - In `enforce_parent_package_lifecycle()`'s UPDATE branch, when
  >   `current_user = 'authenticated'`, reject any change to `ph_extension_weeks`,
  >   `manual_extension_days`, `ph_ack_weeks_parent`, `ph_ack_weeks_admin`, `start_date`,
  >   or `validity_weeks` — same seam as `value_remaining` (definer RPCs arrive as
  >   postgres and pass). The ack RPCs are the ONLY writers of the ack columns, including
  >   for admins: an admin's direct ack-column UPDATE is rejected too.
  > - **`start_date` is immutable once status = 'active'** (settable while pending / at the
  >   confirm transition only, by admin/service). Moving it later re-scopes the FIFO
  >   window over months already billed — a silent repricing lever. A wrong start date on
  >   an active package is fixed by cancel + resell, mirroring the product-terms rule.
  > - Assertions (pgTAP, each proven to fail without the trigger clause — §7.25): parent
  >   UPDATE of each new column → `check_violation`; admin UPDATE of `start_date` on an
  >   ACTIVE package → `check_violation`; admin direct UPDATE of an ack column →
  >   `check_violation`.
  > - **Graduate to `docs/GOTCHAS.md` §7 when built**: "a new `parent_packages` column is
  >   parent-writable by default — the UPDATE policy is row-scoped, not column-scoped;
  >   every money-adjacent column must be named in the lifecycle trigger's pin list."

  > **⚠ RISK 2 MITIGATION (schema half) — re-anchoring `confirmed_at` → `start_date` must
  > be a provable no-op for every existing package.**
  > - Backfill in the same migration:
  >   `start_date = (confirmed_at AT TIME ZONE 'Asia/Singapore')::date` for every row
  >   that has `confirmed_at` — exactly the value the engine computes today at
  >   `core.ts:1146`, so the window of every existing package is bit-identical before and
  >   after. Do NOT backfill from `requested_at` or `NOW()`.
  > - Backfill `parent_packages.validity_weeks` **from the row's own dates**, never the
  >   product formula: `ceil((expires_on - start_date) / 7.0)`. `round(months × 52/12)`
  >   shortens a 1-month package to 28 days — an existing family's paid-for expiry must
  >   never move EARLIER (real-money regression); `ceil` can only lengthen by ≤6 days.
  > - Extend the active-row CHECK: `status <> 'active' OR (confirmed_at IS NOT NULL AND
  >   expires_on IS NOT NULL AND start_date IS NOT NULL)` — a NULL `start_date` on an
  >   active package must be impossible, not merely unexpected, because the engine and
  >   `package_live_balances()` will both anchor on it.
  > - Update `package_live_balances()` to read `start_date` (not SGT-of-`confirmed_at`)
  >   in the same migration, keeping FIFO order `(expires_on, confirmed_at, id)`
  >   unchanged. The engine and this function must re-anchor **in the same phase** or the
  >   §7.18 pin test goes red in prod.
  > - Assertion: immediately after `supabase db reset` + migration, run
  >   `SELECT count(*) FROM parent_packages WHERE confirmed_at IS NOT NULL AND
  >   (start_date IS DISTINCT FROM (confirmed_at AT TIME ZONE 'Asia/Singapore')::date)`
  >   → must be 0. Record the number in the commit message.
- New **`tenant_public_holidays`** (id, tenant_id, holiday_date DATE, name TEXT,
  created_at). UNIQUE (tenant_id, holiday_date). RLS: admin write; parents/coach read
  (card shows the holiday reason). Grants to match.
- New **`package_extension_events`** (id, parent_package_id, kind `holiday|manual`,
  delta_days INTEGER, reason TEXT, holiday_name TEXT NULL, created_by, created_at) —
  audit + the source of the "+1 wk: CNY" card breakdown.

  > **⚠ RISK 5 MITIGATION (tables half) — grants follow policies exactly (§7.87).**
  > - `tenant_public_holidays`: SELECT policy for admin + `parent_in_tenant` +
  >   coach-in-tenant; write policy `can_admin_tenant` only. GRANT `SELECT, INSERT,
  >   UPDATE, DELETE … TO authenticated` is legal here because a policy covers each verb;
  >   `GRANT ALL … TO service_role`.
  > - `package_extension_events`: SELECT policy scoped through `parent_packages` (admin /
  >   owning parent), **GRANT SELECT only to authenticated** — writes arrive exclusively
  >   via the definer RPCs (as postgres). Do NOT grant INSERT to `authenticated`;
  >   `table_grants.test.sql` goes red on any privilege no policy permits, and the audit
  >   trail must not be client-forgeable. No UPDATE/DELETE policy or grant: append-only.
  > - Assertion: `supabase test db` green, including `table_grants.test.sql`, in the same
  >   commit as each new table.
  > - After each phase's cloud deploy: **take the remote grant dump** (§7.39, §7.89,
  >   DEPLOYMENT §11.7) — local and cloud grants disagree by construction.

## Delivery — 4 shippable phases (backend-first each, §7.60)

Each phase: migration lands on `main` alone first (one schema change in flight, §7.55),
then the app. PRD §7.16 + BACKLOG updated in each phase's commit (user-facing change).

### Phase A — weeks + start date + smart default (~1 day)
1. Migration: product `validity_weeks`; `parent_packages.start_date` + `validity_weeks`;
   effective-end plumbing with `ph_extension_weeks = 0` (no PH yet).
   > **⚠ RISK 1 + RISK 2 + RISK 3 MITIGATIONS apply to this migration** — the trigger pin
   > list for the new columns, the `start_date`/`validity_weeks` backfills, the extended
   > active-row CHECK, the `package_live_balances()` re-anchor, and expand-not-rename for
   > `validity_months` are all specified inline in "Schema changes" above. They land HERE,
   > in this one migration, not as follow-ups.
2. Engine (`core.ts`): package window reads `start_date` and effective `expires_on`
   instead of `confirmed_at` / months (today at `core.ts:1146-1147`).
   > **⚠ RISK 2 MITIGATION (engine half) — the deploy gap must be behaviour-free.**
   > Between the migration applying and `supabase functions deploy generate-invoices`,
   > the live engine still anchors on `confirmed_at`. The backfill makes
   > `start_date = SGT(confirmed_at)` for every existing row, so the two anchors agree —
   > **provided no package with a non-default `start_date` exists yet**. Therefore:
   > - Deploy order within Phase A is migration → engine deploy (confirmed via
   >   `supabase functions list`, never assumed) → admin UI push to `main`. The Start-date
   >   form field (step 4) is what creates divergent rows, so it ships LAST.
   > - Do NOT change the FIFO sort keys — keep `(expires_on, confirmed_at, id)` in both
   >   the engine query and `package_live_balances()`. Re-anchoring the WINDOW is this
   >   phase; reordering the QUEUE is not.
   > - Named prohibition: the engine keeps reading the stored `expires_on` column. Do NOT
   >   re-derive the effective end in TypeScript — one field, one writer, or the §7.18
   >   pin breaks silently later when extensions exist.
3. RPC `suggest_package_start(parent, product)` = the default-start formula (Decision 2).
   > **⚠ RISK 7 MITIGATION — wrong-but-harmless must stay harmless.** The default is
   > editable, so correctness is soft, but availability and dates are not:
   > - Compute entirely in SQL over `DATE`s with `(now() AT TIME ZONE
   >   'Asia/Singapore')::date` as "today" — never a client-side
   >   `toISOString().split('T')[0]` (§7.7).
   > - Fail-open in the sale form: if the RPC errors or returns NULL (parent has no
   >   coverage, no enrolments), pre-fill today-in-SGT and let the admin type — the RPC
   >   must never block a sale.
   > - `GRANT EXECUTE … TO authenticated` in its own migration (§7.87) — it is callable
   >   by nobody until granted; SECURITY INVOKER is sufficient (reads only rows the admin
   >   can already see).
4. UI: "Months valid" → **"Weeks valid"**; sale + confirm forms get a **Start date**
   field pre-filled from the RPC, editable.
5. Tests: pgTAP (`lesson_packages.test.sql`) + Deno ×2 (`packages.test.ts`) + vitest.
   > **⚠ RISK 2 MITIGATION (proof) — assertions with pass/fail values:**
   > - The existing Deno pin test (engine allocation vs `package_live_balances()`) passes
   >   with BOTH re-anchored — and a new case: package with `start_date` AFTER
   >   `SGT(confirmed_at)` must NOT fund a lesson dated between confirm and start (both
   >   sides agree it's uncovered; the lesson bills ad-hoc).
   > - Run the Deno suite **twice back-to-back** (§7.15); both runs green. Record
   >   test counts before/after: N pgTAP + N Deno before, must be ≥ before after.

### Phase B — holiday calendar + CSV import (~½–1 day)
1. Migration: `tenant_public_holidays` + RLS + grants.
2. Admin page (Settings → Holidays): list/add/delete; **CSV import** (data.gov.sg
   `date,day,holiday`; reads date+holiday; dedupes on date); **data.gov.sg link**.
   > **⚠ RISK 6 MITIGATION (input half) — holiday dates are strings end-to-end.** Parse
   > the CSV `date` column as a literal `YYYY-MM-DD` string and pass it through to the
   > DATE column untouched. Named prohibition: never construct `new Date(csvDate)` and
   > re-format it — a UTC round-trip shifts the holiday a day in SGT (§7.7). Reject rows
   > that don't match `^\d{4}-\d{2}-\d{2}$` with a per-row error, not a silent skip of
   > the whole file. If import upserts on `(tenant_id, holiday_date)`, remember §7.57:
   > any BEFORE INSERT trigger added later also fires for upsert-updates.
3. Tests: pgTAP + vitest (CSV parse + dedupe).

### Phase C — live PH extension + loud/acknowledge (~1.5–2 days)
1. `recompute_package_extensions()` (SECURITY DEFINER): counts distinct weeks in
   `[start_date, nominal_end)` where ≥1 scheduled lesson (covered kids' current enrolled
   class weekdays) lands on a tenant holiday; writes `ph_extension_weeks`, effective
   `expires_on`, and audit events. Called on holiday import/edit, enrolment change, the
   nightly sweep, and an on-load RPC.
   > **⚠ RISK 4 MITIGATION — the recompute must be convergent, idempotent, and unable to
   > touch settled money.** Structural rules, each with a test:
   > - **No cascade, structurally:** the counting window is `[start_date, nominal_end)`
   >   where `nominal_end = start_date + validity_weeks × 7` — computed from those two
   >   columns ONLY. Named prohibition: the recompute never reads `expires_on` as an
   >   input, so a holiday in the extended tail cannot add a week that adds a week. pgTAP:
   >   holiday placed inside the extension tail → `ph_extension_weeks` unchanged.
   > - **Idempotent, including audit:** running twice with no input change writes nothing
   >   — emit a `holiday` event only when the newly computed `ph_extension_weeks` differs
   >   from the stored value (delta event, signed). pgTAP: call twice, event count
   >   identical after the second call.
   > - **Shrink is allowed but clamped and visible:** deleting a holiday may reduce
   >   `ph_extension_weeks`; write the negative delta event, and clamp
   >   `ph_ack_weeks_<role> = LEAST(ph_ack_weeks_<role>, ph_extension_weeks)` so a later
   >   re-bump goes loud again instead of hiding under a stale high-water ack.
   > - **Settled money is unreachable by construction — verify, don't assume:** an
   >   invoiced lesson has an `invoice_items` row, which excludes it from both the
   >   engine's pending set and `package_live_balances()`; moving `expires_on` therefore
   >   cannot reprice a billed line or reopen a sealed month. Deno assertion pinning
   >   this: bill a month, seal it, then import a holiday that extends the package —
   >   re-run the engine → `already_exists`/sealed skips, no invoice or item row
   >   changes, `value_remaining` unchanged.
   > - **Recompute-then-bill ordering:** `expires_on` moving later can flip FIFO order
   >   between two of a parent's packages (it's the primary sort key). That is accepted —
   >   both the engine and `package_live_balances()` read the same stored column so they
   >   flip together; the Deno pin test must include a two-package case where a holiday
   >   extension reorders them.
   > - **Week counting in SQL over DATEs (RISK 6):** the week bucket is
   >   `date_trunc('week', lesson_date)` on DATE values (ISO Monday weeks) — no
   >   timestamps, no client clocks, no `getDay()`/`toISOString` anywhere in the path
   >   (§7.7). "Scheduled lesson" = enrolment's class weekday matched by
   >   `EXTRACT(ISODOW FROM holiday_date)`, all in SQL. pgTAP fixed-date cases: two
   >   classes both holiday-hit in one week → +1 week not +2; a Dec-29→Jan-4 week
   >   spanning the year boundary counts once; a kid with no enrolments → 0.
   > **⚠ RISK 5 MITIGATION (RPC half):** `recompute_package_extensions()` is DEFINER and
   > therefore bypasses RLS — its first statement scopes the target set itself: callable
   > shapes are (a) service/nightly = all tenants, (b) authenticated = only packages
   > where `can_admin_tenant(tenant_id)` OR `parent_id = current_parent_id()` (the
   > on-load path; it's deterministic and write-idempotent so a parent triggering it is
   > safe). `REVOKE EXECUTE FROM public` then `GRANT EXECUTE TO authenticated,
   > service_role` in the same migration (§7.87).
2. Loud badge on parent app + admin panel; `acknowledge_package_extension(pkg)` +
   admin `acknowledge_all_extensions()`.
   > **⚠ RISK 5 MITIGATION (ack RPCs):** both are SECURITY DEFINER, so authorization is
   > internal, not RLS: `acknowledge_package_extension` writes `ph_ack_weeks_parent` only
   > when `parent_id = current_parent_id()`, `ph_ack_weeks_admin` only when
   > `can_admin_tenant(tenant_id)` — a caller who is neither gets an exception, and a
   > parent can never move the admin's ack or vice versa. `acknowledge_all_extensions()`
   > filters `can_admin_tenant(tenant_id)` in its UPDATE's WHERE, never trusting a
   > client-supplied tenant id. pgTAP: parent acks another parent's package → error;
   > admin of tenant A acks tenant B's package → 0 rows moved. Grants per §7.87. RN-web:
   > the badge/ack flow must not use `Alert.alert` (silent no-op on web) — inline card UI.
3. Tests: pgTAP + Deno ×2 (extension moves the billing window) + vitest + jest + a UI driver.
   > **⚠ RISK 4 assertion:** the Deno case that matters most — a lesson dated INSIDE the
   > extension tail (after nominal_end, on/before effective `expires_on`) is funded by the
   > package, and the same lesson with the extension absent bills ad-hoc. Run twice
   > (§7.15).

### Phase D — manual extend + audit (~½ day)
1. RPC `extend_package(pkg, days, reason)` → `manual_extension_days += days`, audit
   event; admin-only.
   > **⚠ RISK 5 MITIGATION (extend RPC):** SECURITY DEFINER = RLS is bypassed, so the
   > function itself enforces: package exists AND `can_admin_tenant(that package's
   > tenant_id)` (looked up server-side — never a tenant id parameter), status =
   > 'active', `days > 0` and bounded (CHECK ≤ 365 — fat-finger ceiling), reason
   > non-empty. Negative `days` is rejected: shortening a paid-for package is cancel +
   > resell territory, not an extend with a minus sign. pgTAP: parent calls it → error;
   > admin of another tenant → error; days = 0 / negative / 9999 → error; each proven to
   > fail without the guard (§7.25). Grant per §7.87.
2. UI: Extend control on the package card (amount + reason); card shows manual vs
   holiday breakdown.
3. Tests: pgTAP + vitest.

## Total: ~4–5 focused days, 4 independent slices (A is useful on its own).

## Pre-commit gate — walk before EVERY phase's commit

Highest value first; the top three are the real-money ones.

- [ ] **R1** Every new `parent_packages` column added this phase is named in the
      lifecycle trigger's authenticated-DML pin list, and a pgTAP test proves a parent's
      direct UPDATE of it fails (test shown failing without the clause first).
- [ ] **R2** (Phase A) Post-migration probe returns 0 rows where
      `start_date ≠ SGT(confirmed_at)` for confirmed packages; engine deployed and
      confirmed via `supabase functions list` BEFORE the Start-date form ships; the
      engine↔`package_live_balances()` Deno pin test is green **twice back-to-back**.
- [ ] **R3** No migration in this phase renames or drops `validity_months` while a
      deployed app still reads it; `parent_packages.validity_weeks` was backfilled with
      `ceil` from the row's own dates — no existing package's effective expiry moved
      earlier (probe: 0 rows where new effective end < old `expires_on`).
- [ ] **R4** (Phase C) Recompute reads only `start_date` + `validity_weeks` — grep it for
      `expires_on` as an input: none; tail-holiday pgTAP case green; double-call emits no
      second audit event; sealed-month Deno case shows zero invoice mutation.
- [ ] **R5** Every new table/RPC this phase has its GRANT in its own migration, DEFINER
      RPCs check tenant/parent internally, `table_grants.test.sql` green — and after the
      cloud deploy, the **remote grant dump** is taken (§11.7).
- [ ] **R6** `grep` the phase's diff for `toISOString`, `getDay(`, `new Date(` applied to
      a bare date string in any package/holiday path: no hits — all date math is SQL over
      DATE.
- [ ] Deno suite run **twice**; pgTAP + vitest/jest counts recorded (before ≤ after).

**Graduate to `docs/GOTCHAS.md` §7 at `/update-docs`:** the R1 lesson (new
`parent_packages` columns are parent-writable until pinned — row-scoped UPDATE policy,
column-scoped trigger) and the R4 no-cascade rule (extension recompute must never read
its own output field).
