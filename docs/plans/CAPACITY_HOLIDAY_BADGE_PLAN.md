# Three small DB-rule items — capacity as a HARD limit, the holiday-void retirement boundary, the Lessons badge

_Planned 2026-08-20. Backlog: `BACKLOG.md` → *Capacity as a hard limit in `book_makeup` /
`book_trial` (and enrolment)* (**S → M**, see below), *`mark_day_holiday` uses
`deactivated_at::date` (UTC) where the engine uses SGT* (**S**), *Lessons "needs marking" badge
in the sidebar* (**S**). All three were filed by the admin-calendar wave (§8.71) and left
unbuilt on purpose so that wave kept one migration to one concern._

_Written for an implementing session that has NOT read this conversation. Every file:line
below was verified on `main` at `8eb4474`. **Read `docs/GOTCHAS.md` §7.7, §7.18, §7.25,
§7.32, §7.55, §7.57, §7.60, §7.87, §7.93, §7.115, §7.123 before starting** — every one of them
is load-bearing somewhere in this plan._

_Risk-reviewed 2026-08-20 (`/plan-review`, independent agent, every file:line re-verified against
`main` at `8eb4474` before folding in). The review found **four plan claims factually wrong** and
corrected them in place: the enrolment trigger as drafted reports "full" instead of 23505 for a
duplicate child (B1c — the BEFORE trigger precedes the index, the opposite of what the plan
concluded); Decision 4's "coaches cannot enrol" is false for `add_unclaimed_student`'s coach arm;
Phase A's "observable via a guest on the retirement day" is a state `deactivate_class()` refuses to
create, so the real reachable effect is different and was untested; and B5's "the fixture re-apply
restores capacity" is false (`ON CONFLICT DO NOTHING` keeps a mutated column). All fourteen findings
are inline below, marked `⚠ RISK n MITIGATION`, ranked 1 (riskiest) to 8. **The ⚠ blocks are
steps, assertions and prohibitions — not commentary. Skipping one is skipping a step.** The
pre-commit gate at the end lists them; a box that cannot be ticked is a blocker._

> **⚠ SCOPE MOVED. Item 1 is no longer S.** It was filed as "a check inside two RPCs". The user
> settled (Decision 2) that **enrolment is in scope too**, and enrolment has **no RPC** — the
> admin writes `student_class_enrolments` with a direct client insert from three pages. So
> item 1 is: one SQL count, two RPC refusals, one `BEFORE INSERT` trigger, one UI removal, one
> driver rewrite. Budget **half a day** for it alone. Items 2 and 3 are genuinely small
> (≈45 min and ≈2–3 hrs).
>
> **Order: Phase A (holiday) → Phase B (capacity) → Phase C (badge).** One migration in flight
> at a time (§7.55); each phase lands on `main` before the next starts. If the session is
> short, A and B are the ones that change product behaviour; C is a convenience.

---

## Decisions (settled 2026-08-20 with the user — do not re-litigate)

| # | Decision | Consequence |
|---|---|---|
| 1 | **Capacity is a hard refusal for EVERYONE, the tenant admin included.** No override flag, no `p_force`. | "Book anyway" (`lessons/[classId]/[date]/page.tsx:412`, modal L709–721, testid `book-anyway`) is **removed**, and the 08-19 "the admin is the authority" decision in `ADMIN_CALENDAR_PLAN.md` RISK 3 is **superseded** (append a dated line there; never rewrite history). A full class is fixed by raising its maximum, not by booking past it. |
| 2 | **Enrolment is in scope**, enforced by a **`BEFORE INSERT` trigger** on `student_class_enrolments` — not a new RPC, not a revoked INSERT grant. | One rule covers all five write paths: Students *Add class* (`students/page.tsx:243`), Unassigned *Assign* (`unassigned/page.tsx:199`), Trials *Convert* (`trials/page.tsx:326`), `add_unclaimed_student` (`20260725000800_book_trial.sql:270`, its latest definition), and `add_unclaimed_student`'s own older body (`20260725000200:150`, superseded). `table_grants.test.sql` is untouched. |
| 3 | **Two counts, each backing a number the admin already sees.** A *booking on a date* counts the lesson page's `x+y/cap`: enrolled on that date **by span** + uncancelled trial + make-up guests (the `expectedStudentsOn` union, `attendanceCompleteness.ts:181–188`). An *enrolment* counts the Classes table's `students / max`: **`is_active` enrolments** of the class (`classes/page.tsx:239–243`). | A guest booked next Monday does **not** block a permanent enrolment; a permanent roster at capacity **does** block a guest on every date it covers. The refusal the admin gets always matches the number on the screen they are looking at. |
| 4 | Coaches need nothing new. | `book_makeup` / `book_trial` already require `is_tenant_admin()`; a **direct** `student_class_enrolments` INSERT is admin-only under `enrolments_write`. **Corrected by the 08-20 review:** "coaches cannot add students" is NOT the full status quo — `add_unclaimed_student(… 'enrol' …)` (`20260725000800:231–237`) admits the **class's own coach** (`c.coach_id = current_coach_id()`) and inserts an enrolment through the definer path. The trigger (B1c) covers that arm because it fires inside the definer body; B2 case 16 runs it **as the coach**, not only as the admin. Whether a coach *should* be able to enrol poolside is a product question for the user — file it in `BACKLOG.md`, do not change it here. |
| 5 | The holiday fix matches **the engine**, not the calendar. | `mark_day_holiday` keeps "still running on that date" as `(deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date` — SGT **and inclusive** (see Phase A for why). |
| 6 | The badge counts **exactly what `/lessons?mode=needs` lists.** | A new SQL copy of the page's predicate (`calendarLessons.ts:394–399` + cutoff L337/347), pinned by a driver check that the badge number equals the page's row count. No polling; refetch on navigation like the two existing badges. |

**Not chosen, and why:** a `p_over_capacity` flag on the RPCs (would keep "Book anyway"; refused by
the user — a full class is full); a new `enrol_student` RPC with the direct INSERT revoked (M+, rewrites
three pages, touches the grant whitelist, and buys nothing a trigger does not); reusing
`class_unmarked_lesson_dates()` for the badge (it is `deactivate_class()`'s destructive-action guard,
ungranted on purpose — `20260809000400:28–32`; copy its body, never widen its grant).

---

## Phase A — `mark_day_holiday` retirement boundary (≈45 min)

Branch `db/holiday-void-retirement-sgt` **in the root checkout**.

### What is wrong, precisely

`20260818000900_mark_day_holiday.sql:51` and `:61` — the only two bare `::date` casts of a
timestamptz in `supabase/` —

```sql
AND (c.is_active OR (c.deactivated_at IS NOT NULL AND c.deactivated_at::date > p_date))
```

