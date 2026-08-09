# Plan — the unmarked BOOKING underbill, and the `service_role` audit

_Written 2026-08-10, hardened by an adversarial product-risk review the same day. Covers
`BACKLOG.md` → *An unmarked BOOKING is invisible when its class has no active enrolments* (**S**)
and → *Decide whether `service_role` deserves the whitelist treatment* (**M**, documentation only)._

**Mitigations are inlined next to the step they govern, marked `⚠ RISK n`.** There is
deliberately no trailing Risks section: a trailing section is read once at planning time and
never again, while the risk is needed forty tool calls later (the §8.36 lesson,
`WAVE_1_PLAN.md`). Every one is a **step**, an **assertion with a pass/fail value**, or a
**named prohibition** — never "watch out for".

---

## 0. What is actually broken, what is not, and the one decision that changed

`core.ts` bails out of its per-class loop at two early `continue` guards:

| Line | Guard | Consults `bookingsByDate`? |
|---|---|---|
| `core.ts:662` | `if (!sessionIds.length && !expectedDates.length) continue;` | **no** |
| `core.ts:685` | `if (!billableStudentIds.length) continue;` | **no** |

The completeness gate twelve lines below **does** union booking dates in (`core.ts:701`), and
`expectedStudentsOn()` counts bookings. So the gate is correct and unreachable: a class with no
**active** enrolments but holding an unmarked trial or make-up booking is skipped whole. The
guest is neither billed nor blocking, and if a second class bills, the month **SEALS** over it
(§11.6) and that lesson can never be invoiced.

**This is wider than retired classes.** An *active* class whose students have all been removed,
holding a booked trial, is in exactly this state — the local seed's default shape (§7.100).
Retirement made it reachable *by construction*; it was never *confined* to it.

### `SwimSyncAdmin/lib/classCoverage.ts` IS THE REFERENCE IMPLEMENTATION — read it first

The admin's Generate-invoices pre-flight **already has the guard the engine is missing**: it
skips a class only when `activeStudentIds.length === 0 && bookedByDate.size === 0`, then unions
booking dates into `expectedWithTrials`; `invoices/page.tsx:287-298` feeds it both booking
tables. So today the admin dialog **names the missing date while the engine silently skips it** —
this is §7.18's divergence in its live form, and it means the pre-flight screen is the existing
witness for Gate 0.

> **⚠ RISK 1 MITIGATION — a step.** Before editing `core.ts`, read `classCoverage.ts` and write
> the two skip-conditions side by side in the commit message. The engine is being brought up to
> the admin screen's rule, not given a new one.

### ⚠ THE `lastScheduledDate` CLAMP ON BOOKINGS IS DROPPED, AND THE STATE IT FEARED IS MADE IMPOSSIBLE

The original plan clamped booking dates by `lastScheduledDate` (`core.ts:644`), mirroring
`expectedDates`. Settled 2026-08-10 after a correction from the user and a re-check of the code.

**The clamp has zero value.** The case it defends against — a booking dated *after*
`deactivated_at` — cannot be created once step 2 lands: `book_makeup()` already refuses an
inactive host (`20260802000200_book_makeup.sql:44-46`), `book_trial()` gains the same refusal,
and `deactivate_class()` refuses both future bookings (refusal 2) and any unmarked date from the
floor (refusal 3) — `20260809000300`. A test for it would have to build its state outside the
RPCs: dead code in the money engine that reads as load-bearing to the next person (§7.110).

**And it sits on an open hole.** `lastScheduledDate` is `null` whenever
`is_active = false AND deactivated_at IS NULL` (`core.ts:644-648`), and clamping by it would drop
**every** booking date for such a class — billing the rest and sealing over the guest, the worst
failure shape in the product.

