# Driver backlog plan — 11 drivers + the future-date tool

_Written 2026-09-26 via `/plan-with-confidence`. Source: BACKLOG.md → *Foundations and engineering debt* (the
eleven `verify-*` / "A driver for…" items) and *Simulate a FUTURE date against the driver suite*._

_Reviewed 2026-09-26 via `/plan-review` (high effort, claims fact-checked against the code and the local DB).
Mitigations are inline, marked `⚠ RISK n MITIGATION`; corrections to the original text are marked `✎ CORRECTED`._

**This file is the cross-session tracker.** ~27 h of work → 4–5 sessions. Tick the box in §3 when a unit lands on
`main`; the next session starts at the first unticked box.

---

## 0. Risk index (from the review): most → least risky, and where each mitigation lives

| # | Risk | Mitigations at |
|---|---|---|
| 1 | A mutation-proof edit left in app code gets committed, and **`git push … :main` deploys it to production.** Both Vercel apps build from `main` and neither has an ignore step, so a "driver-only" push still rebuilds prod. A stale Metro bundle (§7.253) also makes a proof lie, or lets the final GREEN be measured on mutated code. | Ship sequence steps 3, 6; pre-commit gate |
| 2 | `simulate-date.sh` **leaves the pinned `session_window_start()` in the shared DB.** No reset follows the LAST driver, and an abort skips it too. The `lib.sh` split also rewrites the nightly's entry point, and the plan's proof for it could not be run. | U12 |
| 3 | **U12 simulates nothing like what it claims.** `markable_floor()` is `LEAST(session_window_start(), <tenant floor>)` and the seed tenant's `created_at` is the reset time, so a pin past today is clamped to today. Every relative-date fixture then reddens *by construction* (BACKLOG limit 2), so false "findings" get filed. | U12 |
| 4 | **Drivers that pass vacuously.** Causes: the dialog auto-accept in `launch()`, stacked RN-web text (§7.10), soft `if/catch` checks that skip, global service-role counts (§7.251), U9's password surviving a re-run, and no expected-check count. | Contract rules 1, 5, 8, 11; U1–U11 |
| 5 | **Fixture collisions and shared-DB pollution.** 9 of the 11 allocated prefixes are used by pgTAP tests (§7.272). A 2-char `LIKE` teardown can hit random seed ids. `--only` roundtrip skips pass 2, so push CI goes red. The hand-check shapes write into the seed tenant. U6's 1000 invoices collide with a unique key. | Contract rules 2, 3, 12; ship step 1; U6, U10 |
| 6 | **Nightly flake.** The nightly runs at 04:00 SGT and the schedule reads `nowMinutesInSg()`. The U8 stale-guard is timing-based. There is the 3 s Toast and midnight crossing. | Rule 13; U8, U11 |
| 7 | **Reaching production at runtime.** Causes: `ADMIN_URL`/`EXPO_URL` aimed at a deployed app, a real `RESEND_API_KEY` in `supabase/functions/.env`, and the U9 redirect falling back to `site_url`. | Rule 14; U9 |
| 8 | **"Green twice" proves less than it says.** `run-all-drivers.sh --only` resets before every run, so a re-run without a reset is never exercised. "KNOWN RED" is a mechanism that does not exist. | Ship step 2; §6 |
| 9 | **Factual errors in the plan** (wrong line numbers, the prefix table, the `DB_CONTAINER` env, the multi-class category, the `end_class_shadow` columns). | ✎ CORRECTED in place |
| 10 | **Citation / doc hygiene.** Deleting `batch-e-handchecks.mjs` breaks §7.251's "Shape:" pointer. `useRemoveStudent.ts:7` cites the BACKLOG item, so fixing it is an app edit that deploys. | Ship steps 4–5; §5 |

---

## 1. Decisions (settled with the user, 2026-09-26)

| Question | Answer |
|---|---|
| Parallel or sequential? | **Sequential, root checkout, shared DB.** One unit per short branch → `main`. A per-worktree DB (`supabase --workdir` copy) was discussed and **not** pursued: it overturns WORKTREES.md:148-150 / §7.55 for ~no gain (the cost is writing + proving, not waiting). |
| Proof bar (§7.25) | **1–2 mutation proofs per driver** on its money/safety-critical check(s), recorded in the driver's header table (same shape as `verify-coach-roster.mjs:48-62`), **plus green twice in a row**. |
| Future-date tool | **Script + targeted check.** `simulate-date.sh <YYYY-MM-DD> [--only a,b]`. Verified on 2–3 date-sensitive drivers. **No full sweep** without the user's word (CLAUDE.md nightly rule). **No CI job.** |
| Marking-screen read-only title | **In the new coach-marking driver**, not folded into `verify-coach-roster`. The new driver builds its own shadow coach. |

---

## 2. Rules every unit follows

**The driver contract** (each item is a thing a hand-check script got wrong; see §4 below):
1. **Exit non-zero on any failed check** and print `N/M`. `run-all-drivers.sh` takes its verdict from the exit code
   and shows the `N/M` line in the summary. None of the three `docs/refactor/coach-*-handchecks.mjs` does this, so
   lifting them as-is gives a permanent PASS.
   ⚠ RISK 4 MITIGATION (structural). Every driver declares `const EXPECTED_CHECKS = <n>` and exits 1 when
   `results.length !== EXPECTED_CHECKS`. A check skipped by an `if (found)` branch or a swallowed `.catch` then
   fails the run instead of shrinking the denominator. **Prohibited:** `.catch(() => …)` that records nothing,
   and any check inside a branch that can be skipped silently.
   ⚠ RISK 4 MITIGATION. The summary scrapes the **last** `\d+/\d+` in the log. Print the `N/M checks` line
   **last**, with no date, URL or `a/b` text after it.
