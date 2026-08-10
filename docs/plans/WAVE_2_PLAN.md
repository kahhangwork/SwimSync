# Wave 2 — Multiple classes per child

_Planned 2026-08-10. Decisions settled with the user the same day. **Risk-reviewed the same
day by an independent agent; every `⚠ RISK n MITIGATION` below is a finding folded into the
step it governs.** Mitigations are inline on purpose — a trailing Risks section is read once
at planning time and never again._

Let one student hold **more than one active enrolment**. Drops
`one_active_enrolment_per_student`, the single largest retrofit tax in `BACKLOG.md` —
every enrolment-shaped surface built after this inherits the new model.

**One branch, one migration, one merge.** Order inside it is DB → prove → apps, so no UI
depends on an unproven RPC.

**Estimate: a full working day + ~2h** for the mitigations below (~3.5h DB + pgTAP,
~2h admin UI, ~1h parent app, ~2.5h driver + fixture re-proof).

---

## Decisions (settled 2026-08-10 — do not re-litigate)

| Question | Answer |
|---|---|
| Make-up "home class" with 2 enrolments | **Admin picks.** `book_makeup()` gains `p_home_class_id`; required only when the child has 2+ |
| Where does the admin add a second class? | **The Students page owns it** — chips + "Add class". Unassigned page keeps first assignment |
| Parent Home card with 2 classes | **Lists every class**, one day/time/coach line each |
| What does the DB refuse? | Duplicate same-class **and overlapping times** |
| Does the class-edit path refuse a clash too? | **Yes** — raises, naming the children |
| Scope | **All of it, one session, one branch** |

### `book_trial()` — SETTLED 2026-08-10: leave it alone

**`book_trial()` refuses a child with "an ACTIVE enrolment in ANY class"**
(`20260810000100_booking_guards.sql:150-157`, live body). Under multi-class that stops being
mechanically equivalent to "already a customer" and becomes a policy choice — a Group family
could in principle trial a Private class.

**The user's call: that will not happen in this business, so the refusal STANDS unchanged.**
**NAMED PROHIBITION:** *Do not touch `book_trial()` in this wave.* Nothing else here requires
it, and it is a money-adjacent guard. If the case ever appears, widening it is a separate
item for `BACKLOG.md`.

---

## What needs NO change — re-derived twice (author + reviewer). Do not re-check.

- **The invoice engine.** Enrolments are read `.eq("class_id", cls.id)` (`core.ts:580-583`),
  spans built per class (`:590-596`), the gate calls `expectedStudentsOn` inside the class
  loop (`:772`), and `isGuest`/`priceFor` compare against that class's spans only
  (`:885-903`, `:939-944`). `invoice_items` has **no** unique constraint
  (`20260309000100_initial_schema.sql:183-192`), so two same-date lines from two classes
  insert cleanly; items sort at `core.ts:1163-1168`.
  **`BACKLOG.md`'s "reworks `expectedStudentsOn()`" is STALE.**
- **`classCoverage.ts`** — per class (`:97-111`); `invoices/page.tsx:265-273` fetches all
  enrolments for all class ids.
- **The coach Schedule tab** — enrolments embedded per class (`schedule/index.tsx:306-319`),
  spans built per class (`:438-447`).
- **RLS on enrolments needs no change.** `enrolments_select` / `enrolments_write`
  (`20260718000900_tenant_rls.sql:350-360`) are keyed per `class_id` and widen correctly.
  Stated explicitly because the instinct is to touch them. **The real RLS risk is a
  function, not a policy — see RISK 4.**
- **`student_package_coverage()`** — the `'mixed'` arm is real and now reachable
  (`20260801000200:72-78, 101-106`). Note `cats` is `DISTINCT (student_id, category_id)`,
  so **two classes in the same category still yield `n_cats = 1`** — the common case.
- **`merge_students()`** — deletes the duplicate's enrolments (`20260802000500:239`).
- **`PackageChip.tsx` / `PackageBadge.tsx`** — already branch on `'mixed'`.

---

## Step 1 — The migration

