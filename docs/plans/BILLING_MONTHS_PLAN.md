# Billing months card + generation run log — plan

_Written 2026-09-22 via `/plan-with-confidence`. Reviewed the same day via `/plan-review` (Fable 5.1:
11 findings; 5 spot-checked against the code, 4 held and 1 partly corrected, see R4). Each
mitigation sits under the step it governs, marked **⚠ RISK n**. Closes the BACKLOG item **"The admin
cannot see WHY a generation run failed, or what held the month open"** (raised 2026-09-17)._

## 1. The problem

1. **No way to see which months are closed.** `billing_periods` records every sealed month. Only
   the owner-only Accounting page shows it. Co-admins *can* read the table (`billing_periods_select`
   is `is_tenant_admin`), but no page of theirs does.
2. **No record of a generation run exists.** The reason a month stayed open is shown once, in
   `genResult`, and it is gone on reload. `audit_log` has no row. The only evidence is the Supabase
   function log, which the admin cannot open.

## 2. Decisions (settled with the user, 2026-09-22)

| # | Decision |
|---|---|
| D1 | **Where the card goes:** a **Billing months** card on the Invoices page, directly above the Generate panel. The Dashboard gets a **one-line alert** only. |
| D2 | **Row cap:** every month that needs attention is **always** shown. Only the **newest 3 closed** months are shown. The rest go behind **"Show all N months"**. |
| D3 | **Freshness:** the reason is a **snapshot of the last run**, labelled *"as of last run, 14 Sep 09:49"*. It is not recomputed live, so the engine stays the only copy of the billing rules. |
| D4 | **Actions:** an open month's row opens the **existing** Unclaimed modal / blocked-lessons modal, and sets the month picker to that month. |
| D5 | **Dashboard alert audience:** all tenant admins (owner + co-admins). |
| D6 | **A month nobody has run:** shows a neutral *Not run yet* until the tenant's run day. After that it shows amber *Not billed yet* and counts toward the Dashboard alert. |
| D7 | **Run history:** the latest run shows inline. Expanding a month lists its **newest 5** runs. |

## 3. Month states (the whole display rule)

Computed per month, in this order of precedence:

| State | When | Needs attention? |
|---|---|---|
| **Closed** | a `billing_periods` row exists | no |
| **Open** | not sealed, and a run row exists for it **or** invoices exist for it | **yes** |
| **Not billed yet** | *either* the latest billable month with no run, no invoices, and SGT day-of-month ≥ run day, *or* **any month named as `earlier_unbilled_month` by a run** (⚠ RISK 7) | **yes** |
| **Not run yet** | the latest billable month, no run, no invoices, before the run day | no |
| *(not shown)* | any other month with no run, no seal, no invoices | — gaps are ordinary (`markable_floor`) |

- **Latest billable month** = the previous month in SGT (`todayInSg()`). The current month is never
  shown: it cannot be billed until it ends (the completed-month guard).
- **An open month with invoices but no run row** is August 2026 today, because its runs predate this
  feature. It shows as *"Open — reason not recorded (run before 22 Sep). Generate again to see
  why."*
- **Reason text for Open** comes from the latest run row, choosing the first match:
  1. `sealed === true` (but there is no period row) → *"reopened after sealing — generate again"* (⚠ RISK 8)
  2. `incomplete_attendance` → *"N lessons unmarked"*
  3. `unclaimed_billable > 0` → *"N lessons have no parent to bill"*
  4. `earlier_month_unbilled` → *"bill YYYY-MM first"*, and that month gets its own row (⚠ RISK 7)
  5. `nothing_to_bill` → *"no lessons recorded"*
  6. `error` → *"last run failed: <text>"*
  7. **anything else → the raw `status`, amber.** This is the fail-safe: an unrecognised status never renders as a green tick.

> **⚠ RISK 7 — an earlier unbilled month the card hides.** Without the promotion above, month M says
> "bill 2026-07 first" while July, having no run and no invoices, is *(not shown)*. The admin would
> be told to bill an invisible month. The promotion is structural: `deriveBillingMonths` adds the row,
> so the renderer cannot forget it. **ASSERTION (vitest):** given
> `runs=[{billing_month:'2026-08', status:'earlier_month_unbilled', earlier_unbilled_month:'2026-07'}]`,
> **2** visible rows, and July reads *Not billed yet*.