2. **Self-contained fixture.** `fixture_for()` maps ONE file per driver (default `fixtures-<driver-name>.sql`).
   `psql_file` feeds it on stdin to `docker exec -i … psql`, so a `\i` inside it resolves against the **container's**
   filesystem, where the drivers directory is not mounted. `\i` of a sibling fixture therefore cannot work. ✎ CORRECTED
   (the reason is the container FS, not stdin as such). Each new driver gets `fixtures-<name>.sql` +
   `fixtures-<name>-teardown.sql` and **copies** the shapes it needs from existing fixtures under its OWN id prefix.
   Idempotent (`ON CONFLICT` / guarded `DO` blocks).
   ⚠ RISK 5 MITIGATION (structural). Name the fixture **exactly** `fixtures-<driver-name>.sql`. Then the
   `fixture_for()` default picks it up and **`run-all-drivers.sh` is not edited by U1–U11 at all**.
   `git diff --stat` for U1–U11 must show 0 lines in `run-all-drivers.sh`.
3. **Own UUID prefix + own emails** (§7.163/§7.224, enforced by `check-fixture-ids.sh`). Ids take the form
   `<pp>000000-0000-0000-0000-<12 hex>`.
   ✎ CORRECTED. The original table claimed `b2`–`bc` were "all currently unused". That is false:
   `b2, b5, b6, b7, b8, b9, ba, bb, bc` are all used by pgTAP tests (`credit_drawdown`, `package_corrections`,
   `package_weeks_start_date`, `student_package_coverage`, `tenant_unmarked_lesson_count`). A fixture left loaded
   with a same-table id then breaks `supabase test db` (§7.272, the exact failure it records). Only `b3`/`b4`
   were free. The table below uses prefixes that `git grep` found in **no** tracked file (2026-09-26):

   | Unit | Prefix | Email stem |
   |---|---|---|
   | grading-admin | `c3` | `grading-admin-*@swimsync.test` |
   | lesson-detail-guests | `b3` | `lesson-guests-*@` |
   | coach-remove-student | `b4` | `coach-remove-*@` |
   | money-admin | `c4` | `money-admin-*@` |
   | packages-admin | `c8` | `packages-admin-*@` |
   | invoice-admin | `d3` | `invoice-admin-*@` |
   | class-admin | `d4` | `class-admin-*@` |
   | platform-controls | `d5` | `platform-ctl-*@` |
   | admin-reset-password | `d6` | `admin-reset-*@` |
   | coach-marking | `d7` | `coach-marking-*@` |
   | coach-schedule-roles | `d8` | `coach-sched-*@` |

   ⚠ RISK 5 MITIGATION (assertion). Before writing each fixture, re-run
   `git grep -nE '<pp>[0-9a-f]{6}-0000' -- '*.sql' '*.mjs' '*.ts'`. **Pass = 0 hits.** Someone may have taken the
   prefix since this table was written.
   ⚠ RISK 5 MITIGATION (named prohibition, "no short-prefix teardown"). A teardown matches by exact id or by the
   **full 8-char block** `LIKE '<pp>000000-%'`, never `LIKE '<pp>%'`. Seed rows get random v4 ids, and 1 in 256 of
   them starts with any given 2 hex chars. A short prefix silently deletes seed rows. The same rule forbids name
   patterns (`check-teardowns.sh` text).
4. **No date a fixture derives from `now()` is restated in the driver**: ask the DB what it inserted (§7.225).
   Relative dates only; "last month" for anything that must be billable/sealed (§7.226).
5. **Assert in the DB, not only on screen**, for every write (psql or the service client). Count **scoped** to the
   fixture's own ids, never a global `count(*)` (the coach-attendance hand-check counted `credit_notes` globally).
   ⚠ RISK 4 MITIGATION (assertion). Every write check is a **before/after pair on the same scoped query**, and the
   "before" value is asserted too (e.g. `enrolments for <child> = 0` before Convert). Leftover state from a previous
   run or a sibling fixture then shows as a PRECONDITION failure, not as a pass. Every fixture write in a driver is
   `if (error) throw` (§7.251).
6. **Ports/URLs from `lib.mjs`** (`ADMIN`, `EXPO`), shots to `$SHOT_DIR`, no `/tmp/...` or `127.0.0.1:<app port>`
   literals (`check-driver-ports.sh`).
   ✎ CORRECTED. `run-all-drivers.sh` does **not** export `DB_CONTAINER`; it is a plain shell variable. A driver that
   reads `process.env.DB_CONTAINER` gets `undefined` in the nightly. Discover the container in the driver
   (`docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_'`, the same line the scripts use) and throw if it is
   empty. Note: ~30 existing drivers hardcode `supabase_db_SwimSync`, and no check enforces this rule, so it holds by
   vigilance only.
7. **Every mid-run mutation of a row the fixture does not own is restored in `finally`**, and preferably avoided:
   mutate fixture-owned rows only. Never wipe Mailpit; filter by recipient + `Created` (§8.119 lesson).
8. **Dialogs:** `lib.mjs:21` `launch()` registers a listener that **auto-accepts every dialog**. Call
   `page.removeAllListeners("dialog")` before answering a `window.prompt`/`confirm`. RN-web `confirmAction` is
   `window.confirm`.
   ⚠ RISK 4 MITIGATION (assertion). Every "Cancel" path check asserts **both** that the dialog event fired with
   the expected message text **and** that the scoped DB row is unchanged. Under auto-accept, the DB half goes red.
9. **Force failures with `page.route`**, not by editing app code: fail the specific REST call to reach an error
   branch. Keeps the driver runnable in the nightly. ✎ CORRECTED: RPCs live at `**/rest/v1/rpc/<fn>*`, not
   `**/rest/v1/<table>*`. Fulfil with a JSON body `{"message":"forced by driver","code":"P0001"}` so supabase-js
   builds an `error.message`, and assert that exact text reaches the screen.
   ⚠ RISK 4 MITIGATION. Match **one** route and only `request.method()` of the call you mean to fail (GET vs POST).
   `page.unroute` it straight after, and assert the route handler was actually invoked (`hits === 1`). A glob that
   also catches the page's load, or never matches at all, makes the error-branch check vacuous.
10. **RN-web screens stack (§7.10/§7.58/§7.254):** reach coach screens by TAB taps where possible; when deep-linking,
    press by DOM on the visible screen and target text by exact label.
11. ⚠ RISK 4 MITIGATION (new rule). **Assert on text unique to the target screen** (§7.10). `innerText` of the
    body includes screens mounted underneath. Waiting on a *time-of-day* string as a load sentinel is prohibited
    (the schedule hand-check waited on `/Good morning/`, which never appears after noon).
