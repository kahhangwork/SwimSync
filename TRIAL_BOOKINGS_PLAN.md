# Trials Are Bookings — Build Plan

_Written 2026-07-25. A trial is a child **expected at one lesson**, booked in advance by
the admin, and marked by the coach like anyone else._

> **STATUS: PLANNED — NOT BUILT.** Requirements settled with the user
> (`/plan-with-confidence`, ~97%), hardened with `/plan-review` — **mitigations are inlined
> under the steps they govern**, marked `⚠ RISK n`. The ranked list lives in the review
> response; this file carries the executable form.
>
> **This SUPERSEDES the trial half of `TRIAL_ONBOARDING_PLAN.md`.** That plan shipped a
> trial as *coach-created, enrolment-shaped, attendance-pre-written*. All three were
> wrong. The ongoing-student path, the claiming/invite path and the settlement machinery
> from that plan are **unchanged and stay**.

---

## What was wrong, and why

I built a trial as: **coach** creates the child → a closed enrolment dated to the session
→ a `lesson_sessions` row → an attendance row pre-set to Paid/Free trial.

Three defects, all from modelling a trial as *something that already happened*:

1. **A trial could not be booked in advance** — the common case.
2. **Writing attendance at creation time was wrong.** A booked child can turn up, not turn
   up, or have the lesson rained off. Pre-setting "Paid trial" asserts a fact nobody has
   observed.
3. **It used an enrolment to mean "here once."** An enrolment is a standing arrangement.

I also argued *against* an admin trial form because "booking ahead would mean marking a
child present at a lesson that hasn't happened". That was reasoning from my own
implementation rather than the problem. **The attendance write was the mistake, not the
advance booking.**

**What this buys back:** removing the attendance write also removes
`add_unclaimed_student()` as a **second writer of `lesson_sessions`** — the thing that
needed the double-billing guard and became §7.43. Sessions go back to one writer, as §6
describes. **Retire §7.43 when this ships.**

---

## Verified facts (checked, not assumed — 2026-07-25)

| Fact | Consequence |
|---|---|
| Production has **11 students, 9 parents, 7 enrolments, 5 classes, 2 tenants** | NOT a clean slate. `HANDOVER.md` §3 says it is — stale, fix it. |
| **Zero** attendance, `lesson_sessions`, unclaimed students, settlements | Everything this change touches is empty. No data migration. |
| `Coach Kah Hang` is `tenant_admin` **and** has a `coaches` row | Private-coach shape; removing the coach's trial path costs him nothing. |
| `Epic Swim` (school, 07-21) has a **separate** admin and coach | That coach is not an admin — trials go through the admin, as the user says schools work. §9's "onboard the school" is DONE. |
| `class_rate_on(class, date)` prices every lesson by **its own date** (§7.3) | A trial rate must follow the same rule. |

---

## Settled decisions (do not re-litigate)

| Decision | Why |
|---|---|
| **A trial is a BOOKING** — not an enrolment, not attendance | It is a visit, and nothing is known about the outcome until the coach marks it. |
| **Only the ADMIN books** | Schools arrange trials at the admin; a private coach *is* the admin (verified). |
| **The coach marks a trial like anyone else** | All statuses. No special control. |
| **Bookable in advance, or for a past date** | Advance is normal; past covers recording after the fact. |
| **An unmarked booking BLOCKS the month** | §7.7's no-override rule. A paid trial nobody marked is lost money. |
| **New child OR existing child** | 11 real students exist; retyping a name would create a duplicate. |
| **Its own Trials page** | A booking you cannot see is one you forget — and a forgotten one blocks billing. |
| **Trial rate is per CLASS CATEGORY, and EFFECTIVE-DATED** | `class_categories` already means "what kind of class this is" (Group, Private, Squad…) and already scopes packages. A private trial costs more than a group trial *because it is a different kind of lesson* — so this is the axis. Pricing on any other would invent a second vocabulary beside an existing one. Effective-dated because a mutable price would reprice unbilled trials — §7.3/§7.7's bug, fixed three times. |
| **A rate with NO category is the business-wide default** | Categories are OPTIONAL and production has **5 classes, none tagged** — a category-only rate would be unusable until every class was tagged. Scope-less-means-everything is exactly how packages already resolve scope. |
| **Resolution: category rate → scope-less rate → class rate** | Most specific wins. The last tier is today's behaviour, so a business that sets no trial rate at all is unaffected. Distinct from §6's "missing CLASS rate is a hard failure", where the alternative is silently charging 0. |
| **Soft cancel** | History survives; a cancelled booking expects nobody. |

---

## Phase 1 — Migration

**`trial_bookings`** — `id`, `tenant_id`, `student_id`, `class_id`, `session_date`,
`booked_by/at`, `cancelled_at/by`.

