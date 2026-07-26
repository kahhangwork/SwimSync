# Plan — Enforce the attendance window, and stop a late joiner blocking a month

**Branch:** `debt/attendance-window-guard` · **Base:** `main` @ `48d9d49`
**Brief:** `WORKTREE.md` · **Backlog:** *Foundations and engineering debt → Enforce the
attendance window at save time* (**S** — this plan is larger than S; see §0.2)

> Reviewed with `/plan-review`. Mitigations are inlined next to the step they govern and
> marked **⚠ RISK n**. They are written as steps, assertions with a pass/fail value, or
> named prohibitions — never as "watch out for". Do not skip one because it looks obvious
> at planning time; every one of them exists because the code contradicted an assumption
> that looked obvious at planning time. The pre-commit gate is §8.

---

## 0. What this is, and the decisions it rests on

### 0.1 The two problems

**(a) The window is a UI convention, not a rule.** `(coach)/classes/[id]/attendance.tsx`
writes whatever `date` the URL hands it (`:94` → `:301`), with no validation. Since
HANDOVER §8b every *entry point* is windowed, so the UX no longer offers a bad date — but
the screen has no guard, and `sessions_write`
(`20260718000900_tenant_rls.sql:374`) constrains *whose* class, never *which date*. A
coach's own JWT against PostgREST can create and bill a session on any date at all.

**(b) A late joiner blocks the billing month, and nothing in the product can clear it.**
`attendance.tsx:139` builds its roster from `e.is_active` with **no date filter**, and
`core.ts:490` does the same for the billing gate. A child who enrols on 20 June is
therefore expected at the 6 and 13 June lessons too. They have no attendance rows there,
so the month reports `incomplete_attendance` — and unmarked attendance **blocks generation
entirely, with no override** (§8a).

Found during planning, from the user's own question: *"if Aisha joined in June and the
coach goes back to March, she should not be on his roster."* Correct, and the same
un-dated set is in the engine.

### 0.2 Decisions taken (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Off-schedule lessons | Admin **creates** the lesson; coach marks it | Matches `book_trial`'s "booking is an arrangement, not an observation" |
| Admin marking attendance | **Never** | User: "all attendance marking should be done by the coach" |
| Ad-hoc timing | Future dates allowed | It's a schedule, like a trial booking |
| Window floor | Calendar: 1st of last month | Predictable, no cross-table lookup, never falsely refuses |
| Enforcement | Client callers only (`current_user = 'authenticated'`) | See §0.3 |
| Scope | Guard + date-scoped roster + **engine** | Roster-only creates a deadlock — §3 |

### 0.3 Why the DB rule does not apply to fixtures or the engine

The rule is *"a client may not assert that a lesson happened outside the window."* Test
fixtures are not clients — their job is to **construct the past** the rule is about (an
invoiced March, a sealed month). An absolute rule forces every fixture to date itself
relative to `now()`, which is precisely §7.33's trap and which already bit this repo:
§8.12 found `lesson_packages`' fixture using `CURRENT_DATE` (server UTC), turning the
suite red for eight hours a day, 00:00–08:00 SGT, for six days.

The residual risk is §7.42 — a future `SECURITY DEFINER` writer bypasses the
`current_user` seam. Mitigated structurally in §1: the rule lives in **one SQL function**
that both the trigger and any future definer writer call, rather than a comment asking
people to remember.

---

## 1. Phase 1 — The database

One migration. Give it the **highest timestamp in the batch** (§7.49) — there is no
contract migration here, but the convention costs nothing and this worktree may gain one.

### 1.1 Column

`ALTER TABLE lesson_sessions ADD COLUMN off_schedule_reason TEXT NULL`

NULL means an ordinary lesson on the class's own weekday. Set **only** by
`schedule_extra_lesson()`. Carries a `COMMENT` saying so.

> **⚠ RISK 7 MITIGATION — named prohibition.** Do NOT let any client write this column.
> It must have no path from `authenticated`: the RPC is the only writer. Assertion in
> pgTAP: a coach `UPDATE lesson_sessions SET off_schedule_reason = 'x'` **must raise**,
> and a second assertion must confirm the value is still NULL afterwards. A test that
> only checks the raise passes even if the write partially landed.

### 1.2 Functions — one definition of the rule

- `today_sg()` → `(now() AT TIME ZONE 'Asia/Singapore')::date`
  (matching the existing pattern at `20260719002400_platform_overview_derive_shape.sql:61`)