> **⚠ RISK 8 — a month reopened by hand reads as a contradiction.** INVOICE_RUNBOOK's documented unseal
> (delete the `billing_periods` row) leaves a latest run with `sealed: true` and status
> `complete — billing month sealed`. The raw-status fail-safe would print *"Open — complete — billing
> month sealed"*. **ASSERTION (vitest):** a sealed run with no period row gives the reason
> *"reopened after sealing — generate again"*.

## 4. Data — migration `db/billing-runs` (root checkout, lands on `main` first)

`supabase/migrations/2026092200xxxx_billing_runs.sql`:

```sql
CREATE TABLE billing_runs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,  -- ⚠ RISK 5
  billing_month             CHAR(7) NOT NULL,
  ran_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ran_by                    UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- ⚠ RISK 2; NULL = cron or deleted admin
  mode                      TEXT,
  status                    TEXT NOT NULL,                  -- engine status, or 'error'
  sealed                    BOOLEAN NOT NULL DEFAULT false,
  invoices_created          INTEGER NOT NULL DEFAULT 0,
  classes_still_incomplete  INTEGER,
  unclaimed_billable        INTEGER,
  earlier_unbilled_month    CHAR(7),
  blocking                  JSONB,     -- BlockingLesson[]
  unclaimed_students        JSONB,     -- UnclaimedStudent[]
  message                   TEXT,
  error                     TEXT       -- ⚠ RISK 11: message only, ≤ 500 chars
);
CREATE INDEX billing_runs_tenant_month ON billing_runs (tenant_id, billing_month, ran_at DESC);
ALTER TABLE billing_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_runs_select ON billing_runs FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_tenant_admin(tenant_id));
GRANT SELECT ON public.billing_runs TO authenticated;          -- §7.87: the grant matching the policy
GRANT SELECT, INSERT ON public.billing_runs TO service_role;    -- ⚠ RISK 1: NOT inherited, see below
```

> **⚠ RISK 1 MITIGATION — the most dangerous finding. Without it the feature ships as a silent no-op.**
> `20260814000300_service_role_default_privileges.sql:84` runs `REVOKE ALL ON TABLES FROM service_role`
> as a *default*. **A new table grants the engine nothing.** The first draft of this plan said "confirm
> default privileges cover it". That was **factually wrong**. `table_grants.test.sql` deliberately
> excludes service_role, and `recordRuns` is best-effort (it never throws), so the insert would fail
> silently in every environment.
> - **STEP:** the explicit `GRANT SELECT, INSERT … TO service_role` above.
> - **ASSERTION (pgTAP):** `has_table_privilege('service_role','public.billing_runs','INSERT')` = **true**,
>   and `…'UPDATE'` / `…'DELETE'` = **false**.
> - **ASSERTION (Deno, §5):** after a run, the row **exists** in the table. A returned billing result is not enough.
> - **STEP (post-deploy, §8):** the remote grant dump shows `service_role=ar` on `billing_runs`.

> **⚠ RISK 2 MITIGATION — a plain FK onto `profiles` makes a co-admin undeletable.** `delete-admin`
> deletes the auth user and relies on the `auth.users → profiles` cascade (its header, route.ts:10-13,
> warns about exactly this). A co-admin who ever pressed Generate would block the cascade.
> - **PROHIBITION:** no FK onto `profiles(id)` in this migration without `ON DELETE SET NULL`.
> - **ASSERTION (pgTAP):** deleting a profile that owns a `billing_runs` row succeeds, and `ran_by IS NULL` afterwards.

- **No INSERT/UPDATE/DELETE for `authenticated`.** Only the engine writes. `table_grants.test.sql` must stay green.
- **`results` and `created` are NOT stored.** They are large, and the invoices table already holds the outcome.
- **Retention: none needed** once RISK 3's skip list is in place: about 1–5 rows per tenant per month.
- **Rollback:** `supabase/rollback/…_billing_runs_down.sql` (`DROP TABLE`), rehearsed.
- **pgTAP `billing_runs.test.sql`**, alongside the RISK 1/2 assertions:
  - an owner and a co-admin each read their own tenant's rows
  - neither reads another tenant's rows
  - a parent and a coach read nothing
  - `authenticated` cannot insert

## 5. Engine — `supabase/functions/generate-invoices/`

