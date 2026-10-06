# Wave 7 — Inject the database clock

_Planned 2026-10-06 with `/plan-with-confidence` (session "lane1"). Hardened by `/plan-review` 2026-10-06. BACKLOG → *Inject the database clock* (L) and *Promote §7.7 to a check over supabase/functions* (S, folded in)._

## What this builds, and why

Every pgTAP test picks its own "today", so no database test can expire again, and a test can deliberately stand on an edge day: the 1st, a leap day, before the month's first Saturday, or 07:59 SGT. On 2026-10-01 `main` went red with no code change because tests had two clocks: their own dates and the database's `now()` (§7.302–§7.305).

Production behaviour is **identical** after this wave. On prod nobody can move the clock, and every converted function returns exactly what it returned before.

## Decisions settled with the user (2026-10-06) — do not reopen

| # | Decision | Answer |
|---|---|---|
| D1 | Which pgTAP files pin the clock? | **All that touch a date** (G1's hit list is the fact: 82 of 90 `.test.sql` match today; the "80" was an estimate). A CI mechanism makes every NEW pgTAP file pin too |
| D2 | UI drivers / app tests? | **Out of scope.** They keep deriving from the real clock. Driver pinning (four clocks: browser, app, Postgres, engine) is filed as its own BACKLOG item |
| D3 | How is prod protected? | **Two locks**: (1) a flag row only `seed.sql` writes (seed never runs on prod) AND (2) the session is not the API's login role (`authenticator`) |
| D4 | Billing guards vs Little Orcas' unbilled September | **Ship regardless.** Prod behaviour is identical by construction |
| D5 | Lanes | Two. **lane1 = root checkout, orchestrator, owns every migration, `main`, prod and the docs. lane2 = worktree `wave7-tests`, owns pgTAP conversion + CI guards**, takes tasks from lane1 and reports back |
| D6 | Lane comms | **Cross-session messages** (`SendMessage` to the session named `lane2` / `lane1`). The graduate list at close is still a file (`docs/handoff/wave7-tests.md`) |

## The rules this wave obeys

- **Only "what time/day is it, for a decision" moves.** Audit stamps (`updated_at`, `cancelled_at`, `decided_at`…) stay `now()`. A stamp that is later READ BACK to decide a date (e.g. `confirmed_at` → revenue month) moves; see the classification rules.
- **Security clocks never move**: staff-invitation expiry (`handle_new_user`, §7.289) and email-claim windows (`email_delivery_state`, `claim_*_email`) stay on `now()`. They are real-time, not calendar decisions.
- **Expand/contract, one schema change in flight** (CLAUDE.md). Each migration is behaviour-identical on prod.
- **Read bodies from the database**, never from migration files (§7.40): `pg_get_functiondef`.
- **Every new test proven red** without its fix (§7.25). **Deno twice** after every migration that touches a function on the billing path. That includes M1, because `markable_floor` feeds the unmarked-attendance block (§7.15).
- **Lane2 never authors a migration**, never edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`, never pushes `main`, never runs `supabase db reset` or `run-all-drivers.sh`. **lane1 never resets the DB while lane2 is live.** New migrations are applied with `supabase migration up` (no reset).
- **lane2's DB-backed runs need the user's click in lane2's terminal** (WORKTREES: a sibling's "go" is not the user's approval). pgTAP runs in a rolled-back transaction, so concurrent *test* runs are safe. Concurrent *DDL* is not; see the HOLD protocol.
- **⚠ RISK 7 MITIGATION — HOLD protocol (step).** Before any lane1 action that commits DDL or data on the shared DB, lane1 sends `HOLD <reason>` and waits for lane2's `HELD` before acting, then sends `RESUME`. This covers `migration up`, a red-proof that replaces a function, a rollback rehearsal, and the flag-row insert. Lane2 starts no DB-backed run between `HELD` and `RESUME`.
- **⚠ RISK 8 MITIGATION — this wave ships migrations and test/CI files only (prohibition).** Do NOT change any file under `SwimSyncApp/`, `SwimSyncAdmin/`, or any non-comment line under `supabase/functions/` in this wave. Assertion before every `git push origin main`: `git diff --stat origin/main..main -- SwimSyncApp SwimSyncAdmin` is empty. `git diff -U0 origin/main..main -- supabase/functions | grep '^[+-][^+-]' | grep -v 'utc-date-ok'` is also empty. Any hit means stop: an app or engine change rode the push.

## Design

### The clock: `app_now()` and `app_today()`

```sql
CREATE SCHEMA IF NOT EXISTS private;   -- not in config.toml's API schemas
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;           -- ⚠ RISK 3
CREATE TABLE private.clock_override_enabled (enabled boolean PRIMARY KEY CHECK (enabled));  -- lock 1
REVOKE ALL ON TABLE private.clock_override_enabled FROM PUBLIC, anon, authenticated, service_role;  -- ⚠ RISK 3
-- seed.sql (local + CI only):  INSERT INTO private.clock_override_enabled VALUES (true);

CREATE FUNCTION public.app_now() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v text := current_setting('swimsync.now', true);
BEGIN
  IF v IS NULL OR v = '' THEN RETURN now(); END IF;                       -- prod path, every call
  IF session_user = 'authenticator' THEN RETURN now(); END IF;            -- lock 2: the API never pins
  IF NOT EXISTS (SELECT 1 FROM private.clock_override_enabled) THEN       -- lock 1: fail LOUD, not silent
    RAISE EXCEPTION 'swimsync.now is set but the clock override is disabled in this database';
  END IF;
  IF v !~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)$' THEN                           -- an offset, always (§7.7 axis)
    RAISE EXCEPTION 'swimsync.now must carry a UTC offset, e.g. ''2026-09-15 10:00+08'' (got %)', v;
  END IF;
  RETURN v::timestamptz;