Root checkout, branch `db/multi-class`. One file:
`supabase/migrations/20260811000100_multiple_classes_per_child.sql`.

### 1.1 The indexes

```sql
DROP INDEX one_active_enrolment_per_student;
CREATE UNIQUE INDEX one_active_enrolment_per_student_class
  ON student_class_enrolments (student_id, class_id) WHERE is_active;
```

### 1.2 The overlap trigger

> **⚠ RISK 5 MITIGATION — invert the `is_active` exemption; do not exempt the OTHER class.**
> The naive form ("skip the check if either class is inactive") is breakable and cannot be
> patched where you'd want to patch it. `deactivate_class` refusal 1
> (`20260809000300_class_deactivation.sql:239-251`) only guarantees no open enrolments **at
> the moment of retirement**; `enrolments_write` has no `is_active` predicate on the class,
> so one can be added afterwards — and then `reactivate_class()` restores the class and
> **takes no refusals by standing prohibition** (`20260809000300:313-318`, `HANDOVER.md` §3).
> The overlap would exist with nothing having objected.
>
> Build it the other way instead:
> 1. Refuse a **new or reactivated enrolment whose own class is inactive**.
> 2. Compute overlap against the child's other **active enrolments**, *without* consulting
>    the other class's `is_active`.
>
> An inactive class then provably holds zero active enrolments, so `reactivate_class()` can
> never introduce an overlap and needs no refusal. **Structural, not vigilance.**
>
> **NAMED PROHIBITION:** *Do NOT add an `is_active` check on the counterparty class, and do
> NOT add a refusal to `reactivate_class()`.*

> **⚠ RISK 5b MITIGATION — the trigger function must be `SECURITY DEFINER SET search_path =
> public`.** A plain trigger function runs under the caller's RLS, and `enrolments_select`
> (`20260718000900:350-356`) can hide a sibling enrolment from the caller. A hidden row means
> the overlap check **silently passes** — the exact failure this trigger exists to prevent.

> **⚠ RISK 5c MITIGATION — gate it `WHEN (NEW.is_active)`.** `set_students_active`'s bulk
> `UPDATE … SET is_active = FALSE` (`20260719001200:105-107`) must never enter the check.
> **ASSERTION: deactivating a family with two enrolled children succeeds and closes 2+ rows.
> PASS = no exception. FAIL = anything raised.**

Overlap predicate: same `day_of_week`, `start < other.end AND other.start < end`,
`e2.id <> NEW.id`. §7.57 applies — a `BEFORE INSERT` trigger also fires for rows an
`.upsert()` resolves to an UPDATE; `e2.id <> NEW.id` covers it. Fire `BEFORE INSERT OR UPDATE`.

### 1.3 `close_student_enrolment` — three args, **no default**

> **⚠ RISK 3 MITIGATION — do NOT give `p_class_id` a default.** The original plan had
> `DEFAULT NULL` meaning "close every class", which makes the **dangerous value the
> default**, and the plan's justification for it was **factually wrong**: it claimed
> `set_students_active` needs the delegation, but `set_students_active` does that `UPDATE`
> **inline** at `20260719001200:105-107` and never calls this function. The delegation runs
> the other way (`:230-233`).
>
> Signature: `close_student_enrolment(p_student_id UUID, p_set_inactive BOOLEAN, p_class_id UUID)`
> — **no default**. Every call site then fails to resolve until it supplies a class.
> **Structural: a forgotten argument becomes an error, not a silent mass-unenrolment.**

`DROP FUNCTION public.close_student_enrolment(UUID, BOOLEAN);` first — a 3-arg overload
beside the 2-arg one makes every existing call **ambiguous**. Then create, then
re-`GRANT EXECUTE` (§7.87 — a re-created function is callable by nobody).

`assignment_status = 'unassigned'` **only when no active enrolment remains.**

