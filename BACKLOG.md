# SwimSync — Backlog

_Last updated: 2026-08-09 (4th) — **the last of the audit gap SHIPPED and was removed**
(Wave 1 Chunk 3, `20260809000200`): *Direct writes to `students` are audited by nobody* is
struck from the Build order **and** its own section. **Wave 1 is now ONE item** — Chunk 4,
the inactive-class engine fix, the only one that touches money. **One item added**, and it
is the hole the shipped work disclosed rather than closed: *Deleting an admin destroys the
audit history* (**S**) — `prepare_admin_delete()` purges the target's `audit_log` rows,
which is exactly the contact-detail history a disputed claim needs. It carries a named
prohibition: do **not** make `actor_id` nullable to solve it (§7.50). *Attendance edit
history view* had its blocker cleared — the writers now exist, so the reader is buildable._

_Previously, 2026-08-09 (3rd) — **the entire PayNow / package chain SHIPPED and was
removed** (Wave 1 Chunk 2, `docs/plans/WAVE_1_PLAN.md`): *Give package requests a
reference number*, *Demote the static PayNow QR upload*, *The PayNow screen calls the
business "Coach"* and *A link to the admin panel from coach Settings* — struck from the
Build order **and** their own sections. **Wave 1 is now two items**, both migrations.
The *native store builds* decision row was settled rather than deferred: the upload is
**collapsed, not hidden**, and the row says why. **One item added**: *A PayNow ID can be
saved that no QR can be built from* (**S**) — a nine-digit mobile or a garbage UEN saves
cleanly, looks configured everywhere, and silently produces no QR._

_Previously, 2026-08-09 (2nd) — **two items SHIPPED and removed** (Wave 1 Chunk 1,
`docs/plans/WAVE_1_PLAN.md`): *Check column geometry on every admin table* and
*`verify-levels.mjs` is not hermetic*. **Struck from the Build order as well as their own
sections** — that is the two-places rule this file's own ⚠ is about. **Two items added**,
both found by the tooling that shipped: *`fixtures-trial-onboarding-teardown.sql` deletes
invoices it does not own* (**S** — it breaks the "owns only its own rows" rule the CI
round-trip enforces, and the next fixture to touch invoices hits it) and *`/makeups` and
`/trials` render a 79px DATE column* (**S**, measured not guessed)._

_Previously, 2026-08-09 — one item added: *The class ROSTER hides a lesson whose only
attendee is a guest* (**S**, Billing and payments; also in the unordered pool). Found while
fixing `verify-trials.mjs` — the roster gates its Mark Attendance button on enrolments
alone, so a trial-only lesson is invisible there while the Schedule tab shows it. **Not a
billing hole**, which is why it is unranked: the lesson stays reachable and markable._

_Previously, 2026-08-08 (second pass) — **`## Build order` is no longer empty.** It had
been since 2026-07-19. The queue is now ranked by **rework cost** rather than value or size
— each item placed so finishing it never sends you back into something already built
(method: `.claude/skills/backlog-prioritisation/SKILL.md`). Five waves, plus an unordered
pool and a strictly-ordered email/scheduler chain. **Six decisions settled with the user
are recorded in a table at the top of the ranking**, because an unrecorded decision is
re-litigated: co-admin permission splitting (yes, not now), coach-per-lesson rather than
per-class, trainee pay (own rate), substitute pay (whoever taught), multiple classes per
child (yes, soon), and native builds (not yet).