> ⚠ **RISK 5 MITIGATION — the unique constraint must be PARTIAL.**
> `UNIQUE (student_id, class_id, session_date)` on its own means a **cancelled booking
> permanently blocks re-booking that same slot** — and "cancel, then re-book" is an
> ordinary flow ("moved to next Saturday… actually back to this one").
> **Step:** `CREATE UNIQUE INDEX … ON trial_bookings (student_id, class_id, session_date)
> WHERE cancelled_at IS NULL;`
> **Assertion (pgTAP):** book → cancel → book the same slot again **succeeds**, and two
> *live* bookings for the same slot are refused.

Index `(class_id, session_date) WHERE cancelled_at IS NULL` — the roster's hot path.
RLS: read = tenant admin + platform admin **+ the class's coach** (they must see who is
expected); write = tenant admin only.

**`trial_rates`** — `(tenant_id, category_id NULL, rate, effective_from, created_by,
created_at)`, INSERT-only, no UPDATE/DELETE policy. `category_id IS NULL` is the
business-wide default.

> ⚠ **RISK 1 MITIGATION (part 1) — a trial rate can never be zero or negative.**
> **Step:** `CHECK (rate > 0)` on the table. A $0 trial rate would silently bill nothing
> on a document that freezes when created (§11.6) — the same failure `CHECK` guards
> against on package products.

> ⚠ **RISK 7 MITIGATION — deleting a category must not reprice history.**
> These rows price PAST lessons. If a category's rates vanished with the category,
> every unbilled trial in the five-week window between lesson and invoice run would
> quietly re-resolve to the default or the class rate — §7.7's bug through a new door.
> **Step:** `category_id … REFERENCES class_categories(id) ON DELETE RESTRICT`, exactly
> as `package_products.category_id` already does (`20260720000100:112`) and for the same
> reason. **Named prohibition: do NOT use `SET NULL` here** — that would silently
> reinterpret a category rate as the business default.
> **Assertion (pgTAP):** deleting a category that has a trial rate is refused.

> ⚠ **RISK 11 MITIGATION — a category from another business.**
> `classes` already guards this with `enforce_class_category_tenant`
> (`20260720000100:81-97`); a rate row needs the same or the tenant boundary has a hole
> the RLS policy cannot see (the policy checks `tenant_id`, not whether the *category*
> belongs to it).
> **Step:** mirror that trigger for `trial_rates`.
> **Assertion (pgTAP):** admin A inserting a rate scoped to business B's category is
> refused, and `trial_rates` does not grow.

**Rewrite `add_unclaimed_student()`'s trial mode** to create a booking and nothing else —
no enrolment, no session, no attendance.

> ⚠ **RISK 8 MITIGATION — this is a CONTRACT, and my first draft mislabelled it EXPAND.**
> Dropping `p_status` from the signature would break the **currently deployed** coach
> walk-in form the moment the migration lands, because PostgREST resolves by exact
> argument list. Under the EXPAND order (migrate first, push last) that button would error
> for the whole window.
> **Named prohibition: do NOT remove `p_status` or `p_session_date` from the signature in
> this change.** Keep both accepted; `p_status` becomes **ignored**, with a `COMMENT`
> saying so — the same deprecate-then-drop discipline used for
> `coaches.paynow_qr_url`. A later migration drops it once no caller passes it.
> **Assertion:** calling the RPC with the OLD argument list still succeeds after the
> migration. That is what makes the deploy order stop mattering.