END $$;

CREATE FUNCTION public.app_today() RETURNS date LANGUAGE sql STABLE
SET search_path = public AS $$ SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date $$;

REVOKE ALL ON FUNCTION public.app_now(), public.app_today() FROM PUBLIC, anon;          -- ⚠ RISK 2 (§7.39/§7.82)
GRANT EXECUTE ON FUNCTION public.app_now(), public.app_today() TO authenticated, service_role;
```

- **GUC namespace `swimsync.*`**, never `request.*` / `app.*` (PostgREST writes `request.*` from headers/JWT).
- **`SECURITY DEFINER`** so callers need no grant on `private`. The flag table is referenced schema-qualified.
- **Test helper**: `SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);` as the first statement after `BEGIN;` in each file. That is the same as `SET LOCAL`. It is a pgTAP-side convention, not a DB function, so nothing ships to prod.
- `session_user` (not `current_user`): pgTAP runs as `postgres`, and `SET LOCAL ROLE authenticated` keeps `session_user = postgres` (verified). PostgREST and edge functions connect as `authenticator`.
- **⚠ RISK 3 MITIGATION — lock 2 is proven over a real `authenticator` login, not in pgTAP (step + prohibition).** Locally `postgres` is not a superuser, so `SET SESSION AUTHORIZATION authenticator` is refused (verified 2026-10-06). Do NOT write a pgTAP assertion that claims to prove lock 2. Instead, lane1 adds `supabase/tests/http/app_clock_locks.sh`, modelled on `signup_trust.sh`:
  - It runs `docker exec -e PGPASSWORD=postgres <db> psql -h 127.0.0.1 -U authenticator -v ON_ERROR_STOP=1`.
  - It sets `swimsync.now` to `'2001-01-01 00:00+08'` and asserts `app_now()` is within 1 minute of `now()`.
  - It does the same again after `SET ROLE authenticated`.
  - It **exits non-zero if the login fails**; there is no skip path.
  - Wire it into `ci.yml` right after `Sign-up trust (HTTP)`.
  - Red-proof under HOLD: replace `app_now()` with a body that has no lock 2 → the script fails; restore → green. Then `pg_get_functiondef('public.app_now'::regproc)` must be byte-identical to the pre-proof capture.
- **⚠ RISK 2 MITIGATION — ACL parity (assertion in `app_clock.test.sql`).** For each role in `{anon, authenticated, service_role}`:
  - `has_function_privilege(role, 'public.app_now()', 'EXECUTE')` ≥ `has_function_privilege(role, 'public.today_sg()', 'EXECUTE')`, and the same for `app_today()`.
  - `anon` holds neither function.
  - A role that can call `today_sg()` but not `app_now()` would get `permission denied` the moment `today_sg()` is re-bodied, because `assert_markable_date` is SECURITY INVOKER and fires under `authenticated`.

### The lever: re-body the existing helpers first

`today_sg()` and `session_window_start()` are re-bodied to read `app_now()`. That converts every caller of `today_sg()`, `session_window_start()`, `markable_floor()` and `markable_window_start()` in one behaviour-identical migration. There are 24 such callers on the live DB as of 2026-10-06.

- **⚠ RISK 1 MITIGATION — `CREATE OR REPLACE` only (prohibition).** Do NOT `DROP FUNCTION` / re-`CREATE` any existing function in this wave. Do NOT change a signature, return type, volatility, `SECURITY` mode or `SET search_path`. Assertion: `proacl`, `provolatile`, `prosecdef` and `proconfig` for every touched function are string-equal before and after its migration (captured by the re-body diff script below).

### Classification (applied per function, recorded in Appendix A)

| Class | Rule | Action |
|---|---|---|
| **DECIDE** | Compares/derives a calendar date or instant to choose behaviour | → `app_now()` / `app_today()` |
| **STAMP-FEEDS** | A stamp later read back by a DECIDE path (revenue month, expiry, `next_credit_note_ref` year, `enrolled_at`, `deactivated_at` → `mark_day_holiday`) | → `app_now()` |
| **STAMP** | Pure audit/record stamp, never read back for a decision | stays `now()` |
| **REAL-TIME** | Security or delivery windows | stays `now()`, line marked `-- clock-real: <why>` |

- **⚠ RISK 6 MITIGATION — "read back" is decided by a census, not by memory (step).** For every `*_at` column a function writes with `now()`, run all three of these and record the readers in Appendix A beside the function:
  - `grep -rn "<column>" supabase/functions SwimSyncApp/lib SwimSyncAdmin/lib SwimSyncAdmin/app`
  - a `prosrc ~ '<column>'` query over `pg_proc`
  - a `pg_views` query for the column
  A column with any reader that compares it to a date is STAMP-FEEDS.
- **⚠ RISK 6 MITIGATION — column defaults (step + assertion).** Appendix A gets a column-default census: the 23 non-`created_at`/`updated_at` columns with `DEFAULT now()` (list below). For each one a DECIDE path reads, lane1 picks one of:
  - (a) `ALTER COLUMN … SET DEFAULT app_now()` in M3. This is prod-identical, and allowed only because every inserting role holds EXECUTE. Assertion in `app_clock.test.sql`: for every column whose default mentions `app_now`, every role with `INSERT` on that table has `EXECUTE` on `app_now()`.
  - (b) Stays `now()`, and Appendix A names it. Lane2's conversion step sets it explicitly in every pinned file that inserts into that table.
  Do NOT change `created_at`/`updated_at` defaults. Tests needing an old `tenants.created_at` set it explicitly (§7.277).
- **⚠ RISK 6 MITIGATION — a frozen clock census (assertion, structural).** `app_clock.test.sql` asserts with `results_eq` that the set of `(proname, number of raw clock tokens in prosrc)` over `public` functions equals a literal table that lane1 writes at the end of M5. Raw clock tokens are `now()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `CURRENT_TIME`, `LOCALTIMESTAMP`, `clock_timestamp`, `statement_timestamp`, `transaction_timestamp`, `'now'` and `'today'`. Any new raw clock read, in any migration, by any route, goes red and names the function. It also asserts that no `public` function other than `app_now` mentions `swimsync.now` or calls `set_config`. That second check guarantees no client-reachable path can set the pin.

