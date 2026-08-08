# New / rewritten BACKLOG.md items — 2026-08-08

Four new items, one rewrite, one reversal. Paste into the themed sections named.

> **A HAND-OFF, not a second source of truth.** A worktree may not write `BACKLOG.md`, so
> these are staged here to be applied from the root checkout. **Delete this file once they
> are in `BACKLOG.md`.** Companion: `BACKLOG_BUILD_ORDER_2026-08-08.md`.

---

## → `## Coach workflow`

### A lesson can have a substitute coach, temporarily — **M**
Record that Coach B taught one lesson of Coach A's class, without changing who the class
belongs to. Pay follows **whoever actually taught it**.

**Why:** a permanent handover already works — `set_class_terms()` takes a coach, updates
`classes.coach_id` and writes a `class_rates` row with `paid_coach_id` + `effective_from`,
so the outgoing coach keeps their pay for lessons before the change date. What has no
representation at all is a **one-off cover**: Coach A cannot make Wednesday, Coach B
teaches it, and the class assignment must not move. Today Coach A is paid and Coach B has
no record of having worked.

**Notes — the previously filed answer was wrong, and this is why:**

- **`session_pay_overrides` cannot express this.** It is
  `(lesson_session_id PK, pays_coach BOOLEAN, set_by, set_at)` — it can say a lesson *does
  not* pay its coach, and cannot say *who else* it pays. The *Deliberately not doing* row
  on substitute coaches asserts "the schema already supports it" and must be corrected
  (see the reversal below); the real shape is a per-session `taught_by_coach_id`.
- **This changes coach RLS, which is the blast radius.** A coach reaches a class today via
  `classes.coach_id`. A substitute must be able to open and mark a lesson of a class they
  do not own — so the coach's read/write path becomes "assigned to the class **or** named
  on this session". `current_coach_id()` feeds that policy set; ⚠ same blast-radius rule as
  ever — pgTAP before any UI.
- **Pay attribution:** `class_rates.paid_coach_id` is `NOT NULL` and resolves per date, so
  the payout path currently asks the class, not the session. A session-level override must
  take precedence over `class_rate_on()` for that one lesson, and must be visible in the
  pay-decision table rather than silently altering a total.
- Decide whether a cover can span a **date range** (Coach A is away for three weeks) or
  only one lesson at a time. A range is the same record repeated; the reason to decide up
  front is the UI, not the schema.

### Trainee coaches shadow the main coach on a lesson — **M**
A lesson has exactly **one main coach** plus any number of trainee/shadow coaches.
Trainees are **paid at their own rate**.

**Why:** shadowing is how a school brings a coach on, and today SwimSync cannot represent
it — a trainee is either the class's coach or invisible. The main coach must stay
unambiguous, because pay attribution, RLS and the roster all resolve to one person.

**Notes:**

- **Sequence this AFTER the substitute item above** — both add "who taught this lesson" to
  `lesson_sessions`, and they are one schema change, not two (`CLAUDE.md`: one schema
  change in flight at a time). Build the session coach roster once, with a main/shadow
  distinction, rather than adding a substitute column and then widening it.
- **Paid at their own rate is the decision (2026-08-08), and it is the expensive half.**
  A shadowed lesson produces **two** `coach_payouts` rows, which breaks the current
  assumption that a lesson pays one coach via `class_rates.paid_coach_id`. The trainee's
  rate comes from the existing effective-dated `coach_rates`, so no new rate concept — but
  the payout builder, the pay-decision table and the coach's My Pay screen all now sum a
  set rather than a single row.
- A trainee must be able to **see** the lesson without being able to change the class —
  same RLS widening as the substitute item, which is the other reason to build them
  together.
- **This supersedes _Multiple coaches per class_** (see the rewrite below): the need is
  per-lesson, not per-class.

---

## → `## Billing and payments`

### A lesson recorded into an already-BILLED month is reported, and settled — **S/M**
_(Replaces "A session added AFTER a month is invoiced is never billed". Decided
2026-08-08 — walked through with the user.)_

The lesson still records. An admin-visible report lists lessons sitting inside a sealed
billing month with nobody billed for them, and a **settlement** clears the line.

