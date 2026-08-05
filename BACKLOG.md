# SwimSync — Backlog

_Last updated: 2026-08-05 — **one item SHIPPED and removed:** *Run the UI drivers in CI*
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

The ranking for the "billing is untested, so build other things" stretch (set 2026-07-16,
while parents onboard and before the first real invoice run on 1 Aug). **Ordered to
prevent re-work:** each item is placed so that finishing it never forces you back into an
earlier one — if building A then B then C would send you back to rethink A while doing C,
C is moved ahead of A. Sizes as above (**S**/**M**/**L**).

This ranking lives **only here** (one source of truth — deliberately not duplicated as a
number on every heading, which would just drift). The item bodies below stay grouped by
theme.

### The near-term plan — build roughly in this order

_(Shipped and removed from this list: bulk "set all" on the attendance screen
(**2026-07-16** — PRD §7.6); the `tsc`-baseline + CI-typecheck item (**2026-07-16** —
HANDOVER §8d); the **invoice half of email notifications** (**2026-07-16** — PRD §7.7;
credit-note emails remain, now in _Notifications_); and the **UTC-derived default billing
month fix** (**2026-07-17** — PRD §7.7, HANDOVER §8a). The list below is renumbered from what
remains.)_

**This list is empty.** All three near-term items shipped on 2026-07-19, and the two
platform-admin items raised the same day shipped too — the panel is now scoped by audience
and the Platform page is a per-tenant operations view (PRD §4.4, HANDOVER §8.7).

Pick from the sections beneath, or from `HANDOVER.md` §9 — which argues the real
priority is not a build item at all, but getting real attendance marked in production.

_Shipped 2026-07-18 and removed from this list:_ the **multi-class-parent under-billing
bug**, plus the configurable **invoice run day**, **month sealing**, and the **hard
attendance block** — see PRD §7.7 and HANDOVER §8.

_Shipped 2026-07-19 and removed:_ **extract the completeness-rule shared helper** (it was
#1; done as tenanting phase 0, and it immediately exposed a live underbill — `docs/GOTCHAS.md`
§7.18), and the whole **tenant/coach money cluster** including **coach wages**.

_Shipped 2026-07-19 and removed:_ **address + postal code at parent signup** — optional at
registration, editable afterwards at Profile → Contact Details (without which the field
would only ever hold data for families who joined after it shipped). `postal_code` is TEXT.
See PRD §5.1.

_Shipped 2026-07-19 and removed:_ **coach-defined swimming levels** — per-business
`tenant_levels` with an explicit order, set by the business's admin, read-only to coach and
parent. The old fixed enum is dropped. See PRD §7.15.

_Shipped 2026-07-19 and removed:_ **child identification + derived age** — shipped as
**name + date of birth**, not NRIC. The NRIC half was dropped deliberately: partial NRIC
is still personal data under PDPC guidance, and DOB was already collected, so the same
question is answered with no new regulated data. See PRD §5.1. It also grew an
**edit-child screen**, because the roster problem is about children who already exist and
nothing in the app could edit one — which in turn surfaced two latent bugs (HANDOVER §8).

_Shipped 2026-07-19 and removed:_ **active/inactive status for parents and children** —
all six phases, live. It was the oldest outstanding item in this document. See PRD §7.14
for what it does and HANDOVER §8 for how it went.

_Shipped 2026-07-20 and removed:_ **package / subscription pricing** — as prepaid
lesson packages, live same day (PRD §7.16, `PACKAGES_DESIGN.md`, HANDOVER §8.8). Worth
keeping: the old entry's two warnings were **wrong** in instructive ways — it predicted
a "second billing model inverting billing-derives-from-attendance" (the build refused
that shape: same engine, money moves at invoice time, ad-hoc path byte-identical) and
client-side concurrent drawdown (drawdown lives in the single-threaded engine; live
displays are a read-only RPC). Its follow-ups are queued as items: parent-facing
package notifications, in-app refunds.

### Later — clusters with a fixed internal order

