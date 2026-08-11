# Wave 3 — The lesson-level coach roster

_Planned 2026-08-11. Backlog: `BACKLOG.md` → Build order → Wave 3 (items 9 and 10), and
*Coach workflow* → **A lesson can have a substitute coach, temporarily** (M) and
**Trainee coaches shadow the main coach on a lesson** (M)._

**One schema change, built once with a main/shadow distinction** — not a substitute column
later widened. `CLAUDE.md`: one schema change in flight at a time.

Record that Coach B taught one lesson of Coach A's class without moving the class, and let
trainees shadow a lesson and be paid at their own rate. A permanent handover already works
through `set_class_terms()` (it writes `classes.coach_id` and a `class_rates` row with
`paid_coach_id` + `effective_from`). What has no representation is the **one-off cover**.

---

## Decisions (settled 2026-08-11 with the user — do not re-litigate)

| # | Decision | Consequence |
|---|---|---|
| 1 | A substitute is paid **their own** `coach_rates` rate, not the class's terms | `session_pay_amount` becomes per-(session, coach) |
| 2 | A **new narrow gate**; `coach_owns_class()` is NOT widened | Its 43 existing call sites keep their current meaning |
| 3 | A cover is **one lesson at a time**, never a date range | The roster row is keyed to `lesson_session_id` |
| 4 | **The admin assigns.** The coach app is read + mark only | No coach-side write path, no new write policy, no new RPC |
| 5 | A substituted coach is paid **nothing** for that lesson | The roster main *replaces* the class coach for pay |
| 6 | Trainees **see only**; the main coach marks | Two gates: read = anyone rostered, write = main only |
| 7 | Assigning into an already-**PAID** payout month is **allowed** | Reuses `is_adjustment` / `original_period`; no new concept |
| 8 | Phase B runs in **two worktrees** | `SwimSyncAdmin` and `SwimSyncApp`; no shared files |

### Why decision 2 is the one that matters

`coach_owns_class()` and `coach_owns_session()` are called from **43 places across 12
migrations**. Widening either body would move all 43 at once — including
`close_student_enrolment()`, whose per-class authorization `HANDOVER.md` §3 pins as
deliberately `coach_owns_class()` and **never** `coach_serves_student()`. A substitute would
silently gain the power to close a child's enrolment in a class they are covering for one
hour. New gates, used only where marking happens.

Wave 2 is the precedent, not a hypothetical: `coach_serves_student()` was correct while a
child had one class and became an authorization hole the moment they could have two (§8.43,
pinned by `multi_class.test.sql`). **Wave 3 touches the same family of functions.**

---

## What needs NO change — derived from the code on 2026-08-11. Re-verified by /plan-review.

- **`supabase/functions/generate-invoices/` — nothing.** ✅ **RE-VERIFIED 2026-08-11.**
  `core.ts:413` selects `paid_coach_id`; `rates.ts:86` returns it as `paidCoachId`; **grep for
  `paidCoachId` finds no reader anywhere outside `rates.ts` itself.** Both `rateOn()` call
  sites (`core.ts:878`, `:896`) take `.price`. Who taught a lesson **cannot change what a
  parent pays**. The Deno suite must stay green; it gains no new behaviour.
- **`SwimSyncApp/lib/scheduleWeek.*` and `lib/scheduleBuckets.*` — nothing.** Pure date and
  bucket maths, zero references to a coach. Re-confirmed 2026-08-08 and again here.
- **`coach_payouts` / `coach_payout_items` need no new columns.** A payout is already
  per-coach (`UNIQUE (tenant_id, coach_id, period_month)`), so a shadowed lesson writes items
  into **two different payouts**, and `UNIQUE (payout_id, lesson_session_id, is_adjustment)`
  still holds.
- **`session_pay_overrides` stays as it is.** It suppresses a lesson's pay and cannot name
  another coach — that is precisely why this wave exists, and it is not the mechanism.
- **`SwimSyncApp/lib/useCoachHasPayouts.ts` — nothing.** ✅ **RE-VERIFIED:** it is a
  `count: "exact", head: true` over `coach_payouts` with no filter and no row assumption, so
  two payouts answer it exactly as one does. Listed as "owned" by wt-coach below only so the
  worktree does not have to rediscover that.

### ❌ TWO CLAIMS IN THE FIRST DRAFT OF THIS SECTION WERE FALSE. Corrected here.

- **The Schedule tab is NOT one line.** `.eq("coach_id", coach.id)` at
  `SwimSyncApp/app/(coach)/schedule/index.tsx:317` filters **`classes`**, and every week card
  is built from that class row (`title`, `day_of_week`, `start_time`, `end_time`,
  `location_name`) plus its nested `student_class_enrolments`. `classes_select`
  (`20260718000900:333`) permits a coach only `coach_id = current_coach_id()`. **Changing
  which ids the query asks for returns nothing at all** until `classes_select` and
  `enrolments_select` are widened. See RISK 1.
