# Categories, and Trials as Bookings — Build Plan

_Written 2026-07-25. Every class belongs to a category; a category carries a trial price;
a trial is a child **expected at one lesson**, booked ahead by the admin and marked by the
coach like anyone else._

> **STATUS: BUILT AND VERIFIED LOCALLY — NOT MERGED, NOT DEPLOYED.** pgTAP **299**, Deno
> **108** (run twice), admin vitest **106**, app jest **79**, all typecheck, and
> `verify-trials.mjs` **9/9** through both real UIs. The rollback in `supabase/rollback/`
> was **executed and verified**, forward and back. RISK U was NOT mitigated in code —
> there is no class-deactivation UI to attach a warning to, so it is recorded on the
> BACKLOG item that owns it.
>
> _(originally: PLANNED — NOT BUILT.)_ Requirements settled with the user across two rounds of
> `/plan-with-confidence` (~97%).
>
> **SUPERSEDES the trial half of `TRIAL_ONBOARDING_PLAN.md`.** The ongoing-student path,
> the claiming/invite path and the settlement machinery from that plan are **unchanged and
> stay**. This is one change, not two, at the user's request — but the phases are ordered
> so the category work lands and is verified before anything depends on it.

---

## How we got here (three corrections, all the user's)

1. **A trial is not attendance.** I shipped it as coach-created, enrolment-shaped, with
   an attendance row pre-written. That made booking ahead impossible and asserted an
   outcome nobody had observed. *The attendance write was the mistake, not the advance
   booking* — I had argued the opposite, reasoning from my own implementation.
2. **A trial price belongs to the class CATEGORY**, not the business. A private trial
   costs more than a group trial because it is a different kind of lesson, and
   `class_categories` already means exactly that.
3. **Categories should be mandatory.** That removes the scope-less-default tier entirely:
   resolution collapses to *category trial rate → class rate*.

**What this buys back:** removing the attendance write also removes
`add_unclaimed_student()` as a **second writer of `lesson_sessions`**, which is what
needed the double-billing guard and became §7.43. **Retire §7.43 when this ships.**

---

## Verified facts (checked, not assumed — 2026-07-25)

| Fact | Consequence |
|---|---|
| Production: **11 students, 9 parents, 7 enrolments, 5 classes, 2 tenants** | NOT a clean slate — `HANDOVER.md` §3 says it is. Stale; fix it. |
| **Zero** attendance, `lesson_sessions`, unclaimed students, settlements, packages | Everything this changes is empty. No data reinterpreted. |
| **All 5 classes have `category_id = NULL`**; one category ("Group") exists, on Kah Hang's tenant, with **no classes in it** | The backfill has real work to do, and a category-only rate would be unusable without it. |
| Kah Hang's 4 classes are priced **$40, $35, $35, $40** — one category, two prices | Why class price CANNOT move to the category. Settled; do not revisit. |
| `class_rates` carries **`paid_coach_id NOT NULL`** as well as price | A category spans coaches, so `class_rates` survives regardless. |
| `Coach Kah Hang` = `tenant_admin` **and** a coach; `Epic Swim` = separate admin + coach | Removing the coach's trial path is safe for both shapes. §9's "onboard the school" is DONE. |
| **19 class INSERTs across 13 pgTAP files, + 7 elsewhere** | The `NOT NULL` migration's real cost: ~26 fixture edits. |

---

## Settled decisions (do not re-litigate)

