# Swim-skill grading → admin-only, plus an Assessment tab

_Plan written 2026-08-29. Reviewed by `/plan-review` (fable) the same day; the eight ranked
risks are folded in below as `⚠ RISK n MITIGATION`, each beside the step it governs. There is
deliberately **no trailing Risks section** — a risk read once at planning time and never again
is not a mitigation._

_Supersedes the BACKLOG "Make swim-skill grading ADMIN-ONLY" item's inline change-set, which
assumed a Students-drawer modal was the whole of it. It is not: the user wants a dedicated
**Assessment** tab built for an assessment DAY._

**Predecessor:** `docs/plans/WAVE_C_SPOOL_PLAN.md` Piece 4 built grading (migration
`20260828000100`, PRD §7.15, §8.92).

---

## 1. The product decisions, settled with the user

| Decision | Answer |
|---|---|
| Who may grade | Any tenant admin — `can_admin_tenant` (co-admins + platform admin included) |
| Enforcement | The **RLS policy is narrowed at the database**, not merely the UI |
| Coach app | Grades become **read-only**. The screen stays; the tapping goes |
| Admin surfaces | **Both** — the Students drawer (one-off correction) *and* a new **Assessment** tab (the real tool) |
| Grid shape | Grouped matrix: one sub-table per level present in the class, plus a "No level set" group |
| Entry gesture | Tap-to-cycle by default; **Paint** mode as an explicit toggle |
| Save | Immediate. A paint stroke is **one array upsert**, not one request per cell |
| Level promotion | Inline "Move up to Level N" when every skill is at the top grade; the row hops sub-table, anchored in view with a toast |
| Assessment round | Fresh vs stale computed from `graded_at`. "Assessing since" **auto-fills to today (SGT)**, editable, carried in the URL |
| Class picker | Index of **active** classes, today's classes first, click one to assess |

### Why a class has ragged levels

`students.level_id` is per-CHILD; `classes` carries **no level column** (verified). One class
can therefore hold children at three different levels, which is why the grid is a stack of
per-level sub-tables rather than one matrix.

### Why "assessed this round" is a real problem, and what answers it

Assessment is a periodic **event** — every ~3 months an admin tours every class. The grid shows
each skill's *current* grade, so a child graded "Competent" in June looks identical to one
graded "Competent" this morning. The assessor assumes the first was done and **skips the
child**. That is the failure mode this plan exists to close, and risks 1, 2 and 7 below are all
ways this plan could ship that same failure inside the tool built to prevent it.

`student_skill_progress.graded_at` already carries the fact, server-stamped by the trigger. So
the answer is presentation, not a new entity: anything older than "Assessing since" renders
grey with its date and counts as **not assessed this round**.

**Deliberately NOT built:** a stored `assessment_rounds` entity, and per-skill grade history.
Both were considered. The round entity doubles the build (second table, RLS, grants, pgTAP, and
a mode you must open before grading) to replace a date the assessor can simply set. Grade
history ("June: Competent → Sept: Mastered") is a genuinely separate feature and belongs in
`BACKLOG.md`, not here. **The child's LEVEL history already exists** — the student audit trigger
(`20260809000200`) records the full OLD and NEW row on every update, so every level change is in
`audit_log` with actor and timestamp, on the Change History page.

---

## 2. Stage 1 — Backend + coach app

### Step 1.1 — The migration

`supabase/migrations/20260829000100_grading_admin_only.sql`. Written in the **root checkout on a
`db/…` branch** — a worktree never authors a migration. One schema change in flight (§7.55);
none is held today.

Three changes, one file:

1. `DROP POLICY student_skill_progress_write ON student_skill_progress;` then recreate it
   `FOR ALL USING (can_admin_tenant(tenant_id)) WITH CHECK (can_admin_tenant(tenant_id))` —
   dropping the `coach_serves_student(student_id)` arm.