- `session_window_start()` → `(date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month')::date`
- `assert_class_runs_on(p_class_id, p_date)` — the weekday check
- `assert_markable_date(p_date)` — the `[session_window_start(), today_sg()]` bound

> **⚠ RISK 5 MITIGATION — step.** Lift `assert_class_runs_on`'s body **verbatim** from
> `book_trial` (`20260725000800_book_trial.sql:70`), *including* its comment explaining
> `EXTRACT(DOW)` rather than `to_char(…,'day')`. `to_char` renders the weekday name
> through `lc_time`, so on a server with a non-English locale every comparison fails and
> no lesson can be marked at all. Do NOT rewrite this check from scratch.

> **⚠ RISK 2 MITIGATION — named prohibition.** These four functions are the ONLY place
> the window rule is expressed in SQL. Do NOT inline `now() AT TIME ZONE …` or a weekday
> comparison into a trigger body, the RPC, or a policy. §7.18 is what four hand-written
> copies of one safety rule cost: a live underbill.

### 1.3 Trigger on `lesson_sessions`

`BEFORE INSERT OR UPDATE OF session_date`, gated on `current_user = 'authenticated'`:
weekday check + `[window_start, today]`.

### 1.4 Trigger on `attendance` — READ THIS BEFORE WRITING IT

`BEFORE INSERT`, gated on `current_user = 'authenticated'`: resolve the session's date via
the FK (`initial_schema.sql:150`) and assert `[window_start, today]`. **No weekday check** —
the session's existence already settled that.

> **⚠ RISK 1 MITIGATION — step + assertion. THE HIGHEST-RISK ITEM IN THIS PLAN.**
> `attendance.tsx:329` saves with
> `.upsert(rows, { onConflict: "lesson_session_id,student_id" })`, which PostgREST emits
> as `INSERT … ON CONFLICT DO UPDATE`. **A `BEFORE INSERT` trigger fires for every row,
> including rows that resolve to an UPDATE.** A naive INSERT-only guard therefore refuses
> every *correction* to an out-of-window lesson — killing the credit-note flow
> (PRD §7.8), which is the exact feature the INSERT/UPDATE split was chosen to protect.
> It is worse than one row: the save sends **all students in one statement**, so a single
> refused row fails the whole class's save.
>
> **The trigger must therefore allow the row when one already exists for
> `(lesson_session_id, student_id)`** — that is an update wearing an insert's clothes.
> Structural, and it covers direct REST calls too, which a client-side split would not.
>
> Assertions, all four required in `attendance_window.test.sql`:
> 1. INSERT of a NEW attendance row on an out-of-window session → **raises**
> 2. UPDATE of an EXISTING row on the same session → **succeeds** (credit-note path)
> 3. `INSERT … ON CONFLICT DO UPDATE` over an existing row on that session → **succeeds**
> 4. A mixed multi-row upsert (one existing + one new) on an out-of-window session →
>    **raises, and the existing row is UNCHANGED** — assert the old value explicitly, or
>    the test passes on a trigger that let a partial write through

> **⚠ RISK 1 MITIGATION — step.** Before writing the trigger, reproduce the upsert
> statement PostgREST actually emits and confirm the firing order empirically, rather
> than reasoning about it: mark a class, then re-save one changed student, with
> `log_statement = 'all'` or by asserting from a pgTAP fixture. §7.42's `current_user`
> behaviour was confirmed empirically for the same reason.

### 1.5 `schedule_extra_lesson(p_class_id, p_date, p_reason)`

`SECURITY DEFINER`, tenant-admin gated, **tenant derived from the class, never a
parameter** (§7.42). Waives the weekday rule and permits future dates; still refuses below
`session_window_start()`. Audit-logged.

> **⚠ RISK 6 MITIGATION — named prohibition + assertion.** This is the SECOND writer of
> `lesson_sessions` (§7.43 retired that gotcha when trials became bookings; this plan
> re-creates it). A duplicate `(class_id, session_date)` row **double-bills a whole
> class** (§7.7). The RPC MUST use `ON CONFLICT (class_id, session_date) DO NOTHING` and
> MUST take the date as a **parameter**, never `now()`. Assertion: call it twice with the
> same arguments and assert `SELECT count(*) FROM lesson_sessions WHERE class_id = … AND
> session_date = …` is **exactly 1** both times.