| Decision | Why |
|---|---|
| **`classes.category_id` becomes NOT NULL** | Makes trial pricing always resolvable and removes the scope-less tier. |
| **Two categories per business at creation: "Default Private", "Default Group"** | A business with no category could not create a class at all. |
| **Backfill every untagged class to that business's "Default Group"** — uniformly, including Kah Hang's, leaving his empty "Group" alone | User's call. Predictable beats clever; nothing references "Group", so he can delete or rename it himself. **A migration must not delete a business's data, even empty data.** |
| **No trigger auto-filling a missing category** | It would silently drop a class into "Default Group" when the admin meant "Default Private" — which now decides what its trials cost. Same reasoning as the auth trigger *refusing to guess* a coach's tenant. The 26 fixture edits are the honest price. |
| **Class price stays per class, effective-dated** | Kah Hang charges $35 and $40 within one category. Non-negotiable. |
| **Trial rate is per CATEGORY, effective-dated, insert-only** | A mutable price would reprice unbilled trials — §7.3/§7.7's bug, fixed three times. |
| **Resolution: category trial rate → class rate.** Two tiers | The fallback is today's behaviour, so a business that prices nothing is unaffected. |
| **A trial is a BOOKING** — not an enrolment, not attendance | It is a visit; nothing is known until the coach marks it. |
| **Only the ADMIN books.** The coach marks trials like any other student | Schools arrange trials at the admin; a private coach *is* the admin. |
| **Refuse a trial for a child with an ACTIVE enrolment in ANY class** | A trial means "not in a class yet". A *closed* enrolment does not block — a returning family considering a different class is a real trial. |
| **Refuse a trial for a child whose parent holds a live package** | User's call, chosen over leaving package drawdown untouched. **Known consequence, accepted:** a package is held by the PARENT, so this also blocks a sibling who has never had a lesson. Dormant today (zero packages), trivially loosened later. |
| **An unmarked booking BLOCKS the month** | §7.7's no-override rule. A paid trial nobody marked is lost money. |
| **Reminder while ANY category has no trial rate** | Returns if a category is added later and left unpriced — an unpriced category silently trials at the class rate. No dismiss button: the data is the state. |
| **Soft cancel** on bookings | History survives; a cancelled booking expects nobody. |

---

## Phase 1 — Categories become mandatory

One migration, in this order:

1. For **every existing tenant**, create `Default Private` and `Default Group` (skip a name
   that already exists, case-insensitively — `class_categories_name_uniq` is on
   `lower(trim(name))`).
2. `UPDATE classes SET category_id = <that tenant's Default Group> WHERE category_id IS NULL`.
3. `ALTER TABLE classes ALTER COLUMN category_id SET NOT NULL`.
4. Change `classes.category_id`'s FK from `ON DELETE SET NULL` to **`ON DELETE RESTRICT`**.

> ⚠ **RISK A MITIGATION — step 4 is not tidiness, it is the difference between a clear
> error and a baffling one.** With `SET NULL` against a `NOT NULL` column, deleting a
> category that has classes fails with a null-violation naming a column the admin never
> touched. `RESTRICT` says what is actually wrong.
> **Assertion (pgTAP):** deleting a category that has classes is refused, and the error
> mentions the constraint rather than a NULL.

> ⚠ **RISK B MITIGATION — the backfill must be provably total, in the same transaction.**
> If a single class is missed, step 3 aborts the whole migration — which is *safe* but
> opaque, and on production it would abort mid-deploy.
> **Step:** before step 3, assert inside the migration:
> ```sql
> IF EXISTS (SELECT 1 FROM classes WHERE category_id IS NULL) THEN
>   RAISE EXCEPTION 'backfill incomplete: % classes still untagged',
>     (SELECT COUNT(*) FROM classes WHERE category_id IS NULL);
> END IF;
> ```
> **Step:** and assert every tenant got its two categories, so a tenant with zero classes
> is not silently skipped (Epic Swim has one class; a future tenant may have none).

**`provision_tenant()`** creates both categories for a new business, in the same
transaction as the tenant.

> ⚠ **RISK C MITIGATION — a business created without categories cannot create a class.**
> `provision_tenant()` is the ONLY insert path into `tenants` (§8.9), so if it forgets,
> every new business is born broken and the failure appears much later, at class creation.
> **Assertion (pgTAP, in the existing `tenant_provisioning.test.sql`):** a freshly
> provisioned tenant has **exactly 2** categories named Default Private / Default Group.

**`seed.sql`** likewise, and **~26 fixture sites** updated: 19 class INSERTs across 13
pgTAP files, plus `seed.sql`, the Deno `test-helpers.ts`, and the driver fixtures.

> ⚠ **RISK D MITIGATION — fixture churn is where a test quietly stops testing.** A fixture
> hand-edited 26 times is 26 chances to change what a test covers rather than just make it
> compile.
> **Assertion:** record the test counts BEFORE this phase — pgTAP **297**, Deno **99**,
> admin **100**, app **75** — and after the churn the counts must be **identical**. A
> changed count means a test was lost or silently skipped, not that a fixture was fixed.