> ⚠ **RISK 4 MITIGATION — a booking on a non-class day is permanently unmarkable.**
> Booked for a Tuesday on a Saturday class, the child is never on any roster, never gets
> marked, and **blocks the month indefinitely** with no obvious cause.
> **Step (structural, in the RPC — not the UI):** refuse when
> `EXTRACT(DOW FROM p_session_date)` does not match the class's `day_of_week`.
> **Named prohibition: do NOT rely on the date picker for this.** A limit only the admin
> screen applies is not a limit (§7.32's lesson about the month picker).
> **Assertion (pgTAP):** booking a Tuesday into a Saturday class raises, and
> `trial_bookings` does not grow.

> ⚠ **RISK 6 MITIGATION — do not book a child who is already enrolled in that class.**
> They would be expected twice for the same lesson. Harmless once deduped, meaningless to
> the admin, and a sign the admin has the wrong child.
> **Step:** refuse when an active enrolment already exists for `(student, class)`.
> **Assertion (pgTAP):** refused, with a message naming the enrolment.

## Phase 2 — Engine (**write the tests first and prove them RED**)

1. **Expected students become per-date.** `activeStudentIds` is computed once per month
   and applied to every date; it becomes
   `expectedOn(date) = activeStudentIds ∪ live bookings on that date`, **deduped**, and
   booking dates join `datesToCheck` so a trial on a session-less date still registers as
   unmarked.
2. **`trial_paid` prices by resolving the trial rate for the lesson's class and date**,
   falling back to `class_rate_on` when none applies.

> ⚠ **RISK 1 MITIGATION (part 2) — the fallback must never produce 0, and must never
> throw.** Two opposite failure shapes, both bad: a NULL rate coerced to 0 silently
> under-bills a frozen document; a NULL rate that raises blocks **all** billing for a
> business that simply never set a trial price — which is both of them today.
> **Step:** `const price = trialRateOn(tenant, categoryId, date) ?? classRateOn(class, date)`
> — `??`, never `||` (a 0 slips through `||`; `CHECK (rate > 0)` is the second layer that
> makes 0 unreachable anyway).

> ⚠ **RISK 12 MITIGATION — the resolution ORDER is money, so pin every branch.**
> `trialRateOn` picks the most specific match: the class's category first, then the
> scope-less default, then nothing — each filtered to `effective_from <= lesson date` and
> taking the latest. Get the precedence backwards and a business charges the wrong price
> for every trial, invisibly, on documents that freeze when created.
> **Assertions (Deno), all six:**
> 1. category rate set → bills the **category** rate
> 2. only a scope-less rate set → bills the **default**
> 3. both set → **category wins**
> 4. neither → bills the **class rate**
> 5. a rate effective AFTER the lesson → ignored (the earlier one, or the class rate, applies)
> 6. the class has **no category** and only a category rate exists → falls to the class rate,
>    NOT to that category's rate

> ⚠ **RISK 10 MITIGATION — `trial_free` must stay free.** It is one keystroke from being
> swept into the new pricing branch.
> **Assertion (Deno):** a booked child marked `trial_free` contributes **0** to gross,
> with a trial rate configured.

> ⚠ **RISK 1 MITIGATION (part 3) — the tripwire.** **Assertion (Deno):** a tenant with no
> bookings and no trial rate produces **byte-identical** invoices — same gross, net and
> item count as before this change. This is what proves the money path was not disturbed
> for the 2 real tenants.

> ⚠ **RISK 2 MITIGATION — structural, because four hand-written copies is what caused
> §7.18.** **Step:** put `expectedStudentsOn(date, activeStudentIds, bookingsByDate)` in
> `attendanceCompleteness.ts` — the file that already IS the one definition of the rule —
> rather than inlining the union at four call sites. It is duplicated across the two apps
> and the Deno engine exactly as that file's header describes, so it stays **three edits,
> diffable**, not four divergent ones.
> **Named prohibition: do NOT inline `[...active, ...booked]` at a call site.**
> **Assertion:** `diff` the three copies of `attendanceCompleteness.ts` — byte-identical
> but for the jest-vs-vitest import line.

## Phase 3 — The other three "who is expected" callers

`SwimSyncAdmin/lib/classCoverage.ts` (invoice pre-flight),
`SwimSyncApp/app/(coach)/today/index.tsx` (Unmarked Lessons),
`SwimSyncApp/app/(coach)/classes/[id]/roster.tsx` ("Not marked").

> ⚠ **RISK 2 MITIGATION (part 2) — the pre-flight and the engine must agree.** They
> diverged once and the client was the only effective gate (§7.18). The admin seeing "all
> clear" while the engine blocks is merely confusing; the reverse is a silent underbill.
> **Assertion (vitest):** given one fixture containing a booked-but-unmarked trial,
> `classCoverage` reports the same missing lesson the engine's `blocking` list does.

## Phase 4 — Admin: the Trials page

New nav item. Book (existing child **or** a new name, class, date), an **Upcoming** list,
a **Past — unmarked** list flagged as what holds the month open, and cancel per row.
**Trial rates** are set here too — a small table of *category → price*, one row per
category plus an "All other classes" row for the scope-less default. Each save records a
new effective-dated row rather than overwriting, so the screen should say plainly that a
price change applies from today and does not alter lessons already taught.

- The date picker offers **only that class's lesson dates**, from `classes.day_of_week` via
  `lib/lessonDates.ts` — an affordance backing the RPC's refusal, not replacing it.

> ⚠ **RISK 3 MITIGATION — the page must be reachable by the people who need it, and
> nobody else.** A platform admin belongs to no business and is closed out of every
> single-business page (§4.4); a coach must not book.
> **Step:** add Trials to the tenant-admin nav in `lib/adminNav.ts`.
> **Assertion (vitest, in the existing `adminNav.test.ts`):** Trials appears for
> `tenant_admin` and **not** for `platform_admin`.

> **The per-business-rate limit this plan first carried is GONE** — pricing moved to the
> class category, which is the axis that already distinguishes a $30 group class from an
> $80 private one. What remains is a much narrower limit worth stating in PRD §7.17: two
> classes **in the same category** cannot trial at different prices. The seam if that ever
> bites is a per-class override row, not a rewrite.

## Phase 5 — Coach: remove the walk-in form, keep the marking

Delete *Add a walk-in / trial* and its handler. The roster becomes
**enrolled ∪ booked-for-this-date ∪ already-marked**, booked children labelled **Trial**.

> ⚠ **RISK 3 MITIGATION (part 2) — this REMOVES a deployed capability.** Verified safe:
> production has zero unclaimed students, so nobody has used it.
> **Step:** re-run that count immediately before deleting the form —
> `SELECT COUNT(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = s.id);`
> **Pass value: 0.** If it is not 0, someone used it between planning and building, and
> those children need a Trials-page equivalent before the form goes.

## Phase 6 — Tests

**pgTAP:** booking RLS (coach reads, cannot write; cross-tenant refused); the partial
unique index (RISK 5); non-class-day refusal (RISK 4); already-enrolled refusal (RISK 6);
the trial-mode rewrite creating **no** enrolment, session or attendance; the old argument
list still resolving (RISK 8); `trial_rates` insert-only, the cross-tenant category
refusal (RISK 11), and `ON DELETE RESTRICT` on a category that has rates (RISK 7).

> **Mutation-test the booking gate** to the `tenant_provisioning.test.sql` standard:
> delete the admin check and at least one assertion must fail **proving the ungated
> function wrote a row**.

**Deno:** as Phase 2. **Run the suite twice** (§7.15 — sealing leaks state).
**Driver:** rewrite `verify-trial-onboarding.mjs` — admin books ahead → coach sees the
child on that lesson **and not the next one** → marks them → billing follows.

## Phase 7 — Docs

PRD §7.17's trial half rewritten (incl. RISK 7's limit); `TRIAL_ONBOARDING_PLAN.md` marked
superseded on that half; **§7.43 retired**; §3's "clean slate" corrected to the real
figures; §9's "onboard the school" marked done.

