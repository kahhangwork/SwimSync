# Pin the clock for UI drivers — replay any moment, end to end

_Status: DONE 2026-10-10 except step 5 (§8.144). Migration on prod (deploy #80); engine v35 on prod (deploy #81) —
deployed before Little Orcas' Sep 2026 run by the user's explicit call, after a green nightly. Step 5's proof waits for
the next real Generate. BACKLOG item removed._

## What this builds, and why

`run-all-drivers.sh --now '2026-10-01 07:59+08'` (or `--only <driver> --now …`) runs the UI drivers **at that moment**:
the browser, Postgres through the API, the drivers' own SQL, the fixtures and the billing engine all agree it is
that moment. Without `--now`, everything runs on the real clock exactly as today, so the nightly is unchanged.

Why: the drivers are the last tests that run on whatever day CI happens to run. A §7.304-class collision (247 of 730
real days) or §7.302-class label drift is found only on the day it fires, and a red nightly cannot be replayed the
next morning. After this, the day a nightly goes red is the `--now` you rerun it with.

## Decisions settled with the user (2026-10-09) — do not reopen

| # | Decision | Answer |
|---|---|---|
| D1 | Scope | **Option C, full**: browser + DB via the API + the billing engine |
| D2 | Which day do drivers run on | **Real day by default + a replay flag.** No fixed date, and no hazard-day CI job |
| D3 | How the engine learns the time | **Ask the DB**: the engine reads `app_now()` over RPC instead of `new Date()`. One clock |
| D4 | Sweep | **All date-reading drivers and fixtures in this effort.** A driver not yet converted **refuses** `--now`; it never runs half-pinned |

## Facts this rests on (verified 2026-10-09, local stack; ✱ = verified by plan-review)

- `app_now()` (`20261006000300`) returns `now()` on its **first** line when `swimsync.now` is unset. That is the prod
  path, and this plan keeps it first and unchanged. Owner `postgres`, `SECURITY DEFINER`, `STABLE` ✱.
- **Lock 2** = `IF session_user = 'authenticator' THEN RETURN now()`. PostgREST and the edge functions log in as
  `authenticator`, so today no API request can be pinned. ARCHITECTURE §6af states "the engine and the UI drivers
  always run on the real clock" — this plan changes that sentence (DoD).
- Fixtures (`run-all-drivers.sh` `psql_file`) and the drivers' `sql()` helpers (25 drivers use the same
  `docker exec … psql -U postgres` shape) open a **new psql session as `postgres`** per call. `lib.mjs` is the only
  shared driver module (73 drivers import it, nothing else) ✱.
- ✱ **`postgres` CANNOT set the carrier.** PG 17.6: `ALTER DATABASE postgres SET swimsync.now = …` as `postgres` →
  `ERROR: permission denied to set parameter "swimsync.now"` (custom placeholder, non-superuser). `supabase_admin`
  logs in via `docker exec … psql -U supabase_admin` and IS a superuser. `postgres` IS a member of
  `pg_signal_backend`. The DB already carries database-level settings (`app.settings.jwt_*`).
- ✱ `app_clock.test.sql` is clock-free and asserts the UNPINNED path (`#2: app_now() = now()`) with no pin of its
  own, so a database-level default pin turns it red. Its frozen census counts `now()` tokens **inside `prosrc`,
  comments included**, and holds `('app_now', 2)`.
- ✱ G2 (`scripts/check-migration-clock.sh`, CUTOFF `20261006000500`) scans every newer migration for raw `now()`; a
  re-bodied `app_now()` carries two `RETURN now()` lines and will be flagged unless each carries `-- clock-real:`
  (§7.354 — on `main`, after prod already has it, unfixable).
- ✱ No pg_cron locally (`cron.job` absent). **No pg_cron on prod either** (`cron.job` does not exist, checked
  2026-10-09 via `prod-query-ro.sh`) — billing is manual-only (HANDOVER §9 "STAY MANUAL"), so the engine runs only
  when an admin presses Generate. `handle_new_user` (the only `auth.users` trigger) reads no app clock.
- ✱ Node parses `"2026-10-01 07:59+08"` but **`"2026-10-01T07:59+08"` is Invalid Date**, while Postgres accepts both.
  PostgREST's `"…T…​.123456+00:00"` parses in V8 (truncated to ms).
- The Next server's only clock reads are six `banned_until` checks in `app/api/*/route.ts`, which don't depend on the
  date. **Clock 2 is out of scope**, as recorded in *Known consequences*.
- The engine: `core.ts:180,227` use `opts.now instanceof Date ? opts.now : new Date()`. A JSON body can never set it.
  The admin route always passes `billing_month`, so under a pin `now` only feeds the month-not-ended guard, the
  earlier-month guard, the completeness clamp, the run-day guard and the (unused) cron default. ✱ For an unscoped run
  (no `tenant_id`) `toErrorRows` records nothing: a throw is visible only in function logs. ✱ `index.ts` calls
  `Deno.serve` at module top level (not importable by a test); `test.sh` lists test files explicitly.
- `seed.sql` contains no dates and no clock reads. 40 of 46 fixtures read `now()` / `CURRENT_DATE` / `today_sg()`
  (✱ only ONE code line uses `CURRENT_DATE`: `fixtures-assessment.sql:160`; the other 12 hits are comments).
  28 drivers read `new Date()`/`Date.now()`. 8 already call `clock.install`.
- `jwt_expiry = 3600`. Column defaults: `enrolled_at` / `requested_at` default `app_now()`; `staff_invitations.expires_at`
  = `now() + 15 min` (REAL-TIME, §6af); `created_at` etc. are real `now()` stamps ✱.

## Step 0 — prove the carrier BEFORE writing any migration (session 1, ~30 min)

Nothing below this step is authored until it passes. Run it as a **bash script file** in the scratchpad (§7.340 — zsh
does not word-split), on the root checkout, with **no sibling worktree running** (`git worktree list` shows only the
root; it changes database-level state on the shared DB).