## Phase 2 — `trial_rates`

`(id, tenant_id, category_id, rate, effective_from, created_by, created_at)`, INSERT-only:
no UPDATE and no DELETE policy. `CHECK (rate > 0)`.

> ⚠ **RISK E MITIGATION — deleting a category must not reprice history.** These rows price
> PAST lessons; if they vanished with the category, every unbilled trial in the five-week
> gap between lesson and invoice run would re-resolve to the class rate — §7.7 through a
> new door. **Step:** `category_id … ON DELETE RESTRICT`, as
> `package_products.category_id` already does (`20260720000100:112`).
> **Named prohibition: never `SET NULL` here.**

> ⚠ **RISK F MITIGATION — a category belonging to another business.** The RLS policy checks
> `tenant_id`, not whether the *category* belongs to it — a hole the policy structurally
> cannot see. `classes` guards this with `enforce_class_category_tenant`
> (`20260720000100:81-97`). **Step:** mirror that trigger.
> **Assertion (pgTAP):** admin A inserting a rate scoped to business B's category is
> refused and `trial_rates` does not grow.

`trial_rate_on(tenant, category, date)` → the latest rate with
`effective_from <= date`, or NULL.

## Phase 3 — `trial_bookings` + the RPC rewrite

`(id, tenant_id, student_id, class_id, session_date, **category_id**, booked_by/at,
cancelled_at/by)`.
RLS: read = tenant admin + platform admin **+ the class's coach**; write = tenant admin.

> ⚠ **RISK R MITIGATION — SNAPSHOT THE CATEGORY ONTO THE BOOKING. This is the sharpest
> risk in the plan.** Trial pricing resolves through the class's category — but
> `classes.category_id` is a **plain mutable column with no effective dating**, unlike
> every other input to money in this schema. Re-tag a class from Group to Private today
> and **every unbilled trial in that class silently reprices at the Private rate**, across
> the five-week window between a lesson and its invoice run. That is precisely §7.7's bug
> ("editing a price on the 3rd repriced every unbilled lesson of the previous month"),
> reaching money through a new door, and precisely what §6's rule forbids: *a fact about a
> past lesson is never a live lookup.*
> **Step:** `trial_bookings.category_id NOT NULL`, copied from the class **at booking
> time**, and the engine prices from **the booking's** category — never from
> `classes.category_id`. The booking is the record of what was sold, exactly as
> `invoice_items.student_name` records the name a document was issued with.
> **Named prohibition: the engine must NOT join `classes` to find a category for pricing.**
> **Assertion (Deno):** book a trial in category A → re-tag the class to category B (with a
> different rate) → the invoice still bills **A's** rate.
> **Audit before commit:** `grep -n "category" supabase/functions/generate-invoices/core.ts`
> — every trial-pricing read comes from the booking row.

> ⚠ **RISK G MITIGATION — the unique index must be PARTIAL.** A plain
> `UNIQUE (student_id, class_id, session_date)` means a **cancelled booking permanently
> blocks re-booking that slot**, and "moved it, actually moved it back" is ordinary.
> **Step:** `… WHERE cancelled_at IS NULL`.
> **Assertion (pgTAP):** book → cancel → re-book the same slot **succeeds**; two live
> bookings for one slot are refused.

**`add_unclaimed_student()`'s trial mode** creates a booking and nothing else — no
enrolment, no session, no attendance.

> ⚠ **RISK H MITIGATION — a PostgREST signature is a CONTRACT.** Removing `p_status`
> breaks the **currently deployed** coach walk-in form the instant the migration lands,
> because resolution is by exact argument list — and under migrate-first that window is
> the whole deploy.
> **Named prohibition: do NOT remove `p_status` or `p_session_date` from the signature.**
> Keep both accepted; `p_status` becomes ignored with a `COMMENT` saying so — the
> deprecate-then-drop discipline used for `coaches.paynow_qr_url`.
> **Assertion:** calling with the OLD argument list still succeeds after the migration.

**Three refusals, all in the RPC** — not the UI:

> ⚠ **RISK I MITIGATION — a booking on a non-class day is permanently unmarkable.** Booked
> for a Tuesday on a Saturday class, the child never appears on a roster, is never marked,
> and **blocks the month indefinitely** with no visible cause.
> **Step:** refuse when the weekday of `p_session_date` ≠ the class's `day_of_week`.
> **Named prohibition: do NOT rely on the date picker.** A limit only the admin screen
> applies is not a limit (§7.32).

> ⚠ **RISK J MITIGATION — the two "already a customer" refusals.** Refuse if the student
> has an **active** enrolment in any class, and refuse if their parent holds a **live**
> package in this tenant (active, unexpired, `value_remaining > 0`). A closed enrolment,
> and a cancelled/expired/exhausted package, do **not** block.
> **Assertions (pgTAP), four:** active enrolment refused · closed enrolment allowed ·
> live package refused · expired package allowed. Each refusal also asserts
> `trial_bookings` did not grow.

> ⚠ **RISK V MITIGATION — a child can have more than one parent.** `parent_students` is
> many-to-many (that is what makes household split billing possible later). Checking only
> the first parent's packages would let the refusal be bypassed by whichever row came back
> first — non-deterministically.
> **Step:** the package check covers **every** parent linked to the student.
> **Assertion (pgTAP):** a child with two parents, where only the SECOND holds a live
> package, is still refused.

## Phase 4 — Engine (**write the tests first and prove them RED**)

1. **Expected students become per-date:**
   `expectedOn(date) = activeStudentIds ∪ live bookings on that date`, deduped, with
   booking dates joining `datesToCheck` so a trial on a session-less date still counts as
   unmarked.

> ⚠ **RISK U MITIGATION — an INACTIVE class hides its bookings from the engine.**
> `core.ts` only scans `classes.is_active = true` (already a known gap — `BACKLOG.md` →
> *An inactive CLASS is invisible to billing and to the block*). A booking on a class
> deactivated between the trial and the invoice run would therefore neither bill nor
> block: a **silent** unbilled trial, which is the whole failure this feature exists to
> prevent.
> **Step (cheapest correct one):** when the admin deactivates a class, refuse — or warn
> and require confirmation — if it has live future bookings, and say how many.
> **Assertion (vitest):** deactivating a class with a live booking surfaces the count.
> **Do NOT** widen the engine's class scan here; that is the backlog item's job and
> changing it would alter billing for every tenant. Record the interaction in that item.
2. **`trial_paid` prices via `trial_rate_on(tenant, class.category, date)`**, falling back
   to `class_rate_on`.

> ⚠ **RISK K MITIGATION — the fallback must never produce 0 and never throw.** Opposite
> failure shapes, both bad: a NULL coerced to 0 under-bills a frozen document (§11.6); a
> NULL that raises blocks **all** billing for a business that never set a trial price —
> which is both of them today.
> **Step:** `trialRateOn(...) ?? classRateOn(...)` — `??`, never `||` (a 0 slips through
> `||`; `CHECK (rate > 0)` is the second layer making 0 unreachable).

> ⚠ **RISK L MITIGATION — resolution order is money. Pin every branch.**
> **Assertions (Deno), five:** category rate set → the category rate · none set → the
> class rate · a rate effective AFTER the lesson → ignored · two rates, the later one in
> force → the later · `trial_free` contributes **0** even with a rate set.

> ⚠ **RISK M MITIGATION — the tripwire.** **Assertion (Deno):** a tenant with no bookings
> and no trial rates produces **byte-identical** invoices — same gross, net, item count.
> This is what proves the money path was untouched for the 2 real businesses. Packages
> keep their own existing tripwire, unchanged.

## Phase 5 — The other three "who is expected" callers

`SwimSyncAdmin/lib/classCoverage.ts`, `(coach)/today/index.tsx`,
`(coach)/classes/[id]/roster.tsx`.

> ⚠ **RISK N MITIGATION — structural, because four hand-written copies caused §7.18.**
> **Step:** put `expectedStudentsOn(date, activeStudentIds, bookingsByDate)` into
> `attendanceCompleteness.ts`, which already IS the one definition — duplicated across two
> apps and the engine exactly as its header describes, so it stays **three diffable
> edits**, not four divergent ones.
> **Named prohibition: do NOT inline `[...active, ...booked]` at a call site.**
> **Assertions:** the three copies `diff` clean but for the jest-vs-vitest import; and
> given one fixture with a booked-unmarked trial, `classCoverage` reports the same missing
> lesson the engine's `blocking` list does.