2. Update `COMMENT ON TABLE student_skill_progress`. It currently reads "Written by the coach
   who serves the child (or an admin)", which this step makes false.
3. `CREATE OR REPLACE FUNCTION enforce_skill_progress_tenant()` — fix the `graded_at` stamp.

**The `graded_at` fix, and why it is load-bearing.** Today the stamp fires only when the grade
*changes* (`20260828000100` line 189). Re-confirming Ben at "Competent" therefore writes a row
but leaves `graded_at` in June — and the whole round mechanism reads him as unassessed.

> **⚠ RISK 5 MITIGATION — write the condition as its contrapositive, naming the one exemption.**
> The reviewed-and-rejected form was a three-clause positive
> (`INSERT OR grade changed OR student_id unchanged`), whose truth table is correct but which
> reads as a misread magnet. Use the equivalent form that states the rule directly — *stamp
> unless this is a bare repoint*:
>
> ```sql
> IF NOT (TG_OP = 'UPDATE'
>         AND NEW.student_id     IS DISTINCT FROM     OLD.student_id
>         AND NEW.grade_level_id IS NOT DISTINCT FROM OLD.grade_level_id) THEN
>   NEW.graded_by := auth.uid();
>   NEW.graded_at := NOW();
> END IF;
> ```
>
> Identical truth table, verified by the reviewer against `merge_students`' actual shape
> (`20260828000100:441-449` sets **only** `student_id`), so the merge's preservation survives.
> **Named prohibition, recorded in the migration comment:** every non-repoint UPDATE now stamps,
> so a future `service_role` backfill correcting `graded_at` will be clobbered to `NOW()`/`NULL`.
> A historical data fix on this table **must** wrap itself in `DISABLE TRIGGER
> trg_skill_progress_tenant` / `ENABLE TRIGGER`. This one is vigilance, not structure — there is
> no structural way to exempt a backfill that has not been written yet, so it is stated in the
> place a person writing that backfill will actually read.

**Attribution semantics, stated once so it is a decision and not a surprise.** After this
change, `graded_by` means *"who last confirmed this grade"*, not *"who first awarded it"*. That
is the right meaning for a round-based tool. It is only lossless because prod is dormant — see
**RISK 8**, which turns that premise into a query.

**The SELECT policy is deliberately unchanged.** Staff read stays — the coach app still renders
grades read-only, and narrowing SELECT would break that screen.

**No grant change, and the reason is not §11.32.** Grants already exist on the table and a
policy still permits INSERT/UPDATE/DELETE, so `supabase/tests/table_grants.test.sql` stays
green. Argue this in the migration comment on the correct grounds: **a policy carries no ACL, so
dropping and recreating one touches no privilege.** §11.32's pattern is specifically a
same-signature `CREATE OR REPLACE FUNCTION`; this migration's DROP/CREATE POLICY half is not
literally that pattern, and citing it alone would be a borrowed justification.

**Rollback:** write `supabase/rollback/20260829000100_grading_admin_only_DOWN.sql` restoring both
the old policy and the old trigger body, and **rehearse it** — running the DOWN is the half that
finds the bugs (§7.93).

### Step 1.2 — pgTAP

Edit `supabase/tests/skill_progress.test.sql` and bump `plan(23)`.