**That population is EMPTY on production but was not CLOSED.** `classes_write ON classes FOR ALL
TO authenticated` (`20260718000900:342`) plus `GRANT … UPDATE … ON public.classes TO
authenticated` (`20260804000600:90`) let any tenant admin `UPDATE classes SET is_active = false`
straight over PostgREST, never touching `deactivate_class()`. The admin panel is clean — it
writes `is_active` only on insert (`classes/page.tsx:391`) — but that is the screen applying the
limit, not the database (§7.32).

> **⚠ RISK 2 MITIGATION — a named prohibition PLUS a structural closure.** Do **NOT** clamp
> `bookingsByDate` by `lastScheduledDate`, by `is_active`, or by anything else. Clamp only
> `expectedDates`, which is already done at `core.ts:650-659`. **A booking row is explicit
> evidence that a named child was expected on a named date**; unlike a derived weekday date it
> can never be spuriously generated, so it needs no clamp.
>
> The prohibition is backed by a constraint rather than by vigilance: **step 2.4 adds
> `CHECK (is_active = true OR deactivated_at IS NOT NULL)` to `classes`**, so no row with a null
> `lastScheduledDate` can exist. After that the clamp is not merely unwise, it is unreachable —
> and the reason a future session cannot re-add it is enforced by the database, not by this
> paragraph.

**Your "close the front door" answer governs, and this is how it is honoured.** The doors are
closed in the *migration* (steps 2.1–2.4), which is where closing a door belongs. The engine
clamp was the redundant second lock that jams the fire exit.

---

## 1. Gate 0 — production audit, BEFORE a line is written

Making an unmarked booking block is a change to **what blocks a billing month**, and the block
has no override by design. Any production row already in this state begins blocking that
business's next run on deploy day.

> **⚠ RISK 3 MITIGATION — assertion with a pass/fail value.** **All three** queries must return
> **0 rows**. Two queries is not a gate — the review found the plan's original pair blind to the
> null-`deactivated_at` population and to the pre-floor case. A non-zero result on any of them is
> a **blocker, not a caveat**: stop, and re-plan the release around clearing those rows first.
>
> **Named prohibition, attached to this step:** do **NOT** resolve a non-zero result by adding an
> override to the unmarked-attendance block, and do **NOT** resolve it by making the engine skip
> the row. Fix the scan or clear the data.

```sql
-- 0a. Uncancelled, UNMARKED bookings in a class with no active enrolment.
--     (The admin Generate dialog is the live witness for these — classCoverage.ts already
--      names them while the engine skips them.)
SELECT c.tenant_id, c.id, c.title, c.is_active, c.deactivated_at, b.session_date, b.kind
  FROM (SELECT class_id, student_id, session_date, 'trial'  AS kind FROM trial_bookings  WHERE cancelled_at IS NULL
        UNION ALL
        SELECT class_id, student_id, session_date, 'makeup' AS kind FROM makeup_bookings WHERE cancelled_at IS NULL) b
  JOIN classes c ON c.id = b.class_id
 WHERE NOT EXISTS (SELECT 1 FROM student_class_enrolments e
                    WHERE e.class_id = c.id AND e.is_active)
   AND NOT EXISTS (SELECT 1 FROM lesson_sessions ls
                     JOIN attendance a ON a.lesson_session_id = ls.id AND a.student_id = b.student_id
                    WHERE ls.class_id = b.class_id AND ls.session_date = b.session_date);

-- 0b. The null-lastScheduledDate population. 20260809000300's header claims zero as of
--     2026-08-09 — RE-CONFIRM IT, do not inherit the claim (§8.38: never inherit a list).
SELECT id, tenant_id, title FROM classes WHERE is_active = false AND deactivated_at IS NULL;

-- 0c. Uncancelled, unmarked bookings BELOW the business's markable floor, in a month with no
--     billing_periods row. These would block a month nobody can mark.
SELECT c.tenant_id, c.id, c.title, b.session_date, b.kind, markable_floor(c.tenant_id) AS floor
  FROM (SELECT class_id, student_id, session_date, 'trial'  AS kind FROM trial_bookings  WHERE cancelled_at IS NULL
        UNION ALL
        SELECT class_id, student_id, session_date, 'makeup' AS kind FROM makeup_bookings WHERE cancelled_at IS NULL) b
  JOIN classes c ON c.id = b.class_id
 WHERE b.session_date < markable_floor(c.tenant_id)
   AND NOT EXISTS (SELECT 1 FROM billing_periods bp
                    WHERE bp.tenant_id = c.tenant_id
                      AND bp.billing_month = to_char(b.session_date, 'YYYY-MM'));
```