- ~~**The tenant/coach money cluster.**~~ **SHIPPED 2026-07-19** — multi-tenancy,
  the role split, and coach wages are all built and live. See `PRD.md` §4.3/§7.13 and
  `TENANCY_DESIGN.md`. It turned out **smaller than this entry feared**, and the reason
  is worth keeping: treating a **private coach as a tenant of one** meant coach *type*
  never became an authorization concept, so no rule branches on it and wages needed no
  private-vs-school check at all. The "built twice" risk this entry warned about was
  real, and was avoided by reframing rather than by building carefully.
  **Coach-created student profiles** sat behind this and **shipped 2026-07-25** as part
  of trial onboarding (PRD §7.17) — though the *coach-side* half of it was removed one
  session later: trials are **arranged ahead of time by the business's admin**, and the
  coach app has no write path but marking attendance (PRD §7.17). **What remained — *Parents claiming their own child* — SHIPPED
  2026-07-26** (PRD §7.18, `PARENT_CLAIM_PLAN.md`). This cluster is now complete, and its
  item is removed from this document rather than left marked done — the reasoning lives in
  the plan and the PRD.
- **The platform chain.** Native store builds (M) → Push notifications (M) — push can't
  work on the current static web app, so it can't precede native builds.
- **The reminder chain.** Invoice emails **shipped** (HANDOVER §8c); the rest sequences after
  them: credit-note emails (M) → WhatsApp reminders (M) → Automated reminder workflows
  (M — needs a scheduler, i.e. cron; the UTC-billing-month fix that had to precede enabling
  cron is now **shipped**, so that prerequisite is cleared).

### Unordered — no dependencies, pick by value

Upcoming-lessons view for parents (S), Maps deep link (S), Attendance edit-history view
(S), Export to CSV (S), Disable a staff account (M), Student-move loose ends (S), Better
filtering/search (S), More polished
dashboards (S), Deeper component-render tests (M), Convert a trial into an enrolled student (S),
Editing a student's contact details (S),
Email-confirmation copy/templates (S), Revenue reporting (M — *decide accrual-vs-cash first*).

### Later — big features carrying their own dependencies

Makeup lessons (L), Multiple classes per child (M), Parent
self-enrolment (M), Coach-assisted assignment (M), Household split billing (M), Auto PayNow
detection (L), In-app payment gateway (L), Multiple coaches per class (S), Multi-language
(M), Shared `lessonDates` package (M — *not recommended*, see the item), Generate real
Supabase `Database` types (M — *do last*, needs a frozen schema; see the item).

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

### `book_trial` has no date floor; `book_makeup` does — **S**
`book_makeup()` refuses a date before `session_window_start()` (a booking in a billed
month can neither be marked nor bill — silently lost). `book_trial()` predates the floor
and will happily book into an already-billed month, with the same silent-loss shape.
Give it the same guard; one sentence of SQL. Recorded rather than fixed in the make-up
work to keep that batch single-purpose.

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

### A coach week view — **M**
Turn the Classes tab into a Mon–Sun strip showing each lesson **and whether it is
marked**, rather than the recurring timetable it shows today.

**Why:** PRD §14.2 describes this tab as being "for date-based lookups". As of
2026-08-03 it groups classes by weekday with today first (§8.27), which is a *timetable* —
it answers "when do I teach?" but still not "which lessons have I actually marked?". Each
row is a recurring class, not a dated lesson, so the coach's only surfaces tied to real
dates remain Today (one day) and the Unmarked Lessons backlog (a nag list of what has
already gone wrong). A week view is the first surface that lets a coach see what is
coming and confirm they are square *before* the month closes, instead of finding out at
invoice time that a lesson blocked it.

**Notes:** every building block exists and none of them needs new schema — expected
lesson dates come from `expectedLessonDates()` (`lib/lessonDates.ts`), the five marking
states from `lessonProgress()` / `progressLabel()` (`lib/attendanceSummary.ts`), and the
per-date expected roster from `expectedStudentsOn()`. **Do not pre-generate sessions to
build this** (`docs/ARCHITECTURE.md` §6). `lib/weekOrder.ts` already does the
today-first weekday ordering and takes the weekday as a parameter, so reuse it rather
than deriving one — nothing in that file may read a clock (§7.7). Raised 2026-08-02
alongside the Classes-tab landing fix, which shipped 2026-08-03 as the small half of the
same complaint.

### A link to the admin panel from coach Settings — **S**
A coach who also holds `tenant_admin` gets a link to `admin.swimsync.sg` from their
Settings screen.

**Why:** a private coach is a tenant of one and holds both roles (`docs/ARCHITECTURE.md`
§6), and since payment collection shipped, the things they most often need — the
reference, the QR, the WhatsApp queue, mark-paid — are **only** on the admin panel. There
is currently no bridge between the two, so the coach retypes the URL. This matters more
now that the coach app deliberately shows no billing at all.

**Notes:** gate it on `profiles.role === 'tenant_admin'`, the check
`(coach)/settings/index.tsx` already performs for the PayNow QR (`canEditQr`). A school
coach without the role must not see it.