## Migrations (lane1, root checkout, one `db/wave7-…` branch each)

| # | Migration | Contents | Gate before next |
|---|---|---|---|
| M1 | `…_app_clock` | `private` schema + flag table + REVOKEs, `app_now()`, `app_today()`, grants; re-body `today_sg()`, `session_window_start()`; seed row in `seed.sql`; **pgTAP `app_clock.test.sql`** + **`tests/http/app_clock_locks.sh`** | see M1 gate below |
| M2 | `…_clock_decide_ops` | Non-billing DECIDE functions that read `now()` directly: `student_package_coverage`, `suggest_package_start`, `package_renewal_candidates`, `platform_tenant_overview`, `tenant_unmarked_lesson_count` (`now_time`), referral expiry family (`apply_referral_reward`, `family_has_usable_reward`, `grant_referral_reward`, `settle_referral_reward`) | green + Deno ×2 + prod gate |
| M3 | `…_clock_stamp_feeds` | STAMP-FEEDS: `enforce_parent_package_lifecycle.confirmed_at`, `next_credit_note_ref`, **`enrolment_start_at`'s `RETURN NOW()`**, **`deactivate_class.deactivated_at`** (if the census confirms `mark_day_holiday` reads it), the column defaults chosen as (a), plus any others found by Appendix A | green + Deno ×2 + prod gate |
| M4 | `…_clock_billing_guards` | **Last.** Any billing-guard path not already covered by M1 (`assert_markable_date`, `guard_*_date`, `enrolment_start_at`, D6 guard `guard_package_draw_order`): verify each routes through `app_*` and convert stragglers; **Deno ×2** | green + Deno ×2 + prod gate |
| M5 | (if Appendix A finds more) | stragglers; then freeze the clock census literal in `app_clock.test.sql` | green + prod gate |

**Every migration Mn follows this sequence. Each line is a step; do not skip or reorder.**