**RESULT — 2026-08-10, run against production (`cdmjeyauhxcgulhbxmsb`, SQL Editor, role `postgres`):
0a = 0 · 0b = 0 · 0c = 0. GATE PASSED.**

Context captured in the same run, because the counts are what make the result readable:

| Fact | Value |
|---|---|
| Classes | **6**, every one `is_active = true` with `deactivated_at IS NULL` |
| Live trial bookings (`cancelled_at IS NULL`) | **0** |
| Live make-up bookings | **0** |

> **⚠ READ THE GATE HONESTLY — 0a and 0c passed VACUOUSLY.** Production holds no live booking of
> either kind, so no row *could* have been in the bad state. That makes this the safest possible
> moment to ship — the new block cannot fire on existing data — but it is **not** evidence the
> bug is theoretical, and it must not be written up as if the audit exercised the query. The one
> non-vacuous result is **0b = 0 against 6 real classes**, which is what licenses step 2.4's
> `VALIDATE CONSTRAINT`.

---

## 2. Migration `20260810000100` — close the front door, all three doors

One migration, alone in flight (§7.55). A worktree never authors one.

> **⚠ THE LIVE DEFINITIONS WERE READ BEFORE THIS STEP WAS WRITTEN, AND THEY CORRECTED IT.**
> Checked 2026-08-10 with `pg_get_functiondef()` against the local database — RISK 6 in action,
> and it fired on its own plan. Both the BACKLOG entry and the risk review claimed
> `book_trial()` has no floor guard, having read the superseded file `20260725000800`. **It has
> one**, added by `20260806000200`, and it uses `markable_floor()` — which is *better* than
> `book_makeup()`'s, not worse. State as of now:
>
> | Function | `is_active` refusal | floor guard |
> |---|---|---|
> | `book_makeup` | ✅ | ✅ `markable_floor()` |
> | `book_trial` | ❌ **the gap** | ✅ `markable_floor()` |
> | `schedule_extra_lesson` | ❌ **the gap** | ✅ `markable_floor()` |
>
> So the floor step is **struck**, and the "wording fix" step with it: the reviewer's claim that
> these two use `session_window_start()` was also read off superseded files. Nothing in the
> repo's current state matches that description.

1. **`book_trial()` refuses an inactive host class**, copying `book_makeup()`'s refusal verbatim
   — `IF NOT v_host_active THEN RAISE EXCEPTION '% is no longer running', v_class_title;`,
   placed immediately after the `class not found` check, exactly where `book_makeup` puts it.
   BACKLOG: *fix both or neither*.
2. **`schedule_extra_lesson()` refuses an inactive class** — it checks tenant, admin, reason and
   floor and never `is_active` (`20260727000100_attendance_window_guard.sql:272-350`). With
   *Show retired* now live (`classes/page.tsx:509+`) an admin can create a `lesson_sessions` row
   on a retired class; that date enters `datesToCheck` at `core.ts:697` **unclamped** and blocks
   a month on a class no coach screen renders. Same one-line fix, same migration.