1. **New `runLog.ts`:**
   - `toRunRows(result, opts)` is pure. It returns one row per tenant (`result.per_tenant ?? [result]`), skips entries without a `tenant_id`, and copies only the §4 columns.
   - `recordRuns(supabase, rows)` does the insert. It is **best-effort: it never throws**, and it logs on failure.

   > **⚠ RISK 3 PROHIBITION — record ATTEMPTS, not refusals to attempt.** `toRunRows` returns **zero
   > rows** for `before_run_day`, `auto_disabled`, `tenant_suspended`, `month_not_ended` and
   > `already_complete`. Otherwise, once cron is on, every daily tick writes a `before_run_day` row per
   > tenant. The month would show amber *"Open — before_run_day"* from the 1st, D6's *Not run yet*
   > would never appear, and the daily rows would push real runs past the read cap.
   > - **Structural:** the skip set is a single exported `const NON_ATTEMPT_STATUSES` in `runLog.ts`, so a new early-return status has one place to join.
   > - **ASSERTION (Deno):** each of the five statuses → `toRunRows(...).length === 0`, and a blocked result gives exactly 1 row.

2. **`index.ts`:**
   - Call `recordRuns` right after `generateInvoices` returns, **before** the emails, so a slow email step can't lose the record. The row therefore exists even when the client saw `Error:` from a timeout; the route has no `maxDuration`.
   - In the `catch`, when `opts.tenant_id && opts.billing_month`, write one `status: 'error'` row.
   - A cron-wide crash with no tenant writes nothing. Cron is off, and the function log still covers it.

   > **⚠ RISK 11 STEP:** the `error` column stores `(e as Error).message.slice(0, 500)`. **PROHIBITION:** never a
   > stack, never the raw error object. Co-admins read this column.

3. **`ran_by`:** `app/api/generate-invoices/route.ts` adds `requested_by: user.id` to the body. The engine trusts it only because the caller already holds `CRON_SECRET`.
4. **The failure mode to guard:** a failed insert must never fail or roll back billing. The invoices have already committed by then. **ASSERTION (Deno):** with the insert forced to fail, `generateInvoices` + `recordRuns` still returns the billing result, and the invoices exist.
5. **Deno tests (`runLog.test.ts`):**
   - `toRunRows` for each status shape (blocked, unclaimed-open, sealed, nothing_to_bill, per_tenant), plus the RISK 3 skip list
   - an integration test: `generateInvoices` then `recordRuns` writes a row whose `unclaimed_students` names the child (RISK 1)

   > **⚠ RISK 5 STEP — the new FK breaks the suite's teardown.** `test-helpers.ts` `teardown()` deletes the
   > scenario tenant (~line 747). A leftover `billing_runs` row makes that an FK error: the tenant leaks,
   > and the second `test.sh` run executes against leaked state (§7.15).
   > - **BUILT STRUCTURALLY (step 1, 2026-09-22):** `billing_runs.tenant_id … ON DELETE CASCADE`. The teardown runs
   >   as service_role, which holds no DELETE on the log (append-only, RISK 1), so an explicit delete was impossible.
   >   The cascade makes the tenant delete clean up after itself. **No teardown change is needed for scenario tenants.**
   > - **STEP:** runs written against the SEED tenant (a cron-wide `generateInvoices` with no `tenant_id`) are not
   >   cascaded. Check whether any Deno test does that; if one does, name it in `test-helpers.ts`.
   > - **ASSERTION:** `test.sh` green **twice**, and afterwards `select count(*) from billing_runs where tenant_id not in (select id from tenants)` = **0**.

## 6. Admin app — `SwimSyncAdmin/`

1. **`lib/billingMonths.ts` (pure, vitest):**
   - `deriveBillingMonths({ periods, runs, invoiceMonths, latestBillableMonth, todaySg, runDay })` returns rows with `state`, `reason`, `asOf`, `latestRun`, and `recentRuns` (≤ 5). It includes the RISK 7 promotion and the RISK 8 reason.
   - `visibleMonths(rows)` returns every needs-attention row plus the newest 3 closed rows, and a `hiddenCount`.
   - Dates come from `todayInSg()` and the lexical `YYYY-MM` strings only. No `new Date().toISOString()` (§7.7).
   - Display uses `formatSgStamp` (§7.229).

   > **⚠ RISK 9 — two run days disagree.** The card reads `tenants.invoice_run_day` (what the Invoices page
   > edits). The engine's auto guard still reads the GLOBAL `app_settings.invoice_run_day` (core.ts:375-380),
   > and never reads the tenant column it selects. That is display-only while cron is off.
   > - **STEP:** add a BACKLOG item: *"the engine's run-day guard must read `tenants.invoice_run_day`"*. It must land before cron is enabled.
   > - **PROHIBITION:** do not fix the engine in this build. It is a behaviour change to billing timing, and it needs its own branch.