1. **⚠ RISK 1 MITIGATION — capture before (step).** Run `pg_get_functiondef`, `proacl`, `provolatile`, `prosecdef` and `proconfig` for every function Mn touches. Save them to the scratchpad `before/<fn>.sql` from the live local DB.
2. **⚠ RISK 1 MITIGATION — prod parity (assertion).** Run `scripts/prod-query-ro.sh "select string_agg(proname||':'||md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in (<Mn's functions>)"` as a **bare command** (no cd/&&). Run the same query locally. **Equal → proceed. Unequal → STOP.** Prod holds a body that local does not, and `CREATE OR REPLACE` would revert it.
3. **⚠ RISK 1 MITIGATION — mechanical re-body (prohibition + step).** Each new body is `before/<fn>.sql` with only clock tokens substituted (`now()`→`app_now()`, `today_sg()`→`app_today()` where classified DECIDE/STAMP-FEEDS). Do NOT copy a body from any file under `supabase/migrations/`. Do NOT fix, reformat, re-comment or "improve" anything else in a re-bodied function in this wave; file it in BACKLOG.
4. Write `supabase/rollback/<ts>_<name>_DOWN.sql`. **⚠ RISK 5 MITIGATION (prohibition + structural guard).** A DOWN restores bodies from `before/` byte-identically and **never drops `app_now()`, `app_today()`, the flag table or `private`**. Those objects are harmless when unused, and dropping them breaks every caller at runtime: `sql`/`plpgsql` bodies are not dependency-tracked, so `DROP` succeeds. M1's DOWN starts with a `DO` block that `RAISE`s if any `public` function other than `app_now`/`app_today` still has `prosrc ~ 'app_(now|today)\('` after the restore. The DOWNs of M5→M2 must run before M1's.
5. HOLD lane2 → `supabase migration up`.
6. **M1 only — ⚠ RISK 4 MITIGATION (step).** `migration up` does not run `seed.sql`, so insert the row by hand right after: `docker exec -i supabase_db_SwimSync psql -U postgres -c "INSERT INTO private.clock_override_enabled VALUES (true) ON CONFLICT DO NOTHING"`. Assertion: `SELECT count(*) FROM private.clock_override_enabled` = 1. Without it every pin raises (by design) on the shared DB.
7. **⚠ RISK 1 MITIGATION — normalized diff proof (assertion).** Capture `after/` the same way. Normalise `app_now()`→`now()` and `app_today()`→`today_sg()` in `after/`, then `diff -r before/ after/`. **The only permitted differences are none.** For M1's two helpers the only permitted difference is the one token in each body. Also check `proacl`/`provolatile`/`prosecdef`/`proconfig`: zero differences. The touched-function count must equal the Appendix A row count for Mn.
8. **⚠ RISK 5 MITIGATION — rollback rehearsal without `db reset` (step).** Under the same HOLD, in ONE psql session: `BEGIN; \i <DOWN>;` → dump `pg_get_functiondef` for Mn's functions → must be byte-identical to `before/` → `ROLLBACK;`. Record the result in the commit message. This replaces `/deploy`'s three `db reset` cycles for this wave only, because lane2 is live. The pre-migration test re-run is covered by step 9 running the full suite.
9. RESUME lane2. Run `supabase test db` (all files, green) and `supabase/tests/http/app_clock_locks.sh` (M1 onward). Then `supabase/functions/generate-invoices/test.sh` **twice** (M1–M4; §7.15).
10. **⚠ RISK 8 MITIGATION — billing window (assertion).** Before `db push`: SGT time is outside 00:30–02:00 (the 01:00 SGT cron). The bare `scripts/prod-query-ro.sh "select count(*) from billing_runs where ran_at > now() - interval '15 minutes'"` = 0. Otherwise wait.
11. **⚠ RISK 8 MITIGATION — deploy order, §7.60 (step order).** Merge `db/wave7-…` into local `main` → `/deploy` (migrations only: `supabase db push` → `supabase migration list --linked` shows 0 pending) → prod gate below → THEN `git push origin main` (after the §RISK 8 diff assertion in *Rules*). Do NOT pass `--include-seed` to any `supabase db push`. Do NOT run any `supabase db reset --linked`.
12. **Prod gate (assertions, each one bare `scripts/prod-query-ro.sh` call):**
    - `select count(*) from private.clock_override_enabled` = 0.
    - `select abs(extract(epoch from app_now() - now())) < 1` = true.
    - `select app_today() = (now() AT TIME ZONE 'Asia/Singapore')::date` = true.
    - `select has_function_privilege('anon','public.app_now()','EXECUTE') or has_function_privilege('anon','public.app_today()','EXECUTE')` = false.
    - `select has_function_privilege('authenticated','public.app_now()','EXECUTE') and has_function_privilege('authenticated','public.today_sg()','EXECUTE')` = true.
    - `select has_table_privilege(r,'private.clock_override_enabled','INSERT') from unnest(array['anon','authenticated','service_role']) r` = all false.
    - Repeat step 2's md5 query, now against `after/`: equal to local.
13. **M1 only — ⚠ RISK 3 MITIGATION (assertion, before writing M1).** Two bare prod reads must hold. If either fails, stop and rename the schema.
    - `select count(*) from pg_namespace where nspname='private'` = 0.
    - `select rolconfig from pg_roles where rolname='authenticator'` does not list `private` in any `pgrst.db_schemas`.
    The prod API dashboard's exposed schemas must also be `public, graphql_public`; the user checks this once.
14. After M1 and after the last migration: a remote grant dump (§7.39, DEPLOYMENT §11.7). `supabase db dump --file <scratch>/p.sql && grep -E '(GRANT|REVOKE).*(app_now|app_today|clock_override)' <scratch>/p.sql` shows no `"anon"` grant on either function and no grant at all on the flag table.

**M1 gate:** steps 1–14 and `app_clock.test.sql` green. That file contains:
- the flag row exists (it would be red if seed or step 6 was skipped);
- unpinned `app_now()` = `now()`;
- pinned `app_now()` = the pin, and `app_today()` = its SGT date;
- with the flag row deleted in-transaction, a pinned `app_now()` `throws_ok` (lock 1, proven red by removing the `NOT EXISTS` branch under HOLD);
- an offset-less pin `throws_ok`;
- under `SET LOCAL ROLE authenticated`, `today_sg()` returns the pinned date (proves the invoker chain has its grants);
- ACL parity;
- the frozen clock census (populated at M5; until then it asserts only the `set_config`/`swimsync.now` rule).

## CI guards (lane2)

| Guard | Rule | Opt-out |
|---|---|---|
| G1 `scripts/check-pgtap-clock.sh` | Every `supabase/tests/*.test.sql` that mentions a date, `now()`, `today_sg`, `session_window_start`, `markable_floor`, `app_today` **must** contain the pin | file-level `-- clock-free: <reason>` (non-empty) |
| G2 `scripts/check-migration-clock.sh` | A migration newer than M4's timestamp may not contain a raw clock token except on a line marked `-- clock: stamp` or `-- clock-real: <why>` | the markers |
| G3 `scripts/check-functions-sg-date.sh` (folded BACKLOG S) | `supabase/functions/**` (non-test) may not `slice(0, 10)` / `split("T")[0]` a timestamp | allowlist: `dates.ts formatDate`, `public-package validUntilPreview`; line marker `// utc-date-ok: <why>` |
| G4 `scripts/check-test-dates.sh` | **Skips** files that pin the clock (their literals cannot expire); still guards UI fixtures | — |

- **⚠ RISK 4 MITIGATION — G1 checks the pin's exact form, not its presence (assertion).** A file passes G1 only if:
  - the first non-comment statement after `BEGIN;` matches `^SELECT set_config\('swimsync\.now', '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?[+-][0-9]{2}(:?[0-9]{2})?', true\);$`. That rules out a missing offset, `false`, and a pin placed before `BEGIN` or in a comment.
  - the next statement is `SELECT is(app_today(), '<same date>'::date, 'clock pinned');`, which is red if the pin is silently ignored.
  - outside lines marked `-- clock: stamp`, the file contains no raw `now()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP` or `session_window_start()` arithmetic. Tests read `app_now()`/`app_today()` or literals only.
- **⚠ RISK 6 MITIGATION — G2 token list (assertion).** G2's token list = the census list: `now()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `CURRENT_TIME`, `LOCALTIMESTAMP`, `clock_timestamp`, `statement_timestamp`, `transaction_timestamp`, `'now'`, `'today'`, case-insensitive. Proven red on a synthetic migration for **each** token. G2 is the early warning; the pgTAP clock census is the backstop that cannot be routed around.
- **⚠ RISK 9 MITIGATION — G4 uses G1's predicate (prohibition).** Do NOT give G4 its own "is pinned" test. G4 sources the one function from G1 (`scripts/lib/pgtap-pin.sh` or equivalent), so a file skips G4 only if it passes G1's full form. Red-proof: a file with `set_config('swimsync.now'` only in a comment and a future literal → G4 red.
- **⚠ RISK 9 MITIGATION — G3 allowlist is exact (assertion).** The allowlist matches file + function name, not file alone. Red against `41d9676^` (`core.ts:699`). A new `slice(0, 10)` added beside `formatDate` in `dates.ts` must still go red.
- Each guard is proven red (G1 on an unconverted file, G2 per token, G3 against `41d9676^`, G4 as above) and wired into `.github/workflows/ci.yml` beside `check-test-dates.sh`. G1/G2 are wired with `continue-on-error: true` until T5. **⚠ RISK 9 MITIGATION (assertion at T6):** `grep -n "continue-on-error" .github/workflows/ci.yml` has no hit on a G1–G4 step.

## pgTAP conversion (lane2)

- **All files on G1's hit list** (82 today vs the plan's 80; G1's list is the fact, and lane2 reports the reconciliation in DONE T1). They go in batches that lane1 releases as the functions they exercise are converted (Appendix B maps file → functions). For each file:
  - pin `swimsync.now` to a fixed day;
  - replace derived dates (`td` tables, `session_window_start()` arithmetic) with literals relative to that day;
  - **delete** every `-- date-literal-ok:` marker the pin makes moot.
- **⚠ RISK 7 MITIGATION — batch precondition (assertion).** Before converting a batch, lane2 runs for every function in its Appendix B rows: `SELECT proname FROM pg_proc WHERE proname IN (…) AND prosrc !~ '(app_now|app_today|today_sg|session_window_start|markable_floor)\('` minus Appendix A's STAMP/REAL-TIME entries. **Must return zero rows**, else `BLOCKED <n>: <fn> not converted`. A test pinned against an unconverted function passes on the real clock today and expires later.
- **⚠ RISK 4 MITIGATION — names, not just counts (assertion).** Before converting each file, lane2 records its TAP output (`pg_prove -v` or `supabase test db` verbose) to the scratchpad. After converting, **the ordered list of assertion descriptions is identical and the `plan(n)` is unchanged**. Exceptions are the one added `clock pinned` assertion and descriptions that only renamed a date, each listed in DONE.
- **⚠ RISK 4 MITIGATION — the pin is load-bearing (step, §7.25 for the conversion itself).** Per batch, lane2 copies each converted file to the scratchpad with the pin moved **+3 months** and runs it.
  - Every file that writes through a guarded path (Appendix B marks these) **must go red**.
  - A guarded file that stays green is either unconverted or not testing the guard: `BLOCKED`.
  - Record the red/green table in the handoff file.
  - This is run in a scratch copy only. Do NOT commit a shifted pin.
- **⚠ RISK 6 MITIGATION — column-default choice (b) (step).** In every pinned file, an `INSERT` into a table whose decision-feeding column stayed `DEFAULT now()` (Appendix A, choice b) sets that column explicitly to a value relative to the pin.
- **Edge-day file** `app_clock_edges.test.sql` covers the same assertions on the 1st of a month, 2028-02-29, the day before a month's first Saturday, and 07:59 SGT (UTC still yesterday, §7.7). It runs over `markable_floor`, `assert_markable_date`, `class_unmarked_lesson_pairs`, `enrolment_start_bounds` and `student_package_coverage`.
  - **⚠ RISK 4 MITIGATION (step):** the file runs `SET LOCAL TimeZone = 'UTC';` after `BEGIN`, so its red-proof does not depend on the server's or the Mac's zone (§7.315).
  - Red-proof: temporarily replace `app_today()` with `SELECT app_now()::date` under HOLD → the 07:59 case goes red → restore → byte-identical check.
  - **⚠ RISK 4 MITIGATION (prohibition):** do NOT use the seed tenant. Each edge creates its own tenant in-transaction with `created_at` explicitly before its pin and no `billing_periods` rows. The shared DB may hold sealed months from drivers/Deno, which would clamp `markable_floor` locally but not in CI.
- **Future pins**: a pin after the tenant's real `created_at` clamps the floor (§7.277). Such files set `tenants.created_at` explicitly, or pin a past/current day. Each file asserts `markable_floor(<tenant>)` equals the expected floor before relying on it.

## Lanes

### lane1 — root checkout, orchestrator (this session)

**Owns:** classification (Appendix A), M1–M5 and their DOWN files, `seed.sql`, `app_clock.test.sql`, `tests/http/app_clock_locks.sh`, every `main` merge and push, every prod deploy and prod read, `GOTCHAS.md` / `TESTING.md` / `ARCHITECTURE.md` / `DEPLOYMENT.md`, BACKLOG (strike the two items; file *Pin the clock for UI drivers*), HANDOVER via `/update-docs`.

**Orchestration loop:**
1. Send lane2 a task: `TASK <n>: <scope> | base <sha> | done when <assertion>`.
2. Continue own work. Any shared-DB DDL goes through `HOLD`/`HELD`/`RESUME`.
3. On lane2's `DONE <n>: branch <b> @ <sha> | <counts> | names-identical: yes/no | pin-shift: <red>/<guarded> | findings: …`:
   - review the diff;
   - run `supabase test db`;
   - run the §RISK 8 path assertion;
   - merge to `main`, push, reply `MERGED <n> @ <sha>` (+ next task).
   **⚠ RISK 4 MITIGATION (prohibition):** do NOT merge a DONE that reports `names-identical: no` without a per-file justification, or `pin-shift` red < guarded.
4. On lane2's `BLOCKED <n>: …` (e.g. a function not yet converted, a bug found), answer or land the fix first. Wave 3/4 rule: a confirmed bug stops the lane until fixed.

### lane2 — worktree `wave7-tests` (`/worktree-start` after this plan is committed)

**Owns:** G1–G4, the pgTAP conversions, `app_clock_edges.test.sql`, `docs/handoff/wave7-tests.md` at close.
**Never:** migrations, `main`, prod, HANDOVER/PRD/BACKLOG, `db reset`, full driver sweeps, any DB-backed run between `HELD` and `RESUME`.
**Reports** with `SendMessage` to `lane1` in the formats above; asks the user for the click on each DB-backed run.

### Task schedule

| Task | lane1 | lane2 | Depends on |
|---|---|---|---|
| T0 | Commit plan; `/worktree-start wave7-tests`; send T1 | — | — |
| T1 | Appendix A classification + reader census + column-default census; prod reads (step 13); write M1 + DOWN + `app_clock.test.sql` + `app_clock_locks.sh` | G1, G2, G3, G4 (scripts only, no DB); reconcile G1 hit count vs 80 | — |
| T2 | M1 through steps 1–14 (incl. flag-row insert, Deno ×2) | — (HELD during migration up / red-proofs) | T1 |
| T3 | M2, M3 (each steps 1–14) | Batch 1: files whose functions route through `today_sg` / floor (Appendix B), with precondition + names + pin-shift | M1 on prod and main |
| T4 | M4 (+Deno ×2), M5; freeze clock census | Batch 2 (M2/M3 functions) + edge-day file | M2/M3 on prod and main |
| T5 | Turn G1/G2 on in CI as **required** (remove `continue-on-error`) | Batch 3 (billing guards) | M4 on prod and main, all files converted |
| T6 | Full `supabase test db`, `app_clock_locks.sh`, Deno ×2, vitest/jest/typecheck, fixture roundtrip; prod grant dump (§7.39) | `/worktree-close` → handoff file | all |
| T7 | `/update-docs` | — | T6 |

## Definition of done

1. On prod:
   - `private.clock_override_enabled` is empty;
   - `app_now()` equals `now()`;
   - every M1–M5 function's md5 equals local;
   - the grant dump shows no new privilege for anon, and for authenticated/service_role only EXECUTE on `app_now`/`app_today`;
   - the flag table has no grants.
2. Lock 1 is proven in `app_clock.test.sql`, and lock 2 in `tests/http/app_clock_locks.sh` (CI). Each is shown red when removed, with byte-identical restore.
3. Every G1-hit pgTAP file pins the clock in G1's exact form and asserts `clock pinned`. `-- date-literal-ok:` markers in pgTAP are gone, and there are no `td` tables. Assertion names and plan counts per file are unchanged (exceptions listed). The pin-shift table is recorded.
4. G1–G4 are in CI, each proven red; G1/G2 are required (no `continue-on-error`).
5. pgTAP count ≥ before. The frozen clock census is green. Deno is green twice. vitest/jest/typecheck are green. Fixture roundtrip is green.
6. Every Mn has a committed DOWN rehearsed byte-identical (step 8), and no DOWN drops `app_now`/`app_today`.
7. No file under `SwimSyncApp/` / `SwimSyncAdmin/` changed; `supabase/functions/` changed in comment lines only.
8. BACKLOG: both items struck; *Pin the clock for UI drivers* filed with the four-clock analysis.

## Time

lane1: ~3½–4½ days (classification + censuses ¾, M1 1¼ incl. locks script, M2–M4 1½, close ½–1). lane2: ~5½–7½ days (guards 1, files 4–5 incl. names/pin-shift proofs, edges ½–¾). Wall clock ~1–1.5 weeks with both lanes.

## Known consequences

- A pinned test's `now()` stamps are real (e.g. `created_at` today while the test "is" 2026-09-15). Anything a decision reads back is converted (STAMP-FEEDS, column defaults choice a) or set explicitly (choice b). Anything else is harmless by classification.
- Future pins clamp `markable_floor` unless the test sets `tenants.created_at` (§7.277).
- UI drivers still run on the real clock (D2). PostgREST and the engine can never pin (lock 2), so Deno and drivers are unaffected.
- On prod, a direct SQL session that sets `swimsync.now` gets an exception, not a moved clock. Nothing on prod sets it; the census asserts no function does.

## Appendix A — classification (lane1, T1 — FINAL, censused 2026-10-06 against the live local DB)

**Census method.** Function bodies from `pg_get_functiondef` (§7.40), never from migration files. Raw clock regex = the
plan's token list, case-insensitive. **71** `public` functions match (raw token or a helper call) — equal to the
preliminary count. **0** views, **0** RLS policies, **0** CHECK constraints, and no function in any other app schema
read a clock, so the 71 functions + the column defaults below are the whole surface. No touched function is
overloaded (only `session_pay_amount` is, and it reads no clock).

**Reader rule applied.** App / engine readers (`SwimSyncApp`, `SwimSyncAdmin`, `supabase/functions`) can never pin
(D2, lock 2), so they cannot make a stamp STAMP-FEEDS. Only a **DB** reader that compares the stamp to a date/month
does. A reader that only tests `IS [NOT] NULL`, `IS DISTINCT FROM`, or `ORDER BY`s it (FIFO) leaves it STAMP.

### Final per-migration lists (row count = step 7's touched-function count)

| Mn | Function | Token(s) that move | Why |
|---|---|---|---|
| M1 | `today_sg` | its one `now()` | the lever — every caller converts |
| M1 | `session_window_start` | its one `now()` | the lever — `markable_floor`, `markable_window_start` and callers convert |
| M2 | `student_package_coverage` | 4× `(now() AT TIME ZONE …)::date` | DECIDE: covered/expiring as of today |
| M2 | `suggest_package_start` | 1× | DECIDE |
| M2 | `package_renewal_candidates` | 1× (the `today` CTE) | DECIDE |
| M2 | `platform_tenant_overview` | 3× (month boundaries) | DECIDE |
| M2 | `tenant_unmarked_lesson_count` | 1× (`now_time`) | DECIDE (time of day); its date part is M1 |
| M2 | `apply_referral_reward` | `expires_at > now()` | DECIDE |
| M2 | `family_has_usable_reward` | 2× `expires_at > now()` | DECIDE |
| M2 | `grant_referral_reward` | `now() + expiry_days` | STAMP-FEEDS (expiry read by the three above) |
| M2 | `settle_referral_reward` | lines `expires_at <= now()` ×2 and `now() + expiry_days` ×1 — **NOT** `used_at`/`converted_at` (STAMP) | DECIDE + its expiry stamp; kept with its family in M2 |
| M3 | `enforce_parent_package_lifecycle` | the 2 `confirmed_at` lines — **NOT** the 2 `cancelled_at` lines (STAMP) | STAMP-FEEDS: `accounting_summary` revenue month, `record_package_refund` paid-on date, its own `start_date` default |
| M3 | `next_credit_note_ref` | `to_char(NOW(),'YYYY')` | STAMP-FEEDS: the ref's year |
| M3 | `enrolment_start_at` | `RETURN NOW();` | STAMP-FEEDS → `enrolled_at` |
| M3 | `deactivate_class` | `deactivated_at = NOW()` — **NOT** `updated_at` | STAMP-FEEDS: `mark_day_holiday`, `guard_package_draw_order`, `tenant_unmarked_lesson_count` compare its SGT date |
| M3 | `close_student_enrolment` | `unenrolled_at = NOW()` — **NOT** `updated_at` | STAMP-FEEDS (readers below) |
| M3 | `set_students_active` | `unenrolled_at = NOW()` — **NOT** `inactivated_at`/`updated_at` | STAMP-FEEDS |
| M3 | `reassign_student_tenant` | `unenrolled_at = NOW()` — **NOT** `updated_at` | STAMP-FEEDS |
| M4 | *(none expected)* | — | every billing guard (`assert_markable_date`, `guard_attendance_date`, `guard_session_date`, `guard_package_draw_order`, `enrolment_start_bounds`) has **0 raw tokens** and reads only the helpers → converted by M1. M4 re-verifies after M3 and is a no-op migration unless a straggler appears |

M1–M3 = **2 + 9 + 7 = 18 functions**, plus 2 column defaults (M3).

### Reader census (DB readers that compare the stamp to a date)

| Column (writer) | DB date-readers | Class |
|---|---|---|
| `student_class_enrolments.unenrolled_at` (`close_student_enrolment`, `set_students_active`, `reassign_student_tenant`) | `apply_cancel_reconcile`, `assert_class_retirable`, `class_expected_count`, `class_unmarked_lesson_pairs`, `mark_day_holiday`, `set_enrolment_start`, `tenant_unmarked_lesson_count` | **STAMP-FEEDS** (M3) |
| `student_class_enrolments.enrolled_at` (`enrolment_start_at`, column default) | same set + `set_enrolment_start` | **STAMP-FEEDS** (M3) |
| `classes.deactivated_at` (`deactivate_class`) | `mark_day_holiday`, `guard_package_draw_order`, `tenant_unmarked_lesson_count` | **STAMP-FEEDS** (M3) |
| `parent_packages.confirmed_at` (`enforce_parent_package_lifecycle`) | `accounting_summary` (month), `record_package_refund` (paid-on), itself (`start_date`) | **STAMP-FEEDS** (M3) |
| `parent_packages.requested_at` (column default) | `assign_parent_package_reference` (`PKG-YYYY` year) | **STAMP-FEEDS** → default (a) |
| `referral_rewards.expires_at` (`grant_`/`settle_referral_reward`) | `apply_`/`family_has_usable_`/`settle_referral_reward` | **STAMP-FEEDS** (M2) |
| `credit_notes.issued_at`, `referral_rewards.earned_at`, `makeup_bookings.booked_at`, `credit_applications.applied_at` | `ORDER BY` only (FIFO) | STAMP |
| `invoices.paid_at` (`confirm_invoice_paid`, also its `RETURN NOW()`), `paid_claimed_at`, `cancelled_at` (all writers), `disabled_at`, `admin_disabled_at`, `suspended_at`, `inactivated_at`, `decided_at`, `dismissed_at`, `ended_at`, `generated_at`, `graded_at`, `reversed_at`, `debited_at`, `folded_at`, `written_off_at`, `used_at`, `converted_at`, `voided_at`, `referral_code_disabled_at`, `offered_at` | `IS [NOT] NULL` / `IS DISTINCT FROM` / display only; app & engine readers cannot pin | STAMP |
| `staff_invitations.expires_at`/`consumed_at` (`handle_new_user`); `email_claimed_at`, `invoice_email_claimed_at` (`claim_*_email`); `email_delivery_state` | security / delivery windows | **REAL-TIME** — never moves; M5 marks each line `-- clock-real:` only if a later migration re-bodies them (not in this wave: re-bodying them would be a non-clock edit, step 3) |

So the preliminary "to verify" list resolves as: `deactivate_class` → M3 (confirmed); `close_student_enrolment`,
`set_students_active`, `reassign_student_tenant` (`unenrolled_at` only) → M3; `confirm_invoice_paid`, `disable_coach`,
`suspend_tenant`, `handle_attendance_update`, `set_students_active.inactivated_at` → **STAMP** (no DB date-reader).

### Column-default census (23 non-`created_at`/`updated_at` `DEFAULT now()` columns)

| Column | DB date-reader | Class / choice |
|---|---|---|
| `student_class_enrolments.enrolled_at` | the unenrolled_at set above | STAMP-FEEDS → **(a)** `SET DEFAULT app_now()` in M3. INSERT holders: authenticated, service_role (anon: none) — both get EXECUTE in M1 |
| `parent_packages.requested_at` | `assign_parent_package_reference` (year) | STAMP-FEEDS → **(a)** in M3. INSERT holders: authenticated, service_role (anon: none) |
| `staff_invitations.expires_at` | `handle_new_user` | **REAL-TIME** — never moves |
| `attendance.marked_at`, `billing_periods.completed_at`, `billing_runs.ran_at`, `class_shadow_coaches.assigned_at`, `coach_payouts.generated_at`, `credit_applications.applied_at`, `credit_notes.issued_at`, `invoices.generated_at`, `makeup_bookings.booked_at`, `package_applications.applied_at`, `package_refunds.recorded_at`, `parent_tenants.joined_at`, `payment_records.paid_at`, `referral_rewards.earned_at`, `session_coach_absences.marked_at`, `session_coaches.assigned_at`, `session_pay_overrides.set_at`, `student_settlements.recorded_at`, `student_skill_progress.graded_at`, `trial_bookings.booked_at` (20) | none (ordering or display only) | STAMP — stays `now()`; no choice (b) needed |

**Choice (b) list for lane2: empty.** No pinned file needs to set a defaulted stamp explicitly — the two
decision-feeding defaults move with (a).

### Preliminary scan (kept for the record)

71 public functions read a clock (incl. the helpers); 24 call `today_sg`/`session_window_start`/`markable_floor`/`markable_window_start`. Preliminary:
- **Via helpers (converted by M1):** `assert_class_retirable`, `assert_markable_date` (SECURITY INVOKER — see ACL parity), `assign_class_shadow`, `book_makeup`, `book_trial`, `cancel_lesson`, `class_unmarked_lesson_pairs`, `coach_is_active_class_shadow`, `disable_coach`, `end_class_shadow`, `enrolment_start_bounds`, `guard_attendance_date`, `guard_session_date`, `guard_package_draw_order`, `markable_floor`, `markable_window_start`, `record_package_refund`, `restore_lesson`, `schedule_extra_lesson`, `set_class_terms`, `set_enrolment_start`, `sync_class_display_price`, `tenant_unmarked_lesson_count` (date part). `enrolment_start_at` is only PARTLY converted by M1: its `RETURN NOW()` moves in M3.
- **DECIDE, direct `now()` (M2):** listed in M2.
- **STAMP-FEEDS (M3):**
  - certain: `enforce_parent_package_lifecycle` (`confirmed_at`), `next_credit_note_ref`, `enrolment_start_at` (`RETURN NOW()` → `enrolled_at`);
  - to verify by the reader census: `deactivate_class.deactivated_at` (`mark_day_holiday` compares `deactivated_at::date`), `confirm_invoice_paid.paid_at`, `close_student_enrolment.unenrolled_at`, `set_students_active.unenrolled_at`/`inactivated_at`, `reassign_student_tenant.unenrolled_at`, `disable_coach.disabled_at`, `suspend_tenant.suspended_at`, `handle_attendance_update` (`issued_at`, `applied_at`).
- **Column-default census (non-`created_at`/`updated_at`, `DEFAULT now()`):** `attendance.marked_at`, `billing_periods.completed_at`, `billing_runs.ran_at`, `class_shadow_coaches.assigned_at`, `coach_payouts.generated_at`, `credit_applications.applied_at`, `credit_notes.issued_at`, `invoices.generated_at`, `makeup_bookings.booked_at`, `package_applications.applied_at`, `package_refunds.recorded_at`, `parent_packages.requested_at`, `parent_tenants.joined_at`, `payment_records.paid_at`, `referral_rewards.earned_at`, `session_coach_absences.marked_at`, `session_coaches.assigned_at`, `session_pay_overrides.set_at`, `staff_invitations.expires_at` (REAL-TIME — never moves), `student_class_enrolments.enrolled_at`, `student_settlements.recorded_at`, `student_skill_progress.graded_at`, `trial_bookings.booked_at`. Each gets a class and, if read by a decision, choice (a) or (b).
- **REAL-TIME:** `handle_new_user` (invitation expiry), `email_delivery_state`, `claim_invoice_email`, `claim_credit_note_email`.
- **STAMP:** the rest.

## Appendix B — file → function map (lane1 builds at T1, hands to lane2 with T3)

Each row: file · functions exercised · **guarded path? (y/n)**, which drives the pin-shift expectation · tables inserted that carry a choice-(b) default.

## Pre-commit gate (walk before every commit in this wave; an unticked box is a blocker)

**Highest value. Never skip:**
- [ ] RISK 1: normalized `before/`→`after/` diff is empty (helpers: one token), ACL/volatility/definer/config unchanged, and the prod md5 matched local **before** the push and **after** it.
- [ ] RISK 2: ACL parity assertion green. Prod reads: anon cannot execute `app_now`/`app_today`; authenticated can execute both and `today_sg`.
- [ ] RISK 3: `app_clock_locks.sh` green in CI and proven red without lock 2. Prod flag table empty. `private` absent before M1 and not exposed.
- [ ] RISK 4: flag row present locally after `migration up`. Every converted file passes G1's exact form and asserts `clock pinned`. Assertion names identical. Pin-shift red count = guarded count.

**Also:**
- [ ] RISK 5: DOWN rehearsed in-transaction, byte-identical to `before/`, and drops nothing in the clock layer.
- [ ] RISK 6: reader census + column-default census recorded in Appendix A. Clock census frozen and green (from M5). G2 red per token.
- [ ] RISK 7: HOLD/HELD/RESUME exchanged around every shared-DB DDL. Lane2 batch precondition returned zero rows.
- [ ] RISK 8: outside 00:30–02:00 SGT with no billing run in the last 15 min. `db push` + `migration list --linked` before `git push origin main`. Path diff shows no app/engine change. No `--include-seed`.
- [ ] RISK 9: G4 shares G1's predicate. G3 allowlist is function-exact. No `continue-on-error` on G1–G4 after T5.
- [ ] `supabase test db` green; Deno ×2 green (M1–M4); vitest/jest/typecheck green; fixture roundtrip green.