**Why:** the hard block guarantees every lesson is marked *at generation time*. It cannot
cover a lesson created afterwards. The `unclaimed_billable` net already catches children
the admin **entered** before billing — their lessons hold the month open. It cannot catch a
child nobody entered: a family that started swimming on 16 July, registered on 12 August
after July was billed, whose enrolment is then backdated so their real lessons can be
recorded. Those lessons are unbillable and, today, **invisible**.

**Notes:**

- **Refusing was considered and rejected**: the coach would be unable to record a lesson a
  child genuinely attended, the parent would see a gap in their child's history, and
  §8.32 deliberately left no "reopen this month" escape hatch. A teaching record is not
  only a billing record.
- **Reuse the shape that already exists** — this is `unclaimed_billable` pointed at a
  different cause: collect as a report with earliest/latest lesson dates, never touch
  `billableStudentIds` or any invoice arithmetic, and release through
  `student_settlements` (already effective-dated via `settled_through`, so settling once
  cannot blanket-authorise future lessons). No new invoice concept, no override on the
  `already_exists` guard.
- The line must **persist until acted on**. A one-time warning was considered and rejected:
  the entire failure mode is silence, and a message that is dismissed is gone.
- ⚠ **`schedule_extra_lesson()`'s comment is WRONG and must be corrected in the same
  pass.** It reads *"The FLOOR still applies — scheduling a lesson into an already-invoiced
  month would create a lesson that can never bill."* It does not: `markable_floor()` is
  `LEAST(1st of last month, month after the latest seal, …)` and `LEAST` takes the
  **earlier**, so in August the floor sits at 1 July whether or not July is sealed. The
  check tests the floor and the comment describes testing the seal. Pre-existing — not
  introduced by §8.32. An applied migration is never edited, so the correction goes in the
  new migration and in the function's `COMMENT`.
- `book_makeup()` and `book_trial()` check the same floor and carry the same gap.

---

## → `## Admin and operations`

### An owner-only accounting page — **M** — _raised 2026-08-08, not a priority_
One page showing what the business actually earned and paid out — revenue, wages paid,
outstanding — **visible to the owner and not to co-admins**.

**Why:** raised by the user while deciding whether co-admin permissions need splitting. It
is the first concrete thing a co-admin should *not* see, and the reason the answer to
"split co-admin permissions" is *yes eventually, not now*.

**Notes:**

- **This needs NO capability model.** "Owner only" is already expressible —
  `tenants.owner_profile_id` and `is_tenant_owner()` shipped 2026-08-06. So this page can
  be built whenever it becomes a priority, and it does **not** wait on
  *Split co-admin permissions*. Recording that explicitly, because the two look coupled and
  are not.
- **This absorbs _Revenue reporting_** as its main content, and inherits that item's
  decide-first question: **accrual (invoices issued this month) or cash (payments received
  this month)?** Everything else follows from the answer. It also inherits *do not ship a
  partial figure* — two sources must be summed, `invoices` **plus**
  `student_settlements.amount` where `kind = 'paid_outside'`.
- Wages paid out come from `coach_payouts`, which is already draft→frozen per period.
  Note the trainee-coach item above makes a lesson pay **more than one** coach — build this
  after it, or the payroll half is written twice.

---

## → REWRITE `## Platform and reach → Multiple coaches per class`

### ~~Multiple coaches per class~~ — **SUPERSEDED 2026-08-08**
Replaced by two lesson-level items in *Coach workflow*: *A lesson can have a substitute
coach, temporarily* and *Trainee coaches shadow the main coach on a lesson*.

The item's own note asked the right question — *"if the real need is 'someone else covers
this week', that's a session-level concern, not a class-level one"* — and the answer, from
the user on 2026-08-08, is that **both** real needs are session-level: a temporary
substitute, and trainees shadowing. A class-level join table would have expressed neither
and would have been rebuilt.

---

## → REVERSE the `## Deliberately not doing` row: **Modelling substitute coaches**

Two things in that row are now wrong and it must be replaced by a pointer to the new item:

1. **"The schema already supports it (`session_pay_overrides`)" is FALSE.** That table is
   `(lesson_session_id, pays_coach BOOLEAN, set_by, set_at)` — it suppresses a lesson's pay
   and cannot name another coach.
2. **"Revisit when a business has enough coaches to cover for each other"** — that is now.
   The user asked for it directly on 2026-08-08, including trainee coaches, and decided
   pay follows whoever actually taught.

Keep the row's one durable finding: a permanent handover is **not** this problem and
already works through effective-dated class terms.