## Phase 6 — Admin: Trials page, rates, reminder

New nav item. **Book** (existing child *or* a new name, class, date — the picker offers
only that class's lesson dates, and only children with no active enrolment), an
**Upcoming** list, a **Past — unmarked** list flagged as what holds the month open, and
cancel per row. **Trial rates** as a table of *category → price*, each save recording a
new effective-dated row, with copy saying a change applies from today and does not alter
lessons already taught.

**The reminder** — a banner in the admin layout while any category has no `trial_rates`
row. Links to the rates table. No dismiss control: it disappears when the data exists.

> ⚠ **RISK O MITIGATION — reachability, both directions.** A platform admin belongs to no
> business and is closed out of single-business pages (§4.4); a coach must not book; and a
> banner that nags the wrong person is worse than none.
> **Step:** Trials goes in the tenant-admin nav in `lib/adminNav.ts`.
> **Assertions (vitest, existing `adminNav.test.ts`):** Trials appears for `tenant_admin`
> and **not** `platform_admin`; the banner renders only for a tenant admin with an
> unpriced category.

> **Known limit to state in PRD §7.17:** two classes in the *same* category cannot trial at
> different prices. The seam if it bites is a per-class override row, not a rewrite.

## Phase 7 — Coach: remove the walk-in form, keep the marking

Delete *Add a walk-in / trial* and its handler. The roster becomes **enrolled ∪
booked-for-this-date ∪ already-marked**, booked children labelled **Trial**.

> ⚠ **RISK P MITIGATION — this REMOVES a deployed capability.** Verified safe today (zero
> unclaimed students), but planning and building are days apart.
> **Step, immediately before deleting the form:**
> `SELECT COUNT(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = s.id);`
> **Pass value: 0.** If not, someone used it in between and those children need a
> Trials-page equivalent first.

## Phase 8 — Tests

**pgTAP:** category NOT NULL + RESTRICT (A); provisioned tenant has 2 categories (C);
`trial_rates` insert-only, cross-tenant category refused (F), category-with-rates not
deletable (E); partial unique index (G); old argument list resolves (H); non-class-day
(I); the four enrolment/package refusals (J).
**Mutation-test the booking gate** to the `tenant_provisioning.test.sql` standard: delete
the admin check and at least one assertion must fail **proving the ungated function wrote
a row**.

**Deno:** as Phase 4, **run twice** (§7.15).
**Driver:** rewrite `verify-trial-onboarding.mjs` — admin books ahead → the child appears
on **that lesson and not the next** → coach marks → billing follows → an unmarked booking
holds the month open.

## Phase 9 — Docs

PRD §7.17's trial half rewritten (incl. the same-category price limit and the
package/enrolment refusals); §7.3 notes categories are mandatory;
`TRIAL_ONBOARDING_PLAN.md` marked superseded on that half; **§7.43 retired**; §3's "clean
slate" corrected to the real figures; §9's "onboard the school" marked done.

---

## Deploy

Additive once RISK H's mitigation is in, so the usual order holds: **migrate → deploy
`generate-invoices` → push.** Then §8.10's checks: remote `pg_proc` grants (§7.39), CI
green, smoke a route only the new build has.

> ⚠ **RISK Q MITIGATION — this migration WRITES to live rows**, unlike every deploy since
> tenancy. It backfills 5 real classes and adds a NOT NULL constraint to a central table.
> **Steps:** take the schema+data backup as usual; run `db push --dry-run` and read it —
> **pass value: exactly the expected new files, nothing else**; and **after** pushing,
> assert on production:
> `SELECT COUNT(*) FROM classes WHERE category_id IS NULL;` → **0**, and
> `SELECT COUNT(*) FROM class_categories;` → **5** (Kah Hang's stray "Group" + 2 defaults
> × 2 tenants).