Two drifts in one predicate:

1. **Timezone.** `::date` is the server's UTC date (§7.7). A class retired 00:00–08:00 SGT is
   "still running" for one extra day. The very same function casts enrolment spans in SGT six
   lines later (L70–72) with a comment naming this hazard.
2. **Inclusivity.** The engine clamps a retired class's expected dates at the SGT retirement
   date **inclusive**: `core.ts:693–703` sets `expectedTo = lastScheduledDate`, and
   `dates.ts:135` iterates `ms <= end`. The RPC's `>` excludes the retirement date.

**Why inclusive is the right answer — and what is actually observable (corrected 2026-08-20).**
The original text here claimed a guest booked on the retirement day is expected by the engine but
skipped by the `>` predicate, so "the month blocks on an unvoided guest". **That state cannot be
produced by the product.** `deactivate_class()` (`20260809000300:253–279`) refusal 2 refuses any
uncancelled guest with `session_date >= today_sg()` — a guest booked on the retirement day itself
blocks the retirement; refusal 3 requires every lesson ≥ floor to be marked; refusal 1 clears every
span that reaches the floor. And the engine's pattern dates for a retired class are **always `[]`**:
`core.ts:703` gates `expectedDates` on `activeStudentIds.length`, which refusal 1 plus
`trg_enrolment_schedule` (no enrolment may enter a retired class) keep at zero. So `dates.ts:135`'s
inclusivity is true of the code and vacuous for real data. The plan's Decision 5 stands (SGT, `>=`)
as **drift hygiene** — the enrolment predicate six lines down is SGT, and nothing should read a
timestamptz's UTC date — but the honest statement of what changes is:

- **Reachable effect (the one to test):** a class retired at 00:00–08:00 SGT on D+1 has
  `deactivated_at::date = D` in UTC, so voiding D under the old predicate **skips the class**. Its
  lesson on D is already marked (refusal 3 guarantees it), so the existing `'present'` rows keep
  billing and the covering packages are **not** extended — a wrong bill, not a block. `>=` in SGT
  reaches it and `ON CONFLICT … DO UPDATE` flips the rows to `'holiday'`.
- **Side effect of `>=` (assert it is harmless):** a class retired ON p_date (SGT) now gets an
  **empty** `lesson_sessions` row materialised (nobody is expected, by construction). Verified
  against `core.ts:754–797`: an empty session makes the class enter the gate, `unmarkedOn(D)` is
  empty, `billableStudentIds` is empty and `bookingsByDate` is empty → `continue`. Harmless to
  billing, and `unmark_day_holiday` deletes it (no attendance). `mark_day_holiday` already does
  the same for an active class with no students.
- **The plan's original block scenario is reachable only by a raw PostgREST
  `UPDATE classes SET is_active = false, deactivated_at = now()`** (the `classes_write` policy is
  `FOR ALL` and the CHECK is satisfied when the date is supplied). That is not a product path; A2's
  fixtures construct it with a superuser UPDATE and must say so in their comments.

⚠ RISK 3 MITIGATION (assertion, A2): case 9 below is rewritten to pin the **reachable** effect —
the guest is pre-marked `'present'` on p_date; under the old predicate the row stays `'present'`
(red), under the new one it is `'holiday'` and the covering package's `holiday_extension_days`
moved. ⚠ RISK 3 MITIGATION (assertion, A2 case 10): after the void, the retired-on-p_date class
has a `lesson_sessions` row with **zero** attendance rows, and `unmark_day_holiday` removes it
(`0` sessions after). ⚠ RISK 3 MITIGATION (named prohibition): do NOT widen the RPC to "fix" the
raw-UPDATE path or add a refusal anywhere for it — it is out of scope; file it in `BACKLOG.md`
(the `20260810000100` header's "a raw UPDATE cannot supply the date" is wrong and should be
corrected there, not here).

> **Note, not a task (corrected 2026-08-20):** `SwimSyncAdmin/lib/calendarLessons.ts:343–347`
> comments "the engine stops expecting lessons ON the SGT retirement date" and skips
> `date >= cutoff` when no session row exists. The original plan called that a misreading of
> `dates.ts:135`. It is not: for product data the engine expects **no** pattern lessons for a
> retired class at all (see above), so the page's exclusive reading can never hide anything the
> engine will block on. **Leave the code and the comment alone in every phase.** The only thing
> the page cannot show is a guest created by the raw-UPDATE path — file that with the backlog
> item above, not as a calendar change.

### A1. Migration `supabase/migrations/20260820000100_holiday_void_retirement_sgt.sql`

- `CREATE OR REPLACE FUNCTION mark_day_holiday(p_tenant uuid, p_date date)` — the **full body**
  from `20260818000900:21–98` with both predicates changed to
  `(c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date`. Same signature → same
  `pg_proc` row → grants survive (§7.123); still `REVOKE`/`GRANT` at the bottom for the avoidance
  of doubt, identical to `20260818000900:139–142`.
- Header: cite §7.7, this plan, and the two-drift reasoning above in four lines.
- `unmark_day_holiday` has no date casts (it matches on `ls.session_date`) — **do not touch it**.
- DOWN file `supabase/rollback/20260820000100_holiday_void_retirement_sgt_DOWN.sql`: the
  `20260818000900` body verbatim. Run it once against local (§7.93), then re-apply.
- `COMMENT ON FUNCTION` updated: add "…a class retired on or after the date, by its SGT date."

### A2. pgTAP — extend `supabase/tests/holiday_day_rpc.test.sql` (8 → 11)

Fixture additions: two more Monday classes in the same tenant. Set `deactivated_at` with a plain
superuser `UPDATE classes SET is_active = FALSE, deactivated_at = …` — do not route through
`deactivate_class()` — and **write in the fixture comment that `deactivate_class()` would refuse
these states** (see the corrected reasoning above); the tests pin the predicate, not a product
path.