**Four new items, one rewrite, one reversal.** New: *A lesson can have a substitute coach,
temporarily* and *Trainee coaches shadow the main coach on a lesson* (Coach workflow), *A
lesson recorded into an already-BILLED month is reported, and settled* (replacing "A
session added AFTER a month is invoiced is never billed"), and *An owner-only accounting
page* (Admin and operations). Superseded: *Multiple coaches per class* — both real needs
turned out to be session-level, so a class-level join table would have been rebuilt.
**Reversed: the *Deliberately not doing* row on substitute coaches** — it claimed
`session_pay_overrides` already supported it, which is false (that table can suppress a
lesson's pay and cannot name another coach). *Revenue reporting* is **absorbed** into the
accounting page, which adds the question it never asked: who is allowed to see it.

_Previously, 2026-08-08 — **two items SHIPPED (struck through in place, not deleted),
one DEPRIORITISED, and one idea refused.** Shipped: *A coach week view*, which went
further than it asked — the week view **replaced the Today tab outright** rather than
reshaping the Classes tab, so the coach's tabs are now Schedule / Classes / My Pay /
Settings — and *Pay and claim straight from the parent's invoice LIST*. Deprioritised:
**Revenue reporting**, moved from *Unordered — no dependencies* to *Later*, which is a
correction as much as a demotion (its accrual-vs-cash question is a dependency, so it
never belonged under "no dependencies"). Refused: a **configurable first-day-of-week**,
considered and dropped with the user — `weekOrder.ts` is Monday-first because it mirrors
the Postgres enum declaration order, and today-first rendering already overrides most of
what the setting would buy. **All of it is LOCAL ONLY at time of writing; see HANDOVER §9.**

Both shipped items carry a **corrected prediction** in their entry, which is the part
worth reading: the week view's filed shape (reshape the Classes tab) was wrong about
where it belonged, and the parent-billing item's predicted double-fire bug **does not
exist** — nested Touchables do not propagate a press on RN-web, tested by deliberately
re-nesting them._

_Previously, 2026-08-06 (second session) — **two items SHIPPED and removed:** *Tie the
attendance-marking window to un-invoiced months* and *`book_trial` has no date floor*, both
closed by `20260806000200` (PRD §7.6). The first shipped **before its own stated trigger** —
it said "revisit the first time a month is billed late", and the user chose to build it as
insurance instead, one month into a live monthly billing rhythm. Its filed fix was also
**wrong in one detail**: "the earliest UNSEALED billing month" leaves no floor at all,
because a month with nothing recorded is never sealed (§8a.1), so gaps reach back forever.
The shipped rule anchors on the **latest** seal instead, with the business's `created_at` as
the fallback when nothing has ever been billed._

_Previously, 2026-08-06 — **one item SHIPPED and removed:** *Multiple admin accounts per
tenant* (PRD §4.3, §8.31 — the join-table sketch it carried was superseded by
`tenants.owner_profile_id`, reasoning in `docs/ARCHITECTURE.md` §6); *Disable a staff
account* narrowed to its remaining COACH half; two new items: *Split co-admin permissions*
and *Owner transfer*. Previously 2026-08-05: *Run the UI drivers in CI*
(HANDOVER §8.30) — all 32 drivers now run nightly under `.github/workflows/ui-drivers.yml`
via `run-all-drivers.sh`, failures collected in one rolling `ui-driver-rot` issue. The
first sweep found eight broken drivers, none a product bug, which was the item's whole
thesis._

_Previously, 2026-08-04 (second session) — **one item filed, two corrected, none shipped
from here.** Filed: *decide whether `service_role` deserves the whitelist treatment* — the
role where grants genuinely are the only gate, and where the `authenticated` oracle
deliberately does **not** transfer. *Run the UI drivers in CI* gained the evidence it was
missing: `verify-parent-claim.mjs` was found red since **58 minutes after it was written**,
and §7.79's static detector **cannot** catch that class — the driver can fail, does fail,
and exits non-zero to nobody. *Direct writes to `students` are audited by nobody* had a
stale premise corrected: browser-written audit rows were possible-but-wrong, and
`20260804000300` made them **impossible**. Note the `anon` REFERENCES/TRIGGER/TRUNCATE
concern named in the line below is **closed** — `20260804000400` revoked it and a remote
dump on 2026-08-04 confirms `anon` holds nothing on any table._

_Previously, 2026-08-04 — **three items shipped and removed** (§8.28): *revoke `anon`
EXECUTE from the remaining SECURITY DEFINER functions*, *a business cannot read its own
audit trail*, and *retire `tenants.kind` / narrow `coaches_without_rate`* — the last of
which was **half-wrong as filed**: the SQL had been correct since 2026-07-19 and the
"fix" of 2026-08-01 had replaced a working column with a browser scan (§7.83). One item
filed: **`anon`'s REFERENCES/TRIGGER/TRUNCATE on 37 production tables** — real, from
Supabase's own template rather than this repo, and currently unreachable. One
**Deliberately not doing** row: the blanket `ALTER DEFAULT PRIVILEGES` revoke, refused
twice. *Attendance edit history view* had its premise corrected — it is now actually true.
Previously, 2026-08-03 — six items filed from a day of real app use: the ordered pair *give package requests a reference number* → *demote the static PayNow QR upload* (**do them in that order**; the reverse breaks paying for a package), the PayNow screen's "Coach" copy, *pay and claim from the parent's invoice list*, *a coach week view*, and *a link to the admin panel from coach Settings*. One **Deliberately not doing** row: **any invoice or payment count in the coach app** — the user's decision, and the kind that gets re-litigated. One item filed and then **deleted the same day because its premise was false**: `verify-tz-saturday.mjs` was recorded as assertion-less on the strength of a bad grep, and running it showed 5/5 (§7.79). The *coach week view* entry was corrected too — the Classes tab gained weekday grouping on 2026-08-03, so the item is now about DATED lessons, not the timetable that shipped. Earlier, 2026-08-02: *Mark package-funded lines on the invoice detail* shipped and was removed_

Things SwimSync **could** become. Nothing here is built or committed to — if it were
built, it would be in [PRD.md](PRD.md) instead. See [README.md](README.md) for why the
documents are split this way.

**What's actually being worked on right now lives in [HANDOVER.md](HANDOVER.md) §9**,
not here. This document is the queue; the handover is the current shift.

### How to use this

Every item carries a **Why**. That's the rule that keeps this from becoming a wishlist:
if you can't say who it helps and what breaks without it, it isn't ready to be an item
yet. Where a decision has already been made about *how* a thing should work if it's ever
built, it's recorded under **Notes** — those are hard-won and worth more than the item
itself.

Items below are grouped by **theme**, not priority — the **[Build order](#build-order)**
section right below ranks them for the current stretch. Rough sizes: **S** = an afternoon,
**M** = a few days, **L** = a genuine project.

**Provenance tags** point back to where an idea came from, so the original reasoning
stays reachable:

- `[MVP-excluded]` — one of the 14 items PRD §3.2 deliberately ruled out of the MVP.
  §3.2 stays in the PRD as the historical record of that scope decision; the items are
  mirrored here now that SwimSync is past pure MVP-building and they're live options
  rather than a boundary.
- `[Phase 2]` / `[Phase 3]` — from the PRD §15 release plan.
- `[handover]` — carried over from HANDOVER §9, which was doing the backlog's job before
  this document existed.

---

## Build order

**Ordered to prevent RE-WORK, not by value or by size:** each item is placed so that
finishing it never sends you back into something already built. Where two items have no
edge between them they share a wave and are picked by value. Method:
`.claude/skills/backlog-prioritisation/SKILL.md`. Sizes as above (**S**/**M**/**L**).

This ranking lives **only here** (one source of truth — deliberately not duplicated as a
number on every heading, which would just drift). The item bodies below stay grouped by
theme.

> ⚠ **A SHIP HAS TO BE MARKED IN TWO PLACES, AND THE RANKED LIST IS THE ONE THAT GETS
> FORGOTTEN.** Three items were found listed here as unbuilt while their own sections read
> SHIPPED — *Makeup lessons* (6 days), *Editing a student's contact details* (6 weeks), and
> *Pay and claim from the parent's invoice list* (caught during the session that shipped
> it). The item bodies were correct every time; these lists were not, and a list is what
> someone picking work actually reads. **When you strike an item through, grep this
> document for its name before you close the file.**

### The near-term plan — build roughly in this order

_(Re-ranked **2026-08-08** by rework cost. The previous ranking had been empty since
2026-07-19. Five shaping decisions were settled with the user the same day and are recorded
below, because an unrecorded decision is re-litigated.)_

#### The six decisions this ranking rests on (settled 2026-08-08)

| Decision | Answer | Consequence for the order |
|---|---|---|
| Split co-admin permissions? | **Yes eventually, not now** | *Split co-admin permissions* moves to Later. The first real need — an **owner-only accounting page** — needs no capability model, because `is_tenant_owner()` already exists |
| Coach per class or per lesson? | **Per lesson, on top of class assignment** | A permanent handover already works. A **temporary substitute** and **trainee/shadow coaches** are new lesson-level items; *Multiple coaches per class* is superseded |
| Trainee coach pay? | **Paid at their own rate** | A shadowed lesson produces two payout rows — the payroll half of the accounting page must come after it |
| Substitute pay? | **Whoever actually taught it** | The session override moves money, so it is a wages change, not just a roster label |
| Multiple classes per child? | **Yes, and soon** | Promoted to Wave 2. It drops `one_active_enrolment_per_student`, so every enrolment-shaped surface built after it inherits the new model — and everything built before it gets reworked |
| Native store builds ($99/yr)? | **Not yet — stay web-only** | *Push notifications* stays blocked. **Settled by what shipped 2026-08-09:** the static PayNow QR upload was neither deleted nor hidden — it is **collapsed behind a disclosure and always present**, which keeps the native fallback path alive *and* survives a stored-but-unencodable PayNow ID. Any future native decision inherits that, not a conditional |

#### Wave 1 — cheap, independent, and inherited by everything after (**COMPLETE**)

**All four chunks are DONE.** Chunk 4 shipped 2026-08-09: `classes.is_active` means
scheduling and nothing else, the engine bills retired classes, and the admin can retire and
restore one from the Classes page (`deactivate_class()` / `reactivate_class()`, three
refusals, no overrides). RISK 1 was closed three ways — a `deactivated_at` date clamps what
an inactive class is expected to have run, the RPC refuses to create the blocking state, and
the Classes page can show and restore a retired class. The production audit it gated on
returned zero rows on all three queries.

**What it did NOT close is below** — see *An unmarked BOOKING is invisible when its class
has no active enrolments*.

_(Eight items have now left this wave. **Direct writes to `students` are audited by
nobody** shipped 2026-08-09 as Chunk 3 — an `AFTER UPDATE … WHEN (OLD.* IS DISTINCT FROM
NEW.*)` trigger, `SECURITY DEFINER`, recording `to_jsonb(OLD)`/`to_jsonb(NEW)`. It left one
disclosed hole behind, filed separately below as *Deleting an admin destroys the audit
history*. **Pay and claim from the parent's invoice LIST**
shipped 2026-08-08 alongside the Schedule tab. **Check column geometry on every admin
table** and **`verify-levels.mjs` is not hermetic** shipped 2026-08-09 as Chunk 1 of
`docs/plans/WAVE_1_PLAN.md`. **Give package requests a reference number**, **demote the
static PayNow QR upload**, **the PayNow screen calls the business "Coach"** and **a link
to the admin panel from coach Settings** all shipped 2026-08-09 as Chunk 2 — see PRD
§7.10, §7.16, §7.21. The "hide, do not delete" decision in the table above was honoured
**and then strengthened**: the upload is not hidden at all, only collapsed behind a
disclosure, because a stored-but-unencodable PayNow ID makes "hide when a proxy exists"
one typo away from a business that cannot be paid.)_

#### Wave 2 — **Multiple classes per child** (M)

The single largest retrofit tax in the backlog, and the user's answer is *build it soon*.
It drops the `one_active_enrolment_per_student` constraint and reworks the enrolment UI,
`expectedStudentsOn()` and the attendance rosters. Billing needs less than expected —
the engine already sums per attendance record.

**It goes before Waves 3–5 because every one of them touches enrolment or the roster.**
*Convert a trial into an enrolled student* and *Book a make-up from the Attendance page*
both sit on this ground and are deliberately held until after it. Trials and make-ups
themselves are unaffected — a booking was never an enrolment.

#### Wave 3 — **The lesson-level coach roster** (M/L)

One schema change (`CLAUDE.md`: one in flight at a time), built once with a main/shadow
distinction rather than a substitute column later widened:

9. **A lesson can have a substitute coach, temporarily** — a per-session
   `taught_by_coach_id`; pay follows it. `session_pay_overrides` **cannot** express this.
10. **Trainee coaches shadow the main coach** — one main coach plus N trainees, each paid
    at their own rate, so a lesson produces more than one payout row.
11. Fold in **the attendance screen trusts a `sessionId` in the URL** (S) — same file, and
    its own note says "do it the next time that screen is opened".

⚠ **The blast radius is coach RLS, not the roster.** A coach reaches a class today via
`classes.coach_id`; a substitute or trainee must open a lesson of a class they do not own.
`current_coach_id()` feeds that policy set — pgTAP before any UI.

> **The Schedule tab's exposure here is already measured, so do not re-derive it.** It
> resolves "my lessons" from `classes.coach_id` and will show the wrong week for a
> substitute — but the entire coupling is **two lines of one query** in
> `schedule/index.tsx`'s `loadData` (the `coaches` lookup, then `.eq("coach_id", coach.id)`
> on `classes`). **`lib/scheduleWeek.*` and `lib/scheduleBuckets.*` need NO change at all** —
> they are pure date and bucket maths with zero code references to a coach. Wave 3 changes
> only *which class ids the query selects*; the sections, week arithmetic and marking-state
> logic are inherited unchanged. (Checked 2026-08-08.)

#### Wave 4 — **A lesson recorded into an already-BILLED month is reported, and settled** (S/M)

Placed after Wave 2 because a **backdated enrolment** is its main trigger, and Wave 2
rewrites enrolment. Reuses the `unclaimed_billable` reporting shape and
`student_settlements`; adds no invoice concept and no override. Correct
`schedule_extra_lesson()`'s comment in the same pass — it claims the floor blocks this and
it does not.

#### Wave 5 — admin authority

12. **Owner transfer** (S/M) — a live gap: a lost owner freezes a business today and SQL is
    the only remedy.
13. **Disable a COACH account** (M) — needs Wave 1 #6 and the coach RLS model settled in
    Wave 3.

### Unordered — no dependencies, pick by value

Upcoming-lessons view for parents (S), Maps deep link (S), Moving a student between
businesses (S), The family-status search client-side scan (S), Better filtering/search (S),
Export to CSV (S), Tick off swimming skills per child (M), Email-confirmation
copy/templates (S).

**Three sit here but carry one edge each:**

- **Attendance edit history view** (S) — **its blocker cleared 2026-08-09**: the writers
  shipped (Wave 1 Chunk 3, `20260809000200`), so `audit_log` now records student edits as
  well as attendance saves, every row is tenant-stamped, and the reader is buildable. Two
  things to know before building it: rows written by a backend path carry **no** actor by
  design, so the screen must render "system" rather than blank; and `prepare_admin_delete()`
  purges a deleted admin's rows, so the history has holes with a known cause — see
  *Deleting an admin destroys the audit history*.
- **Convert a trial into an enrolled student** (S) and **Book a make-up from the
  Attendance page** (S) — after Wave 2, which changes what an enrolment is.
- **The class ROSTER hides a lesson whose only attendee is a guest** (S) — no hard edge,
  but it rewrites the roster's date derivation, which Waves 2 and 3 both rework. Cheapest
  folded into whichever of those opens `roster.tsx` first; standalone only if a coach
  actually reports it. Raised 2026-08-09 (§7.100).

### The email / scheduler chain — strict internal order, start any time

**Track invoice-email delivery + retry** (S) establishes the `sent_at` + `IS NULL`
idempotency pattern in `email.ts` → **Credit-note email notifications** (M) inherits it
rather than inventing a second one → *then* the cron decision (HANDOVER §9) gates
**Parent-facing package notifications** (S) and **Automated reminder workflows** (M).

### Later — big features carrying their own dependencies

**An owner-only accounting page (M — *absorbs Revenue reporting*; decide accrual-vs-cash
first; not a priority per the user 2026-08-08)** — build after the trainee-coach item, or
its payroll half is written twice. Needs no capability model.
**Split co-admin permissions (M)** — *yes eventually*; the accounting page does not wait
on it. Parent self-enrolment (M — *needs class capacity, which does not exist*),
Coach-assisted assignment (M), Household split billing (M — *needs a credit-splitting
rule*), Auto PayNow detection (L — *the CSV-import M is the 10% worth doing first*),
In-app payment gateway (L), Native store builds (M — *deferred; not spending the $99 yet*)
→ Push notifications (M — *blocked by it*), Check the logo for brand collisions (S —
*before native builds, whenever those happen*), Bulk WhatsApp Cloud API (M — *only on a
real tenant's request*), Multi-language (M — **decide or refuse it; it is accruing
retrofit tax unranked**), Decide whether `service_role` deserves the whitelist treatment
(M — *a question until the usage audit exists*), More polished dashboards (S — *delete
unless a real question replaces it*).

**Two items are deliberately LAST, and get cheaper by waiting:**

- **Generate real Supabase `Database` types** (M) — a schema snapshot. Waves 2 and 3 are
  both migrations; every one landed first invalidates it.
- **Deeper component-render tests** (M) — they pin screens the planned redesign will
  rewrite.

**Shared `lessonDates.ts` package (M)** stays not-recommended and unranked — free only if
workspaces arrive for another reason.

---

## Coach workflow

### ~~Makeup lessons~~ — SHIPPED 2026-08-02 as the guest-pass model (PRD §7.20)
The two invariants it was expected to break held un-broken: a make-up is a **booking**
(the trial_bookings shape), never a second enrolment, and billing still follows
attendance rows — a guest's row bills at their home class's rate or draws the family's
package by the booking's snapshotted category. No "makeup credit" ledger was needed
because a missed lesson never billed in the first place. Three follow-ups filed below:
*Book a make-up from the Attendance page*, *A different-coach PRIVATE make-up*, and the
`book_trial` date-floor asymmetry.

### Book a make-up from the Attendance page — **S**
The admin Attendance page can filter to `absent` / `cancelled_*` rows but has no action
column — the most natural moment to offer "book a make-up" is while looking at the miss.
The Make-ups page stays primary (a booking you cannot see is forgotten and holds the
month open); this is an entry point, not a second home.

### A different-coach PRIVATE make-up — **M**
A private-category make-up today is an **Extra lesson of the child's own class** — same
coach by construction. A school whose private coach is away wants the make-up taught by a
*different* coach, which means a temporary one-off class (its own coach, rate, wage row,
and cleanup) or a per-lesson coach override. Deliberately deferred from the guest-pass
work: real complexity, no requester yet.

### Tick off swimming skills per child — **M**
Mark which of a level's skills a child has passed, so a coach can see "Ethan has 4 of 6
for Toddler 2" and a parent can watch progress accumulate.

**Why:** the skills exist as data now (PRD §7.15) and describe the LEVEL only. The obvious
next question from any coach looking at that list is "which of these has this child
done?" — which is the actual pedagogical record a swim school keeps, and today still lives
on paper or in the coach's head.

**Notes:** deliberately deferred when the skill lists were built 2026-07-19, and the data
was modelled as rows rather than prose *specifically* so this would not need a migration
out of a text blob. What makes it an M rather than an S:

- **Coaches have no write path to students**, by design — granting them `UPDATE` would
  also let them edit names, dates of birth and notes, because RLS is row-level, not
  column-level. This needs its own narrow table (`student_skill_progress`) with its own
  policy, not a widening of `students_update`.
- **Decide what happens when a child changes level.** Records should almost certainly be
  kept and simply not shown — a child who moves up and later moves back should not lose
  their history — but that is a decision, not a default.
- **Decide whether a skill is binary or graded.** The source curriculum is a flat list,
  which suggests passed / not-passed; anything richer is a bigger claim about how coaches
  actually assess.
- Watch the read cost: a roster of six children each with six skills is 36 rows, so fetch
  it per class rather than per student.

### Convert a trial into an enrolled student — **S**
After a trial is marked, give the Trials page a **"Convert to enrolled"** action instead
of sending the admin to Unassigned Children to do it.

**Why:** converting is the whole point of running a trial, and it currently has no home.
Since 2026-07-26 a child with an *upcoming* trial is deliberately hidden from Unassigned
Children (they need no decision yet), so the conversion path is: wait for the trial date
to pass, then find them on a page named after a different problem. The decision belongs
where the trial does.

**Notes:** the enrolment is the dangerous half — an active enrolment makes the child
expected at **every** lesson, and unmarked attendance blocks billing outright. So this is
a relabelling of an existing guarded action, not a new capability: reuse the same insert
Unassigned Children performs, and keep the "this makes them expected every week" wording.
The natural trigger is the Trials page's *past — needs marking* list, once the lesson has
been marked.

### ~~Editing a student's PARENT contact details~~ — **S** — **DONE 2026-07-26**
Shipped and deployed (`3832670`): every child on the admin Students page has a **Contact
details** action. **PRD §7.19** describes the behaviour; `CONTACT_DETAILS_PLAN.md` has the
plan, the risk review and the walked gate.

The reasoning below is kept because two of its calls were **settled differently** than it
proposed, and the differences are the design:

- **A claimed child is READ-ONLY, not editable.** The item left this open. Settled: the
  admin sees every linked parent's own `profiles` row, and the family maintains it in the
  app. A second editable copy would be the stale duplicate `students.age` was removed for
  — and `is_tenant_admin(NULL)` refuses the write anyway, since a parent is global.
- **A pending claim LOCKS the fields**, which the item did not anticipate.
  `student_claims.match_reason` is a snapshot, so editing under a live claim makes the
  admin approve on a reason that stopped being true.
- The phone check is **advisory everywhere and blocks nothing**; the `964` on production
  is now fixable, which was the point.

**Still outstanding, and split out above:** *Direct writes to `students` are audited by
nobody* — this screen and `setLevel()` both write with no `audit_log` row.

<details><summary>Original item (kept for the reasoning)</summary>

There is no way to change `provisional_contact_name` / `_phone` / `_email` on an existing
student.

> **These are the PARENT's contact details, stored on the child's row — not the child's.**
> A child has no phone or email of their own anywhere in the model, and should not. The
> columns exist for the window before the adult who brought the child has an account:
> `provisional_contact_phone`'s own `COMMENT` reads *"the number the coach arranged the
> trial on"*. All three are load-bearing, not just record-keeping — `_email` and `_phone`
> are the top two ranked signals in `find_student_candidates()`, and **`_name` is used as
> the invited parent's `full_name`** (`invite-parent/route.ts`), which is why a blank one
> showed an unnamed parent on the admin roster (HANDOVER §8.12).

**Why:** those fields are now how a child is matched to their parent's account
(PRD §7.18), and the phone is **required** when a child is created — but only *going
forward*. Every child added before 2026-07-26 has no contact details at all, so they can
only ever be matched by name, which is the weakest signal. There is no screen that can fix
that, and on production several real children are in exactly that state.

**Notes:** one of them has `964` stored as a phone, which `normalize_phone()` correctly
rejects as too short to be a signal — so bad data is already there and unfixable through
the UI. The admin's edit-student path is the obvious home, and **no migration is needed**:
`students_update` already grants `is_tenant_admin(tenant_id)` (`20260718000900_tenant_rls`).
Coaches must not get it: granting them `UPDATE` on `students` also exposes names, DOBs and
notes, because RLS is row-level, not column-level.

**Decide before building — should these stay editable once the child is CLAIMED?**
Nothing clears them on claim, link or merge (`merge_students()` `COALESCE`s them), so a
claimed child keeps them indefinitely. The argument for read-only-after-claim: the real
contact details then live on `profiles`, and a second editable copy on the student row is a
stale duplicate of exactly the kind `students.age` and `classes.price_per_lesson` were
removed for — plus it feeds the matcher for a child who can no longer be a candidate.

</details>

### Attendance edit history view — **S** `[Phase 2]`
Surface the existing audit trail in the UI.

**Why:** every attendance edit is already logged to `audit_log`, but nobody can see it
without SQL. When a parent disputes a charge, the answer exists and is unreachable.

**Notes:** the data is already there — this is a read-only view, not a new capability.
Admin panel first; the coach probably doesn't need it.

**The premise is now actually true (2026-08-04).** This item used to carry a warning that
"the data is already there" was only *half* true: `audit_log.tenant_id` was unset by most
writers, and `is_tenant_admin(NULL)` returns FALSE, so a business could read almost none
of its own trail — a history screen would have shown claims and merges and silently
omitted every attendance save. `20260804000300` stamps every row from its entity by
trigger and backfilled the 81 unstamped rows production held. **Two things to still get
right when building this:** the rows are visible to the *tenant admin*, not to the coach
whose edit they record; and `old_value`/`new_value` are full `to_jsonb(OLD/NEW)` snapshots,
so the screen must diff them rather than print them — the dispute this exists for is
*what the number used to be*.

### ~~A coach week view~~ — **SHIPPED 2026-08-08 as the Schedule tab** (PRD §14.2)
It went further than this item asked. Rather than turning the *Classes* tab into a week
strip, the week view **replaced the Today tab outright** — the user's call, on the grounds
that two tabs both listing today's lessons with marking chips is duplication in the app's
most prominent navigation. Tabs are now **Schedule / Classes / My Pay / Settings**, and
the Classes tab and its roster are untouched.

Three decisions worth keeping, because each was reached by rejecting the obvious version:

- **Sections are driven by MARKING STATE, not the calendar** — NEEDS MARKING / TODAY /
  COMING UP / DONE. A purely calendar split (today / upcoming / past) collapses into one
  undifferentiated list on any week that is not the current one, which is exactly the week
  a selector exists to reach.
- **NEEDS MARKING is FLOOR-scoped, never week-scoped**, and it is the only section that
  ignores the selector. Week-scoping it would hide a straggler the coach has no reason to
  go looking for, and unmarked attendance blocks billing with no override. Note the range
  is not unbounded: `markable_floor` already means "back to the latest unsealed month".
- **The week is held as an OFFSET integer, not a stored Monday** (§7.95).

Deliberately NOT built: a configurable first-day-of-week. `weekOrder.ts` is Monday-first
*because* it mirrors the Postgres `day_of_week` enum declaration order, and today-first
rendering already overrides most of what the setting would buy. Considered and dropped
with the user 2026-08-08; do not file it as an oversight.

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
  on substitute coaches asserted "the schema already supports it"; that row is now a
  pointer here.
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
- **This supersedes _Multiple coaches per class_**: the need is per-lesson, not per-class.

---

## Billing and payments

### A PayNow ID can be saved that no QR can be built from — **S** `[found 2026-08-09]`
Tell the admin, at save time, that the PayNow UEN or mobile they just entered cannot be
encoded — instead of letting them find out from a parent who could not pay.

**Why:** `paynow_uen` is stored **completely raw** (`invoices/page.tsx` uses
`blankToNull(raw)` and nothing else), and `paynow_mobile` goes through
`normalizeSgPhone`, which only **strips non-digits** — `checkSgPhone` is advisory and
"never blocks", and there is no DB `CHECK` (`20260802000600:44-47`, deliberately, so a
blocked save cannot strand anyone). So `912345678` — nine digits, one typo — saves
cleanly and looks configured on every screen, while `buildPayNowPayload` throws on
`!/^\d{8}$/` and no parent at that business ever sees a dynamic QR. Today the damage is
bounded: `verify-paynow-fallback.mjs` pins that the parent still gets a payable PayNow ID
+ amount + reference, and the coach can still upload a fallback image. But **nobody is
ever told the QR is broken**, so the business quietly collects nothing through the
mechanism it thinks it configured.

**Notes:** the UEN half is worse than the mobile half — a garbage UEN produces a
*valid-looking* QR that pays nowhere, which is `lib/paynow.ts`'s "wrong-yet-valid" RISK 2
case, and no amount of advisory phone checking touches it. **The right shape is almost
certainly a dry run, not a validator**: call `buildPayNowPayload()` with a $1 amount and
the entered proxy at save time and show a warning if it throws — that reuses the one
authority instead of adding a second copy of the rule (§7.18). Keep it **advisory**: the
sgPhone doctrine is deliberate and a blocked save helps nobody. Ideally show the admin
the QR that would be generated, which makes the failure self-evident. Do **not** add a DB
`CHECK`. Raised while building Wave 1 Chunk 2, where this was explicitly out of scope.

### Automatic PayNow payment detection — **L** `[MVP-excluded]` `[Phase 3]`
Reconcile incoming PayNow transfers against outstanding invoices automatically.

**Why:** marking invoices paid by hand is the coach's most repetitive monthly chore, and
the one most likely to be done wrong or late — every "have you paid?" message to a
parent who already paid comes from this gap.

**Notes:** the hard part isn't SwimSync, it's the bank. Singapore retail bank feeds
aren't openly available to a part-timer; realistically this needs either a payments
provider or manual bank-statement import. **A CSV/statement import that suggests matches
is the 10% of this that delivers 80% of the value** and is an M, not an L — worth
considering first.

### In-app payment gateway — **L** `[MVP-excluded]` `[Phase 3]`
Take card/PayNow payment inside the app rather than sending parents to a QR code.

**Why:** removes the "did they actually pay?" gap entirely, and gets rid of manual
verification with it.

**Notes:** in tension with the product's whole economic premise. PayNow QR is **free**;
a gateway takes a cut of a part-time coach's margin, and the current stack is
deliberately $0. Probably only makes sense if SwimSync ever serves coaches other than
its owner. Related: automatic PayNow detection above gets much of the benefit without
the fee.

### Parent-facing package notifications — **S**
Email/notify the parent when their package runs low or approaches expiry.

**Why:** today the parent must open the app to notice; the admin has a "running low"
filter (per-tenant threshold) but the nudge still travels by hand. The building blocks
exist: `package_live_balances()` is the number, and the `package-emails` function is
the delivery path — this is a scheduled check away (needs cron, like the reminder
chain).

### In-app package refunds — **S**
Record a refund against a cancelled package instead of settling fully offline.

**Why:** cancellation freezes the remaining value and shows it, but the money movement
lives outside SwimSync — fine at one tenant, unauditable at ten. **Notes:** the
commercial convention discussed 2026-07-20: refund = paid − (lessons taken × walk-in
rate), i.e. claw back the volume discount on lessons actually used; don't apportion
"bonus vs cash".

### Household-level split billing — **M** `[MVP-excluded]`
Let two parents (e.g. separated households) each receive a share of the invoice.

**Why:** requested often enough in family-facing products to be worth recording. Today
one invoice goes to one parent account, and any splitting happens between the parents
off-platform.

**Notes:** the data model is closer to ready than it looks — `parent_students` is
already **many-to-many**, so a student can have two parents. What's missing is a split
rule and a decision about which parent's credit balance a correction lands in. Credit is
pooled **per parent** (`docs/ARCHITECTURE.md` §6), so splitting invoices without splitting credit
would produce a ledger nobody can explain.

### ~~Revenue reporting~~ — **ABSORBED 2026-08-08** into *An owner-only accounting page*
Tell a business what it actually earned in a month.

**Absorbed, not dropped.** The content is now the main half of *An owner-only accounting
page* (**Admin and operations**), which adds the one thing this item never said: **who is
allowed to see it**. That turned out to be the deciding question — it is the first concrete
thing a co-admin should not see, and it needs no capability model because
`is_tenant_owner()` already exists. Everything below still applies and is the reason the
accounting page carries a decide-first question.

**Deprioritised 2026-08-08**, and moved from *Unordered — no dependencies* to *Later*.
Raised as a build candidate one month into the live billing rhythm and declined by the
user — the question is real but not urgent while there is one business and one operator
who can read the invoice list directly. The move is also a correction: the item's own
notes say the accrual-vs-cash question must be settled **before any code**, which is a
dependency, so it never belonged under *no dependencies*. That decision is still the
first thing to settle if this is picked up.

**Why:** SwimSync has **no revenue ledger at all.** It tracks obligations (`invoices`),
whether they were settled (`status`/`paid_at`), and outgoings (`coach_payouts`) — but
nothing sums income. The only money aggregate in the whole admin panel is
`totalOutstanding` (`SwimSyncAdmin/app/(admin)/invoices/page.tsx:389`), which is money
*owed*, not money *received*. A coach asking "how did July go?" has to add it up by hand
from the invoice list, which is the same spreadsheet-rebuilt-monthly problem that coach
wages (§7.13) existed to close on the payroll side.

**Notes — decide this FIRST, before any code:** is revenue **accrual** (invoices issued
in the month) or **cash** (payments received in the month)? They diverge exactly when it
matters — an invoice generated on 7 Aug for July, paid 20 Aug, belongs to a different
month under each. Everything else follows from that answer.

Two sources must be summed once trial onboarding ships, not one:
`invoices` (paid) **plus** `student_settlements.amount` where `kind = 'paid_outside'` —
money taken for a trial by a walk-in whose parent never registered, which cannot ride the
invoice rails at all (`invoices.parent_id` and `payment_records.invoice_id` are both NOT
NULL). See `TRIAL_ONBOARDING_PLAN.md`.

**Do not ship a partial figure.** A revenue number that counts invoices but silently omits
settlements — or vice versa — is worse than no number, because it reads as authoritative.
That is precisely the mistake PRD §4.4 records about the platform pages, which showed
several businesses' figures added together and labelled as one; the fix there was to show
nothing rather than something wrong.

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

### An unmarked BOOKING is invisible when its class has no active enrolments — **S**
**Confirmed by measurement 2026-08-09**, in a pre-commit review of Chunk 4 — not predicted,
and it is a **silent permanent underbill**, the shape this project treats as its worst.

`core.ts` bails out of the class loop at two `continue` guards — *"nothing recorded and
nothing due"* and *"nobody enrolled and nobody marked"* — and **neither consults
`bookingsByDate`**, even though the completeness gate twelve lines further down explicitly
unions booking dates in. So a class with no ACTIVE enrolments and an unmarked trial or
make-up booking is skipped whole: the guest is neither billed nor blocked.

**Proven, twice, against the local engine.** Alone, the run reports `nothing_to_bill` and
the month stays open — survivable. Alongside a second class that does bill, the month
**SEALS**: `sealed: true`, `classes_still_incomplete: 0`, and that guest's lesson can never
be invoiced afterwards (§11.6).

**Pre-existing, and Chunk 4 neither caused it nor worsened it** — a retired class was
skipped outright before, with the identical outcome. What changed is reachability: retiring
a class is now a product action, and `deactivate_class()`'s first refusal *requires* zero
open enrolments, so **every** retired class sits permanently in exactly this state. This is
the same concern the old *TRIAL BOOKINGS SHARPEN THIS* / *MAKE-UP BOOKINGS WIDEN IT AGAIN*
notes raised in 2026-07-25 and 2026-08-02: the deactivation path now refuses when a class
holds live bookings, which closes the front door, but the engine hole itself is untouched.

**The second half of the chain: `book_trial()` has no `is_active` guard**, unlike
`book_makeup()` (`20260802000200:45`). So a trial can be booked into an already-retired
class over PostgREST, and the admin Trials picker filtering `is_active` is not a limit
(§7.32). Fix both or neither.

**⚠ WHY THIS IS NOT A ONE-LINE FIX, AND MUST NOT BE TREATED AS ONE.** Making an unmarked
booking block is a change to what BLOCKS a billing month, and the block has no override by
design. Any production row already in this state would begin blocking that business's next
run the day it deploys. It therefore needs the same treatment RISK 1 got — a **production
audit first**, and a non-zero result is a blocker, not a caveat:

```sql
SELECT c.id, c.title, c.is_active, b.session_date, b.kind
  FROM (SELECT class_id, session_date, 'trial' AS kind FROM trial_bookings WHERE cancelled_at IS NULL
        UNION ALL
        SELECT class_id, session_date, 'makeup'     FROM makeup_bookings WHERE cancelled_at IS NULL) b
  JOIN classes c ON c.id = b.class_id
 WHERE NOT EXISTS (SELECT 1 FROM student_class_enrolments e
                    WHERE e.class_id = c.id AND e.is_active);
```

**Named prohibition:** do not fix this by adding an override to the unmarked-attendance
block. Fix the scan.

Probably: bill from
classes that had sessions in the month regardless of `is_active`, and keep `is_active` for
*scheduling* only.

### The attendance screen trusts a `sessionId` handed to it in the URL — **S**
`(coach)/classes/[id]/attendance.tsx` takes `sessionId` from the query string and never checks
that it belongs to the class or the date on screen.

**Why:** supplying a real session id satisfies the screen's "this session already exists"
branch, which skips the weekday check — so it renders a markable roster for a date it should
refuse. **Not a billing hole:** records attach to the session that id names, and the database
guard reads *that session's own* date, so every write is still inside the window. The defect is
that the header can show a date the records do not belong to.

**Notes:** pre-existing, and pre-dates the 2026-07-27 guard. Fix is one query — resolve the
session by `(class_id, date)` and ignore the param, or verify it matches before trusting it.
Not worth a migration on its own; do it the next time that screen is opened.
`ATTENDANCE_WINDOW_PLAN.md` §10.3.

### The class ROSTER hides a lesson whose only attendee is a guest — **S**
`(coach)/classes/[id]/roster.tsx` builds its lesson list and its "Mark Attendance" target
inside `if (activeStudentIds.length > 0)` — **enrolments only**. A class with no active
enrolment renders no lessons and no button, even on a date where a trial or make-up guest
is booked and expected.

**Why:** the two coach surfaces disagree about who counts. The Schedule tab derives who is
expected from `expectedStudentsOn()`, which counts bookings, so the same lesson appears
under NEEDS MARKING with a **Mark** button. The roster says the class has nothing to do.
A coach who opens the class rather than the Schedule tab sees a lesson that does not exist.

**Not a billing hole**, and that is why it is **S** and not urgent: the lesson is reachable
and markable from the Schedule tab, which is the coach's landing surface since 2026-08-08
(PRD §14.2), and NEEDS MARKING is floor-scoped so it cannot fall off the list. The engine's
block is unaffected either way.

**Notes:** found 2026-08-09 while fixing `verify-trials.mjs`, which could not test a
guest-only lesson through the roster at all — see **§7.100**. The seed has one class and
zero enrolments, so this is the *default* local state, not an edge case. Fix is to derive
the roster's date list from `expectedStudentsOn()` like the Schedule tab does, rather than
gating on the enrolment count — one derivation of "who was expected here", per the
`schedule/index.tsx` comment on §7.18. Worth folding into whichever item next opens that
screen.

---

## Parent experience

### Upcoming lessons view for parents — **S** `[PRD §7.5]`
Show parents the lessons that are scheduled next, not just the history of marked ones.

**Why:** parents currently see only what already happened. "When is my next lesson?" is
probably the single most common question the app *can't* answer, and it's the kind of
gap that makes an app feel like a billing tool rather than something you'd open weekly.

**Notes:** explicitly called out as **not provided** in PRD §7.5. The building block
already exists — expected lesson dates are derived at read time from
`classes.day_of_week` via `lib/lessonDates.ts`, which is exactly what the coach's
unmarked-lessons backlog uses. Point it at the future instead of the past. **This does
not require pre-generating sessions** — resist that; see `docs/ARCHITECTURE.md` §6.

### ~~Pay and claim straight from the parent's invoice LIST~~ — **SHIPPED 2026-08-08** (PRD §7.21)
Both controls now sit on each outstanding card in `(parent)/billing`, matching the public
tokenized page the WhatsApp reminder links to. App-only: no migration, no new RPC — the
list select just had to start fetching `paid_claimed_at`, which only the detail screen
had been reading. `verify-parent-pay-claim.mjs` (16 checks) is the guard.

The claim's one-way rule held exactly as this item required: `claim_invoice_paid` writes
`paid_claimed_at` and nothing else, so a claimed invoice stays **outstanding** until the
coach confirms it against their bank. The driver asserts that explicitly.

**Two findings worth keeping, because both corrected a confident prediction:**

- **Nesting the buttons inside the card's touchable does NOT double-fire**, which is the
  opposite of what the plan review expected. The concern was real in shape —
  `confirmAction` is a blocking `window.confirm` on RN-web, so a bubbled press would run
  the RPC and *then* navigate, stranding the toast and the claimed line on a screen the
  parent had already left. It was tested by deliberately re-nesting them: still 16/16.
  React Native's responder system grants the responder to the innermost view and does not
  propagate to ancestor Touchables. The card is still laid out with the action row as a
  **sibling** of the touchable — it reads honestly and does not depend on that behaviour
  surviving an RN-web upgrade — but **do not repeat the double-fire claim as fact**, and
  do not cite the driver's "one dialog / no navigation" checks as the nesting guard; they
  cannot go red from nesting.
- **The detail screen's label is "Pay via PayNow QR" and the list's is "Pay via PayNow".**
  That difference is load-bearing for `verify-tenant-branding.mjs`, which used to match
  `/PayNow/i` and resolved to the right control only because the detail screen mounted
  later in DOM order (§7.10). It now targets the longer string, which only the detail
  screen can contain. Keep the two labels distinct.

### Child identification: NRIC last 4 — **S** — _considered and declined 2026-07-19_
Capture the last 4 characters of a child's NRIC as part of their identity.

**Status:** the problem this existed to solve — a coach with two students called "Ethan
Tan" picking the wrong one — **is solved**, using **name + date of birth** instead
(PRD §5.1). The stored `age` column is retired and age is derived. So this item is kept
only for its reasoning, not as work.

**Why NRIC was declined:** partial NRIC (last 3 digits + checksum) is **still personal
data** under PDPC guidance and its collection is restricted, so storing it needs a
standing justification — and it would put regulated data on every coach's roster, since
coaches can already read any student in their class. Date of birth was **already
collected and already required** by the add-child form, so it answers the same question
with no new personal data and no regulatory question at all.

**Revisit only if** a real collision proves DOB insufficient — two children of the same
name *and* the same birthday at one business. That has never happened, and the identity
index would refuse the second one loudly rather than silently confusing them.

### Parent self-enrolment into classes — **M** `[MVP-excluded]`
Let parents pick and join a class themselves rather than waiting for the superadmin.

**Why:** assignment is a manual superadmin step today, so every new family stalls until
someone gets to it. That's the bottleneck in the onboarding push happening right now.

**Notes:** needs class capacity — which doesn't exist yet — or parents will overfill a
lane. A lighter middle ground: let the parent express a *preference* at signup that the
superadmin approves, which removes the back-and-forth without giving up control.
Related: coach-assisted assignment below.

### Multiple classes per child — **M** `[MVP-excluded]` `[Phase 3]`
Let one student attend more than one class a week.

**Why:** a keen swimmer taking two sessions a week is an ordinary case that SwimSync
simply can't represent — the parent needs a second child profile as a workaround.

**Notes:** MVP enforces one active enrolment per student with a DB constraint (§5.3,
§7.4) that's covered by a pgTAP test. Billing already sums per attendance record, so the
invoice engine may need less work than expected — the constraint, the enrolment UI, and
the attendance screens are where the work is. Often wanted together with makeup lessons;
they share the "a student can appear in more than one place" problem.

### Maps integration — **S** `[MVP-excluded]`
Tap a class location to open it in Maps.

**Why:** small, cheap, and genuinely useful the first time a parent drives to a new
pool. `classes.location_address` is already captured and currently just renders as text.

**Notes:** deep link to the platform maps app; no new data needed.

---

## Notifications and reminders

### Credit-note email notifications — **M** `[Phase 2]`
Email the parent when a credit note is auto-issued (attendance edited billable→non-billable
on an already-invoiced lesson). _(Invoice-generation emails **shipped 2026-07-16** — PRD
§7.7, HANDOVER §8c; this is the other half.)_

**Why:** the parent has no idea an adjustment happened until they open the app, so the coach
fields "why is my bill different?" by hand — the same silent-notification gap the invoice
email closes, for the other side of the ledger.

**Notes:** deliberately split from the invoice email because it's a **harder path** — credit
notes are issued by the `handle_attendance_update` **Postgres trigger** (`20260309000500`),
not the Edge Function, so there's no server-side send point. Needs `pg_net` (cloud-only)
firing from the trigger, or a Supabase DB webhook → a small endpoint that sends via Resend.
**Reuse `email.ts`** (builders + `sendInvoiceEmail`, HANDOVER §8c) once building. Guard
idempotency — the trigger can fire per edit.

### Track invoice-email delivery + retry — **S**
Record when each invoice was emailed and only email not-yet-sent invoices, so a failed send
retries on the next generation run.

**Why:** the shipped invoice email (HANDOVER §8c) is **best-effort** — a Resend hiccup
silently drops that parent's notification, and the coach chases a bill they never heard
about. Fine at ~17 parents; worth hardening once send volume or an observed failure makes
silent drops a real cost.

**Notes:** add a nullable `invoices.invoice_email_sent_at timestamptz` (migration) and an
`IS NULL` filter on the send set in `emailCreatedInvoices` (`email.ts`), so a re-run retries
misses without re-emailing successes. Deliberately deferred from the first cut to keep it an
'S'. Pairs with watching Resend delivery in the dashboard.

### One-click bulk WhatsApp sends (Cloud API) — **M** `[Phase 3]`
Send the payment reminder to every unpaid parent with ONE click, server-side, instead
of one Send per chat via the wa.me click-through queue.

**Why:** the queue costs the admin one press of Send per parent (deliberate — that press
is WhatsApp's anti-spam boundary and the wa.me path cannot legitimately remove it). At
some roster size, or for tenants who want unattended sends, that stops being acceptable.

**Notes:** decided with the user 2026-08-02 (`docs/design/PAYMENT_COLLECTION_DESIGN.md`):
the only legitimate path is Meta's WhatsApp Business Platform (Cloud API) — utility
template messages to SG numbers at ≈S$0.02 each (≈S$1–5/month at 50–200 msgs), which the
user judged plausibly acceptable. The cost is friction, not money: a dedicated phone
number NOT registered on the consumer/Business app, Meta business setup, pre-approved
message template, and unverified accounts cap at 250 business-initiated conversations
per 24h (sufficient here; full verification lifts it). Sequence strictly after the
wa.me queue ships and only if a real tenant asks.

### Push notifications — **M** `[MVP-excluded]`
Native push to parents and coaches.

**Why:** the natural home for the reminders above, and for "attendance marked" /
"invoice ready."

**Notes:** **blocked on native store builds** — push doesn't work on the static web app
that's currently deployed, so this can't precede the platform item below. Note that
Notification Preferences buttons were **removed** from coach Settings and parent Profile
as dead stubs; `docs/ARCHITECTURE.md` §12 has the restore notes. Don't re-add the button until there's
a real feature behind it.

### Automated reminder workflows — **M** `[MVP-excluded]` `[Phase 3]`
Scheduled, rules-driven nudges (e.g. "invoice unpaid after 7 days") rather than one-off
sends.

**Why:** turns chasing payment from a thing the coach remembers to do into a thing that
just happens.

**Notes:** needs a delivery channel first (email above), **and a scheduler** — there's
no cron on the free tier, which is the same constraint that makes invoicing manual. That
constraint is the real gate here, not the feature.

---

## Admin and operations

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
  Note the trainee-coach item makes a lesson pay **more than one** coach — build this
  after it, or the payroll half is written twice.

### Split co-admin permissions — **M**
Restrict what individual co-admins can do — e.g. an assistant who can mark attendance and
chase payments but cannot change class pricing or issue credit notes.

**Why:** the user has said feature-splitting is coming ("I will only be splitting features
in the future"). Today every co-admin has the owner's full authority except admin
management, which is the right first cut but means an assistant hired to chase invoices
can also reprice every class.

**Notes:** parent/coach/admin are ONE database role, so grants can't do this — only RLS
resolution or per-capability checks can (§8.29's structural finding). The seam is
`is_tenant_admin()`/`is_tenant_owner()` in `20260806000100`: a permissions model slots in
as either more owner-style columns (cheap, coarse) or a `tenant_members`-style capability
table (the additive path the shipped design deliberately left open —
`docs/ARCHITECTURE.md` §6). Don't add enum roles for this (same reasoning as the owner
column: permanent, string-audited everywhere, can't express one-owner-per-tenant).

### Owner transfer — **S/M**
Hand a business's ownership to another of its admins (owner retires, business is sold,
the founding admin leaves).

**Why:** `tenants.owner_profile_id` has no transfer path — it is pinned against ALL
client writes by a guard trigger (20260806000100), deliberately, because with co-admins
any writable path is a takeover path. If an owner is lost today (account deleted at the
auth layer, owner dies/leaves), their business's admin management is frozen until the
platform admin intervenes in SQL.

**Notes:** the mechanism wants to be a SECURITY DEFINER RPC gated on the CURRENT owner
(self-service handover) plus a platform-admin recovery path for the lost-owner case. The
guard trigger passes definer functions automatically (`current_user = 'postgres'` —
§7.38's mechanism, documented in the migration). Remember `platform_tenant_overview()`
and `resend-invite` both key on the owner column now — a transfer moves who the platform
panel shows and who gets the onboarding resend, which is correct but worth asserting.

### The family-status search scans every membership client-side — **S**
`handleFamilySearch` on the Platform page fetches **all** `parent_tenants` rows and filters
in the browser.

**Why:** PostgREST caps every response at `max_rows = 1000` (`config.toml`) and does so
**silently** — no error, just fewer rows. So the search quietly stops finding families once
the platform passes a thousand memberships, and the failure looks like "that family isn't on
SwimSync" rather than like a bug. It is the same ceiling `platform_tenant_overview()` was
added to avoid; this is the one client-side scan left on that page.

**Notes:** found 2026-07-19 while rebuilding the page around the RPC. Deliberately left
working rather than extended — the fix is a server-side search (an RPC taking the query
string, or a `.ilike` filter pushed into the query instead of `.filter()` in JS), which is
its own piece of work. Harmless at today's scale; the reason to record it is that the failure
mode is invisible.

### Moving a student between businesses leaves two loose ends — **S**
`reassign_student_tenant()` moves the student but not everything attached to them.

**Why:** the platform admin's student-rescue tool (PRD §4.4) is the remedy when a parent
joins with the wrong join code — so it runs at exactly the moment a family is confused,
and it currently leaves them in a state nobody is told about.

**Notes:** found 2026-07-19 while auditing the money paths; **not a data-loss bug**, but
both ends are silent, which is the problem.

- **The parent is never joined to the new business.** The RPC updates
  `students.tenant_id` and closes enrolments, but writes no `parent_tenants` row — and
  that row is what the add-child picker and the parent's billing grouping rely on. The
  child lives at tenant B while the parent has no membership there.
- **Credit is stranded, silently.** Balances are per `(parent, tenant)`. If the family
  held credit at A and their only child leaves, it becomes unspendable. That is *correct*
  by the never-crosses-businesses rule (PRD §5.6) — the failure is that nothing warns the
  admin before the move.

**This is for the mistake case only.** A genuine migration between businesses is a
different flow and needs no code: the old business marks the family inactive, the new one
gives them its join code, and the child is added there as a new record. History stays with
the business that taught it, which is the isolation working correctly. Don't conflate the
two by making the rescue tool "move everything".

### Disable a COACH account — **M** `[handover]`
Revoke a coach's access without deleting them. **The ADMIN half of this item shipped
2026-08-06** (PRD §4.3: the owner deactivates/deletes co-admins, with the auth-layer ban
for pure admins) — what remains is the coach half, plus platform-level tenant suspension.
Absorbs the older "delete-coach action" item, whose own note already concluded
**deactivate is the right verb** — real deletion destroys billing history.

**Why:** when a school's coach leaves, someone with access to that business's students
and attendance keeps it indefinitely. The only remedy is SQL in the Supabase dashboard —
fine for the owner, impossible for anyone else, and dashboard SQL against production is
exactly where a bad afternoon comes from.

**Notes — the control levels that remain:**

| Disabling… | Who does it | Why there |
|---|---|---|
| A **school's coach** | That business's **tenant admin** | Their own staffing. The platform has no business being in the loop |
| A whole **tenant** | **Platform admin** | Suspending a business; cascades to its accounts |

The shipped admin half established the working pattern to reuse: authority cut by one
clause in the identity helper (`admin_disabled_at IS NULL` inside `is_tenant_admin()` —
the coach twin is `current_coach_id()` returning NULL for a disabled coach), an
auth-layer ban for accounts with no other role, idempotent owner-gated RPCs, and the
guard trigger pinning the column against client writes (20260806000100). ⚠️
`current_coach_id()` feeds the coach half of the policy set — same blast-radius warning
as ever: pgTAP before any UI. `profiles.is_active` still exists and is still enforced
nowhere; the shipped work deliberately did NOT use it (it is whole-account, and an
admin-who-coaches must keep coaching when their admin half is suspended — the coach
version has the mirror-image concern).

**Two traps, both already paid for elsewhere:**

- **A private coach holds `tenant_admin` *and* a `coaches` row** (`docs/ARCHITECTURE.md` §6). "Disable
  the coach" for them means locking the business owner out of their own business. Guard
  it as *"cannot disable the sole coach who is also the owner"* — and check **which
  extension rows exist**, never `role` (§7.19, and now §7.91's scoped exception).
- **`classes.coach_id` is RESTRICT with no cascade.** A disabled coach's classes still
  exist and still need attendance marked — and unmarked attendance **blocks invoice
  generation outright, with no override** (PRD §7.7). So disabling a coach without
  reassigning their classes doesn't just orphan a roster, it **stops the business
  billing**. Disabling must force reassignment, the same shape as the open-enrolment
  problem in "Remove from class" (PRD §7.4). Surface it plainly, never as a raw FK error.

**Parent accounts are deliberately excluded**, considered and dropped 2026-07-19. Families
leaving a business is handled by tenant-level active/inactive (`parent_tenants.is_active`),
which is the actual common case. The only genuine platform-level trigger for a parent is a
PDPA consent-withdrawal request — where "can't log in, records retained" is right, since
IRAS requires ~5 years of financial records — and that has never happened. It rides along
free once staff disabling exists, because the mechanism is identical.

### Export to Excel / CSV — **S** `[MVP-excluded]` `[Phase 3]`
Export attendance, invoices, and credit notes from the admin panel.

**Why:** it's how the data gets to an accountant at tax time, and it's the escape hatch
that makes the whole system less scary to commit to — if you can always get your data
out, you're not trapped.

**Notes:** admin tables already query exactly this data; the work is serialisation and a
download. Start with invoices, which is the one with an actual deadline behind it.

### Coach-assisted assignment workflow — **M** `[Phase 3]`
Let a coach assign students to their own classes, not just the superadmin.

**Why:** the superadmin is a bottleneck for a step the coach is better placed to do —
they're the one who knows which lane a child belongs in. It's only invisible today
because the coach and the superadmin are the same person.

**Notes:** this is the assumption that breaks first if SwimSync ever serves a second
coach. RLS already has `coach_serves_parent()`-style helpers to build on. Related to
parent self-enrolment — both attack the same bottleneck from different ends.

### Better filtering and search — **S** `[Phase 2]`
Search across the admin tables, and per-table filters beyond Attendance.

**Why:** fine at 17 students, painful at 100. Filing this as a scale problem, not a
today problem.

**Notes:** **partly shipped 2026-07-26** — every column on all 22 tables is now sortable
and Attendance gained class and date-range filters (PRD §14.3, §14.4). What remains is
*search*, and filters on the other tables. The sorting rules live in
`SwimSyncAdmin/lib/tableSort.ts`; reuse them rather than writing a second comparison — the
hard-won parts are that blanks stay last in **both** directions, that sorting is
numeric-aware, and that columns sort by what is **on screen** rather than what the row
stores. Attendance's filter deliberately keys on class **id, not title**, because two
classes can share a name.

### More polished dashboards — **S** `[Phase 2]`
Richer metrics on the admin dashboard.

**Why:** the vaguest item here, and honestly the weakest — it has no specific pain
behind it. Kept only because the PRD names it. **Delete this item if a real question
ever replaces it** ("how much am I owed?" would be a better item than "polish the
dashboard").

---

## Platform and reach

### Native store builds (iOS / Android) — **M** `[handover]`
EAS builds → Android APK / iOS TestFlight → the stores.

**Why:** the app is currently a static web app used in Safari, which works but can't do
push, can't be installed from a store, and feels like a website. This is the difference
between "a link the coach sends parents" and "an app."

**Notes:** deliberately deferred until the app "sticks" — iOS is **$99/yr** and the
whole stack is $0 today. **Blocks push notifications.** Decision point is willingness to
spend, not engineering.

### Check the logo for brand collisions — **S**
Search existing swim-school, swim-club and fitness marks for anything close to the pace
clock, before it is on a storefront.

**Why:** the mark now ships in both apps and on `swimsync.sg`, and it has **never been
checked against anything that already exists**. A collision is cheap to fix now and
expensive after a store listing, printed flyers, or a coach's shirts — and a store
submission is exactly where a trademark complaint surfaces. Blocks nothing today; it
just gets more expensive the longer it waits.

**Notes:** this is a search job, not a drawing job — no design work unless it turns
something up. Circle-with-a-hand shapes are common in timer and stopwatch iconography,
so check *swim/fitness* brands specifically rather than generic icon sets. Do it before
**Native store builds** above, since that is the moment it bites. Related loose end: the
wordmark in the lockup is a **placeholder system font stack**, not a chosen typeface —
worth settling in the same pass. Geometry and rationale are in `brand/README.md`;
HANDOVER §8.2.

### ~~Multiple coaches per class~~ — **SUPERSEDED 2026-08-08**
Replaced by two lesson-level items in *Coach workflow*: *A lesson can have a substitute
coach, temporarily* and *Trainee coaches shadow the main coach on a lesson*.

The item's own note asked the right question — *"if the real need is 'someone else covers
this week', that's a session-level concern, not a class-level one"* — and the answer, from
the user on 2026-08-08, is that **both** real needs are session-level: a temporary
substitute, and trainees shadowing. A class-level join table would have expressed neither
and would have been rebuilt.

### Multi-language support — **M** `[MVP-excluded]`
Beyond English.

**Why:** recorded for completeness. English-only was an explicit MVP decision (§8.1) and
is a reasonable long-term answer for Singapore.

**Notes:** the honest reason to do this would be Mandarin for grandparents doing pickup
— which would be a real reason, but nobody has asked.

---

## Foundations and engineering debt

These aren't features; they're the things that will make future features cost more, or
that are quietly waiting to break something.

### Deleting an admin destroys the audit history — **S** `[found 2026-08-09, Wave 1 Chunk 3]`
`prepare_admin_delete()` **purges the target's `audit_log` rows** before the hard delete,
because `audit_log.actor_id` is a `NOT NULL` FK with no cascade
(`20260806000100_co_admins.sql:56`). So removing a departing admin erases every record of
what they did.

**Why:** as of `20260809000200` every edit to a student is recorded — including
`provisional_contact_phone` and `_email`, the top two ranked signals in
`find_student_candidates()`, which decide **which parent is offered which child**. The
dispute that trail exists for is "who changed the number, and when", and the person most
likely to be at the centre of it is an admin who has since left. The purge deletes exactly
the evidence, and the typed-DELETE confirm says so — so this is a known, disclosed hole,
not a silent one.

**Notes:**
- **Do NOT make `actor_id` nullable to solve it.** It is depended on elsewhere and §7.50 is
  the reason it is `NOT NULL`. `20260809000200`'s header carries the same prohibition for
  the same column.
- The shapes worth weighing: a `deleted_profiles` tombstone table the FK can point at; or
  `ON DELETE SET NULL` plus a denormalised actor label captured at write time (which
  survives the delete and is what a reader actually wants to see); or refusing the hard
  delete once the admin has audit rows, which `prepare_admin_delete()` already does for
  *recorded work* and would merely extend.
- This is a **retention** decision before it is a schema one — how long the trail is meant
  to outlive the person. Settle that with the user first; every option above is cheap once
  it is answered.

### `fixtures-trial-onboarding-teardown.sql` deletes invoices it does not own — **S**
Its cleanup is `DELETE FROM invoice_items … WHERE i.tenant_id = v_tenant AND
i.billing_month = <its month>` — every invoice in the tenant for that month, not just the
ones it created. Same for the `invoices` and `billing_periods` deletes beneath it.

**Why:** `check-fixture-roundtrip.sh` pass 2 exists to enforce "each fixture owns only its
own rows", and this one silently breaks that rule. It went unnoticed for as long as no
sibling put a row in those tables. On 2026-08-09
`fixtures-admin-table-geometry.sql` became the first fixture to hold a **credit note**
against an invoice item, and the over-broad `DELETE` immediately hit
`credit_notes_invoice_item_id_fkey` and failed the entire stacked unwind — six tables left
dirty, while every fixture still reported "loads fine". The next fixture to touch invoices
hits the same wall.

**Notes:** the new fixture worked around it by putting its invoice **four months back**,
which is a dodge, not a fix — the teardown is still wrong and the workaround is a comment
someone will delete. Scope the three deletes to the parent/class the fixture owns (it
already knows both). Do **not** widen `check-fixture-roundtrip.sh` to tolerate it. Proving
the fix is cheap: run the full round-trip, then move that fixture's billing month back to
last month and confirm the unwind still passes.

### `/makeups` and `/trials` render a 79px DATE column — **S**
Both pages squeeze their date column to 79px at a 1280px viewport, reported by
`verify-admin-table-geometry.mjs`'s width probe.

**Why:** narrow enough that a date wraps or truncates on the two screens where the date
*is* the information — a guest is expected at one lesson, on one day, and nowhere else.
Cosmetic today; it is filed because it was measured rather than guessed, and because
nothing else will notice it.

**Notes:** the geometry check reports width but deliberately does **not** assert on it
(§7.71) — a table whose columns all carry `w-full` renders one at ~110px while every
alignment and text assertion still passes, so width is a human-judgement signal, not a
pass/fail one. Do not "fix" this by adding a width assertion to the driver; fix the two
pages' column classes. The threshold in the driver is 80px and is arbitrary.

### Decide whether `service_role` deserves the whitelist treatment — **M**
`20260804000600` made `authenticated`'s table grants a declared whitelist derived from
`pg_policies`, and `000700` shut the last default-privilege row. `service_role` was left
untouched, deliberately and on the record — this item is the decision, not a plan to do it.

**Why:** it is the one role where **grants are the entire gate**. `rolbypassrls = true`, so
no policy in the repo restrains it, and it holds `arwdDxtm` on all 37 tables plus EXECUTE on
everything. The mitigation is that it is reachable only with the secret key — held by the
edge functions and the admin panel's server routes, never shipped to a browser. So the
exposure is "anything that can read an env var", which is a real but different threat model
from `anon` and `authenticated`.

**Notes:**
- **The `authenticated` argument does not transfer, and that is the point.** There, the
  oracle was "no policy could ever permit this", which made 50 of 148 grants provably dead.
  `service_role` has no policies by design, so that oracle returns *everything* and is
  useless. A whitelist here would have to be derived from **actual usage** — the edge
  functions (`generate-invoices`, `package-emails`, `public-invoice`) and the admin's
  `createAdminClient()` routes — which is a genuine audit, not a query.
- Known writers to start from: `generate-invoices` touches most billing tables under
  `service_role`; `SwimSyncAdmin/app/api/provision-tenant/route.ts` inserts and deletes
  `tenants`; `invite-parent` writes profiles. Any narrowing must not break the invoice
  engine, which is the one thing in this repo that must never fail silently.
- **Do not extend `table_grants.test.sql` to cover it.** That file is scoped to
  `authenticated` and `anon` on purpose (§7.87): the invariant is false for a role that
  bypasses RLS, and a test that is red against a correct database gets disabled.
- Prerequisite: an honest answer to "what does each service-role caller actually touch?".
  Until that exists, this is a question, not a task.

### Generate real Supabase `Database` types — **M** — _low priority, do last_
Give the supabase-js client a generated `Database` type (`supabase gen types typescript`
→ `createClient<Database>(...)`) so query results are typed from the real schema instead
of guessed from the select string, retiring the `any` casts scattered across every
screen that reads a nested join.

**Why:** today there is no `Database` generic anywhere, so supabase-js infers response
shapes from the select string alone and every nested embed is treated as an `any` — real
type safety across the app's ~11+ query sites is simply absent. With generated types, a
misspelled column, a dropped field, or a wrong status value is caught by the compiler
before it ships, everywhere, not just where someone remembered to be careful.

**Notes:** **deliberately ranked last, and only worth doing once the schema has stopped
changing** — the generated types are a *snapshot* that must be regenerated on every
migration, or they silently go stale and start lying, which is worse than no types. It's
an **M**, not an **S**: it touches every query site, and even with the generic in place
supabase-js still infers to-one embeds as arrays without `!inner`/`!hint` annotations, so
a few casts remain. This **supersedes and absorbs** the `any`-cast fix already applied in
`(parent)/home/child/[id].tsx` (shipped 2026-07-16, HANDOVER §8d) — that cast was the
pragmatic `S`-sized fix to clear the baseline now; this is the thorough version for later. Do **not**
start this while migrations are still landing (NRIC and coach-defined levels are still
schema-touching backlog items ahead of it). The natural trigger is "the schema is
frozen and we want compiler-enforced safety before a big build."

### Deeper component-render tests — **M** `[handover]`
RN screens with a mocked Supabase; admin table components.

**Why:** frontend tests currently cover `lib/**` pure functions only. The billing *maths*
is well covered (34 pgTAP + 8 Deno), but the screens where a coach actually loses money
by abandoning a task are covered only by hand-run Playwright drivers.

**Notes:** named in `docs/TESTING.md` §5 as "the natural next additions." The
`run-ui-playwright` drivers show what's worth pinning.

### Shared `lessonDates.ts` package — **M**
The file is duplicated **byte-identical** in both apps.

**Why:** filed for visibility, **not recommended**. `docs/ARCHITECTURE.md` §6 makes the case
deliberately: separate npm projects, no workspaces, different React majors, different
bundlers and test runners. Sharing ~120 lines of pure date maths would need workspace +
Metro `watchFolders` + `transpilePackages` surgery. The file has **zero imports**, so
drift is cheap to spot (`diff` the two), and each has its own test file.

**Notes:** the reason to revisit is if workspaces arrive for *another* reason — then
this comes along free. Until then: **edit both.** Recorded so the decision isn't
re-litigated from scratch every time someone notices the duplication.

### ~~Production data cleanup~~ — **S** — **DONE 2026-07-26**
The script was **run against production**. `Peter Zztest` — active, enrolled, and
positioned to block a real month from billing — is deleted. Production now holds
**9 students and 7 parents, all real**, with `attendance`, `lesson_sessions` and
`invoices` at **0**. HANDOVER §9 has the current state.

**Still outstanding, and small:** the **orphaned PayNow QR file** in Storage, which the
SQL script does not touch. Deliberately still excluded: `TestClass` (a class carries
effective-dated `class_rates`, and `trial_bookings.class_id` is `RESTRICT`) and the
`jj test` coach in **Epic Swim**, which is that business's data rather than ours.

The notes below are kept because **the reasoning outlived the task** — the next data
cleanup, on any environment, hits every one of these again.

**Notes — from the script that ran on 2026-07-26:**

- The script lives outside the repo (scratchpad), because a data-cleanup migration would
  re-run on every `db reset` and on any future environment. It deletes **12 students and
  5 parent accounts by exact name/email**, ends in `ROLLBACK` so the first run only shows
  its plan, and was rehearsed against a **restored copy** of the production data before
  being run for real: 21 → 9 students, 12 → 7 parents, attendance and sessions to 0, no
  survivor left parentless.
- **Never match test data by pattern.** `LIKE '%test%'` works today and deletes a real
  child called *Justin* later. Name them.
- **`audit_log.actor_id` blocks deleting a profile** — it is `NOT NULL` and `NO ACTION`,
  so it can be neither cascaded nor blanked. Audit rows *authored by* a doomed account
  must be deleted first; rows written by the real admin *about* a deleted child dangle
  harmlessly (`entity_id` has no FK) and should be kept.
- Deleting `auth.users` cascades `profiles → parents → parent_students`. It does **not**
  remove students — those belong to the business, not the account.
- Running it took production's `attendance` back to **0**, which made HANDOVER §9's "first
  attendance ever recorded" note false. **That note was rewritten, not deleted** — the loop
  *was* proven end to end on 2026-07-25 and then the evidence was tidied away, and today's
  zero must not be re-read as "the path has never been exercised."

### Email confirmation copy and templates — **S** `[handover]`
Confirmation emails still use Supabase defaults.

**Why:** cosmetic today because **email confirmation is intentionally OFF** — a
self-registering parent isn't sent one. Only matters if confirmation is ever turned on.

**Notes:** confirmation was turned off deliberately (it stranded web parents on a "check
your email" step). The branded template pattern exists at
`supabase/templates/recovery.html` if this is ever needed.

---

## Deliberately not doing

Kept so the reasoning doesn't get re-litigated.

| Idea | Why not |
|---|---|
| **A blanket `anon` revoke via default privileges** | **Done 2026-08-04 (`20260804000400`) — this row is kept only so the two earlier refusals are not re-litigated as though nothing changed.** Declined 2026-07-21 and again earlier on 2026-08-04, both times on the grounds that it would lock a future function that legitimately needs `anon`. That objection had already expired on 2026-08-02, when `public-invoice` established the standing rule (`docs/ARCHITECTURE.md` §6) that anything public is served by an **edge function, never an anon RPC** — so the case being protected was one the architecture forbids. Doing it also revealed that the statement everyone had in mind (`… IN SCHEMA public REVOKE … FROM PUBLIC`) **succeeds and does nothing** (§7.85), meaning both refusals were declining something that would not have worked anyway. |
| **Making the Students page's "All" tab mean active-only** | Considered 2026-07-26 so the header count would always equal the visible rows, and declined **with the user**: it would hide departed children from the default view and change behaviour people rely on. The header therefore deliberately describes a **subset** of the rows, and the `· N inactive` suffix is what explains the gap. **Do not "fix" the mismatch** — it is the honest reading. (`lib/studentCounts.ts`.) |
| **An "In progress" state on a class card while its lesson is running** | Offered 2026-07-26 while building the attendance-status chips and declined. A class shows **Upcoming** until its **end** time, because a coach marks at the end of a lesson — so one still running is not yet overdue and a fourth word for it buys nothing. The `Now` badge already says a class is happening. `hasEndedInSg()` is keyed to the end time deliberately; if this is revisited, that is the single place it changes. |
| **Pre-generating lesson sessions** (a scheduled session generator) | PRD §7.5 is knowingly unimplemented and should stay that way. Sessions are created lazily by the coach's attendance save; which lessons *should* have happened is derived at read time from `classes.day_of_week`. Pre-generation adds a job, a schedule, and a pile of edge cases when classes change — for no gain the read-time derivation doesn't already deliver. **Don't "fix" this** without a reason the derivation genuinely can't serve. (`docs/ARCHITECTURE.md` §6.) |
| **A parent-facing swimming-ability picker** | Removed on purpose (PRD §5.1). Parents self-reporting ability isn't information anyone trusted; the class a child is in is the real signal. If levels return they should be **coach-defined** — see the backlog item above. |
| **Re-adding Notification Preferences / Help & Support buttons** | Removed as dead stubs with empty handlers, not lost (`docs/ARCHITECTURE.md` §12). Build the feature first, then the button. |
| **`Alert.alert` for user feedback** | A **no-op on RN-web**, so it silently does nothing on the deployed app. Use `confirmAction` / the global Toast / inline form errors instead (`docs/ARCHITECTURE.md` §12a). The only sanctioned use left is the native-only media-library permission prompt. |
| **Invoicing a child immediately when they are set inactive** | Proposed as "settle up what they owe on the way out"; rejected 2026-07-18. Invoices are `UNIQUE(parent_id, billing_month)`, so an early partial-month invoice makes the regular run skip that parent via the `already_exists` guard — stranding their **siblings'** lessons for that month. That is exactly the multi-class underbilling bug the same session fixed, re-entered through a new door. It also breaks PRD §7.7's one-complete-calendar-month rule. The normal cycle already bills them correctly, because billing follows **attendance rows** rather than current enrolment (HANDOVER §8). |
| **An override on the completed-month guard** | Considered and refused 2026-07-19 while building it. Billing a month that has not ended is never legitimate: the attendance gate ignores lessons that have not happened yet, so a mid-month run reads as **complete**, bills what exists and **seals** the month — after which the rest of that month can never be billed (a sealed month is skipped; the `already_exists` guard skips the parent even if reopened). An override could therefore only ever produce that loss. Same reasoning as the attendance-block row below, and `force` was deliberately kept to its single meaning — skip the sealed-month guard — rather than growing a second one. If someone wants to bill mid-month, the answer is to wait, not to override. (`docs/GOTCHAS.md` §7.32, §8.6.) |
| **An override / "Generate anyway" on the attendance block** | Removed deliberately 2026-07-18 (PRD §7.7). The case it appeared to serve — a class that genuinely didn't run — is already handled *inside* the completeness rule by marking everyone `cancelled_rain`/`cancelled_coach`. So the bypass wasn't covering a legitimate case; it was letting an unrecorded lesson through into a **permanent** underbill, because a lesson can never be added to an invoice that already exists (§11.6). The escape hatch for a class that can't be completed is removing the student, not overriding the check. |
| ~~**A per-tenant invoice run day**~~ **— NOW BUILT (2026-07-19)** | Kept as a record of the reasoning, which held up. It was correctly refused while there was one business, and shipped as a per-tenant column the moment tenanting arrived, exactly as this row predicted ("trivial next to the RLS rewrite that happens anyway"). A useful example of deferring a small generalisation until the thing that needs it exists. |
| **Modelling level families and a progression graph** (Toddler/Beginner/Intermediate tiers, "T4 → B3" rules, milestone markers) | Considered 2026-07-19 from a real swim school's level table, and rejected by the user: **different schools and coaches have different ladders, and different mappings between them.** Modelling tiers and progression edges would bake one business's structure into the schema and make every other tenant bend to it — the opposite of what a per-tenant curriculum is for. The generic primitive already covers it: a school with 16 rungs across 5 tiers simply names them that way (`Toddler 1` … `Epic 2`) and orders them, and `tenant_levels.note` carries any progression rule *in that business's own words* ("Progress to B3 upon completing T4"). Free text is the right amount of structure here — human-readable, and no schema commitment to a shape only one customer has. Revisit only if something needs to *compute* over progression (auto-advancing a child, say), which nothing does. |
| ~~**Modelling substitute coaches**~~ **— REVERSED 2026-08-08, now a real item** | **Two things in the original refusal were wrong.** (1) *"The schema already supports it (`session_pay_overrides`)"* is **FALSE**: that table is `(lesson_session_id, pays_coach BOOLEAN, set_by, set_at)` — it can suppress a lesson's pay and cannot name another coach. (2) *"Revisit when a business has enough coaches to cover for each other"* — that is now; the user asked for it directly on 2026-08-08, including trainee coaches, and decided pay follows **whoever actually taught**. See *A lesson can have a substitute coach, temporarily* and *Trainee coaches shadow the main coach on a lesson* under **Coach workflow**. **The row's one durable finding survives and is why this is not a regression:** a PERMANENT handover is not this problem and already works through effective-dated class terms (`set_class_terms()` writes `class_rates.paid_coach_id` + `effective_from`). What had no representation was the one-off cover. |
| **Wiring anything to `tenants.kind`** | The column is an enum defaulting to `'private'` that **nothing sets, changes or reads** — the tenancy backfill hardcoded it in July 2026 and no screen, RPC or admin control has touched it since. It is reserved for future *pricing*, and §6 forbids it reaching an RLS policy. It briefly appeared as a "Type" column on the Platform page and was replaced 2026-07-19 with a **derived** shape (one coach who is also the admin = a private coach), because the stored value would have read "private" for an actual swim school and nobody would have noticed. **Don't display it, and don't branch on it** — if a business's shape matters, derive it. If pricing eventually needs a stored kind, give it a writer and a UI at the same time, or it will drift again. |
| **A browsable directory of coaches / schools for parents** | Considered as the way a parent picks their business, rejected 2026-07-19 in favour of **join codes** (PRD §5.1). A list publishes SwimSync's entire customer roster to every parent and every competing school; worse, a mis-tap puts a child on a stranger's roster where that business's admin can see and bill them, because nothing in the flow proves the family deals with them. **Possession of a code is that proof.** It also stops scaling at a few hundred tenants. If a discovery feature is ever wanted, make it search-by-exact-name so the full list is never enumerable. |
| **A "view as tenant" impersonation mode for the platform admin** | Rejected 2026-07-19 while building the platform page. It means scoping *every* admin screen to a chosen tenant rather than the caller's own — far larger than the support need, which is answered by a cross-tenant business list plus the ability to **move a student** between businesses (PRD §4.4). Revisit only if support actually gets stuck without it. |
| **Cross-tenant students** (one child taking lessons at two businesses) | Out of scope 2026-07-19. A student belongs to one business, and `one_active_enrolment_per_student` already enforces one active class. Note this **is** a real thing in Singapore, so this is a "not yet" rather than a "never" — but it touches enrolment, billing and the tenant boundary at once. Revisit on actual demand, not in anticipation. |
| **Platform billing (SwimSync charging the schools)** | Deliberately unbuilt 2026-07-19: the pilot is free. `tenants` is the natural billing subject when it arrives, so nothing in the current schema blocks it — but building it now would be a second money model with no payer. |
| **Putting the SwimSync mark on the invoice email** | Rejected 2026-07-19 while adding the logo. That header is the **tenant's** logo and business name by design (PRD §7.10): a parent pays their coach or school, and an invoice headed "SwimSync" reads as a platform bill — actively confusing for a family with children at two businesses. SwimSync is named in the footer as sender of record, and that is the whole of its billing there. The *recovery* email is a separate case and also stays wordmark-only: SVG does not render in most mail clients, and a hosted PNG adds a broken-image failure mode to the one message a locked-out user needs. (HANDOVER §8.2, `brand/README.md`.) |
| **A non-calendar wage cycle** (e.g. 16th–15th) | Wages assume **calendar months**, with only the *pay day* configurable (PRD §7.13). A different period boundary is a new period concept rather than a setting, and would need its own sealing and adjustment rules. Nobody has asked for it. |
| **Public self-service signup for businesses** (a "Start your business" page on the admin panel) | Considered 2026-07-21 while building tenant provisioning (PRD §4.4) and rejected in favour of platform-admin onboarding. With **no platform billing and no approval step**, an open signup form is an open door: spam tenants, unbounded free-tier growth, and — the real cost — every one of them mints a **join code**, which is the only proof a family deals with a business (§5.1). SwimSync onboards businesses one conversation at a time; the second one is a hand-onboarded school. Revisit when there is inbound demand *and* something gating it (payment, or manual approval before the tenant becomes joinable). |
| **Deleting a business from the admin panel** | Rejected 2026-07-21 with provisioning. A tenant deletion cascades into its families, students, invoices, credit notes and attendance — so a destructive button sitting on a support panel is a bigger risk than the mis-typed name it would fix, and the mistake it fixes is rare and cheap to correct in SQL. A **failed** provision already cleans up after itself (the route deletes the tenant if the invite fails), which covers the only case that happens automatically. An "only if the tenant is empty" variant was considered and judged not worth its own RPC, guard and tests. |
| **Sending the invite through Supabase Auth's own invite email** | Considered 2026-07-21 and rejected in favour of `generateLink({type:'invite'})` + our own Resend send. Supabase's path would need a `templates/invite.html` **pasted into the production dashboard**, where nothing in the repo can see it and no test can catch it drifting from the file — and resending to an already-invited user has uncertain semantics (it may 422 rather than re-send). Our own send makes the template code-owned and unit-tested, no-ops without `RESEND_API_KEY`, and makes Resend deterministic. Note the deliberate inversion of the invoice-email rule: an invoice email is best-effort because billing must not depend on delivery, whereas **the invite IS the deliverable**, so a failed send surfaces the link for the operator instead of being swallowed. |
| **Per-coach / per-tenant timezone (now)** | The invoice engine's billing timezone is a single configurable seam (`APP_TIMEZONE`, default `Asia/Singapore` — `generate-invoices/dates.ts`), and the frontend stays SG-hardcoded. Multi-timezone is a "don't-paint-into-a-corner" concern, **not near-term** (the user's explicit call). Don't build per-tenant TZ or generalize `lessonDates.ts` to multi-TZ before then — true multi-timezone folds into the **tenanted admin accounts** item when that lands. (HANDOVER §8a.) |
| **Typing `<Thead>`'s children so a `<Tr>` inside it fails typecheck** | Considered 2026-07-26 while fixing the Levels table (`docs/GOTCHAS.md` §7.54) and declined by the user in favour of a call-site scan test. It would be the stronger guard in principle — the mistake becomes unrepresentable rather than merely detected — but React's `children` typing does not express "only these element types" cleanly, so it needs casts or a wrapper at call sites, and it would put a fiddly type on the component that backs **all 14 admin tables**. `components/Table.test.tsx` catches the same mistake in CI, names the file and the exact fix, and risks nothing at runtime. Note the earlier failure this replaces: the previous attempt at prevention was a **docblock asserting the broken form was "unrepresentable"**, which it was not — the lesson is that the guard must be executable, not that it must be a type. |
| **Any invoice or payment count in the COACH app** | Settled with the user 2026-08-02 while removing the coach's Billing tab. The Today screen carried an "Outstanding" tile counting unpaid invoices across every parent the coach serves, and the obvious repair was to relabel it *Unpaid invoices* and make it tappable. The user rejected the whole category: **a coach does not need to know how many invoices are unpaid — that is an admin-app question.** Since fee-free payment collection shipped (PRD §7.21), everything that makes an invoice actionable — the `INV-YYYY-NNNN` reference, the dynamic QR, the WhatsApp queue, the "parent says paid" badge, the **Claimed** filter — lives on `admin.swimsync.sg`, so a number on the coach's phone can only ever prompt a decision the coach cannot act on well. It was also **not today-scoped and not lesson-shaped** while sitting between "Classes Today" and "Students Today", so it read as a fact about today's lessons. A private coach holds the tenant-admin role anyway and loses nothing. **Don't re-add a count, a badge or a filter here** (PRD §7.9; the prohibition is also a comment in `(coach)/schedule/index.tsx`). |