> ⚠ **RISK S MITIGATION — write the rollback BEFORE deploying, and confirm the migration
> is atomic.** Every deploy since tenancy has been purely additive, so "revert the Vercel
> build" has always been a sufficient undo. It is not here: once `NOT NULL` is applied,
> rolling back the app does not roll back the constraint.
> **Step:** confirm each migration file runs inside a single transaction (so a mid-file
> failure leaves nothing behind) — verify, do not assume.
> **Step:** write the down-migration **before** deploying and keep it to hand:
> `ALTER TABLE classes ALTER COLUMN category_id DROP NOT NULL;` plus restoring the FK to
> `ON DELETE SET NULL`. The backfilled `category_id` values are harmless if left.
> **Named prohibition: do NOT deploy this without that statement written down.** A
> rollback improvised during an incident is not a rollback.

> ⚠ **RISK T MITIGATION — a bounded window where creating a class fails.** Between
> `db push` and Vercel finishing (~2 minutes), the **old** admin build is live against the
> **new** constraint. Its class form treats the category as optional, so a class created in
> that window fails with a NOT NULL error.
> Structural avoidance is not available: the form cannot require a category before
> categories exist, and they only exist after this very migration — the dependency is
> circular. **This is therefore a vigilance mitigation, stated as such.**
> **Step:** do not create a class between `db push` and the Vercel deploy completing. The
> failure is loud, harmless and retryable — but it should be expected rather than
> discovered.

---

## Pre-commit gate

A box that cannot be ticked is a **blocker**, not a caveat.

**The five that decide whether money and billing stay correct:**

- [ ] **RISK R** — the booking snapshots its category; re-tagging a class does NOT reprice
      an already-booked trial; the engine never joins `classes` for a trial price.
- [ ] **RISK M** — tripwire green: no bookings, no trial rates → byte-identical invoices.
- [ ] **RISK L** — all five resolution branches asserted, incl. `trial_free` = 0.
- [ ] **RISK N** — `expectedStudentsOn` lives in `attendanceCompleteness.ts`; three copies
      `diff` clean; classCoverage agrees with the engine on one fixture.
- [ ] **RISK D** — test counts unchanged after the fixture churn: pgTAP 297, Deno 99,
      admin 100, app 75 (plus this change's new tests, counted deliberately).

**The rest:**

- [ ] **RISK H** — the OLD RPC argument list still resolves.
- [ ] **RISK B** — the migration raises rather than silently leaving a class untagged.
- [ ] **RISK C** — a freshly provisioned tenant has exactly 2 categories.
- [ ] **RISK J** — four refusals: active enrolment / closed enrolment / live package /
      expired package.
- [ ] **RISK I** — non-class-day refused in the RPC, not just the picker.
- [ ] **RISK G** — cancel-then-rebook succeeds.
- [ ] **RISK E, F, A** — category with rates not deletable; cross-tenant category refused;
      category with classes refused with a clear error.
- [ ] **RISK O** — Trials in the tenant-admin nav only; banner only for an unpriced tenant
      admin.
- [ ] **RISK P** — unclaimed-student count is **0** immediately before deleting the coach
      form.
- [ ] **RISK V** — a child whose SECOND parent holds a package is still refused.
- [ ] **RISK U** — deactivating a class with live bookings surfaces the count.
- [ ] **RISK S** — the down-migration is written down BEFORE deploying, and migration files
      are confirmed transactional.
- [ ] **RISK T** — nobody creates a class during the deploy window.
- [ ] **RISK Q** — post-deploy: 0 untagged classes, 5 categories on production.
- [ ] Booking gate mutation-tested; Deno run twice; both apps typecheck under §7.11's
      stubbed condition.

---

## Graduating to `HANDOVER.md` §7

- **Retire §7.43** — `lesson_sessions` returns to a single writer.
- **New:** *a PostgREST function signature is a contract.* Removing or renaming a
  parameter breaks the deployed caller the instant the migration lands, because resolution
  is by exact argument list. A signature change is a CONTRACT — deploy the app first, or
  keep the old parameter accepted-and-ignored. An earlier draft of this plan mislabelled
  it EXPAND.
- **New:** *`classes.category_id` is a mutable column that money now depends on.* Every
  other input to a price in this schema is effective-dated (`class_rates`, wage rates,
  `trial_rates`); the class's **category** is not. Anything that prices from it must
  snapshot it at the moment of sale, or re-tagging a class silently reprices work already
  done. `trial_bookings.category_id` is that snapshot. The same trap waits for any future
  feature that prices by category.