12. ⚠ RISK 5 MITIGATION (new rule). **No fixture writes into a row, month or setting the SEED tenant owns that
    other drivers read.** That covers `billing_periods` seals, `tenants.*` settings, and the seed coach's rates.
    Where the shape needs a tenant-level effect, the fixture gets its **own tenant** (as U6 already does).
    Rows under the seed tenant are allowed only if they are fixture-owned children, classes and invoices.
13. ⚠ RISK 6 MITIGATION (new rule). **Hour-invariant.** The nightly runs at **04:00 SGT**, and local runs happen at
    any hour. Any screen that buckets by time of day (`useWeek.ts` reads `nowMinutesInSg()`) is driven under
    `page.clock.setFixedTime(<today_sg from the DB> 12:00 +08:00)`. The date is unchanged; only the hour is pinned
    client-side, so this does not create §7.226's floor/`now()` disagreement. Wait on toasts right after the action
    (they live 3000 ms, §7.58). **Prohibited:** `waitForTimeout` as the only synchronisation for a state change.
    Wait on the text or the DB value.
14. ⚠ RISK 7 MITIGATION (new rule, structural). At start, each new driver asserts that `new URL(ADMIN).hostname`
    and `new URL(EXPO).hostname` are in `{localhost, 127.0.0.1}` and that its API URL is `http://127.0.0.1:54321`.
    Otherwise it exits 2 before launching a browser. A driver exported with `ADMIN_URL=https://admin.swimsync.sg`
    would otherwise perform real writes on production.

**Per-unit ship sequence** (each unit is one branch `test/driver-<name>`):
1. Write fixture + teardown → `check-teardowns.sh`, `check-fixture-ids.sh`, `check-fixture-roundtrip.sh --only <name>`.
   ⚠ RISK 5 MITIGATION (assertion). `--only` **skips pass 2** (the stacked §7.63 comparison); the script prints
   "(pass 2 skipped…)". Push CI runs the FULL roundtrip, so a fixture that collides with a sibling only goes red
   after the push. Before committing, also run `check-fixture-roundtrip.sh` **with no `--only`**. It leaves the DB
   as it found it (pass 1 asserts that), so it is safe. **Pass = exit 0 and "database restored to its pre-run state".**
   ⚠ RISK 5 MITIGATION. Tear the fixture down before any `supabase test db` (§7.272). Before `/commit-review`,
   run `supabase test db` once **with the new fixture loaded, then torn down**. Pass = all pgTAP green, which
   proves no id or slug collision with the test files.
2. Write the driver → `run-all-drivers.sh --only <name>` GREEN, then a second `--only <name>` run GREEN.
   ✎ CORRECTED. Each `--only` run does `supabase db reset` + fixture load itself, so "twice in a row" proves the
   reset-first determinism the **nightly** relies on. It does not prove a re-run on a dirty DB.
   ⚠ RISK 8 MITIGATION. Also run the driver a third time **without a reset**: `node verify-<name>.mjs` straight
   after the second sweep run. **Pass = GREEN, or a failure whose first red line is a PRECONDITION check (rule 5)**.
   A pass that relies on leftovers from run 2 is the bug to fix. Every UI write the driver makes is either undone
   in `finally` or deleted by the teardown (the check-teardowns text requires "clean up what the DRIVER wrote").