2. **Invoices page:**
   - Add `dao/` reads, all scoped by `tenantId`:
     - `billing_periods`
     - `billing_runs`, ordered `ran_at desc`, limit 200
     - invoice months (see RISK 10)
   - Add `domain/useBillingMonths.ts` and `ui/BillingMonthsCard.tsx`, placed directly above `<GenerationPanel>`.
   - Reload the card in `afterGenerate`, after a settlement, **and after a generate error**. After a client timeout, the card then shows what the server actually did.

   > **⚠ RISK 10 STEP — PostgREST caps a read at 1,000 rows** (`supabase/config.toml` `max_rows`). A plain
   > `select('billing_month')` on `invoices` silently drops months once a tenant passes 1,000 invoices.
   > Read `billing_month` **ordered desc** with `.gte('billing_month', <24 months ago>)`. The card never
   > needs older months: a month that old is either sealed or already visible via a run row.
   > **ASSERTION (vitest):** an open month with invoices but no run row stays visible at 20 closed months.

3. **Row actions (D4):**
   - Clicking a month calls `generate.setGenMonth(month)`.
   - **Unclaimed (n)** calls `unclaimed.setUnclaimed(latestRun.unclaimed_students)`.
   - **Unmarked (n)** calls `generate.setBlockedLessons(latestRun.blocking)`.
   - Setting the month first keeps the modal's success message consistent. It is not a correctness dependency: `handleSettle` takes `settled_through` from `u.latest_session_date`.
   - Confirm the stored jsonb matches `UnclaimedStudent` / `BlockingLesson` in `invoices/types.ts` field-for-field, and type the dao read as those types.

   > **⚠ RISK 6 STEP — a stale snapshot must not drive a money action.** The stored `unclaimed_students` can
   > name a child whose parent has since registered. `handleSettle` inserts a settlement with no "still
   > unclaimed" check. Billing stays correct (the engine applies settlements only to parentless
   > attendance), but a `paid_outside` S$ row would be recorded for a child who will also be invoiced,
   > double-counting revenue.
   > - **STEP:** before opening the Unclaimed modal from a stored run, one `dao` read filters out any student who now has a `parent_students` row.
   > - If that leaves none, the button is replaced with *"Generate again to refresh"*.
   > - **ASSERTION (vitest on the filter):** a stored student who now has a parent is excluded, and 0 remaining shows the refresh copy.

4. **Dashboard:**
   - Add `ui/BillingAlert.tsx` using the same lib and the same reads. It renders only when at least one month needs attention.
   - Wording: *"August 2026 is still open — 1 lesson has no parent to bill → Invoices"*.
   - Hidden for a platform admin with no tenant.
5. **Tests:** vitest for the lib, covering:
   - the cap never hides an open month, even at 20 closed months
   - the run-day flip for D6 (at 07:59 SGT on the run day, and on the run day itself)
   - the pre-feature August case
   - RISK 6, 7, 8 and 10 as above
   - the fail-safe reason for an unknown status
   - month ordering

   Each test must be proven to fail against a deliberately broken rule (§7.25).
6. `npm run typecheck` in `SwimSyncAdmin`.

## 7. UI verification

- **Extend `verify-trial-onboarding.mjs`.** It already produces an unclaimed-open month for the seed tenant. Assert:
  - the card shows that month as **Open** with the child's name and an *"as of"* stamp
  - **Unclaimed** opens the modal
- Check the driver goes red without the card.

> **⚠ RISK 4 PROHIBITION — the driver never re-generates after settling.** A re-generate would seal the seed
> tenant's previous month and invoice seed students. The fixture's load-bearing assertion is *"the driver
> does NOT seal"* (`fixtures-trial-onboarding-teardown.sql:84-86`). The teardown does remove the seal,
> but not invoices for seed students it did not create (§7.63). **Closed** is covered by vitest (§6.5)
> and the Deno sealed-shape test instead. _(Correction to the review: it claimed the teardown never touches
> `billing_periods`. It does, at line 88. The prohibition stands for the invoices.)_
> - **STEP:** the teardown also runs `DELETE FROM billing_runs WHERE tenant_id = v_tenant AND billing_month = to_char(v_month,'YYYY-MM')`.
> - **STEP:** add `billing_runs` to whatever `check-fixture-roundtrip.sh` counts.
> - **ASSERTION:** `check-fixture-roundtrip.sh` is green, with the `billing_runs` count equal before and after.