> **⚠ RISK 8 MITIGATION — step.** Ship both grant layers (§7.35): `REVOKE ALL … FROM
> PUBLIC` **and** `REVOKE EXECUTE … FROM anon, service_role`, then
> `GRANT EXECUTE … TO authenticated`. Copy the shape at `20260725000800:128-131`. Do NOT
> trust a local `pg_proc` check — §7.39: Supabase *cloud* carries project-level default
> privileges the local stack does not reproduce, so a grant verified locally can be wrong
> in production. The only honest check is the remote dump in §7.

### 1.6 Tests — `supabase/tests/attendance_window.test.sql`

Coach refused off-weekday; coach refused out-of-window; coach allowed in-window; the four
upsert assertions from §1.4; RPC refused for parent / coach / cross-tenant admin, allowed
for the right admin, idempotent; `off_schedule_reason` unwritable by a client.

> **⚠ RISK 2/8 MITIGATION — step.** Wrap every role probe in an explicit
> `BEGIN`/`COMMIT` and include at least one case expected to FAIL (§7.16). `SET LOCAL
> ROLE` outside a transaction is a **no-op** and psql will not stop you — the session
> stays `postgres`, bypasses RLS entirely, and every case "passes" including the ones
> that should be denied.

> **⚠ RISK 9 MITIGATION — step.** Write `supabase/rollback/20260727_attendance_window_DOWN.sql`
> and **execute it forward, back, and forward again locally** before any deploy — the
> §8.12 pattern. Written-but-unrun is not a rollback path.

---

## 2. Phase 2 — Date-scope the completeness rule

`expectedStudentsOn(date, activeStudentIds, bookedByDate)` takes a flat id list today. It
becomes enrolment **spans**:

```ts
type EnrolmentSpan = { studentId: string; from: string; until: string | null }
// expected on `date` when: from <= date && (until === null || date <= until)
```

Spans subsume `is_active`, and they make the trial walk-in fall out correctly — an
enrolment opened and closed on its own date is expected on exactly that date.

**Three byte-identical copies** — `SwimSyncApp/lib/`, `SwimSyncAdmin/lib/`,
`supabase/functions/generate-invoices/`. Callers:

| Caller | Line |
|---|---|
| `SwimSyncApp/app/(coach)/today/index.tsx` | `:221` |
| `SwimSyncApp/app/(coach)/classes/[id]/roster.tsx` | `:237` |
| `SwimSyncAdmin/lib/classCoverage.ts` | `:145` (via `unmarkedDates`) |
| `supabase/functions/generate-invoices/core.ts` | `:566`, query at `:487` |

> **⚠ RISK 2 MITIGATION — named prohibition.** `billableStudentIds` (`core.ts:537`) and
> `deferrableParentIds` (`core.ts:595`) stay on **current-active** enrolment. Do NOT
> convert them to spans. They answer a different question — §7.13: *who gets billed*
> follows attendance rows, *who must be marked* follows enrolment. Collapsing them is
> §7.13's live underbill, where one tap of "remove from class" cost a month's revenue.

> **⚠ RISK 2 MITIGATION — structural.** Add a test that reads all three copies from disk
> and asserts they are byte-identical, so drift fails a suite instead of waiting to be
> noticed by `diff`. This is the one place a structural guard is available for the
> duplicate-file arrangement; take it. Assertion: three files, one `assert.equal` each
> way, and it must FAIL if you change one copy and not the others — verify that by
> actually breaking one before moving on.

> **⚠ RISK 2 MITIGATION — step + assertion.** Write the Deno test FIRST and run it
> against the **current** engine. Required baseline: a mid-month joiner scenario reports
> `incomplete_attendance` on today's code and a clean invoice after the fix. If it does
> not fail before the fix, the test is not testing the fix (§7.25 — a test written for a
> known bug passed against the very code it existed to catch, and was only found by
> reverting).

> **⚠ RISK 2 MITIGATION — step + assertion.** Add a **tripwire** in the shape of
> `packages.test.ts`'s no-package test: a scenario with NO late joiners and NO closed
> enrolments must produce a **byte-identical** invoice result before and after this
> change. Record the pre-change JSON and diff it. This is the only check that catches
> "the span filter changed billing for everyone", which no targeted test would.

> **⚠ RISK 2 MITIGATION — step.** Run the Deno suite **twice** in a row (§7.15). Manual
> runs seal months, so a suite that passes once can fail on the second run from its own
> leaked state; once proves nothing about teardown.

---

## 3. Phase 3 — Deploy ordering (decide it now, not on the night)

Three artifacts deploy separately and nothing is atomic: **migrations** (`supabase db
push`), the **engine** (`supabase functions deploy generate-invoices`), the **web apps**
(`git push` → Vercel).