3. Mutation proofs: break the app line, re-run, see the named check RED, `git checkout -- <file>`, confirm
   `git diff --stat` shows only the driver files. Record each proof in the driver header.
   ⚠ RISK 1 MITIGATION (structural ordering). Do the mutation proofs **before** the final twice-green runs, never
   after. The last runs before commit must be against reverted code. The order is: step 2 once → step 3 → revert →
   **step 2 again (both runs)**.
   ⚠ RISK 1 MITIGATION (assertion). Before each mutation: `git status --porcelain SwimSyncAdmin SwimSyncApp` →
   **must be empty**. After each revert: `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` → **must exit 0**.
   ⚠ RISK 1 MITIGATION (assertion, §7.253/§7.31). Expo must have been started **without `CI=1`**. For an APP
   mutation, grep the served bundle for the mutated text **after** the edit (present), and again after the
   revert (absent). For an ADMIN mutation, confirm the Next dev log recompiled. A mutation that did not reach the
   bundle "fails to redden" and is wrongly recorded as a weak check. A revert that did not reach the bundle
   makes the final GREEN a green on mutated code.
   ⚠ RISK 1 MITIGATION (named prohibition, "no DB sabotage outside a reset"). Proofs in this plan are **app-code
   only**. A DB-level sabotage (DROP/REPLACE a function, like rows 1 and 5 of `verify-coach-roster.mjs`'s table)
   is allowed only inside a `run-all-drivers.sh --only` run, whose next reset undoes it, and must be followed by a
   `supabase db reset` before anything else runs.
4. Promoted hand-check script (if any) → delete it and fix its citations in the same commit.
   ⚠ RISK 10 MITIGATION. `git grep -n '<script name>'` after deleting. **Pass = only historical plan docs under
   `docs/refactor/*_PLAN.md` remain.** GOTCHAS citations must not dangle. §7.251 ends "Shape:
   `docs/refactor/batch-e-handchecks.mjs`". Do not delete that file (see U9); list the GOTCHAS re-pointing as a
   `/update-docs` item rather than editing GOTCHAS on a test branch.
5. Strike the BACKLOG item (grep its name afterwards: the two-places rule), add the driver to TESTING §5.
   ⚠ RISK 10 MITIGATION (named prohibition, "no app edit for a citation"). Some app source comments cite a BACKLOG
   item, e.g. `SwimSyncApp/features/roster/domain/useRemoveStudent.ts:7` "BACKLOG carries the missing
   verify-coach-remove-student". Updating that comment is an app change, and **every push to `main` rebuilds both
   prod apps**. Allowed only as a comment-only diff that passes the step-6 gate. Otherwise leave it and file it.
6. `/commit-review` → merge ff to `main` → push → delete branch. **Driver-only: no §7.1 gate, no Edge Function
   deploy**. ✎ CORRECTED: the push to `main` **does** rebuild both Vercel apps (no ignore step exists in
   `SwimSyncApp/vercel.json` or for the admin). "No deploy" is only true if the commit contains no app code.
   ⚠ RISK 1 MITIGATION (structural gate). Before merging:
   `git diff --name-only main...HEAD | grep -vE '^(\.claude/skills/run-ui-playwright/drivers/|docs/|BACKLOG\.md$)'`
   → **must print nothing**, or print only comment-only app diffs, verified with
   `git diff main...HEAD -- SwimSyncAdmin SwimSyncApp | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(//|\*|/\*)'`
   → **empty**. Any other output blocks the merge.

**Before the first local run of a session:** stack up; admin on :3000; **Expo on :8081 started WITHOUT `CI=1`**
and the served bundle grepped for a current-only symbol (§7.253); `supabase functions serve` running
(`run-all-drivers.sh` preflight requires it); tear fixtures down before any `supabase test db` (§7.272).
⚠ RISK 7 MITIGATION (assertion). Confirm `supabase/functions/.env` has **no `RESEND_API_KEY`**:
`grep -c '^RESEND_API_KEY=' supabase/functions/.env` → **0**. Today it holds only `CRON_SECRET`. With a real key,
U4/U10's credit-note flows call `api.resend.com`. Confirm `SwimSyncAdmin/.env.local` and `SwimSyncApp/.env` point
at `http://127.0.0.1:54321`. Also `git worktree list` → **exactly one line**: `run-all-drivers.sh` resets the shared
DB (§7.55), so no sibling may be running.

---

## 3. The units, in build order

Order = billing-adjacent risk first (September is billed in early October), then the rest by value.

### ☑ U1 — `verify-grading-admin` (~3 h) — DONE 2026-09-26, 27 checks
**Covers:** trial **Convert** two-press guard (`trials/domain/trialConvert.ts:21-26`, "Convert anyway") + trial
**Cancel**; multi-class make-up select "Which class is this making up?" (`makeups/ui/BookMakeupModal.tsx:95-115`,
`p_home_class_id` at `useMakeups.ts:153`), **Change**, **Cancel**; grade-scale add / rename / remove + the held-grade
refusal (`levels/domain/skillScale.ts:38-41`); skill **Move down** / **Remove skill**; level **Edit**; **Move up**
(promote) in `components/AssessmentGrid.tsx:514-522`, **without a reload** (fixed by `6abe8c2`); a grade write from
Students → *Grade skills* modal.
**Fixture:** copy from `fixtures-assessment.sql` + `fixtures-makeups.sql`; a child with **two enrolments in the SAME
category**. ✎ CORRECTED: `fixtures-multi-class.sql` **is** same-category: all three classes use Default Group
`7c000000-…-000000000002`, so copy that shape. One child with a past unmarked trial AND a future trial (seed both
in SQL rather than through the form: faster and deterministic).
**DB asserts:** one press of Convert → 0 new `enrolments`; second press → 1. Make-up row's home class = the chosen one.
⚠ RISK 4 MITIGATION (assertion). Assert the **first** press produced the "Convert anyway" warning text **and** 0
enrolments. A driver that only asserts "1 after two presses" passes under the mutation.
⚠ RISK 5 MITIGATION. `fixtures-assessment-teardown.sql` deletes by `LIKE 'Assess %'` names. Do **not** reuse those
labels. Every copied label gets its own stem (e.g. `GradAdm %`), or the assessment teardown deletes U1's rows
in a stacked roundtrip.
**Mutations:** `trialConvert.ts:25` → `return false` (single press enrols) · `useMakeups.ts:153` → `p_home_class_id: null`.

### ☐ U2 — `verify-lesson-detail-guests` (~3 h)
**Covers:** book a TRIAL (`BookGuestModal.tsx:71` trial-child select; submit is testid `book-guest` at `:92`) +
**Cancel booking** on the guest row (`AttendancePanel.tsx:95-97`); **Set all** ("Set all to"); Rain/Coach and
Paid/Free sub-toggles (`aria-pressed`); two-same-category-homes make-up select + client refusal "Choose which class
this make-up replaces." (`useGuestBooking.ts:71-72`); the **`full-notice`** (`BookGuestModal.tsx:83`) in the Book
modal; invalid date ("That date isn't valid.") and unknown class; **Keep the lesson**; **assign-substitute ERROR**
("Could not assign: …", `useSubstitute.ts:44-45`).
**Fixture:** copy the Rose class shape from `fixtures-admin-calendar.sql`; one trial-eligible child **visible under
RLS** (give it an INACTIVE enrolment); a child with two same-category homes; a FULL lesson.
**Assign error:** `page.route` `**/rest/v1/rpc/assign_session_coach*` (POST) → 400 with a JSON `message`
(rule 9). Do not hunt for a refusable shape. Assert the exact routed message appears after "Could not assign: ".
**Mutations:** ✎ CORRECTED `useGuestBooking.ts:53` (not `:52`) → pass `null` home · `useSubstitute.ts:45` →
delete `setCoachMsg(...)`.
⚠ RISK 4 MITIGATION. The `:53` mutation only reddens through a **DB assert on the booking's home class** (the client
guard at `:71` still fires first when no home is picked). Check the booking row's `home_class_id` equals the
chosen class, not just the toast.

### ☐ U3 — `verify-coach-remove-student` (~1.5 h): promotes `coach-roster-handchecks`
**Covers:** coach roster **Remove** cancel path (dialog "… will be removed from THIS class", count unchanged) and
accept path (toast "… removed from this class.", count −1); level curriculum expand + **Hide**.
**Fixture:** rewrite `coach-roster-handchecks.sql` (bare `DO`, no ids, no teardown) as an idempotent `b4` fixture:
own class for a child enrolled in **two** classes, own level + two skills. Class id comes from the fixture, not
`argv`. ⚠ RISK 5 MITIGATION (named prohibition). The hand-check `UPDATE students SET level_id … WHERE full_name =
'Maya Tan'` mutated a **seed** child and named the level `Toddler 1`. The fixture owns its child **and** its level
label (`CoachRm …`). No seed-row UPDATE.
**DB asserts (missing from the hand-check):** THIS enrolment closed, the other class's enrolment still active,
`students.is_active` still true.
**Mutations:** ✎ CORRECTED `features/roster/domain/useRemoveStudent.ts:32` (the `removeStudentFromClass(student.id,
id)` call; not `:~34`) → wrong class id · delete `loadData()` at `:39`.