---

## Billing and payments

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

### Revenue reporting — **M**
Tell a business what it actually earned in a month.

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

### A session added AFTER a month is invoiced is never billed — **S**
The hard block (HANDOVER §8) guarantees every lesson is marked *at generation time*. It does
not cover a `lesson_sessions` row created **afterwards** for an already-invoiced month.

**Why:** the parent has an invoice, so the `already_exists` guard skips them on any re-run,
and the new lesson is silently unbillable — the same permanent-underbill shape the block was
built to prevent, through the one door it doesn't watch. Much rarer now (it needs a
back-dated mark into a closed month), but the failure is still invisible.

**Notes:** the sealed month (`billing_periods`) makes this *mostly* unreachable — a sealed
month is skipped entirely, and reopening it is a deliberate act. The honest fix is a
"top-up" concept, or accepting that the correction tool is a credit note in the other
direction. **Decide which before building anything**; the credit-note flow may already be
the right answer, in which case this item becomes a doc line, not code.

### An inactive CLASS is invisible to billing and to the block — **S**
`core.ts` only scans `classes.is_active = true`.

**Why:** deactivating a class at month end silently drops its billable lessons *and* stops
it blocking generation — so the safety net has a hole exactly where someone is tidying up.
Pre-existing, but the hard block makes the asymmetry sharper: everything else about a
half-finished month now refuses loudly, and this one case stays quiet.

**Notes:** no UI deactivates a class today (the admin Classes page edits but doesn't
deactivate), which is why it has never bitten — **re-confirmed 2026-07-25**: `is_active` is
only ever set `true`, on create.

**TRIAL BOOKINGS SHARPEN THIS (2026-07-25).** A booked trial on a deactivated class is
worse than a dropped enrolled lesson: the child is expected there and nowhere else, so
deactivating the class makes that trial neither billable nor blocking — invisible in
exactly the way this whole feature exists to prevent. Whoever builds class deactivation
must therefore ALSO refuse, or at least warn with a count, when the class has live
`trial_bookings`. Recorded here rather than mitigated in the trial work, because there is
no deactivation path to attach a warning to.

**MAKE-UP BOOKINGS WIDEN IT AGAIN (2026-08-02).** `makeup_bookings` has the same shape
and the same consequence — a booked guest on a deactivated HOST class neither bills nor
blocks (accepted in the make-up plan, the trials analog). `book_makeup()` at least
refuses an already-inactive host; what nothing guards is deactivating a class that
already holds live bookings. The future deactivation path must count BOTH tables.

Probably: bill from
classes that had sessions in the month regardless of `is_active`, and keep `is_active` for
*scheduling* only.

### Tie the attendance-marking window to un-invoiced months — **M** — _upgraded 2026-07-27_
The marking window floor is a **calendar proxy** — the 1st of last month — rather than "the
earliest month not yet invoiced". Since 2026-07-27 that proxy is **enforced by the database**
(`assert_markable_date`, `20260727000100`), not merely offered by the UI, which turns a small
seam into a hard one.

**Why — and this is much sharper than when it was first filed.** Two gaps, in opposite
directions:

- **Markable yet unbillable** (the original). The moment a month is invoiced (July, on 1 Aug)
  its lessons stay *in-window* until the calendar rolls over, but a record added there is
  **not** added to the existing invoice. Small and silent.
- **⚠ Billable yet unmarkable** (new, and why this is now **M**). The engine permits billing
  **any** completed month, but the floor only reaches back to the 1st of last month. Bill
  **July on 5 September** with one lesson unmarked and the gate names a lesson **nobody can
  record any more** — not the coach, not the admin — so the month cannot be billed at all,
  and there is no override by design (PRD §7.7). Before the database enforced the window this
  was recoverable, because the window was a UI convention and the coach could still reach the
  date.

**Notes:** the fix is to floor at `min(1st of last month, first day of the earliest UNSEALED
billing month)` — let the window follow `billing_periods` rather than the calendar — in
`assert_markable_date()` **and** `backlogWindowStart` (`lib/lessonDates.ts`, **both apps**).
The calendar rule was chosen deliberately over this on 2026-07-27: predictable, no cross-table
lookup, never falsely refuses, and a fine default for the monthly cadence. **Revisit the first
time a month is billed late** — that is the trigger, not a hypothetical. Full reasoning in
`ATTENDANCE_WINDOW_PLAN.md` §10.1. Related to the credit-note flow, which is the *correct*
tool for changing an already-invoiced lesson.

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