3. **`CHECK (is_active = true OR deactivated_at IS NOT NULL)` on `classes`** — the structural
   half of RISK 2. It makes a null-`lastScheduledDate` row impossible, which closes both the raw
   PostgREST retire path and the reason anyone would want the booking clamp. Every existing path
   already satisfies it: insert sets `is_active: true` (`classes/page.tsx:391`),
   `deactivate_class()` sets both columns, `reactivate_class()` sets
   `is_active = TRUE, deactivated_at = NULL`.

   > **⚠ RISK 22 MITIGATION — assertion with a pass/fail value.** The constraint is added
   > **`NOT VALID` first, then `VALIDATE CONSTRAINT` as a separate statement in the same
   > migration**, so a non-empty legacy population fails the *validate* with a nameable row
   > rather than the *add* with an opaque error. Gate 0 query **0b must be 0** for it to pass —
   > if it is not, that is the blocker, and the constraint is what surfaces it. Assert in pgTAP
   > that a raw `UPDATE classes SET is_active = false` **raises `23514`**, and that
   > `deactivate_class()` on the same class still succeeds. Removing the constraint must flip
   > that pair.

4. Committed rollback file `supabase/rollback/20260810_booking_guards_DOWN.sql` — it must drop
   the CHECK constraint as well as reverting the two functions.

> **⚠ RISK 4 — STRUCK, and the reason is worth keeping.** The original RISK 4 said a pre-floor
> booking would go live once step 3 lands: it enters `datesToCheck` (`core.ts:701`) and stops the
> run with no override (`core.ts:758-780`) while nobody can mark it — `checkMarkableDate` refuses
> below the floor (`attendanceWindow.ts:102-111`) and the Schedule backlog starts at
> `backlogFrom` (`schedule/index.tsx:328`). **That door is already shut**: all three RPCs refuse
> `p_session_date < markable_floor(v_tenant)`. Gate 0's query **0c is the standing check on it**
> and returned 0.
>
> What remains true and is **not** closed by any of this: `markable_floor` **moves forward** —
> `LEAST(1st of last month, month after the LATEST seal, created_at)` — so sealing August while
> July is still blocked drops July's dates below the floor permanently. That is §8.32's shape on
> a different axis, it is **not** introduced by this work, and it is **not** in scope here. If it
> is ever worth closing, it is a `BACKLOG.md` item, not a line in this migration.

> **⚠ RISK 5 MITIGATION — a step.** **Execute** the rollback file and re-apply the migration on
> top of it, then diff `pg_get_functiondef()` before and after (§7.93 — running the DOWN file is
> the half that finds the bugs; §7.92 is what it found last time). Writing it does not count.

> **⚠ RISK 6 MITIGATION — a step.** `book_trial()` is defined in `20260725000800` and
> **redefined** in `20260806000200_markable_floor.sql`. Take the body from the *latest*
> definition, verified with `pg_get_functiondef('book_trial'::regproc)` against the live local
> database, never from the older file. Re-deriving from the wrong source silently reverts the
> markable-floor guard.

> **⚠ RISK 7 MITIGATION — a step.** `CREATE OR REPLACE` preserves ACLs, but §7.87 means a
> function is callable by nobody unless granted: confirm `book_trial`, `book_makeup` and
> `schedule_extra_lesson`'s EXECUTE sets are **unchanged** after apply, and take the **remote**
> grant dump and diff it after deploy (§7.39, §7.89).

---

## 3. Engine `core.ts` v19 → v20 — teach the two guards about bookings, and change nothing else

1. `core.ts:662` → `if (!sessionIds.length && !expectedDates.length && !bookingsByDate.size) continue;`
2. `core.ts:685` → `if (!billableStudentIds.length && !bookingsByDate.size) continue;`
3. Bump the version constant and its log line.

> **⚠ RISK 8 MITIGATION — a named prohibition, and it replaces the plan's original step 2.**
> Do **NOT** add booked student ids to `billableStudentIds`. Change the **guard** instead, as
> written above. `billableStudentIds` is read by four downstream consumers — `parentStudents`
> (`:724`), `billedStudents` (`:731`), the deferral set (`:742`) and the item loop (`:840-885`)
> — and the review traced that widening it is safe *today* only by coincidence of the item loop
> iterating `parentStudents` rather than `billableStudentIds`. Nothing pins that invariant.
> Keep the set's single meaning and nothing downstream moves.

