# Wave 4 — a start date on add-to-class, and the Front-desk role walked end to end (two lanes)

_Planned 2026-10-05 with `/plan-with-confidence`. Build order: `BACKLOG.md` → *Build order* → Wave 4 (+ Wave 5,
conditional). Status: **REVIEWED by `/plan-review` 2026-10-05 — mitigations inlined (⚠ RISK n).**_

## What this builds, and why

1. **Lane 1 — *Choose a start date when adding a child to a class*.** Every enrolment is stamped `enrolled_at = NOW()`,
   and every roster starts on that SGT date. On 04 Oct 2026 a child swam the day before the admin assigned them, and
   the only remedy was a SQL `UPDATE` on production (DEPLOYMENT #62) — unaudited, because enrolments carry no audit
   trigger. This adds an optional **Starts on** date to all three add-to-class screens, a **Change start date**
   action on an existing enrolment, and one audited RPC behind both. The *Correct the "new key" COMMENTs* item rides
   in the same migration.
2. **Lane 2 — the Front-desk walkthrough.** The co-admin being hired holds the standard **Front desk** role
   (Operations = Edit, every money area = None — `ROLES_PERMISSIONS_PLAN.md` §4). A permanent UI driver does that
   person's job as that person, so a future change cannot quietly break their pages. It confirms or clears *A
   co-admin without pricing access may see NO teaching coach anywhere* (`BACKLOG.md`, unreproduced).

## Decisions settled with the user (2026-10-05)

| # | Question | Answer |
|---|---|---|
| D1 | Which screens get *Starts on*? | **All three** — Students → *Add class*, Unassigned → *Assign*, Trials → *Convert* — through **one** RPC |
| D2 | Edit an existing enrolment's start? | **Yes** — a *Change start date* action (the 04 Oct case was found after the add) |
| D3 | How far back? | **To `markable_floor(tenant)`**; a date inside a **sealed** month is allowed **with a warning** that those lessons land on the unbilled-lessons report (PRD §7.17) |
| D4 | What does lane 2 leave behind? | **A permanent UI driver** (`verify-front-desk-role.mjs` + fixtures), in the nightly |
| D5 | Hire's role | **Front desk** standard role (earlier today, re-rank) |
| D12 | Students → *Add student* (4th path, `add_unclaimed_student`) gets *Starts on*? | **Yes** (after review, RISK 3) |
| D13 | The 5 GOTCHAS candidates below | **Graduate each once the build proves it**, at `/update-docs` |

Decided from the code (reviewed 2026-10-05; corrections marked):

- **D6 — upper bound is today (SGT).** A future start is a different feature (BACKLOG's own note).
- **D7 — moving a start LATER is allowed, but refused if any attendance mark for that child in that class falls
  before the new date** (it would orphan a recorded lesson from its roster).
- **D8 (CORRECTED) — a new start may not fall BEFORE the same child's previous closed enrolment's end date in the same
  class** (`unenrolled_at` SGT date, `U`). `S < U` is refused; **`S = U` is allowed**. The two windows then share one
  day, which every span reader already de-duplicates (`UNION` in `class_expected_count` / `class_unmarked_lesson_dates`
  / `mark_day_holiday`; `studentsEnrolledOn`; `mergeRoster`, §7.66). This keeps today's same-day remove → re-add working.
- **D9 — the edit control lives in the class Roster drawer**, next to the *Joined <date>* it already shows
  (`classes/ui/RosterDrawer.tsx:214`). That line becomes the read-back of the change.
- **D10 (CORRECTED) — storage.** `starts_on = today` → `NOW()` for **both** add and change (today's behaviour).
  Any other date → **`((p_starts_on + TIME '12:00') AT TIME ZONE 'Asia/Singapore')`, i.e. 12:00 SGT = 04:00 UTC on
  the same calendar date.** Reason: DEPLOYMENT #62's backdate is stored at `2026-10-04 04:00:00+00` (noon SGT), **not
  midnight**, and the engine reads `enrolled_at` with a raw `.slice(0,10)` (UTC date) in `core.ts:699` and
  `orderingGuard.ts:382`. At noon SGT the UTC and SGT dates agree, so every reader gets the same day. Readers are
  date-granular (all 9 DB functions use `AT TIME ZONE 'Asia/Singapore'`; every client reader uses `toSgDate()`), so no
  reader changes.
- **D11 — if lane 2 confirms a bug, it stops and the fix lands first** (Wave 3's rule). A fix needing a migration
  is authored in the root checkout **after** lane 1's migration has landed (one schema change in flight) — this
  is Wave 5 pulled forward, not new scope.

## Rules both lanes obey

- **Read before writing:** `docs/GOTCHAS.md` §7.7, §7.40, §7.57, §7.66, §7.87, §7.102, §7.103, §7.123, §7.124, §7.202,
  §7.226, §7.227, §7.253, §7.268, §7.289, §7.305.
- **Function bodies from the database, never a migration file** (§7.40): `SELECT pg_get_functiondef(...)`.
- **Tests proven red without the fix** (§7.25) — record each mutation and its failing assertion in the commit body.
- **Fixture dates derive from `session_window_start()`** or CI refuses them (§7.305).
- **Shared database.** Lane 2 lives in a worktree. **Nobody runs `supabase db reset` or `run-all-drivers.sh --only`
  while the other lane is live** — `--only` resets the DB. Lane 2 runs its driver directly
  (`psql < fixtures-front-desk-role.sql && node verify-front-desk-role.mjs && psql < fixtures-front-desk-role-teardown.sql`,
  psql via `docker exec -i supabase_db_SwimSync psql -U postgres`) with `ADMIN_URL` at its own port
  (`docs/WORKTREES.md`). Lane 1 applies its migration with `supabase migration up`, not a reset. `git worktree list`
  before any reset, every time.
- **Lane 2 never authors a migration** and never edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`; findings go in its
  `WORKTREE.md` graduate list.
- **Nightly gate:** read tonight's nightly (the first over deploys #61 + #63) before lane 1's APP unit merges
  to `main`. Never dispatch it. (CLAUDE.md *Conventions*, HANDOVER *The nightly sweep*.)
- **Out of scope, flag only:** Wave 6, *Package-funded lessons need no monthly run*. Nothing in this wave changes
  what the engine bills or how packages are drawn.

---

## Lane 1 — root checkout (this session)

### 1.0 Baseline
- `supabase status` (start if needed), `cd SwimSyncAdmin && npm test && npm run typecheck`, `supabase test db`,
  `supabase/functions/generate-invoices/test.sh` **twice** — record every count as the baseline.
- Branch `db/enrolment-start-date` off `main`.

> ⚠ **RISK 3 MITIGATION — the fourth add path.** **Step, before 1.1:** ask the user: *"Students → Add student (with
> a class) is a fourth path (`add_unclaimed_student`). All 32 audited production adds used it, including all 19 Little
> Orcas children. Include it, or cover it with Change start date after the add?"* Record the answer here.
> **Answer (user, 2026-10-05): INCLUDE IT** — the *If included* branch below is in scope; the default branch is not.
> - **If included:** 1.1 also gives `add_unclaimed_student` a trailing `p_starts_on DATE DEFAULT NULL`, routed through
>   the same write and date rules as `set_enrolment_start`. **`DROP FUNCTION` the exact old 9-argument signature
>   first** (§7.124), then re-`GRANT`. **Assertion:** `\df add_unclaimed_student` returns exactly 1 row.
>   **Assertion:** a pgTAP case calls it with the OLD named-argument list (no `p_starts_on`) and succeeds, so the live
>   app survives the window between the migration and the app deploy (§7.123). The Add-student form gains
>   `<StartsOnField>`.
> - **If not included (default if unanswered):** **step:** 1.5's driver adds a check that a child added via *Add
>   student* can have *Change start date* moved earlier and the roster shows it. **Step:** the 1.6 owner message
>   says "new child who already swam: add them, then Change start date on the class roster".

### 1.1 Migration `20261005000100_enrolment_start_date.sql` (expand only)

**`set_enrolment_start(p_student_id UUID, p_class_id UUID, p_starts_on DATE, p_mode TEXT) RETURNS JSONB`** —
`SECURITY DEFINER`, `SET search_path = public`. **No parameter defaults** (§7.124). One function for **both** add and
change, chosen **explicitly** by `p_mode`.

> ⚠ **RISK 2 MITIGATION — the mode is explicit, never inferred.** `p_mode IN ('add','change')`, anything else →
> refuse.
> - `'add'` with an active (student, class) row → **refuse** with *"<child> is already in <class> (since <SGT date>).
>   To change when they started, use Change on the class roster."*
> - `'change'` with no active row → refuse with *"<child> is not in this class."*
>
> **Do NOT write "active row exists → edit, else insert".** That turns a duplicate Add into a silent start-date rewrite.

- **Auth:** `auth.uid()` not null; `is_platform_admin() OR has_admin_area(class_tenant(p_class_id), 'operations',
  'edit')` — the same gate as the `enrolments_write` policy. Student and class in the same tenant (the
  `enrolment_tenant_guard` trigger also enforces it; check first for a clean message).

> ⚠ **RISK 4 MITIGATION — the definer's check is the only check.** RLS does not run inside this function.
> - **Prohibition:** do NOT copy `close_student_enrolment`'s `OR coach_owns_class(...)` arm. Coaches must not add
>   students (§7.202).
> - **Step:** derive the tenant from the CLASS (`class_tenant(p_class_id)`), then refuse unless
>   `students.tenant_id` equals it. Do this before any write.
> - **Assertion (pgTAP 7):** all of these are refused: a coach who owns the class; a coach rostered in it; a
>   co-admin with `operations:view`; another tenant's full admin; a student from tenant A with a class from tenant B.

- **Bounds:** `p_starts_on` NULL → today (`today_sg()`); `> today_sg()` → refuse (D6);
  `< markable_floor(tenant)` → refuse with the floor's date in the message (D3).
- **Previous window (D8, corrected):** refuse if `p_starts_on <` the SGT date of the latest `unenrolled_at` for this
  student and class. Equality is allowed.

> ⚠ **RISK 7 MITIGATION.** **Assertion (pgTAP 4):** close an enrolment today (`close_student_enrolment`), then
> `set_enrolment_start(..., NULL, 'add')` → **succeeds**, and `class_expected_count(class, today_sg())` counts that
> child **once**. `U - 1` → refused. **Mutation:** change `<` to `<=` → case 4's same-day re-add goes red.

- **Change moving later (D7):** refuse if any `attendance` row joins a `lesson_sessions` row of this class with
  `session_date < p_starts_on` **and `session_date >=` the current start** for this student. Take
  `SELECT … FOR UPDATE` on the enrolment row before this check.

> ⚠ **RISK 6 MITIGATION — a later move is not a way to clear the unmarked block.**
> - **Step:** when the new start is later, compute the class's expected weekday dates in `[old start, new start)`
>   (non-cancelled) and write them into the audit row's `new_value` as `dropped_dates`.
> - **Assertion (pgTAP 6b):** moving later across two unmarked weekly lessons → audit `new_value->'dropped_dates'`
>   lists both dates.
> - **Prohibition:** do NOT add a "move start date" shortcut to the unmarked-lessons list, the Generate dialog, or
>   any billing-blocked message. The fix for a lesson that didn't run stays *mark it cancelled*.
> - The UI side is in 1.4.

- **Write:** `enrolled_at = CASE WHEN p_starts_on = today_sg() THEN NOW() ELSE ((p_starts_on + TIME '12:00') AT TIME
  ZONE 'Asia/Singapore') END`, for add and change alike (D10, corrected).

> ⚠ **RISK 5 MITIGATION — UTC and SGT readers must agree on the date.**
> - **Assertion (pgTAP 2):** for a past start `S`, both `(enrolled_at AT TIME ZONE 'Asia/Singapore')::date = S`
>   **and** `(enrolled_at AT TIME ZONE 'UTC')::date = S`. The second clause pins `core.ts:699` /
>   `orderingGuard.ts:382`'s raw slice.
> - **Mutations:** store SGT midnight → the UTC clause goes red. Store `p_starts_on::timestamptz` (no zone) → the SGT
>   clause goes red.
> - **Prohibition:** do NOT "fix" the engine's raw slice in this wave. That is an engine change and a separate
>   deploy. Noon storage makes it moot. Offered as a GOTCHAS entry instead.

- **Add also** moves `students.assignment_status` toward `assigned` (replaces the client's `markAssigned`, so
  the pair is atomic — today it is two calls and the trials path reports a half-success). Never away from `assigned`.
- **The triggers still fire** (`enrolment_tenant_guard`, `trg_enrolment_schedule` overlap and retired-class,
  `trg_class_capacity` on insert); their errors pass through unchanged. (`trg_class_capacity` does NOT fire on an
  `enrolled_at`-only update — correct, capacity is a current count.)
- **Audit:** an `audit_log` row with action `enrolment_added` or `enrolment_start_changed`, **`entity_type 'Student'`,
  `entity_id = p_student_id`**. `old_value` / `new_value` = the enrolment row as JSONB plus `class_id` (and
  `dropped_dates` on a later move), `tenant_id`.

> ⚠ **RISK 8 MITIGATION.** `audit_log_tenant_of()` raises on an unknown `entity_type`, and `'Enrolment'` has no case.
> - **Prohibition:** do NOT use `entity_type 'Enrolment'`, and do NOT `CREATE OR REPLACE audit_log_tenant_of` in
>   this migration. `'Student'` matches `close_student_enrolment`'s `student_removed_from_class` and the History
>   page's entity filter.
> - **Assertion (pgTAP 1):** the audit row's `tenant_id` equals the class's tenant.

- **Returns** `{ enrolment_id, starts_on, in_sealed_month BOOLEAN }`. `in_sealed_month` = a `billing_periods` row
  exists for the tenant with `billing_month >= to_char(p_starts_on,'YYYY-MM')`. The UI uses it for the post-save
  read-back; the **pre-save** warning comes from the companion below.

**`enrolment_start_bounds(p_class_id UUID) RETURNS JSONB`** — `STABLE SECURITY DEFINER`, the same auth gate at
`'view'`. Returns `{ floor, today, last_sealed_month, day_of_week }`. It feeds the date input's `min`/`max` and both
warnings, so the client doesn't re-derive the floor (a second implementation would drift).

> ⚠ **RISK 16 MITIGATION.** Exposing `last_sealed_month` to an `operations:view` role (no billing access) is a
> **deliberate** decision: `markable_floor` already implies it. Write that sentence in the function's COMMENT.

**Grants (§7.87):** `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated` on both. No table
grant changes.

**The COMMENT fix (scope corrected):**

> ⚠ **RISK 15 MITIGATION.** **Step:** read `obj_description` for both functions locally **and** on prod
> (`scripts/prod-query-ro.sh`). As of 2026-10-05 neither contains any key wording; the wrong "NEW key" text is only
> a `--` comment in the applied migration `20260927000100` (line 50), which is immutable. **Step:** re-issue both
> COMMENTs as the current text **plus** one appended sentence: *"A MAY_HAVE_SENT resend REUSES the email's one
> Idempotency-Key (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2); the `--` note in 20260927000100 saying otherwise is
> superseded."* **Assertion:** the new COMMENT starts with the old text, byte-identical. **Step:** graduate note for
> `/update-docs` to correct the BACKLOG item's premise.

**Rollback (written now, rehearsed locally before prod)** — `supabase/rollback/20261005000100_enrolment_start_date_DOWN.sql`:
`DROP FUNCTION` both; re-issue the old COMMENTs (and, if RISK 3 was included, restore the old `add_unclaimed_student`
signature from `pg_get_functiondef` captured now, plus its grants). Rows already written are ordinary enrolments —
nothing to undo.

> ⚠ **RISK 9 MITIGATION — rollback order.** **Prohibition:** do NOT run the DOWN file while an admin bundle that
> calls `set_enrolment_start` is live. **Order:** (1) revert the app commit and push `main`; (2) prove the served
> bundle no longer contains `Change start date` (§7.31); (3) only then run the DOWN file. Write these three lines
> into the DOWN file's header.

### 1.2 pgTAP `supabase/tests/enrolment_start_date.test.sql`
Dates from `session_window_start()` / `today_sg()` only (§7.305). Cases:
1. Add with NULL → `enrolled_at` = NOW()-ish, `assignment_status = 'assigned'`, one audit row (`entity_type 'Student'`,
   `tenant_id` = class tenant).
2. Add with a past date ≥ floor → **both** the SGT date and the UTC date of `enrolled_at` equal it (RISK 5).
3. Below floor → refused; future → refused.
4. Previous closed window (D8 corrected) → refused at `U-1`; **same-day re-add accepted** and counted once (RISK 7).
5. Change earlier → allowed; audit row `enrolment_start_changed` with old and new.
6. Change later past an existing attendance mark (D7) → refused; just before the mark → allowed.
   6b. Change later across unmarked lessons → `dropped_dates` recorded (RISK 6).
7. Auth: a co-admin with `operations:view` → refused; `operations:edit` (Front desk, looked up by
   `standard_key = 'front_desk'`) → allowed; **a coach who owns the class → refused**; another tenant's admin →
   refused; cross-tenant student and class → refused; `anon` → no EXECUTE (RISK 4).
8. `trg_enrolment_schedule` overlap still refuses through the RPC.
9. `in_sealed_month` true/false around a sealed `billing_periods` row.
10. `enrolment_start_bounds` returns the floor `markable_floor()` returns.
11. COMMENT text now contains "REUSES" and starts with the old text (RISK 15).
12. **`'add'` on an already-active row → refused with "already in"; `'change'` with no active row → refused; the
    enrolment row is unchanged after both (RISK 2).**
13. **A never-billed tenant: floor = its SGT creation date. Add at the floor succeeds, and
    `class_unmarked_lesson_dates` then lists every weekday since (RISK 1, server half — proves the effect the UI
    warns about).**
- `table_grants.test.sql` and `function_grants.test.sql` still green.
- **Mutations to prove red:** drop the D7 check; drop the D8 check; `<` → `<=` in D8; write midnight / zoneless;
  drop the auth gate; add a `coach_owns_class` arm; infer the mode from row existence. Each must fail a named case.

> ⚠ **RISK 12 MITIGATION (shared DB).** **Prohibition:** this file builds its own tenant, class and students inside
> `BEGIN … ROLLBACK`, and asserts nothing about seed-tenant totals. **Assertion:** `supabase test db` gives the same
> result with lane 2's fixture loaded and without it.

### 1.3 Land the migration (backend first — §7.60)
1. `supabase migration up` locally → `supabase test db` green → commit on `db/enrolment-start-date` →
   `/commit-review` → merge to `main` (migration-only; no app code rides with it).
2. Rehearse the rollback locally (DOWN, then `\df set_enrolment_start` returns 0 rows), then re-apply.
3. `/deploy`: `supabase db push --linked`, `supabase migration list --linked` shows 0 pending, remote grant dump
   for the two functions (§7.39). Prod read via `scripts/prod-query-ro.sh`: both functions exist, COMMENTs changed.

> ⚠ **RISK 4 / §7.39 MITIGATION.** **Assertion (prod, read-only):**
> `has_function_privilege('anon','public.set_enrolment_start(uuid,uuid,date,text)','EXECUTE')` = **false** and
> `…('authenticated',…)` = **true**, and the same for `enrolment_start_bounds(uuid)`. Cloud default privileges grant
> `anon` on new functions, and local cannot show that.

### 1.4 Admin app — branch `feat/enrolment-start-date`
- **One shared piece:** `lib/enrolmentStart.ts` (pure: label and warning text from `{floor, today,
  last_sealed_month, day_of_week}` and a chosen date) + `components/StartsOnField.tsx` (date input, `min`/`max` from
  `enrolment_start_bounds`, default `bounds.today`).

> ⚠ **RISK 1 MITIGATION — warn for EVERY past month, not only sealed ones.** `enrolmentStart.ts` uses
> `expectedLessonDates(day_of_week, start, today)` (existing `lib/lessonDates.ts`) to split the lessons the start
> creates into three buckets:
> - **(a) Sealed months** (≤ `last_sealed_month`): amber. *"<Month> is already billed. <N> lessons before <1st of
>   next month> will be listed under Unbilled lessons for the business owner to settle."* (RISK 16: "the business
>   owner", not "the Invoices page" — Front desk can't open it.)
> - **(b) Earlier months not yet billed:** red-amber. *"<Child> will be expected at <N> lessons in <Aug, Sep>, which
>   haven't been billed. Each must be marked (present, absent or cancelled) before <earliest month> can be billed,
>   and every later month waits for it. The coach will see them to mark."*
> - **(c) Current month only:** a quiet line, *"<N> earlier lessons this month will need marking."*
>
> **Step:** a start in bucket (b) requires a **second press** (*"Press Save again to confirm"*), the same pattern as
> `needsConvertConfirmation`, kept as a pure function. **Assertions (vitest):** the bucket split at both boundaries;
> bucket (b) with no confirmation → no RPC call; a second press → RPC called once. **Mutation:** remove the bucket (b)
> gate → a test goes red.
>
> **Ship-timing step (Little Orcas):** if 1.6 would push on or before **2026-10-07** (Little Orcas: never billed,
> `auto_invoice_enabled`, run day 7, floor 2026-08-03), first read its 2026-09 run outcome on prod **or** get the
> user's explicit word to ship before it. Record which one here: _(pending — note: cron is NOT enabled on prod (HANDOVER §9), so run day 7 fires nothing by itself; the live overlap is the owner pressing Generate after the 2026-10-05 WhatsApp)_

> ⚠ **RISK 14 MITIGATION — fail safe to today's behaviour.** If `enrolment_start_bounds` errors or returns a
> malformed date, `StartsOnField` sets `min = max = value = todayInSg()`, shows no warning, and the Add proceeds
> exactly as today. **Prohibition:** a bounds failure never disables the Add/Assign/Convert button. **Assertion
> (vitest):** bounds RPC rejects → the field is today-only and Save is enabled.

- **Three add paths** call `rpc('set_enrolment_start', { …, p_mode: 'add' })` instead of `insertEnrolment` +
  `markAssigned`: `students/domain/useAddClass.ts`, `unassigned/domain/useUnassigned.ts`, `trials/domain/useTrials.ts`.
  Delete the three `insertEnrolment` repo functions and the now-unused `markAssigned` functions — re-grep
  `SwimSyncAdmin`, `SwimSyncApp` and `drivers/` before deleting. Each modal gains `<StartsOnField>`. The trials
  "Enrolled, but status could not be updated" branch goes away (the RPC is atomic) — remove it and its test.

> ⚠ **RISK 13 MITIGATION — the Convert guard survives.** **Prohibition:** in `useTrials.handleConvert` and
> `useUnassigned`, the future-live-trial read and the two-press confirmation stay **before** the RPC call,
> unchanged. **Step:** rewrite the `⚠ RISK 2` header comment in `useTrials.ts` to "future-trial read, then ONE atomic
> RPC". **Assertion:** `trialConvert.test.ts` has the same count before and after. A hook test proves a future trial
> on the first press means no RPC call.

- **Change:** in `RosterDrawer`, a *Change* link beside *Joined <date>* opens a small modal with `<StartsOnField>`
  pre-filled with the current SGT start; save → RPC with `p_mode: 'change'` → reload roster. RPC error text inline.

> ⚠ **RISK 6 MITIGATION (UI half).** When the chosen date is LATER than the current start, the modal lists the
> lesson dates that will no longer be expected (*"<child> will no longer be expected on: 12 Sep, 19 Sep. If they
> missed these, mark them absent or cancelled instead."*), computed with `expectedLessonDates`. **Assertion
> (vitest):** a later date shows the list; an earlier date doesn't.

- **Dates:** `todayInSg()`, `toSgDate()`, `formatSgStamp()` only (CLAUDE.md "Dates"). No `toISOString().split`.
- **Tests (vitest), each proven red:** `enrolmentStart.test.ts` (the three buckets, the month label, the bucket-(b)
  confirmation, the bounds fallback); hook tests for the three paths (chosen date, `p_mode: 'add'`, default today);
  a RosterDrawer render test for *Change* (`p_mode: 'change'`, the dropped-dates list). Mutations: default to the UTC
  date; drop the warning; call the old insert; send `'change'` from an Add path.
- `npm test && npm run typecheck`.

### 1.5 Driver `verify-enrolment-start.mjs` + `fixtures-enrolment-start.sql` (+ teardown, prefix `wave4es_`)
The admin adds a fixture child to a class with *Starts on* = a derived past date in the window → the lesson page for
that date lists the child as markable → mark them → *Change start date* to later than the mark is refused with the
RPC's message → earlier is accepted and the roster shows the new *Joined* date. **Proven red** against `main`'s
build (no *Starts on* field). Run with fixtures + direct `node` while lane 2 is live (no `--only`).

> ⚠ **RISK 12 MITIGATION (§7.103).**
> - **Step:** the fixture class lives in the seed tenant under the `wave4es_` prefix. The backdated start = **the
>   most recent past occurrence of the class's weekday** (derived), so expected == marked.
> - **Step:** the "earlier" step moves back **exactly one week**; the driver then marks that lesson too.
> - **Step:** the teardown deletes **every** enrolment, attendance row, lesson session and `audit_log` row whose
>   student or class carries the prefix, including rows the UI created.
> - **Assertion:** after the teardown, `tenant_unmarked_lesson_count(seed tenant)` equals its value before the
>   fixture load. Record both numbers in the commit body.
> - `check-teardowns.sh`, `check-fixture-roundtrip.sh` and `check-driver-dates.sh` are green.

> ⚠ **RISK 2 MITIGATION (driver).** One more check: Students → *Add class* on a class the fixture child is already
> in → the inline "already in … since …" message, and the roster's *Joined* date is unchanged.

> ⚠ **RISK 3 MITIGATION (default branch).** If the user chose "cover via Change": one check adds a `wave4es_` child
> via *Add student*, opens its class roster, changes the start one week earlier, and sees *Joined* move (marking
> that lesson as above).

### 1.6 Ship lane 1 (this IS an app deploy)
- Gate: tonight's nightly read. `/commit-review` → merge → push `main`.
- **Prove the build:** grep the served admin bundle for `Change start date` (§7.31, §7.51) — the Classes route's
  chunk (§7.72, per-route splitting).
- Prod: no data change. Tell the owner the new field exists (the user's call).

> ⚠ **RISK 1 MITIGATION.** The Little Orcas ship-timing step in 1.4 is ticked before the push.

> ⚠ **RISK 11 MITIGATION — cross-lane collision.** **Step, before the push:** if lane 2's
> `verify-front-desk-role.mjs` is already on `main`, run it directly (fixture → node → teardown) against lane 1's
> build. **Assertion:** green, including check 6 (Add class), with *Starts on* left at its default. If lane 2 merges
> **after** lane 1, lane 2 runs that check instead (2.3).

---

## Lane 2 — worktree `wave4-frontdesk` (side session, fixtures + driver only)

### 2.0 Start
`/worktree-start` (no migration). Own port for the admin dev server; `ADMIN_URL` set. Fixture prefix `fd_`.

### 2.1 `fixtures-front-desk-role.sql` + `fixtures-front-desk-role-teardown.sql`

> ⚠ **RISK 10 MITIGATION — the name the nightly resolves.** `run-all-drivers.sh`'s `fixture_for` maps
> `verify-front-desk-role.mjs` to **`fixtures-front-desk-role.sql`** (§7.102). **Prohibition:** do NOT name it
> `fixtures-front-desk.sql`. **Assertion:** `grep -n 'front-desk' run-all-drivers.sh` shows no override, and
> `ls fixtures-front-desk-role*.sql` lists both files.

- One persona `frontdesk@swimsync.test` (password123), a pure co-admin of the seed tenant on **that tenant's
  standard Front desk role**. Created the way `fixtures-roles.sql` creates `rolesdesk@` (no role in metadata,
  §7.289), plus the role assignment.

> ⚠ **RISK 10 MITIGATION — the right role, or fail loudly.** Look the role up by
> **`(tenant_id, standard_key = 'front_desk')`** — `tenant_roles` has no `is_standard` column, and the owner may
> rename the role. **Step:** the fixture ends with a `DO` block that `RAISE`s unless that role's
> `tenant_role_permissions` are exactly `operations = edit` and `profile / admins / pricing / billing / packages /
> wages / accounting = none`.

- Derived-date lesson data: one class with a rate and a paid coach, a lesson inside the window, two enrolled
  children, and a second class to guest one of them into (make-up). Enrol each child on the date of the lesson the
  fixture marks (§7.103).
- Teardown deletes by prefix and the persona's auth row. `check-teardowns.sh` + `check-fixture-roundtrip.sh` green.

### 2.2 `verify-front-desk-role.mjs` — the hire's day, as the hire
Checks (each a `check(label, pass)`, screenshots on fail):
1. Sidebar shows the operations pages and **no** money page (Pricing, Billing/Invoices, Packages, Wages,
   Accounting); a typed `/invoices` URL gets the role refusal, not a half page.
2. **Calendar** shows the lesson **with its coach's name** (the suspected bug).
3. **Lesson page** shows *Teaching: <coach>* and the prev/next strip groups under that coach, not *Unassigned*.
4. Mark attendance for both children on the lesson page → saved; read back.
5. Book a make-up for one child into the second class → it appears on that lesson's roster as a guest.
   (Make-ups touch packages; Front desk has Packages = None — this proves the path does not need it.)
6. Students page: open a child, add them to a class (today's start) → succeeds.

> ⚠ **RISK 11 MITIGATION.** Check 6 selects only the class picker and the submit button, by role and name, and
> leaves any date field at its default. **Prohibition:** no selector that relies on the modal having exactly one
> input.

- **Proven red:** run with the persona switched to a role whose Operations = None → checks 2–6 fail for the right
  reason; and check 1 against a role with Billing = View → fails.

### 2.3 Outcome fork
- **All green →** the BACKLOG item is cleared (graduate list: "not reproduced; driver pins it"). Commit the driver,
  merge to `main` (driver-only — no gate needed), and add it to the nightly list per `docs/TESTING.md`.
  ⚠ RISK 11: if lane 1's app is already on `main`, re-run the driver against it before merging. **Assertion:**
  check 6 is green.
- **Check 2 or 3 red (bug confirmed) →** STOP lane 2. Send the confirmation (screenshot, the RLS policy that
  filters it) to the root session over `SendMessage`. The root, **after lane 1's migration is on prod**, authors
  `20261005000200_who_taught_for_operations.sql` on `db/who-taught-ops`: a narrow `SECURITY DEFINER` read of
  `(class_id, effective_from, paid_coach_id)` gated on `operations:view`, **never** exposing `price_per_lesson`.
  pgTAP proves a `pricing:none` co-admin gets coach ids and **no** price. Then `lib/lessonAttribution.ts`'s reader
  switches to it; the driver's checks 2–3 go green and are the regression test. Same deploy order as 1.3 → 1.6
  (including the RISK 9 rollback order and the RISK 4 / §7.39 prod grant assertion).
- **Any other red →** same rule: a bug stops the lane and lands first; a migration-needing fix goes through the root.

### 2.4 Close
`/worktree-close` → graduate list → the root writes BACKLOG (item cleared or shipped) at `/update-docs`.

---

## How the two lanes run together
1. Root: 1.0 (including the RISK 3 question) → 1.1 → 1.2 (migration local only, `migration up`). Side: 2.0 → 2.1 →
   2.2 in parallel.
2. Root ships the migration (1.3) to prod. Side keeps running its driver against the shared DB.
3. Root builds 1.4–1.5. Side reports its outcome (2.3).
4. If the side found a bug: its fix migration goes after 1.3, before 1.6 if ready, else straight after.
5. Tonight's nightly read, plus the Little Orcas timing step → root ships 1.6. Side merges its driver. Whichever
   merges second re-runs the other's driver (RISK 11).

## Definition of done
- Prod: both functions live, 0 pending migrations, grant dump clean (`anon` has no EXECUTE), COMMENTs corrected.
- Admin live: *Starts on* on all three add screens (plus Add student, if RISK 3 was included); *Change* on the
  roster; the bundle grep proves it.
- `verify-enrolment-start` and `verify-front-desk-role` green locally and in the nightly list.
- The co-admin coach item: cleared, or fixed and live.
- All test counts up from the 1.0 baseline; every new test has a recorded mutation; Deno `test.sh` count unchanged on
  two runs.

## Time
Lane 1: ~2–2.5 days (migration + tests ½–¾ day, UI across three paths with the bucket warnings + roster ¾–1 day,
driver + ship ½ day; +½ day if RISK 3 is included). Lane 2: ~1 day; +½–1 day if the coach bug is confirmed.

## Pre-commit gate (every commit)

**Highest value. Any unticked box here blocks the commit:**
- [ ] **RISK 2** — `set_enrolment_start` takes an explicit `p_mode`; pgTAP 12 is green; no Add path sends `'change'`.
- [ ] **RISK 1** — the bucket (b) warning and second press exist and are vitest-pinned; the Little Orcas timing step
      is ticked before the 1.6 push.
- [ ] **RISK 4** — no `coach_owns_class` arm; pgTAP 7 is green with the coach case; prod `anon` EXECUTE = false.
- [ ] **RISK 5** — past starts stored at 12:00 SGT; pgTAP 2 asserts that the UTC date and the SGT date are equal.
- [ ] **RISK 3** — the user's answer on Add student is recorded in 1.0, and its branch is done.

**Every commit:**
- [ ] No `toISOString().split`, no `getDay()`/`getHours()` on a local clock; SGT helpers only.
- [ ] New function: REVOKE from PUBLIC/anon, GRANT to authenticated; no table grant added; no parameter defaults on
      `set_enrolment_start`; `\df` shows exactly one row per function name.
- [ ] RISK 6 — the audit row carries `dropped_dates` on a later move; no "move start" shortcut on any billing or
      unmarked surface.
- [ ] RISK 7 — D8 is `<`, not `<=`; the same-day re-add pgTAP case is green.
- [ ] RISK 8 — audit `entity_type 'Student'`; `audit_log_tenant_of` untouched.
- [ ] RISK 9 — the DOWN file's header states the apps-first order; the rollback was rehearsed locally.
- [ ] RISK 10 — the fixture is named `fixtures-front-desk-role.sql`; the role is looked up by `standard_key`; the
      permission `DO` block is present.
- [ ] RISK 11 — the second lane to merge has re-run the other lane's driver green.
- [ ] RISK 12 — the seed tenant's unmarked count is the same before and after the lane-1 driver; the pgTAP file
      asserts no seed totals.
- [ ] RISK 13 — the future-trial read and two-press guard come before the RPC; `trialConvert.test.ts` count is unchanged.
- [ ] RISK 14 — a bounds failure leaves the field today-only and Save enabled (vitest).
- [ ] RISK 15 — the COMMENT keeps the old text as its prefix; the BACKLOG premise correction is on the graduate list.
- [ ] Every new test has a mutation that turned it red, written in the commit body.
- [ ] Fixture dates derived; teardown paired.
- [ ] Lane 2 touched no migration and no living document.

## Candidates to graduate to GOTCHAS §7 (offered to the user — not yet applied)

1. **The engine reads `enrolled_at` as a UTC date; every other reader uses the SGT date.** `core.ts:699` and
   `orderingGuard.ts:382` use `String(e.enrolled_at).slice(0,10)`. A `timestamptz` representing a calendar date
   belongs at **12:00 SGT**, where the two agree. DEPLOYMENT #62's working backdate was noon, not midnight.
2. **`audit_log_tenant_of()` raises on any `entity_type` it doesn't know.** Reuse an existing type, or add a case to
   a body read from the DB (§7.40).
3. **An "edit if a row exists, otherwise insert" RPC behind an *Add* button turns a duplicate add into a silent
   edit.** Make the mode an explicit argument.
4. **`markable_floor()` for a never-billed tenant reaches back to its creation date** (prod 2026-10-05: Little Orcas
   2026-08-03, Epic Swim 2026-07-21). A floor-based date picker must warn about unbilled months, not only sealed ones.
5. **"No overlapping windows" rules: allow the start to equal the previous end date.** Span readers de-duplicate.