**Order: migrations → engine → apps.**

> **⚠ RISK 3 MITIGATION — named prohibition. THIS ORDER IS LOAD-BEARING.** Do NOT push
> the apps before the engine. If the coach's roster is date-scoped while the engine still
> expects a late joiner at pre-enrolment lessons, the month reports
> `incomplete_attendance` naming a lesson the coach's app **correctly no longer offers a
> way to mark** — the month becomes unbillable with no remedy in the product. That is a
> deadlock on the critical path to the first real billing month (§9). The reverse order
> is safe: an engine that no longer expects Aisha, with old apps still showing her, is
> merely permissive.

> **⚠ RISK 3 MITIGATION — assertion.** After the engine deploy and BEFORE pushing the
> apps, confirm the deployed version changed: `supabase functions list` must show
> `generate-invoices` at **v17** (it is at v16 per HANDOVER §3). A version that has not
> moved means the deploy did not land, regardless of what the CLI printed.

> **⚠ RISK 3 MITIGATION — step.** After the app push, verify the **app bundle** carries
> the change, not just the admin — §7.23: the two are separate Vercel projects and the
> app finishes after the admin. Grep the deployed asset for a **contiguous user-visible
> string** you can see verbatim in the source (§7.51: identifiers are renamed and JSX
> splits literals, so grepping for `expectedStudentsOn` or a split JSX phrase proves
> nothing and reads as a failed deploy).

---

## 4. Phase 4 — The coach's screens

### 4.1 `attendance.tsx` — the Aisha fix

Select `enrolled_at, unenrolled_at` and filter against the URL date before `mergeRoster`.
`mergeRoster`'s "plus anyone already marked" half is untouched — it is load-bearing for
trial walk-ins whose enrolment closes on its own date.

> **⚠ RISK 5 MITIGATION — named prohibition + assertion.** `enrolled_at` and
> `unenrolled_at` are `TIMESTAMPTZ`. Convert them with `toSgDate()` (already imported in
> `roster.tsx`). Do NOT use `toISOString().split("T")[0]` — that is the UTC date, a day
> behind before 08:00 SGT, and it shipped a real double-billing bug (§7.7). Assertion: a
> jest case with an enrolment at `2026-06-20T00:30:00+08:00` must place the student
> **on** 20 June, not 19 June. Audit before commit:
> `grep -rn -e "toISOString()\.split" -e "toISOString()\.slice" SwimSyncApp SwimSyncAdmin`
> → must return nothing new.

### 4.2 Off-schedule lessons must reach the coach — TWO REGRESSIONS TO FIX

> **⚠ RISK 4 MITIGATION — step. Found by reading the code, not by design review; both
> ship broken if skipped.**
>
> **(a) Today's Unmarked Lessons would never show an off-schedule lesson.**
> `today/index.tsx:210` iterates `expectedLessonDates(…)` ∪ *booking* dates. An
> admin-created off-schedule lesson is **neither**, so it never appears in the coach's
> backlog — while the engine **does** block the month on it, because `datesToCheck`
> (`core.ts:551`) unions existing session dates. Month stalls, coach is never told,
> nothing surfaces why. That is exactly §7.18's shape.
> **Fix:** union existing session dates `<= todayDate` into `dates`.
> **Assertion:** an off-schedule session dated yesterday, unmarked, appears in Unmarked
> Lessons. Verify it is ABSENT before the fix.
>
> **(b) A future off-schedule lesson renders under "Past Sessions".** `roster.tsx:182`
> queries sessions with no date bound, so a scheduled makeup appears in the past list,
> orange/unmarked, and is tappable into a screen whose save the guard will refuse.
> **Fix:** split future-dated sessions into an "Upcoming" group and do not link them to a
> markable screen.
> **Assertion:** a session dated tomorrow does not appear under "Past Sessions" and is
> not tappable.

### 4.3 Client-side pre-check

Validate the date on load; show a plain explanation instead of a markable roster that
fails on save. The client keeps its existing **enrolment-aware** floor as UX — stricter
than the DB's calendar floor, which is the correct direction.

> **⚠ RISK 10 MITIGATION — named prohibition.** Do NOT edit `lib/lessonDates.ts`. It is
> duplicated byte-identical across two npm projects (HANDOVER §6) and `WORKTREE.md`
> forbids it in this worktree. If this phase appears to need a change to
> `backlogWindowStart`, **stop and raise it** — it overlaps `../SwimSync-contact-details`.

---

## 5. Phase 5 — Admin UI

