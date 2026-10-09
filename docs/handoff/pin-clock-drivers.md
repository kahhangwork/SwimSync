# Worktree — pin the clock for UI drivers (LANE 2)

**Branch:** feat/pin-clock-drivers · **Base:** main @ a0d49b3 · **Started:** 2026-10-09
**Plan:** docs/plans/PIN_DRIVER_CLOCK_PLAN.md · **Backlog:** Foundations → *Pin the clock for UI drivers* (L)

**Lane 1 (orchestrator):** root checkout, `main`. **Lane 1 agent name:** `lane1` [927a1a] · **Lane 2 agent name:** `lane2` [9f0c11] (ListAgents, 2026-10-09)
**Protocol:** plan § *Two lanes*. Lane 2 only REPLIES to lane 1 (`ACK` / `HELD` / `DONE` / `BLOCKED`).

## Shared database owner
**Lane 1.** Lane 2 does a DB-backed run (the fixture roundtrip ONLY) only between `RESUME` and the next `HOLD`,
and each one needs the user's click in lane 2's own terminal.

## I own
- `supabase/` — **NO** (the `api_clock_pin` migration is lane 1's, on `db/api-clock-pin` in the root)
- `.claude/skills/run-ui-playwright/drivers/lib.mjs` — **by explicit plan assignment** (helpers, wrapped `launch()`,
  shared `sql()`, both refusals). Lane 1 does not edit it.
- `.claude/skills/run-ui-playwright/drivers/run-all-drivers.sh` (`--now`)
- `.claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh` (`--now`, PGOPTIONS only)
- `.claude/skills/run-ui-playwright/drivers/check-driver-clock.sh` (new; all rules, red proofs, `UNSWEPT` ratchet)
- `scripts/clock-unpin.sh` (new)
- `.github/workflows/ci.yml` — only the steps for the two scripts above
- every `drivers/verify-*.mjs` and `drivers/fixtures-*.sql` (+ teardowns) — the sweep
- `drivers/_TEMPLATE.mjs`, `drivers/_TEMPLATE-fixture.sql`, the *Writing a new driver* section of
  `.claude/skills/run-ui-playwright/SKILL.md`
- `docs/handoff/pin-clock-drivers.md` at close

## I must NOT touch / never do
- A migration, `supabase/seed.sql`, `supabase/tests/**`, `supabase/functions/**` (engine is lane 1's)
- `main`, any push, prod, `supabase db reset`, ANY `run-all-drivers.sh` run (even `--only`), `supabase test db`,
  the Deno suite
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md`, `docs/GOTCHAS.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`,
  `docs/DEPLOYMENT.md` — lane 1 writes them
- `supabase/config.toml`, `lib/lessonDates.ts`, the three `attendanceCompleteness.ts` copies
- `SwimSyncApp/`, `SwimSyncAdmin/` source (no app files in any diff)

## Ports
None needed (lane 2 runs no dev servers). Lane 1 holds 3000 / 8081.

## Fixture prefix
`wt-pin-clock-drivers-` — for any row lane 2's own tests insert.

## To graduate at session close (from the ROOT checkout, on main)
- [lane 1] HANDOVER: `generate-invoices` on `main` is AHEAD of prod since `ba620c3` (engine reads app_now()) — do not
  deploy it from an unrelated change before plan deploy step 4 (Little Orcas Sep 2026 gate). Rollback = revert ba620c3.
- [lane 1] DEPLOYMENT: migration 20261009000200 on prod 2026-10-09 (user ran db push); app_now md5 679d6cd1…, ACL/owner
  unchanged, 0 API rows, 0 lock-1 rows, grant dump clean (no grant on private.clock_api_pin_enabled).
- [lane 1] pgTAP (b) is only indirectly falsifiable locally: postgres holds pg_read_all_data (noted in app_clock.test.sql).
- [lane 1] Known consequence RE-VERIFIED 2026-10-09: the Next server's clock reads are exactly the six
  `app/api/*/route.ts` banned_until checks. 12 other files without "use client" read `new Date()` but are
  client-imported (domain/dao/lib) and none is imported by a route, server page/layout or middleware; no "use server".
- [lane 1] HTTP engine proof: the seed tenant hits `earlier_month_unbilled` (2026-05) BEFORE the run-day guard, so the
  plan's "Today is day 1" message is unreachable on seed; the proof used billing_month (pinned 2026-07 vs real 2026-09).
- (add findings here as you hit them — gotcha → §7, consequence → the plan,
   unbuilt idea → BACKLOG, behaviour → PRD)
- **BACKLOG (fixture hygiene, §7.63-class):** `fixtures-trial-onboarding.sql` (setup) and its teardown both
  `DELETE FROM billing_runs WHERE tenant_id = <seed> AND billing_month = <last month>` — tenant+month scoped
  because `billing_runs` has no class axis, so they also delete a run the fixture did not create (the roundtrip
  saw `billing_runs -1` on 2026-10-09 after lane 1's HTTP engine proof left one). Not teardown-local to fix:
  needs a way to tell the driver's own runs apart (e.g. a marker the driver's Generate leaves, or snapshot the
  ids before the driver runs). Found T2, left per lane 1 (T3).
- **GOTCHA candidate:** `run-all-drivers.sh --only <driver>` never tears its fixture down (by design — the next
  reset is the cleanup), so the shared DB keeps that fixture's rows afterwards; the next
  `check-fixture-roundtrip.sh` then fails that fixture on a duplicate key (`users_pkey` d0…aa for
  attendance-guard) and its teardown silently cleans up. Hit twice on 2026-10-09 (T2, T3) — re-run = green.
- **GOTCHA candidate (pinned runs):** a fixture that backdates a REAL stamp from the real clock (`now() - 90 days`)
  while the app compares that stamp against a PINNED "today" (browser `todayInSg()`, `app_today()`) builds a world
  that never existed under a pin older than the backdate — 90-day-old grades read as fresh. Rule used in the sweep:
  backdate fixture data from the scenario's now (`app_now() - …`); keep the product's own stamp real. Hit in
  fixtures-assessment and fixtures-grading-admin (T5).
- **Finding (harmless today):** `tenants.created_at` is a real stamp (default `now()`) yet `markable_floor` reads it;
  under a past pin a tenant created "now" is in the pin's future. LEAST(window, created_at…) keeps the floor right,
  so no driver is affected — but a future rule that reads created_at directly would not be.
- **check-driver-clock.sh opt-out forms:** `// clock-real:` (JS), `-- clock-real:` (fixture), `/* clock-real: */`
  (inside a driver's SQL string — several sql() helpers collapse newlines, so `--` would eat the query). TESTING §5.
- **GOTCHA candidate (new, next §7.N — §7.340 covers zsh only):** macOS ships **bash 3.2**: `"${A[@]}"` on an EMPTY
  array is `unbound variable` under `set -u` (CI's bash 5 is fine, so CI stays green while the guard crashes on the
  dev machine), and there is no `mapfile` / `declare -A`. Expand optional arrays as `${A[@]+"${A[@]}"}`. Hit in
  check-driver-clock.sh the day the UNSWEPT lists could empty (fixed 173df14); found by a scratch-mirror run.
- **[done by lane 1 — §7.358]** a fake-docker red proof never executes the SQL: two shipped SQL bugs (clock-unpin.sh
  paren, lib.mjs `bool || text` = 'true' not 't'). Rule kept for the rest of lane 2: every new SQL string executed
  once on the real DB (driver writes inside rolled-back transactions); lane 2 DONEs 4–5 say so.
- **TESTING §5** (the driver clock, as built): `lib.mjs` exports `nowSg()` / `todaySg()` / `addDaysIso()` / `sql(q)` /
  `pinBrowser(ctx)` / `installDerivedClock(ctx, time)` / `PIN`; `launch()` returns a wrapped browser that pins every
  `newContext`/`newPage` and asserts browser `Date.now()` = pin; import refuses a half-pinned stack both ways. Every
  `verify-*.mjs` declares `// clock: pinnable` (70) or `// clock: own-literal` (3: edit-child, student-identity,
  tz-saturday — all in the runner's OWN_LITERAL_PROVEN). `check-driver-clock.sh` (CI, repo-invariants) has no
  ratchet: no marker = red. Canary 2026-10-10: no marker → exit 1 [M]; marker + `new Date()` → exit 1 [P1]; built
  from `_TEMPLATE.mjs` → exit 0. Guard red-proofs 39/39. `scripts/clock-unpin.sh` (and `--check`, read-only).
  `check-fixture-roundtrip.sh --now` (PGOPTIONS only) is the 2nd CI roundtrip step. New drivers: copy `_TEMPLATE.mjs`,
  run once pinned (`--only <name> --now …`) before the first commit (SKILL.md "Writing a new driver").
- **Plan / ARCHITECTURE consequence:** under `--now` the browser is NOT always at the pin. Own-literal drivers
  override it with their own literal instant; unmarked-lessons, bulk-setall, coach-marking, coach-remove-student and
  coach-schedule-roles set it via `installDerivedClock` to a moment DERIVED from the pinned DB (e.g. today 12:00 SGT,
  or the Wednesday after the fixture's missing Saturday) — so a pinned run equals the real-clock run on that day.
  Fixture data whose product column is written with `app_now()` (enrolled_at, unenrolled_at, requested_at,
  confirmed_at, deactivated_at) follows the pin; product stamps written with `NOW()` stay real, each marked.
- **ARCHITECTURE §10 (new files):** `drivers/check-driver-clock.sh`, `scripts/clock-unpin.sh`, `drivers/_TEMPLATE.mjs`,
  `drivers/_TEMPLATE-fixture.sql`.
- **[lane 1, T6 / plan item 8]** propose to the user (CLAUDE.md is theirs): "A UI driver reads the time only through
  `lib.mjs` (`nowSg`/`todaySg`); `check-driver-clock.sh` enforces it."
