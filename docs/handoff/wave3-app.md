# Worktree — Wave 3 lane 2 (parent-app money render tests + D5 fix)

**Branch:** test/wave3-app, fix/child-balances-per-business · **Base:** main @ 74c882c · **Started:** 2026-10-05
**Plan:** docs/plans/WAVE3_RENDER_TESTS_PLAN.md (Lane 2) · **Backlog:** Current build order → Wave 3 item 5

## I own
- `supabase/` — **NO**
- `SwimSyncApp/features/child-profile/**` (tests + the D5 fix only)
- `SwimSyncApp/features/parent-home/**` (tests only — home card stays family-wide, D5)

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root checkout at close (lane 1)
- `docs/plans/WAVE3_RENDER_TESTS_PLAN.md` — lane 1 only
- `SwimSyncAdmin/**`, `supabase/**` — lane 1 / nobody
- `drivers/lib.mjs`, `supabase/config.toml` — shared
- `lib/lessonDates.ts`, the three copies of `attendanceCompleteness.ts`
- The root checkout's git state (lane 1 is on `test/wave3-admin`) — no `git -C <root> …`

## Database
Not owned. Only contact: `fixtures-app-money.sql` applied + torn down in 2.2 step 6 (announced first). Never `db reset`.

## Fixture prefix
`fixtures-app-money.sql` (existing fixture; teardown `fixtures-app-money-teardown.sql`).

## To graduate at session close (from the ROOT checkout, on main)
- **PRD (D5 behaviour change):** "The child card shows what the family owes, and the credit it holds, at THIS
  child's business" — siblings at the same business included (invoices are per parent); the home card stays
  family-wide across every business. Pinned by `useChildProfile.test.ts`.
- **Gotcha candidate:** the Wave 2 `mutate.sh` checks `grep -qF "$want"` over the whole jest output, but jest
  lists PASSING test names too (`✓ name`), so a red caused by a different test still prints "RED as required".
  Require the name in the failure header: `grep -F "● " out | grep -qF "› $want"`. Self-tested: a wrong-test red
  is now rejected. (Lane 1's vitest copy tightened the same way.)
- **Gotcha candidate:** RNTL `getByText(x).parent` is not the host View — composite wrappers sit between.
  Walk host ancestors (`typeof node.type === "string"`) to scope `within(<box>)`.
  `react-test-renderer` has no types here: use `ReturnType<typeof screen.getByText>`.
- **Gotcha candidate (plan #1, confirmed):** PostgREST embed filter `parent_tenant_balances.tenant_id=eq.X`
  narrows only the embedded rows; the `parents` row still returns, so `.single()` is safe at 0 balance rows.
- **Probe output (2.2 step 6, 2026-10-05):** invoices @child tenant HTTP 200 `[{"net_amount":88.00}]` = SQL 88.00;
  @other tenant HTTP 200 `[]`; credit @child tenant HTTP 200 `7.25`; @other tenant HTTP 200 `[]`; unfiltered
  (pre-fix) read `7.25 + 99.00`. Teardown: parent 0, tenant 0, balance rows 0.
- **Deploy record (2.3, 2026-10-05):** fix `5ce45bc` pushed to main = app deploy. Nightly gate WAIVED by the
  user (confirmed directly in lane 2's session; nothing dispatched). Prod counts via `scripts/prod-query-ro.sh`
  (lane 1, user-approved): balance rows at >1 tenant 0, outstanding at >1 tenant 0, children at >1 tenant 0,
  outstanding invoices 0, credit rows > 0 0 → no visible change today. Bundle literal
  `parent_tenant_balances.tenant_id`: 0 hits in `entry-f9f93451…` before → 1 in `entry-bc4c10fb…` after
  (control `parent_tenant_balances(credit_balance)` 2 → 2); Vercel Production deployment SHA = `5ce45bc`.
- **Lane 2 commits on main:** `adbd429` (MoneySummary + BalancesCard render tests), `864a6a8` (useParentHome
  family-wide), `5ce45bc` (D5 fix + harness + hook + dao chain tests), `4e4e06d` (useChildProfile other paths).
  jest 642 → 666; 30 mutation proofs, all RED via mutate.sh.
- **BACKLOG:** Wave 3 item 5 — parent balances part DONE (both cards + D5); strike-through text from lane 1.
- **TESTING §5:** parent balances render/hook tests exist; the dao chain-recorder pattern is new for the app
  (`features/child-profile/dao/childProfile.repo.test.ts`).