> **⚠ RISK 4 MITIGATION — `coach_serves_student()` must not authorize a per-class close.**
> It returns true if the coach owns **any** class the child is actively in
> (`20260802000300_booking_visibility.sql:33-47`). That was sound only while "any" meant
> "the one". With `p_class_id`, **coach X can pass coach Y's class id and remove the child
> from Y's roster** — a cross-coach write RLS never sees, because the function is
> `SECURITY DEFINER`. Coaches reach enrolments *exclusively* through this RPC
> (`enrolments_write` is admin-only, `20260718000900:358-360`), so this is the whole
> coach-side attack surface.
>
> **NAMED PROHIBITION:** *For a non-admin caller the check is `coach_owns_class(p_class_id)`.
> `coach_serves_student()` may authorize only the whole-student path.*
> **ASSERTION (pgTAP): coach X calling with coach Y's class id raises. PASS = `not
> permitted`. FAIL = the row closes.**

### 1.4 `book_makeup` — **DROP the old signature first**

> **⚠ RISK 1 MITIGATION — the highest-blast-radius finding in this review.** The live
> signature is `book_makeup(p_class_id uuid, p_session_date date, p_student_id uuid)`
> (`20260806000200_markable_floor.sql:374`). `CREATE OR REPLACE` with a fourth defaulted
> param does **not** replace it — it creates a second function beside it, and PostgREST
> (called by name at `makeups/page.tsx:283-287`) resolves to the surviving exact match. The
> **old body then still runs**, and its `SELECT … INTO` over a now-multi-row enrolment set
> takes an **arbitrary** row with no `ORDER BY` and no error
> (`20260806000200:428-435` — its own comment says the dropped index is what made it
> deterministic).
>
> Both derived values are snapshotted onto the booking and **both are money**:
> `home_class_id` prices the make-up line (`core.ts:896-901` via `rateOn`), and
> `category_id` decides package coverage (`core.ts:1205`). Wrong either way = a wrong
> amount on an invoice, unrecoverable once the month seals.
>
> **STEP:** `DROP FUNCTION public.book_makeup(UUID, DATE, UUID);` before creating the 4-arg
> version — exactly as 1.3 does.
> **STEP:** in the new body's "exactly 1 enrolment" arm use `SELECT … INTO STRICT`, so a
> second matching row raises instead of being picked. **Structural.**

Resolution: 0 enrolments → today's refusal; exactly 1 → derive (`INTO STRICT`) and ignore
the param; 2+ with NULL → refuse *"which class is this a make-up for?"*; 2+ with a value →
validate it is an active enrolment of that child.

> **⚠ RISK 2 MITIGATION — widen the "own class" refusal.** Today it refuses only
> `v_home_class = p_class_id` (`20260806000200:443-446`). That refusal was written to mean
> *"your own class is an extra lesson, not a make-up"* — it covers **every** class the child
> attends only **by coincidence of the dropped constraint**, not by design (its own preceding
> comment at `:428-430` says so). After this wave it covers only the class the admin picked.
> With home = A, booking the child as a guest into **B, their other active class**, sails
> through — and B is the *likeliest* pick, because the host list is filtered to the same
> category (`makeups/page.tsx:227`) and a keen swimmer's two classes usually share one.
>
> **This is a PRODUCT-INTEGRITY failure, not a money one — do not mis-rank it.** Billing
> stays correct: on B's date the child is a member, so `core.ts:940-944` sets
> `isGuest = false` and prices the line at B's own rate under B's own title — the
> enrolment-wins arm anticipates exactly this (`core.ts:888-890`). `expectedStudentsOn`
> unions through a `Set` (`attendanceCompleteness.ts:187`), so the month cannot double-block
> either.
>
> The harm is that **the make-up is silently void**: the child attends the lesson they were
> already attending, gets nothing replacing the missed one, and the Makeups page reports the
> booking as arranged. The invoice looks right, which is why nobody catches it. Second-order,
> the void booking persists and `deactivate_class`'s booking refusal later reads it, refusing
> to retire a class over a booking that never meant anything.
>
> **STEP:** refuse when `EXISTS (SELECT 1 FROM student_class_enrolments WHERE student_id =
> p_student_id AND class_id = p_class_id AND is_active)`.
> **STEP:** reword the message — *"that is ONE OF the child's own classes — a make-up is a
> guest slot in a class they are NOT in. Schedule an 'Extra lesson' on the Classes page
> instead."* The old wording reads as "you picked the wrong home class" when the admin picked
> home correctly and host wrongly.
> **STEP (UI half):** widen `makeups/page.tsx:227` from `c.id !== kid.home_class_id` to
> "excludes **every** active class of this child". **No new UI is needed** — the empty-host
> panel at `makeups/page.tsx:483` already exists and already routes to Extra lesson; it was
> written for the private-coach shape and now also catches "already in every class of this
> kind". Only its sentence needs a multi-class variant.
> **ASSERTION (pgTAP): `book_makeup(B, <date>, kid_in_A_and_B, home := A)` raises. PASS =
> raises. FAIL = returns a uuid.** Prove it red against the un-widened refusal first (§7.25).
>
> **No backfill.** Production holds zero live make-up bookings (`HANDOVER.md` §3, DORMANT)
> and zero two-class children, so this guard ships before the state it prevents can exist —
> the same position §8.40's booking block shipped from.
>
> **⚠ WHAT THIS FIX REVEALS — file it, do not absorb it.** `schedule_extra_lesson(class_id,
> date, reason)` is **class-wide**: every enrolled child is then expected at the extra
> session. It is not a per-child make-up. So for a two-class child in a business whose only
> two same-category classes are the ones they are in, there is **no per-child remedy** for a
> missed lesson — only a whole-class extra lesson, or marking the miss non-billable. The
> refusal does not create that gap; the dropped constraint was hiding it.
> **STEP: add it to `BACKLOG.md` as its own item during this wave.** It is not in scope here.

> **⚠ RISK 6 MITIGATION — grant the NEW signature explicitly.** A changed signature is a new
> `pg_proc` row: callable by **nobody** locally and, historically, by everyone on cloud
> (`20260804000700_authenticated_function_defaults.sql:16-30` documents the split).
> `function_grants.test.sql` cannot catch it — its own header says it "passes by
> construction" for the cloud half.
> **STEP:** `REVOKE ALL … FROM PUBLIC; REVOKE EXECUTE … FROM anon, service_role;
> GRANT EXECUTE … TO authenticated;` for the 4-arg form.
> **STEP:** `supabase/tests/makeup_bookings.test.sql:369` calls
> `has_function_privilege('anon','public.book_makeup(uuid,date,uuid)','EXECUTE')`. Once the
> 3-arg form is dropped this **errors and aborts the whole file** — update it in Step 2.
> **STEP:** `markable_floor.test.sql:287,295` call `book_makeup(...)` positionally with 3
> args — safe only because the new param is appended last. Keep it last.

### 1.5 The class-time clash — a trigger on `classes`, not a check in `set_class_terms`

> **⚠ RISK 9 MITIGATION — put it one layer down.** `set_class_terms`
> (`20260807000100_sgt_class_terms.sql:106-115`) is not the only writer: `classes_write`
> (`20260718000900:342-344`) still grants a tenant admin a bare
> `UPDATE classes SET start_time = …` over PostgREST. An RPC-level guard is a convention;
> a trigger is an invariant.
>
> **STEP:** `BEFORE UPDATE ON classes`, fired **only** when
> `day_of_week`/`start_time`/`end_time` change. `set_class_terms` inherits it free, the
> direct path is covered, and a price-only correction cannot deadlock.
> **NAMED PROHIBITION:** *This trigger must never fire on an `is_active` transition —
> `reactivate_class()` takes no refusals (`20260809000300:313-318`).*
> **STEP:** the exception message must **name the children AND the clashing class**, or the
> admin removes the child from the wrong one. Removal writes `unenrolled_at = NOW()`, which
> is a billing-relevant fact, not a free undo.

**Escape hatch, and it is real:** an admin blocked here clears it by removing the child from
one class on the Students page, which Step 3 builds. That is the lesson Wave 1's RISK 1
bought. **Verify the hatch is reachable before merging** — it is a pre-commit gate item.

### 1.6 Rollback

`supabase/rollback/20260811_multi_class_DOWN.sql`, **committed before deploy** (the
`20260804` pattern), and **rehearsed** — running the DOWN file is the half that finds the
bugs (§7.93). Restoring the old unique index will fail if any child holds two active
enrolments, so the DOWN file must close the newer enrolment first and say so out loud.

---

## Step 2 — pgTAP, before any UI

§7.25: each test must be proven to fail without the fix before it counts.

- `constraints.test.sql:78-82` — rewrite. Same class twice still `23505`; **two different
  non-overlapping classes now SUCCEEDS**; overlapping raises.
- `student_package_coverage.test.sql:187-195` — **delete the index pin, replace it with a
  real `'mixed'` assertion.** The pin exists to make this day loud; honouring it is the
  point. Move the stale "Kid M" comment at `:103` too.
  > **⚠ RISK 8b MITIGATION:** `'mixed'` needs a child in **two different categories**, which
  > the current fixture cannot express. **STEP: extend the fixture with a second category
  > before writing the assertion**, or the test passes vacuously — the failure mode this
  > whole step exists to avoid. Also assert the same-category case yields
  > `n_cats = 1` (not `'mixed'`), because that is the common shape.
- New: RISK 4's cross-coach refusal · RISK 2's own-class refusal · RISK 1's `INTO STRICT`
  path · RISK 5c's bulk-deactivate pass · `close_student_enrolment` per-class ·
  `assignment_status` stays `assigned` while one class remains · the `classes` trigger
  refusal plus the price-only pass-through.
- Update `makeup_bookings.test.sql:369` to the new signature (RISK 6).
- Fix the now-false comments at `class_deactivation.test.sql:27` and `20260809000300:87`.

Then `supabase test db`, then `supabase/functions/generate-invoices/test.sh` **twice**
(§7.15) to prove the engine is genuinely untouched.

> **ASSERTION: record the pgTAP count before and after. A count that DROPS means a test was
> lost, not that a constraint went away — the two are indistinguishable in a summary line.**

---

## Step 3 — Admin: the Students page owns enrolment

- `students/page.tsx:560` — `.find(e => e.is_active)` → map **all** active enrolments to
  chips: `[Mon 5pm ×] [Wed 5pm ×] [+ Add class]`.
- **`students/page.tsx:126` — `removeFromClass(supabase, student.id)`, the admin's own
  remove path, on this very page.** Must pass the chip's class id.
- Add-class modal reuses the Unassigned page's coach→class picker **and its live-trial
  warning** (`unassigned/page.tsx:185`).
  > **⚠ RISK 5d MITIGATION:** the class picker must filter `.eq("is_active", true)`. Per
  > §7.32 that filter is *an affordance, not the guard* — the guard is 1.2's refusal on an
  > inactive own class. Build both; neither substitutes for the other.
- Sort key becomes the first chip's title (§8.19); `verify-admin-table-geometry` checks the
  widened column.
- `makeups/page.tsx:170` — the eligible kid carries a **list** of home classes; the modal
  shows a home-class picker only when there is more than one.
  > **⚠ RISK 8c MITIGATION — two derived filters must be RECOMPUTED from the chosen home
  > class, not from a single stored one:** the host-class list
  > (`makeups/page.tsx:227`, `c.category_id === kid.home_category_id && c.id !== kid.home_class_id`)
  > and the package-expiry advisory (`:258`). The `c.id !== …` exclusion must exclude
  > **every** active class of the child, not just the chosen home (this is RISK 2's UI half).
- `trials/page.tsx:174` uses `.some()`. Correct as-is, no change.

> **⚠ RISK 3b MITIGATION — `lib/studentStatus.ts` is duplicated byte-for-byte across both
> apps** with an "EDIT BOTH" comment (`SwimSyncApp/lib/studentStatus.ts:10-13`) and, unlike
> `attendanceCompleteness.ts`, **has no drift test**. Vigilance is the only thing holding it.
> **STEP: add `studentStatus.ts` to a byte-identical drift test in this step**, modelled on
> `SwimSyncAdmin/lib/attendanceCompleteness.drift.test.ts`. Structural, and it outlives
> this wave.

---

## Step 4 — Parent app: the card lists every class

- `home/index.tsx:135` and `home/child/[id].tsx:119` — `.find()` → map all, one
  day/time/coach line each.
- **`attendance/index.tsx:173-178` fails QUIETLY, which is worse than the plan first said.**
  It is `.maybeSingle()`, which errors on two rows — and **the error is discarded**, so
  `enr` is `null` and `hasExpectedLesson` silently becomes `false`. The screen tells a
  two-class family *"no lessons yet"*. Becomes a multi-row read; `hasExpectedLesson` = any
  class has an expected date.
- Coach roster's "Remove from class" (`roster.tsx:489` → `SwimSyncApp/lib/studentStatus.ts:45`)
  must pass its class id. With 1.3's no-default signature this is now a **compile error if
  forgotten**, not a silent mass-unenrolment.

---

## Step 5 — Drivers, fixtures, and the guard this wave removes

New `verify-multi-class.mjs` + fixture/teardown: enrol one child in two classes; assert both
chips on Students, both lines on the parent card, both rosters, the overlap refusal, the
class-time-clash refusal, and the make-up home-class picker. Record the sabotage signature in
the file header, as `verify-schedule-week` does (§8.42).

> **⚠ RISK 7 MITIGATION — the dropped index WAS a live fixture guard, and nothing replaces it
> automatically.** §7.63 (`docs/GOTCHAS.md:770-778`) is the incident where an unscoped
> `INSERT … SELECT … CROSS JOIN students` enrolled and marked present **every child in the
> database** — *a billable lesson attributed to someone else's child*. What made it abort
> loudly was `one_active_enrolment_per_student`, and `docs/TESTING.md:243-245` records that
> the detector was proven red **using that abort**. After the drop, every
> (other-fixture-child, this-fixture-class) pair is novel, so **the same statement now
> succeeds silently.**
>
> The delta-divergence detector in `check-fixture-roundtrip.sh` (+2 isolated vs +6 stacked)
> should still catch it — it compares passes and does not reference the index. But that has
> never been proven against the new schema.
>
> **STEP + ASSERTION: re-run the §7.25 proof. Temporarily re-introduce an unscoped
> `CROSS JOIN students` into one fixture and run `check-fixture-roundtrip.sh` (both passes).
> PASS = exits non-zero and names `student_class_enrolments`. FAIL = exits 0.**
> **If it exits 0, this wave has removed a guard against stray billable attendance rows and
> the roundtrip check must gain an explicit assertion BEFORE the index is dropped.** That is
> a blocker, not a caveat.
> **STEP:** update §7.53's text (`docs/GOTCHAS.md:577-581`) and
> `fixtures-class-students.sql:83-89`, both of which reason from the dropped index by name.

Plus vitest/jest for the changed mappings, and `npm run typecheck` in both apps.

---

## Deploy

§7.60: migration → (no engine change) → apps. `main` last.

Production holds one enrolment per child, so there is **no data migration** and no
pre-existing overlap — the new *index* cannot reject existing data.

> **⚠ RISK 10 MITIGATION — that is NOT established for the triggers**, which fire on `UPDATE`
> of every historical row, including from `close_student_enrolment` and `set_students_active`.
> **STEP: run the migration against a production-shaped snapshot before push**, and assert
> the enrolment trigger no-ops when `NEW.is_active` is false (RISK 5c).
> **STEP: take the remote grant dump after push** (§7.39, §7.89, `docs/DEPLOYMENT.md` §11.7)
> — two function signatures changed, and local and cloud disagree by construction.
> **STEP:** `supabase migration list --linked` and check the `remote` column is filled. Do
> not trust `db push`'s own output; a `pgdelta` stack trace beside `Finished` is normal.

---

## Accepted consequences — vigilance only, no structural fix exists in this wave

Recorded rather than mitigated, because pretending otherwise is the failure mode.

1. **A child in two classes doubles the surface for a blocked month.** The completeness gate
   is all-or-nothing across the tenant (`core.ts:1066-1092`) and correctly has **no
   override**. Two classes means two coaches who can each stall the whole business's billing.
   The only lever is that the admin's Generate dialog already names the missing dates per
   class (`invoices/page.tsx:249-328`). **Monitor after the first multi-class month.**
2. **The "package running low" threshold burns at 2× for a two-class child.**
   `lessons_remaining` is family-wide and stays correct; only the threshold's *meaning*
   shifts. Cosmetic, but it will generate support questions in month one.

---

## Graduating to `docs/GOTCHAS.md` §7

Three findings outlive this plan file and belong where `/session-start` mandates reading
them. **Append the next free numbers; never renumber.**

- **Adding a defaulted parameter does not replace a Postgres function — it creates a second
  one, and PostgREST may keep calling the old body.** Nothing errors. (RISK 1; the money
  case makes it vivid.)
- **A trigger function that enforces uniqueness must be `SECURITY DEFINER`** — under the
  caller's RLS a hidden row makes the check silently pass. (RISK 5b)
- **A dropped constraint can also drop a TEST's detector.** §7.63's loud abort was
  `one_active_enrolment_per_student`. Before removing any constraint, ask what was relying
  on it to fail. (RISK 7)

---

## Pre-commit gate

Walk these before committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The three that matter most — each fails SILENTLY, which is why they lead:**

- [ ] **`DROP FUNCTION book_makeup(UUID, DATE, UUID)` is in the migration**, and
      `\df book_makeup` shows **exactly one** row. (RISK 1 — *wrong invoice amount*)
- [ ] **`check-fixture-roundtrip.sh` still catches a sabotaged unscoped `CROSS JOIN`** —
      exits non-zero, names `student_class_enrolments`. (RISK 7 — *stray billable attendance*)
- [ ] **`book_makeup` refuses a host class the child is already enrolled in** — pgTAP raises.
      (RISK 2 — *a promised make-up silently voided; billing stays correct*)

**The rest:**

- [ ] `close_student_enrolment`'s `p_class_id` has **no default**; all three call sites pass one. (RISK 3)
- [ ] `studentStatus.ts` drift test added and green in both apps. (RISK 3b)
- [ ] Coach X cannot close an enrolment in coach Y's class — pgTAP raises. (RISK 4)
- [ ] Overlap trigger is `SECURITY DEFINER`, gated `WHEN (NEW.is_active)`, and does **not**
      consult the counterparty class's `is_active`. (RISK 5, 5b, 5c)
- [ ] `reactivate_class()` still takes no refusals; bulk deactivate of a 2-class family passes. (RISK 5)
- [ ] Clash check is a trigger on `classes`, not only in `set_class_terms`; never fires on
      `is_active`. (RISK 9)
- [ ] `GRANT EXECUTE` on the 4-arg `book_makeup`; `makeup_bookings.test.sql:369` updated. (RISK 6)
- [ ] `'mixed'` fixture has two categories; the assertion is real, not vacuous. (RISK 8b)
- [ ] Makeups host list and expiry advisory recomputed from the chosen home class. (RISK 8c)
- [ ] Parent `attendance/index.tsx` no longer `.maybeSingle()`. (RISK 8)
- [ ] DOWN file written, committed, **and rehearsed** (§7.93).
- [ ] pgTAP count recorded before and after; a drop is investigated, not accepted.
- [ ] `test.sh` run **twice** (§7.15); `supabase test db` green; `npm run typecheck` both apps.
- [ ] `book_trial()`'s refusal decision settled (see top) — changed deliberately or left alone
      deliberately, not by omission.

---

## One doc fix this forces

`HANDOVER.md` §3's prohibition *"The coach app calls no RPCs at all"* is false and has
been — `roster.tsx:489` → `SwimSyncApp/lib/studentStatus.ts:45` calls
`close_student_enrolment`. Correct it at `/update-docs`.