- **`generate_coach_payouts`'s newest body is `20260719000900_payout_adjustment_carried_once.sql`,
  NOT `20260719000800`.** §7.115 is precisely this trap. `session_pay_amount(uuid)`'s newest
  body *is* in `20260719000800`. **Open `…000900` for the payout builder, or you will write a
  fix against a body that has been superseded** — and the thing `…000900` added (the
  already-carried running total) is exactly what §1.6's new loop must not lose. See RISK 3.

---

## Step 1 — The migration (root checkout, `db/…` branch, ONE file)

### 1.1 The roster table

```sql
CREATE TYPE session_coach_role AS ENUM ('main','shadow');

CREATE TABLE session_coaches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_session_id UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  coach_id          UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  role              session_coach_role NOT NULL,
  assigned_by       UUID REFERENCES profiles(id),
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_session_id, coach_id)
);

CREATE UNIQUE INDEX one_main_coach_per_session
  ON session_coaches (lesson_session_id) WHERE role = 'main';

CREATE INDEX ON session_coaches (coach_id);
CREATE INDEX ON session_coaches (tenant_id);
```

**`tenant_id` is stamped, not derived.** Every audit and RLS path in this codebase expects a
tenant on the row (§8.28); deriving it through two joins in a policy is how a policy becomes
unreadable. A trigger fills it from the session's class, in the shape
`trg_parent_package_lifecycle` established.

> ### ⚠ RISK 10 MITIGATION — the partial index makes "change the main" a raw 23505
>
> `one_main_coach_per_session` is a **partial** unique index. PostgREST's `.upsert()` cannot
> target a partial index, so "this cover was wrong, it was Coach C" arrives as a plain INSERT
> and comes back as an unhandled `23505` in the admin's face.
>
> - **Step.** Ship `set_session_main_coach(p_session_id, p_coach_id)` in the SAME migration:
>   `DELETE` the existing `role='main'` row for that session, then `INSERT` the new one, in one
>   statement pair inside the function. The admin UI calls only this — it never INSERTs into
>   `session_coaches` directly for a main. Shadows are ordinary insert/delete.
> - **Named prohibition.** Do **NOT** solve this by dropping the partial index, and do **NOT**
>   add `ON CONFLICT DO NOTHING` to the main insert — silently keeping the OLD main is a
>   wrong-coach-gets-paid bug, which is the failure this table exists to remove.
> - **Assertion (§7.127).** The index is a *new* constraint, so nothing depends on it failing
>   yet — but the fixture-delta detector must be re-proven once `session_coaches` has rows:
>   run `check-fixture-roundtrip.sh`, then sabotage `fixtures-coach-roster.sql` with an
>   unscoped roster insert **into a session no sibling fixture touches** (§7.127's own
>   correction) and confirm it goes red on delta divergence naming the fixture. Green there is
>   a blocker, not a caveat.

### 1.1a The lesson_session row does not exist yet — and this is the plan's keystone