### Give package requests a reference number, so they get a dynamic QR too — **S**
A `parent_packages` row gets its own payment reference, the way an invoice does, so the
PayNow screen can build a locked-amount QR for it.

**Why:** payment collection (PRD §7.21) gave every *invoice* an `INV-YYYY-NNNN` reference
and a dynamic QR with the amount and reference locked. A **package purchase gets
neither** — `(parent)/billing/paynow.tsx` returns early on the `packageId` path before it
ever reaches `buildPayNowPayload()`, because a package has no reference to lock in. So a
parent buying a package still scans a static image and types the amount by hand, which is
the exact failure mode the reference was introduced to remove: an unattributable payment
the admin has to match up manually.

**Notes:** the trigger pattern already exists — `20260802000800` mints
`INV-YYYY-NNNN` on `invoices` and `next_credit_note_ref` does the same for credit notes,
both with a pad that grows past 9999. A third counter is the same shape. **This is the
blocker for retiring the static QR upload below — do this one first.**

### Demote the static PayNow QR upload — **S** — _depends on package references above_
Show the QR upload in `(coach)/settings` only when the business has no PayNow UEN or
mobile configured, instead of always.

**Why:** since 2026-08-02 the QR that matters is **computed**, per invoice, with the
amount and reference locked (`lib/paynow.ts`). The uploaded image is a worse artifact —
no amount, no reference, no per-invoice attribution — and offering it as a first-class
setting invites a business to configure the weaker of the two and think it is done.

**Notes:** ⚠ **do not simply delete it.** Two live consumers remain: **native builds**,
where `paynow.tsx` skips the dynamic path entirely (`Platform.OS === "web"` gate) — dormant
while the product is web-only but not gone — and **package payments**, until the item
above ships. Retiring the upload before both are closed breaks paying for a package.
Raised 2026-08-02.

### The PayNow screen calls the business "Coach" — **S**
Fix the copy on `(parent)/billing/paynow.tsx`, which labels the QR
*"{name}'s PayNow QR Code"* where `name` is the **business** display name.

**Why:** the QR stopped being the coach's and became the business's in PRD §7.10 — a
school with three coaches has one bank account. The screen was never updated, so a parent
at a multi-coach school reads their school's name possessed by the word "Coach". The
empty state is wronger still: *"QR not uploaded yet. Contact your coach directly"* now
describes a business that has not configured PayNow, and tells the parent to chase a
person who may not be the one who can fix it.

**Notes:** copy-only, no logic. Same screen as the two items above — worth folding into
whichever of them ships first rather than making its own change.

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

### Pay and claim straight from the parent's invoice LIST — **S**
Put "Pay via PayNow" and "I've paid" on each card in `(parent)/billing`, not only inside
the invoice detail screen.

**Why:** paying is the single action the product most wants a parent to take, and it is
currently two taps deep behind "View Details". The public tokenized page
(`/invoice/<token>`) — which is what the WhatsApp reminder actually links to — puts both
controls in front of the parent immediately, so the **in-app** path is the slower one.
That inversion is backwards: the parent who bothered to open the app gets the worse
experience.

**Notes:** both call sites already exist and need no new backend — `claim_invoice_paid`
is the RPC (`(parent)/billing/invoice/[id].tsx`), and the PayNow screen already takes
`?invoiceId=`. Keep the claim's one-way rule: a claim is a timestamped *statement*, never
a status change (PRD §7.21). Raised 2026-08-02.

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

### Multiple admin accounts per tenant — **M**
More than one person can administer the same business — e.g. a school owner plus an
operations manager, both seeing that school's coaches, classes, students and billing, and
neither seeing any other tenant.

**Why:** a school is not one person. The owner who signs up is rarely the person doing
daily attendance chasing and invoice runs, and today the only way to share that work is to
share one login — which destroys the audit trail (`audit_log.actor_id` becomes
meaningless) and means offboarding a staff member requires a password change for everyone.
Not needed for the August pilot, where a single school admin is sufficient.

**Notes:** deliberately excluded from `TENANCY_DESIGN.md` §8 so the first cut stays small,
but the design leaves room for it and names the exact seam. That design puts the role on
`profiles` (one `tenant_admin` per tenant); **this item is the point at which that shortcut
is replaced by a `tenant_members (tenant_id, profile_id, role)` join table**. Doing it that
way round is cheap — the join table is additive and the role-on-profile check becomes a
lookup — whereas building the join table up front would add a table and a migration for a
capability nobody has asked for yet. Worth settling at the same time: whether a second admin
is a *full* admin or a restricted one (e.g. can mark attendance and chase payment but cannot
change class pricing), since that decides whether `role` on the join table is a real enum or
a placeholder.