- Flip the existing write blocks: the **admin** is the writer (`graded_by` becomes the admin's id).
- Change the coach test to its inverse: **a coach who SERVES the child is now REFUSED (42501)**.
  This is the §7.25 RED proof — against today's deployed policy a serving coach *succeeds*.
- **Re-home the two cross-tenant trigger probes** at `skill_progress.test.sql:214-229`. They run
  under **coach A's JWT** today, precisely because the old policy let them reach the trigger.
  Post-flip they would die `42501` instead of the asserted `23514`. They must run under the
  admin's JWT so they keep testing the trigger rather than the policy.

> **⚠ RISK 3 MITIGATION — the `graded_at` test cannot be written naively; it would pass for the
> wrong reason.** `NOW()` is the *transaction* timestamp and the whole suite runs inside one
> `BEGIN…ROLLBACK` (§7.16), so "re-confirming advances `graded_at`" compares `NOW()` to `NOW()`
> and can never observe an advance. Worse, the fixture cannot backdate `graded_at` with a plain
> `UPDATE`, because the *new* trigger stamps every non-repoint update and clobbers the backdate.
> **The step:** backdate under a disabled trigger, then assert.
>
> ```sql
> ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
> UPDATE student_skill_progress
>    SET graded_at = NOW() - interval '90 days', graded_by = <coach>
>  WHERE student_id = <child> AND skill_id = <skill>;
> ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;
> ```
>
> Then: **(a)** re-confirm the SAME grade as the admin → assert `graded_at = NOW()` **and**
> `graded_by = <admin>`; **(b)** repoint `student_id` only (the merge's shape) against the same
> backdated fixture → assert `graded_at` is still 90 days old **and** `graded_by` is still the
> coach. **Pass/fail value:** against the old trigger, (a) leaves the backdated value — the RED
> proof is observable, which it is not without the `DISABLE TRIGGER` fixture.

> **⚠ RISK 8 MITIGATION (test half) — pin the merge end-to-end, not just the trigger's shape.**
> `supabase/tests/student_merge.test.sql` contains **zero** skill-progress assertions. Add one
> real `merge_students()` call over a backdated graded row, asserting the returned
> `moved_skill_progress` count **and** that `graded_by`/`graded_at` survived. Step 1.2's probe
> (b) emulates the merge's shape; this asserts the merge itself.

Parent-read-only, cross-tenant refusal, and the RESTRICT-FK blocks are otherwise unchanged.

### Step 1.3 — Coach app, grades read-only

- `SwimSyncApp/app/(coach)/classes/[id]/grade.tsx` — delete `onTapSkill`, the `Pressable`
  wrapper, the `savingSkill` state, and the "Tap a skill to cycle its grade" hint. Keep the
  fetch, the per-skill list, and the "n of m at <top grade>" summary. Add a line saying grades
  are set by an admin, so the absence of tapping reads as intent, not breakage.
- `SwimSyncApp/app/(coach)/classes/[id]/roster.tsx:730-741` — rename the button **Grade →
  Skills**. Navigation unchanged.
- `SwimSyncApp/lib/skillProgress.ts` and `skillProgress.test.ts` are **untouched** — the pure
  helpers do not change, and `cycleGrade` is still needed by the admin app.

**Stage 1 gate:** `supabase test db` green · app jest green · `cd SwimSyncApp && npm run typecheck` clean.

---

## 3. Stage 2 — The Assessment tab

### Step 2.1 — Port the pure logic into the admin app

- Copy `SwimSyncApp/lib/skillProgress.ts` → `SwimSyncAdmin/lib/skillProgress.ts` as a
  **byte-identical twin**, and add `skillProgress.drift.test.ts` following the existing pattern
  (`studentStatus.drift.test.ts`, `attendanceCompleteness.drift.test.ts`,
  `attendanceSave.drift.test.ts` are the three worked examples). The drift test is what keeps
  the twin honest; a hand-copied file with no drift test is how the two silently diverge.
- New pure lib `SwimSyncAdmin/lib/assessment.ts`, vitest-covered:
  - `groupRosterByLevel()` — the grouped matrix model, including the "No level set" bucket.
    Levels order by `tenant_levels.sort_order` (confirmed present, `20260719001800:28`).
  - `isFreshGrade(gradedAt, since)` — fresh vs stale against the round start.
  - `roundProgress()` — "12 of 24 graded this round", and the per-child "n/m this round".
  - `canPromote()` / `nextLevel()` — every skill at the top rank → the next level by
    `sort_order`; `null` when the child is already at the highest.
  - `dedupeStroke()` — see RISK 4.

> **⚠ RISK 1 MITIGATION — a child with NOTHING to grade must never read as assessed.** This is
> the highest-blast-radius finding: "assessed" computed as `fresh === total` is **vacuously
> true** when `total === 0`, which is exactly the "No level set" bucket and any level with zero
> skills. The tool built to stop the assessor skipping a child would tell them to skip that
> child. **Two assertions in `assessment.ts`'s vitest, both proven RED against a naive
> `fresh === total` implementation (§7.25):**
> - `roundProgress()` with `total === 0` returns the child as **NOT assessed**, flagged
>   `noSkills: true`, rendered as its own visible state — never as grey-fresh.
> - `canPromote()` returns **`false`** when `total === 0`. Today "every skill at top rank" is
>   vacuously true for an empty level, so the promote affordance would appear on precisely the
>   children who cannot be graded at all.

> **⚠ RISK 7 MITIGATION — promotion must not distort the round it happens in.** Promoting hops
> the child into a sub-table with no fresh grades, so they immediately re-enter the assessor's
> to-do count on the day they were fully assessed. And `canPromote()` fires off **stale**
> top-rank grades, prompting a promotion for a child nobody has looked at today. **Two vitest
> assertions:**
> - A just-promoted child (zero grades at the new level) is counted and rendered as
>   **"promoted this round"**, not "unassessed" — derived from any old-level grade with
>   `graded_at >= since`.
> - `canPromote()` requires every top-rank grade to be **fresh** (`graded_at >= since`), so a
>   promotion is only ever offered off this round's own assessment.
>
> The database side of promotion is genuinely cheap and needs no mitigation — the reviewer
> verified the `students` AFTER-UPDATE audit trigger only writes `audit_log` and returns NULL
> (`20260809000200`), no billing/enrolment/package path reads `level_id`, and the Students
> drawer already performs this exact write at `students/page.tsx:461-467`.

### Step 2.2 — The two pages

- `SwimSyncAdmin/app/(admin)/assessment/page.tsx` — the index. **Active classes only**, today's
  first, each row showing "n of m children assessed this round".
  - Today's weekday comes from `todayInSg()` + `dayOfWeekOf()` (`SwimSyncAdmin/lib/lessonDates.ts`).
    **Never `new Date().toISOString().split("T")[0]`** — that is the UTC date, a day behind
    before 08:00 SGT, and pairing it with a local `getDay()` is the §7.7 bug that shipped a real
    double-billing incident.
- `SwimSyncAdmin/app/(admin)/assessment/[classId]/page.tsx` — the grid.
  - Fetch the roster in a few explicit queries rather than one deep embed — a to-many embed
    under a filter is the §7.216 silent-wrong-answer trap (a plain embed returns null embeds; an
    `!inner` embed narrows the parent rows).

> **⚠ RISK 2 MITIGATION — `?since` belongs on BOTH pages, or the round resets at midnight.** A
> round is explicitly multi-day ("an admin tours every class"). If only `[classId]` carries
> `?since` and the index defaults to `todayInSg()`, then on day 2 the index reports every day-1
> class as 0-assessed — so the assessor either re-tours them (double work, and a re-confirm
> rewrites `graded_by`) or learns to distrust the counts. **The step:** the **index** page also
> takes `?since`, defaults it once, and every class link propagates it
> (`/assessment/[classId]?since=…`, and the back link returns `/assessment?since=…`).
> **The assertion:** a vitest case proving index counts and grid freshness are computed by the
> **same** `isFreshGrade(gradedAt, since)` call with the same `since` — one function, two
> callers, zero re-derivation. A second copy of the freshness rule is how they drift apart.

> **⚠ RISK 4 MITIGATION — "one array upsert" has three failure modes; two are structural, one is
> a prohibition.**
> - **(a) A stroke that crosses the same cell twice fails everything.** Postgres refuses the
>   whole statement (`ON CONFLICT DO UPDATE cannot affect row a second time`). → **Step:**
>   `dedupeStroke()` in `assessment.ts` collapses the array by `(student_id, skill_id)`,
>   last-write-wins, with a vitest case covering the double-crossed cell.
> - **(b) One stale cell fails the whole atomic statement while the optimistic UI shows every
>   cell painted** — e.g. an admin deleted an *unused* skill from the level in another tab
>   (unused skills delete freely; only graded ones are RESTRICTed). The screen then displays
>   grades that were never saved. → **Step:** on any stroke error, restore the **whole-stroke**
>   `prevGrades` snapshot *and* refetch — the `grade.tsx:154-157` rollback pattern, extended
>   with a refetch so the screen cannot keep showing a phantom.
> - **(c) Painting "not set" is not an upsert at all.** A null grade is a DELETE
>   (`grade.tsx:147-151`), so the request pair could partially succeed. → **Named prohibition:
>   Paint mode never paints "not set".** Clearing a grade stays a per-cell tap, so the delete
>   path never enters the batch.

### Step 2.3 — Nav

`SwimSyncAdmin/lib/adminNav.ts` — add
`{ href: "/assessment", label: "Assessment", icon: ClipboardCheck, scope: "tenant" }` to `NAV`,
and add `/assessment` to `TOP_LEVEL_HREFS`. A unit test already pins that no tenant page silently
vanishes from the sidebar; it should stay green. `scopeForPath()` already fails closed to
`"tenant"` for an unknown path, so a missed NAV entry cannot leak the page cross-tenant.

### Step 2.4 — The Students drawer

Add a "Grade skills" button to the per-row Actions drawer in
`SwimSyncAdmin/app/(admin)/students/page.tsx` (`drawerFor`), opening a `Modal` that renders the
**single-child** form of the same grid component. Close the drawer before opening the modal —
the existing drawer code already follows that order.

**Stage 2 gate:** admin vitest green · `cd SwimSyncAdmin && npm run typecheck` clean ·
`check-fixture-roundtrip.sh` green.

---

## 4. Stage 3 — Deploy

Run `/deploy`. The order is **migration to prod FIRST, apps to `main` LAST** (§7.60 — got wrong
twice). No `core.ts` change, so the billing engine is not redeployed. No grant dump.

> **⚠ RISK 8 MITIGATION — verify the dormancy premise before pushing, do not assert it.** Three
> claims rest on "zero children graded on prod": that the policy flip strands no coach, that the
> `graded_by` re-attribution is lossless, and that no data migration is needed. Nobody has run
> the count. **The assertion, before `db push`:**
>
> ```sql
> SELECT count(*) FROM student_skill_progress;   -- the premise holds IFF this is 0
> ```
>
> **If it is nonzero, STOP** and settle the `graded_by` history question first — the migration
> deploys before the apps, so any existing coach-attributed rows would have their original
> grader permanently erased by the first assessment day. (The intervening window is otherwise
> safe: a live coach's tap gets `42501` and the existing optimistic rollback + toast at
> `grade.tsx:154-157` handles it gracefully.)

- Confirm the migration with `supabase migration list --linked` and read the `remote` column.
  **Do not take `supabase db push`'s own output as proof** — it has printed a `pgdelta`
  certificate stack trace *and* "Finished supabase db push" three times now.
- Confirm the apps with a served-bundle grep for a string only this build has — `Assessing since`
  (§7.31, §7.51 — a 200 proves nothing).

---

## 5. Coverage

**No Playwright driver covers grading today** (verified — zero hits for "Grade" across
`.claude/skills/run-ui-playwright/drivers/`). This build adds a real admin write surface, so it
gets one: `verify-assessment.mjs`. `run-all-drivers.sh:190` globs `verify-*.mjs`, so it is
picked up automatically.

> **⚠ RISK 6 MITIGATION — the driver runs at a MOBILE viewport, and that is a gate.** The tool
> is for an assessment day spent touring classes, and production's one real grader is a private
> coach (tenant admin) whose current grading surface is the mobile app this plan makes read-only.
> Replacing it with a desktop-shaped multi-sub-table matrix plus a paint gesture risks
> regressing the only real user's workflow from "works on my phone" to "doesn't" — the largest
> wrong-outcome risk that no unit test will catch. **The assertion:** `verify-assessment.mjs`
> runs its grading pass at **390×844**, and its pass/fail includes tapping a cell *and* painting
> a row at that width. "Make it responsive" is vigilance; the driver viewport makes it a gate.

---

## 6. Accepted consequences

- **Coaches lose the ability to grade.** Deliberate, and the reason the DB policy is narrowed
  rather than only the UI: "admin-only" should be a guarantee, not a convention. A coach who
  reaches the API directly is refused.
- **`graded_by` means "who last confirmed", not "who first awarded".** Correct for a round-based
  tool, and lossless only because prod is dormant — gated by RISK 8's query.
- **"This round" is a date the assessor sets, not a recorded entity.** Two admins assessing with
  different "since" dates would see different counts. Accepted: production is a solo operation
  today, and the alternative doubles the build.
- **Only the latest grade per skill is kept.** `UNIQUE (student_id, skill_id)` means re-grading
  replaces. Per-round history is a separate backlog item.
- **A direct `graded_at` data fix now needs `DISABLE TRIGGER`.** Recorded in the migration
  comment (RISK 5).

---

## 7. Pre-commit gate

A box that cannot be ticked is a **blocker, not a caveat**. The two highest-value boxes are the
first two.

- [ ] **RISK 1** — `roundProgress()` counts a `total === 0` child as NOT assessed, and
      `canPromote()` returns false for one. Both proven RED against a naive `fresh === total`.
- [ ] **RISK 3** — the `graded_at` tests use the `DISABLE TRIGGER` backdate fixture, and the
      re-confirm assertion is proven RED against the old trigger body.
- [ ] **RISK 2** — index and grid both take `?since`; one `isFreshGrade` call serves both,
      pinned by a vitest case.
- [ ] **RISK 4** — `dedupeStroke()` tested on a double-crossed cell; stroke errors restore the
      whole-stroke snapshot **and** refetch; Paint mode cannot paint "not set".
- [ ] **RISK 5** — the trigger uses the contrapositive form; the `DISABLE TRIGGER` prohibition
      is written into the migration comment.
- [ ] **RISK 6** — `verify-assessment.mjs` passes at 390×844 including a tap and a paint.
- [ ] **RISK 7** — a just-promoted child reads "promoted this round"; `canPromote()` requires
      fresh top-rank grades.
- [ ] **RISK 8** — `SELECT count(*) FROM student_skill_progress` on prod returned **0** before
      `db push`; `student_merge.test.sql` asserts `moved_skill_progress` and preserved
      `graded_by`.
- [ ] New tests proven RED without the fix (§7.25) · `supabase test db` green · both typechecks clean
- [ ] `/deploy` run: migration to prod FIRST, `migration list --linked` read, apps to `main` LAST,
      served-bundle grep for `Assessing since`

---

## 8. Durable findings to graduate at `/update-docs`

These outlive this plan and belong in `docs/GOTCHAS.md` §7 (append the next number, never
renumber), because `/session-start` mandates reading §7 every session:

1. **A completeness count over a zero-length list is vacuously complete** — `fresh === total`
   reports "done" for a child with no level or a level with no skills, in the tool built to stop
   exactly that oversight. (RISK 1.)
2. **A `NOW()`-stamping trigger cannot be tested for "the timestamp advanced" inside the pgTAP
   transaction** — `NOW()` is the transaction timestamp, and the trigger itself clobbers a plain
   backdate. `DISABLE TRIGGER` in the fixture is the only way to make the RED proof observable.
   (RISK 3.)
3. **An `ON CONFLICT` array upsert refuses the whole statement if the array names one key
   twice** — batching an optimistic UI's gesture must dedupe before it sends. (RISK 4a.)
