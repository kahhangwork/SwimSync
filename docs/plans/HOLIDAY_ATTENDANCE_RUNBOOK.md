# Holiday attendance — deploy runbook

Event-driven public-holiday package extension. Replaces the calendar-scan
`recompute_package_extensions`. **Dormant on prod** (0 packages, 0 holidays), so
there is no backfill — but the ORDER is load-bearing: dropping the retired weeks
columns before the apps stop reading them 400s the live Packages and Billing pages
(§7.60, hit twice before).

Branch: `feat/holiday-attendance`. All local suites green: pgTAP 1179, Deno 229 ×2,
admin vitest 447, app jest 387, both typechecks.

## Migrations (in this order — one in flight at a time, §7.55)

| # | File | What |
|---|---|---|
| 1 | `20260818000400_attendance_status_holiday.sql` | enum value `holiday` (standalone) |
| 2 | `20260818000500_tenant_holiday_extension_days.sql` | `tenants.holiday_extension_days` (default 7) |
| 3 | `20260818000600_package_holiday_days_formula.sql` | `parent_packages.holiday_extension_days`; `package_effective_end` weeks→days (DROP+CREATE+GRANT); lifecycle trigger + `extend_package` updated; **recompute neutered** — keeps `ph_extension_weeks`/`ph_ack_weeks_*` |
| 4 | `20260818000700_holiday_reconcile.sql` | state table + resolver + 3 reconcile triggers + RLS |
| 5 | `20260818000800_holiday_admin_guard.sql` | admin-only guard (set/clear/delete) |
| 6 | `20260818000900_mark_day_holiday.sql` | `mark_day_holiday` / `unmark_day_holiday` RPCs |
| 7 | `20260818001000_holiday_late_buyer.sql` | reconcile on package activation |
| C | `20260818001100_holiday_contract.sql` | **CONTRACT — runs LAST**: drop recompute + acknowledge_* + `ph_extension_weeks`/`ph_ack_weeks_*`; recreate lifecycle trigger without them |

## Deploy sequence

1. **RISK-7 prod dry-run** — confirm prod still holds 0 packages / 0 holidays
   (`SELECT count(*) FROM parent_packages; SELECT count(*) FROM tenant_public_holidays;`).
2. **`supabase db push`** migrations **1–7** (NOT the contract C yet). `supabase migration
   list --linked` — every one shows `remote` filled (the pgdelta stack trace is normal output,
   not proof).
3. **Grant dump** after 4/5/6 (new tables + RPCs) — `table_grants.test.sql` green, no
   privilege a policy doesn't permit (§7.39/§7.89).
4. **Engine deploy** — `supabase functions deploy generate-invoices`. `core.ts` no longer
   calls recompute; grep the served bundle for a new-build string (§7.31).
5. **Apps to `main`** — Vercel builds both. Coach read-only `holiday`, holiday excluded from the
   coach save payload; admin Holidays page "Void lessons"/"Un-void" + the extension-days setting;
   packages/billing read `holiday_extension_days` (NOT the weeks columns); parent attendance shows
   "Public Holiday".
6. **GATE, then contract migration C** — grep the DEPLOYED bundles for `ph_extension_weeks`
   and `recompute_package_extensions`: **zero hits or C does not run**. Then push C.
7. **Grant dump** again; confirm `supabase migration list --linked` shows C `remote` filled.

## Rollback

`supabase/rollback/20260818_holiday_attendance_DOWN.sql` — dormant-safe teardown
(neutralizes any holiday rows → `cancelled_coach`, drops the new objects, re-adds the
weeks columns, restores `package_effective_end` weeks form), then re-apply migrations
`20260815000700` / `…300` / `…200` from git to restore the pre-feature bodies. Rehearse
the deepest rollback locally before deploy (§7.93).

## Product behaviour (for PRD/GOTCHAS at /update-docs)

- **Only a tenant admin** sets a holiday (DB-guarded, bidirectional + delete). Coach sees it read-only.
- **`mark_day_holiday(tenant, date)`** voids every scheduled lesson that day (enrolled + trial/make-up
  guests): non-billable (no charge, no package draw) AND extends each covering package by
  `holiday_extension_days`, deduped per (package, date). `unmark_day_holiday` reverses it and deletes
  emptied sessions.
- **Coverage** uses the package's NOMINAL window (no cascade); reversal reads the stored `applied_days`,
  never the live setting.
- A billed `present→holiday` auto-credits **cash** at the package rate and does NOT restore
  `value_remaining` (existing credit-note trigger; value-equivalent). CN001 refusal rolls the RPC back.

## Deferred (not blocking)

- **Playwright driver** for the void-a-day flow (nightly sweep). The behaviour is covered by pgTAP
  (`holiday_day_rpc`, `package_holiday_extension`, `holiday_admin_guard`, `holiday_late_buyer`) and
  Deno; the driver is UI-regression insurance.
- **Partial-payment accounting** for a voided-credit reopen (already a BACKLOG item, dormant on 0 notes).