> ### ⚠ RISK 5 MITIGATION — decision 3 keys the roster to a row nothing has created
>
> **`lesson_sessions` rows are created LAZILY, by the coach, at the moment attendance is first
> saved.** Verified, not assumed: `core.ts:603` says so in prose ("a lesson nobody touched has
> no row at all", PRD §7.5), and `SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx:474-488`
> is the `INSERT` that creates it on save. **A future lesson has no `lesson_session_id`** — so
> "assign Coach B to cover next Tuesday", the one thing this wave exists for, has no key.
>
> This does not reverse decision 3. It adds one required step to it:
>
> - **Step.** The migration ships `assign_session_coach(p_class_id, p_session_date, p_coach_id,
>   p_role)` — an admin-only `SECURITY DEFINER` RPC that **resolves-or-creates** the
>   `lesson_sessions` row from `(class_id, session_date)` (the pair is unique and is already
>   how `attendance.tsx:266` resolves it) and then writes the roster row. The admin surface
>   never handles a session id.
> - **Named prohibition.** The assignment RPC must **reject a date the class does not run on**
>   unless a session row already exists — reuse `assert_class_runs_on(uuid, date)`, which is
>   already a listed helper. A roster row against a fabricated date is a lesson that will be
>   marked, paid, and billed on a day the class never met.
> - **Assertion.** After `assign_session_coach()` on a class's ordinary weekday with no prior
>   session row: `SELECT count(*) FROM lesson_sessions WHERE class_id=… AND session_date=…` is
>   **1**, and calling it a second time leaves it **1** — not 2. Prove it red by removing the
>   resolve half.
> - **Verify before writing any of it.** Pre-creating a session row is not free: it becomes
>   visible to the completeness gate. Run the Deno suite against a database where a
>   **future-dated** and a **today-dated** empty session row exist for a live class and record
>   whether the month's `N of M` or the unmarked-attendance block moves. `windowTo` is clamped
>   to today (`core.ts:620`), so a future row should be inert — **confirm that, do not assume
>   it**, because the block has no override (§8i) and this is the way to trip it.

### 1.2 The absence rule — the whole reason this is a safe deploy

> **No roster row means the class's coach is the main coach.**

There is **no backfill**, every existing lesson keeps its exact current behaviour, and the
table is empty on the day it ships. Both gates below encode this fallback, and it is the
reason the one narrowing in 1.4 cannot bite anyone at deploy time.

### 1.3 Two gates — `SECURITY DEFINER SET search_path = public`, both

```
coach_teaches_session(p_session_id)   -- READ  gate
    the roster's main OR any shadow;
    falls back to classes.coach_id when the session has no roster main

coach_is_main_on_session(p_session_id) -- WRITE gate
    the roster's main if one exists, else classes.coach_id
```

**Definer rights are not style, they are §7.125**: RLS on `session_coaches` can hide the very
row that would have satisfied the check, and a check that cannot see a row **silently
passes** — the exact failure a gate exists to prevent. `SET search_path` is not optional on a
`SECURITY DEFINER` function.

> ### ⚠ RISK 8 MITIGATION — a new function reaches NOBODY, and `sessions_select` is read by every role
>
> `20260804000700` did `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON FUNCTIONS FROM authenticated`
> and `20260804000400` did the same for `anon`/`PUBLIC`. **A function created today has no ACL
> for `authenticated` at all.** A policy expression is evaluated as the *invoking* role, so
> `sessions_select` gaining `OR coach_teaches_session(id)` without a grant means **every
> `SELECT` on `lesson_sessions` throws `permission denied` — for parents and admins too**, not
> just coaches. That is a whole-app read outage from one missing line.
>
> - **Step, in the same migration, for every new function** — `coach_teaches_session`,
>   `coach_is_main_on_session`, `session_pay_amount(uuid, uuid)`, `assign_session_coach`,
>   `set_session_main_coach`: `REVOKE ALL … FROM PUBLIC` · `REVOKE ALL … FROM anon` ·
>   `GRANT EXECUTE … TO authenticated, service_role`. Copy the `DO $$ … helpers TEXT[]` block
>   shape from `20260804000200_revoke_anon_execute.sql:141`.
> - **Assertion.** `supabase test db` — `function_grants.test.sql` is written over `pg_proc`,
>   not a name list, so it covers a function added today **automatically** and goes red on the
>   `anon` half without anyone remembering. That is the structural half.
> - **Assertion for the other half** (which nothing catches automatically): as the seeded
>   parent login, `SELECT id FROM lesson_sessions LIMIT 1` returns a row. A `permission denied
>   for function coach_teaches_session` here is the missing `GRANT`.

### 1.4 RLS — the policy list is NINE, not five, and one of them narrows

> ### ⚠ RISK 1 MITIGATION — THE HIGHEST-RANKED RISK IN THIS WAVE
>
> **A substitute given only `sessions_select` + `attendance_*` cannot run the lesson.**
> Verified against the shipped policies, not reasoned about:
>
> | Policy | Where | Coach branch today | B's experience without it |
> |---|---|---|---|
> | `classes_select` | `20260718000900:333` | `coach_id = current_coach_id()` | no class row → **no title, no times, no week card at all** |
> | `enrolments_select` | `:350` | `coach_owns_class(class_id)` | **no roster** — nobody to mark |
> | `sessions_write` | `:374` | `coach_owns_class(class_id)` | attendance.tsx:475's lazy INSERT fails → *"Could not create session record."* |
> | `trial_bookings_select` | `20260725000700:81` | `c.coach_id = current_coach_id()` | trial guest invisible — see RISK 4 |
> | `makeup_bookings_select` | `20260802000100:80` | `c.coach_id = current_coach_id()` | make-up guest invisible — see RISK 4 |
>
> This is the risk that decides the shape of Step 3: it is discovered **in Phase B**, inside a
> worktree, and **a worktree may not author a migration (§7.55)** — so both worktrees stall on
> a migration that has to be written from the root. Close it in Step 1 or pay for it twice.
>
> - **Structural step, replacing the vigilance version.** `sessions_write` does **not** get
>   widened. Instead 1.1a's `assign_session_coach()` creates the session row as the **admin**,
>   so by the time B ever opens the screen the row exists and B never needs INSERT on
>   `lesson_sessions`. Fewer policies moved, and it fails closed.
> - **Prohibition.** Do **NOT** widen `sessions_write`. A substitute able to create lesson rows
>   can manufacture a lesson on a date the class never ran, which is billable.

1. `sessions_select` — add `OR coach_teaches_session(id)`
2. `attendance_select` — add `OR coach_teaches_session(lesson_session_id)`
3. **`attendance_write` — `coach_owns_session(...)` becomes `coach_is_main_on_session(...)`**
4. `students_select` — add a path for a coach rostered on a session of a class the child is in
5. `classes_select` — add `OR EXISTS (a roster row of mine on a session of this class)`
6. `enrolments_select` — same shape, on `class_id`
7. `trial_bookings_select` — add the roster branch on `class_id`
8. `makeup_bookings_select` — add the roster branch on `class_id`
9. `session_coaches` — its own policies (admin write; rostered coach reads their own row)
   **plus the matching `GRANT`** — a policy without a grant throws `permission denied` in dev
   (§7.87), and `table_grants.test.sql` goes red on a grant no policy permits

> ### ⚠ RISK 7 MITIGATION — the roster branch must NOT go inside `coach_serves_student()`
>
> Decision 2 protects `coach_owns_class()`. **The undefended door is the other one.**
> `coach_serves_student()` authorizes `set_students_active()`
> (`20260719001200_active_inactive_rpcs.sql:93`) — and `HANDOVER.md` §3 records that the coach
> app really does call it, from `SwimSyncApp/lib/studentStatus.ts`. Adding a roster branch to
> `coach_serves_student()` would let a coach covering **one hour** set a child inactive across
> the whole business. Same failure Wave 2 found, one function to the left.
>
> - **Named prohibition.** Policy #4 is a **new** function —
>   `coach_rostered_with_student(p_student_id)` — referenced **only** from the
>   `students_select` policy. `coach_serves_student()`'s body is **not edited by this wave**.
>   Policies #5–#8 likewise inline their own `EXISTS`; they do not call `coach_owns_class()`.
> - **Assertion.** `git diff` on the migration contains **zero** occurrences of
>   `CREATE OR REPLACE FUNCTION public.coach_serves_student` /
>   `…coach_owns_class` / `…coach_owns_session`. A hit is a blocker.
> - **pgTAP.** B, rostered on one session, gets `FALSE` from `coach_serves_student()` for a
>   child in that class, and `set_students_active()` **raises** for B. Prove it red by moving
>   the branch into `coach_serves_student()` — it must go green there, which is the point.
> - **Scope note, accepted.** #4–#8 are *class*-scoped, not lesson-scoped: while the roster row
>   exists, B reads the class's current roster. Narrowing it to "children enrolled on that
>   session's date" is the correct end state and is **explicitly out of scope**; file it in
>   `BACKLOG.md` at close rather than half-building it here.

⚠ **#3 is the only narrowing in the wave.** When B covers, A loses write on that one lesson.
That is intended and is the point of decision 5 — but it is **data-dependent**, and by 1.2 no
roster rows exist at deploy. Nothing changes until an admin assigns. **If this migration ever
ships with seed roster rows, that safety argument dies.**

> ### ⚠ RISK 4 MITIGATION — the narrowing plus an invisible guest is a billing DEADLOCK
>
> Compose #3 with a missing #7/#8 and you get the worst outcome in the wave. A trial or
> make-up guest is booked into the covered lesson. A has lost write. B cannot **see** the
> guest, marks the enrolled children, and the screen says done. The engine expects the guest
> — `attendance.tsx:314` says so in its own comment: *"without this they would never appear,
> never be marked, and the billing month could never close"* — the month blocks, **the block
> has no override by design (§8i)**, and no screen anywhere says why. That is §8.32's deadlock
> on a third axis.
>
> - **Step.** Policies #7 and #8 are **not optional and not deferrable to Phase B.** They ship
>   in the Step 1 migration or the wave does not ship.
> - **pgTAP assertion, in Step 2, written FIRST.** Book a trial guest into a lesson B is main
>   on. Assert B's readable roster for that session has the guest in it, B can write the
>   guest's attendance row, and `session_pays_coach()` is TRUE. Prove red by deleting the #7
>   branch — the guest must disappear.
> - **Deno assertion.** The same fixture through `generate-invoices` twice (§7.15): the month
>   closes and the guest is billed. A month that will not close is the deadlock, reproduced.

### 1.5 Pay

**Add a two-argument `session_pay_amount(p_session_id, p_coach_id)`. Keep the one-argument
version as a wrapper that delegates to the session's main coach — do NOT drop it.**

This is §7.123, applied. Wave 2 dropped `close_student_enrolment(uuid, boolean)` and broke
"Remove from class" on the live admin and coach app for the window between `supabase db push`
and the push to `main`, because every check ran the migration against the *database* and none
against the *deployed client*. An overload costs nothing and removes the window entirely.

Rate resolution for the named coach, in order:
1. `class_rate_overrides.flat_amount` in force on the date — **main coach only** (see
   Accepted consequences, and RISK 9 below, which must be settled before this line is written)
2. otherwise that coach's own `coach_rates` row in force, × duration
3. no rate in force → return nothing; that coach is not on payroll

`generate_coach_payouts` session selection becomes:

> sessions where this coach is on the roster (main or shadow),
> **plus** sessions whose `class_rate_on(class_id, session_date).paid_coach_id` is this coach
> and that have **no** roster main.

> ### ⚠ RISK 6 MITIGATION — "classes they own" and "the session's main coach" both mean `classes.coach_id`, and that is the bug `20260719000800` exists to close
>
> The first draft of the line above read *"sessions of classes they own"*. The shipped query
> does **not** use ownership — `20260719000900:131` is
> `CROSS JOIN LATERAL class_rate_on(ls.class_id, ls.session_date) r … WHERE r.paid_coach_id =
> v_coach.id`. That header is explicit: **access follows the current coach, money follows
> history.** Substituting `classes.coach_id` back in reinstates "handing over a class moves its
> entire unpaid history" — A drops to $0 and B is paid for four lessons they never taught.
> The same trap sits in §1.5's wrapper sentence: *"delegates to the session's main coach"* is
> `classes.coach_id` if read literally, and must be `paid_coach_id`.
>
> - **Named prohibition, attached to both lines.** In **any** pay path — `session_pay_amount`'s
>   fallback, the selection query, the adjustment loops — the no-roster coach is
>   `class_rate_on(class_id, session_date).paid_coach_id`. **`classes.coach_id` appears nowhere
>   in `generate_coach_payouts` or `session_pay_amount`.** The gates in 1.3 are the *only*
>   place `classes.coach_id` is correct, because they are access, not money.
> - **Assertion.** After the migration: `pg_get_functiondef` for both functions contains **zero**
>   occurrences of `classes.coach_id` / `c.coach_id`. Grep it, do not read it (§7.115).
> - **pgTAP, proven red.** Coach A teaches four July lessons; the class is handed to Coach C on
>   3 Aug via `set_class_terms()`; **no roster row exists**. Re-run July's draft: A is still
>   paid four lessons at A's rate and C is paid **zero**. This is `coach_wages.test.sql`'s
>   existing invariant — **re-run that whole file unchanged and require the same count as
>   before the wave.** A changed count means the absence rule (1.2) has been broken.
>
> ### ⚠ RISK 2 MITIGATION — the wrapper is not enough; every CALL SITE must pass the coach
>
> `generate_coach_payouts` calls `session_pay_amount(v_sess.id)` in **two** places
> (`20260719000900:139` in the current-period loop and **`:172` inside the adjustment loop**).
> Keeping a one-argument wrapper makes both *compile* and leaves both *wrong*:
>
> - At `:139` a shadow T's item would be priced at the **main's** rate.
> - At `:172` — the expensive one — coach A's correction for a now-covered July lesson would be
>   computed as `B's rate − A's paid`, instead of `0 − A's paid`. `20260719000800`'s header
>   names this exact failure as already-happened history: *"A received an adjustment computed
>   from another coach's pay."* Silent, and it is real money.
>
> - **Step.** Both call sites become `session_pay_amount(v_sess.id, v_coach.id)`. The
>   one-argument form survives **only** for the deployed client across the §7.123 window — it
>   is not called from inside the payout builder at all.
> - **Assertion.** `pg_get_functiondef('generate_coach_payouts')` contains **zero** occurrences
>   of `session_pay_amount(v_sess.id)` without a second argument. Two matches for the 2-arg
>   form, none for the 1-arg.
> - **Named prohibition (§7.124).** The two-argument form takes **no DEFAULT** on
>   `p_coach_id`. A defaulted parameter creates a *second* `pg_proc` row and PostgREST goes on
>   resolving the old one by name — §7.124, measured in Wave 2. `\df session_pay_amount` must
>   show **exactly two** rows, one per arity.
> - **pgTAP.** Shadow T at a rate deliberately different from main A's: T's item equals T's
>   rate × duration, A's equals A's. Equal amounts mean the coach argument is being ignored.
>
> ### ⚠ RISK 9 MITIGATION — flat-rate override × substitute is UNDEFINED, and both rules claim it
>
> Decision 1 says a substitute is paid **their own** `coach_rates` rate. Rate resolution step 1
> says a class flat amount applies to the **main** coach — and a substitute **is** the roster
> main. On a flat-rate class with a cover, the two rules give different money and neither is
> marked as losing. This is not re-litigating decision 1; it is the one case decision 1 and the
> flat-rate rule overlap on.
>
> - **Step, before the migration is written.** Ask the user one question: *on a flat-rate class,
>   does a substitute get the flat amount or their own rate?* One line, and it unblocks.
> - **Fail-safe default if the answer does not arrive:** the flat amount applies **only when the
>   roster main is also `class_rate_on().paid_coach_id`** — i.e. flat is a property of the
>   class's own coach teaching it, and a substitute always falls through to their own rate,
>   which is what decision 1 says in plain words. Structural, not a note: write it as the
>   condition, so a future flat-rate class inherits it without anyone remembering.
> - **pgTAP.** A flat-rate class covered by B: assert the chosen answer explicitly, with the
>   other answer's number written in the comment so the next reader knows a choice was made.

### 1.6 The adjustment gap — the one place this wave can lose real money

✅ **CONFIRMED against the code, not the prose.** The claim is real. The exact text (newest
body, `20260719000900:155-165` — **not** `…000800`, see the corrected note above) is:

```sql
FROM coach_payout_items i
JOIN coach_payouts prev ON prev.id = i.payout_id
WHERE prev.tenant_id = p_tenant_id
  AND prev.coach_id  = v_coach.id
  AND prev.status    = 'paid'
  AND prev.period_month < p_period_month
  AND NOT i.is_adjustment
```

The loop is driven **from existing items**. A coach with no item in the paid period is never
visited. So when an admin fixes a July cover after July was paid:
- **A** has a July item → recomputes to nothing → `-$40` adjustment. Correct.
- **B** has no July payout row at all → the loop never considers the session → **B's `+$55`
  is silently never paid.**

Fix: a second loop over paid periods where this coach is **newly on the roster** for a session
that produced no item for them. **This gets its own pgTAP before anything else in Step 2** —
it is the only silent-money defect in the wave, and it is invisible from every screen.

> ### ⚠ RISK 3 MITIGATION — the new loop must carry the correction ONCE, or it re-opens `20260719000900`
>
> `20260719000900` exists because the *first* adjustment loop re-emitted the same difference on
> every later period, forever — *"the coach is docked the same $45 every month, indefinitely.
> With a positive correction it runs the other way — the business pays the same back-pay over
> and over."* Its cure is the `v_carried` running total at `:179-188`:
> `diff := owed_now − paid_originally − SUM(adjustments already emitted)`.
>
> **A second loop written as "B has no item, so emit `+$55`" has no `paid_originally` and no
> `v_carried`. It emits `+$55` in August, again in September, again forever** — the identical
> bug, on the identical table, five months after it was fixed. `ON CONFLICT DO NOTHING` does
> not save it: that dedupes within one payout, and each month is a different payout.
>
> - **Step.** The new loop uses the same three-term form, with `paid_originally = 0`:
>   `v_diff := v_now − 0 − v_carried`, where `v_carried` is the **same** subquery as `:179` —
>   `SUM(i2.amount)` over this coach's adjustment items for this session on any payout except
>   the one being rebuilt. Lift it into a helper both loops call rather than copying it, so a
>   future fix cannot land on only one.
> - **Assertion, and it is the one that matters.** Run `generate_coach_payouts` for the SAME
>   later period **three times**, and then for a third, later period. B's `+$55` appears
>   **exactly once across all payouts** — `SELECT SUM(amount) FROM coach_payout_items WHERE
>   lesson_session_id = … AND is_adjustment` is **55.00**, not 110 and not 165. Prove it red by
>   deleting the `v_carried` term.
> - **Named prohibition.** Do **NOT** implement "emit once then suppress forever" (a flag, a
>   `NOT EXISTS` guard). `20260719000900`'s header rejected it by name: a lesson can be
>   corrected twice — a late attendance edit, then a backdated rate — and suppression loses the
>   second one. The running total handles both.
> - **Assertion for the other side of the same event.** In the same fixture, A's `−$40` must
>   also appear exactly once, and A's total for that session across all payouts must be
>   **0.00**. B gaining without A losing is a double-pay; A losing without B gaining is the gap
>   this section opens with. **Assert both in one test, not two.**

### 1.7 Rollback

`supabase/rollback/2026xxxx_session_coach_roster_DOWN.sql`, **committed before the deploy**
(the pattern from `20260804_authenticated_grants_DOWN.sql`, not a scratchpad backup nobody can
find) and **rehearsed by running it** — §7.93, where running the DOWN file is the half that
finds the bugs. It must restore the one-argument `session_pay_amount` behaviour and the
original `attendance_write` policy.

---

## Step 2 — pgTAP, before any UI

⚠ **The blast radius is coach RLS, not the roster.** pgTAP comes before a single screen.
New file `supabase/tests/session_coach_roster.test.sql`. **No target count is written here on
purpose** — the runner is the fact, and every count this repo has put in prose has drifted.
The list below is what must be *covered*; the number falls out of it:

**The absence rule** — a session with no roster row behaves exactly as today, for read,
write and pay. *(Proven red by deleting the fallback branch.)*

**Roster integrity** — two mains on one session raises; the same coach twice on one session
raises; a coach of another tenant cannot be rostered.

**Substitute** — B can select the session · B can select its enrolled students · B can write
attendance · **B canNOT call `close_student_enrolment()`** · **B canNOT see the class's other
lessons** · **B canNOT read the class's other sessions' attendance**.

**The narrowing** — A canNOT write attendance on a lesson B is main on.

**Trainee** — T can select the session and its students · **T canNOT write attendance** ·
T's shadow row produces a second payout item at T's own rate · A still gets full pay.

**Pay** — pay follows the roster main, not `classes.coach_id` · a coach with no `coach_rates`
row produces no item · **§1.6: B gets a positive adjustment in a period they had no payout in**.

**Cross-tenant** — every one of the above refused across a tenant boundary.

**Added by /plan-review — these are not optional extras, they are the ranked risks:**

- **RISK 1 / RISK 4 — the whole lesson, not the policy.** One test that walks B end to end:
  read the class row · read the enrolment roster · read the **trial guest** · read the
  **make-up guest** · write attendance for all of them · `session_pays_coach()` is TRUE. Any
  single missing policy fails it. Prove red by reverting each of the five new branches in turn.
- **RISK 7 — the undefended door.** `coach_serves_student()` is FALSE for B, and
  `set_students_active()` **raises** for B, on a child in the class B is covering.
- **RISK 2 — the coach argument is actually read.** Shadow T at a rate deliberately unequal to
  main A's; equal item amounts mean the second argument is being ignored.
- **RISK 3 — carried once.** Three runs of the same period plus a fourth period:
  `SUM(amount) WHERE is_adjustment` per session is `+55.00` for B and `−40.00` for A, and the
  session's total across every payout of A's is `0.00`.
- **RISK 6 — the absence rule did not move the money.** `coach_wages.test.sql` and
  `class_terms.test.sql` re-run **unchanged**, same counts as before the wave. A changed count
  is a regression, not a new test.
- **RISK 5 — resolve-or-create is idempotent.** `assign_session_coach()` twice on a date with
  no session row leaves exactly one `lesson_sessions` row.
- **RISK 8 — the grant half.** As the seeded **parent**, `SELECT` on `lesson_sessions` returns
  a row. This is the assertion that catches a policy calling an ungranted function.

---

## Step 3 — Phase B, two worktrees

Created **after** the migration is on `main`, so both branch from `origin/main` with the
schema already in them. Both declare `supabase/` — **NO**.

> ### ⚠ RISK 1 (second half) MITIGATION — the worktree gate
>
> RISK 1 is a Step-1 miss that only *hurts* in Step 3, where **a worktree may not author a
> migration (§7.55)** — so discovering a tenth missing policy in wt-coach stalls both
> worktrees behind a root-checkout migration and a `db/…` branch.
>
> - **Gate, before `/worktree-start` is run at all.** Log in as coach B in the real UI (the
>   `run-ui-playwright` skill, coach role) on a session B is rostered to cover, and walk:
>   Schedule tab shows the lesson → open it → the roster lists every child **and both guest
>   types** → mark → save succeeds. **A box that cannot be ticked here is a blocker, not a
>   caveat** — go back to Step 1's migration while a migration is still legal to write.
> - **Assertion.** Zero rows in `supabase/migrations/` change on either worktree branch.
>   `git diff --name-only origin/main -- supabase/migrations/` is empty at
>   `/worktree-close`.

### wt-admin (~1 session, port 3100, fixture prefix `wt-admin-`)

**Owns** `SwimSyncAdmin/app/(admin)/` — the "who taught this lesson" assignment surface
(pick a main, add N shadows) and `wages/page.tsx`, which must sum a **set** of payout items
per lesson rather than read one row, and must show a cover as a visible decision rather than
silently altering a total. vitest.

### wt-coach (~0.5 session, expo 8082, fixture prefix `wt-coach-`)

**Owns** `SwimSyncApp/app/(coach)/` — `schedule/index.tsx:306-341` and
`classes/[id]/attendance.tsx`, plus `pay/index.tsx`. jest.

⚠ **Not one line.** `:317` filters **`classes`**, and the week card is built from that row's
`title` / `day_of_week` / `start_time` / `end_time` / `location_name` and its nested
`student_class_enrolments`. A covered lesson belongs to a class B does not own, so the shape is
**two fetches unioned in JS**, not a widened `.eq()`: (a) `classes` where `coach_id = me`, as
today, and (b) the `session_coaches` rows for me joined to their sessions and classes. Merge on
`class_id:session_date` — the key `sessionByClassDate` already uses.

⚠ `lib/useCoachHasPayouts.ts` needs **no change** (verified: `count`/`head`, no row
assumption). Listed here only so the worktree does not spend a pass rediscovering that.

### The one cross-worktree rule, and it is a real trap

**A covered lesson leaves A's NEEDS MARKING list and appears on B's.** It follows from
decision 6: leaving it on A's list shows a straggler A is not permitted to clear, and
unmarked attendance blocks billing with **no override** (§8i). NEEDS MARKING is floor-scoped
and deliberately ignores the week selector — do not "fix" this by scoping it.

### Both worktrees must NOT touch

`HANDOVER.md`, `PRD.md`, `BACKLOG.md` (written from the root at close) ·
`drivers/lib.mjs`, `supabase/config.toml` (shared) · `lib/lessonDates.ts` and the three
copies of `attendanceCompleteness.ts` (byte-identical across projects) ·
`supabase/migrations/` (a worktree never authors a migration — §7.55).

**Run `supabase db reset` at the END of Step 1, before either worktree exists.** After that,
`git worktree list` before any reset, and `run-all-drivers.sh` is banned while a sibling is
live (it resets the database per driver).

---

## Step 4 — Driver and deploy (root checkout)

`verify-coach-roster.mjs` + `fixtures-coach-roster.sql` + its teardown in the same commit
(`check-teardowns.sh` enforces it), and **measure its sabotage signature** — Wave 2's new
driver contained a check that matched zero times and passed while testing nothing, found only
by measuring. Assert a string the seed does not otherwise produce.

**Deploy order: migrations first.** Everything in Step 1 is additive (new table, new
functions, a new overload with the old signature kept), and the single narrowing in 1.4 needs
roster data that will not exist. Then the apps. Budget the post-deploy grant dump (§7.39,
§7.89) — local and cloud disagree by construction.

**Do not take `supabase db push`'s own output as proof.** It has printed a `pgdelta`
certificate stack trace *and* `Finished supabase db push` three times now.
`supabase migration list --linked` with a filled `remote` column is the fact.

---

## Accepted consequences — vigilance only, no structural fix in this wave

- **`class_rate_overrides.flat_amount` applies to the main coach only.** Shadows are always
  paid duration × their own rate. A flat class fee is a price for the lesson, not a price per
  body in the pool. Stated rather than asked; revisit only if a real flat-rate class ever
  takes a trainee. **⚠ This bullet only settles the SHADOW. It does not settle the
  SUBSTITUTE, where the flat rule and decision 1 both claim the same case and disagree — see
  RISK 9 in §1.5, which must be answered before §1.5 is written.**
- **Production cannot exercise the pay half.** `generate_coach_payouts` only considers coaches
  with a `coach_rates` row, and production is a private coach with none — so **no payouts
  exist in production at all**. Wave 3's pay path is dormant until the business hires a second
  coach, which is also the day "set a coach rate" stops being a non-task (`HANDOVER.md` §9).
  This makes the wave cheap to get wrong and impossible to validate on real data.
- **A cover is one lesson at a time.** A three-week absence is three assignments. A bulk
  "apply to the next N lessons" button is a later UI change, not a schema change.
- **`book_trial()` still refuses a child with an active enrolment**, unchanged from Wave 2.
  Nothing here touches it.

---

## Graduating to `docs/GOTCHAS.md` §7

Collect in each `WORKTREE.md`, write from the root at close. Candidates known up front:

- Whether the two-gate split (read = rostered, write = main) survives contact with the
  Schedule tab's marking-state logic.
- Whatever §1.6's adjustment fix turns up — an aggregate whose loop bound silently excludes
  the new case is a shape worth naming.
- **RISK 1, and it graduates whatever happens.** *"Widening the gate on the row you were
  thinking about is not widening access to the SCREEN. Enumerate every table the screen reads
  — the class, the roster, both booking tables, and the lazily-created session row — before
  counting the policies."* Five of the nine policies this wave needs were invisible from the
  feature description.
- **RISK 3.** *"A loop that was fixed to carry a correction ONCE will be re-broken by the next
  loop added beside it."* The cure lives in one loop's body, so a second loop inherits nothing.
  Extract the running total or it happens again.
- **RISK 2.** *"Adding a parameter to a function does not add it to the callers."* An overload
  that keeps the old arity compiles every existing call site unchanged and wrong.

---

## Pre-commit gate

`supabase test db` · Deno **×2** (§7.15 — a completing run seals its billing month, so
passing once proves nothing) · vitest · jest · `npm run typecheck` in both apps ·
`check-fixture-roundtrip.sh` · `verify-coach-roster` · the DOWN file rehearsed ·
remote grant dump re-checked.

**Every new test must be proven to fail without the fix** before it counts as coverage
(§7.25). For Step 2 that means running the new pgTAP against the DOWN file, exactly as
`multi_class.test.sql` was proven in Wave 2.

### The risk boxes — a box that cannot be ticked is a BLOCKER, not a caveat

**The three that decide whether this wave ships:**

- [ ] **RISK 1 — the substitute can actually run the lesson.** Real UI, coach role, covered
      session: week card → roster → **trial guest** → **make-up guest** → save. Walked
      **before** either worktree is created, while a migration is still legal to write (§7.55).
- [ ] **RISK 2 — `pg_get_functiondef('generate_coach_payouts')` has zero one-argument
      `session_pay_amount(v_sess.id)` calls.** Both call sites pass `v_coach.id`. `\df
      session_pay_amount` shows exactly two rows and `p_coach_id` has **no DEFAULT** (§7.124).
- [ ] **RISK 3 — the correction is carried once.** Same period generated ×3 plus a later
      period: B's session sums to `+55.00` across all payouts, A's to `0.00`. Proven red by
      deleting the `v_carried` term.

**The rest:**

- [ ] **RISK 4** — trial + make-up guest markable by the substitute; the month closes through
      the Deno suite (×2) with the guest billed.
- [ ] **RISK 5** — `assign_session_coach()` is idempotent (one `lesson_sessions` row after two
      calls); the Deno suite is unmoved by a future-dated empty session row.
- [ ] **RISK 6** — neither pay function mentions `classes.coach_id`; `coach_wages.test.sql`
      and `class_terms.test.sql` re-run **unchanged with the same counts**.
- [ ] **RISK 7** — the migration diff contains **zero** redefinitions of
      `coach_serves_student` / `coach_owns_class` / `coach_owns_session`; `set_students_active()`
      raises for the substitute.
- [ ] **RISK 8** — every new function has its `REVOKE PUBLIC` / `REVOKE anon` /
      `GRANT EXECUTE TO authenticated, service_role`; `function_grants.test.sql` green; a
      **parent** login can still `SELECT` from `lesson_sessions`.
- [ ] **RISK 9** — the flat-rate × substitute question answered by the user (or the fail-safe
      default written as a condition), with the rejected number in the test comment.
- [ ] **RISK 10** — main is reassigned through `set_session_main_coach()`, not an upsert; no
      `ON CONFLICT DO NOTHING` on the main insert; `check-fixture-roundtrip.sh` re-proven by
      sabotage **against a session no sibling fixture touches** (§7.127).
