# Engine reads the BUSINESS's run day — plan

_2026-09-24. BACKLOG: "The engine's automatic run-day guard reads the GLOBAL run day, not the business's"
(RISK 9 of §8.117). Must land before cron is enabled. Branch `fix/engine-tenant-run-day`, root checkout._
_`/plan-review` 2026-09-24 (Opus 5.5, high): 6 risks, 4 plan gaps; spot-checked `test-helpers.ts:734` and
`core.ts:305` — both held. Mitigations are inline below, marked ⚠._

## §0 Decisions (from /plan-with-confidence)

- **D1 — Engine only, 0 migrations.** The dead `app_settings.invoice_run_day` row is LEFT in place; a BACKLOG item
  is filed to drop it later in a contract migration.
- **D2 — No global fallback, and no DEFAULT fallback on an unreadable tenant row** (⚠ RISK 2). The column is
  `SMALLINT NOT NULL DEFAULT 7 CHECK (1..28)` (`20260718000500_tenants.sql:58`). `clampRunDay()` stays as a
  normaliser; it already maps null/undefined → 7, so no `?? DEFAULT` at the call site.
- **D3 — Ships bundled** with B (cancelled-lesson spinner) and C (hand-check drivers), gated by ONE nightly.
  **A merges to `main` FIRST and the engine deploys from `main`** (⚠ RISK 3).
- **D4 — Prod is a no-op.** Read 2026-09-24 by the user: all 3 tenants `invoice_run_day = 7`; global key = 7. Cron
  is off; manual runs ignore the run day.

## Context

- `core.ts:285-289` selects `auto_invoice_enabled, invoice_run_day, suspended_at` from `tenants` into `tenantRow`
  and **discards `error`**. `core.ts:305` already treats a null row as auto-ENABLED.
- `core.ts:378-385` (auto, non-forced) re-queries `app_settings.invoice_run_day`; `tenantRow.invoice_run_day` unused.
- The cron loop over tenants is `core.ts:188-193` (not `index.ts`).
- Admin readers already use `tenants.invoice_run_day` (`useBillingMonths.ts:65`, `useTenantBilling.ts:50`,
  `dashboard.repo.ts:110`); the card's `day >= runDay` (`lib/billingMonths.ts:178`) matches the engine's boundary.
  No runtime code outside the engine reads the global key.
- `newScenario()` gives each scenario its own tenant (`test-helpers.ts:307`), BUT `teardown()` also deletes
  `billing_periods` by MONTH across all tenants (`test-helpers.ts:734-735`), as do `core.test.ts:841/902`.
- `NON_ATTEMPT_STATUSES` (`runLog.ts:24`) is the one place a new early-return status joins.

## Steps

1. **Branch** `fix/engine-tenant-run-day` from `main` (`41f962e`). ✅ done.

2. **Failing tests first (§7.25) — TWO, opposite directions.**
   - **2a** *"run day: reads the BUSINESS's run day (later than global)"* — tenant `invoice_run_day = 15`, global
     untouched, `now = 2027-09-10T02:00:00Z` → expect `before_run_day`, no invoice, no seal.
   - **2b** *"run day: reads the BUSINESS's run day (earlier than global)"* — tenant `invoice_run_day = 3`,
     `now` = SGT day 5 → expect `invoices_created = 1`.
   > ⚠ RISK 1 MITIGATION — a vacuous pass. A single test passes on unfixed code if the shared global row is ever
   > left > 10 by a killed run. 2a + 2b together fail the old code for ANY global value.
   > - **STEP:** build each like test 2 (`core.test.ts:822`): `newScenario({enrolledAt: <month>-01})`, a Saturday
   >   session marked present, and `s.completeMonth(month, undefined, now)` — otherwise the test short-circuits on
   >   `incomplete_attendance` and never reaches the guard. Use distinct future months (e.g. 2027-08, 2027-09).
   > - **ASSERTION:** against unfixed code, 2a is RED with `invoices_created = 1` and 2b is RED with
   >   `before_run_day`. Record both outputs. Either one green on unfixed code = the test is wrong; stop.
   > - **ASSERTION:** every seal check is scoped `.eq("tenant_id", s.tenantId)`.

3. **Fix** the `core.ts` run-day guard: `clampRunDay(tenantRow.invoice_run_day)`; delete the `app_settings` query.
   Update comments: the guard block, the `core.ts:5` header, `dates.ts:44`, `core.test.ts:789`,
   `useTenantBilling.ts:83`.
   > ⚠ RISK 2 MITIGATION — fail CLOSED on an unreadable tenant row (early bill + seal = permanent underbill).
   > - **STEP:** destructure `error` from the `core.ts:285` query. In `mode === "auto"`, if `error || !tenantRow`,
   >   return a new non-attempt status `tenant_unreadable` (with the error message) BEFORE the auto switch; add it
   >   to `NON_ATTEMPT_STATUSES`. Manual mode is unchanged.
   > - **PROHIBITION:** do NOT fall back to a default run day, and do NOT `throw` — the cron loop
   >   (`core.ts:188`) has no per-tenant catch, so one throw stops every tenant's billing.
   > - **STEP:** a Deno test for it if the read can be forced to fail cheaply (e.g. a non-existent `tenant_id` in
   >   auto mode → `tenant_unreadable`, nothing written). Prove it fails without the change.

