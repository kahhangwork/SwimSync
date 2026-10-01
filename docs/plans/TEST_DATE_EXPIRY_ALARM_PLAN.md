# Test-date expiry alarm — plan

_Written 2026-10-01 via `/plan-with-confidence` (decisions settled with the user the same day); hardened by
`/plan-review` the same day. Tests + CI + docs only: no migration, no app change, no deploy. Born from the 2026-10-01
reds (GOTCHAS §7.302–§7.304). Root checkout, branch `test/date-expiry-alarm`, no worktree._

## 1. Why

On 2026-10-01 `main` CI went red with no code change: three pgTAP files wrote LITERAL July/August dates through
guarded paths, and the marking floor (`markable_floor()` ≤ `session_window_start()` = 1st of LAST month, SGT) passed
them that morning (§7.303). The fix derived those dates from the floor. Nothing stops the next test from writing a
literal again, and three more pgTAP files already hold dates from 2026-09 to 2027-12.

**The real fix is an injected clock** (the database asks one `app_today()`, tests pin it). That is a 1–2 week product
change touching the billing guards, so the user chose: **build this alarm now, file the injected clock in BACKLOG**
with what the 2026-10-01 discussion established (§6).

## 2. Decisions (settled with the user, 2026-10-01 — do not reopen)

| # | Decision | Answer |
|---|---|---|
| D1 | Approach | **Expiry alarm** (static scan). Time machine (libfaketime) rejected — see §6 |
| D2 | On a hit | **Fail CI on push** |
| D3 | Scope | **pgTAP (`supabase/tests/*.sql`) + UI fixtures (`drivers/fixtures-*.sql`)**. NOT Deno: its tests already inject the clock (`BillingScenario`, `test-helpers.ts`); its 2029 dates are deliberate |
| D4 | Existing hits | **Triage each literal**: guarded → derive from the floor; provably unguarded → annotate |
| D5 | Months | **Flag `'YYYY-MM'` month literals too** (billing months — `generate_coach_payouts(…,'2026-09')` was the same shape) |

## 3. The rule the alarm enforces

On the day it runs, compute the floor exactly as the DB does: **the 1st of last month in Asia/Singapore** (on
2026-10-01 → `2026-09-01`). For every quoted literal date `'YYYY-MM-DD'` (also `'YYYY-MM-DD 12:00…'` /
`'YYYY-MM-DDT…'` timestamp prefixes) and month `'YYYY-MM'` (read as its 1st) in a scanned file:

- **literal < floor → ignore.** If it went through the floor guard the test would already be red; it passes, so it doesn't.
- **literal ≥ floor → FAIL**, unless the same line carries `-- date-literal-ok: <non-empty why>`.

Properties, all checked by the proofs in §5:
- **Never reddens on its own.** The floor only moves forward, so a literal only ever *leaves* the flagged zone. It fires
  on the push that adds a future-dated literal, never mid-month.
- **Comments don't count.** Text after `--` is stripped before matching (the marker is read from the full line).
- **It models ONE clock — the floor.** `today_sg()`/`now()` horizons ("not happened yet", future-booking checks,
  look-back windows) are not modelled; an annotated literal that one of them reads can still expire. That is why U2's
  verdict is a static clock audit, not an experiment alone.
- **It narrows, not removes, the risk.** A wrongly annotated literal still fails CI the day a clock passes it — the
  2026-10-01 failure shape, but rarer and with a written reason on the line.

## 4. Units (one commit per unit, `/commit-review` each)

### U0 — register the plan
- `docs/plans/README.md` row for this plan (`NOT STARTED`) today; committed with the plan file as the branch's first commit.
- ⚠ RISK 9 MITIGATION — assertion: `grep -cE '^305\. ' docs/GOTCHAS.md` = 0 now and again just before U5; non-zero
  → this plan's entry takes the next free number. Never renumber an existing entry.

### U1 — the script, `scripts/check-test-dates.sh`
- Portable bash (macOS bash 3.2 dev + ubuntu CI). Output shape mirrors `check-driver-dates.sh`: file:line list + a
  how-to-fix block (derive from `session_window_start()` with a `td` temp table — point at `trial_onboarding.test.sql` — or annotate).
