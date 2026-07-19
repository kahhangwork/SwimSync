# SwimSync — Backlog

_Last updated: 2026-07-19_

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

1. **Active / inactive status for parents and children** (M, _Admin_) — the anchor for the
   students table. Reconcile the two existing "inactive" notions (`is_active` vs
   `assignment_status`) and settle the status model **before** more fields are piled onto
   students.
2. **Child identification: NRIC last 4 + derived age** (S, _Parent experience_) — retire
   the stored `age` column (the same stale-second-source problem #1 fixes for status) and
   add NRIC. Rides the same students-schema + parent-home + admin-table edits as #1, so do
   it right after — otherwise those screens get touched twice.
3. **Collect address + postal code at parent signup** (S, _Parent experience_) — a
   `parents`-table addition touching the registration form; group with #2's
   onboarding-form work so those screens are opened once.
4. **Coach-defined swimming levels** (M, _Coach workflow_) — another students field; do it
   **after** the #1/#2 reconciliations so it respects the settled status/level model
   rather than adding churn to a table still being reconciled.

_Shipped 2026-07-18 and removed from this list:_ the **multi-class-parent under-billing
bug**, plus the configurable **invoice run day**, **month sealing**, and the **hard
attendance block** — see PRD §7.7 and HANDOVER §8.

_Shipped 2026-07-19 and removed:_ **extract the completeness-rule shared helper** (it was
#1; done as tenanting phase 0, and it immediately exposed a live underbill — HANDOVER
§7.18), and the whole **tenant/coach money cluster** including **coach wages**.

**Note the renumbering:** #1 is now *active/inactive status*, which was #2. It is the
oldest outstanding item in this document and is now genuinely next.

### Later — clusters with a fixed internal order

- ~~**The tenant/coach money cluster.**~~ **SHIPPED 2026-07-19** — multi-tenancy,
  the role split, and coach wages are all built and live. See `PRD.md` §4.3/§7.13 and
  `TENANCY_DESIGN.md`. It turned out **smaller than this entry feared**, and the reason
  is worth keeping: treating a **private coach as a tenant of one** meant coach *type*
  never became an authorization concept, so no rule branches on it and wages needed no
  private-vs-school check at all. The "built twice" risk this entry warned about was
  real, and was avoided by reframing rather than by building carefully.
  **Coach-created student profiles** (M) still sits behind this and is now unblocked.
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
dashboards (S), Deeper component-render tests (M), Production data cleanup (S),
Email-confirmation copy/templates (S).

### Later — big features carrying their own dependencies

Package pricing (L), Makeup lessons (L), Multiple classes per child (M), Parent
self-enrolment (M), Coach-assisted assignment (M), Household split billing (M), Auto PayNow
detection (L), In-app payment gateway (L), Multiple coaches per class (S), Multi-language
(M), Shared `lessonDates` package (M — *not recommended*, see the item), Generate real
Supabase `Database` types (M — *do last*, needs a frozen schema; see the item).

---

## Coach workflow

### Makeup lessons — **L** `[MVP-excluded]` `[Phase 3]`
A student misses a lesson and attends a different session to make it up, without being
billed twice.

**Why:** this is the most-requested thing in every real coaching business, and the
current model has no answer at all — a missed lesson is simply non-billable and gone.
As soon as parents are paying real money, "I paid for a lesson we couldn't attend" is
the conversation the coach will have to keep having by hand.

**Notes:** genuinely hard, and the reason it's L rather than M. It breaks two invariants
at once: one active class enrolment per student (§5.3) and billing straight from
attendance (§5.5). A makeup means a student appears on a class they aren't enrolled in,
and a lesson gets paid for on a date other than the one it happened. Worth designing on
paper before touching code — probably a "makeup credit" concept distinct from the
existing money-credit-note, so the two ledgers don't get confused with each other.

### Coach-defined swimming levels — **M** `[handover]`
Let coaches define their own level labels and set a level per student.

**Why:** the class name currently carries the level ("SwimSafer Level 5"), which works
for one coach with four classes and stops working the moment a coach wants to track a
student's progress *within* a class, or a second coach uses different level names.

**Notes:** `students.swimming_ability` (nullable enum) was **deliberately kept** in the
schema for this and is always NULL today — nothing writes it, nothing displays it. When
this returns it should be **coach-defined**, not the current fixed
beginner/intermediate/advanced enum, and probably free text or a new table. **Do not
re-add a parent-facing level picker** — parents self-reporting ability was removed on
purpose (PRD §5.1, HANDOVER §6).

### Coach-created student profiles — **M** `[MVP-excluded]`
Let a coach create a student directly, instead of only parents creating them.

**Why:** students are parent-created only, so a coach who signs up a family poolside
can't enter them — the parent must go home, self-register, and add the child before the
coach can mark a single lesson. That's the friction being felt right now during the
first real onboarding push. It also blocks the trial-lesson case: a walk-in trial can't
be marked at all until the parent has an account.

**Notes:** needs care with the parent-link model (`parent_students`) and RLS — a
coach-created student has no parent account to link to yet, so it needs either a
placeholder parent or a claim flow where a parent later takes ownership. The claim flow
is the better shape but the bigger build.

### Attendance edit history view — **S** `[Phase 2]`
Surface the existing audit trail in the UI.

**Why:** every attendance edit is already logged to `audit_log`, but nobody can see it
without SQL. When a parent disputes a charge, the answer exists and is unreachable.

**Notes:** the data is already there — this is a read-only view, not a new capability.
Admin panel first; the coach probably doesn't need it.

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

### Package / subscription pricing — **L** `[MVP-excluded]` `[Phase 3]`
Sell a block of lessons (or a monthly subscription) up front instead of billing per
attended lesson.

**Why:** it's how a lot of swim schools actually price, it smooths the coach's cash
flow, and it makes revenue predictable. Pay-per-attendance means a rainy month is a pay
cut.

**Notes:** this is not a pricing tweak, it's a **second billing model** living beside
the first, and it inverts the core rule that billing derives from attendance (§5.5).
Packages need a balance to draw down, an expiry policy, and a completely different
answer to "what happens when a lesson is cancelled." Expect it to touch the invoice
engine, the credit ledger, and every billing screen.

Decisions already made:

- **Coexists with pay-per-use, doesn't replace it.** Today's model is entirely
  pay-per-use — the student attends, and the parent settles the month's attended lessons
  at month end. Package means the parent pays for e.g. 10 lessons up front and each
  attendance draws the balance down 10 → 9. Both models must be live at once, so
  **the payment model is a property of the enrolment, not of the system** — and the
  invoice engine has to skip package-covered attendance rather than bill it twice.
- **A package belongs to the parent, not the child.** A parent with 3 kids buys one
  package and all 3 draw from the same balance. This has precedent worth following:
  `parents.credit_balance` is already pooled per parent (HANDOVER §6), so a package
  balance hanging off `parents` matches the ledger people already have a mental model
  for. It also means concurrent draw-down is real — two kids in Saturday classes marked
  from two screens hit one balance, so the decrement belongs in the database, not the
  client.

Still open before starting: expiry, what happens when a balance hits zero mid-month
(fall back to pay-per-use, or block?), and whether a refund of unused lessons lands in
`credit_balance` or back on the card.

### Household-level split billing — **M** `[MVP-excluded]`
Let two parents (e.g. separated households) each receive a share of the invoice.

**Why:** requested often enough in family-facing products to be worth recording. Today
one invoice goes to one parent account, and any splitting happens between the parents
off-platform.

**Notes:** the data model is closer to ready than it looks — `parent_students` is
already **many-to-many**, so a student can have two parents. What's missing is a split
rule and a decision about which parent's credit balance a correction lands in. Credit is
pooled **per parent** (HANDOVER §6), so splitting invoices without splitting credit
would produce a ledger nobody can explain.

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
deactivate), which is why it has never bitten. Fix before adding one. Probably: bill from
classes that had sessions in the month regardless of `is_active`, and keep `is_active` for
*scheduling* only.