4. **Rewrite** test 4 (*"honours a changed setting, and SGT decides the day"*, `core.test.ts:869`) to set
   `tenants.invoice_run_day = 15` on the scenario's own tenant.
   > ⚠ RISK 4 MITIGATION — shared-DB leaks.
   > - **STEP:** its `finally` drops BOTH the `app_settings` restore and the month-wide `billing_periods` delete;
   >   `teardown()` already deletes the tenant's periods.
   > - **PROHIBITION:** no new or rewritten test writes to `app_settings`.
   > ⚠ RISK 6 MITIGATION — **ASSERTION:** the rewritten test 4 is RED against unfixed code (tenant 15, global 7 →
   > the early call bills). Record it.

5. **Verify:** `test.sh` **twice** (§7.15). Only while siblings are idle — `orderingGuard.test.ts:285` runs auto
   mode over EVERY tenant in the shared DB. B is code-only; C waits for the root's DB handover.
   > ⚠ RISK 4 — **ASSERTION** after run 2: `select count(*) from tenants where slug like 'test-%'` = **0**, and
   > `select value from app_settings where key='invoice_run_day'` = **7**.

6. **`/commit-review`**, commit.

7. **Merge, then deploy (via `/deploy`).**
   > ⚠ RISK 3 MITIGATION — deploy drift (prod running code that is not on `main`; the next deploy from `main`
   > silently reverts it).
   > - **STEP:** fast-forward A to `main` and push FIRST (no app dependency, so §7.60's order is satisfied), THEN
   >   `supabase functions deploy generate-invoices` from `main` HEAD. B and C merge after, and one nightly gates
   >   the bundle.
   > - **ASSERTION:** `supabase functions list` shows a new version / `updated_at` for `generate-invoices`, and
   >   the deployed source (`supabase functions download generate-invoices`) contains no
   >   `eq("key", "invoice_run_day")`.
   > - **PROHIBITION:** no auto-mode call against prod as a smoke test — it is day 24, past every run day, so a
   >   probe could really bill.

## Docs (from root at `/update-docs`)

> ⚠ RISK 5 MITIGATION — stale docs mislead whoever enables cron.
> - **STEP:** fix every one: `PRD.md` ~566 and ~1447 (incl. "global Automatic generation switch"),
>   `INVOICE_RUNBOOK.md:37`, `docs/ARCHITECTURE.md:65-67` ("the run-day seam is GLOBAL") and `:732`,
>   `supabase/cloud/cron_schedule.sql:28`. Leave applied migrations alone (`tenant_rls.sql:483`).
> - **ASSERTION:** `grep -rn "app_settings.invoice_run_day" --exclude-dir=migrations .` shows only history and the
>   BACKLOG drop item.

- BACKLOG: remove the run-day item; file "drop the dead `app_settings.invoice_run_day` row (contract migration)".
- GOTCHAS (new): moving a setting from a global row to a per-tenant row, a read that swallows its `error` turns
  "could not read" into "the default" — on a billing schedule that is early billing + a seal. Fail closed.

## Pre-commit gate

**Highest value — each is a blocker, not a caveat:**
- [ ] 2a AND 2b both RED on unfixed code, outputs recorded (RISK 1)
- [ ] Unreadable tenant row in auto → `tenant_unreadable`, no default, no throw (RISK 2)
- [ ] `test.sh` green twice; leak assertions 0 / 7 hold (§7.15, RISK 4)

**Also:**
- [ ] Rewritten test 4 RED on unfixed code (RISK 6)
- [ ] No test writes `app_settings`; seal checks tenant-scoped (RISK 1, 4)
- [ ] `tenant_unreadable` added to `NON_ATTEMPT_STATUSES`; `runLog.test.ts` still green
- [ ] Deploy only after A is on `main`; deployed source verified (RISK 3)

## Stage log

- **Built 2026-09-24** (code while C held the DB; proofs after C released it).
- **Proof of failure (§7.25), `main`'s `core.ts` swapped in:** 2a, 2b, the unreadable test and rewritten test 4 all
  RED; the 3 untouched run-day tests green. Fix restored from a scratch copy.
- **`test.sh` ×2:** 250/250 both runs; after the `/commit-review` fix, **251/251 both runs**. Leak checks:
  `test-%` tenants **0**, global run day **7**, 2028-05/06 periods **0**.
- **`/commit-review` finding (High):** `shouldRetryTenantEmails` let `tenant_unreadable` through — an unreadable
  tenant may be SUSPENDED, and RISK 3 of the email-retry plan forbids emailing for one. Now skipped; unit test
  proven RED first. Not caught by `/plan-review`: the email retry pass runs on EVERY per-tenant status, so a new
  status must be checked against `shouldRetryTenantEmails` as well as `NON_ATTEMPT_STATUSES`.
- **RISK 5 docs done in the same commit:** PRD ×2, INVOICE_RUNBOOK, ARCHITECTURE ×2, `cron_schedule.sql`;
  grep shows only history + the BACKLOG drop item.