---

## Deploy

Additive **once RISK 8's mitigation is in** (the signature keeps its old shape), so the
usual order holds: migrate → deploy `generate-invoices` → push. Then §8.10's three checks:
remote `pg_proc` grants (§7.39), CI green, and a smoke of a route only the new build has.

**Behaviour changes with no data to reinterpret** — zero unclaimed students, zero
attendance in production.

---

## Pre-commit gate

A box that cannot be ticked is a **blocker**, not a caveat.

**The three that decide whether money stays correct:**

- [ ] **RISK 1** — tripwire green (no bookings, no trial rate → byte-identical invoices);
      `??` not `||`; `CHECK (rate > 0)`.
- [ ] **RISK 12** — all **six** resolution branches asserted: category wins over default,
      default over class rate, class rate when neither, future-dated ignored, and an
      untagged class never picks up a category's rate.
- [ ] **RISK 2** — `expectedStudentsOn` lives in `attendanceCompleteness.ts`, the three
      copies `diff` clean, and classCoverage agrees with the engine on one fixture.
- [ ] **RISK 8** — the OLD argument list still resolves after the migration.

**The rest:**

- [ ] **RISK 4** — non-class-day booking refused **in the RPC**, not just the picker.
- [ ] **RISK 5** — partial unique index; cancel-then-rebook succeeds.
- [ ] **RISK 6** — booking an already-enrolled child refused.
- [ ] **RISK 3** — unclaimed-student count is **0** immediately before deleting the coach
      form; Trials in the tenant-admin nav and not the platform admin's.
- [ ] **RISK 10** — `trial_free` contributes 0 with a trial rate set.
- [ ] **RISK 7** — deleting a category that has trial rates is refused (`ON DELETE
      RESTRICT`, never `SET NULL`).
- [ ] **RISK 11** — a rate scoped to another business's category is refused and the table
      does not grow.
- [ ] Booking gate mutation-tested; Deno suite run twice; both apps typecheck under the
      §7.11 stubbed condition.

---

## Graduating to `HANDOVER.md` §7

- **Retire §7.43** — `lesson_sessions` returns to a single writer.
- **New:** *a PostgREST function signature is a contract*. Removing or renaming a
  parameter breaks the deployed caller the instant the migration lands, because
  resolution is by exact argument list — so a signature change is a CONTRACT and follows
  the deploy-the-app-first rule, or keeps the old parameter accepted-and-ignored. This
  plan mislabelled it EXPAND on the first pass.