> ⚠ RISK 4 MITIGATION — each line is a pass/fail assertion; record the outputs in the session log.
> - S0.1 `docker exec $DB psql -U supabase_admin -d postgres -c "ALTER DATABASE postgres SET swimsync.now = '2026-09-30T23:59:00Z'"`
>   succeeds. (As `postgres` it is refused — already proven; do not retry it.)
> - S0.2 A NEW `psql -U postgres` session: `SELECT app_now() = '2026-09-30T23:59:00Z'::timestamptz` → `t`; and
>   `SELECT set_config('swimsync.now','2026-09-15 10:00+08',true), app_now() = '2026-09-15 10:00+08'::timestamptz` →
>   `t` (pgTAP's per-transaction pin still overrides a database-level default).
> - S0.3 A NEW login as `authenticator` (the `app_clock_locks.sh` shape): `SELECT current_setting('swimsync.now', true)`
>   = the pin (the database-level default reaches API sessions).
> - S0.4 `docker restart supabase_rest_<project>` then `docker restart supabase_kong_<project>` (§7.44 — a restarted
>   upstream may change IP) → `wait_for_auth` passes and every `authenticator` row in `pg_stat_activity` has
>   `backend_start` later than the restart. (Proves a fresh PostgREST pool; `pg_terminate_backend` is NOT used — a
>   pool can hold dead connections that fail a later request at random.)
> - S0.5 `ALTER DATABASE postgres RESET swimsync.now` as `supabase_admin` → a new session reads
>   `coalesce(current_setting('swimsync.now', true), '') = ''`.
> - S0.6 Record (not pass/fail) whether `supabase db reset` preserves a database-level pin: set it, reset, read
>   `pg_db_role_setting`; then RESET, reset again, `supabase test db` green. Write the answer into the GOTCHA.
> - **Pass = S0.1–S0.5 all true.** If S0.1 fails as `supabase_admin` too → **STOP and re-plan with the user.**
> - ⛔ **Do NOT** fix a refused carrier with a migration (`GRANT SET ON PARAMETER`, `ALTER ROLE … SET`, a seed
>   change): migrations and seed shapes reach prod / CI, and §6af forbids a second switch. The carrier is local
>   tooling only.

## Design

### The pin's carriers: one GUC, set two ways, both local-only

- **The runner (owns the DB exclusively; already resets per driver):** `ALTER DATABASE postgres SET swimsync.now`
  **as `supabase_admin` via `docker exec`** gives every new session the pin as its default: fixtures, driver `sql()`,
  PostgREST's fresh pool, and the engine's RPCs (through PostgREST). It is **one GUC**: no second clock GUC (§6af).
- **The fixture roundtrip (shared-DB-safe by contract):** `PGOPTIONS='-c swimsync.now=<canonical pin>'` on its own
  `docker exec -e PGOPTIONS=… psql` calls. Session-scoped: nothing database-level is written, so a sibling worktree
  and pgTAP never see it.

> ⚠ RISK 6 MITIGATION — named prohibition: **no tool other than `run-all-drivers.sh --now` and
> `scripts/clock-unpin.sh` writes a database-level `swimsync.now`.** `check-fixture-roundtrip.sh --now` uses
> `PGOPTIONS` only; assertion: `grep -n "ALTER DATABASE" .claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh`
> returns nothing.

> ⚠ RISK 7 MITIGATION — **the pin is canonicalised by Postgres, once, in the runner**:
> `SELECT to_char('<input>'::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` (RAISEs on an offset-less
> input via §7.337's regex, re-checked in the runner). Only that `…Z` string is passed to `ALTER DATABASE`,
> `PGOPTIONS`, `DRIVER_NOW` and the engine proof — Node never parses a user-typed pin (`"…T07:59+08"` is Invalid
> Date in V8).

### Lock 2, relaxed for local only: a second private row

New migration `…_api_clock_pin.sql` (root checkout, `db/api-clock-pin` branch — never in a worktree):

```sql
CREATE TABLE private.clock_api_pin_enabled (enabled boolean PRIMARY KEY CHECK (enabled));
REVOKE ALL ON TABLE private.clock_api_pin_enabled FROM PUBLIC, anon, authenticated, service_role;
-- app_now(): the lock-2 line changes, and the two RETURN now() lines gain G2 markers.
--   IF session_user = 'authenticator' THEN RETURN now(); END IF;
-- becomes
--   IF session_user = 'authenticator'
--      AND NOT EXISTS (SELECT 1 FROM private.clock_api_pin_enabled) THEN RETURN now(); END IF;  -- clock-real: <why>
```

- **Prod is identical by construction, three times over.** (1) Nothing on prod sets `swimsync.now`, so line 1 returns
  `now()` before any table is read, at **no added cost**. (2) Even if it were set, the API row is absent. (3) Even if
  both were present, lock 1 (`clock_override_enabled`, seed-only) still RAISEs. Lock 1 is checked **after** the new
  line, so an API row without the lock-1 row is loud, not silent.
- **The API row is NOT in `seed.sql`.** Only the runner inserts it, and only for the length of a `--now` run. A plain
  local stack still refuses API pins, which keeps `app_clock_locks.sh` checks 1–3 meaningful.
- Signature, volatility, `SECURITY DEFINER`, `search_path`, owner and ACL are untouched. The body comes from
  `pg_get_functiondef` of the live function (§7.40, §7.336). The frozen census in `app_clock.test.sql` must stay
  green unchanged.
- Rollback: `supabase/rollback/…_api_clock_pin_DOWN.sql` restores the old body. It **keeps** the table (§7.335).
- The public schema doesn't change, so no type regen is needed. Run `scripts/check-db-types.sh` anyway (§7.350).

> ⚠ RISK 2 MITIGATION — steps and assertions, in order:
> 1. **Capture BEFORE, local AND prod:** `md5(pg_get_functiondef('public.app_now'::regproc))`, `proowner::regrole`,
>    `proacl`, `provolatile`, `prosecdef`, `proconfig` (prod via `scripts/prod-query-ro.sh`, one bare SELECT each).
>    **Local md5 = prod md5**, else STOP (§7.336: prod may hold a body local does not). Prod owner must be `postgres`
>    (else `CREATE OR REPLACE` fails on prod — STOP and re-plan).
> 2. Build the new body from the captured `pg_get_functiondef` text. **Exactly three intended line edits**: the lock-2
>    line (→ two lines), and a `-- clock-real: <why>` marker on each of the two `RETURN now()` lines (G2, §7.354).
>    ⛔ The marker text must contain no `now()`, `'now'`, `'today'`, `current_date` etc. — the census regex counts
>    tokens in comments inside `prosrc`. Suggested: `-- clock-real: the prod path` / `-- clock-real: lock 2, API
>    is real unless the local-only API row exists`.
> 3. After applying locally: normalized diff (`pg_get_functiondef` before vs after, with those three intended edits
>    reversed) **is empty**; `proowner/proacl/provolatile/prosecdef/proconfig` byte-identical.
> 4. `supabase test db` green, **app_clock census unchanged** (`('app_now', 2)`), and `scripts/check-migration-clock.sh
>    supabase/migrations/<new>.sql` exits 0.
> 5. **Before any push, run EVERY `repo-invariants` step from `ci.yml` locally** (§7.354 — `/deploy` Step 0). One red =
>    no push.
> 6. DOWN proven: in one `BEGIN; \i <DOWN>; SELECT md5(pg_get_functiondef(…)); ROLLBACK;` the md5 equals step 1's
>    BEFORE md5. ⛔ The DOWN does NOT drop `private.clock_api_pin_enabled`, `app_now`, `app_today` or the lock-1 table.

> ⚠ RISK 3 MITIGATION —
> - New assertions in `app_clock.test.sql` (bump `plan(27)` by the number added; count before = 27, after = 27+N):
>   (a) no API role holds any privilege on `private.clock_api_pin_enabled` (mirror of the lock-1 table check);
>   (b) `has_table_privilege(<app_now owner>, 'private.clock_api_pin_enabled', 'SELECT')` (the definer can read it);
>   (c) `count(*) FROM private.clock_api_pin_enabled = 0` (no API row survives into a test run);
>   (d) `NOT EXISTS (SELECT 1 FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') ~ 'swimsync\.now')` —
>       "no database/role-level pin left behind — run scripts/clock-unpin.sh". Each proven red once (insert a row /
>       set a database-level pin as supabase_admin → red; clean → green).
> - ⛔ **No migration, `seed.sql`, or any script that can reach `--linked` / prod ever INSERTs into
>   `clock_api_pin_enabled` or sets `swimsync.now`.** Guard (CI, in `check-driver-clock.sh`): `grep -rlE
>   "clock_api_pin_enabled" supabase/migrations supabase/seed.sql scripts` lists exactly the new migration (and the
>   DOWN), and `grep -nE "INSERT INTO private\.clock_api_pin_enabled" supabase/migrations supabase/seed.sql` is empty.
>   Proven red on a planted line.
> - Remote **grant dump** after the prod apply (the migration REVOKEs on a new table — §7.39, §7.89, DEPLOYMENT §11.7):
>   no grant on `private.clock_api_pin_enabled` to `anon`/`authenticated`/`service_role`.

### The engine reads the DB clock (D3)

`index.ts`: before `generateInvoices`, set `opts = { ...opts, now: await dbNow(supabase) }`. `dbNow` calls
`supabase.rpc('app_now')`, parses the timestamptz string into a `Date`, and **throws** on an error or an unparseable
value. It **always overwrites** `opts.now`, so `core.ts`'s `instanceof` guard and its "never from the wire" property
are untouched. `core.ts` and `dates.ts` are not changed. The resend path doesn't call it. Email stamps
(`email.ts:437,957`) stay real: they are delivery stamps.

> ⚠ RISK 1 MITIGATION — structural, in the code:
> - `dbNow` lives in a new pure-ish module `generate-invoices/clock.ts` (importable by tests; `index.ts` is not).
>   `index.ts` gains exactly **one** call, placed **after the resend branch and inside the `try {`**, so a failure
>   records an `error` run for an admin run. Assertion: `grep -c "dbNow(" index.ts` = 1 and it sits between `try {`
>   and `generateInvoices(`.
> - **Invalid Date is not "a Date".** `new Date("junk") instanceof Date` is `true` and would sail through `core.ts`'s
>   guard into `previousBillingMonth`. `dbNow` throws unless `typeof data === "string"` **and**
>   `Number.isFinite(d.getTime())`.
> - **Fail closed on prod if the DB clock disagrees with the wall clock.** `dbNow` throws when
>   `|db − Date.now()| > 120 s` **unless `SUPABASE_URL`'s host is local** (`kong`, `localhost`, `127.0.0.1`,
>   `host.docker.internal`). On prod a pin cannot exist (three locks), so a skew there can only be a parse/offset bug
>   — the §7.7 family, which could move the month-not-ended / run-day guards by a day. Structural (keys on the URL),
>   not an env flag anyone must remember. This does not reopen D3: the engine still reads the DB's time.
> - One retry (≤ 500 ms backoff) on an RPC error, then throw: an unscoped run records no error row (`toErrorRows`
>   returns `[]` without `tenant_id`), so a blip would otherwise be visible only in function logs.
> - Error message names the cause: `could not read the database clock: …` (the admin's "last run failed" shows it).

### The drivers

**`lib.mjs`** gains one source of "now":

- `PIN = process.env.DRIVER_NOW ?? null`
- `nowSg()` returns the pinned `Date`, or `new Date()` — **unpinned it is exactly `new Date()`** (identity).
- `todaySg()` gives `YYYY-MM-DD` in SGT. `addDaysIso(iso, n)` is pure.
- `pinBrowser(context)` calls `context.clock.setFixedTime(<PIN epoch ms>)` when `PIN` is set, otherwise does nothing.
- **`launch()` returns a WRAPPED browser** whose `newContext()` and `newPage()` call `pinBrowser` on every context
  they create. 14 drivers open extra contexts with `browser.newContext(…)` today; with the wrapper each one is pinned
  without the driver doing anything. Pinning is a property of the browser handle, not a call each driver must
  remember (see *Future drivers* below).
- `lib.mjs` also exports a shared `sql(q)` (the `docker exec … psql -U postgres -Atc` shape 25 drivers copy today), so
  a new driver has one correct way to read the DB.

**Frozen, not flowing:** the DB pin is a fixed instant, so the browser is fixed to the same instant
(`setFixedTime` keeps timers running but holds `Date`). A flowing browser beside a frozen DB could cross 07:59→08:00 or
midnight mid-driver. (Admin search debounce is `setTimeout`-based — `useDebouncedValue` — so it keeps working.)

> ⚠ RISK 7 MITIGATION — `lib.mjs` refuses to run half-pinned, at import, in both directions:
> - `PIN` set → it must match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` (the runner's canonical form) and parse to a
>   finite epoch; AND one `docker exec … psql -U postgres -Atc` must show `extract(epoch FROM app_now())` = the PIN
>   epoch AND `count(*) FROM private.clock_api_pin_enabled` = 1. Otherwise throw
>   `DRIVER_NOW is set but the stack is not pinned — use run-all-drivers.sh --now`.
> - `PIN` unset → the same query must show `coalesce(current_setting('swimsync.now', true), '') = ''` and 0 API rows.
>   Otherwise throw `a stale clock pin is on this stack — run scripts/clock-unpin.sh`.
> - `pinBrowser` asserts on the context's first page: `await page.evaluate(() => Date.now())` = PIN epoch, else throw.
> - Proven red: run a pilot with `DRIVER_NOW` set and no DB pin → throws before the first check; and with a DB pin and
>   no `DRIVER_NOW` → throws.

**The marker and the refusal (D4).** Each driver header declares one of:

- `// clock: pinnable` — reads "now" only through `lib.mjs`
- `// clock: own-literal` — `edit-child` / `student-identity` / `tz-saturday`, which pin their own literal world and
  ignore `DRIVER_NOW`
- no marker

Under `--now`, a driver with no marker is reported **SKIPPED (not pinnable)** in `summary.md`, never PASS, and
`--only <it> --now …` exits 2.

> ⚠ RISK 7 MITIGATION —
> - The marker is matched exactly (`^// clock: (pinnable|own-literal)$` in the first 40 lines); anything else —
>   including a typo — is "no marker" and refuses. Fail-safe by construction.
> - Under `--now`, **any SKIPPED makes the runner exit 3** (never 0), and the last line reads
>   `N passed (pinned), M skipped (not pinnable), K failed`. A pinned sweep with skips can never print "✓ all passed".
> - In every driver the guard (below) refuses `chromium.launch(` / a `playwright` import (so every browser is
>   `lib.mjs`'s wrapped one, and every context on it is pinned) and any `clock.install` / `setFixedTime` /
>   `setSystemTime` outside `lib.mjs`. The 8 drivers that call `clock.install`
>   today move their clock through a `lib.mjs` helper or stay `own-literal`/unmarked.
> - `own-literal` drivers get **one pinned `--only` proof each** (3 runs, session 2) before they may run under
>   `--now`; until then the runner treats them as SKIPPED.

**Fixtures:** `now()` becomes `app_now()`, and `CURRENT_DATE` / `current_date` becomes `app_today()`. `today_sg()`
already follows the pin. Teardowns are converted the same way where they compute dates.

> ⚠ RISK 8 MITIGATION —
> - `now()` → `app_now()` IS identity unpinned. `CURRENT_DATE` → `app_today()` is **NOT** (UTC date → SGT date; they
>   differ before 08:00 SGT). Each such conversion is listed in its commit message with why the SGT date is the
>   intended one. Today that is one line: `fixtures-assessment.sql:160`. Its driver gets a pinned `--only` run at a
>   `07:59+08` moment.
> - Unpinned `check-fixture-roundtrip.sh` stays green after every fixture commit. Pass/fail.
> - A fixture value that feeds a **REAL-TIME** window (staff-invitation expiry, email-claim lease) keeps `now()` with
>   `-- clock-real: <why>` (see RISK 5).

**Driver SQL:** `now() AT TIME ZONE 'Asia/Singapore'` becomes `app_today()`, and so on. The runner's database-level
default pins those psql sessions with no extra code.

> ⚠ RISK 8 MITIGATION — ⛔ a conversion never changes the SUBJECT of a check. A literal or `nowSg()` may replace
> fixture data or an EXPECTED value, never the ACTUAL side that was a clock read (the §7.338 tautology, driver form).
> Per commit: `git diff` scan for any check line whose clock call disappeared on the actual side. Zero hits.

### `run-all-drivers.sh --now '<ts with offset>'`

1. **Validate** the pin with Postgres, not `date` (BSD and GNU differ): it must carry an offset (§7.337) and
   `'<pin>'::timestamptz <= now()`. A future pin is refused: with a frozen browser ahead of the real clock, gotrue-js
   treats every fresh token as expired and refresh-loops (jwt_expiry 3600). Canonicalise to `…Z` (above).
2. **Preflight, in both modes:** if a stale database-level `swimsync.now` or an API row exists (a killed run), clear
   it and print `⚠ cleared a stale clock pin`. A stale pin left on a dev stack would silently run the dev apps on a
   fake day.
3. **Per driver:** **unpin** (RESET + delete row) → `supabase db reset` → **pin** (`ALTER DATABASE … SET` as
   `supabase_admin`; insert the API row as `postgres`) → `docker restart` rest → `docker restart` kong →
   `wait_for_auth` → **proof**: `POST $API_URL/rest/v1/rpc/app_now` with the **service-role key** (anon has no
   EXECUTE) returns the pin epoch on **3 consecutive** calls → load the fixture → `DRIVER_NOW=<canonical pin> node …`.
   A failed proof marks the driver CANNOT SAY, never PASS.
4. **Trap on EXIT/INT/TERM:** delete the API row FIRST (instantly un-pins every pooled API session: lock 2 returns
   `now()` with the row absent), then `ALTER DATABASE … RESET` as `supabase_admin`. Assert after: `rpc/app_now` is
   within 60 s of real time and `pg_db_role_setting` holds no `swimsync.now`; otherwise print
   `✗ STACK LEFT PINNED — run scripts/clock-unpin.sh`.
5. `summary.md` heads with `Pinned at: <pin>` (or `Real clock`).

`scripts/clock-unpin.sh` is the same clean-up (step 4), runnable by hand.

> ⚠ RISK 4/6 MITIGATION —
> - **Unpin BEFORE every reset** (step 3's order is the assertion): migrations run before `seed.sql` inserts the
>   lock-1 row, so a pinned session during a reset RAISEs mid-migration.
> - `--now` together with `AFTER_RESET_SQL` (the `simulate-date.sh` hook) → exit 2 `two clock mechanisms`. ⛔ Never
>   combine them.
> - Prove the proof: once, with the API-row insert commented out, `--only <pilot> --now …` must report CANNOT SAY
>   (not PASS, not a driver FAIL).
> - Session 1 assertion: the `auth.users` trigger query (`handle_new_user` reads no app clock) is still `f`; if it is
>   ever `t`, add a GoTrue restart to step 3 (its pool was opened before the pin).

> ⚠ RISK 3 MITIGATION — **prod is unreachable by construction**: the runner and `clock-unpin.sh` only ever use
> `docker exec <supabase_db_*>`, and refuse (exit 2) when `API_URL` is not `http://127.0.0.1:*` / `http://localhost:*`.
> ⛔ Neither script may call `supabase db query --linked`, `scripts/prod-query-ro.sh`, or read `SUPABASE_DB_URL`.

> ⚠ RISK 6 MITIGATION — the other local consumers refuse a stale pin loudly (exit 2, naming `scripts/clock-unpin.sh`):
> `generate-invoices/test.sh`, `supabase/tests/http/app_clock_locks.sh`, `check-fixture-roundtrip.sh` (each runs one
> read-only `docker exec` check of `pg_db_role_setting` + the API row before starting). pgTAP is covered by
> assertion (d) above. ⛔ Never run `--now` beside a sibling worktree, `supabase test db`, or the Deno suite.

> ⚠ RISK 2/D2 MITIGATION — **the nightly is unchanged**: `run-all-drivers.sh --only <pilot>` (unpinned) before and
> after the runner change produces the same PASS/score; the only new output line is `Real clock`. No `--now` →
> no `docker restart` of rest, no `supabase_admin` write except the stale-pin preflight (a no-op in CI).

## CI guards (in `ci.yml`, cheap, no UI)

1. **`app_clock_locks.sh` grows checks**, after the existing three (which stay, with no API row):
   - 4: insert the API row as postgres, then as `authenticator` → `SET ROLE authenticated`, `app_now()` = the pin;
   - 5: API row present but lock-1 row absent → RAISE;
   - 6: API row present but NO pin → `app_now()` within a minute of `now()` (the prod path stays first).

   **Proven red:** remove the new `AND NOT EXISTS` line and check 4 must fail. Revert the relaxation and checks 1–3
   must still pass.

   > ⚠ RISK 3 MITIGATION — checks 4–6 run inside a `trap` that deletes the API row and re-inserts the lock-1 row on
   > every exit path; the script asserts `count(*) FROM private.clock_api_pin_enabled = 0` as its LAST line. The
   > Deno suite runs after it in CI.

2. **`check-driver-dates.sh` grows a clock rule** (or a sibling `check-driver-clock.sh`):
   - In a `clock: pinnable` driver: no `new Date()` with no arguments, no `Date.now()`, no `chromium.launch(` or `playwright` import, no
     `clock.install`/`setFixedTime`/`setSystemTime`, and no SQL `now()`/`CURRENT_DATE`/`current_date`/
     `localtimestamp`/`current_timestamp`/`'now'`/`'today'` inside query strings (use `app_now()`/`app_today()`),
     unless the line carries `// clock-real: <why>` (e.g. elapsed timing).
   - In fixtures: no raw clock token unless `-- clock-real:`.
   - The prod-reach rule for `clock_api_pin_enabled` (RISK 3 above).

   **Proven red** on one planted line per rule. Canary: exit 2 on a scanner that finds fewer than 73 drivers or 0
   fixtures (§7.283); a self-test of its own token list like G2's. ⛔ No `cmd | grep -q` under `pipefail`
   (§7.339). Written in bash, run with bash (§7.340).

3. **`check-fixture-roundtrip.sh --now '<fixed past moment>'`:** a SECOND CI step after the existing unpinned one,
   loading every fixture with the pin carried by `PGOPTIONS` (session-only — the script stays sibling-safe). This is
   the only CI exercise of the pinned path. The moment is a fixed literal in the past, chosen as a hazard
   (`2026-10-01 07:59+08`: the 1st, before 08:00 SGT), canonicalised to `2026-09-30T23:59:00Z`. If it lands in a
   file `check-test-dates.sh` scans, it carries `-- date-literal-ok:` (§7.305).

   > ⚠ RISK 6 MITIGATION — apply AND teardown of every fixture use the same `PGOPTIONS` pin (a teardown that
   > derives its dates on another clock misses its rows). Assertion: the existing unpinned step is unchanged and
   > still present (`grep -c check-fixture-roundtrip.sh ci.yml` = 2).

## Deno (engine)

- `clock.test.ts` (unit, stubbed RPC — no shared-DB mutation): parses the real PostgREST shape
  (`"2026-09-30T23:59:00.123456+00:00"`); throws on an RPC error after one retry; throws on `null`, a number, a
  non-date string, and an Invalid Date; with a prod-shaped URL and a 10-minute skew → throws; with a local URL and a
  10-day skew → returns the DB value; the handler-facing helper **always** overwrites a body `now`.
- **`clock.test.ts` is added to `test.sh`'s explicit file list** (a file not listed never runs). Assertion: the Deno
  test count before + N new = after.
- The existing suite, **run twice** (§7.15), on an UNPINNED stack (test.sh refuses a pinned one).
- **Proven red:** make `dbNow` return `new Date()` → the "local URL, 10-day skew returns the DB value" test fails;
  drop the `isFinite` check → the Invalid Date test fails; drop the skew guard → the prod-URL test fails.
- **HTTP proof of the wiring (session 1, local, once):** under the runner's pin at `2026-08-01T00:30:00+08:00`,
  `POST /functions/v1/generate-invoices` `{"mode":"auto","tenant_id":"<seed tenant>"}` → `status:
  "before_run_day"`, message contains `Today is day 1`, `billing_month: "2026-07"`. The same call unpinned → today's
  day and last month. ⛔ An "integration test under a pin" inside the Deno suite is dropped: it would mutate the shared
  DB's clock while the suite runs.

## Sweep order (the ~45 date-reading drivers + 40 fixtures)

1. **Pilots (session 1)**, one per bucket: `unmarked-lessons` (DB floor + engine; also has `clock.install`),
   `schedule-week` (browser week + floor), `attendance-guard` (DB window refusal), `makeups` (booking),
   `trial-onboarding` (engine via Generate). Each runs **twice via `--only`**: unpinned, and pinned at a past moment
   that differs from today in weekday **and** month position. (10 runs: within the single-driver allowance.)
2. **The rest (session 2)**, alphabetical, one commit per ~8 drivers. Each commit: guard green, unpinned roundtrip
   green.

   > ⚠ RISK 9 MITIGATION — ⛔ **Do NOT loop `--only` over the converted drivers.** That is a full sweep, and full
   > sweeps are user-requested only. Instead:
   > - Classify every edit as **mechanical** (`now()`→`app_now()`, `new Date()`→`nowSg()`, a marker header: identical
   >   unpinned by construction — no run) or **semantic** (anything else, incl. `CURRENT_DATE`→`app_today()` and any
   >   moved `clock.install`).
   > - At the start of session 2, show the user the semantic list with its count (+ the 3 `own-literal` pinned
   >   proofs) and **wait for a yes** before running any of them. Without a yes, run none; the scheduled nightly
   >   covers the unpinned side.
   > - The date-insensitive drivers (~28) get `clock: pinnable` after the guard (not a hand grep) confirms they read
   >   no clock.

   > ⚠ RISK 5 MITIGATION — ⛔ **Never "fix" a pinned red by re-bodying a REAL-TIME function onto the pin**
   > (`handle_new_user`'s invitation expiry, `email_delivery_state`, `claim_*_email` — §6af), nor by moving a real
   > `created_at`-style stamp onto `app_now()`. Either change would ship to prod as a migration and move a security
   > window. A pinned red caused by a real-time window or a real stamp is recorded in the driver header as
   > `// clock-real: <step> — by construction under a past pin`, and the driver either marks that step real or stays
   > unmarked. Any migration proposed during the sweep is out of scope: stop and ask.

3. **A full pinned sweep is the USER's call** (CLAUDE.md: full sweeps are user-requested only). Propose it at the
   end, with a suggested pin. ⛔ Never dispatch or re-run `ui-drivers.yml`; read the scheduled nightly only.

## Deploy order (`/deploy`) — re-ordered so prod billing sees the engine change LAST

No app code changes here, and no app depends on the engine change, so CLAUDE.md's "main last" (which protects apps
that depend on the backend) is satisfied with the engine deploy last instead: the engine's code reaches `main` (no
deploy — a push never deploys an Edge Function) and earns a green CI + nightly BEFORE prod billing runs on it.

1. **Migration → prod (inert there).** Pre: RISK 2 steps 1–5 all ticked. Proof, each a bare
   `scripts/prod-query-ro.sh` call:
   - `md5(pg_get_functiondef('public.app_now'::regproc))` = local's new md5; `proacl`/`prosecdef`/`provolatile`/
     `proconfig`/`proowner` = the BEFORE capture.
   - `count(*) FROM private.clock_api_pin_enabled` = 0 and `count(*) FROM private.clock_override_enabled` = 0.
   - `has_function_privilege('service_role','public.app_now()','EXECUTE')` = t.
   - `abs(extract(epoch FROM app_now() - now())) < 1` = t.
   - `supabase migration list --linked` shows 0 pending. Remote grant dump taken (RISK 3).
2. **Drivers, scripts, CI and the engine SOURCE → `main`.** Assertion: `git diff --stat origin/main..HEAD --
   SwimSyncApp SwimSyncAdmin` is empty (not an app deploy; the §7.1 gate doesn't apply). CI green, confirmed with
   `git log -1 origin/main` (§7.353). HANDOVER (written from the root, not a worktree) notes: *`generate-invoices` on
   `main` is ahead of prod until step 4 — do not deploy it from an unrelated change before then.*
3. **Read the next scheduled nightly on that `main`** (unpinned; the Generate drivers exercise `dbNow` on CI's local
   stack). Green = proceed. ⛔ Do not dispatch or re-run it.
4. **Engine → prod, gated.**

   > ⚠ RISK 1 MITIGATION — all must hold, else wait:
   > - **Little Orcas' Sep 2026 run is done:** a bare `scripts/prod-query-ro.sh` query on the billing-period table
   >   (read its real name/columns from the DB first, §7.40) shows Little Orcas' `2026-09` completed — OR the user
   >   explicitly says to deploy before it.
   > - No `billing_runs` row with `ran_at` in the last 15 minutes (no run in flight).
   > - Re-check prod still has no `cron.job` (if cron has since been enabled, add a "not within the cron hour" gate).
   > - Record the current version from `supabase functions list` and the engine commit SHA. Rollback =
   >   `git revert <engine commit>` on a branch → `supabase functions deploy generate-invoices` → list. The engine change
   >   is its own commit so the revert is clean.
   > - Then `supabase functions deploy generate-invoices`, then `supabase functions list` (version bumped).
5. **Post-deploy proof.** Prod billing is manual, so there is no cron run to watch. Proof = the **next real Generate**
   on prod: `scripts/prod-query-ro.sh` on `billing_runs` with `ran_at` after the deploy shows no `status = 'error'`,
   the expected `billing_month`, and function logs carry no `could not read the database clock`. Until it happens the
   engine is recorded in DEPLOYMENT as *deployed, not yet exercised on prod* (a DORMANT line). Any failure → rollback
   (step 4) first, investigate second. ⛔ Do not press Generate on prod to create the proof.

## Future drivers — the clock contract is enforced, not remembered

Goal: a driver written after this effort **cannot** reach `main` reading the clock any other way. Every item below is
structural (CI or code). The two marked *vigilance* say so.

1. **Every driver must declare its clock — no "unmarked" state survives the sweep.** `check-driver-clock.sh` (CI,
   `repo-invariants`) requires the exact header line `// clock: pinnable` or `// clock: own-literal` in every
   `verify-*.mjs`. **During the sweep only**, a frozen list `UNSWEPT=( … )` inside the guard names the drivers not yet
   converted. The guard fails if a driver on the list is now marked (remove it from the list) or if the list grows
   (its length is checked against a constant). **The lane-2 close task deletes the list; from then on a driver with no
   marker is CI red.**
2. **`own-literal` is a closed list.** The guard holds the exact three names (`edit-child`, `student-identity`,
   `tz-saturday`). A fourth one is CI red unless the guard itself is edited, and that edit shows up in review.
3. **Pinnable rules apply to every driver and every fixture**, including new ones: no `new Date()` with no
   arguments, no `Date.now()`, no `chromium.launch(` or `playwright` import outside `lib.mjs` (so every browser comes
   from the wrapped `launch()`), no `clock.install`/`setFixedTime`/`setSystemTime`, and no raw SQL clock token in a
   query string or fixture. The opt-out is a per-line `// clock-real: <why>` / `-- clock-real: <why>`. Each rule is
   proven red on a planted line, and the guard self-tests its token list.
4. **Pinning happens in the browser handle, not in the driver.** The wrapped `launch()` means a driver cannot create
   an unpinned context by forgetting a call. `lib.mjs`'s import-time check refuses a half-pinned stack. A driver that
   imports `lib.mjs` (all of them, and rule 3 forces it for a browser) inherits both.
5. **New fixtures:** the same rule-3 tokens, plus the existing `check-teardowns.sh` pairing. `fixtures-*.sql` derives
   every date from `app_today()` / `app_now()` (or the floor, §7.305).
6. **The template a future author copies is pinnable.** New `drivers/_TEMPLATE.mjs` (not `verify-*`, so never run)
   shows the header marker, the `lib.mjs` imports (`launch`, `nowSg`, `todaySg`, `addDaysIso`, `sql`, `sgLabel`) and
   a dated assertion done the right way, plus `drivers/_TEMPLATE-fixture.sql`. `run-ui-playwright/SKILL.md` gets a
   *Writing a new driver* section pointing at it. **That section replaces line 134's "use
   `example-credit-note-flow.mjs` as the template"**: that file posts to the engine by hand and isn't in the suite.
   The guard checks that `_TEMPLATE.mjs` itself passes every rule, so the example can't drift.
7. *(Vigilance, admitted.)* **A new driver's first commit includes one pinned `--only` run** at a past moment. This
   is the line in the SKILL.md section and in TESTING §5's driver checklist. Nothing can force a run before a commit
   without making CI run UI drivers (the nightly is unpinned by D2). The CI rules above make the *code* right; this
   line makes the *behaviour* proven.
8. *(Vigilance, admitted.)* **Propose to the user** one line for CLAUDE.md's *Rules that bite*: "A UI driver reads the
   time only through `lib.mjs` (`nowSg`/`todaySg`); `check-driver-clock.sh` enforces it." CLAUDE.md is the user's
   file, so we propose and don't write it unasked.

> ⚠ Proven red at close (lane 2's last task): a new throwaway `verify-zz-clock-canary.mjs` with **no** marker → CI
> red; with the marker but `new Date()` → red; built from `_TEMPLATE.mjs` → green. Delete the canary; record the
> three results in the DONE message.

## Two lanes — lane 1 orchestrates, lane 2 answers

**Why the split works:** the work divides cleanly into **everything that touches the shared database or prod**
(lane 1) and **code that touches neither** (lane 2). Lane 2 needs the DB only for the fixture roundtrip, which is
sibling-safe (`PGOPTIONS`, its own rows). So the two sessions never compete for `db reset`, ports, or `main`.

### lane 1 — root checkout, orchestrator (this session)

**Owns:** Step 0; the migration + DOWN (`db/api-clock-pin` branch); `app_clock.test.sql` (a)–(d);
`app_clock_locks.sh` checks 4–6; the engine (`clock.ts`, `index.ts`, `clock.test.ts`, `test.sh`) and Deno ×2;
**every DB-resetting run**: the pilot runs, the HTTP engine proof, the "proof of the proof", the user-approved
semantic runs; the dev servers on 3000/8081; every merge to `main`, push, prod read and prod deploy; GOTCHAS, TESTING,
ARCHITECTURE, DEPLOYMENT, BACKLOG; HANDOVER via `/update-docs`.

### lane 2 — worktree `pin-clock-drivers` (`/worktree-start` after this plan is committed)

**Owns:** `lib.mjs` (helpers, wrapped `launch()`, shared `sql()`, refusals); `run-all-drivers.sh --now`;
`scripts/clock-unpin.sh`; `check-driver-clock.sh` (all rules, red proofs, `UNSWEPT` ratchet);
`check-fixture-roundtrip.sh --now`; the `ci.yml` steps for those two; the whole driver and fixture sweep;
`_TEMPLATE.mjs`, `_TEMPLATE-fixture.sql` and the SKILL.md section; `docs/handoff/pin-clock-drivers.md` at close.

**Never:** a migration, `seed.sql`, `main`, prod, `supabase db reset`, any `run-all-drivers.sh` run (even
`--only`), `supabase test db`, the Deno suite, HANDOVER/PRD/BACKLOG. It does a DB-backed run (only the fixture
roundtrip) **only between `RESUME` and the next `HOLD`**, and each one needs **the user's click in lane 2's own
terminal**: lane 1's go is not the user's approval (WORKTREES Phase 4).

### The protocol — lane 1 sends, lane 2 answers

Lane 1 finds lane 2 with `ListAgents` once lane 2's session is open, records the name in `WORKTREE.md`, and sends
with `SendMessage`. **Lane 2 only replies to lane 1. It never starts a thread with lane 1 and never messages the user
for decisions** (only for permission clicks). Every message carries the task number.

| Lane 1 → lane 2 | Meaning |
|---|---|
| `TASK <n>: <scope> \| base <sha> \| done when <assertion>` | Start a task from the schedule below |
| `HOLD` | Stop any DB-backed run now; lane 1 is about to change shared DB state |
| `RESUME` | DB-backed runs (the roundtrip only) allowed again |
| `MERGED <n> @ <sha>` | Your branch is on `main`; run `git rebase origin/main` before the next task |
| `RUN-RESULT <n>: <driver> <pinned\|unpinned> <PASS\|FAIL\|CANNOT SAY> \| log <path> \| cause <one line>` | Lane 1 ran your code; a FAIL comes with a follow-up `TASK` |

| Lane 2 → lane 1 (replies only) | Meaning |
|---|---|
| `ACK <n>` | Task received and started |
| `HELD` | Reply to `HOLD`: no DB-backed run is in flight |
| `DONE <n>: branch <b> @ <sha> \| files <k> \| guard green, red-proofs <x>/<y> \| edits: mechanical <m>, semantic <s> (<names>) \| needs-run: <drivers> \| findings: <…>` | Task finished; ready to merge |
| `BLOCKED <n>: <question>` | Can't continue without lane 1's answer |

> ⚠ **Lane 1 does NOT merge a `DONE`** that reports red-proofs `x < y`, an unclassified edit, or a `semantic`
> count without names. A semantic edit's run waits for the user's yes (RISK 9).
> ⚠ **Lane 1 sends `HOLD` and waits for `HELD`** before Step 0, before applying the migration locally, before any
> pinned run, and before `supabase test db` / Deno. A `HOLD` with no `HELD` = no DB change.

### Task schedule

| Task | lane 1 (DB + prod) | lane 2 (code) | Depends on |
|---|---|---|---|
| T0 | Commit plan; `/worktree-start pin-clock-drivers` (answer "no migration in the worktree; lane 1 lands it"); `ListAgents`; send T1 | — | — |
| T1 | `HOLD` → Step 0 (S0.1–S0.6) → `RESUME`; graduate the confirmed GOTCHAS | `lib.mjs` helpers + wrapped `launch()` + shared `sql()` + both refusals; `check-driver-clock.sh` with every rule, red proofs, `UNSWEPT` ratchet; `_TEMPLATE.mjs` + fixture template + SKILL.md section | — |
| T2 | Migration on `db/api-clock-pin` (RISK 2 steps 1–6), `app_clock.test.sql` (a)–(d), locks checks 4–6 → `main` → deploy step 1 (prod, inert) | `run-all-drivers.sh --now` + `clock-unpin.sh` + `check-fixture-roundtrip.sh --now` + `ci.yml` steps | Step 0 passed |
| T3 | Engine: `clock.ts`, `clock.test.ts`, `test.sh`, `index.ts`, Deno ×2 with red proofs (engine source on `main`, NOT deployed) | Convert the 5 pilots; list the semantic edits | T2 merged |
| T4 | Pilot runs (unpinned + pinned, 10 runs), HTTP engine proof, proof-of-the-proof; `RUN-RESULT` each | Fix tasks from `RUN-RESULT`; then sweep batch 1 | T3 |
| T5 | Merge batches; present the semantic list to the user and run only on a yes | Sweep batches 2…n; empty `UNSWEPT`; the canary proof; `/worktree-close` → handoff file | T4 |
| T6 | Deploy steps 2–5 (engine to prod gated on Little Orcas); `/update-docs`; propose the CLAUDE.md line | — | T5, a green nightly |

## Time

- **With two lanes:** about **2 sessions** of wall clock instead of 3. Lane 1 is ~5 h of DB, engine and runs. Lane 2
  is ~6 h of code and sweep, running at the same time. T6 is ~1 h on its own.
- Lane 1's pilot runs (T4) are the critical path: lane 2's sweep can't be merged until the runner has run once.

## Definition of done

- `--now` replays a moment across browser + PostgREST + driver SQL + fixtures + engine, proven by the pilots' pinned
  runs, by the runner's per-driver `rpc/app_now` proof, and by `lib.mjs`'s import-time and browser assertions.
- Every driver carries a clock marker, or is knowingly unmarked and refuses `--now`; a pinned run with any SKIPPED
  exits non-zero.
- The lock proofs (6 checks), the driver-clock guard, the new `app_clock.test.sql` assertions and the pinned fixture
  roundtrip are all green in CI, each proven red once.
- Deno ×2 is green with `clock.test.ts` in `test.sh`. Prod shows the new `app_now` body (md5 = local), 0 API rows,
  unchanged ACL; the engine is deployed only after the Little Orcas gate.
- The nightly over the sweep commits is read (unpinned: it must stay green).
- Documentation: ARCHITECTURE §6af addendum (the API row; the database-level carrier set as `supabase_admin` by the
  runner only; `PGOPTIONS` for the roundtrip; and the sentence "the engine and the UI drivers always run on the real
  clock" rewritten). New GOTCHAS for whatever bites (at least the three plan-review candidates), TESTING §5 (`--now`,
  markers, the guard, `clock-unpin.sh`), DEPLOYMENT entry, a `docs/plans/README.md` row, and BACKLOG struck in
  **both** places.

## Known consequences

- **The Next server stays on real time.** Its only clock reads are `banned_until` checks, and a pinned past day makes
  a real ban look *further* in the future, never lifted. Re-verify once in session 1 with a bash script (not zsh,
  §7.340): server-side files (no `"use client"`) under `SwimSyncAdmin/app` and `lib` that read a clock = the six
  `route.ts` files. A different count = re-plan that part. If a future route makes a date decision on the server, it
  must read `app_now()` over RPC.
- **Other edge functions (`public-invoice`, `public-package`, …) still read `new Date()`** where they read a clock at
  all. Their date decisions, if any, are in DB functions and therefore pinned. A raw JS date decision there would not
  be.
- **Frozen time:** every `app_now()` stamp in one driver run is identical, so ordering by such a stamp can tie.
  `created_at`/`updated_at`/`generated_at` stay `now()` (real) by Wave 7's classification, so a pinned UI shows real
  dates for those.
- **REAL-TIME windows stay real** (§6af): a staff invitation minted at a past pin is still valid for 15 real minutes;
  a fixture row that should be "expired" or "leased" relative to the pin will not be. See RISK 5's prohibition.
- **Future moments can't be replayed** (JWT refresh). Only past moments.
- **A pin earlier than data a migration backdated** may produce worlds that never existed. `seed.sql` has no dates, so
  this is limited to fixture-relative derivations, which all follow the pin.

- **Re-verified 2026-10-09:** the Next server's clock reads are exactly the six `app/api/*/route.ts` `banned_until`
  checks; 12 other files without `"use client"` read `new Date()` but are client-imported and run in the browser.
- **The HTTP engine proof could not show `Today is day 1`:** the seed tenant has unbilled May lessons, so the
  earlier-month guard answers before the run-day guard. The proof used the default billing month instead (pinned
  `2026-08-01 00:30+08` → `2026-07`; unpinned → `2026-09`), which reads the same `opts.now`.
- **The browser is not always at the pin** (ARCHITECTURE §6af): own-literal drivers and `installDerivedClock`.

## Pre-commit gate (walk before EVERY commit in this effort; a box that cannot be ticked is a blocker)

**Highest value — never skip:**
- [ ] ★ Step 0 passed (S0.1–S0.5) BEFORE the migration was written; no migration/seed sets or grants the GUC.
- [ ] ★ `app_now()` normalized diff empty except the three intended edits; owner/ACL/volatility/secdef/config
      identical; census `('app_now', 2)` unchanged; G2 green on the new file; ALL `repo-invariants` steps run locally.
- [ ] ★ Engine: `dbNow` inside the `try`, one call; Invalid Date + skew guard + retry tested; each proven red;
      `clock.test.ts` listed in `test.sh`; Deno green **twice** on an unpinned stack.
- [ ] ★ Engine prod deploy only after the Little Orcas Sep 2026 gate, no run in flight, rollback SHA recorded.
- [ ] ★ Unpinned `--only <pilot>` output identical before/after the runner change (nightly unchanged).
- [ ] ★ Future drivers: no marker → CI red, `new Date()` in a marked driver → CI red, `_TEMPLATE.mjs` → green
      (canary proof recorded); `UNSWEPT` is empty and deleted before close.
- [ ] ★ Lanes: lane 2 ran no `db reset` / driver run / `main` push; every lane-1 DB change came after a `HELD`.

**The rest:**
- [ ] Local md5 of `app_now` = prod md5 before the push; prod probes after (body, 0 rows ×2, EXECUTE, clock within 1 s).
- [ ] DOWN restores the BEFORE md5 in a rolled-back transaction; it drops nothing.
- [ ] Remote grant dump taken after the prod apply.
- [ ] `app_clock.test.sql`: new assertions (a)–(d) green, each proven red; `plan()` count updated.
- [ ] `app_clock_locks.sh` checks 4–6 green; check 4 proven red; trap leaves 0 API rows.
- [ ] Guard: every rule proven red on a planted line; canary on <73 drivers; prod-reach rule for the API table.
- [ ] Runner: pin canonicalised by Postgres; future pin refused; unpin-before-reset order; rest+kong restart;
      3-consecutive service-key proof; proof proven to fail with the API row withheld; trap leaves the stack unpinned;
      `--now` + `AFTER_RESET_SQL` refused; SKIPPED → exit 3; refuses a non-local `API_URL`.
- [ ] `lib.mjs` refuses both half-pinned directions; browser `Date.now()` = pin asserted.
- [ ] `test.sh`, `app_clock_locks.sh`, `check-fixture-roundtrip.sh` refuse a stale pin.
- [ ] Roundtrip: unpinned step unchanged and green; pinned step uses `PGOPTIONS` only (no `ALTER DATABASE` in it).
- [ ] Sweep commit: edits classified mechanical/semantic; semantic runs approved by the user; no tautology on the
      actual side of a check; no REAL-TIME function or real stamp moved onto the pin; no loop over all drivers.
- [ ] `git diff --cached --name-only` reviewed (§7.351); no app files in the diff.