**Sharper since 2026-07-21:** provisioning a business (PRD §4.4) now mints **exactly one**
admin and there is no way to add a second afterwards — not even by hand, short of SQL. So
this is no longer only "sharing work is awkward"; it is the single remaining gap in
business onboarding, and it is felt on day one rather than eventually. The provisioning
route and `/accept-invite` both assume one admin per tenant and will need revisiting with
the join table. See `TENANT_PROVISIONING_PLAN.md`.

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

### Disable a staff account (coach / tenant admin) — **M** `[handover]`
Revoke a coach's or a tenant admin's access without deleting them. Absorbs the older
"delete-coach action" item, whose own note already concluded **deactivate is the right
verb** — real deletion destroys billing history.

**Why:** there is no way to switch off a staff account today. When a school's coach
leaves, or SwimSync parts ways with a school, someone with access to that business's
students, attendance and billing keeps it indefinitely. The only remedy is SQL in the
Supabase dashboard — fine for the owner, impossible for anyone else, and dashboard SQL
against production is exactly where a bad afternoon comes from.

**Notes — the control sits at two different levels, and that's the main decision:**

| Disabling… | Who does it | Why there |
|---|---|---|
| A **school's coach** | That business's **tenant admin** | Their own staffing. The platform has no business being in the loop |
| A **tenant admin** | **Platform admin** | There is only one admin per business today, so nobody inside it can |
| A whole **tenant** | **Platform admin** | Suspending a business; cascades to its accounts |

**`profiles.is_active` is the right home** — it already exists, is global, covers every
role, and is currently **enforced nowhere**, so it has no behaviour to break. Enforcement
needs two layers: RLS teeth (`current_coach_id()` returning NULL for a disabled account,
so a disabled session sees nothing whatever the client does) and a friendly sign-out
message. ⚠️ **That helper feeds all 37 policies** — it is the highest-blast-radius edit
available in this codebase, and wants its own pgTAP coverage before any UI exists.

**Two traps, both already paid for elsewhere:**

- **A private coach holds `tenant_admin` *and* a `coaches` row** (`docs/ARCHITECTURE.md` §6). "Disable
  the coach" for them means locking the business owner out of their own business. Guard
  it as *"cannot disable the sole tenant admin of a tenant"* — and check **which extension
  rows exist**, never `role`. Branching on the role enum is exactly what locked the real
  coach out of production (§7.19).
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

### Multiple coaches per class — **S** `[MVP-excluded]`
Allow more than one coach on a single class.

**Why:** covers a co-taught lane or a substitute coach. Low urgency at one coach.

**Notes:** `classes.coach_id` is a single FK — this becomes a join table. Worth checking
against the substitute case first: if the real need is "someone else covers this week,"
that's a *session*-level concern, not a class-level one, and the cheaper fix is
different from what this item describes. **Confirm the need before building the join
table.**

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

### Direct writes to `students` are audited by nobody — **S**
Two admin paths update `students` straight from the client and record **nothing**: the
level picker (`setLevel()`) and, since 2026-07-26, the **parent contact details** modal
(`CONTACT_DETAILS_PLAN.md`). They wrote no audit row before 2026-08-04 and still write
none — `20260804000300` stamps rows that *are* written, and cannot conjure one that
isn't. **This is now the whole of the audit gap.**

**Why:** contact details are not cosmetic. `provisional_contact_phone` and `_email` are
the top two ranked signals in `find_student_candidates()` — they decide **which parent is
offered which child**, and once a claim is approved nothing in the product can unlink them
except that flow's own undo (`docs/GOTCHAS.md` §7.47). "Who changed the number, and when?" is
exactly the question a disputed claim raises, and today the answer does not exist. A level
edit matters far less, which is why this sat unnoticed.

**Notes — a TRIGGER on `students`, not an RPC per call site:**

- **This supersedes what `CONTACT_DETAILS_PLAN.md` says.** That file proposes wrapping the
  contact edit in a `SECURITY DEFINER` RPC so the write and the audit row share a
  transaction. Correct but narrow: it fixes one screen and leaves `setLevel()` — and every
  future direct write — unaudited. An `AFTER UPDATE` trigger on `students` is atomic for
  the same reason, covers both paths at once, needs **no client change**, and is inherited
  automatically by whatever writes next.