> **⚠ RISK 9 MITIGATION — assertion with a pass/fail value.** Deno suite proven red, and the
> direction that matters is the one the naive fix passes:
> - **without the fix** — a class with zero active enrolments and one unmarked booking, beside a
>   second class that bills: the run must currently report `sealed: true` and
>   `classes_still_incomplete: 0`. That is the bug, asserted.
> - **with the fix** — the same fixture must report `sealed: false` and name that date in
>   `blocking`, and a *legacy-inactive* class (`is_active = false, deactivated_at IS NULL`)
>   holding an unmarked booking must **also** block. That second case is what a re-added clamp
>   would break, and it is the only structural defence against RISK 2 returning.
>
> **Run the suite TWICE** (§7.15) — a completing run seals its billing month, so leaked state
> makes the second run short-circuit and passing once proves nothing. Pass = identical counts on
> both runs; a case green only on run 1 is red.

> **⚠ RISK 10 MITIGATION — a named prohibition.** No `completeMonth()` / `seal…` / `settle…`
> helper may appear in the fixture of **any** case asserting a block: `completeMonth()` marks
> every still-due lesson `cancelled_rain`, satisfying the very gate under test, and two
> `classDeactivation.test.ts` cases were already vacuous for exactly this reason (**§7.111**).
> Amount-only cases may use them freely.

---

## 4. `roster.tsx` — a guest-only lesson must render, without a wall of empty cards

`SwimSyncApp/app/(coach)/classes/[id]/roster.tsx:376` gates both the synthesised lesson rows and
the Mark Attendance target inside `if (activeStudentIds.length > 0)`. Lift both out and derive
the date list the way the Schedule tab does — one derivation of "who was expected here" (§7.18:
four hand-written copies caused a live underbill).

> **⚠ RISK 11 MITIGATION — a step.** Apply the Schedule tab's **exact** rule: skip any date where
> `expectedStudentsOn(date, enrolmentSpans, bookedByDate).length === 0` (the `continue` at
> `schedule/index.tsx:537`), and choose `markTarget` from that filtered list — **not** from
> `expected[expected.length - 1]` (`roster.tsx:389-394`). Without this, a guest-only class has no
> enrolments, so `earliest` is `undefined`, `backlogWindowStart` returns the full floor window
> (`lessonDates.ts:218-237`) and the coach gets ~8 orange "no-students" cards plus a Mark button
> pointed at a weekday date that is not the booking date.

> **⚠ RISK 12 MITIGATION — a step, and it must land BEFORE the date list is widened.**
> `roster.tsx:263-273` fetches both booking tables with **no date bound at all** — every booking
> the class has ever held. Harmless while the date list is bounded by `expectedLessonDates`,
> fatal the moment it is derived from booking dates: an ancient booking renders a Mark tile that
> can only ever say "That lesson is closed". Bound both queries to `[winStart, todayDate]`,
> mirroring `schedule/index.tsx:397-408` — which is also the `max_rows` exposure §7.70 documents
> having already fixed on these two tables.

> **⚠ RISK 13 MITIGATION — assertion with a pass/fail value.** The two coach surfaces must agree
> *after* the change, in one driver run: a guest-only unmarked lesson appears on the Schedule tab
> **and** the class roster, same date, same marked-state label. Disagreement between these two
> screens is the bug being fixed; a roster-only test cannot see a regression on the other side.

---

## 5. `attendance.tsx` — stop trusting a `sessionId` from the URL

`attendance.tsx:254` takes `sessionIdParam` on trust. Resolve by `(class_id, date)` and ignore it.

**The review confirmed this is safe** and why, so the reasoning does not need re-deriving:
`(class_id, session_date)` is unique (`ON CONFLICT` in `schedule_extra_lesson`, `20260727000100`),
so `.maybeSingle()` at `:256-262` cannot disagree with the param; the save path already
re-resolves whenever the stamp does not match the date (`resolveSessionForDate`, used at
`:451-463`), and the `decision.kind === "use"` branch fires only for a resolution stamped with
the on-screen date, so it never depends on the param; `sessionExists` (`:284`) gets the same
answer either way, preserving the off-schedule-lesson weekday waiver
(`attendanceWindow.ts:115`).