### ☐ U4 — `verify-money-admin` (~3 h)
**Covers:** credit-notes **Void** (confirm / blank-reason "A reason is required." / Cancel), scoped **search** +
status filter, **Export CSV** (assert the download event only); referrals **Save**, **Disable/Enable**, **Grant**,
**Void** (`window.prompt`, rule 8); wages **rain toggle**, **pay-day clamp**, **Shadow rate re-prefill**
(`RatesCard.tsx:83-90`), payout breakdown expand (select by coach name, not `button[aria-expanded]`).
**Fixture:** own credit note on an own invoice (copy `fixtures-admin-table-geometry.sql:238`'s shape), a referral
program + code + reward, a coach with teaching AND shadow rates and one attended lesson last month.
**Never press Resend.** ⚠ RISK 7 MITIGATION (assertion). Add `page.on("request")` over the whole run and assert
**0 requests** to `/functions/v1/credit-note-emails` with a `credit_note_id` body (the Resend path). An accidental
press then fails the run.
⚠ RISK 5 MITIGATION (rule 12). The **pay-day clamp** and **rain toggle** write tenant-level wage settings. Either
the driver logs in as an own-tenant admin, or it restores the seed tenant's values in `finally` and asserts the
restore. Prefer the own tenant.
**DB asserts:** Void → note reversed, drawn invoice reopened; shadow-rate save → `coach_rates.role='shadow'` at the
shadow amount. ⚠ RISK 4 MITIGATION: the shadow-rate check selects Shadow and saves **without retyping** the
amount. That is the only path on which the `:87` mutation changes what is saved.
**Mutations:** delete `RatesCard.tsx:87` `setRateAmount(...)` (shadow saves teaching rate) ·
`useCreditNoteList.ts:93` → `label !== statusFilter` (✎ CORRECTED: the line has two `===`; name which one).

### ☐ U5 — `verify-packages-admin` (~2.5 h)
**Covers:** Record a sale, Decline, Cancel, Extend, Retire/Reoffer, Add package, Add category, category Default/Max,
held search, Show superseded (table in the research, `packages/…`).
**Fixture:** copy `fixtures-packages.sql` shapes + **a superseded offer** (none seeded today) + one pending request
+ one active package. ⚠ RISK 5 MITIGATION. `fixtures-packages.sql` shares student `c5000000-…01` with
`makeup_bookings.test.sql` (§7.272). The copy is re-keyed entirely to `c8`, and **no `c5…` id survives the copy**
(`grep -c c5000000 fixtures-packages-admin.sql` → 0).
**DB asserts:** sale → `parent_packages.status='active'`; Cancel → `cancelled`; Extend → `extend_package` effect.
**Mutations:** `dao/packages.repo.ts:142` → `.in("status",["pending"])` (Cancel of active silently no-ops) ·
`useSale.ts:54` → `status:"pending"`.

### ☐ U6 — `verify-invoice-admin` (~2.5 h)
**Covers:** PayNow UEN/mobile save + the 8-digit advisory (`invoices/domain/paynow.ts:14-24`), run-day save + 1–28
clamp (`useTenantBilling.ts:85-95`), the CSV export cap banner (`useInvoiceList.ts:123-134`), pending-debit
**Write off** (prompt, blank-reason refusal, RPC).
**Fixture:** its **own tenant** (so PayNow/run-day edits touch nothing shared) with its own admin login; a
`parent_tenant_balances.debit_balance > 0` row; **enough invoices to trip the export cap**.
✎ CORRECTED (the cap mechanism). The banner fires when `exportCsv` refuses. It refuses when the **unfiltered**
fetch size `sourceCount = invoices.length` ≥ `CSV_DEFAULT_CAP = 1000` (`SwimSyncAdmin/lib/csv.ts:29,58,81`;
`useInvoiceList.ts:124-127`). The fetch itself is capped at PostgREST `max_rows = 1000` (`config.toml:18`), so N = **1000**
rows visible to the admin.
✎ CORRECTED (the seeding shape). `invoices` has `UNIQUE (parent_id, tenant_id, billing_month)` with
`billing_month CHAR(7)`, so `generate_series` over one parent **must vary the month** (1000 distinct `YYYY-MM`s), or
the fixture needs 1000 parents. The `BEFORE INSERT` trigger assigns `reference_number`/`public_token`.
⚠ RISK 5 MITIGATION (structural, preferred). **Do not seed 1000 rows.** `page.route` the invoices list GET and
fulfil it with the real response's rows repeated to 1000 (distinct `id`s). This exercises the same client code
with zero DB footprint. Seed only if the route approach cannot reach the banner, and then mark every seeded
invoice `status='paid'` in the own tenant, so no outstanding-invoice flow (reminders, balances) sees them.
**Mutations:** `paynow.ts:20` → `/^\d{7,8}$/` · `useTenantBilling.ts:87` → `Math.min(31`.

### ☐ U7 — `verify-class-admin` (~2 h)
**Covers:** **End** an ongoing shadow (`useClassDrawer.ts:90-107` → `end_class_shadow`), the rate-less-coach
warning (`classRows.ts:96-103`), the failed-shadow-load branch (`page.route` the `class_shadow_coaches` GET → 500).
**Fixture:** an ongoing `class_shadow_coaches` row (`effective_from` ≥ 7 days in the past) + shadow rate; a second
coach with **no** shadow rate.
**DB asserts:** row COUNT unchanged across End (a DELETE claws back paid wages). ✎ CORRECTED: `end_class_shadow` sets
**`effective_to = today_sg()`, `ended_by = auth.uid()`, `ended_at = now()`**, not only `effective_to`. Assert
`effective_to` equals `SELECT today_sg()` read from the DB (§7.7; never a JS date) and `ended_by` = the admin's
profile id.
⚠ RISK 4 MITIGATION. The 500 route is scoped to GET and removed before End is pressed. `loadShadows` after End hits
the same URL, and a lingering route turns the End check into an error-branch check.
**Mutations:** `classRows.ts:100` → `return null` · `useClassDrawer.ts:51` → delete `setShadowError(...)`.

### ☐ U8 — `verify-platform-controls` (~3.5 h, the heaviest fixture)
**Covers:** stranded-parents panel; `N unpaid` chip; Change/Set owner modal **and its stale-response guard**
(`useOwnerTransfer.ts:45,53,68`); "Credit stays with the old business" advisory, both exits + `checkFailed`
(`page.route` the parent-links read → 500); Family status search (scope to the section: two "Search" buttons).
**Fixture (new, no template):** parent with zero `parent_tenants`; rate-less **staff** coach (not the owner, §7.131);
**two** businesses with **distinct** co-admins; a family with `credit_balance > 0`; a parent at two businesses with
one child at each. `tenants` needs a `slug` (unique: use `platform-ctl-a/-b`, not any slug in `supabase/tests`).
§7.244/§7.246: one `<select>`, `.first()/.last()` on Search, scope rows by a second `hasText`.
⚠ RISK 4 MITIGATION. The stranded-parents panel and the Businesses table are **cross-tenant**. Seed data and every
other loaded fixture appear in them too. Assert the fixture's own parent/tenant **row is present** by name, never
a count of rows.
⚠ RISK 5 MITIGATION. Creating a tenant fires triggers that seed per-tenant rows (e.g. `seed_class_rate` on class
insert). Pass 1 of the full roundtrip (ship step 1) is the proof the teardown removes them. Also delete
`audit_log` rows **by entity id before the profiles** (§7.50), never by `actor_id` of a seed admin.
**Stale guard:** open business A's modal, hold A's admin-list response, switch to B, release A → B's modal must
not show A's admins.
⚠ RISK 6 MITIGATION (structural). Hold A's response with a **promise gate**, not a delay. The route handler awaits
a `release()` the driver calls only after B's admin list has rendered (wait on a B-only admin email). Then wait
for A's `requestfinished` and re-assert. There is no timing window for the nightly runner to lose.
**Mutations:** `useStudentMove.ts:115` → `credit > 0` only · ✎ CORRECTED `TenantsTable.tsx:175` (not `:176`) → `> 1`.

### ☐ U9 — `verify-admin-reset-password` (~1.5 h): promotes `batch-e-handchecks.mjs` check 7
**Covers:** valid recovery link → "Set New Password" → mismatch / <8-char refusals → Update → sign in with the new
password succeeds; an `#error=` link → "Link expired".
**Fixture:** its **own** admin user (`d6`), so no seed password is touched and nothing needs restoring (the
hand-check mutated `coach@swimsync.test`; §7.251's cleanup traps disappear). `redirect_to` must be
`${ADMIN}/reset-password`. Verified: `http://localhost:3000/reset-password` and `http://127.0.0.1:3000/reset-password`
are on the allow-list (`config.toml:175-203`).
⚠ RISK 7 MITIGATION (assertion). The allow-list covers **port 3000 only**. On any other `ADMIN_URL`, GoTrue
silently substitutes `site_url` (§7.41). Assert `rp.url()` starts with `${ADMIN}/reset-password` after the verify
redirect. If not, **fail with "redirect not allow-listed"**, not with a product-sounding message.
⚠ RISK 4 MITIGATION (structural). The fixture uses `ON CONFLICT … DO UPDATE SET encrypted_password =
crypt('password123', …)`, so every load **resets** the password. The driver generates the new password **per run**
(`reset-${Date.now()}`) and asserts, **before** the reset, that the new password is **refused** at sign-in. Without
both, the second run (no reset) passes "new password signs in" even with `updatePassword` skipped. That is exactly
the `:74` mutation this unit relies on.
⚠ RISK 10 MITIGATION. `batch-e-handchecks.mjs` stays: checks 1–6 are not promoted, and §7.251 cites it as the
"Shape". Delete **check 7 only** (lines ~355–409), so no one can re-run the seed-password mutation.
**Mutations:** `app/reset-password/domain/useResetPassword.ts:74` → skip `updatePassword` · `:35` regex → `/never=/`.

### ☐ U10 — `verify-coach-marking` (~2.5 h): promotes `coach-attendance-handchecks`
**Covers:** Present→Absent on an INVOICED lesson → +1 credit note and **exactly one** `credit-note-emails` request;
a no-change re-save → +0 notes, **zero** requests (`useSaveAttendance.ts:235` guard); first save with no session →
exactly one `lesson_sessions` row + one `attendance_saved` audit row; **the read-only title "Lesson Attendance"** for
a class shadow (`AttendanceHeader.tsx:30`) and "Mark Attendance" for the main coach.
**Fixture:** rewrite the `e9` hand-check SQL as a `d7` fixture with teardown; add its own shadow coach on its own
class. Count `credit_notes` scoped to the fixture's invoice items.
⚠ RISK 5 MITIGATION (rule 12). The `e9` SQL writes into the **seed tenant** (`70000000-…01`) as the seed coach
(`c0000000-…01`, who is also tenant admin, §7.131). Its invoice's month is `to_char(today-7,'YYYY-MM')`, which is
**last month on days 1–7 and the current month otherwise**, so a date-dependent shape. Pin the billed lesson to a
fixed relative date inside **last month** (§7.226), and keep the invoice unsealed (no `billing_periods` row in the
seed tenant). **Pass (assertion):** `SELECT count(*) FROM billing_periods WHERE tenant_id='70000000-…01'` is the same
before and after the fixture loads.
⚠ RISK 5 MITIGATION. The teardown removes the credit note, the `parent_tenant_balances` change, the created
`lesson_sessions` row, and `attendance_saved` audit rows **by entity id**. Never by `actor_id`: the actor is the
seed coach, and that would delete every other driver's audit rows.
**Mutations:** `useSaveAttendance.ts:235` → `if (true || …)` · `lib/coachRoster.ts:172` → let `"shadow"` mark.

### ☐ U11 — `verify-coach-schedule-roles` (~2.5 h): promotes `coach-schedule-handchecks`
**Covers:** Covering + Mark Attendance (substitute), Shadowing + View lesson (shadow), Covered + View lesson (owner);
location chips render + filter; the clamp back to *All locations*; a DONE row tap →
`…/attendance?date=…&from=schedule`.
**Fixture:** `d8` copy of the needed `fixtures-coach-roster.sql` shapes + today's session with a substitute + a
class shadow + **two locations** and a **guaranteed DONE row last week** (make it deterministic; the hand-check's
soft `if/else` + `.catch` double-counted). The clamp's mid-run `is_active=false` (+ `deactivated_at`) touches only
fixture-owned classes; teardown restores regardless.
**Do NOT assert the greeting** ("Good morning" is time-of-day dependent), and do not **wait** on it either (rule 11).
⚠ RISK 6 MITIGATION (rule 13). The schedule buckets today's lessons with `nowMinutesInSg()` (`useWeek.ts:31`), and
the nightly runs at 04:00 SGT. Pin the browser to 12:00 SGT of the DB's `today_sg()`, and give fixture classes times
that are unambiguously past or future relative to 12:00.
⚠ RISK 4 MITIGATION. The mid-run `UPDATE classes SET is_active=false, deactivated_at=now()` goes through psql as
`postgres`, so `guard_class_retirement` is bypassed (`auth.uid()` is NULL). It cannot fail for product reasons, and
it must still `throw` on a non-zero exit (§7.251). The restore sits in `finally` and is asserted
(`is_active = true` for both ids).
**Mutations:** `lib/coachRoster.ts:180` → `"Shadowing"` → `null` · `useScheduleSections.ts:97` → drop `&from=schedule`.

### ☐ U12 — `simulate-date.sh` (~3 h)
**What:** `drivers/simulate-date.sh <YYYY-MM-DD> [--only a,b]`, for each driver: `db reset` → pin
`session_window_start()` to the given date's floor (`date_trunc('month', D) - 1 month`, same expression as
`20260727000100_attendance_window_guard.sql:57-65`) → load fixture → run → table of which reddened.
✎ CORRECTED ("self-cleaning"). The pin is wiped by the **next** reset, so after the **last** driver, or on Ctrl-C or
a crash, the shared DB keeps the pinned floor. Every later local driver, `supabase test db` and manual check then
sees a false window until someone resets.
⚠ RISK 2 MITIGATION (structural). At start, capture `pg_get_functiondef('public.session_window_start'::regproc)`.
Install `trap restore EXIT INT TERM` that re-applies it. On exit, assert `SELECT session_window_start() =
(date_trunc('month', today_sg()) - interval '1 month')::date` → **true**, else print a loud "DB LEFT PINNED — run
supabase db reset".
✎ CORRECTED (what the pin moves). No caller reads `session_window_start()` directly for the markable check; it goes
through `markable_floor(tenant) = LEAST(session_window_start(), <month after the tenant's last sealed month, or the
tenant's created_at date>)`. After `db reset` the seed tenant's `created_at` **is today**, and it has no
`billing_periods`. So for any D whose floor is later than today, the effective floor clamps to **today**: 2026-11-01,
2026-12-01, … all simulate the same thing, which is not "Nov 1". Only **D = the 1st of next month** (floor =
the 1st of this month) moves the floor to a date a real calendar would produce.
⚠ RISK 3 MITIGATION (assertion). After pinning, the script prints and checks
`markable_floor('70000000-0000-0000-0000-000000000001')`. If it is **not** equal to the derived floor, it refuses
with "floor clamped by tenant created_at/sealed month: this date cannot be simulated".
**Refactor first (its own commit):** ~~split `fixture_for` / `psql_file` / `wait_for_auth` / `run_with_timeout` /
preflight out of `run-all-drivers.sh` into `drivers/lib.sh`~~.
⚠ RISK 2 MITIGATION (structural, replaces the split). **Do not split the nightly's entry point.** Add one opt-in
hook to `run-all-drivers.sh`: if `$AFTER_RESET_SQL` is set, `psql_file "$AFTER_RESET_SQL"` right after
`wait_for_auth` and before the fixture. When it is unset, the path is byte-for-byte today's. `simulate-date.sh` then
loops `AFTER_RESET_SQL=<pin.sql> run-all-drivers.sh --only <one name>` per driver and collates the per-run
`summary.md`. That reuses `fixture_for()` exactly (the BACKLOG note's requirement) with no duplicated function.
✎ CORRECTED. The original proof, "`run-all-drivers.sh --only <two drivers>`", **cannot run**: `--only` compares one
name with `!=` and takes no comma list. The proof for the hook commit is:
(a) `bash -n run-all-drivers.sh` → 0;
(b) `run-all-drivers.sh --help` output identical to before;
(c) `git diff` of the commit touches only the new `if [[ -n "${AFTER_RESET_SQL:-}" ]]` block;
(d) two separate `--only` runs (`smoke-admin`, `unmarked-lessons`) GREEN with `AFTER_RESET_SQL` unset, and their
    SUMMARY rows the same shape as before.
**The next scheduled nightly after this commit is READ (not dispatched) before any further unit lands.** That is
vigilance only, because the nightly cannot be dispatched unasked.
**Guard rails:** with no `--only`, the script refuses unless `--all` is passed (a full sweep is user-requested
only). The header states both limits from BACKLOG. First, it moves the SERVER floor only (not `now()`, not the
browser clock), so it is blind to §7.225-type hardcoded months. Second, a correctly-derived fixture cannot be
validated by it (§7.226). ⚠ RISK 2 MITIGATION: it also refuses when `git worktree list` shows more than one worktree
(it resets per driver, §7.55).
**Verify:** `--only unmarked-lessons,trial-visibility,schedule-week` against **today** (all GREEN: the pin equals
reality), and against **the 1st of next month (2026-10-01)**, not 2026-11-01 (see the clamp above).
⚠ RISK 3 MITIGATION (named prohibition, "no by-construction findings"). All three target fixtures derive their
dates from `now()`. A red on them under a future pin is the **expected** disagreement (BACKLOG limit 2), not a
finding. **Do not file it.** A red is a finding only on a fixture carrying **literal** dates. On 2026-09-26 those were
`class-students`, `multi-class`, `contact-details`, `student-identity`, `packages`, `admin-table-geometry`,
`app-home-writes` (`grep -cE "'20[0-9]{2}-[0-9]{2}-[0-9]{2}"`). The report labels each driver's fixture
`literal`/`relative` so the reader cannot confuse the two. Add at least one literal-date driver
(e.g. `class-students`) to the verify set.
**Mutation proof:** ✎ CORRECTED to a value assertion rather than an inference from driver reds. Break the floor
expression (pin to today's floor regardless of the argument). Then
`SELECT session_window_start()` under `simulate-date.sh 2026-10-01` must **stop** returning `2026-09-01`. The
script's own post-pin assertion goes red. Revert, and the assertion is green.

---

## 4. Known traps carried in from the hand-check scripts

| Hand-check | Problem | Fix in the driver |
|---|---|---|
| all three coach scripts | no exit code → always PASS | rule 1 (+ `EXPECTED_CHECKS`) |
| coach-roster | class id from `argv`; bare `DO` SQL; no teardown; no DB assert; UPDATEs seed child "Maya Tan" | fixture-owned ids; rules 2, 5, 12 |
| coach-attendance | hardcodes `supabase_db_SwimSync`, `/tmp/claude-501/s/`; global `credit_notes` count; seed-tenant invoice whose month depends on the day of the month | rules 5, 6, 12; U10 |
| coach-schedule | mid-run `UPDATE classes` restored only on success; waits on the greeting; soft DONE check | rule 7; rules 11, 13; deterministic DONE row |
| batch-e check 7 | mutates the seed admin's password; its "new password signs in" is vacuous on a re-run | own user + per-run password + refused-before assert (U9) |

---

## 5. Done when

- All 12 boxes ticked; each driver GREEN twice via `--only`, **after** its mutation proofs were reverted (ship
  step 3), each with its mutation proofs in its header.
- `check-teardowns.sh`, `check-fixture-ids.sh`, `check-driver-ports.sh`, `check-fixture-roundtrip.sh` (**full, no
  `--only`**) all GREEN; push CI GREEN after every unit.
- The promoted hand-check scripts deleted: `coach-roster`, `coach-attendance`, `coach-schedule` (`.mjs`+`.sql`).
  ✎ CORRECTED: `batch-e-handchecks.mjs` is **kept** minus check 7 (checks 1–6 are unpromoted and §7.251 cites the
  file as the shape).
- 12 BACKLOG items struck (grepped), TESTING §5 lists the 11 drivers + `simulate-date.sh`.
- **The first nightly carrying the new drivers is READ, not dispatched** (user's rule). Expect ~+25–30 min on the
  current 1h24m (each driver pays its own `db reset` + kong restart; timeout 300 min). A red there on a new driver
  is triaged per TESTING §5 before the next unit lands.
  ⚠ RISK 6 MITIGATION. A new driver auto-joins the nightly the moment it lands (`for f in verify-*.mjs`). Nothing
  opts it in or out. A flake therefore reddens the rolling rot issue for every driver, so rules 13 and 5 are
  pre-merge gates, not polish.

## 6. Not in scope

- A per-worktree database (discussed, declined).
- A CI job for `simulate-date.sh`; a `libfaketime` time machine.
- Fixing anything a new driver finds: file it in BACKLOG and keep the driver honest.
  ✎ CORRECTED. There is **no "KNOWN RED" mechanism** in `run-all-drivers.sh` or any driver today. Any failed
  check exits 1 and reddens the nightly. With the user's agreement the options are: (a) land the driver without
  that check, with the check's code kept in a commented block that names the BACKLOG item; or (b) hold the unit
  until the fix ships. **Prohibited:** a check that prints FAIL but is excluded from the exit code, which is a
  permanent false green.

---

## Pre-commit gate (walk it for every unit; a box that cannot be ticked is a blocker)

**The highest-value four. Never skip these:**
- [ ] **(R1)** `git diff --name-only main...HEAD` shows only `drivers/`, `docs/`, `BACKLOG.md` (or comment-only app
      diffs, proven with the step-6 grep). A mutation in app code on `main` deploys to production.
- [ ] **(R1)** The final two GREEN runs happened **after** the last mutation revert, and the served bundle was
      grepped to prove the revert reached it (§7.253).
- [ ] **(R5)** `check-fixture-roundtrip.sh` with **no `--only`** → exit 0; and `supabase test db` green with the
      fixture loaded-then-torn-down (§7.272).
- [ ] **(R2, U12 only)** After `simulate-date.sh` exits by **any** path, `session_window_start()` equals today's
      real floor.

**The rest:**
- [ ] Prefix re-grepped: 0 hits outside this unit's files; teardown matches only `'<pp>000000-%'` or exact ids.
- [ ] Driver has `EXPECTED_CHECKS` and exits 1 on a count mismatch; the `N/M` line is the last score-shaped text.
- [ ] Every Cancel/refusal path asserts the dialog fired **and** the scoped DB row is unchanged.
- [ ] Every `page.route` is method-scoped, asserted hit exactly once, and unrouted.
- [ ] Every DB count is scoped to fixture ids; every "after" has an asserted "before".
- [ ] No fixture UPDATE of a seed row/setting/seal (rule 12); `billing_periods` count for the seed tenant unchanged.
- [ ] Third run without reset: GREEN or a PRECONDITION red (ship step 2).
- [ ] Time-of-day screens driven under a pinned browser hour (rule 13); nothing waits on the greeting.
- [ ] Driver refuses non-local `ADMIN`/`EXPO`/API hosts (rule 14); `RESEND_API_KEY` absent from `supabase/functions/.env`.
- [ ] `git worktree list` is one line before any `run-all-drivers.sh`/`simulate-date.sh` run.
- [ ] Mutation proofs recorded in the driver header with the score and the red check ids.
- [ ] Deleted hand-check scripts: `git grep` finds no live citation (GOTCHAS §7.251 still resolves).
- [ ] BACKLOG item struck and grepped (two places); TESTING §5 updated.