- Header comment: why it is a guard and not a note (§7.302's lesson), the rule from §3, the blind spots.
- ⚠ RISK 2 MITIGATION (structural — against a vacuous green):
  - Step: resolve the repo root from `$(dirname "$0")/..`, never the cwd.
  - Step: positional file arguments replace the default globs (the proofs use this; CI passes none).
  - Step: always print `scanned P pgTAP + F fixture files, L literals, E exemptions, floor YYYY-MM-DD`.
  - Assertion: **exit 2 if P < 80 or F < 40 or L = 0** (today: 86 pgTAP / 42+ fixtures) — a broken glob or regex fails, not passes.
  - Step: extract literals with `grep -noE` (POSIX ERE); awk only for plain string comparison. Prohibition: no `{n}`
    intervals in awk regexes (mawk on CI ≠ BSD awk on macOS).
  - Step: `set -euo pipefail`; every grep that may legitimately match nothing ends `|| true`.
- ⚠ RISK 3 MITIGATION (structural):
  - Step: month arithmetic uses `$((10#$m))`. Prohibition: no arithmetic on a zero-padded month without `10#` (`09` is
    invalid octal → errors in Aug/Sep).
  - Step: a built-in self-test of `floor_of()` runs on every invocation before scanning: `2026-01→2025-12-01`,
    `2026-08→2026-07-01`, `2026-09→2026-08-01`, `2026-10→2026-09-01`, `2027-01→2026-12-01`; any mismatch → exit 2.
  - Assertion: `TZ=Asia/Singapore date +%z` must print `+0800`, else exit 2 naming tzdata (missing zoneinfo silently gives UTC).
- ⚠ RISK 7 MITIGATION:
  - Step: the test-only override is `CHECK_TEST_DATES_FLOOR=YYYY-MM-DD`; the script **refuses it when `CI` is set** and
    prints `FLOOR OVERRIDDEN` when used.
  - Step: a marker with an empty reason (`-- date-literal-ok:` + only whitespace) counts as a hit.
  - Prohibition: no file-level or block-level opt-out, no marker on an adjacent line — the literal's own line only.
- ⚠ RISK 8 MITIGATION — step: the header lists the blind spots verbatim: dates built by concatenation or `make_date()`;
  dates in double quotes inside a single-quoted JSON string; a `--` inside a string literal (hides the rest of that line);
  `seed.sql` and SQL inside driver `.mjs` files (out of scope, D3); Deno (D3); `today_sg()`-relative horizons (§3).

### U2 — triage the existing hits
Run U1 on `main`. Expected hits: `partial_payment_followups` (12 lines), `package_weeks_start_date` (9), `coach_wages`
(17) — counted 2026-10-01; the run is the fact. Fixtures: expected 0. For **each** flagged line:
1. **Read the path:** which role writes it (superuser / `service_role` / `SET LOCAL ROLE authenticated`) and through
   what (RPC, trigger, pure function, plain insert, stored setting like `effective_from`). An expected-value literal
   (`DATE '2026-11-10'` in an `is()`) shares the verdict of the input it checks. Prohibition: never derive one and leave the other literal.
2. ⚠ RISK 1 MITIGATION — **static clock audit (the verdict):**
   - Step: for every function/trigger on the path, read the body from the database —
     `SELECT pg_get_functiondef('public.<fn>'::regproc)` (§7.40). Do NOT read it from a migration file.
   - Step: list every read of `now()`, `CURRENT_DATE`, `today_sg()`, `session_window_start()`, `markable_floor()`;
     classify each as **stamp** (written to a `*_at` column) or **decision** (compared with a date); note role gates
     (e.g. `guard_session_date` / `guard_attendance_date`'s `IF current_user <> 'authenticated'`).
   - Assertion: **"unguarded" = every clock read on the path is a stamp or skipped for the role the test uses.**
     Anything else, or any doubt → derive.
   - Prohibition: do NOT annotate on the pin experiment alone — it cannot move `today_sg()`.
   - Step: record a table in the U2 commit message: file:line → role → functions/triggers → clock reads → verdict.
3. ⚠ RISK 5 MITIGATION — **confirm by experiment, inside the file's own transaction:**
   - Step: copy the file to the scratchpad, insert `CREATE OR REPLACE FUNCTION public.session_window_start() … SELECT
     DATE '<1st of the month after the literal>'` right after its `BEGIN;`, and run the copy with `psql` in
     `supabase_db_SwimSync`. The file's own `ROLLBACK;` undoes the pin — no trap needed, no sibling ever sees it.
   - Prohibition: do NOT `CREATE OR REPLACE` on the shared DB outside a transaction that rolls back.
   - Assertion: the file starts `BEGIN;` and ends `ROLLBACK;` (true for all three today).
   - Assertion: `pg_get_functiondef('public.session_window_start'::regproc)` captured before = after (empty diff).
   - Reading it: a refusal naming the floor ("is closed", "cannot be booked before") = guarded. ⚠ A file whose OTHER
     dates must be in the past reddens by construction under a future pin (§7.303) — read the failing assertion's
     message, not the count.
4. **Guarded → derive** (the `td` pattern from `78589c7`), keeping weekday, month and order. **Unguarded → annotate**
   with the gate the audit found (`-- date-literal-ok: superuser insert; guard_session_date skips non-authenticated` /
   `pure function` / `rate effective_from, read only for its session_date`).
   - ⚠ RISK 4 MITIGATION:
     - Assertion: `SELECT plan(N)` and the per-file `ok` count are identical before and after (record both numbers).
     - Assertion: every derived **guarded** date lies in `[floor, floor + 27 days]` — ≤ today on every day of the
       month. A larger offset needs a §7.304-style sweep over every day of 2026–27.
     - Prohibition: an expected value is never read back from the row/function under test; compute it from the test's
       own `td` constants (e.g. `td.start + 70`).
     - Step: per derived file, one mutation (break the expected value, or the product rule inside the transaction) →
       red; revert; record it in the commit message (§7.25, §7.299).
5. Run each touched file in real time AND with the floor pinned in-transaction to `2026-08-01` (as in step 3) → both
   green (a past floor is a fair check).

### U3 — CI wiring
- ⚠ RISK 9 MITIGATION — assertion: `scripts/check-test-dates.sh` exits 0 on the branch HEAD **before** U3 is
  committed. Prohibition: U3 never lands ahead of U2.
- `repo-invariants` job in `.github/workflows/ci.yml`, after `check-driver-dates.sh`, with a 2-line comment citing
  §7.303 / §7.305. Static: no Supabase stack. Prohibition: the step sets no `CHECK_TEST_DATES_FLOOR`.

### U4 — BACKLOG: *Inject the database clock* (Foundations and engineering debt)
Written so a fresh session can plan it without this conversation. Contents — §6.

### U5 — docs
- GOTCHAS **§7.305** (the alarm, its rule, the marker, the one-clock limit, the static-audit verdict) + a one-line
  pointer appended to §7.303. Re-run the U0 grep first.
- `docs/TESTING.md` §5: a short entry for the script (what it checks, how to run, the marker, the override — local only).
- `docs/plans/README.md`: row → `DONE` in the shipping commit.

## 5. Proofs (§7.25 — the check must be shown to fail)
⚠ RISK 6 MITIGATION: every mutation proof runs on a **scratchpad copy passed as a positional argument**. Prohibition:
do NOT edit a real pgTAP file or fixture to prove the alarm. Assertion after all proofs:
`git status --porcelain supabase/tests .claude/skills` lists only U2's intended files.

1. **Red on `main` before U2** — exit 1; hit lines exactly those in the three files (no others).
2. **Green after U2** — exit 0; summary shows P ≥ 80, F ≥ 40, L > 0, E = the number of annotations U2 added.
3. **Mutation:** `SELECT '2099-01-01'::date;` in a scratch copy → red naming that line; add the marker with a reason →
   green; empty reason → red.
4. **Comment immunity:** a quoted future date inside a `--` comment → still green.
5. **Month literal:** `'2099-01'` → red.
6. **Retro proof (the incident):** `git show 78589c7^:` for `trial_onboarding`, `session_coach_roster`,
   `class_shadow_coaches` into the scratchpad; with `CHECK_TEST_DATES_FLOOR=2026-07-01` the alarm flags their
   `'2026-08-…'` lines — it would have caught §7.303 when they were written.
7. **Floor correctness:** the built-in self-test passes, and the script's printed floor = `SELECT session_window_start()`
   from the local DB today.
8. **Ubuntu parity (RISK 2/3):** `docker run --rm -v <repo>:/w ubuntu:24.04 bash /w/scripts/check-test-dates.sh` — the
   bare image has no tzdata, so this must exit 2 naming the timezone; then with tzdata installed (or
   `CHECK_TEST_DATES_FLOOR=2026-09-01`) against the proof-3 scratch file and the pre-U2 tree → the same hit lines as macOS.
9. Full `supabase test db` green; `check-fixture-roundtrip.sh` green after U2.
10. **CI on the pushed commit:** all jobs green AND the `repo-invariants` log shows the new step's summary line with
    P ≥ 80. A green step without that line is a failure.

## 6. BACKLOG entry content (U4) — what the 2026-10-01 discussion established

- **The bug class:** a test has two clocks — its own dates and the DB's "today". Hardcoding froze one and left the
  other running (§7.303). Derived dates move both (today's fix). An injected clock freezes both, so a test replays the
  same day forever and can deliberately target edge days (1st of month, leap day, before the first Saturday — the
  §7.304 window real-clock CI hit on only some days). The alarm models only the floor; `today_sg()` horizons stay
  unguarded until this ships.
- **Shape:** one SQL function `app_today()` (SGT date); product functions use it instead of `now()` / `CURRENT_DATE`
  / `today_sg()` for DATE DECISIONS; tests `SET LOCAL app.today = '…'`. Timestamps (`created_at`, `confirmed_at`) stay real.
- **Prod safety is the crux:** the override must be honoured only where a database-level flag allows it (local/CI),
  never on prod — a client-movable clock would let someone mark a closed month. Needs its own security review.
  PostgREST writes `request.*` settings from headers/JWT, so the setting must live outside that namespace; prove it
  cannot be set from a client rather than assume it.
- **Size of the surface:** 51 public functions read `now()`/`CURRENT_DATE` (57 counting `today_sg()`/
  `session_window_start()`/`markable_floor()`) — counted 2026-10-01 against the local DB via `pg_proc.prosrc`; record
  the query with the count. 77 pgTAP files read one of them. Not all are date decisions. Expand/contract, one function
  family per migration, billing guards last, Deno suite run twice.
- **Precedent already in the repo:** the Deno engine tests inject the clock via `BillingScenario`
  (`supabase/functions/generate-invoices/test-helpers.ts`) — copy its reasoning.
- **Needs a guard of its own:** CI must refuse a new raw `now()` / `CURRENT_DATE` used for a date decision in a
  migration, or the clock leaks back.
- **Rejected alternative — time machine (libfaketime in CI Postgres):** unproven against the Supabase-CLI-owned
  container (needs a spike); fragile across CLI/image upgrades (must self-check that `now()` is really faked);
  Postgres multi-process quirks; only *detects* early rather than prevents; needs several simulated dates per run;
  ~1–2 days. Already deferred once (`DRIVER_BACKLOG_PLAN.md` §6). Superseded by the injected clock.
- **What already guards meanwhile:** `scripts/check-test-dates.sh` (this plan), `check-driver-dates.sh` (§7.302),
  `check-fixture-roundtrip.sh`'s co-load pass (§7.304).
- **Timing:** not mid-billing — a quiet stretch; it touches the billing guards.

## 7. Not in scope
- The injected clock itself (BACKLOG, U4). Deno tests (D3). UI driver `.mjs` files (§7.302's guard covers labels;
  their SQL literals are a named blind spot). `seed.sql`.
- A scheduled/cron CI run (under D2 the answer only changes on push). Do not propose dispatching the nightly.
- Dates built by concatenation, `make_date()`, or computed in Node — the alarm is a text scan; its header says so.

## 8. Done when
All §5 proofs pass and are recorded in the U1/U2 commit messages (U2 also carries the triage table); the README row
reads `DONE`; the BACKLOG item exists with §6's content; §7.305 filed.

### Pre-commit gate (walk before each `/commit-review`; an unticked box is a blocker)
**Highest value:**
- [ ] R1 — every `date-literal-ok` line has a row in the U2 triage table with a clock audit read from
      `pg_get_functiondef`; no annotation rests on the pin experiment alone.
- [ ] R2 — the CI log shows `scanned P … L … E …` with P ≥ 80; the script exits 2 on too few files / zero literals.
- [ ] R3 — the built-in self-test covers 08, 09 and January; the ubuntu-container run exits 2 without tzdata.
- [ ] Proof 6 (retro) is red on the `78589c7^` files.

**Also:**
- [ ] R4 — `plan(N)` and `ok` counts unchanged per touched file; derived guarded dates within `[floor, floor+27]`; one
      recorded red mutation per derived file.
- [ ] R5 — the pin ran only inside the file's transaction; `session_window_start` body diff empty.
- [ ] R6 — `git status` shows no proof residue.
- [ ] R7 — the override is refused under `CI`; an empty-reason marker is red.
- [ ] R9 — U3 committed only after the script exits 0 on HEAD; §7.305 still free; README row added at U0.
- [ ] `supabase test db` green; `check-fixture-roundtrip.sh` green; no migration, no deploy, nightly not dispatched.