> **⚠ RISK 14 MITIGATION — a step.** Remove the param from **both** callers, not one.
> `schedule/index.tsx:629` also appends `&sessionId=`, and the plan originally only named
> `roster.tsx:501` / `:748`. Also delete `sessionIdParam` from the destructure
> (`attendance.tsx:109-115`) **and** the effect deps (`:177`). A param live from one caller and
> dead from another is an invitation to re-introduce the trust.

---

## 6. Tests

> **⚠ RISK 15 MITIGATION — a step.** The pgTAP subject for the `book_trial` `is_active` refusal
> must be **otherwise perfectly valid**: an existing child of this tenant, no active enrolment,
> no live package, a date that is the class's own weekday and inside the window — with only the
> class inactive. `book_trial` has five other refusals (`20260725000800:36-110`), and
> `throws_ok(…, 'P0001', NULL, …)` matches **any** of them (**§7.112** — this exact trap went
> green in §8.39). Pair it with `lives_ok` on the same subject after `reactivate_class()`, so
> deleting the check flips the pair.

> **⚠ RISK 16 MITIGATION — assertion with a pass/fail value.** Before the engine deploys, a UI
> driver must prove a guest-only unmarked lesson in an **active** class appears in the coach's
> NEEDS MARKING list and that its Mark button saves. Pass = the item disappears from the list
> after saving; fail = anything else. This is the clearing screen that makes the new block safe,
> and it exists today — `schedule/index.tsx:528` builds NEEDS MARKING from
> `lessonDatesInRange(day_of_week, backlogFrom, todayDate, bookedDates, sessionDates)`, booking
> dates included, with `backlogFrom` deliberately floor-only (`:511-527`).

> **⚠ RISK 17 MITIGATION — a step.** `verify-trials.mjs` mutates shared state. Its fixture must
> reset with `ON CONFLICT (id) DO UPDATE SET` on exactly the columns the driver touches
> (`cancelled_at`, plus deletion of the attendance rows) — never `DO NOTHING` (§7.113: a run that
> dies mid-way otherwise leaves the state behind and the next run blames the fixture). Run it
> **three consecutive times**: it is the driver §7.100 caught self-skipping into a false PASS, so
> a green run is not proof it asserted.

---

## 7. Deploy — migration → engine → apps, `main` last

> **⚠ RISK 18 MITIGATION — assertion with a pass/fail value.** The order is not symmetric.
> **Engine v20 before the migration silently underbills**; migration-only is a pure tightening
> and is safe to sit alone indefinitely. So: after `supabase db push`, calling `book_trial()`
> against a deactivated class must **raise** *before* `supabase functions deploy
> generate-invoices` runs. Fail → stop.
>
> `supabase db push`'s own output is not proof (§9: on 2026-08-09 it printed a stack trace *and*
> "Finished"). The fact is `supabase migration list --linked` showing `20260810000100` with a
> **filled `remote` column**, and `supabase functions list` showing a new `generate-invoices`
> version, plus grepping the served bundle for a string only v20 contains (§7.31, §7.51 — a 200
> proves nothing).

---

## 8. Part B — the `service_role` audit (DOCUMENTATION ONLY)

No migration, no code change, no test file. The deliverable is the honest answer to *"what does
each service-role caller actually touch?"*, which `BACKLOG.md` names as the item's prerequisite.

`createAdminClient` is imported by exactly **five** routes — `invite-parent`, `create-coach`,
`provision-tenant`, `resend-invite`, `generate-invoices` — plus `lib/adminManagementGate.ts`,
alongside the three edge functions (`generate-invoices`, `package-emails`, `public-invoice`).