### Tie the attendance-marking window to un-invoiced months — **S**
The coach's marking window floor is a **calendar proxy** — `max(start of last month, earliest
enrolment)` (`lib/lessonDates.ts:backlogWindowStart`) — not "the earliest month not yet
invoiced."

**Why:** the moment a month is invoiced (say July, on 1 Aug), its lessons stay *in-window*
until the calendar rolls over, but a lesson marked there now would **not** be added to the
existing invoice — so it's markable yet unbillable, a small silent gap. The calendar rule is a
fine default for the manual monthly cadence; this closes the seam if it ever matters.

**Notes:** would make `backlogWindowStart` consult `billing_periods`/existing invoices rather
than a pure date rule. Minor; recorded so the limitation (noted in HANDOVER §8b) isn't
re-derived. Related to the credit-note flow, which is the *correct* tool for changing an
already-invoiced lesson.

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
not require pre-generating sessions** — resist that; see HANDOVER §6.

### Collect address and postal code at parent signup — **S**
Add address and postal code to the registration form.

**Why:** the coach has no way to reach a family off-platform beyond a phone number, and
postal code is the one field that answers "is this family near a pool I teach at?" —
which is the question behind every enquiry the coach currently answers from memory.

**Notes:** smaller than it looks — **email and phone are already collected** at signup
(`profiles.email`, `profiles.phone`, set via the auth trigger; the form is
`SwimSyncApp/app/(auth)/register.tsx`), so this is address + postal code only. Put them
on `parents`, not `profiles`: `profiles` is shared with coaches and superadmins, and a
home address is a parent-shaped fact. **Existing parents won't have them**, so the
columns are nullable and any screen showing them needs an empty state — or the profile
screen needs a prompt to fill them in. Postal code is 6 digits in Singapore and worth
validating as such; the address itself should stay free text. Related: Maps integration
above, if a parent address ever needs to be more than a string.

### Child identification: NRIC last 4 and derived age — **S**
Capture the last 4 characters of a child's NRIC at registration, and show age as
something derived from date of birth rather than stored.

**Why:** **name alone isn't a unique identifier** — a coach with two students called
"Ethan Tan" on the same roster has no way to tell them apart, and picks wrong on the
attendance screen. Name + NRIC last 4 is how Singapore actually disambiguates people,
and it's what the parent will already have to hand. (Last 4 = the last 3 digits and the
letter, e.g. `S9012345A` → `345A`.)

**Notes:** the DOB half is **mostly already done** — `students.date_of_birth` exists and
`add-child.tsx` already requires it in `YYYY-MM-DD` form. The real gap is that
`students.age` is a **stored integer**, described in the PRD's Students field table as
"age (if DOB not provided)" — a second source of truth that silently goes stale the day
after it's written. Derive age from `date_of_birth` at read time and **retire the stored
column** — check `child/[id].tsx` and the admin student tables before dropping it.

For the NRIC field: store the **last 4 only, never the full number**, and be deliberate
that this is still PII — it goes on `students`, which coaches can already read for any
student enrolled in their class via `coach_serves_student()`
(`supabase/migrations/20260309000600_rls_policies.sql:133`), so it will be visible on
rosters. Uniqueness should be a
**warning, not a constraint** (two siblings can't share it, but a parent typo shouldn't
block registration, and existing students have no value at all). That last point makes
it nullable, so anything treating name + NRIC as *the* identifier needs a fallback for
the rows that predate it.

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

### WhatsApp payment reminders — **M** `[Phase 2]`
Nudge parents about outstanding invoices over WhatsApp.

**Why:** in Singapore, WhatsApp is where this conversation actually happens — the coach
is already sending these messages by hand. Email is politer; WhatsApp gets read.

**Notes:** a named secondary goal since the original PRD (§2.2). Needs the WhatsApp
Business API (approval + per-message cost) or an unofficial bridge, which is
against-terms and fragile. **Sequence this after email**, which is free and already
wired. Consider a middle option first: a "copy reminder message" button the coach pastes
into WhatsApp — no API, most of the value.

### Push notifications — **M** `[MVP-excluded]`
Native push to parents and coaches.

**Why:** the natural home for the reminders above, and for "attendance marked" /
"invoice ready."

**Notes:** **blocked on native store builds** — push doesn't work on the static web app
that's currently deployed, so this can't precede the platform item below. Note that
Notification Preferences buttons were **removed** from coach Settings and parent Profile
as dead stubs; HANDOVER §12 has the restore notes. Don't re-add the button until there's
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

### Active / inactive status for parents and children — **M** `[handover]`
An explicit active/inactive state on each child and each family, per business, with the
date each went inactive. **Designed in full on 2026-07-19; not built.** The design below
is decided — start at Phase 1 rather than re-opening it.

**Why:** families leave, and today the only way to express that is deleting them — which
destroys the billing history you need at tax time — or leaving them in place, where they
pad every roster and every unmarked-lesson report forever. The inactive date is the part
that earns its keep: "when did they stop?" is the question behind every end-of-year
reconciliation and every "why is this invoice short?"

**The model — three concepts, three owners, three different words.** Two words for two
different powers is the point: "inactive" already means two things today, and a third
would have made it worse.

| Concept | Lives on | Who controls it | Means |
|---|---|---|---|
| **Enabled / disabled** | `profiles.is_active` | Platform admin | Can this person log in at all? |
| **Active / inactive** | `parent_tenants.is_active`, `students.is_active` | The business's admin | Still a customer *of this business*? |
| **Assigned / unassigned** | `students.assignment_status` | The business's admin | In a class right now? |

Decisions made, with the reasoning worth keeping:

- **`assignment_status` loses its `inactive` value**, becoming `unassigned | assigned`.
  The two are genuinely separate axes — a new signup is *active but unassigned* — and
  keeping a third way to say "left" is the drift this item exists to remove. This also
  deletes the display override at `SwimSyncAdmin/app/(admin)/students/page.tsx:81`.
- **Parent inactive is PER BUSINESS, on `parent_tenants`.** This item predates
  multi-tenancy and the boundary matters: parents are global, so a school marking a
  family inactive must not switch them off at their private coach.
- **Cascades are PROMPTED, never silent**, both directions — last active child → offer to
  mark the family inactive; family → offer to mark their N children. Same instinct as the
  bulk-attendance confirm guard. A tap must not rewrite records that are off-screen.
- **Re-activation is the JOIN CODE, and needs no new UI.** An inactive family can still log
  in (they are not *disabled*); re-entering the business's code flips
  `parent_tenants.is_active` back. `join_tenant_by_code()` must flip rather than collide
  with `UNIQUE (parent_id, tenant_id)`. **A returning parent cannot re-sign-up** —
  `profiles.email` is UNIQUE (`20260309000100_initial_schema.sql:26`) and so is
  `auth.users.email`, so email-as-identity is already guaranteed and there is no dedup to
  build. Reactivation restores **status only**: children stay inactive and the admin
  reassigns them through the existing flow, because guessing which class they meant is how
  you get a wrong roster.
- **Platform-level disabling of PARENTS was considered and cut** — see
  *Disable a staff account* below for the reasoning and where it went instead.

**Phases.** 1–2 are additive and touch no RLS.

| # | |
|---|---|
| 1 | `parent_tenants.is_active` + `inactivated_at`; `students.inactivated_at` |
| 2 | `set_parent_tenant_active()`, `set_student_active()`; `join_tenant_by_code()` flips instead of colliding |
| 3 | **A new admin Parents page** — there isn't one today (10 admin pages, none for parents), so this is a screen, not a button. Plus the cascade prompts and an "include inactive" toggle |
| 4 | Platform page: parent status — children grouped by business with their active state. Deliberately **not** assigned/unassigned, which is the business's concern |
| 5 | Parent app: an inactive business stays **visible and read-only** (past invoices are the tax-time record), actions gated |
| 6 | **Contract**: drop `inactive` from the enum. Postgres cannot remove an enum value in place — new type, migrate rows, swap, drop. **Deploy the app FIRST** (dropping inverts the order; the live parent chip still reads the old value) |

**Notes — what's already there, and the trap.** `close_student_enrolment()` (2026-07-18)
writes `assignment_status` and `is_active` in step but **never settled which is
authoritative**; there are now live callers depending on that. Critically,
**`students.is_active` is effectively write-only today** — every roster, attendance screen,
completeness check and billing query filters on `student_class_enrolments.is_active`, the
*enrolment*, not the student. The only read anywhere is that one display override. So this
is mostly *choosing* a model, not untangling two entrenched ones.

`profiles.is_active` is **enforced nowhere at all** — not in RLS, not at login. A
"deactivated" parent can log in and use the app normally today. Grep before Phase 2 lands:
anything that happens to read it truthily changes behaviour the moment it means something.

Check `student_class_enrolments.is_active` before starting: the completeness gate builds
its student list from **active enrolments only** and never consults `students.is_active`
(`supabase/functions/generate-invoices/core.ts`), so an inactive child with a live
enrolment still counts — and shows as an unmarked lesson, the false alarm that teaches a
coach to ignore the report (PRD §7.5). Deactivating a child almost certainly has to close
their enrolment too.

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

- **A private coach holds `tenant_admin` *and* a `coaches` row** (HANDOVER §6). "Disable
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
Filters and search across the admin tables.

**Why:** fine at 17 students, painful at 100. Filing this as a scale problem, not a
today problem.

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

### Extract the completeness rule into a shared helper — **S** `[handover]`
"A lesson is marked only when every actively-enrolled student has an attendance row on
it" is **hand-written in four places**: `core.ts:141-152` (engine gate),
`SwimSyncAdmin/lib/classCoverage.ts`, `(coach)/today/index.tsx` (`fullyMarked`), and
`(coach)/classes/[id]/roster.tsx`.

**Why:** HANDOVER §6 calls this "duplication waiting to drift," and it's right. This
rule *is* the billing safety net — if the coach's screen and the admin's gap report ever
disagree about what "marked" means, the disagreement shows up as an underbill nobody
notices.

**Notes:** the engine copy is **unavoidable** (Deno, no npm resolution), so the target is
three-into-one, not four. Until then: **if you touch the rule, touch all four.**

**Weightier since 2026-07-18** (HANDOVER §8): unmarked attendance now *blocks* invoicing, so
the admin's pre-flight check (`classCoverage.ts`) and the engine's gate are two separate
implementations of the rule that gates real money. If they drift, the button enables and the
server refuses — safe, but confusing, and the reverse drift would be worse.

### Enforce the attendance window at save time — **S** `[handover]`
The coach attendance screen (`(coach)/classes/[id]/attendance.tsx`) writes whatever `date` it
is handed, with no validation.

**Why:** as of HANDOVER §8b every *entry point* (the roster button, Unmarked Lessons, Past
Sessions) is bounded to the lesson window, so the UX no longer offers a bad date. But the
screen itself has no guard — a hand-typed URL, or a future new entry point that forgets the
window, could still create/bill a session **outside the window or on a non-lesson day**. That's
the exact phantom-lesson billing risk the UX fix closed, just via a different door.

**Notes:** defense-in-depth — reject a `date` outside `[backlogWindowStart(today, enrolment),
today]` or whose weekday ≠ the class's `day_of_week`, in the save handler (and ideally mirror
it in a DB check). Cheap, and it makes the window a real invariant rather than a UI convention.

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
start this while migrations are still landing (active/inactive, NRIC, coach wage, tenanting
are all schema-touching backlog items ahead of it). The natural trigger is "the schema is
frozen and we want compiler-enforced safety before a big build."

### Deeper component-render tests — **M** `[handover]`
RN screens with a mocked Supabase; admin table components.

**Why:** frontend tests currently cover `lib/**` pure functions only. The billing *maths*
is well covered (34 pgTAP + 8 Deno), but the screens where a coach actually loses money
by abandoning a task are covered only by hand-run Playwright drivers.

**Notes:** named in HANDOVER §5 as "the natural next additions." The
`run-ui-playwright` drivers show what's worth pinning.

### Shared `lessonDates.ts` package — **M**
The file is duplicated **byte-identical** in both apps.

**Why:** filed for visibility, **not recommended**. HANDOVER §6 makes the case
deliberately: separate npm projects, no workspaces, different React majors, different
bundlers and test runners. Sharing ~120 lines of pure date maths would need workspace +
Metro `watchFolders` + `transpilePackages` surgery. The file has **zero imports**, so
drift is cheap to spot (`diff` the two), and each has its own test file.

**Notes:** the reason to revisit is if workspaces arrive for *another* reason — then
this comes along free. Until then: **edit both.** Recorded so the decision isn't
re-litigated from scratch every time someone notices the duplication.

### Production data cleanup — **S**
Two leftovers from pre-launch verification may still be in the cloud project: an
**orphaned PayNow QR file** (from the demo coach "Marcus") in Storage, and a throwaway
test parent **`kahhangg+swimrt1@gmail.com`** in auth.

**Why:** harmless, but the production DB is otherwise a genuine clean slate, and this is
the only known exception. It's recorded **only in Claude's project memory** right now —
which ages out. Writing it down here is most of the value.

**Notes:** both are dashboard operations (no service key locally).

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
| **Pre-generating lesson sessions** (a scheduled session generator) | PRD §7.5 is knowingly unimplemented and should stay that way. Sessions are created lazily by the coach's attendance save; which lessons *should* have happened is derived at read time from `classes.day_of_week`. Pre-generation adds a job, a schedule, and a pile of edge cases when classes change — for no gain the read-time derivation doesn't already deliver. **Don't "fix" this** without a reason the derivation genuinely can't serve. (HANDOVER §6.) |
| **A parent-facing swimming-ability picker** | Removed on purpose (PRD §5.1). Parents self-reporting ability isn't information anyone trusted; the class a child is in is the real signal. If levels return they should be **coach-defined** — see the backlog item above. |
| **Re-adding Notification Preferences / Help & Support buttons** | Removed as dead stubs with empty handlers, not lost (HANDOVER §12). Build the feature first, then the button. |
| **`Alert.alert` for user feedback** | A **no-op on RN-web**, so it silently does nothing on the deployed app. Use `confirmAction` / the global Toast / inline form errors instead (HANDOVER §12a). The only sanctioned use left is the native-only media-library permission prompt. |
| **Invoicing a child immediately when they are set inactive** | Proposed as "settle up what they owe on the way out"; rejected 2026-07-18. Invoices are `UNIQUE(parent_id, billing_month)`, so an early partial-month invoice makes the regular run skip that parent via the `already_exists` guard — stranding their **siblings'** lessons for that month. That is exactly the multi-class underbilling bug the same session fixed, re-entered through a new door. It also breaks PRD §7.7's one-complete-calendar-month rule. The normal cycle already bills them correctly, because billing follows **attendance rows** rather than current enrolment (HANDOVER §8). |
| **An override / "Generate anyway" on the attendance block** | Removed deliberately 2026-07-18 (PRD §7.7). The case it appeared to serve — a class that genuinely didn't run — is already handled *inside* the completeness rule by marking everyone `cancelled_rain`/`cancelled_coach`. So the bypass wasn't covering a legitimate case; it was letting an unrecorded lesson through into a **permanent** underbill, because a lesson can never be added to an invoice that already exists (§11.6). The escape hatch for a class that can't be completed is removing the student, not overriding the check. |
| ~~**A per-tenant invoice run day**~~ **— NOW BUILT (2026-07-19)** | Kept as a record of the reasoning, which held up. It was correctly refused while there was one business, and shipped as a per-tenant column the moment tenanting arrived, exactly as this row predicted ("trivial next to the RLS rewrite that happens anyway"). A useful example of deferring a small generalisation until the thing that needs it exists. |
| **Modelling substitute coaches** | Surfaced 2026-07-19 while making pay attribution effective-dated. A lesson pays the coach the class was assigned to **on that date** — so if Coach B covers one week for Coach A with no class change, **A is paid**. Not modelled, deliberately: the fix for a genuine cover is a per-session pay override, which the schema already supports (`session_pay_overrides`), and inventing a "who actually turned up" concept would add a second source of truth beside the class assignment for a case that has never occurred with one real coach. Revisit when a business has enough coaches to cover for each other. |
| **A browsable directory of coaches / schools for parents** | Considered as the way a parent picks their business, rejected 2026-07-19 in favour of **join codes** (PRD §5.1). A list publishes SwimSync's entire customer roster to every parent and every competing school; worse, a mis-tap puts a child on a stranger's roster where that business's admin can see and bill them, because nothing in the flow proves the family deals with them. **Possession of a code is that proof.** It also stops scaling at a few hundred tenants. If a discovery feature is ever wanted, make it search-by-exact-name so the full list is never enumerable. |
| **A "view as tenant" impersonation mode for the platform admin** | Rejected 2026-07-19 while building the platform page. It means scoping *every* admin screen to a chosen tenant rather than the caller's own — far larger than the support need, which is answered by a cross-tenant business list plus the ability to **move a student** between businesses (PRD §4.4). Revisit only if support actually gets stuck without it. |
| **Cross-tenant students** (one child taking lessons at two businesses) | Out of scope 2026-07-19. A student belongs to one business, and `one_active_enrolment_per_student` already enforces one active class. Note this **is** a real thing in Singapore, so this is a "not yet" rather than a "never" — but it touches enrolment, billing and the tenant boundary at once. Revisit on actual demand, not in anticipation. |
| **Platform billing (SwimSync charging the schools)** | Deliberately unbuilt 2026-07-19: the pilot is free. `tenants` is the natural billing subject when it arrives, so nothing in the current schema blocks it — but building it now would be a second money model with no payer. |
| **Putting the SwimSync mark on the invoice email** | Rejected 2026-07-19 while adding the logo. That header is the **tenant's** logo and business name by design (PRD §7.10): a parent pays their coach or school, and an invoice headed "SwimSync" reads as a platform bill — actively confusing for a family with children at two businesses. SwimSync is named in the footer as sender of record, and that is the whole of its billing there. The *recovery* email is a separate case and also stays wordmark-only: SVG does not render in most mail clients, and a hosted PNG adds a broken-image failure mode to the one message a locked-out user needs. (HANDOVER §8.2, `brand/README.md`.) |
| **A non-calendar wage cycle** (e.g. 16th–15th) | Wages assume **calendar months**, with only the *pay day* configurable (PRD §7.13). A different period boundary is a new period concept rather than a setting, and would need its own sealing and adjustment rules. Nobody has asked for it. |
| **Per-coach / per-tenant timezone (now)** | The invoice engine's billing timezone is a single configurable seam (`APP_TIMEZONE`, default `Asia/Singapore` — `generate-invoices/dates.ts`), and the frontend stays SG-hardcoded. Multi-timezone is a "don't-paint-into-a-corner" concern, **not near-term** (the user's explicit call). Don't build per-tenant TZ or generalize `lessonDates.ts` to multi-TZ before then — true multi-timezone folds into the **tenanted admin accounts** item when that lands. (HANDOVER §8a.) |