- **Hand-check:** the Dashboard alert appears and disappears; "Show all" expands and collapses.
- Before the run, start Expo **without `CI=1`** (§7.253), and grep the served admin bundle for "Billing months".

## 8. Sequence and gates

1. **Branch `db/billing-runs` (root checkout):**
   - migration + rollback + pgTAP (including the RISK 1 and RISK 2 assertions)
   - `supabase db reset` → `supabase test db` green
2. **GATE:** nightly `35738235448` green (read the log). Then:
   - merge `db/billing-runs` → `main` and apply to prod (`/deploy`)
   - take a **remote grant dump** (§7.39). **⚠ RISK 1 ASSERTION:** `billing_runs` shows `service_role=ar` and `authenticated=r`, nothing more.
3. **Branch `feature/billing-months`:** engine (§5) and apps (§6–§7). Run Deno twice, vitest, jest, typecheck, the driver, the fixture round-trip, and `/commit-review`.
4. **`supabase functions deploy generate-invoices`**, then `supabase functions list`.
5. **Prod smoke test:** after the engine deploy, click Generate on August once. **ASSERTION:** exactly one new `billing_runs` row for August, with `unclaimed_students` naming the child. If it is missing, RISK 1 was not fixed: stop and do not push the apps.
6. **Merge to `main` last** (the app deploy). Then grep the live admin bundle for "Billing months" (§7.31).
7. **`/update-docs`:**
   - PRD (Invoices page + Dashboard)
   - BACKLOG: strike the item, and add the RISK 9 item
   - `INVOICE_RUNBOOK.md` ("check the Billing months card")
   - GOTCHAS: graduate the 4 durable findings (§9)

## 9. Graduate to `docs/GOTCHAS.md` (at `/update-docs`, next free numbers)

1. **A new table an Edge Function writes needs an explicit `GRANT … TO service_role`.** This has been true since `20260814000300` revoked the default. `table_grants.test.sql` does not cover service_role, so a best-effort write fails silently. (RISK 1)
2. **Any FK onto `profiles(id)` needs `ON DELETE SET NULL`/`CASCADE`, or `delete-admin` breaks.** (RISK 2)
3. **The engine's early-return statuses are refusals to attempt, not attempts.** Any run log or metric must skip them, or cron floods it. (RISK 3)
4. **Adding a table with an FK onto `tenants` means updating the Deno `teardown()` in the same commit.** Otherwise the second `test.sh` run executes on leaked state. (RISK 5)

## 10. Out of scope

- Live recompute of the reason (refused in D3).
- Backfilling the 14 Sep August runs. No record of them exists.
- Any override on the seal or attendance guards (CLAUDE.md, *never*).
- Fixing the engine's run-day source (RISK 9: its own branch).
- **Closing August itself.** That is data work, independent of this build, and **due before 1 Oct**. Doing it *after* step 5's prod smoke test gives the first real run row for free.

**Estimate:** about 1.5 working days (up from 1–1.5 after review).
- migration + pgTAP: ~2.5 h
- engine + Deno: ~2.5 h
- admin app + vitest: ~5 h
- driver + deploy + docs: ~2 h

## 11. Pre-commit gate

**The three that matter most. Each blocks the commit if it cannot be ticked:**
- [ ] **RISK 1:** pgTAP `service_role` INSERT = true, **and** a Deno test proves the row exists, **and** the prod grant dump shows `service_role=ar`
- [ ] **RISK 3:** `toRunRows` returns 0 rows for all five non-attempt statuses
- [ ] **RISK 5:** `test.sh` green twice, with 0 orphan `billing_runs` rows

**The rest:**
- [ ] RISK 2: deleting a profile with a run row succeeds, and `ran_by` becomes NULL
- [ ] RISK 4: the driver does not re-generate; the teardown deletes `billing_runs`; the round-trip is green
- [ ] RISK 6: stale unclaimed students are filtered before the modal opens
- [ ] RISK 7: the earlier-unbilled month is promoted into a visible row
- [ ] RISK 8: a reopened month has its own reason
- [ ] RISK 9: BACKLOG item added; engine untouched
- [ ] RISK 10: the invoice-month read is ordered and bounded
- [ ] RISK 11: `error` is truncated, with no stack
- [ ] Every new test proven to fail with its rule broken (§7.25)