> **⚠ RISK 19 MITIGATION — a step.** The table must **explicitly state** that the other six
> `/api` routes (`invite-admin`, `list-admins`, `deactivate-admin`, `reactivate-admin`,
> `delete-admin`, `resend-admin-invite`) hold no key of their own and reach service_role only
> through the gate. Omit that and a reader concludes they are unaudited.

> **⚠ RISK 20 MITIGATION — a step.** Derive each caller's table list by **reading the code**, not
> by inheriting BACKLOG's "known writers to start from" list. §8.38 found an inherited list wrong
> in **both** directions — a writer that was not one, and a writer that was missing.

> **⚠ RISK 21 MITIGATION — a named prohibition.** Do **NOT** extend
> `supabase/tests/table_grants.test.sql` to cover `service_role`, and write the reason into the
> BACKLOG item: that file asserts *no privilege exists where no policy could permit it*, and
> `service_role` bypasses RLS entirely, so the file cannot express service_role scope at all
> (§7.87). A test that is red against a correct database gets disabled. Do **NOT** ship a
> narrowing migration this session — the item is the decision, and any narrowing must not risk
> the invoice engine, the one thing in this repo that must never fail silently.

---

## 9. To file in `BACKLOG.md`, not to fix here

- **`classCoverage.ts` does not union session dates, while the engine does.** `core.ts:697`
  unions `sessionByDate.keys()` into `datesToCheck`; `classCoverage.ts` unions only
  `bookedByDate.keys()`. An unmarked **off-schedule extra lesson** therefore blocks the engine
  and is invisible on the admin's pre-flight — the opposite direction of the divergence this
  plan fixes. Pre-existing and orthogonal; file it rather than discover it during the next block.
- Retired classes still cost three queries per run for ever (§8.39 filed this; unchanged here).

---

## 10. Pre-commit gate

Walk these before committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The four highest-value ones, called out because the rest are routine:**

- [ ] **Gate 0 recorded — all THREE queries, all zero** (§1). The release is not safe without it.
- [ ] **No clamp on `bookingsByDate` anywhere in `core.ts`** (RISK 2), **and** the
      `CHECK (is_active = true OR deactivated_at IS NOT NULL)` constraint is live and VALIDATED
      (RISK 22) — the constraint is what makes the prohibition structural instead of vigilant.
- [ ] **`billableStudentIds` is unchanged** (RISK 8) — the guard moved, the set did not.
- [ ] **Rollback file EXECUTED, not merely written** (RISK 5).

The rest:

- [ ] `book_trial()` body taken from `pg_get_functiondef()`, not from `20260725000800`.
- [ ] All four migration guards present: `book_trial` is_active, `book_trial` floor,
      `schedule_extra_lesson` is_active, and the `classes` CHECK constraint.
- [ ] pgTAP asserts a raw `UPDATE classes SET is_active = false` raises `23514`, paired with
      `deactivate_class()` still succeeding on the same class (RISK 22).
- [ ] Deno suite run **twice**, identical counts.
- [ ] No `completeMonth()` in any fixture of a case asserting a block (§7.111).
- [ ] pgTAP `book_trial` case paired with `lives_ok` after `reactivate_class()` (§7.112).
- [ ] Roster booking queries date-bounded **before** the date list widened (RISK 12).
- [ ] Schedule tab and roster agree on the guest-only lesson, one driver run.
- [ ] `&sessionId=` removed from **both** `roster.tsx` and `schedule/index.tsx:629`.
- [ ] `verify-trials.mjs` green **three consecutive runs**.
- [ ] Both typechecks clean; vitest + jest green.
- [ ] `supabase migration list --linked` shows a filled `remote` column.
- [ ] Remote grant dump taken and diffed (§7.39, §7.89).
- [ ] Durable findings graduated to `docs/GOTCHAS.md` §7 — a mitigation that outlives this task
      does not belong only in a plan file that is discarded when the work lands. Candidates:
      *a booking row is explicit evidence and must never be clamped*; *`classCoverage.ts` and
      `core.ts` are two copies of one rule*.