A "Schedule an extra lesson" control on the admin Classes page calling
`schedule_extra_lesson`. No attendance writing in the admin.

> **⚠ RISK 8 MITIGATION — step.** Probe the new read/write path **as the actual role**
> before writing the UI (§7.48): `SET LOCAL ROLE authenticated; SET LOCAL
> "request.jwt.claims" TO '{"sub":"<admin-id>"}'; SELECT count(*) FROM lesson_sessions
> WHERE …`. A count of 0 there is the whole bug and it takes ten seconds. §7.48 happened
> **three times** in this codebase; twice it shipped a feature that could never work,
> because a policy gap is indistinguishable from a feature nobody wrote.

---

## 6. Phase 6 — Verification

Record the **baseline first**, then the after value. A changed count that is not
explained by tests you added means a test was lost.

| Suite | Baseline | After |
|---|---|---|
| `supabase test db` | 366 | 366 + new (record exact) |
| Deno `test.sh` | 108 | 108 + new |
| `SwimSyncAdmin` vitest | 122 | 122 + new |
| `SwimSyncApp` jest | 91 | 91 + new |
| `tsc --noEmit` both apps | clean | clean |

> **⚠ RISK 2 MITIGATION — step.** Measure the baseline by RUNNING each suite, not by
> copying the table above. HANDOVER §5 records that its own "total" line was stale for
> several sessions — the command is the fact, the document is the hint (§7.37).

> **⚠ RISK 9 MITIGATION — step.** Extend `verify-attendance-window.mjs` and run it
> against the UNFIXED code first, recording the pass count. §7.34: the 14/21 baseline is
> what located the cause of the toggle bug; without it the fix would have been a guess
> that happened to work. New driver checks: the Aisha case end to end (open an old
> session, she is absent from the roster, the save succeeds), an off-schedule lesson
> appearing in the coach's backlog, and a future one not being markable.

> **⚠ RISK 9 MITIGATION — step.** Before deploying, drive the **first-real-month
> workflow** locally end to end: coach marks a normal in-window lesson, saves, edits one
> student, saves again. This is the path production is about to walk for the first time
> (§9), and a guard bug here means no coach can mark anything at all. A green unit suite
> does not cover it — §8.12 found five defects invisible to 366 automated tests.

> **⚠ RISK 4 MITIGATION — step.** `docker restart supabase_kong_SwimSync` after any
> `supabase db reset` (§7.44), or every Deno test fails at once with an empty error
> object that reads like a catastrophic regression and is not one. Tell
> `../SwimSync-contact-details` before resetting — this worktree owns `supabase/`, but
> that one re-seeds after.

---

## 7. Deploy

1. Backup (schema + data, scratchpad, not committed).
2. `supabase db push` — then `supabase migration list --linked`, and assert nothing has
   an empty `remote` column. `db push` may print the `pg-delta` SSL stack trace and
   succeed anyway (§8.11/§8.12); `migration list` is the fact.
3. **Remote grant dump** (§7.39 — the only honest check):
   `supabase db dump --file /tmp/p.sql && grep -E '(GRANT|REVOKE).*ON FUNCTION' /tmp/p.sql | grep '"anon"'`
   → `schedule_extra_lesson` must NOT appear.
4. `supabase functions deploy generate-invoices` → assert **v17** in `functions list`.
5. Only then `git push` → Vercel. Verify the app bundle per §3.
6. Post-deploy assertion: `SELECT count(*) FROM lesson_sessions;` unchanged, and
   `SELECT count(*) FROM attendance;` still **0** — production had zero of both at the
   start of this work (HANDOVER §9), so any non-zero means something wrote during deploy.

---

## 8. Pre-commit gate

Do not commit until every box is ticked. **A box that cannot be ticked is a blocker, not
a caveat.**

**The three that matter most — if only three get checked, these:**

- [ ] **RISK 1** — the four upsert assertions in `attendance_window.test.sql` all pass,
      including the mixed multi-row case asserting the existing row is unchanged.
      *Without this, saving attendance is broken for every coach.*
- [ ] **RISK 3** — deploy order written into the deploy notes as migrations → engine →
      apps, with the v17 assertion. *Without this, the first real billing month deadlocks.*
- [ ] **RISK 2** — the mid-month-joiner Deno test **fails on the current engine**, and
      the no-joiner tripwire produces byte-identical output. *Without this, the change to
      the billing gate is unverified.*

**The rest:**

- [ ] All three copies of `attendanceCompleteness.ts` byte-identical, proven by the drift
      test — and the drift test verified to FAIL when one copy is changed