- It also composes with the item above: derive `tenant_id` from the row (`students` has a
  real `tenant_id` column), so this one starts life correctly attributed rather than
  joining the 13.
- **Do not audit from the browser — and as of 2026-08-04 you no longer can.** This bullet
  used to say it was *possible but wrong*: wrong twice over, because it is a second round
  trip that can be lost while the write lands, and because everything except the actor is
  self-reported. That reasoning stands and is why the trigger is the right shape. What
  changed is the premise: `20260804000300` narrowed `audit_log_insert` from
  `actor_id = auth.uid()` — under which any signed-in user could fabricate any audit row —
  to the single real client case, **a coach on a lesson session they own**. A browser-written
  audit row for a `students` edit is now refused outright. An audit trail with silent holes
  is worse than a known-absent one, because it gets trusted.
- Record the **old and new values** (`to_jsonb(OLD)` / `to_jsonb(NEW)`), not just "edited".
  The dispute this exists for is *what the number used to be*.
- Scope it: an `UPDATE` trigger firing on every column change includes the level picker,
  which is fine, but check the volume before adding one to a table the invoice engine
  touches under `service_role`.

### Check column geometry on every admin table, not just Levels — **S**
`verify-levels-table.mjs` measures each `<th>`'s rect against its column's `<td>` and fails
if they diverge. Point the same check at the other 13 admin table pages.

**Why:** the Levels table shipped with its header row nested inside another row and stayed
broken in production for a week (`docs/GOTCHAS.md` §7.54). **Every text-based assertion passed** —
the labels were all present, correctly spelled and in the right order, merely in the wrong
place. Only a human eventually noticed. The geometry check catches that class of bug, and
right now exactly one of fourteen tables has it.

**Notes:** the assertion is ~15 lines and already written; the work is fixtures, because
several admin tables are empty on the seed stack and a table with no body row has nothing
to compare a header against. **Skip-and-log rather than silently pass** on an empty table —
a page reported as "checked" when it had no rows is how this bug survives a second time.
`components/Table.test.tsx` already covers the *static* form of the mistake (a `<Tr>` inside
a `<Thead>`); this covers layouts that break for other reasons.

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

### `verify-levels.mjs` is not hermetic — **S**
It asserts an empty-ladder state as its first check, then creates levels and leaves them
behind, so the second run of the day fails on the first run's data.

**Why:** every other driver in the suite self-seeds and tears down. This one silently
depends on being run against a clean `tenant_levels`, which cost real time this session:
it failed, looked like a regression in the change under test, and needed a run against the
*unfixed* code to prove it was pre-existing.

**Notes:** it also drives Expo, so a fix should keep the admin half runnable alone — an
admin-only failure should not require port 8081. Delete the tenant's levels in a setup step
and again on exit, the way `fixtures-*-teardown.sql` does elsewhere.

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
| **Modelling substitute coaches** | Surfaced 2026-07-19 while making pay attribution effective-dated. A lesson pays the coach the class was assigned to **on that date** — so if Coach B covers one week for Coach A with no class change, **A is paid**. Not modelled, deliberately: the fix for a genuine cover is a per-session pay override, which the schema already supports (`session_pay_overrides`), and inventing a "who actually turned up" concept would add a second source of truth beside the class assignment for a case that has never occurred with one real coach. Revisit when a business has enough coaches to cover for each other. |
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
| **Any invoice or payment count in the COACH app** | Settled with the user 2026-08-02 while removing the coach's Billing tab. The Today screen carried an "Outstanding" tile counting unpaid invoices across every parent the coach serves, and the obvious repair was to relabel it *Unpaid invoices* and make it tappable. The user rejected the whole category: **a coach does not need to know how many invoices are unpaid — that is an admin-app question.** Since fee-free payment collection shipped (PRD §7.21), everything that makes an invoice actionable — the `INV-YYYY-NNNN` reference, the dynamic QR, the WhatsApp queue, the "parent says paid" badge, the **Claimed** filter — lives on `admin.swimsync.sg`, so a number on the coach's phone can only ever prompt a decision the coach cannot act on well. It was also **not today-scoped and not lesson-shaped** while sitting between "Classes Today" and "Students Today", so it read as a fact about today's lessons. A private coach holds the tenant-admin role anyway and loses nothing. **Don't re-add a count, a badge or a filter here** (PRD §7.9; the prohibition is also a comment in `(coach)/today/index.tsx`). |