- Class **R1** (case 9): one enrolment whose span ended the day before the holiday, one make-up
  guest on the holiday who is **already marked `'present'`** in a pre-existing `lesson_sessions`
  row (the reachable state — refusal 3 guarantees a retired class's past lessons are marked), and
  the guest's parent holds an active package covering the date.
- Class **R2** (case 10): no enrolments, no guests — retired ON the holiday.
- Class **R3** (case 11): retired the day before.

| # | `deactivated_at` | Old predicate | New predicate | Assertion |
|---|---|---|---|---|
| 9 | `p_date + 1` at **01:00 SGT** (= `p_date` 17:00 UTC) | excluded (UTC date = `p_date`, `>` false) → guest stays `'present'`, package unmoved | **included** (SGT date `p_date+1`) | the guest's row is now `'holiday'` **and** the covering package's `holiday_extension_days` = the tenant's setting; RETURN count includes it |
| 10 | `p_date` at **12:00 SGT** | excluded | **included** (`>=`) | a `lesson_sessions` row exists for R2 on p_date with **0** attendance rows (harmless, verified against `core.ts:754–797`); after `unmark_day_holiday` it is gone |
| 11 | `p_date - 1` at 23:00 SGT | excluded | excluded | no session materialised, no row |

**§7.25 — prove them red first:** write the three cases, run `supabase test db` *before* applying
A1 (they must fail on 9 and 10 — 9 on the `'present'` row, 10 on the missing session), then apply
and run again. Keep the red run's output in the commit message.

⚠ RISK 3 MITIGATION (assertion, A2): the existing 8 assertions still pass byte-for-byte — the
predicate change must not alter the active-class path (cases 1–8 exercise only an active class).

### A3. Land it

`supabase db reset` (nothing else may be running — §7.55) → `supabase test db` → merge to
`main` → push → `supabase db push` → `supabase migration list --linked` shows the row in the
`remote` column (the CLI's own "Finished" line is not proof, §9). No app change, no engine
change, no grant change (the function's ACL is unchanged) — **no grant dump needed for this
phase**. `docs/TESTING.md` §5 row for `holiday_day_rpc.test.sql` gets "(11)" and one clause.

⚠ RISK 7 MITIGATION (step, A1): end the migration with an apply-time `DO` block in the shape of
`20260810000100:347–365` that RAISES if `authenticated` lacks EXECUTE on
`mark_day_holiday(uuid,date)` or if `anon` holds it. `20260818000900:139–142` revoked from
`PUBLIC` only — never from `anon`/`service_role` explicitly — so this is the first migration to
assert the cloud ACL of that function; if the block aborts `db push` on production, that is a
real finding (§7.39), and THEN a grant dump is needed. Locally it must pass on `db reset`.

---

## Phase B — capacity as a hard limit (≈ half a day)

Branch `db/capacity-hard-limit` **in the root checkout** for B1–B3; the app work B4–B5 may be
done on the same branch after the migration is applied locally, or on a feature branch after it
lands — **but the migration reaches production before the app reaches `main`** (§7.60; either
order is *safe* here, since a refusing DB renders as an error and a non-refusing DB behind the
new UI merely lacks the guard, but the rule is the rule).

### B1. Migration `supabase/migrations/20260820000200_capacity_hard_limit.sql`

**(a) Two helpers, callable by nobody** (they run inside SECURITY DEFINER bodies as the owner;
`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` exactly as
`20260809000300:384` does for `class_unmarked_lesson_dates`):

```sql
-- The class's effective maximum: its own, else the category default, else NULL = unlimited.
-- The ONE SQL copy of calendarLessons.ts effectiveCapacity() (L252–258).
CREATE FUNCTION public.class_effective_capacity(p_class_id uuid) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(c.capacity, cat.default_capacity)
    FROM classes c LEFT JOIN class_categories cat ON cat.id = c.category_id
   WHERE c.id = p_class_id
$$;

-- Who is expected in one lesson: enrolled ON THAT DATE by span (SGT, inclusive both ends —
-- never is_active) + uncancelled trial guests + uncancelled make-up guests, DISTINCT student.
-- The ONE SQL copy of attendanceCompleteness.ts expectedStudentsOn() (L181–188); the same
-- union class_unmarked_lesson_dates() (20260809000300:131–151) and mark_day_holiday()
-- (20260818000900:68–82) already spell out — copy their span predicate byte for byte.
CREATE FUNCTION public.class_expected_count(p_class_id uuid, p_date date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ … $$;
```

⚠ RISK 8 MITIGATION (verified, no trap found — recorded so nobody re-derives it): a `sql`-language
`SECURITY DEFINER STABLE` helper called from inside a `SECURITY DEFINER plpgsql` body runs as the
same owner (`postgres`, RLS-exempt as table owner), with its own `SET search_path = public`, and a
STABLE function inside a volatile caller reads the calling query's snapshot — fine here because
`class_effective_capacity` reads only `classes`, which the calling statement never writes. Two
**named prohibitions** follow from that analysis: (i) **do NOT call `class_expected_count()` from
the enrolment trigger** — it counts by span on a date, the trigger counts the active roster
(Decision 3), and a STABLE span-count inside a multi-row INSERT would not see rows inserted
earlier in the same statement; (ii) **do NOT mark either helper VOLATILE or the trigger function
STABLE** — the trigger function must stay the plpgsql default (VOLATILE) so its `SELECT count(*)`
sees same-statement rows (the fixture case in B2). `function_grants.test.sql` assertion 1
(`pg_proc`-wide, no `anon` EXECUTE) covers both helpers on the day they are created.

**(b) `book_makeup` and `book_trial` — `CREATE OR REPLACE`, same signatures.** Current bodies:
`book_makeup(uuid, date, uuid, uuid)` at `20260811000100_multiple_classes_per_child.sql:373`
(the 4-arg one — NOT the 3-arg originals, §7.115: read `pg_get_functiondef` to be sure), and
`book_trial(uuid, date, uuid)` at `20260810000100_booking_class_active_guards.sql:69`. Copy the
body, insert **one block immediately before the `INSERT`** — after every existing refusal, so a
child who is *already booked* still hears "already booked", not "full":

```sql
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
    RAISE EXCEPTION
      '% is full on % (% of %) — free a place or raise the class''s maximum first',
      v_class_title, to_char(p_session_date, 'DD Mon YYYY'),
      class_expected_count(p_class_id, p_session_date), v_cap;
  END IF;
```

Plain sentence, default SQLSTATE — every caller renders `error.message` verbatim and says so in
a comment (`makeups/page.tsx:308–310`, `trials/page.tsx:246–248`, lesson page L397,
`attendance/page.tsx:553`). **No client parsing exists; do not add any.** Update both
`COMMENT ON FUNCTION` strings (they enumerate the refusals). Re-state the `REVOKE`/`GRANT` lines
from the source files — same signature, ACL survives, but the file should read complete.

⚠ RISK 2 MITIGATION — the two RPCs are every make-up and trial booking on the live apps, and
§7.123 is the shape of the failure. Verified: the 3-arg `book_makeup` was **dropped** at
`20260811000100:373` and the 4-arg form carries `p_home_class_id uuid DEFAULT NULL`, which is the
only reason the old 3-arg client call still resolves. `CREATE OR REPLACE` preserves the ACL but
**refuses a parameter rename** and **silently accepts a dropped DEFAULT**. So:
- STEP (§7.115): before writing a line, capture `pg_get_functiondef('public.book_makeup'::regproc)`
  and `…book_trial…` from the live local DB into the scratchpad; the new body is that text plus
  the one block — not the migration file's text.
- ASSERTION (apply-time `DO` block at the end of B1, the `20260810000100:347–365` shape): `SELECT
  count(*) FROM pg_proc WHERE proname = 'book_makeup'` **= 1** and `= 1` for `book_trial` (no
  stray overload); `pg_get_function_arguments('public.book_makeup'::regproc)` **ends with
  `DEFAULT NULL`**; `has_function_privilege('authenticated', 'public.book_makeup(uuid,date,uuid,uuid)',
  'EXECUTE')` and the `book_trial(uuid,date,uuid)` equivalent are **true**, and both are **false**
  for `anon`; `has_function_privilege('authenticated', 'public.class_effective_capacity(uuid)',
  'EXECUTE')` and `…class_expected_count(uuid,date)…` are **false**. RAISE on any miss — a
  failing probe aborts `db push` on production, which is the point.
- ASSERTION (after apply): `diff` of the captured `pg_get_functiondef` against the new one shows
  **only** the inserted block, the new `DECLARE v_cap smallint;`, and the COMMENT — nothing else
  moved (this is also the §7.93 DOWN check, so it costs nothing extra).
- NAMED PROHIBITION: do NOT rename any parameter, do NOT drop or change `DEFAULT NULL`, do NOT
  `DROP FUNCTION` either RPC (the plan's "same signature → same `pg_proc` row" is what keeps the
  deployed clients working through the deploy window).

**(c) The enrolment trigger.** Model: `enforce_enrolment_schedule()` at
`20260811000100:74–156` — read its header: **SECURITY DEFINER is load-bearing, not style**; a
plain trigger function counts under the caller's RLS and an admin of another tenant, or a future
parent-role caller, would count zero rows and sail through.

```sql
CREATE FUNCTION public.enforce_class_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cap smallint; v_taken integer; v_title text;
BEGIN
  -- Only an OPENING matters: a closed span (add_unclaimed_student's 'trial' row,
  -- 20260725000200:146) occupies no seat, and a closing UPDATE frees one.
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active THEN RETURN NEW; END IF;   -- §7.57: detect the update
  v_cap := class_effective_capacity(NEW.class_id);
  IF v_cap IS NULL THEN RETURN NEW; END IF;
  -- ⚠ RISK 1: `e.student_id <> NEW.student_id` is NOT redundant with `e.id <> NEW.id`.
  -- A BEFORE trigger runs BEFORE the unique-index check, so a duplicate of a child
  -- already in a full class reaches this count first; without this line the admin
  -- is told "full" instead of getting the 23505 the index exists to raise. Same
  -- trap enforce_enrolment_schedule() documents at 20260811000100:107–116.
  SELECT count(*) INTO v_taken FROM student_class_enrolments e
   WHERE e.class_id = NEW.class_id AND e.is_active
     AND e.id <> NEW.id AND e.student_id <> NEW.student_id;
  IF v_taken >= v_cap THEN
    SELECT title INTO v_title FROM classes WHERE id = NEW.class_id;
    RAISE EXCEPTION '% is full (% of %) — free a place or raise the class''s maximum first',
      v_title, v_taken, v_cap;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_class_capacity
  BEFORE INSERT OR UPDATE OF is_active, class_id ON public.student_class_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_class_capacity();
```

No write path today flips `is_active` back to TRUE (every `UPDATE student_class_enrolments` in
`supabase/migrations/` sets it FALSE — verified 2026-08-20 against all six: `20260718000200:59`,
`20260718000900:601`, `20260719000200:132`, `20260719001200:105,247`, `20260811000100:299`;
`merge_students` **DELETEs** the duplicate's rows, which fires nothing) and no client `.upsert()`s
the table; the UPDATE arm is cheap insurance, not a live path.

⚠ RISK 1 MITIGATION — **the plan's original sentence here was backwards and has been replaced.**
It read "the partial unique index still runs *after* BEFORE triggers, so a duplicate active
enrolment is still refused by the index, not by a wrong 'full'". The premise is right and the
conclusion is the opposite: because the index check comes *after*, the trigger sees the duplicate
child's existing row and says "full" first. Structural fix: the `e.student_id <> NEW.student_id`
term above, so a duplicate never counts against capacity and falls through to the index (23505).
B2 case 8 is the proof and must be seen red against a trigger without that term.
- ASSERTION (B2 case 8): duplicate active enrolment into K at 3/3 → SQLSTATE **23505**, message
  does **not** match `/is full/`.
- ASSERTION (B2 new case 17 — same-statement counting): a single `INSERT … VALUES` of **cap+1**
  rows into an empty class throws `is full (cap of cap)`, and a single statement of **exactly cap**
  rows `lives_ok`. This is what `fixtures-admin-calendar.sql:62–72` does (three rows into Rose,
  capacity 3, one statement) — if the trigger ever stops seeing same-statement rows (a STABLE
  marking, a snapshot change), the nightly sweep goes red at fixture load, not at a check.
- ASSERTION (B2 new case 18 — the escape hatch): with K at 3/3, `UPDATE classes SET capacity = 2`
  **lives_ok** (lowering below the roster is allowed — no trigger on `classes.capacity`, verified:
  `trg_class_time_no_enrolment_clash` is `BEFORE UPDATE ON classes` gated on day/time only,
  `20260811000100:219–225`), a 4th enrolment then throws `(3 of 2)`, and `UPDATE classes SET
  capacity = 5` followed by the same insert **lives_ok**. Raising the maximum is the one exit the
  admin always has, and it must never grow a refusal.
- `UPDATE OF is_active, class_id`: the plan's original `UPDATE OF is_active` would not fire on a
  row moved to another class with `is_active` untouched. No such path exists today (verified — no
  `SET class_id` anywhere in `supabase/migrations/` or either app), so this is structural
  insurance, costless.
- Trigger order on the table is alphabetical: `enrolment_tenant_guard` → **`trg_class_capacity`**
  → `trg_enrolment_schedule`. Capacity therefore fires **before** the retired-class and clash
  refusals. A retired class holds zero active enrolments by invariant (`20260811000100` header), so
  it can never read "full" before "retired"; a child who both clashes and would overfill hears
  "full" first — acceptable, and B2 should not assert the opposite. NAMED PROHIBITION: do NOT
  rename the trigger to sort after `trg_enrolment_schedule` to "fix" that ordering — `WHEN
  (NEW.is_active)` on the schedule trigger and the early return here make the order immaterial
  for correctness, and a rename invites a later session to reason about it again.

**(d) Column comments.** `20260819000100_class_capacity_colour.sql:47,56` say "Informational …
no RPC refuses on it". `COMMENT ON COLUMN` both again: "Enforced since 20260820000200: a
booking is refused when the lesson's expected set reaches it, an enrolment when the active
roster does. NULL = unlimited."

**(e) DOWN file** `supabase/rollback/20260820000200_capacity_hard_limit_DOWN.sql`: drop the
trigger and function, restore both RPC bodies verbatim from their source files, drop the two
helpers, restore the two column comments. **Run it, then re-apply** (§7.93 — the DOWN run is the
half that finds the bugs; `20260819000100_class_capacity_colour_DOWN.sql` is the format).

### B2. pgTAP — new `supabase/tests/class_capacity_limit.test.sql`

Own tenant + UUID prefix (copy the shell of `class_capacity_colour.test.sql`; the booking
fixtures and `SET LOCAL ROLE` pattern from `makeup_bookings.test.sql:18–60` — note its warning
that outside a transaction `SET LOCAL ROLE` is a no-op and everything falsely passes). One
category with `default_capacity = 2`; class **K** with `capacity = 3` (override wins), class
**L** with `capacity = NULL` (inherits 2), class **U** in a category with no default (unlimited).
Suggested cases (≈20 after the 08-20 review):

| # | Case | Expect |
|---|---|---|
| 1–2 | K: 3 enrolments insert; the 4th | ok ×3; **throws** `K is full (3 of 3)` |
| 3 | L: 2 enrolments, the 3rd | throws `(2 of 2)` — the category default applies |
| 4 | U: 10 enrolments | all ok — unlimited |
| 5 | K at 3/3: insert a **closed span** (`is_active = FALSE`, `enrolled_at = unenrolled_at`) | ok — no seat taken |
| 6 | K at 3/3: close one (`close_student_enrolment`), insert another | ok — the seat freed |
| 7 | K at 3/3: `UPDATE … SET is_active = TRUE` on the closed row | throws |
| 8 | K at 3/3: a duplicate active enrolment of a child already in K | throws the **unique index**, not "full" (order of guards) |
| 9 | `book_makeup` into K on a date where all 3 spans cover | throws `K is full on DD Mon YYYY (3 of 3)` |
| 10 | `book_makeup` into K on a date **before** one child's `enrolled_at` (span, not `is_active`) | ok |
| 11 | L at 1 enrolled + 1 make-up guest on date D: a second guest on D | throws `(2 of 2)` — a guest counts |
| 12 | cancel that guest (`cancel_makeup_booking`), rebook | ok — a cancelled guest frees the seat |
| 13 | child already booked into a full K on D, booked again | throws "already booked", **not** "full" |
| 14 | `book_trial` into a full L | throws |
| 15 | as a **coach** role: `book_makeup`, `book_trial`, direct INSERT into `student_class_enrolments` | all refused — Decision 4 (corrected): the **direct** paths are admin-only, asserted |
| 16 | `add_unclaimed_student(… 'enrol' …)` into a full K, **run as the class's own coach** (`c.coach_id = current_coach_id()`, `20260725000800:231–237`) and again as the admin | throws `K is full` through the definer path both times — the coach arm is a real enrolment writer, and this is the only place it is covered |
| 17 | one `INSERT … VALUES` of 4 rows into an empty K (cap 3); then one statement of exactly 3 rows | throws `(3 of 3)`; lives_ok — same-statement rows are counted (RISK 1) |
| 18 | K at 3/3: `UPDATE classes SET capacity = 2` · a 4th enrolment · `SET capacity = 5` · the same enrolment | lives_ok · throws `(3 of 2)` · lives_ok · lives_ok — the escape hatch (RISK 1 / RISK 6) |
| 19 | K at 3/3, one child closed today (`close_student_enrolment` → `unenrolled_at = now()`): a new enrolment; then `book_makeup` into K **today** | lives_ok (2 active); **throws** `(3 of 3)` — the closed child still covers today by span (RISK 6, the asymmetry Decision 3 chose, pinned so it is never "fixed" by accident) |
| 20 | a guest booked into L (cap 2, 1 enrolled) next Monday; then a 2nd permanent enrolment into L | lives_ok — a future guest does not block a roster seat; `class_expected_count(L, next Monday)` then reads **3** and a further guest that day throws `(3 of 2)` (RISK 6) |

**§7.25:** run the file against the pre-B1 database first — cases 2, 3, 7, 9, 11, 14, 16, 17 must
be red. Then apply B1 and run twice. **Case 8 must additionally be seen red against a trigger
built WITHOUT the `e.student_id <> NEW.student_id` term** — comment it out, `db reset`, run,
restore; that run is the proof the RISK 1 fix exists (keep its output in the commit message).

⚠ RISK 6 MITIGATION (verified — no contradictory refusal the admin cannot escape): enrolments
count `is_active`, bookings count by span on the date; the two can disagree by exactly the set of
children closed today (case 19) and by future guests (case 20), and in both directions the number
the database refuses on is the number the page the admin is looking at shows (the lesson page
folds the category default in — `lessons/[classId]/[date]/page.tsx:179` — so Decision 3's parity
promise holds there too). The escape is always `UPDATE classes SET capacity`, which no trigger
refuses (case 18). NAMED PROHIBITION: do NOT add a trigger on `classes.capacity` /
`class_categories.default_capacity` that refuses a value below the current roster — that would
be the first refusal without an exit.

Also re-run `supabase/tests/table_grants.test.sql` explicitly — it must not move (no table
privilege changed; the two helpers are functions).

### B3. Land the migration

`supabase db reset` → `supabase test db` → merge → push → `supabase db push` → `supabase
migration list --linked` → **grant dump** (`docs/DEPLOYMENT.md` §11.7; two new functions with
explicit REVOKEs — local and cloud disagree by construction, §7.39, §7.89; confirm `anon` and
`authenticated` hold no EXECUTE on either helper). Engine (`core.ts`) is untouched — nothing to
deploy there; say so in the commit.

⚠ RISK 7 MITIGATION (assertion, before `db push`): the B1 apply-time `DO` block (RISK 2) passed
on local `db reset` — it is the same probe that will run against production, so a local pass is
the dry run. After `db push`, the grant dump diffed against the previous one shows **exactly** two
new rows (the helpers, no grantee) and **zero** changes to `book_makeup` / `book_trial` /
`mark_day_holiday`. Any other moved row is a blocker, not a note.

### B4. Admin app — the lesson page

`SwimSyncAdmin/app/(admin)/lessons/[classId]/[date]/page.tsx`:

1. Delete the `bookConfirmFull` state, the `if (full) setBookConfirmFull(true); else …` branch
   (L412 → `void doBook();`), and the whole "This lesson is full" `<Modal>` (L709–721).
2. Keep `full` (L301) and `isFull()` — they still drive the red FULL chip and the count. Add one
   inline line under the Book button when `full`: *"This lesson is full ({countText}). The
   database will refuse a booking; raise the class's maximum on the Classes page to add one."*
   Leave the Book button **enabled** — the RPC is the guard (§7.32), the UI is the hint, and a
   disabled button would hide the refusal sentence the database was written to produce.
3. The footer sentence (L723–725) lists what "the database enforces and cannot be overridden
   here" — add "capacity".
4. Students / Unassigned / Trials pages: **no change required** — each already renders the
   insert's `error.message` as-is (`trials/page.tsx:329–332` even names the §8.43 trigger as the
   reason). *Optional, only if under 20 min:* append " — full" to a class option in those three
   `<select>`s where the page already holds the active-enrolment count (the Classes page does;
   the others would need a query — skip if so).

`npm run typecheck` and `npm test` in `SwimSyncAdmin`. No vitest change is required by the
removal; if a unit test names `book-anyway` or `bookConfirmFull`, it goes.

### B5. Driver `verify-admin-lesson-detail.mjs` (25 → 26 checks)

L156–170 currently books Delta into the full Rose lesson via "Book anyway" and asserts `3+1/3`.
Rewrite that block:

1. Rose reads `3/3` (unchanged).
2. Open *Book a make-up*, choose Delta, click `book-guest` → assert the refusal sentence
   (`/Rose .* is full on .* \(3 of 3\)/`) renders in the modal's error slot, the roster has no
   Delta row, and the count is still `3/3`. **This check must fail on the pre-B1 DB**: run the
   driver once against a checkout at `8eb4474`'s schema to see it red (cheap: the fixture reset
   does the work).
3. Raise Rose's maximum in-driver (`UPDATE classes SET capacity = 4 WHERE id = …` through the
   driver's existing `sql()` helper — `verify-admin-lesson-detail.mjs:34–35`, `docker exec …
   psql -U postgres`, already used for the audit-row reads), reload, book Delta → the existing
   Make-up-chip and count checks follow with `3+1/4`.

   ⚠ RISK 4 MITIGATION — **the plan's original claim here was wrong and is replaced.** It said
   "the fixture is re-applied per run, so `verify-admin-calendar`'s `3/3 · FULL` assertion is
   unaffected". `fixtures-admin-calendar.sql:36–50` inserts the classes with `ON CONFLICT (id) DO
   NOTHING`, so a re-load does **not** restore `capacity`; only `supabase db reset` does.
   `run-all-drivers.sh:218` resets per driver, so the nightly is safe, but any manual
   `verify-admin-calendar` after `verify-admin-lesson-detail` without a reset reads Rose as
   `3/4` and check 71 (`/3\/3/ && /FULL/`) fails. Two structural fixes, both required:
   - STEP (fixture): after the class INSERT in `fixtures-admin-calendar.sql`, add
     `UPDATE classes SET capacity = 3 WHERE id = 'ca1c1a55-…0001';` (or change the conflict
     clause to `DO UPDATE SET capacity = EXCLUDED.capacity`) so a re-load restores the number the
     calendar driver asserts on. ASSERTION: the fixture's trailing SELECT gains a `rose_cap`
     column that must read `3`.
   - STEP (driver): restore `capacity = 3` in the driver's `finally` block, before
     `browser.close()`, so a crashed run does not leave the column moved. ASSERTION: the driver's
     final psql read of Rose's capacity is `3`.
   - NOTE (status quo, not new): the driver header says "RE-LOAD between runs" but Delta's booking
     and the attendance rows it writes are not removed by a re-load either; a re-run already
     needs a reset. Say so in the header (L19–21) while you are in it.
4. Update the header comment (L15) and `docs/TESTING.md` §5 L530 (count + the RISK 3 wording).

Then `app` → `main` → push → **grep the served bundle** for the new inline sentence (§7.31,
§7.51); a 200 proves nothing.

---

## Phase C — the Lessons "needs marking" badge (≈2–3 hrs)

Branch `db/tenant-unmarked-lesson-count` in the root checkout for C1–C2; app on any branch after.

### C1. Migration `supabase/migrations/20260820000300_tenant_unmarked_lesson_count.sql`

```sql
CREATE FUNCTION public.tenant_unmarked_lesson_count(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ … $$;
REVOKE ALL ON FUNCTION public.tenant_unmarked_lesson_count(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_unmarked_lesson_count(uuid) TO authenticated;
```

Shell: `unbilled_sealed_lessons` (`20260812000400:47–105`) — tenant is a **parameter**, the gate is
`IF NOT (is_platform_admin() OR can_admin_tenant(p_tenant)) THEN RAISE …` (load-bearing under
SECURITY DEFINER, its header L42–45), grants §7.87-style at the bottom, header explaining why
`anon` gets nothing (§7.39). Return a scalar, not a table — the Sidebar only needs a number.

Body: `class_unmarked_lesson_dates` (`20260809000300:97–166`) generalised to a tenant, **with
the page's three extra rules** so the badge equals `/lessons?mode=needs` (Decision 6):

- **Window:** `markable_floor(p_tenant)` … `today_sg()` (the page: `markableWindowStart(today,
  floor)` → today, `lessons/page.tsx:92–95`).
- **Candidate dates per class:** weekday `generate_series` **∪** actual `lesson_sessions` rows in
  the window (off-weekday extras) — as `20260809000300:117–128`.
- **Retired classes (new vs. the model):** skip a *pattern* date `>= (deactivated_at AT TIME
  ZONE 'Asia/Singapore')::date` unless a session row exists for it — `calendarLessons.ts:337,
  347`, byte for byte in spirit. (Yes, this is the exclusive reading Phase A's note discusses.
  The badge mirrors the page; the page's reading is a separate, filed question.)
- **Expected:** the union (SGT spans inclusive + uncancelled trials + uncancelled make-ups).
  Zero expected → not a lesson (`progress = "no-students"`).
- **Ended:** `session_date < today_sg() OR (session_date = today_sg() AND end_time <= (now() AT
  TIME ZONE 'Asia/Singapore')::time)`, where `end_time` is the session row's if one exists, else
  the class's (`hasEnded`, `calendarLessons.ts:383`). A not-yet-ended lesson today is
  `"upcoming"`, never counted.
- **Unmarked or partial:** at least one expected student with **no attendance row** for that
  `(class, date)`. Row presence, not status — `countMarked` L379. A fully voided day has a row
  per student and is therefore *not* counted, which matches the page's `"holiday"` branch
  without special-casing it.
- Count `DISTINCT (class_id, session_date)`.

**Do not modify `class_unmarked_lesson_dates()`** — it guards `deactivate_class()` and is
ungranted on purpose. Two SQL copies of one union is §7.18's shape; the C3 driver check is the
pin.

⚠ RISK 5 MITIGATION — parity and cost, verified against the page's loader and the floor:
- **All classes, retired included.** `calendarData.ts:38–42` loads `classes` with **no
  `is_active` filter**, so the page's count includes a retired class's session-row dates. The SQL
  must scan every class of the tenant too — NAMED PROHIBITION: do NOT add `WHERE c.is_active`
  "for speed"; that is the drift the C3 pin exists to catch, and it would hide a retired class's
  unmarked extra lesson from the badge while the page lists it.
- **Window.** The page's `markableWindowStart(today, floor)` is
  `min(serverFloor, 1st of last month)` (`lessonDates.ts:232–233`), and `markable_floor()` is
  already `LEAST(session_window_start(), …)` (`20260806000200:80–104`), so the SQL window is
  simply `markable_floor(p_tenant) … today_sg()`. Note the floor reaches back to **`tenants.
  created_at`** for a business that has never sealed a month — a year-old unbilled tenant scans a
  year. STEP (structural): generate the weekday series with a **7-day step** from the first
  matching weekday on or after the floor, not a daily series filtered by `EXTRACT(DOW)` —
  one-seventh of the rows, same set. ASSERTION: `EXPLAIN (ANALYZE, BUFFERS)` on the local seed
  tenant plus the `fixtures-admin-calendar.sql` classes reports **< 50 ms**; record the number in
  the migration header. If it cannot be met, the Sidebar still renders — the RPC is in a
  `useEffect` and never blocks paint — but say so.
- **Clock.** "Ended" is the server's `now()` in SGT; the page uses the browser's
  `nowMinutesInSg()`. They agree to the second on a correct clock and can disagree across a
  lesson's `end_time` on a skewed one. That is a flake window in the C3 pin, not a bug: the driver
  must read the badge and the page within one navigation and the fixture lessons end at 11:00 and
  11:30 SGT — ASSERTION in the driver: if the SGT time is within ±2 minutes of a fixture lesson's
  `end_time`, `waitForTimeout` past it before comparing, and log that it did.
- **Fail-safe read.** The Sidebar handler is `({ data, error }) => setNeedsMarking(error ? 0 :
  Number(data ?? 0))` — an authorisation RAISE (a coach who somehow reaches the admin panel, a
  platform admin with a stale `tenant_id`) renders **no badge**, never a crash and never `NaN`.

DOWN file: `DROP FUNCTION`. Run it, re-apply.

### C2. pgTAP — new `supabase/tests/tenant_unmarked_lesson_count.test.sql` (≈12)

Fixture shell from `holiday_day_rpc.test.sql` (it already has admin + parent + stranger users and a
Monday class). Cases: stranger refused · other tenant's admin refused · coach refused
(`can_admin_tenant` false) · platform admin allowed · a past lesson with 1 expected and no rows
→ 1 · partial (2 expected, 1 row) → 1 · fully marked → 0 · fully `'holiday'` → 0 · guest-only
lesson (trial booking, no enrolments) → 1 · today's lesson with `end_time = '23:59'` → 0 (not
ended; accept the 23:59:xx flake and say so in the header) · a date before `markable_floor`
→ 0 (seal a month the way `markable_floor.test.sql` does) · a class retired with an unmarked
pattern date after its SGT retirement date → 0, but the same date **with** a session row → 1.

§7.25: the whole file is red before C1 (the function does not exist) — that is sufficient proof
for a new function; say so in the commit.

### C3. Sidebar + driver

`SwimSyncAdmin/components/Sidebar.tsx`:

1. A third `useEffect` in the shape of L75–81 (`[pathname, tenantId]`, skip when `!tenantId`):
   `supabase.rpc("tenant_unmarked_lesson_count", { p_tenant: tenantId }).then(({ data }) =>
   setNeedsMarking(Number(data ?? 0)))`.
2. `badges["/lessons"] = needsMarking` (L150–155 — "Extend this map (not the JSX)"). The group
   header bubbling (L218–222, L251) is automatic.
3. `badgeTitle` (L26–35) gets a branch: `` `${count} lesson${count === 1 ? "" : "s"} below today
   still need${count === 1 ? "s" : ""} marking` ``. Without it the tooltip falls through to a
   bare number.
4. Amber is already the badge colour (L190, L249). Nothing to style.

`adminNav.ts` needs no change (the href `/lessons` is the key). `npm run typecheck`, `npm test`.

**Driver pin (the §7.18 guard):** add one check to `verify-admin-lesson-detail.mjs` (it already
has unmarked fixture lessons): read the sidebar badge on `/lessons`, then open
`/lessons?mode=needs` and count rows — **equal**. Also assert the `Needs marking (N)` tab label
shows the same N. If they ever disagree, the SQL copy drifted from the TS copy; that is the
failure this check exists to catch.

⚠ RISK 5 MITIGATION (corrected step): the `(N)` suffix renders **only in week mode** —
`lessons/page.tsx:151` is `` {mode === "week" && needsCount > 0 ? ` (${needsCount})` : ""} `` —
so read the label on `/lessons` (default week view), not on `?mode=needs` where it is bare
"Needs marking". Run the pin **before** the driver's own marking steps, or after them with a fresh
badge read — the driver's saves change N mid-run, and a pin that compares a pre-save badge with a
post-save page is a false red. ASSERTION: `badge === needsTabN === needsRowCount`, all three read
after the same navigation, and **N ≥ 1** (the fixture's partial Rose lesson guarantees it — a
pin that passes on `0 === 0` proves nothing, §7.17). STEP (§7.25 for the pin itself): once green,
temporarily change the SQL's `OR` in the "ended" predicate to `AND`, `db reset`, run the driver
— the pin must go red; restore. Keep that output in the commit.

Deploy: migration → `db push` → `migration list --linked` → grant dump (a new granted function)
→ app to `main` → served-bundle grep for the new tooltip sentence.

---

## Verification matrix (run it, do not tick it)

| Phase | Command | Must show |
|---|---|---|
| A, B, C | `supabase test db` (after `supabase db reset`) | all green, **and** the new cases were seen red first (§7.25) |
| B | `supabase/functions/generate-invoices/test.sh` ×2 | unchanged — `core.ts` not touched; the run is the proof that the expected-set union still agrees (`attendanceCompleteness.ts` is byte-identical in three places and a test enforces it — **you did not edit it**) |
| B, C | `cd SwimSyncAdmin && npm run typecheck && npm test` | green |
| B | `verify-admin-lesson-detail.mjs` 26/26 · `verify-admin-calendar.mjs` 21/21 · `verify-makeups.mjs` · `verify-trials.mjs` · `verify-multi-class.mjs` | green (the last three book into seed classes with **no** capacity — verified 2026-08-20: `seed.sql` sets no `capacity`/`default_capacity` anywhere, and of every file under `supabase/tests/` and `drivers/*.sql` only `class_capacity_colour.test.sql` (no enrolments) and `fixtures-admin-calendar.sql` (Rose exactly at 3/3, one statement — B2 case 17) touch it) |
| B | `verify-admin-calendar.mjs` run **immediately after** `verify-admin-lesson-detail.mjs` with only a fixture re-load, no reset | check 71 `3/3 · FULL` still green (RISK 4 — proves the capacity restore) |
| B | B2 case 8 against the trigger **without** `e.student_id <> NEW.student_id` | red with `/is full/` (RISK 1 — the fix is proven to exist) |
| C | `verify-admin-lesson-detail.mjs` +1 | badge == tab N == page rows, N ≥ 1; red once under the deliberate `OR`→`AND` break (RISK 5) |
| B, C | grant dump diffed against the previous one | only the expected rows moved |
| all | `supabase migration list --linked` | three new rows, `remote` filled |

Nightly: the following morning's `gh run list --workflow=ui-drivers.yml` is the fact (§9).

---

## Documents to reconcile at close (`/update-docs`)

- **PRD** §7.3 L775–779 ("informational … nothing refuses an enrolment or a booking on it") and
  §7.22 L1158–1160 ("Book anyway … no RPC refuses on capacity") → *enforced*; L2527 (the count
  is now also the guard's number); the column table L2679 "Informational only" → enforced; §7.6
  gets the badge sentence; §7.16/§7.22 holiday text gets "by its SGT retirement date, inclusive".
- **BACKLOG**: delete the three items (`:1193–1228`); in *Parent self-enrolment* (`:1082–1085`,
  `:434`) replace "needs capacity as a HARD limit" with "capacity is enforced since 2026-08-20 —
  `class_expected_count()` / `enforce_class_capacity()`; a self-enrol RPC calls the first and
  is covered by the second". File **two new items from the 08-20 review**: *(i)* a class can be
  retired by a raw PostgREST `UPDATE classes SET is_active = false, deactivated_at = now()`
  (`classes_write` is `FOR ALL`; the CHECK is satisfied), bypassing `deactivate_class()`'s three
  refusals — the `20260810000100` header's "a raw UPDATE cannot supply the date" is wrong; *(ii)*
  the class's own coach can enrol a brand-new child through `add_unclaimed_student(… 'enrol' …)`
  — a product question ("coaches must not add students" is not the status quo on that path).
- **`docs/plans/ADMIN_CALENDAR_PLAN.md`** RISK 3: append one dated line — *superseded 2026-08-20,
  this plan, Decision 1*. Do not edit the original text.
- **GOTCHAS**: five candidates, numbered after whatever is current (§7.193 today): *(a)* a
  timestamptz boundary has **two** axes — timezone and inclusivity — and the retirement
  predicate had drifted on both while its enrolment predicate six lines away was right;
  *(b)* a count a page displays and a rule the database enforces must be the same query or
  pinned by a test that compares them (the C3 check); *(c)* **a BEFORE ROW trigger that counts
  rows runs BEFORE the unique index, so it must exclude the conflict key itself or it reports the
  wrong refusal** — `enforce_enrolment_schedule` learned it in 2026-08-11 as a comment and the
  capacity trigger was about to re-learn it (RISK 1; promote the comment to a gotcha); *(d)* a
  fixture written with `ON CONFLICT … DO NOTHING` does **not** restore a column a driver mutated
  — a driver that writes to fixture rows must restore them in `finally`, and the fixture must
  re-assert the value (RISK 4); *(e)* **before writing a test for a "reachable" state, walk the
  guards that would have to let it through** — `deactivate_class()`'s three refusals made the
  plan's Phase A scenario unreachable, and a test pinning an unreachable state passes while
  proving nothing about the product (RISK 3; §7.17's shape on the fixture side).
- **TESTING §5**: rows for the two new pgTAP files, the holiday file's new count, the driver's
  26 + 1.
- **DEPLOYMENT §11.31**: three migrations, one at a time, two grant dumps, no engine deploy.
- **HANDOVER**: §3 row *"Capacity is a DB rule — bookings by date, enrolments by roster, admin
  included, no override"* (pay for it by deleting one — it is 43,283 B against 45,000); §9's
  follow-up list loses three bullets. Fix the "§7.1–§7.192" in the *Where everything lives*
  table while there.

---

## Pre-commit gate (walk it per phase; a box that cannot be ticked is a blocker)

**Highest value — these three found real errors in the plan and each has a red-run proof:**

- [ ] **RISK 1** — B2 case 8 seen **red** (`/is full/`) against the trigger without
      `e.student_id <> NEW.student_id`, then **23505** with it; case 17 (cap+1 rows in one
      statement) throws, exactly-cap lives. Output in the commit message.
- [ ] **RISK 3** — A2 case 9 seen red with the guest's row still `'present'` under the old
      predicate, green as `'holiday'` with the package extended under the new one; case 10's empty
      session has 0 attendance rows and `unmark_day_holiday` removes it.
- [ ] **RISK 4** — `verify-admin-calendar.mjs` check 71 green when run straight after
      `verify-admin-lesson-detail.mjs` with a fixture re-load and **no** reset; the fixture's
      trailing SELECT reads `rose_cap = 3`; the driver's `finally` restores it.

**The rest:**

- [ ] **RISK 2** — `pg_get_functiondef` captured before, diffed after: only the block, the
      `DECLARE`, the COMMENT moved; `pg_proc` holds **one** `book_makeup` and **one** `book_trial`;
      `pg_get_function_arguments` ends `DEFAULT NULL`; the apply-time `DO` probes passed on reset.
- [ ] **RISK 5** — C3 pin: `badge === tab N === rows`, N ≥ 1, label read in **week** mode; seen
      red under the deliberate `OR`→`AND` break; `EXPLAIN ANALYZE` < 50 ms recorded in the header;
      no `WHERE c.is_active` in the badge SQL; Sidebar handler is `error ? 0 : Number(data ?? 0)`.
- [ ] **RISK 6** — B2 cases 18, 19, 20 green (escape hatch, closed-today asymmetry, future guest);
      no trigger added on `classes.capacity` / `default_capacity`.
- [ ] **RISK 7** — `table_grants.test.sql` and `function_grants.test.sql` unchanged and green;
      Phase A's `DO` probe passed; the post-push grant dump diff shows exactly the expected rows
      (A: none; B: two helper rows with no grantee; C: one row, `authenticated` only).
- [ ] **RISK 8** — neither helper is called from the trigger; the trigger function is not marked
      STABLE; both helpers carry `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`.
- [ ] Decision 4 as corrected: B2 case 16 run **as the coach** through `add_unclaimed_student`;
      the coach-enrol product question and the raw-UPDATE retirement path are both in `BACKLOG.md`.
- [ ] Every new pgTAP case listed in the §7.25 lines above was seen red first, and the red output
      is in the commit message — "it passes" is not the claim.