- [ ] `billableStudentIds` / `deferrableParentIds` still on current-active enrolment
- [ ] Off-schedule lesson appears in the coach's Unmarked Lessons (§4.2a); verified absent
      before the fix
- [ ] Future off-schedule lesson not under "Past Sessions" and not tappable (§4.2b)
- [ ] `schedule_extra_lesson` idempotent — count is exactly 1 after two identical calls
- [ ] Both grant layers on the RPC; remote dump clean of `anon`
- [ ] Every pgTAP role probe inside an explicit transaction, with ≥1 expected failure
- [ ] `grep` for `toISOString().split|slice` returns nothing new
- [ ] Rollback SQL executed forward → back → forward locally
- [ ] Four suite counts recorded before and after; no unexplained drop
- [ ] Both suites run **twice**; `tsc --noEmit` clean on both apps
- [ ] `lib/lessonDates.ts` untouched (`git diff --stat` must not list it)
- [ ] `HANDOVER.md` / `PRD.md` / `BACKLOG.md` untouched (`/session-close` writes them)

---

## 9. Graduate at session close (do NOT edit those files in this worktree)

Three findings here outlive this task and belong in **HANDOVER §7**, which
`/session-start` mandates reading every session — a plan file is discarded when the work
lands:

1. **A `BEFORE INSERT` trigger fires on `INSERT … ON CONFLICT DO UPDATE`** — so an
   "INSERT-only" guard silently governs updates too, and a multi-row upsert fails
   whole-statement on one bad row. (New gotcha.)
2. **§7.43 is un-retired** — `lesson_sessions` has a second writer again
   (`schedule_extra_lesson`), so its `ON CONFLICT`/date-parameter rule is live, not
   historical.
3. **A derived expectation and a stored row are different sources** — a lesson the
   engine's gate can see (existing session) but the coach's backlog cannot (derived from
   weekday) stalls a month with no visible cause. §7.18's shape, third instance.

Also for `/session-close`: **PRD §7.5** currently states *"the attendance screen accepts
**any** date"* and **HANDOVER §8c** lists this guard under "Not done (deliberate)". Both
become false when this ships.

---

## 10. Known consequences, accepted deliberately

Found in the pre-commit review. None is a defect in the code as written; all three
are things the next person must not rediscover the hard way.

### 10.1 A month billed LATE cannot be unblocked — the sharpest edge of the calendar floor

The floor is "the 1st of last month", so on **5 September** a coach may mark back to
**1 August**. Billing **July** on that date is still permitted by the engine (it allows
any completed month), and if July has an unmarked lesson the gate names it — but the
coach may no longer mark it, and neither may the admin. The month cannot be billed.

**This is new.** The window has existed as UX since §8c, but it was a UI convention: a
coach could still reach the date and clear the gate. Enforcing it in the database makes
that impossible.

**Why it is being accepted:** the calendar floor was chosen explicitly over the
"refuse only already-invoiced months" option, which is precisely the alternative that
would not have this edge. Reversing that is a product decision, not a review fix.

**If it ever bites,** the smallest correct change is to floor at
`min(1st of last month, first day of the earliest unsealed billing month)` — i.e. let the
window follow `billing_periods` rather than the calendar. That is the backlogged
*"floor is a calendar proxy"* item (HANDOVER §8c), and this is the strongest argument
for it yet.

### 10.2 A fully-departed class can now block a month it previously did not

`expectedStudentsOn()` returns students whose enrolment SPAN covers the date, so a class
where everyone has since left now expects them at the lessons they were actually
enrolled for. A partially-marked past session in such a class blocks the month, where
before the expected set was empty and it silently did not.

This is **more correct** — an unmarked lesson is an unbilled lesson — and, critically,
it has a remedy: those same leavers appear on that date's roster in `attendance.tsx`
(spans drive both), so the coach can mark it. Verify that remedy still works before
changing either side; a gate with no remedy is the deadlock this whole plan exists to
avoid.

### 10.3 `sessionId` in the URL is trusted (pre-existing)

`attendance.tsx` takes `sessionId` from the query string and does not check it belongs
to the class or the date being displayed. Supplying a real id therefore satisfies the
client's `sessionExists` branch and skips the weekday check on screen.

**Not a billing hole:** attendance rows attach to the session identified by that id, and
the database's guard reads THAT session's own date — so the write is still bounded. The
only defect is cosmetic (the header can show a date the rows do not belong to). Worth
closing if the screen is touched again; not worth a migration on its own.
