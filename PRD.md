# SwimSync — Product Requirements Document

**Swim Coach Attendance & Billing App**
**MVP Version 1.0**

| | |
|---|---|
| **Status** | Draft |
| **Version** | 1.0 |
| **Date** | March 2026 |

> **Build status (July 2026):** Backend rebuilt as reproducible Supabase CLI migrations with full RLS; runs on a local Supabase stack (Docker). The **entire MVP core loop works and is verified end to end across the UI + backend**: parent self-registration, joining a business by code, child creation, admin assignment, coach attendance marking, invoice generation (automatic *and* manual on-demand, with an on/off switch), the **credit-note correction flow** (auto-issue on attendance edit + FIFO application incl. partial carry-forward — see §5.6), and **PayNow QR** (coach upload → parent display → admin view). A partial-application ledger bug found during credit-note verification was fixed via a `credit_applications` allocation table (see §9.17). An **automated test suite** now covers the billing/credit engine (Deno) and DB triggers/RLS/constraints (pgTAP). **Password reset** is implemented on the mobile app (self-service recovery flow via `resetPasswordForEmail` → in-app reset screen → `updateUser`, working across Expo web and native deep links), and login/register errors are mapped to friendly copy — see §7.1. The code lives on GitHub (public, `kahhangwork/SwimSync`). **Now live in production on its own domain (web-first, free tier):** the mobile app at **https://swimsync.sg** and the admin at **https://admin.swimsync.sg** (Vercel), backend on Supabase, real transactional email via **Resend** (`noreply@swimsync.sg`, e.g. password-reset). A real coach + 4 classes are onboarded, alongside real families and children; real attendance has been marked since 2026-07-26, and **the first real invoices were generated — and the first real payments collected — on 2026-08-02** (counts are `SELECT count(*)` against production, never this sentence; HANDOVER §3). Automated tests (pgTAP + Deno + frontend vitest/jest-expo suites — counts live in `docs/TESTING.md` §5, whose own rule applies: the test runner is the fact, prose is the hint) run in CI on every push. Swimming ability is no longer a parent-entered field (see §5.1). Invoice generation is **manual** — cron is built and per-tenant but **not yet enabled**, a decision now open rather than blocked (both original blockers — the UTC-derived billing month and the fixed run day — are fixed); see `INVOICE_RUNBOOK.md` and `HANDOVER.md` §9. **SwimSync is now MULTI-TENANT** *(July 2026)*: a **tenant is a business**, a **private coach is a tenant of one**, and the old global `superadmin` has split into a **tenant admin** (one business) and a **platform admin** (cross-tenant support) — see §4.3; the platform admin now has **their own panel** and the single-business pages are closed to them (§4.4). Parents join a business with a **join code** (§5.1); there is no public directory. Invoices, credit, month-sealing, the completeness block and the billing schedule are all **per business**, credit **never crosses** businesses (§5.6), invoice emails and the PayNow payee are **the business's** (§7.10), and **coach wages** are computed from attendance with effective-dated rates (§7.13). **A lesson is priced and attributed by its OWN date** *(2026-07-19)*: a class's price and its paid coach are effective-dated, so editing a price no longer reprices the previous month and handing a class to another coach no longer moves the outgoing coach's pay — and a payout correction is carried once rather than every month thereafter (§7.3, §7.7, §7.13). Cross-tenant isolation is enforced in RLS *and*, because the billing engine bypasses RLS, in engine code. **Each parent gets one invoice per business covering every class their children attend there**, a billing month must have **ENDED before it can be billed** *(2026-07-19 — live; billing a month still in progress used to seal it and strand its remaining lessons permanently, §7.7)*, generation is **blocked until all of the month's attendance is marked** (no override — a lesson that didn't run is marked *cancelled*), a finished month is **sealed** so it is never reprocessed (but a month with **nothing recorded** is never sealed — that vacuous seal locked a month out of billing entirely until it was fixed 2026-07-18), and the automatic path waits until a **configurable day of the month** (default the 7th) — see §7.7. Removing a child from a class, or marking them inactive, is available to the **business's admin and their coach** (§7.4). **Families and children carry an active/inactive state per business** *(2026-07-19)*, with the date they left; deactivating the last child marks the family inactive too, and a departed family returns by re-entering the join code (§7.14). Generation also **emails the parent** a branded, itemized invoice on creation (best-effort, isolated from billing; live in production since 2026-07-16 — see §7.7). **Lesson sessions are created lazily, not pre-generated, and the lessons that *should* have happened are derived from each class's weekday at read time** — surfacing unmarked lessons to the coach and reporting attendance gaps to the admin before invoices are generated (see §7.5 and §7.7), which closes a hole where a forgotten lesson was silently unbillable and invisible to everyone. **The marking window is now enforced by the database rather than by the screen** *(2026-07-27)*: attendance may only be recorded for a lesson on the class's own weekday between the business's marking floor and today, so a phantom lesson can no longer be created — and billed — by reaching the screen with a hand-typed date; a genuine makeup lesson is scheduled by the business's admin instead, and **who was expected at a lesson is now answered per date**, so a child who joined mid-month no longer blocks that whole month from being billed (§7.5, §7.6). **That floor follows what the business has BILLED rather than the calendar** *(2026-08-07)* — the 1st of last month, or the month after its most recently billed month, whichever is earlier — because the calendar version made a month billed LATE permanently unbillable: the gate named an unmarked lesson nobody could record any more, with no override by design (§7.6). **Real billing happened**: the engine processed its first real month (July 2026) on 2026-08-02 — real invoices with `INV-YYYY-NNNN` references, real PayNow payments against the dynamic QR (§7.21), and the month sealed (HANDOVER §8.26). Parents self-register at `swimsync.sg`, enter their coach's join code, add children, and the business's admin assigns classes. Native App/Play Store builds are deferred. Sections marked *(implemented)* reflect build decisions that extend or refine the original spec. **Child identity, levels and family address** *(2026-07-19 — live)*: a child is identified by **name + date of birth** rather than name alone, with age **derived** from that date rather than stored (§5.1); each business defines **its own swimming-level ladder** (§7.15); families have an **address and postal code** (§5.1); and a **parent can edit their child's profile** — which the spec had claimed since the original draft while nothing implemented it (§7.4). Making that editable surfaced two pre-existing defects that had been unreachable only because nothing in the app could write to a student: a parent could **move their own child into another business**, defeating the join code, and **renaming a child rewrote invoices already sent** and credit notes §7.8 calls immutable. Both are fixed; invoices and credit notes now record the name they were issued with (§7.7). **Prepaid lesson packages** *(2026-07-20)*: a business can sell N lessons at a locked rate, valid M months, scoped to its own class categories — a prepaid dollar balance drawn down by the same invoice engine at the package's rate, displayed everywhere as an always-exact lesson counter that is live to the day (§7.16). Ad-hoc after-the-fact billing is unchanged and remains the default; §3.2's "package-based pricing" exclusion is hereby retired. **A business can now be created from inside SwimSync** *(2026-07-21 — live)*: the platform admin provisions a business and emails its first admin a link to set their password (§4.4). Until this shipped every tenant had been inserted by hand — seed file, backfill migration, or dashboard SQL — and there was no way to create a tenant admin at all; onboarding a second business meant a database console. There is deliberately **no public signup**. **A business can have multiple admins** *(2026-08-06)*: the first admin is the **owner**, who invites, deactivates and deletes co-admins from their own panel — identical authority except admin management itself, which is owner-only, and the owner can never be removed (§4.3). Coach and parent accounts are refused at the admin panel's door. **A child can now exist before their parent does** *(2026-07-25)*: the business's **admin** books a trial or adds an unregistered student (the coach cannot — see §7.17), the coach marks them from then on, the admin later invites the parent by email, and the parent **adopts the existing record** rather than anything being transferred — so the attendance marked before they had an account is simply theirs. A billable lesson with nobody to bill **holds the billing month open** rather than being silently dropped and sealed over, released either by inviting the parent or by recording the money as settled outside SwimSync (§7.17). See `HANDOVER.md` for the current working state and next steps.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Product Goals](#2-product-goals)
3. [MVP Scope](#3-mvp-scope)
4. [User Types](#4-user-types)
5. [Key Business Rules](#5-key-business-rules)
6. [Core User Stories](#6-core-user-stories)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Data Model](#9-data-model)
10. [Invoice Calculation Logic](#10-invoice-calculation-logic)
11. [Edge Cases](#11-edge-cases)
12. [UI / UX Notes](#12-ui--ux-notes)
13. [Suggested Tech Stack](#13-suggested-tech-stack)
14. [Screen Flow & Wireframe Reference](#14-screen-flow--wireframe-reference)
15. [Release Plan](#15-release-plan)
16. [Success Criteria for MVP](#16-success-criteria-for-mvp)
17. [Open Implementation Notes](#17-open-implementation-notes)
18. [Final MVP Decisions Summary](#18-final-mvp-decisions-summary)

---

## 1. Product Overview

**SwimSync** is a mobile-first application with a companion web admin panel designed for part-time private swimming coaches in Singapore. It enables coaches to manage students, classes, attendance, and monthly billing through a streamlined digital workflow.

SwimSync supports four user types *(implemented — the original three, with `superadmin` split in two; see §4.3)*:

| User Type | Description |
|-----------|-------------|
| **Parent** | Registers, creates child profiles, views attendance and invoices |
| **Coach** | Manages attendance, tracks payments, views their own payout |
| **Tenant admin** | Runs **one business**: its classes, assignments, billing and PayNow QR |
| **Platform admin** | SwimSync itself, cross-tenant, for support only |

> *(implemented)* The original spec named a single global **Superadmin**. It was doing two
> different jobs — running a business, and operating the platform — so it split into a
> **tenant admin** (one business, entirely) and a **platform admin** (cross-tenant, belongs
> to no business). **A private coach is a tenant of one**: they hold *both* tenant admin and
> coach. Read "superadmin" elsewhere in this document as "the business's tenant admin" —
> the capability is unchanged, only its blast radius is. See §4.3.

> *The original MVP note here — "may initially be used by a single coach, but the
> architecture should support multiple coaches" — was met and then exceeded: SwimSync is
> multi-tenant, so it supports multiple coaches **and** multiple independent businesses.*

### Key Purposes

- Allow parents to create accounts and add their children's profiles in SwimSync
- Allow the business's admin to assign children to coaches and classes
- Help coaches manage attendance and payment tracking
- Allow parents to view their children's attendance and payment status
- Support end-of-month billing based on actual attendance
- Allow payment via the **business's** PayNow QR code *(implemented — changed from
  per-coach: a school has one bank account, so an individual coach's QR would send the
  payment to the wrong person. See §7.10)*
- Allow coaches to manually verify payment received
- Support credit notes for attendance corrections after invoicing

---

## 2. Product Goals

### 2.1 Primary Goals

- Give parents an easy way to register and add their children's information via SwimSync
- Give superadmin a simple way to assign children to coaches and classes
- Give coaches a simple way to manage attendance and billing follow-up
- Give parents visibility into attendance and payment status
- Automate invoice generation based on actual monthly attendance
- Handle post-invoice attendance corrections via credit notes

### 2.2 Secondary Goals

- Support multiple children under one parent account
- Support multiple coaches in future
- Support a separate PayNow QR code per **business** *(implemented — changed from
  per-coach: a school has one bank account, so an individual coach's QR would send the
  payment to the wrong person. See §7.10)*
- Provide a foundation for future WhatsApp reminders and more advanced billing logic

---

## 3. MVP Scope

### 3.1 In Scope

#### Parent Features

- Parent self-registration via email/password
- Parent login
- Create and manage child/student profiles
- View all children linked to the same email account
- View each child's class information once assigned
- View attendance history
- View invoices, credit notes, and payment status
- View coach's PayNow QR code for payment

#### Coach Features

- Coach login
- View assigned classes and students
- Track attendance per lesson
- View invoices related to their students
- Mark invoices as paid manually
- Upload and manage own PayNow QR code
- Edit past attendance (triggers credit note if invoice already generated)

#### Superadmin Features

- View all parents and student profiles
- View all unassigned children
- Assign children to coaches and classes
- Manage class rosters, coaches, and classes
- View attendance, invoices, and credit notes

#### Billing Features

- Billing based on actual attendance
- Monthly invoice generation after the billing month ends — automatically from a **configurable day of the following month** (default the **7th**), or manually on demand (§5.5)
- Separate invoice per parent account
- Manual payment verification by coach
- Credit note issuance for post-invoice attendance corrections

#### Admin / Web Panel

- Simple web admin panel for superadmin use
- Manage classes and view unassigned children
- Assign children to coaches/classes
- View attendance, invoices, and credit notes
- Mark invoices as paid and manage PayNow QR

### 3.2 Out of Scope for MVP

| Feature | Feature |
|---------|---------|
| Makeup lessons | Package-based pricing |
| Parent self-enrolment into classes | Multiple classes per child |
| Multiple coaches per class | ~~Coach-created student profiles~~ *(shipped 2026-07-25, §7.17)* |
| Auto-detection of PayNow payment | In-app payment gateway integration |
| Export to Excel or CSV | Maps integration |
| Multi-language support | Push notifications |
| Automated reminder workflows | Household-level split billing |

> *(This table is the historical record of the MVP scope decision — items leave it by
> shipping, not by deletion. Shipped since: **package-based pricing**, as prepaid lesson
> packages, 2026-07-20 (§7.16); **coach-created student profiles**, 2026-07-25 (§7.17).)*

---

## 4. User Types

### 4.1 Parent

A parent registers on SwimSync using email/password and creates profiles for their own children.

#### Parent Permissions

- Register and log in to SwimSync
- Create and edit child/student profiles
- View all linked children
- View class details for assigned children
- View attendance records, invoices, credit notes, and payment status
- View PayNow QR for payment

#### Parent Restrictions

- Cannot assign child to coach or class
- Cannot edit attendance
- Cannot mark payments as paid
- Cannot view children not linked to their account

### 4.2 Coach

A coach uses SwimSync to manage attendance and payment tracking for students assigned to their own classes.

#### Coach Permissions

- View own classes and assigned students
- Mark and edit attendance (edit triggers credit note if invoice exists)
- *(implemented — changed 2026-08-02)* View **their own pay** (`coach_payouts`), and
  nothing else about money. The coach app shows **no invoices, no credit notes and no
  mark-as-paid**; see §7.9
- Upload own PayNow QR *(only if they are also the business's admin — see below)*

#### Coach Restrictions

- **Cannot create student profiles.** *(This restriction was briefly lifted on 2026-07-25
  and REINSTATED on 2026-07-25 — see §7.17. Slice 1 gave the coach an "Add a walk-in" form
  on the attendance screen; the next session removed it when a trial became a **booking
  arranged ahead of time by the business's admin**. `add_unclaimed_student()` **no longer
  accepts a coach caller** — the ONGOING arm was made admin-only on 2026-08-21 (§7.202),
  joining the TRIAL arm, so both kinds require the tenant admin; no coach UI ever reached it
  regardless. A private coach adds children through their **tenant admin** account, which
  they hold anyway.)*
- Cannot assign children to classes in MVP
- Cannot view children not assigned to their own classes
- *(implemented)* Cannot see a **colleague's** classes either. Cross-class visibility
  within a school belongs to the tenant admin — restrictive is cheap to widen later,
  whereas withdrawing access people have built habits on is not
- *(implemented)* Cannot set the business's PayNow QR unless they are also its admin
  (a private coach is). A school has one bank account, so the payee is the
  business's, not each coach's

### 4.3 Tenant Admin *(implemented — replaces "Superadmin")*

SwimSync is **multi-tenant**: a **tenant** is a *business*. Everything below happens
inside one, and no rule anywhere branches on what kind of business it is.

> **A private coach is a school of one.** They are a tenant whose single coach is also
> its admin. "Private coach" and "swim school" are the same object at different sizes,
> not two product types — which is why coach *type* appears nowhere in the permission
> model. See `TENANCY_DESIGN.md` §1 for the full reasoning.

The original single global **`superadmin`** role split in two, because it was doing two
different jobs:

| Role | Scope | Who |
|---|---|---|
| **Tenant admin** | One business, entirely | A school owner, or a private coach |
| **Platform admin** | Cross-tenant, belongs to no business | SwimSync itself, for support |

**Read "superadmin" elsewhere in this document as "the business's tenant admin"** —
the capability is unchanged, only its blast radius is.

#### Co-admins and the owner *(implemented 2026-08-06)*

A business can have **more than one admin**. Its first admin — the person the platform
admin invited at provisioning — is the **owner** (recorded on the business itself, not as
a separate role), and the hierarchy is: platform admin → **owner** → co-admins →
coaches/parents. From the **Admins** page (visible to every admin of the business, beside
Coaches) the owner invites co-admins by email — optionally *also a coach*, the same
question provisioning asks — resends un-actioned invites, deactivates/reactivates, and
deletes.

**A co-admin can do everything the owner can, except manage admin accounts.** That single
exception is deliberate and load-bearing: a co-admin who could deactivate or delete
admins could lock the owner out of their own business. The owner can never be deactivated
or deleted, by anyone.

**Deactivation and deletion touch only the admin role.** An admin who is also a coach
keeps coaching when deactivated (their classes, attendance and coach app are untouched;
they see an "access suspended" notice on the admin panel), and their "delete" is a
demotion to coach — profile, history and coaches record all survive. A **pure** admin is
additionally blocked from logging in when deactivated, and their delete is real: the
account is removed outright (the confirmation requires typing DELETE).

*(implemented — corrected 2026-08-13)* **The audit trail now REFUSES the deletion instead
of being destroyed by it.** Deleting an admin used to purge every audit-log entry they had
written, because those rows point at the account and the deletion could not proceed while
they existed. That erased exactly the evidence the trail exists for: the dispute it answers
is "who changed this child's contact number, and when", and the person most likely to be at
the centre of one is an admin who has since left. Deletion was already refused for an admin
referenced anywhere else — a student they created, a payment they confirmed — and the audit
log was the single exception; it no longer is. **In practice this means most admins cannot be
deleted at all**, since every edit to a child's record is logged (§7.4), and **Deactivate is
the route**: it revokes access immediately, keeps the record, and is reversible. The trade
was chosen deliberately — the record outlives the person, and the cost is that their email
address stays occupied permanently, so they cannot be re-invited later.

*Known limitation, accepted:* deactivation cuts admin authority instantly at the database,
but a deactivated pure admin's existing session can retain baseline staff-level reads
(the business profile, member list) for up to one token lifetime (~1 hour) before the
login block fully bites. Suspending faster would require cutting reads the coach app
depends on.

**Coach and parent accounts cannot enter the admin panel at all** — the login page (and
the panel itself, for any session that arrives another way) turns them away with
"please use the SwimSync app", rather than the half-working read-only panel a hired
coach's credentials used to reach.

#### Disabling a coach *(implemented 2026-08-13)*

**Any active admin of the business** — not just the owner — disables a coach from the
**Coaches** page (staffing is the business's own; the admin half above is owner-only
because it guards the owner). Disabling is the coach twin of admin deactivation:
authority cut instantly at the database, plus a login ban for a **pure** coach. An
**admin-who-coaches is never banned** — only their coach half goes dark; the admin
panel stays theirs, and disabling the owner's own coach half is refused while they are
the business's **only** active coach.

**Disabling a coach with active classes is atomic.** The dialog requires a replacement
coach; one step hands every active class over (effective-dated **today**, so wage
history stays with whoever taught it) and disables the coach — or nothing happens at
all. A refusal anywhere aborts the whole action, including the money guards (a sealed
billing month at or after the current one, or an already-paid payout for it), whose own
messages are shown as-is.

**Disabling is forward-looking; nothing already taught changes.** Past lessons, pay and
payout generation are untouched; a retired class keeps naming its old coach as history.
Their shadow assignments are end-dated (never deleted — past shadow pay stands), and
their **future** substitute bookings are cleared. A past or today's substitute booking is
kept — that lesson becomes **the admin's to mark** (the replacement was never its coach),
and the dialog lists exactly those lessons before the admin confirms, because an
unmarked lesson blocks the month's billing with no override.

**Reactivating takes no refusals** beyond being the business's admin — the exit door
has no lock — and does **not** hand classes back; returning a class is a deliberate
edit on the Classes page.

*The same token-lifetime limitation as admin deactivation applies,* accepted for the
same reason: a disabled coach's existing session keeps baseline membership reads for up
to ~1 hour; the login ban is what ends it.

#### Tenant Admin Permissions

- Full visibility of **their own business**: its parents, students, classes, coaches
- Create and edit classes; assign children to coaches/classes
- View and manage their unassigned children
- View their credit notes and override access where required
- Set the business name, logo, PayNow QR, billing schedule and coach wage policy

#### Tenant Admin Restrictions

- **Cannot see any other business's data.** Not its families, classes, coaches,
  invoices, credit notes or attendance

### 4.4 Platform Admin *(implemented)*

SwimSync's own operator. Belongs to no tenant, sees every tenant, and exists for
support rather than daily operation.

- **An operations view of every business** *(implemented 2026-07-19)* — one row each with
  its join code, families, students, classes and coaches, plus the signals that say which
  business needs attention: **when attendance was last marked** (or *never*), how many of
  this month's recorded sessions are fully marked, whether last month was billed, and
  whether any **member of staff** has no pay rate (which is why payroll would silently pay
  them nothing). A coach who *owns* the business is deliberately not counted there: their
  income is their own parents' invoices and a rate would be meaningless, per §7.13.
  **SwimSync does not classify a business as a private coach or a school** *(2026-08-01;
  the reasoning below corrected 2026-08-04)*. Nothing in the product branches on the
  distinction, and no screen shows it. The question a platform admin actually has is
  *"will anyone here be paid nothing by mistake?"*, which needs no classification: an owner
  without a rate is a **choice**, a non-owner coach without one is the **mistake**, and only
  the second is flagged.
  > **Correct the record on *why*.** This paragraph said until 2026-08-04 that the
  > derivation "was specified but never built". It **was** built — `20260719002400` derives
  > `shape` from whether the only coach is also the admin, `platform_tenant_overview()`
  > still returns it, and `platform_overview.test.sql` has pinned both cases since the day
  > it shipped. What is true is that **displaying it was the mistake**: a one-coach school
  > that pays its owner a wage and a private coach who takes none are identical in the
  > data, so the column answered a question the data cannot answer. The *column* was
  > removed from the page; the derivation stays, unread, because it is derived and so
  > cannot go stale. The stored `tenants.kind` — which nothing ever read — was dropped on
  > 2026-08-04 (§8.28)
- **Create a business, and invite its first admin** *(implemented 2026-07-21)* — see below
- **Parents who registered but never entered a join code** — they belong to no business, so
  nobody else can see them
- **Move a student to another business** — the remedy when a parent joins with the
  wrong code. *(Loose ends closed 2026-08-28.)* The move now also **joins every linked
  parent to the new business** (writing the `parent_tenants` membership the add-child
  picker and billing grouping rely on — reactivating a previously-offboarded one), and
  **clears the child's level** (a business's level ladder is its own, so the child lands
  unlevelled for the new admin to re-level — this also fixed a bug where a *levelled*
  child could not be moved at all). Credit does **not** move (it never crosses businesses,
  §5.6); if the family holds credit at the old business the admin sees an **advisory
  warning** before confirming, because that credit becomes unspendable. This stays the
  *mistake* remedy only — it does not migrate a family wholesale.
- **Reassign a business's owner** *(implemented 2026-08-13)* — hand ownership to another
  of its **live** admins (a deactivated or cross-tenant target is refused), from the
  Businesses table. This is deliberately the **only** transfer path: the tenant owner has
  no transfer button, because a transfer is rare enough that platform mediation is
  acceptable and one path covers both the amicable handover and the **lost owner** (the
  account deleted at the auth layer leaves `owner_profile_id` NULL and the business's
  admin management frozen — this action is the remedy that isn't dashboard SQL). The old
  owner stays on as a co-admin; everything keyed on the owner column — the overview's
  Admin cell, the onboarding-invite resend — follows automatically. Audited as an
  `owner_reassigned` row naming both parties.
- **Suspend a business** *(implemented 2026-08-13)* — the platform kill switch, from the
  same Businesses table, with a confirm dialog and a red **suspended** badge. Suspension
  is **per-tenant, never account-level**: the business's staff lose all authority
  instantly (RLS-level) and their logins are banned; its **parents lose the app view of
  that business's data** — children, classes, attendance, invoices, packages, claims —
  while a family with children at another business keeps that one untouched, and
  **parents are never banned**. The engine generates no new invoices for a suspended
  tenant (auto and manual alike), its join code stops working — including for a
  formerly-active family rejoining, refused with the same wording as an unknown code —
  and the platform admin keeps full read access and the only unsuspend button.
  **Already-sent invoice links keep working, indefinitely and deliberately**: the
  invoice token is the access control and money can still come in on outstanding bills;
  settling receivables before suspension is the owner's responsibility (the confirm
  dialog says so). Unsuspending restores staff logins **except accounts individually
  disabled beforehand** — a deactivated admin or disabled coach stays dead. Audited as
  `tenant_suspended` / `tenant_unsuspended` rows.
- Has **no** invoice-generation or payroll controls of their own: those run for one
  business at a time and are the tenant admin's

*(implemented 2026-07-19)* **The business pages are closed to them.** Every other page in the
panel describes a single business, and a platform admin belongs to none — so those pages did
not fail for them, they showed several businesses' figures added together and labelled as one
("Total students, across all coaches" was really across all *businesses*). They now say so
and show nothing, rather than presenting a number that reads as authoritative and isn't.

*(Deliberately not built: a "view as tenant" impersonation mode. That would mean
scoping every admin page to a chosen tenant rather than the caller's own — far larger
than the support capability this role needs.)*

#### Onboarding a business *(implemented 2026-07-21)*

Until this shipped, **nothing in SwimSync could create a business.** Every tenant alive
had been inserted by hand — the seed file, a one-off backfill migration, or SQL typed into
the Supabase dashboard — and there was no way to create a **tenant admin** at all. The
admin panel had a login page and no signup, which was correct but left onboarding with no
route that wasn't a database console.

The platform admin now creates a business from their own panel: its **name**, and the name
and email of the person who will run it — plus one real question, *does this person coach
too?*, which decides whether they get a coach record. A **"Private coach / Swim school"
dropdown was removed 2026-08-01**: it stored an answer nothing ever read, and asked the
platform admin to declare something unknowable at creation time. The
business exists immediately, with its **join code**, and that person is emailed a one-time
link to choose a password. *(implemented 2026-08-23: the link is valid for **24 hours**,
and the email says so. Expiry is Supabase auth's single `mailer_otp_exp` knob, so it also
governs magic-link and password-recovery links — there is no invite-only setting; §7.210.)*

**One question decides the shape of the business: does this person also teach?** If they
do, they get a coach account alongside their admin one — that is the private-coach-as-a-
business-of-one shape (§4.3), and it is asked separately from private-vs-school because a
school's owner may well teach too.

**The invited admin becomes the business's OWNER** — and since 2026-08-06 they can add
co-admins themselves from their own panel (§4.3, *Co-admins and the owner*), so two
people sharing the work no longer share one login. Provisioning still mints exactly one
admin: the owner; everyone after that is the owner's to invite.

*(Deliberately not built: public self-service signup. Anyone being able to create a
business, with no billing and no approval step in front of it, is an open door — and the
join codes it would mint are the only proof a family deals with a business (§5.1). Businesses
are onboarded by SwimSync, one conversation at a time, until there is a reason for that to
change.)*

*(Deliberately not built: deleting a business. Removing a tenant cascades into its families,
students, invoices and attendance, so a destructive button on a support panel is a worse risk
than the rare mis-typed name it would fix. A business created in error and never used is
corrected in SQL. A **failed** creation cleans up after itself — see below.)*

**A business is created before its admin exists**, because the two writes cannot share a
transaction: SwimSync refuses to create an admin without knowing which business they belong
to, so the business must be saved first. That leaves a bad state in between — a business
that is live and **joinable**, with nobody able to operate it — so if the invite fails, the
business is removed again rather than left stranded. Any that still slips through is shown
on the platform view as **no admin**, in red, beside businesses whose admin has been invited
but has not yet signed in.

---

## 5. Key Business Rules

### 5.1 Parent Registration and Child Creation

- Parents can self-register on SwimSync using email/password
- Parent account may exist before any child is created
- A newly registered parent may create one or more child/student profiles
- **Student profile includes:** child name, age/date of birth, gender, optional notes. *(implemented: parents do **not** set a swimming ability/level. Levels are **coach-defined per business** and set by the business's admin — see §7.15; the parent sees their child's level read-only.)*
- A child remains unassigned until the business's admin assigns that child to a coach/class
- *(implemented 2026-07-19)* **Address and postal code are collected at registration, and
  are optional.** The coach has no way to reach a family off-platform beyond a phone
  number, and the postal code answers the question behind every enquiry — *is this family
  near a pool I teach at?* Optional because a signup form that refuses to submit without
  an address would block the very onboarding it exists to help, and because every parent
  who registered before this has neither. They can supply them later from
  **Profile → Contact Details**, which is what stops the field only ever holding data for
  families who joined after it shipped.

- *(implemented)* **A parent must join a business before adding a child.** The coach or
  school gives them a **join code** (e.g. `SWIM-4821`); entering it links the parent to
  that business. Add-child is gated on having joined at least one — with exactly one it
  is selected silently, with several the parent picks per child.
- Until assignment, parent can view the child profile but class/attendance/invoice sections show a *"not assigned yet"* state

#### A child is identified by name + date of birth *(implemented 2026-07-19)*

**A name alone is not an identifier.** A coach with two students called "Ethan Tan"
on one roster has no way to tell them apart on the attendance screen, and picks wrong.
Name + date of birth is enough, and needs no information SwimSync doesn't already
collect — DOB is already required when adding a child.

The pair is **unique within a business** (`students_identity_uniq`). Two businesses may
each teach a child of the same name and birthday; neither can see the other's roster in
any case. Re-registering a child SwimSync already knows about is refused with a plain
explanation rather than a database error.

Where it shows: the coach's roster lists each child's **age**, and adds the **full birth
date** — including the year — for any child whose name is shared by another on that same
roster. The year is the point: two children of the same name are usually separated by
birth year alone, so a birthday without it fails at the one job it has.

**Age is derived, never stored.** `students.age` was a stored integer beside
`date_of_birth`; it went stale the day after it was written and has been removed. A
missing or unparseable DOB yields *no age*, never `0` — the column is nullable, so rows
predating the required-DOB rule exist and must not read as newborns.

*(Deliberately not built: NRIC. Partial NRIC — last 3 digits + checksum — is still
personal data under PDPC guidance and its collection is restricted, so it would need a
standing justification and would put regulated data on every coach's roster. Name + DOB
answers the same question using data already held. Revisit only if a real collision
proves DOB insufficient.)*

### 5.2 Child Assignment Rules

- Superadmin is responsible for assigning children to coaches/classes in MVP
- SwimSync web admin panel shall include an **Unassigned Children** section — its
  sidebar tab (in the *Families* group) carries an **amber count badge** of the
  active children with no class yet, bubbling to the group header when collapsed,
  so an unassigned child is visible from any page *(implemented 2026-08-22)*
- Once assigned, the child appears in the relevant coach's roster and under the parent's account with class details visible
- A coach should only see children enrolled in that coach's own classes

### 5.3 Class Rules

| Rule | Detail |
|------|--------|
| **Coach per class** | Each class has only one coach |
| **Students per class** | Each class can have multiple students |
| **Classes per student** | One fixed weekly class per student in MVP |

**Class definition includes:** title/name, day of week, start time, end time, **location** (chosen from the business's managed locations, §7.24), class price per lesson. Superadmin can create, edit classes, and amend pricing when needed.

### 5.4 Attendance Rules

Attendance must be tracked per student per lesson session in SwimSync. Allowed attendance statuses:

| Status | Billable? | Notes |
|--------|-----------|-------|
| **Present** | Yes | Standard lesson |
| **Absent** | No | |
| **Cancelled due to rain** | No | |
| **Cancelled by coach** | No | |
| **Trial — Paid** | Yes | Coach must specify trial type |
| **Trial — Free** | No | Coach must specify trial type |

### 5.5 Billing Rules

Billing is based on actual attendance records, not scheduled lesson count.

#### Invoice Generation Timing

SwimSync generates invoices for a month only **after that month has ended**, so a lesson conducted on its last day is still included (§11.1).

*(implemented)* The original spec said the **1st** of the following month. The automatic
run now waits until a **configurable day** of the following month — `app_settings.invoice_run_day`,
**default the 7th**. The 1st proved too early in practice: the month's final lessons are
often still unmarked, and a lesson marked *after* the invoice exists can never be added to
it (§11.6), so billing on the 1st converts a fixable gap into a permanent underbill. A
**manual** run ignores the run day entirely — the superadmin generating on demand is an
explicit instruction. See §7.7.

Examples (at the default run day):
- On **7 Feb 2026**, generate invoices for **January 2026**
- On **7 Mar 2026**, generate invoices for **February 2026**

#### Invoice Grouping

- One invoice per parent **per business** per billing month *(implemented)*
- If a parent has multiple children **at the same business**, all eligible lessons for those children are included in the same invoice

*(implemented)* The original rule was one invoice per parent per month, full stop. That
forbids the case that turns out to be **common**: a family with one child at a swim
school and another with a private coach must receive **two** invoices that month, one
from each business, because they are two separate businesses asking to be paid. The
uniqueness rule is therefore `(parent, tenant, billing month)`.

#### Payment Tracking

- Parents pay externally via PayNow using the **business's** QR code — the one belonging
  to the business that *issued that invoice* *(implemented — changed from the coach's QR;
  see §7.10)*
- Coach manually checks bank account and marks invoice as paid in SwimSync
- No automatic reconciliation in MVP

### 5.6 Credit Note Rules

SwimSync supports **credit notes** to handle attendance corrections made after an invoice has already been generated. This ensures billing accuracy without requiring invoice deletion or manual recalculation.

#### When a Credit Note Is Issued

A credit note is **automatically triggered** when a coach changes a student's attendance status on an already-invoiced lesson from a billable status (Present or Paid Trial) to a non-billable status (Absent, Cancelled due to rain, Cancelled by coach, or Free Trial).

No credit note is generated for changes within the same billing category (e.g. Present to Paid Trial).

#### When a Credit Note Is Reversed *(implemented, 2026-08-18)*

The credit is **symmetric**. If the same lesson is later corrected back to a billable
status (the coach un-does the correction), the credit note is **reversed** — its status
becomes `reversed` and the credit is removed from the parent's balance, so re-toggling a
lesson can never accumulate more than one lesson's credit. Reversal reuses the one credit
note per corrected lesson rather than issuing new records (so the note count stays honest),
and a reversed note is hidden from the parent and labelled *Reversed* in the admin views.

**One exception, by design:** if the credit has already been drawn down against another
invoice, the correction back to billable is **refused** (`CN001`) — un-marking the lesson
would silently reopen a past (possibly paid) invoice. The coach is told to ask their admin
to **void** the credit note first (below), then mark again; there is no automatic clawback.
*(Before 2026-08-18 an un-correction reversed nothing and a re-correction issued a second
note, doubling the credit — see `HANDOVER.md` §8 / GOTCHAS.)*

#### Voiding a Credit Note *(implemented, 2026-08-18)*

A **tenant admin** (their own business only — not the platform admin) can **void** a credit
note from the admin Credit Notes page, with a required reason. Voiding is the destination
for the `CN001` refusal above and for any credit issued in error. It reverses every live
draw the note has made and marks the note `reversed`; the note's undrawn remainder leaves
the parent's balance. What happens to each drawn invoice depends on whether it was **paid**:

- A draw against a **still-outstanding** invoice **reopens** it — the drawn amount is added
  back to its balance and its settlement stamps are cleared.
- A draw against an **already-paid** invoice is **not** reopened — a paid invoice is immutable.
  Instead the drawn value is recovered as a **debit on the parent's account**
  (`parent_tenant_balances.debit_balance`, the mirror of the credit balance), which the billing
  engine folds onto the parent's **next invoice** as an *"Adjustment from a prior invoice"* line
  — drawing any available credit against the debit-inclusive total so credit and debit net.
  *(implemented 2026-08-22, `docs/plans/PARTIAL_PAYMENT_PLAN.md`; replaces the earlier reopen-the-
  paid-invoice behaviour, which overstated the amount owed against the recorded payment.)*

Payment records are left untouched as immutable history. **No email is sent to the parent in
v1** — the admin communicates the change. Re-correcting a lesson whose note was voided-and-
debited **auto-unwinds the debit while it is still pending** (not yet folded onto an invoice),
restoring the note exactly; once that charge has been **billed (folded) or written off** the
re-correction is refused (`CN002`) — reversing a settled charge is deferred (`BACKLOG.md`;
`INVOICE_RUNBOOK.md` has the manual path). *(implemented 2026-08-23,
`docs/plans/PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md`.)*

A pending debit is **visible to the admin before it bills** — a *"Pending charges — not yet
invoiced"* panel on the Invoices page, with an audited **Write off** action that clears it. A
family that **owes a pending debit cannot be set inactive** until it is written off or settled
(a **debit-only** guard on the shared membership flip — credit is deliberately preserved across
offboard). A standalone "collect now" charge was considered and **rejected** (it forced an
engine change and only produced a chaseable invoice); money owed is settled out-of-band.
*(implemented 2026-08-23.)*

Rationale, guards and the drawdown-lock that makes voiding race-safe:
`docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md`, `docs/plans/PARTIAL_PAYMENT_PLAN.md` and
`docs/plans/PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md`.

#### Credit Note Details

- Each credit note is linked to the original invoice and the specific attendance correction
- The credit note amount equals the class rate for the corrected lesson
- Credit notes carry a unique reference number for audit purposes
- Credit notes are stored as permanent records and cannot be deleted

#### Applying Credit Notes

Credit note balances are **automatically deducted** from the parent's next outstanding invoice. If the credit exceeds the next invoice total, the remaining balance carries forward to subsequent invoices.

- Parents can view their credit note history and current credit balance in SwimSync
- Coaches and their business's admin can view that business's credit notes in the admin views
- If no future invoices are generated (e.g. student leaves), the credit remains on record for manual resolution

#### Credit never crosses businesses *(implemented)*

Credit is held **per (parent, business)**, not pooled per parent. A note issued by a
swim school is spendable only against that school's future invoices — never against a
private coach's — because one business paying down another's bill is simply the wrong
answer. Within a business it still pools freely across all of that parent's children
there, which is what the one-invoice-per-parent-per-business rule requires.

This reverses an earlier decision to pool credit per parent. That was correct while
SwimSync served a single business and became wrong the moment it served two.

#### Credit Note Flow

1. Coach changes attendance from billable to non-billable on an already-invoiced lesson
2. SwimSync detects the linked invoice and calculates the credit amount
3. A credit note record is created, linked to the parent, student, invoice, and lesson
4. Parent is shown the credit note in their billing view
5. On next invoice generation, SwimSync automatically applies outstanding credit balance
6. If credit fully covers the next invoice, invoice is marked as Paid; if partially, the remaining amount is shown as Outstanding

---

## 6. Core User Stories

### 6.1 Parent User Stories

#### Registration and Child Profile Creation

- As a parent, I want to register on SwimSync using my email so that I can access the app
- As a parent, I want to add my children's information so that the platform has the details needed for class assignment
- As a parent, I want to edit my child's details if needed

#### Child Visibility

- As a parent, I want to see all children linked to my email so that I can manage multiple children under one account
- As a parent, I want to know whether my child has already been assigned to a class

#### Attendance Visibility

- As a parent, I want to view my child's attendance history so that I know which lessons took place and whether my child attended

#### Billing Visibility

- As a parent, I want to view monthly invoices so that I know how much I owe
- As a parent, I want to know whether payment is outstanding or paid
- As a parent, I want to see the coach's PayNow QR code so that I can make payment
  *(implemented — the QR shown is the **business's**, belonging to whoever issued that
  invoice; see §7.10)*
- As a parent, I want to view any credit notes issued to my account so that I understand adjustments to my billing

### 6.2 Coach User Stories

#### Attendance

- As a coach, I want to view my assigned class roster so that I can take attendance
- As a coach, I want to mark attendance for each student in a class so that billing can be based on actual attendance
- As a coach, I want to mark a lesson as a Paid Trial or Free Trial where applicable
- As a coach, I want to correct a past attendance record, and if the lesson was already invoiced, I expect SwimSync to issue a credit note automatically

#### Billing

- As a coach, I want invoices to be generated automatically each month so that I do not need to calculate charges manually
- As a coach, I want to view invoice details so that I can explain charges if a parent asks
- As a coach, I want to mark an invoice as paid after checking my bank so that payment status is accurate
- As a coach, I want to see credit notes related to my students so that I can explain adjustments

#### PayNow

- As a coach, I want to upload my PayNow QR code so that parents can pay me easily
  *(implemented — the QR is the **business's**, so only a coach who is also their
  business's admin can set it; a private coach is, a school's coach sees it read-only.
  See §4.2, §7.10)*

### 6.3 Superadmin User Stories

> *(implemented)* These are the stories **as originally written**, kept as the record of
> what was asked for. Read "superadmin" as **the business's tenant admin** throughout
> (§4.3) — every story below is theirs, scoped to their own business.

#### Student Assignment

- As a superadmin, I want to view all unassigned children so that I can assign them to the right coach/class
- As a superadmin, I want to assign a child to a coach/class so that the child appears in the correct roster

#### Class Management

- As a superadmin, I want to create classes with day, time, location, and rate so that students can be assigned properly
- As a superadmin, I want to edit class details and pricing when needed

#### Oversight

- As a **tenant admin**, I want to view attendance, invoices, and credit notes across **my own** coaches so that I can run my business *(implemented: "across all coaches" was the pre-tenancy model — an admin now sees only their own business, §4.3)* *(implemented 2026-08-14: the read-only Attendance audit page attributes each lesson on the **money axis** — who was paid, i.e. the substitute if one was named, else the class's dated paid coach — never the class's current `coach_id`, so a class handed to another coach no longer mislabels the outgoing coach's lessons; an amber **Cover** chip marks a substituted lesson and any active class shadow appears on a second line. §7.13, §7.152.)*

---

## 7. Functional Requirements

### 7.1 Authentication

SwimSync shall support email/password authentication for parent and coach accounts.

- Parent can self-register, log in, log out, and reset password
- Coach accounts may initially be created manually by superadmin/system owner
- Superadmin account(s) shall exist
- Role-based access must be enforced across all SwimSync features

*(implemented)* **Every account has exactly one route in, and only parents make their
own.** A **parent** self-registers in the app. A **coach** is created by their own
business's admin (a platform admin cannot — they belong to no business, so there is no
tenant to put the coach in). A **tenant admin** is created by the platform admin when the
business itself is created, and sets their own password from an emailed invite (§4.4).
There is **no public signup on the admin panel** — its only self-service flow is password
reset.

#### Password Reset *(implemented)*

Self-service password reset runs on the mobile app for parent **and** coach
accounts (they share the login screen): the "Forgot password?" link opens a
request screen (`resetPasswordForEmail`), Supabase emails a recovery link, and
opening it lands the user on an in-app **Set New Password** screen that calls
`updateUser`. The recovery session is delivered via `detectSessionInUrl` on Expo
web and a `swimsync://` deep link on native. Raw auth errors (invalid credentials,
duplicate email, unconfirmed email, rate limit) are mapped to friendly messages.
The **admin panel** now has the same self-service reset (`/forgot-password` →
`/reset-password`), so a superadmin can recover their own password.

### 7.2 Parent Account and Child Linking

SwimSync shall support linking child profiles to parent accounts.

- A parent may have zero, one, or many children
- A parent can create child/student profiles under their own account
- A child profile must only be visible to linked parent account(s) and authorized platform roles
- A parent can see all linked children across all coaches
- A coach can only see a child if that child is assigned to that coach's class

### 7.3 Class Management

SwimSync shall allow superadmin to manage classes.

- Create and edit classes
- Set weekday, start time, and end time
- Choose the location from the business's managed locations (§7.24)
- Set class price per lesson
- Set class active/inactive status
- Assign a coach to a class
- *(implemented 2026-08-19)* Set a **maximum number of students** and a **calendar colour**.
  Capacity lives in two places: a **default per class category** (Packages page → *Class
  categories* → *Max*; blank = no limit) and an optional **per-class override** (Classes form →
  *Max students*; blank = the category's default). *(enforced 2026-08-20)* The Classes table
  shows `students / max` and the admin calendar shows `enrolled+guests / max`, and the database
  **refuses** anything that would exceed it — a booking when the lesson's expected set (enrolled
  by span + guests) reaches the maximum, an enrolment when the active roster does — for
  **everyone, the admin included; there is no override**. A full class is fixed by raising its
  maximum. The colour is one of
  **12 fixed swatches** (a palette *key*, never a hex value; unset = neutral grey), chosen per
  class because one class can hold children of several levels. Neither is effective-dated:
  they are written beside `set_class_terms`, never inside it.

*(implemented 2026-08-09)* **"Active" means SCHEDULING, and never billing.** A class that
stops running is **retired**, not deleted, and the lessons it already taught still bill
exactly as before — that is the whole point of the distinction, and it used not to hold.
See *Retiring a class* below.

*(implemented)* The admin **Classes** page supports both create and edit: each class row has
an **Edit** action that opens the same form pre-filled, so day, time, coach, location, and
rate can be changed in-panel (no dashboard SQL). The **day of week is a required, explicit
choice** — the form no longer defaults it, so a class cannot be created on the wrong weekday
by leaving the picker untouched. (A class is a *recurring weekly* definition keyed by
`day_of_week`; there is no single class date — dated `lesson_sessions` are created lazily
when attendance is marked, per §7.5.)

#### Retiring a class *(implemented 2026-08-09)*

A class that has stopped running is **retired** from the admin Classes page. Retiring it
takes it off the schedule — it disappears from the coach's class list and Schedule tab, and
no new lessons can be marked on it — while **everything it already taught still bills**.
Retired classes are hidden behind a **Show retired classes** tick-box, carry a *Retired*
badge with the date, and can be **restored** at any time.

**SwimSync refuses to retire a class when something is still expected of it**, and always
says what. There is no override on any of the three:

| Refusal | Why | What to do |
|---|---|---|
| Children are still on the roster | Their leave date decides what they are billed, so it is never implied | Remove each from the class first |
| A guest is booked into a lesson that has not happened | They are expected there and nowhere else | Cancel the booking, or teach and mark it |
| Lessons are still waiting to be marked | An unmarked lesson blocks the whole month from billing, and a retired class is invisible to the coach who would mark it | Mark them, then retire |

An **empty** class — nobody enrolled, nothing booked, nothing recorded — retires without
argument. That is the deliberate answer, not an oversight: it is precisely the class an
admin wants to tidy away, and there is nothing left to strand.

**Restoring is never refused.** A retired class that is holding up a billing month has to be
reachable, so restore has no conditions attached — it is the way out. A class restored after
sitting idle across a lesson date will then ask for that lesson to be marked; a lesson that
did not run is recorded as *cancelled*, never skipped (§7.6).

**Nothing new can be put INTO a retired class** *(implemented 2026-08-10)*. A trial booking,
a make-up booking and an admin-scheduled extra lesson are all refused with *"<class> is no
longer running"*. Each of the three would otherwise create a lesson that only a retired class
knows about: nobody can mark it, because a retired class appears on no coach screen, and an
unmarked lesson blocks the whole business from billing with no override (§7.7). Restore the
class first if the lesson is real.

Retiring is also **only ever done through this screen**. The three refusals above are
enforced by the database rather than by the page, so there is no second route that skips
them, and a retired class always records the date it was retired — which is what lets billing
tell "this class was running on the 13th" from "this class had already stopped".

#### Changing the price or coach asks *when* it takes effect *(implemented)*

A class's **schedule** (title, day, time, location) is a plain fact that can simply be
corrected. Its **money** — the price a parent pays and which coach is paid for it — is
**effective-dated**, because both are applied to lessons that have already happened.

So when an edit changes the price or the coach, SwimSync asks which of two things it is:

| | What it means | Effect on past lessons |
|---|---|---|
| **A change from today** | The price rises, or a colleague takes the class over | **None.** Lessons already taught keep the old terms |
| **Fixing a mistake** | The old value was never right (a typo) | Re-valued, because there was never a period at the old number |

Without the distinction one of the two is always wrong: defaulting to "correct" makes every
typo permanent fictional history, and defaulting to "change" lets every genuine price rise
reach backwards into months already taught. The prompt appears **only** when the price or
coach actually moved — renaming a class or shifting its time records nothing.

A correction is **refused** once the affected month has been invoiced and sealed, or a coach
payout covering it has been paid: that money is settled, and the remedy is a credit note or
a payout adjustment rather than rewriting the record. Terms also cannot be dated into the
future.

#### Seeing who is in a class — and the count reads `2+1` *(implemented 2026-07-26)*

Each class row has a **See students** action opening a panel that lists the children
**currently enrolled** in that class — name, swimming level, and the date they joined —
and, in a **separate** list below it, children with a **trial booked for a future date**.
The Students column reads **`2+1`**: two enrolled, one trial. Read-only; the panel offers
no action.

**The count is deliberately not `3`, and the two lists are deliberately not merged.** A
trial is a booking, not an enrolment (§7.17), and an admin who reads a guest as a class
member is one action away from assigning them — which creates an active enrolment, makes
the child expected at **every** lesson, and silently stops that class's month being
invoiced the first time one of those lessons goes unmarked. §7.17 already forbids
listing trials among the enrolled on the coach's roster for the same reason; this applies
the rule to the number as well as the list. The panel states the consequence in words and
carries no *Assign* control at all.

"Trial" here means a booking that is **not cancelled and dated today or later** — the same
definition the coach's roster and Unassigned Children use. A trial drops out of the count
the day after its lesson; chasing an unmarked past trial is the Trials page's job.

### 7.4 Student Management

SwimSync shall allow **parents to create student profiles** and **superadmin to manage assignment** of those students.

- Parent can create and edit student profiles
- Profile includes: full name, age/DOB, gender, optional notes *(swimming ability is **not** parent-entered — see §5.1)*
- *(implemented 2026-07-19)* **Editing became real on this date.** The spec had claimed
  it since the original draft, but nothing in the app could change a student — the child
  detail screen was read-only. A parent can now edit **name, date of birth, gender and
  notes**. What they cannot touch: the **business** (a student moves between businesses
  only via the platform admin's RPC, §4.4), and **assignment** or **activity**, which are
  the business admin's (§7.14).
  Two defects had to be closed before this was safe to ship, both latent only because
  nothing could write to `students`:
  - **A parent could move their own child to another business.** `students_update`'s
    `WITH CHECK` repeats its `USING` clause and never mentions the new `tenant_id`, while
    "this parent owns this student" stays true after the move — so the row could be
    injected onto a stranger's roster, defeating the join code, which is the *only* proof
    a family deals with a business (§5.1). Now pinned in the database.
  - **A rename rewrote invoices that had already been sent**, and credit notes this
    document calls immutable (§7.8), because five screens read the student's name live.
    Names are now snapshotted onto the document — see §7.7.
- Student can be marked active/inactive by the business's admin — see §7.14
- *(implemented)* **Remove from class** and **Set inactive** are available to the
  **business's tenant admin and to the coach whose class the child is in** (§4.3). These are
  **different questions**: removing returns the child to **Unassigned** while they remain a
  customer; setting inactive says they have left (§7.14). Both **close** the class enrolment
  rather than deleting it, so attendance and billing history survive (§11.5) and any credit
  balance is untouched (§11.8) — and lessons already attended that month are still invoiced.
  Both are audit-logged. Closing the enrolment matters beyond tidiness: an open enrolment for
  a child who no longer attends keeps their class permanently incomplete, which **blocks
  invoice generation** (§7.7), so it is the in-app remedy. *(Interim permission model: when
  coach type lands, a private coach keeps this and a school coach's admin takes it over.)*
- Newly created profiles default to **Unassigned**
- Superadmin can view all unassigned profiles in the **Unassigned Children** section
- Superadmin can assign or reassign a student to a class
- **A student may attend MORE THAN ONE class a week** *(implemented 2026-08-11)*. The MVP
  rule was one active enrolment per student, enforced by a unique index; a keen swimmer
  taking two sessions a week is an ordinary case it could not represent, and the workaround
  was a second child profile. The rule that replaced it is **one active enrolment per
  student PER CLASS**, plus two schedule guards:
  - **A child cannot hold two enrolments that overlap in time** — same weekday, overlapping
    start/end. Refused by the database, naming the clashing class.
  - **A class cannot be MOVED onto a time that clashes** for a child already enrolled in
    both. Refused by the database, naming the children. A price-only or title-only edit is
    untouched, so a class never becomes uneditable.
  - **Nothing may be enrolled into a RETIRED class.** The guard is written as "refuse entry
    to an inactive class", deliberately, rather than "ignore inactive classes when checking
    overlap" — the latter is escapable via `reactivate_class()`, which takes no refusals
    (§7.3).
  - The escape from either refusal is the same screen that creates the state: **Students →
    the × on a class chip**, which ends one enrolment and leaves the others alone.
- **The admin's Students page owns the many-to-many.** Each child's Class column is one chip
  per active class, each with its own ×; **+ Add class** adds another. The Unassigned
  Children section still handles a child's FIRST assignment. There is deliberately no
  "remove from class" button per child any more — with several classes there is no *the*
  class to remove them from, and the chip is the only control that says which one is going.
- **A child is `Unassigned` only when they are in NO class.** Dropping one of two leaves
  them `Assigned`.

### 7.5 Lesson Session Generation

SwimSync shall generate lesson session records from class schedule.

- Generate dated lesson sessions for each recurring class
- Each session should inherit class date/time/location details
- Each session must support per-student attendance marking
- System should support scheduled generation for current/future periods

> *Note: exact implementation may be hidden from end user.*

#### Sessions are created lazily, and expectation is derived *(implemented)*

There is **no scheduled session generator**, deliberately. A `lesson_sessions` row is
created on demand when a coach saves attendance for a date (times are inherited from the
class by a `BEFORE INSERT` trigger, satisfying "inherit class details"). Sessions are
unique per `(class, date)`, so marking a past lesson late works and never disturbs
another date — **within the marking window, which the database enforces** (§7.6).
Sessions ahead of today exist in exactly one case: an **extra lesson** the business's
admin has scheduled (§7.6).

The requirement that actually mattered — knowing a lesson *should* have happened — is met
by **deriving expected lesson dates from the class's `day_of_week` at read time** rather
than materialising rows ahead of time. This is what makes a forgotten lesson visible:

- The **coach's Schedule tab** leads with **NEEDS MARKING** (past lessons not fully
  marked) and links straight to marking them; the class roster shows expected-but-missing
  dates as a distinct *"Not marked"* state.
  > **A lesson whose only attendee is a GUEST counts on both screens** *(corrected
  > 2026-08-10)*. A trial or make-up guest makes a lesson real even when nobody is enrolled
  > in that class — a class between intakes, or one whose students have all moved on, still
  > has that one lesson to teach and mark. Until this was corrected the class roster asked
  > whether anyone was *enrolled* and so showed no lessons and no Mark button at all, while
  > the Schedule tab asked who was *expected* and listed the same lesson under NEEDS
  > MARKING. Two coach screens disagreeing about whether a lesson exists is the confusing
  > half; the expensive half is that the same lesson blocks billing with no override.
  > **That list is FLOOR-scoped, not week-scoped, and the distinction is load-bearing.**
  > It spans the business's `markable_floor` up to today whatever week the selector
  > shows, so a straggler three weeks back stays visible. Week-scoping it would hide a
  > lesson the coach has no reason to go looking for, and unmarked attendance blocks
  > invoice generation outright with no override (§7.7 of this document, HANDOVER §8i).
  > `verify-schedule-week.mjs` is the guard.
- **Every lesson list states which of five states it is in, and what was recorded**
  *(implemented)* — on the Schedule tab's lesson cards, the NEEDS MARKING rows and the class
  roster: **Upcoming** (nothing recorded, the class has not ended), **Not marked**
  (nothing recorded, it has), **2 of 4 marked**, **Marked**, and **No students** for an
  empty roster. A breakdown names what was entered — *"2 students · 3 present ·
  1 cancelled (rain)"* — keeping *rain* and *coach* apart, because they read the same to
  a person and bill differently. A fully marked lesson's button becomes a quiet
  **Edit attendance** rather than a solid *Mark Attendance*; only that state quietens it,
  so a lesson still needing marks always keeps asking.
  **"No students" is not the same as "Marked", and the difference is load-bearing:** the
  billing gate counts a lesson nobody was expected at as complete — correctly, there is
  nothing to collect — while showing that as *Marked* would tell the coach a class was
  done when nobody had touched it. The two questions are answered in different layers
  (§7.68 in `docs/GOTCHAS.md`).
- The **admin's invoice-generation dialog** reports, per class, `N of M lessons marked`
  and names any missing dates before invoices are created (see §7.7).
- A lesson that legitimately didn't run is recorded with the existing non-billable
  statuses (*Cancelled — rain/coach*), which clears it from both views.
- The **coach's roster bounds marking to that same window.** Its primary action targets the
  *most recent expected lesson* (today if today is a class day, else the last one that
  passed), floored at `max(the business's marking floor, earliest enrolment)`; earlier
  lessons are
  closed (a correction to an already-invoiced lesson uses a credit note). A class with nothing
  due yet shows a placeholder instead of a markable button — so a coach cannot create/bill a
  session on a non-lesson day by mistake.
- The **parent's Attendance screen uses the same derivation to tell its empty states apart:** a
  child whose first lesson hasn't happened yet reads *"No lessons have taken place yet"*, versus
  *"No lessons marked yet"* when a lesson has fallen due but the coach hasn't recorded it.

A lesson counts as marked only when **every student enrolled on that lesson's own date**
has an attendance record on it — the same rule the invoice engine applies.

> **Enrolment is a date span, not a flag** *(implemented 2026-07-27)*. This rule used to
> ask "who is actively enrolled?" — one set for a whole month — and expect them at every
> lesson in it. A child who joined on the 20th was therefore expected at the lessons on
> the 6th and 13th, had no records there, and **blocked the entire month from being
> billed** (§7.7 has no override). The only way to clear it was to record attendance for
> a child at a lesson they were not enrolled for. The question is now answered per date,
> from the span each enrolment actually covers, in the coach's app, the admin's gap
> report and the billing engine alike.

**Upcoming lessons** *(implemented 2026-08-17; make-ups + extra lessons added 2026-08-21;
cancelled lessons added 2026-08-21)*:
the parent Attendance screen shows an **Upcoming** section above the marked history, listing the
lessons scheduled for the selected child over roughly the next four weeks. It merges **four
sources**: the weekly projection off each active enrolment's weekday (**derived at read time**
via the same `expectedLessonDates` logic the coach's unmarked-lessons view uses — **no sessions
are pre-generated**); the child's booked **make-ups** (guesting one lesson in another class,
badged *Make-up*); admin-scheduled **extra lessons** in the child's own class (off-schedule
sessions, badged *Extra lesson*); and lessons the admin **cancelled in advance** (§7.6 *Advance-
cancel*), shown **struck through, badged *Cancelled*, with the admin's reason** — shown rather than
hidden, so the parent sees *why* there is no lesson that day. Explicit rows win a same-day
collision with the projection, and a cancellation wins over an extra lesson (an extra later
cancelled reads *Cancelled*, never *Extra lesson*). A projected date that falls on one of the
business's **public holidays** (`tenant_public_holidays`) is removed, so the app never sends a
family to a closed pool — but an explicit make-up/extra/cancelled row is shown regardless (it is
booked evidence, not a guess). The status filter applies only to the history below.

### 7.6 Attendance Management

SwimSync shall allow coach to record attendance per student per lesson session.

- Coach can mark one attendance status per student per session
- Attendance statuses: Present, Absent, Cancelled due to rain, Cancelled by coach, Trial
- If Trial is selected, coach must specify Paid Trial or Free Trial
- Attendance records must store who marked them and when
- Attendance records must be editable by authorized coach/admin
- If an attendance edit changes a billable status to non-billable on an already-invoiced lesson, SwimSync shall **automatically generate a credit note**
- An audit log entry must be created for every attendance edit

#### Who may mark a lesson follows the lesson's roster *(implemented 2026-08-11)*

Marking belongs to the lesson's **main** coach — the class's own coach normally, or whoever
the admin recorded as covering it (§7.13).

- A **substitute** sees only the lessons they were rostered onto, in a class they do not
  otherwise see, and marks them — including **both guest types** (trial and make-up), without
  which the guest could not be marked and the billing month could never close (§7.7).
- The **class's own coach keeps the lesson card**, badged **Covered** and read-only, and it
  **leaves their NEEDS MARKING list** — a straggler they are not permitted to clear would be a
  nag with no available action.
- A **shadow** sees the class's **whole schedule**, read-only, for as long as they are
  assigned — the opposite of a substitute, who sees only the lesson they were named on. They
  never mark, so the main coach stays unambiguous for marking exactly as they are for pay, and
  a shadowed lesson never enters anybody's NEEDS MARKING list but the marker's.
- **Once a shadow assignment ends, the class disappears from that coach's app** — unless they
  have since become its coach. Their own pay history is unaffected; My Pay reads their payout
  records, not the class.
- A substitute gains **nothing else**: they cannot remove a child from the class, set a child
  inactive, or see the class's other lessons.

**My Pay** names a correction for an earlier month rather than quietly moving the total.

#### The marking window is a rule, not a convention *(implemented 2026-07-27)*

Attendance may be recorded only for a lesson that **falls on the class's own weekday**
and lies **between the business's marking floor and today**. Both bounds are enforced by
the **database**, for every caller, not by the screen:

- **The weekday bound** stops a lesson being invented on a day the class does not run.
  Such a lesson is billed like any other and is invisible to every gap report, because
  those derive expected dates from the class's weekday — so it would never be questioned.
- **The floor** is the point past which a late record cannot be paid for: those lessons
  sit behind an invoice already sent, and a record added there is **never added to that
  invoice** (§7.7 seals a finished month). The correct instrument for changing an
  invoiced lesson is a credit note (§7.8), which is what the coach is told.
- **The ceiling** stops a lesson being recorded before it has happened.

##### The floor follows what a business has BILLED, not the calendar *(implemented 2026-08-07)*

The floor is **the 1st of last month, or the month after the business's most recently
billed month — whichever is earlier**. A business that has never billed can mark back to
the day it joined SwimSync. It is therefore **per business**: one school sealing July
does not close July for anyone else.

Until 2026-08-06 the floor was the calendar alone, and that had a consequence with **no
remedy**. The engine will bill **any** completed month, but the window only reached back
one. Billing **August on 5 October** with a single unmarked lesson made the gate name a
lesson that **nobody could record any more** — not the coach, not the admin — and there
is deliberately no override (§7.7). The month could then never be billed at all. While
the window was merely a UI convention this was recoverable, because the coach could still
reach the date; enforcing it in the database removed that escape.

Tying the floor to billing removes the trap without loosening anything that mattered: a
month a business has already billed stays closed, because that is what the floor was ever
for. **The floor can only ever be EARLIER than the old calendar rule, never later**, so
no date that was markable before this change became unmarkable after it.

The same floor governs the three things an admin *arranges* rather than observes —
scheduling an extra lesson, booking a make-up, and **booking a trial, which had no floor
at all before this** and would accept a booking into an already-billed month that could
then be neither marked nor billed.

A **correction to an existing record is always permitted**, whatever its date — that is
the credit-note flow and it must keep working on old lessons. Only a *new* record is
bounded.

The coach sees the reason in plain English instead of a roster they cannot save, and the
screen for a past lesson shows **the students enrolled on that date**, not today's class
list — otherwise a child who joined last week would appear on a lesson from before they
existed here, and the save (which requires a status for everyone on screen) would force
the coach to record attendance for a child who was not there.

#### Extra lessons: the admin arranges, the coach records *(implemented 2026-07-27)*

Because the weekday rule is absolute, a genuine makeup lesson or public-holiday shift
needs an explicit path: the **business's admin** schedules an extra lesson on any date
(including a future one, like a trial booking), with a **required reason**. It then
appears on the coach's class and in their unmarked-lesson list, and they record it
exactly as they would any other lesson.

**The coach cannot schedule one.** ~~And the admin still cannot record attendance~~ —
*(superseded 2026-08-19)* the admin **can** now record and correct attendance, on the
**lesson page** (§7.22): the same save as the coach app, under the same database guards.
The arrangement/observation split still holds for *scheduling* — only the admin arranges
an extra lesson, and either the coach or the admin records it.

#### Advance-cancel a lesson: the admin calls off a FUTURE lesson *(implemented 2026-08-21)*

The mirror image of an extra lesson. The **business's admin** cancels a whole lesson (class +
date) that has **not happened yet** — rain forecast, coach away — with a **required reason**,
from the **lesson page** (Calendar → lesson → *Cancel this lesson*) or the **Classes page**
(*Cancel a lesson*: class + date + reason). A single child not coming is an **absence**, not
this. The cancellation is recorded **on the session** (`lesson_sessions.cancelled_at`, with
`status = 'cancelled'` kept coherent by a CHECK), never as per-child marks — so a child who
enrols between the cancel and the billing run is not expected at it either.

What a cancelled lesson means, everywhere at once (one rule, five readers — §7.203):
- **Parent** — Upcoming shows it struck *Cancelled* with the reason (§7.5).
- **Coach** — the Schedule card is struck *Cancelled by your admin*; it leaves NEEDS MARKING and
  the class roster's backlog; opening it says the lesson was cancelled and offers nothing to mark.
  **The refusal is the database's** (`guard_attendance_date()`, §7.204), not the screen's: a
  stale screen, a deep link or a raw request cannot record attendance on it.
- **Billing** — the engine neither expects nor bills it (it satisfies the completeness gate the way
  a holiday mark does), and the Lessons badge / retire check agree. A live guest on that date would
  still block the month, loudly — which is why a cancel **refuses** while any trial/make-up booking
  sits on the date (it names them), and booking a guest or scheduling an extra lesson onto a
  cancelled date is refused in turn.
- **Admin calendar** — faded with a *Cancelled* chip, like a holiday void; guests cannot be booked
  into it.

**Refusals, all the RPC's own and rendered verbatim:** today or a past date (*"if it did not run,
record it as cancelled (rain / coach) on its attendance screen"* — the coach's existing
`cancelled_rain`/`cancelled_coach` mark is that path, unchanged; **this advance-only scope is a settled
decision, not a gap** — a second admin route to cancel *today's* lesson was refused 2026-08-22,
`BACKLOG.md` → *Deliberately not doing*); a session that already has
attendance rows (a marked lesson ran); a date holding live guests; a retired class. Cancelling twice
is a no-op. **Restore** (lesson page) reverses it, but never into a month already sealed in
`billing_periods` (a restored-into-billed lesson could never be invoiced — it stays cancelled), never
below the marking floor, and never for a retired class. A holiday void leaves a cancelled lesson
alone, and un-voiding a day never deletes one. Both actions are audited (`lesson_cancelled`,
`lesson_restored`).

**A cancel extends a covering prepaid package** *(implemented 2026-08-21)*, exactly as a public
holiday does: each active package that would have funded a cancelled lesson (resolved by the same
category + nominal-window coverage) has its validity extended by the tenant's
`holiday_extension_days`, and **restoring** the lesson retracts it. Deduplicated per (package,
date) — two children sharing one package, one cancelled date, extends it once — and it never
cascades past the package's nominal window. The extension is **snapshotted at cancel time**: a
family that enrols *after* a lesson was cancelled is not retro-extended (they never paid for that
week). Shown on the admin Packages row and the parent Billing card as *+N days · cancelled lessons*
alongside the holiday line. Still open on `BACKLOG.md`: whether the admin may cancel **today's**
lesson (locked to future-only — the coach's rain/coach mark is today's path).

#### The admin marks attendance on the lesson page *(implemented 2026-08-19)*

**Admin panel → Lessons** (a week of every coach's lessons, grouped by day, with a
**Needs marking** mode that lists every lesson from the business's marking floor to today
that is not fully marked — floor-scoped, never week-scoped; *(2026-08-20)* the **sidebar Lessons
link carries an amber badge** of that same count, so the backlog is visible from any page) and
**Calendar → double-click**
both open **`/lessons/[classId]/[date]`**, one lesson addressed by class and date (never a
session id — the row may not exist yet). There the admin:

- **Marks attendance** per expected student (enrolled by span + trial/make-up guests, the
  billing gate's own set) with *Present / Absent / Cancelled (rain|coach) / Trial (paid|free —
  trial guests only) / Public holiday* and **Set all**. Saving is the coach app's exact path —
  create the `lesson_sessions` row if missing, **one upsert of only the rows that changed**,
  an `audit_log` row (`attendance_saved`, actor the admin), then the bounded credit-note
  email when a billed status was left. **Every database guard applies unchanged and there is
  no override**: the marking window (a date below the floor shows *"That lesson is closed"*;
  rows that already have a mark stay editable as corrections, new rows do not), the weekday
  rule (an off-weekday date with no session is *"not a lesson"* — no Save is offered), the
  credit-note lock (re-marking a row whose credit is already applied is refused with the
  CN001 message — *none of your changes were saved*), and the holiday admin-only seam.
- **Voids one lesson for a public holiday** — the per-lesson complement of Holidays → *Void
  lessons* (§7.16), for the day when most-but-not-all classes are cancelled. Setting any row
  to *Public holiday* asks for confirmation naming how many students and the package
  extension days; the coach app's own save **leaves a holiday row untouched** (it never sends
  one), so a coach cannot silently re-bill a voided lesson.
- **Assigns or removes the substitute coach** for the lesson (`assign_session_coach`; the
  Lesson Coaches rules) and sees the class's shadows read-only. *(enforced 2026-08-21)* A
  substitute must be a **different** coach: assigning the coach the class rate already pays on
  that date records no cover, so it is **refused by the database** and hidden from the picker;
  to go back to the class's own coach, use **Remove substitute** (§7.13).
- **Books a make-up or a trial into this lesson** (host class and date fixed; a make-up asks
  which class it replaces when the child has more than one). *(enforced 2026-08-20)* A full
  lesson (`x/max`) is **refused by the database** — an inline notice says so and points at
  raising the class's maximum; there is no "Book anyway". Capacity is a hard limit for everyone,
  the admin included (§7.3).
- **Does not** write shadow absences — that stays the coach's "coaches present" checklist; a
  missing row means *present and paid*, the recoverable direction.

#### Bulk "Set all to…" *(implemented)*

The most common whole-class case — a lesson rained off, or everyone present — is a one-tap
**"Set all ▾"** menu in the Mark Attendance header. It sets every enrolled student to a
single status at once (Present, Absent, Cancelled — Rain, or Cancelled — Coach), which the
coach then adjusts individually. It **overwrites** all students; if any student is already
marked it asks for confirmation first, so a stray tap can't wipe individual edits. **Trial
is deliberately not offered in bulk** — a whole class of trials doesn't happen, and its
Paid/Free split needs a per-student choice. This is a client-side shortcut layered over the
existing per-student marking and the single upsert-all save (§7.6 above); it changes no
billing or storage behaviour, and matters because an abandoned cancellation is
indistinguishable from a forgotten lesson (§7.5), which is what silently underbills.

### 7.7 Invoice Generation

SwimSync shall generate invoices monthly, with two trigger modes sharing one billing engine.

- Invoice generation runs after the billing month has ended — automatically from a **configurable day of the following month** (default the **7th**), or manually on demand (§5.5)
- Invoice must cover the previous calendar month only
- Invoice amount must be calculated from attendance records
- Each lesson is charged at the class price **in force on the day that lesson happened** *(implemented — see below)*
- Only billable attendance items must be included (Present, Paid Trial)
- One invoice per parent per month with line items per lesson
- Invoice status shall include at minimum: Outstanding, Paid
- Outstanding credit note balance must be deducted from the gross invoice total to determine the net payable amount
- An invoice fully covered by credit is created directly as **Paid**

> *For internal implementation, additional statuses such as Draft or Issued may be used if helpful.*

#### A billing month must have ENDED before it can be billed *(implemented 2026-07-19)*

Invoices cover one **complete** calendar month (§5.5), and generation now **refuses** any month
that has not finished. On 19 July the latest billable month is June; July becomes billable at
00:00 on 1 August, Singapore time.

Until this was fixed nothing enforced it. The engine checked only that the month was well-formed,
and the admin's month picker **defaulted to the current month** with no upper bound — so billing
the month you are standing in was the obvious action rather than an unlikely mistake.

What made it serious is that it looked like it worked. The attendance-gap check ignores lessons
that have not happened yet (rightly — a future lesson is not a missing one), so a mid-month run
judged the month **complete**, billed the lessons so far, and **sealed** it. Every remaining
lesson of that month was then unbillable for good: a sealed month is never reprocessed, and a
parent who already has an invoice is skipped even if it were reopened. A quiet, permanent
underbill produced by an ordinary-looking action.

There is **no override**, for the same reason as the attendance block: no legitimate case is
served by billing an unfinished month, so an override could only ever cause the loss above. The
picker is capped as well, but the refusal is enforced in the billing engine — a limit that only
the admin screen applies is not a limit.

#### Months must be billed IN ORDER *(implemented 2026-08-18)*

Generation **refuses** to bill a month for a business while an **earlier** month still has
unbilled lessons, naming the earliest one ("bill 2026-07 first"). Sealing a later month pushes
the marking floor past the skipped one and permanently strands its unmarked lessons — the same
override-less underbill as above, arrived at from a different direction. The guard prevents it at
the source rather than lowering the floor (which would re-expose already-sealed months to
editing). Like the two guards above it takes **no `force` bypass**. A month with **nothing left
to bill** — empty, or fully marked absent — does not block, so a quiet month never deadlocks the
next one. The check is **fail-open**: any uncertainty resolves to "does not block", because a
missed block is a recoverable late mark (§7.17) while a wrongful block would halt a real
business's billing. Reasoning and the deploy record: `docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md`.

#### A lesson is priced by its own date *(implemented — corrected 2026-07-19)*

Each invoice line is charged at the class price **in force on that lesson's date**, not the
class's price at the moment invoices are generated (§7.3).

Until this was fixed the engine read the class's *current* price at generation time, so
editing a price on the 3rd of a month silently repriced **every unbilled lesson of the
previous month**. The exposure ran from the lesson until the invoice run — up to five weeks
at the default run day of the 7th. It was invisible: the invoice looked internally
consistent, and once created it can never be corrected except by credit note (§11.6).

If no price is on record for a lesson's date, generation **fails and bills nothing** rather
than charging zero. A $0 line would be a silent underbill on a document that freezes when
created, and the lesson could never be billed again.

#### An invoice keeps the name it was issued with *(implemented 2026-07-19)*

Each invoice line records the student's name **as invoiced**, and each credit note
records the name **as credited**, taken from the invoice line it reverses. Neither is
looked up live when the document is displayed.

Until this was fixed, five screens joined the student's current name onto these
documents, so correcting a child's name — supplying their full legal name, say — silently
rewrote invoices a parent had already been sent, and credit notes §7.8 calls immutable
permanent records. It was invisible: nothing failed, the document simply said something
different than when it was issued.

This is the same rule the class price and the paid coach already follow (§7.3): **a fact
about a past lesson is never a live lookup.** The invoice line already snapshotted the
class title for exactly this reason; the student's name had been missed.

Rows created before this are NULL rather than back-filled — inventing a historical name
from today's value would be a guess presented as a record, which is the failure being
fixed. Those fall back to the live name, which is no worse than the previous behaviour.

#### Attendance-gap check before generating *(implemented)*

Because billing is derived from attendance, a lesson nobody marked has no record and is
therefore **unbillable and invisible**. Before invoices are generated, SwimSync compares
each class's weekly schedule against what is actually marked for the billing month and
reports any gaps — per class, `N of M lessons marked`, naming the missing dates (see
§7.5). Future-dated lessons in the current month are not counted as gaps.

*(implemented — updated)* The check **blocks rather than warns**, in **every** mode. If any
lesson in the billing month has unmarked attendance, **no invoices are generated at all**
and the admin is shown which lessons to fix. There is **no override**.

*(implemented — corrected 2026-08-10)* **A booked guest counts even when nobody is enrolled
in that class.** The engine used to decide whether a class had any bearing on the month by
looking only at its enrolments and its recorded lessons, so a class with no active
enrolments but an unmarked trial or make-up booking was skipped entirely — the guest was
neither billed nor treated as a gap. On its own that only left the month open; alongside any
other class that billed, the month was **sealed** over the guest and their lesson could never
be invoiced afterwards. It is now the same rule everywhere: a lesson someone was expected at
must be marked before the month can be billed, and *expected* includes a guest.

*(implemented — corrected 2026-08-13)* **The admin's pre-flight now sees the same two things
the engine does: a lesson held OFF the weekly pattern, and a RETIRED class.** Both were
divergences in the same direction — the dialog reported a month complete that the engine then
refused to bill, which over-reports readiness but can never under-bill. An **extra lesson**
(§7.5) sits off the class's weekday deliberately, so it appears in no weekly series and was
invisible to the dialog while blocking the engine; the dialog is also where the missing dates
are *named*, so the admin was refused with no list to act on. A **retired class** was worse:
the dialog filtered it out entirely, so an unmarked lesson in one blocked generation while
being visible on no screen an admin could reach. A retired class is now checked, but its
weekly expectation stops at the day it was deactivated — lessons that genuinely ran are still
reported, lessons that were never going to happen are not demanded. The counts (`N of M`)
are taken over dates a mark was actually owed on, so a lesson from before the only child
enrolled does not inflate both halves of the ratio.

*(implemented — corrected 2026-07-18)* The **billing engine derives the expected lesson
dates itself**, rather than inspecting only the lesson records that happen to exist. Until
this was fixed the engine checked existing `lesson_sessions` rows only — and because those
rows are created *lazily* when attendance is marked (§7.5), a lesson **nobody had touched
had no row and was therefore invisible to it**. A month with four lessons of which three
were marked reported itself complete, billed three, and **sealed the month**, after which
the fourth could never be billed. The gap was caught only by the admin panel's own
pre-flight check, so the blocking rule described above was in practice enforced by the
*client*, not the server. Both now compute the rule from one shared definition.

This reverses the earlier "warns, with a *Generate anyway* button" behaviour. The original
justification — that a class which genuinely did not run is a valid reason to proceed — is
already served *inside* the completeness rule: such a lesson is recorded with the existing
non-billable statuses (*Cancelled — rain/coach*), which satisfies the check. So the bypass
was not covering a legitimate case; it was letting an unmarked lesson through unrecorded,
and once the parent has an invoice that lesson can never be added to it (§11.6 — the
original invoice is never modified). Billing around a gap therefore converts a fixable
problem into a permanent underbill.

All-or-nothing, not per-class, for the same reason: invoicing the complete classes would
give those parents an invoice and strand the rest behind the same guard.

The **escape hatch for an unfixable class** is to remove the student from it (§7.4): a child
who has stopped attending but whose enrolment is still open would otherwise keep their class
permanently incomplete and block billing indefinitely. Their already-attended lessons are
still billed — billing follows the **attendance records that exist**, not current enrolment.

When an **automatic** run is blocked it emails the coach and superadmin naming the lessons,
throttled to one alert per distinct set of outstanding lessons so a daily job does not send a
daily reminder.

#### Automatic vs Manual Generation *(implemented)*

Both modes run the **same** `generate-invoices` function, so billing math is identical either way:

The **completeness gate applies to both** — neither mode can bill around an unmarked
lesson, and there is no override (see the blocking rule above). What differs is only
*when* each fires and what it consults:

- **Automatic** — a daily scheduled run (cron) that generates invoices for the previous month from the configured **run day** onward (`app_settings.invoice_run_day`, default the **7th**). It respects a global **Automatic generation** switch (`app_settings.auto_invoice_enabled`), and **defers** any parent whose child sits in a class with incomplete attendance rather than writing a partial invoice a later retry could never top up.
- **Manual (on-demand)** — a superadmin action in the web admin panel that generates invoices for a chosen billing month immediately. It **ignores the automatic switch and the run day** — an explicit instruction must not be held back by a schedule — but is **subject to the same completeness gate**.

*(implemented)* **Everything in this section happens per business.** The engine runs one
tenant at a time: it bills, gates, blocks and seals each independently. One school's
forgotten lesson cannot hold up an unrelated coach's invoices, and one business
finishing a month cannot close it for anyone else. The automatic switch and the run day
are per-business settings too.

> The billing engine runs with a service key and therefore **bypasses row-level
> security entirely**, so this isolation is enforced in engine code rather than by
> policy. That is a deliberate and load-bearing distinction for anyone changing it.

**Either mode seals a month once it is genuinely finished**, so no later run reprocesses it.
A month is finished only when at least one class was actually reckoned with, none was left
unmarked, no parent was deferred, and no invoice write failed. Both modes also skip parents
who already have an invoice for that month (no double-billing).

> *Earlier behaviour, corrected 2026-07-18:* manual runs used to bypass the completeness
> gate and never seal. Both were changed — the bypass was letting unmarked lessons through
> into permanent underbills (see the blocking rule above), and a month finished by hand
> stayed open and was needlessly reprocessed.

##### A month with nothing recorded is never sealed *(implemented)*

Sealing requires that the run had something to finish. Generation on a month with **no
lessons recorded** — no classes or students yet, or, far more commonly, a month whose
attendance nobody has marked (`lesson_sessions` rows are created *lazily* by attendance
marking, per §7.5, so an unmarked month has none) — reports **nothing to bill** and leaves
the month **open**.

Without this, the three remaining seal conditions were all vacuously true and an empty
month sealed itself: the run reported "0 invoices generated" and then closed the month, so
every later run short-circuited and the month could never be billed at all. "Nothing
happened" is not the same as "everything is finished", and only the latter may close a
month. A month that *is* fully marked but yields no billable lesson (e.g. every lesson
rained off) is genuinely finished and **does** seal.

*(implemented)* When no billing month is passed (the automatic/cron path — the daily job POSTs an empty body), the engine defaults to **the previous calendar month in the app timezone**, derived via `Intl` in `generate-invoices/dates.ts` (`APP_TIMEZONE`, default `Asia/Singapore`) — **not** the runtime's UTC clock. Deriving it from UTC billed a month early at the SGT day boundary (a 1am SGT run is the prior day in UTC), which would matter the moment cron is enabled; the manual path is unaffected as it always sends an explicit month. The timezone is a single configurable seam, deliberately **not** per-coach/per-tenant — one zone suffices while all usage is SGT, and true multi-timezone belongs with future tenanting.

#### Email notification on generation *(implemented)*

When invoice generation creates a **new** invoice, SwimSync emails that parent an
itemized "your invoice is ready" message **branded as the business** — its name in the
subject and heading, and its logo if set. A parent pays their coach or school, not
SwimSync, and for a family dealing with two businesses an email headed "SwimSync" gives
no clue which one is asking. SwimSync appears only in the footer, as the sending
platform. The message is (line items + gross/credit/net; a fully
credit-covered invoice gets a "nothing to pay" variant). Delivery is **best-effort and
isolated from billing** — it runs after the invoice is committed, via the Resend HTTP API,
and a send failure never affects invoice generation. Every successful send is stamped, and
**re-running generation for a month re-sends only the invoices whose email never went out —
even on a sealed month — with no duplicate** to anyone who already received theirs
*(implemented 2026-08-16: a Resend hiccup previously dropped a parent's notification silently
with no record; the retry self-heals on the next run via a per-invoice atomic claim, and
skips suspended/auto-disabled tenants — see §7.7 and `docs/DEPLOYMENT.md` §11.24)*.
*Credit-note* emails are now sent too, by their own path — see §7.8. **Live in production
since 2026-07-16** (Edge Function deployed + `RESEND_API_KEY` secret set); the first real
send is the 1 Aug generation, and delivery-tracking/retry went live 2026-08-16.

### 7.8 Credit Note Management

SwimSync shall support credit notes for post-invoice attendance corrections.

- Credit notes are generated automatically when attendance is corrected on an already-invoiced lesson
- Each credit note records: parent, student, original invoice reference, lesson date, credit amount, reason, and timestamp
- Credit notes are immutable once created (cannot be edited or deleted)
- Outstanding credit balances are automatically applied to the next invoice during generation
- Parents can view credit note history in SwimSync's billing section
- Coaches and superadmin can view credit notes in their respective views
- Credit notes carry unique sequential reference numbers (e.g. CN-2026-0001)

#### The parent is emailed when a credit note is issued *(implemented 2026-08-17)*

Until this shipped, a parent learned about an adjustment only by opening the app, so the
coach fielded "why is my bill different?" by hand — the same silent-notification gap the
invoice email closes, on the other side of the ledger.

When a correction issues a credit note, SwimSync emails that parent a message **branded as
the business** (§7.7's rule) naming the credited lesson — child, class and date, taken from
the invoice's own snapshot so a later rename or class hand-over cannot make the email
contradict the invoice the parent is holding — the credit note's reference number, the
coach's stated reason where they gave one, **and two separately labelled amounts: this
credit note, and the parent's total credit with that business**. The total is named
alongside the business because credit never crosses businesses (§5.6), and the email says
the credit is applied automatically to the next invoice, so no payment is needed for the
credited lesson.

- **One email per credit note.** A rained-off lesson credits every affected child, so a
  parent with two children in that class receives two — each with its own reference number.
- **A credit that has already been used is never emailed.** Once the engine has drawn a
  note down, in whole or in part, the "applied to your next invoice" promise would be
  false, so the notification is refused rather than sent late.
- **A suspended business sends nothing**, because a suspended business's credit notes are
  hidden from the parent in the app.
- **Delivery is best-effort and isolated**, like the invoice email: a failure never affects
  the attendance save or the credit note itself. Every successful send is stamped, and the
  tenant admin sees any note that was never emailed on the admin panel's Credit Notes page,
  marked **Not emailed**, with a **Resend** button. Resending is deliberately a **tenant
  admin** action — the platform admin can see every business's notes and must not send mail
  in a business's name.

Package-funded corrections are **not** emailed, because they issue no credit note — the
lesson's value returns to the package instead (§7.16).

### 7.9 Payment Tracking

SwimSync shall support manual payment verification.

- Parent sees invoice status and outstanding amount (net of any credits applied)
- Paid timestamp should be stored
- No auto-payment detection required for MVP

*(implemented — changed 2026-08-02)* **Marking an invoice paid is a TENANT ADMIN action,
not a coach one.** The original line said "coach manually marks invoice as paid", and the
coach app carried an invoice list with a Mark Paid button. Fee-free payment collection
(§7.21) put everything that makes an invoice actionable on the admin panel — the
`INV-YYYY-NNNN` reference, the dynamic PayNow QR, the WhatsApp reminder queue, the "parent
says paid" badge and the **Claimed** filter — so the coach's copy was a place to make a
money decision with strictly less information. It was removed, along with the
"Outstanding" tile on the coach's Today screen, which counted unpaid invoices with no date
bound while sitting between two today-scoped numbers.

Every mark-paid still runs through the one converged `confirm_invoice_paid()` path (§9.13),
now reached only from the **admin panel** and the **public invoice page**. A private coach
holds the tenant-admin role anyway, so nothing they could do before is lost — it moved to
`admin.swimsync.sg`.

### 7.10 PayNow QR

SwimSync shall support a separate PayNow QR code per **business**.

- The business's admin uploads/updates its PayNow QR image
- Parents see the QR of the business that **issued the invoice**
- If a parent has children at different businesses, the correct QR is shown per invoice

*(implemented — changed from per-coach)* The QR was originally per coach. It belongs to
the **business**: a school with three coaches has one bank account, and showing an
individual coach's QR would send a parent's payment to the wrong person. A private coach
is their own business, so nothing changes for them. A *school* coach sees the QR
read-only and is told to ask their admin.

*(implemented 2026-08-09 — the QR image is no longer the primary mechanism)* Since
§7.21 the primary way a parent pays is a **computed QR built from the business's PayNow
ID**, entered on the admin panel. The coach-Settings card therefore leads with whether
that ID is set, and the image upload sits **collapsed behind "Fallback QR image —
advanced"** — always present, never conditionally removed (§7.21 explains the outage
that hiding it would cause). The same screen gained an **Open admin panel** link to
`admin.swimsync.sg`, shown only to a coach who is also a tenant admin — a plain coach
does not see it at all, because the panel's own door refuses them (a disabled link would
still advertise a tool they cannot use).

### 7.11 Parent Portal

SwimSync shall provide parent-facing views.

- Parent can see all linked children and their profiles
- Parent can see assignment status (assigned or unassigned) for each child
- Parent can view class details, attendance history, invoices, credit notes, and payment status
- Parent can view PayNow QR for payment

### 7.12 Web Admin Panel

SwimSync shall provide a simple web panel for superadmin operations.

- Login and role-based access
- View classes, class rosters, students, attendance, and invoices
- View and manage credit notes
- Mark payment as paid
- Upload/manage PayNow QR
- View dedicated **Unassigned Children** listing
- Assign unassigned children to coaches/classes
- *(implemented)* Set the business name, share/regenerate its **join code**, and run
  **coach payroll** (§7.13)

### 7.13 Coach Wages *(implemented)*

SwimSync tracked every dollar coming **in** from parents and nothing going **out** to
coaches. The moment a coach is not also the business owner, payroll is a spreadsheet
rebuilt by hand each month from attendance the app already holds. This closes that loop.

**A coach is on payroll when they have a rate.** There is no private-vs-school flag: a
private coach simply has no rate, because their income *is* their parents' invoices and
there is nobody upstream to pay them. The distinction is data, not a rule.

**Who a lesson pays is answered per LESSON; who SHADOWS is answered per CLASS**
*(substitutes implemented 2026-08-11; shadows moved to the class 2026-08-12)*. The two are
deliberately different shapes, because the arrangements are:

- a **substitute** is a one-off on ONE lesson, recorded on the lesson itself;
- a **shadow** is a **dated assignment to a whole class**, permanent until it is ended.

**No record means the class's coach is the main coach** — so nothing changed for any lesson
nobody has touched, and there was no backfill.

- A **substitute** is paid **their own rate**, not the class's terms; a senior covering a
  junior's class costs what the senior costs. The coach they replaced is paid **nothing** for
  that lesson.
- A **shadow** is paid for **every lesson of the class that ran** while their assignment was
  in force, so **one lesson can produce more than one payout row**. They are paid a **shadow
  rate**, which is a second effective-dated rate per coach and NOT their teaching rate
  *(implemented 2026-08-12)*. **A shadow with no shadow rate in force makes payroll refuse
  outright** rather than fall back to their teaching rate — falling back would pay a trainee a
  full coach's wage, which is the thing the second rate exists to prevent.
- **A coach who both shadows the class and covers one of its lessons is paid the SUBSTITUTE
  rate for that lesson.** Substitute beats shadow; they taught it.
- **The main coach records who was actually there.** The attendance screen lists the lesson's
  shadows, **pre-ticked**, and unticking one drops that single lesson from their pay. Nothing
  appears for a class with no shadows. Pre-ticked because forgetting an opt-in silently
  underpays somebody and shows nowhere, while forgetting an opt-out overpays and shows as a
  line on Wages.
- **Ending an assignment never changes pay for the lessons inside it.** The record is dated,
  so a shadow who stops in November keeps every August lesson they were assigned for. What
  ending it *does* change is visibility — see §7.6.
- **A month whose coach payouts are already paid is frozen for both.** Neither a shadow
  assignment nor an attendance tick can be backdated into it, or edited within it, and there
  is deliberately no override.
- A **class flat-rate override applies only when the class's own paid coach teaches it.** A
  substitute always falls through to their own rate, because that is what "paid their own
  rate" means. *(No flat-rate class exists yet; this is the rule the first one will meet.)*
- Recording a cover **after** the month's payout was already paid is allowed: the replaced
  coach is clawed back and the substitute paid, both as adjustments carried **once** onto the
  next payout, leaving the paid record intact (§7.13's draft/freeze model, unchanged).

**A class's own coach cannot also shadow it** *(2026-08-12)*. They are its main coach by the
absence rule, so an assignment would say two different things about one person: the lesson
becomes one the coach is required to mark, is not permitted to mark, and is never reminded
about. Refused when the shadow is added, and refused again the other way round — **handing a
class over to a coach who is currently shadowing it is refused until that assignment is
ended**. An assignment that has **already ended never blocks a handover**, because their past
pay is kept either way.

**Admins assign; coaches do not.** Substitutes and shadows are managed on **different pages**,
because they are different shapes:

- **Substitutes** *(labelled "Lesson Coaches" until 2026-08-17; route `/substitutes`, old
  `/lesson-coaches` permanently redirects)* picks a class and a month and shows who is teaching
  each lesson, with assign / change / clear for the substitute. It no longer mentions shadows
  at all.
- **Classes → a class → Shadow coaches** adds a shadow with a start date, ends an active one,
  and lists past assignments with their date ranges. Ended ones stay visible because they
  still explain money. The class's own coach is not offered.

Lessons come from the class's weekly pattern **unioned with**
lesson rows that already exist, so an extra or rescheduled lesson is assignable and is badged
*Extra*. Assigning a cover to a date with no lesson row **creates** it — the admin never
handles a lesson id — and a date the class does not run on is refused.

**Wages** *(labelled "Coach Wages" until 2026-08-17)* expands each payout into a per-lesson breakdown: it sums the **set** of items
per lesson, counts **distinct** lessons (a clawback-only line is not a lesson taught), and
labels every line — *Assigned to cover*, *Shadowing*, *Reassigned to another coach*,
*Correction to a settled month* — with a ±S$ chip naming the month it corrects. It also now
surfaces two failures it previously swallowed: a payout that failed to load (it used to render
as "no payouts this month yet") and a stored gross that disagrees with its items.

#### What a lesson pays

Evaluated per session, in this order:

| Situation | Pays the coach? |
|---|---|
| Cancelled by the coach | **No** — always, not configurable |
| An explicit per-session decision by the admin | Whatever they set |
| Cancelled due to rain | The **business's** default (they travelled; the pool shut) |
| At least one student attended | **Yes** |
| Every student absent | **No** — the lesson ran on paper, nobody came |

A **free trial counts as attendance** here even though nobody was billed for it: the
coach still taught the lesson, and paying only for billable statuses would dock them for
the business's own marketing.

#### How much

A coach's rate is an amount per unit of time (e.g. $30 per 60 minutes), and a lesson pays
`rate × (class duration ÷ unit)` — **pro-rata, never rounded up**, since rounding up
overpays every short lesson forever. Any individual class may instead carry a **flat
rate**, which replaces the calculation entirely.

**Rates are effective-dated and never edited in place.** A raise is a new rate with the
date it starts, and every lesson is priced at the rate in force *on the day it was
taught*. This is what stops a raise from silently repricing history — without it, giving
someone more money in June would change what they were owed in March. Backdating a rate
deliberately *does* produce back pay, which is the point of backdating.

**Who is paid is effective-dated too** *(implemented — corrected 2026-07-19)*. A lesson pays
the coach who was assigned to teach it **on its own date**, not whoever holds the class now.
Until this was fixed, handing a class to another coach moved its entire unpaid history: the
outgoing coach's draft payout fell to zero and the incoming coach was paid, at their own
rate, for lessons they never taught. A perfectly ordinary handover silently moved money
between two people. Note the split this rests on — the class's **current** coach still
governs who can see and mark it; only *pay* looks backwards.

#### Draft, then frozen

A payout is a **draft** until the admin marks it paid: it recalculates on every run, so
ordinary late attendance corrections simply flow in. Marking it paid **freezes** it —
money has left the bank and the record must reconcile against a statement. A correction
to a frozen month appears as an **adjustment on the next payout**, tagged with the month
it belongs to, rather than rewriting what was already paid.

This is deliberately *not* the credit-note model: an invoice freezes on generation
because the parent has already been sent one, whereas a payout has no external artefact
until money moves, so the draft window costs nothing and removes most adjustments.

**An adjustment is carried once** *(implemented — corrected 2026-07-19)*. Each correction
appears on exactly one payout and is then settled. Until this was fixed, the engine
re-compared "what is owed now" against "what was paid then" on **every** later run and
emitted the difference each time — so a single $45 correction reappeared on the next
payout, and the one after that, indefinitely. A coach would have been docked the same $45
every month. A *second* genuine correction to the same lesson still flows through
normally; only the repetition is gone.

#### Who sees what

A coach sees **their own** payout, read-only — that is the point of the feature for them.
Rates are admin-only even from the coach they belong to, so a colleague's earnings are
not inferable. Payroll runs on a **per-business pay day**, independent of the invoice run
day: a school may bill parents on the 7th and pay coaches on the 15th.

### 7.14 Active / Inactive Families and Children *(implemented)*

Families leave. Until this existed, the only ways to say so were deleting them — which
destroys the billing history needed at tax time — or leaving them in place, where they
padded every roster and every unmarked-lesson report indefinitely.

#### Three concepts, deliberately three different words

| Concept | Who decides | Means |
|---|---|---|
| **Active / inactive** | The business's admin | Still a customer **of this business**? |
| **Assigned / unassigned** | The business's admin | In a class right now? |
| *(Enabled / disabled)* | *Platform admin* | *Can this person log in at all? — **not built**, see below* |

Activity and assignment are **separate axes**, because a child can legitimately be
**active but unassigned** — a new signup waiting to be placed is exactly that. Collapsing
them is what made "inactive" ambiguous: `assignment_status` previously carried an
`inactive` value *and* `students.is_active` existed, saying the same thing two ways.
`assignment_status` is now `unassigned | assigned` only.

**A family's activity is recorded per business.** Parents are global — a family with one
child at a swim school and another with a private coach is the common case (§5.5) — so
"this family has left" can only ever be true of *one* business. A school marking a family
inactive has no effect on their private coach.

#### The family follows its children, as a consequence

Marking a child inactive is a **choice** — the admin is asked whether the siblings go too,
and is shown their names. A family with no active children left being inactive is a
**consequence** of that choice, so SwimSync states it rather than asking again:

> *"That leaves no active children, so the Tan family will be marked inactive at this
> business too. They can rejoin any time with your join code."*

The date each child and family went inactive is recorded. That date is the point of the
feature as much as the flag is: *"when did they stop?"* is the question behind every
end-of-year reconciliation and every "why is this invoice short?".

#### Coming back is the join code

An inactive family **can still log in** — they are a customer the business has closed off,
not an account anyone has disabled — and they keep read access to their own history,
because their past invoices are the record. To return, they re-enter the business's join
code (§5.1). No admin action, no new screen: the code is the business's own gate on who
gets in, and possession of it is the proof.

Rejoining restores **status only**. Children stay inactive and the admin places each one
deliberately — guessing which class a returning child belongs in is how a roster ends up
wrong.

*(Deliberately not built: blocking an account from logging in. That is a **platform**
power over an account rather than a business decision about a customer, which is why it
carries a different word — enabled/disabled. The only genuine trigger for a parent is a
PDPA consent-withdrawal request, where "cannot log in, records retained" is right since
financial records must be kept ~5 years; that has never happened. The real near-term need
is revoking a **staff** account — a coach who leaves a school — and it is filed there.)*

### 7.15 Swimming Levels *(implemented 2026-07-19)*

Each business defines **its own level ladder** — "Seahorse", "SwimSafer Level 3", whatever
it actually calls them — and places each child on a rung.

Until this existed the **class name** carried the level. That works for one coach with four
classes and stops working the moment anyone wants to track progress *within* a class, or a
second business uses different names for the same thing.

**A defined set, not free text.** Free text makes every typo a new level, nothing sorts,
and there is no list to pick from. Each level carries an explicit **order**, which is the
part that earns the table: a ladder sorted alphabetically puts "Advanced" above
"Beginner".

**Who does what:**

| | |
|---|---|
| Defines the ladder | The business's **admin** |
| Places a child on it | The business's **admin** |
| Sees it | The child's **coach** (roster) and their **parent** (child profile), read-only |

The coach deliberately has **no write path**. Granting coaches `UPDATE` on students to set
a level would also let them edit names, dates of birth and notes, because row-level
security is row-level, not column-level — the same reasoning that made closing an enrolment
a dedicated RPC (§7.4). If coach-set levels are wanted later, that is an RPC, not a policy
change.

Levels are **per business**, and a child may only be given a level from *their own*
business — enforced in the database, since no single-row policy can see across that
reference. Retiring a level leaves its students **unlevelled**, never deleted.

#### What a level teaches *(implemented 2026-07-19)*

A level's label says where a child is; it says nothing about what they are working on.
Each level therefore carries an ordered **list of skills** — "Aeroplane Kick", "Torpedo
Glide w/ board", "Rules of the pool" — as the business teaches them.

**A list, not a paragraph.** Real curricula are discrete named skills in a deliberate
order, and storing them as prose would make them opaque: nothing could count them, order
them, or ever mark one as passed. Order is set by the admin and preserved everywhere,
because a curriculum rendered alphabetically teaches "Rules of the pool" before
"Aeroplane Kick".

A level also carries an optional **note** for the things that are not skills — typically a
progression rule such as *"Progress to B3 upon completing T4"*. Without it an admin would
have to enter that line as a fake skill.

**Who sees it:** the business's **admin** writes it; the child's **coach** sees it on the
roster (collapsed by default, since a roster of six children across three levels would
otherwise be thirty lines of skills) and their **parent** sees it on the child's profile.
For a parent this is the clearest answer the app has ever given to *"what is my child
working towards?"* — a question it previously could not answer at all.

**The ladder is a flat, ordered list of labels, deliberately.** Businesses structure their
levels differently — tiers, numbered rungs, non-linear progression between them — so
SwimSync models none of that. A school with sixteen rungs across five tiers names them
that way and orders them; any progression rule lives in the level's **note**, in that
business's own words. Imposing a tier-and-progression model would force every other
tenant into one school's shape.

*(Deliberately not built: **ticking skills off per child.** These describe the LEVEL, not
any student's progress against it. Per-child tracking is a real feature — it needs coach
write access to students, which they deliberately do not have, a marking UI, and a
decision about what happens to those records when a child changes level. Filed in
`BACKLOG.md`. The skills are stored as rows rather than prose precisely so that feature
would not have to migrate a curriculum out of a text blob.)*

*(This replaces the original fixed beginner/intermediate/advanced field, which was never
populated: parents stopped choosing an ability in §5.1, and nothing else ever wrote it.
Deliberately not re-added: a parent-facing level picker — self-reported ability was
removed on purpose, and a level is the coach's judgement.)*

### 7.16 Prepaid Lesson Packages *(implemented 2026-07-20)*

Until this existed every family paid **after** the month's lessons (ad hoc). A business
can now also sell **prepaid packages** — "10 Group lessons at S$40, valid 12 weeks" —
which is how many swim schools actually price, and which pays the business before the
teaching instead of five weeks after it. Full design record: `PACKAGES_DESIGN.md`; the
weeks / start-date / holiday-extension work is `docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md`.

**A package is money, displayed as lessons.** The balance is stored in dollars and drawn
down at the package's **locked rate**, so the counter a parent sees (`balance ÷ rate`) is
always exact — and a value survives the cases a stored lesson-count cannot: a child
changing to a differently-priced class, or a business whose classes aren't all one price.
The volume discount lives in the rate itself (50 lessons at $30 when walk-in is $40), so
cash paid always equals value granted — nothing to reconcile.

- **Held per (parent, business)**, pooling across siblings there; like credit, it never
  crosses businesses (§5.6's rule, same reasoning).
- **Scoped by class category** — the business's own grouping of classes ("Group",
  "Private"), spendable at every class in the category including ones added later; a
  package with no category covers all the business's classes (the private-coach shape).
  Things priced together belong in a category together. Tiers ("10 @ $40" vs
  "50 @ $35") are **products** against one category, never categories themselves — a
  class is never duplicated per tier.
- **Locked rate, always**: a covered lesson draws and is invoiced at the package's rate,
  whatever the class charges walk-ins. A price rise is a **new product**; existing
  holders finish at their agreed rate and meet the new price at renewal. Product money
  terms are immutable in the database — retire and recreate, never edit.
- **Money moves at invoice time only.** Attendance still drives everything: the same
  engine, gates, sealing and month rules apply; covered lines are priced at the package
  rate and the invoice records `package applied` beside credit — and the parent's
  invoice detail marks **each funded line** ("Paid by package · *name*", from the
  `package_applications` ledger; a **reversed** draw reads ad hoc, because that money
  went back to the package) *(implemented 2026-08-02)*. When a package runs out
  mid-month the remaining lessons bill **ad hoc at the class's own effective-dated
  rate**, on the same invoice — nobody is blocked at poolside and nothing is lost. A
  family with no package takes exactly the pre-package path.
- **Live everywhere it is shown**: the parent's card, the admin's tables and the
  students-page **"running low" filter** (threshold per business, admin-set) all read
  one database derivation that subtracts lessons attended but not yet invoiced — the
  count drops the evening of the lesson, though the money settles monthly.
- **Every child's name carries their payment method** *(implemented 2026-08-01)*:
  a chip beside the child reads **"Package · N left"** or **"Ad-hoc"** — explicit both
  ways, so a missing chip is never the signal — on the admin's Students, Classes
  roster, Attendance, Trials, Credit Notes, Unassigned, Dashboard and Platform
  surfaces, and in the parent app on each home child card and the child profile's
  Balances card. The verdict is **per child and category-aware**: a family holding
  only a "Private" package sees "Ad-hoc" beside their child in a "Group" class,
  because that package cannot pay for it. *(The first-shipped chip summed the family's
  lessons by parent, ignoring both category and expiry — the same family's every child
  read "N left". Fixed with the per-child verdict; the "running low" filter follows the
  same rule, and never flags an ad-hoc child: no pool is not an empty pool.)* The
  count is **family-shared** — siblings read the same pool, and the copy says so. An
  **exhausted but unexpired package reads "Package · 0 left", never "Ad-hoc"** — "buy
  a top-up" and "you are not a package family" are different messages, so the engine's
  can-it-fund-a-lesson rule deliberately plays no part in the label. Two family-grain
  surfaces (admin **Parents** and the **claim queue**) label the *family* instead —
  "does this family hold a live package here" — since a family's package exists even
  when no currently-enrolled class is covered. An unclaimed child shows no chip; they
  already carry "No parent account", and a family that doesn't exist has no payment
  method.
- **Validity is measured in WEEKS, and a purchase carries an explicit start date**
  *(implemented 2026-08-15)*. A product is "N lessons, valid **M weeks**"; a sale (or a
  confirmed request) records a **start date**, and the package's effective end is
  `start date + M weeks` (plus any extension below). The admin sets the start date at
  the sale, **pre-filled** to the day the family's current coverage runs out — whichever
  comes first, the previous package's lessons being used up (forecast from the covered
  children's current enrolments) or its own expiry — so back-to-back packages line up
  without hand arithmetic, including a family with two children who deplete a shared
  package faster. The start date is the admin's decision, not the parent's, and is fixed
  once the package is active (a wrong one is cancel-and-resell). A future-start package is
  *not yet* coverage — the payment-method chip reads ad-hoc, and the engine bills those
  lessons ad-hoc, until its start date arrives.
- **A public holiday is VOIDED by the admin, which both skips the charge and extends the
  package** *(implemented 2026-08-19 — replaced the calendar-scan auto-extension of
  2026-08-15)*. Each business still keeps its own **holiday calendar** (Admin → Holidays:
  add by hand or **import a data.gov.sg CSV**), and it still hides holiday dates from the
  parent's upcoming-lessons list. What changed is the mechanism: on the Holidays page the
  admin presses **Void lessons** for a date (each row shows whether it is already voided
  and how many lessons; a single **Restore** undoes it). Voiding marks every scheduled
  lesson that day — for every class still running on that date, judged by its **SGT
  retirement date, inclusive** *(2026-08-20; a class retired 00:00–08:00 SGT was previously
  missed by a day, so its already-marked lessons kept billing)* — and every expected
  student, enrolled or a trial/make-up guest, with a new
  **`holiday` attendance status**, which is **non-billable** (nobody is charged, no package
  is drawn) *and* extends each covering package's validity by a **tenant-configurable
  number of days** (default 7, set on the same page). The extension is **event-driven** —
  applied at the moment the lesson is marked, not recomputed on every page load — and is
  **deduplicated per package**: two children sharing one package, one holiday, extends it
  once. Coverage is judged against the package's nominal window, so an extension never
  pulls in further holidays, and **un-voiding reverses it exactly**. `holiday` is
  **admin-only, enforced in the database** (a coach sees it read-only; the DB refuses a
  coach setting, clearing, or deleting it). A voided lesson already billed at `present`
  auto-issues a **cash** credit note (§7.8), value-equivalent to the drawn package lesson.
- **The admin can also extend a package by hand** *(implemented 2026-08-15)* — a
  discretionary number of weeks with an optional reason, stacked on top of any holiday
  extension and recorded in an audit trail. Shortening is not an option (that is
  cancel-and-resell).
- **Purchase is PayNow + manual confirmation** (§7.9's model): the parent requests in
  the app, pays the business's QR, and the admin confirms receipt — which activates the
  package and starts its validity clock from the start date above. Admins can also record
  offline sales directly. Both steps email the parent (business-branded, best-effort,
  isolated).
  *(implemented 2026-08-09)* **A package request is now identified like an invoice.** It
  carries **`PKG-YYYY-NNNN`**, numbered within the business — the year from the request's
  own timestamp in Singapore time, never the clock — and its PayNow screen builds the
  same **dynamic QR with amount and reference locked** that an invoice has had since
  §7.21. The admin's Packages page shows the reference on the pending queue and on held
  packages, which is the point of minting it: an incoming bank line has to be matchable
  to a request. Before this, a package purchase was the one payment in the product a
  parent made by scanning a static image and typing the amount by hand — the exact
  unattributable payment §7.21 exists to remove. The reference is assigned by a database
  trigger and is not client-writable, on insert or update.
- **Renewal offers — packages get the invoice collection loop** *(implemented 2026-08-15)*.
  When a family is **running low** — few lessons left **OR** its package expiring soon — the
  admin can send them their next package as an **offer**: a *pending* package the admin
  creates on the family's behalf, with a smart-defaulted start date and a product
  pre-selected from the family's last package, or from a per-category / all-classes
  **default** the admin sets on the Packages page. The parent gets a business-branded email
  and a tokenised **`/package` pay page** — the same dynamic PayNow QR, locked amount +
  `PKG-` reference, and "I've paid" claim an invoice has (§7.21) — and the admin works a
  **WhatsApp queue** of `wa.me` links, the same shared queue the invoice reminders use. A
  per-family **Generate invoice** button acts on one family; **Generate all** previews every
  low family (product + start date editable per row) before anything is sent — nothing goes
  out blind. A newer pending request **supersedes** (cancels) an open *unclaimed* offer, so a
  family never holds two live pay links; a **claimed** offer is never auto-cancelled (the
  bank reference must keep resolving). Confirming *Payment received* activates the package
  **with the offered start date**. "Low" is one definition — lessons ≤ threshold or expiring
  within N days (both admin-set), minus families that already have an open row — used
  identically by *Generate all* and by the Students page's **Package / Left / Expires**
  columns and its "running low" filter. Renewals are for package HOLDERS only; ad-hoc
  families stay on monthly invoices. *(No cron: `wa.me` is worked by hand. The public page
  refuses a suspended business — an offer is prepayment for lessons that may never run,
  unlike an invoice for lessons delivered.)*
- **Referral discounts — a double-sided, package-only refer-a-friend** *(implemented 2026-08-15)*.
  The business's own marketing, and SwimSync's **first price modifier**: it changes only what
  a family **pays** for a package (`amount_payable`), never what the package is **worth**
  (`total_value` / `value_remaining` / invoice netting are untouched). Every member of a
  business has a **referral code** — a second kind of join code, `REF-XXXXX`, shown on their
  parent **Billing** tab (one card **per business**), with Copy and Share-on-WhatsApp. A
  friend enters it at registration or on the Join screen (the field accepts `SWIM-` join codes
  **or** `REF-` referral codes); entering a `REF-` code joins the referrer's business **and**
  records the referral. This does not weaken the join-code argument (there is still no public
  directory): a referral code is minted per real member of a real business, so possessing one
  is still proof of a genuine relationship. The scheme is **double-sided**: the **friend** gets
  a discount on their **first** package, and the **referrer** gets one on a **later** package,
  released only when the friend's first package goes **active** (Payment received, or a direct
  active sale) — never at registration or "I've paid", and **once per referred family, ever**.
  Rewards **queue** (FIFO, oldest first — three referrals is three discounted packages) and are
  applied automatically to the next package. The discount is a tenant-wide **percent or fixed
  $** (capped so the price never goes below $0), with an optional **per-product override** (its
  own type + value; a `0` is an explicit "no referral discount on this product"). The
  **referrer's** reward can **expire** (tenant-set days from earn date, or never); the friend's
  first-package discount does not. Configured on a dedicated **Referrals** admin page
  (enable/type/value/expiry, the referrals + rewards lists, and actions to **Grant** a goodwill
  reward, **Void** an unused one — refused once the family has paid — and **Disable** a leaked
  code); the discount shows on the Packages page, the offer/pay page and the confirmation the
  admin ticks against the bank, all from **one** price source so the preview, the WhatsApp
  price and the pay-page headline always agree. A referral whose friend shares a **student,
  phone or postal code** with the referrer is **not** rewarded (same-household guard; the manual
  *Grant* is the override for a legitimate case). The referrer is emailed when they earn a
  reward — that email carries only the discount and the business name, never the friend's
  package. *(No cron: the "your reward expires soon" nudge and any unprompted low-balance email
  are out of scope, filed in `BACKLOG.md`. Referrals are package-only by design — monthly-billed
  families are not in scope. Full design + 16 risk mitigations: `docs/plans/REFERRAL_PLAN.md`.)*
- **The admin Students page** surfaces each child's coverage as **Package / Left / Expires**
  columns (amber when running low; "Ad-hoc" when uncovered) and folds per-row actions —
  Invite parent, Contact details, Rename, Set inactive, and **add / end a class** — into one
  **Actions** drawer. The class chips themselves are **view-only** on the row; the Level
  dropdown stays inline. *(implemented 2026-08-15.)*
- **Multiple packages draw earliest-expiry-first.** Expiry is checked against the
  **lesson's own date** — a package that expires between the lesson and the invoice run
  still pays for lessons taken while it was live, and coverage starts at confirmation
  (lessons before the purchase bill ad hoc).
- **Corrections restore the package.** A billable→non-billable correction on a
  package-funded lesson reverses the draw back onto the package (even one that has since
  expired) instead of minting a cash credit note — prepaid value and refund liability
  are deliberately separate pots, and a line is refunded at most once. Ad-hoc lines keep
  the §7.8 credit-note flow unchanged.
- Precedence when both exist: the package covers its own in-scope lines; credit notes
  then reduce the remaining cash amount.

*(Deliberately not built: in-app refunds — cancelling freezes the remaining value and
the money settles offline, see `BACKLOG.md`; arbitrary-amount top-ups — buying another
package is the top-up; and the UNPROMPTED parent low-balance nudge — the admin now sends a
renewal offer with its own email (above), but an automatic parent-side reminder stays
backlogged behind cron.)*

### 7.17 A Child Before Their Parent *(implemented 2026-07-25)*

Two everyday situations had no answer in SwimSync, and both stalled onboarding:

- **A trial.** A parent arranges for a child to try a lesson. That child does not exist
  in SwimSync, so there is nobody for the coach to mark. *(Originally framed as a
  **walk-in** the coach handled at the poolside. That was wrong — see the note below the
  table: a trial is arranged ahead of time, by the admin.)*
- **A student whose parent hasn't registered.** The child has been attending for weeks;
  the parent has not got round to signing up. Same problem, every lesson.

In both cases the lesson was **invisible**: unbillable, absent from the coach's payout,
and not counted by the attendance check. The only remedy was to chase the parent before
teaching anyone.

**A child can now exist before their parent does**, by either of two routes — and which
one you use depends on whether the child is *visiting* or *attending*:

| | Who | Where | What it records |
|---|---|---|---|
| **A trial** | The business's admin | Trials → *Book a trial* | A **booking**: this child is expected at this one lesson. No enrolment, no attendance |
| **An ongoing student** | The business's admin | Students → *Add student* | The child and an open enrolment in a class. No attendance: the coach marks them from then on |

Nobody else can do either: a parent cannot put a child on someone's roster, and neither
can a coach from another business.

> **THE COACH CANNOT DO EITHER, AND THIS IS DELIBERATE** *(confirmed 2026-07-26)*.
> Trials are **arranged ahead of time, not walked in** — so the person who arranges them
> is the business's admin, at a desk, not the coach at the poolside. The coach account's
> only write path is **marking attendance**; the coach app calls no RPCs at all.
> A **private coach holds a tenant admin account anyway** (a private coach is a tenant of
> one, §4.3), so they arrange trials there — no capability is lost by withholding it from
> the coach role.
>
> The 2026-07-25 build did briefly ship an *"Add a walk-in"* form on the coach's attendance
> screen; it was removed the next session when a trial became a **booking**. The server-side
> RPC still accepts a coach caller, but no UI reaches it. **Don't restore a coach-side trial
> form** on the assumption the capability is missing — it was taken out on purpose.

An ongoing student is enrolled **from the day they are added**, so lessons taught before
that are neither expected of them nor billed. Capturing earlier weeks means the coach
marking those dates.

##### Who can see a booked trial *(added 2026-07-26)*

Because a trial is a booking and not an enrolment, a booked child has no class attached —
and every screen that reads "which class is this child in?" used to describe them as a
child **waiting to be placed in one**. That was false in three places at once, and the
admin one was actively dangerous:

- **The parent** was told *"the admin will assign your child soon."* Their lesson was
  already booked, at a known class on a known date, and the app was the only thing that
  knew. The child's card now reads **"Trial lesson booked — TestClass · Sat 2 Aug"**.
- **The coach** could not see a trial coming at all until the child arrived at the
  poolside. The class roster now lists **trials coming up**, deliberately as a separate
  panel rather than mixed into the roster: they are a guest for one lesson, and listing
  them among the enrolled would imply a weekly student.
- **The admin** was being *prompted* to break billing. Unassigned Children listed booked
  children as needing placement, and its Assign action creates an **active enrolment** —
  which makes the child expected at **every** lesson of that class from then on. A child
  who tries one lesson and never returns would then silently stop that class's month being
  billed, because unmarked attendance blocks generation with no override.
  Children with an **upcoming** trial are now excluded from that page; children whose
  trial has **passed** remain, because that is the real decision point — did they convert?
  Assigning a child who still has a live booking now explains the consequence and requires
  a second press.
- **Converting a trial now has a home on the Trials page itself** *(implemented 2026-08-17)*.
  Each row in the *past — needs marking* list carries a **Convert to enrolled** action beside
  Cancel, so the admin no longer has to leave for Unassigned Children to place a child who
  just tried the class. It enrols them into **the class they tried**, reusing the same guarded
  insert Unassigned Children performs, and it carries the same two safeguards: the modal warns
  that enrolling makes the child **expected every week**, and if the child *also* has a still
  upcoming trial booked, the action explains that the unmarked booking will block invoicing and
  requires a second press. The converted trial lesson **stays on the needs-marking list** — it
  is still unmarked and still holds the month open; converting is not marking.

##### A trial is a booking, not attendance *(corrected 2026-07-25)*

Booking says one thing: **this child is expected at this lesson.** Nothing about the
outcome is claimed, because nothing is known yet — they may turn up, not turn up, or the
lesson may be rained off. On the day the coach marks them **exactly like any other
student**, and the status they choose is what decides whether anything is charged.

The first version of this got all three parts wrong: the *coach* created the trial, it was
recorded as an enrolment, and it wrote an attendance row saying "paid trial" in advance.
That made booking ahead impossible — which is the ordinary case, since trials are arranged
days beforehand — and asserted an outcome nobody had observed.

**A trial is not an enrolment**, and the child is expected at that one lesson only. They
appear on the coach's roster for that date and no other, and a booking can be cancelled if
the trial falls through.

**Trials are arranged by the business's admin, not the coach.** At a school they always
were; a private coach is their own admin, so nothing changes for them. The coach's job is
marking.

**A child already in a class cannot be booked for a trial**, nor one whose family holds a
prepaid package — a trial is for someone who has not started. A family who *left* can
trial again, possibly in a different class.

**An unmarked trial holds the billing month open**, like any unmarked lesson (§7.7). A
paid trial nobody recorded is lost money, so the remedy is the usual one: mark it —
including *absent* if they did not come — or cancel the booking.

##### What a paid trial costs *(implemented 2026-07-25)*

Each **class category** (§7.16) carries its own trial price, so a private trial can cost
more than a group one. A category with no price set charges the class's own lesson price,
which is what happened before this existed — so a business that never sets one is
unaffected. A *free* trial is free: it is an attendance status, not a price.

Trial prices are **effective-dated**: changing one applies from that day forward and never
re-values a lesson already taught. This matters because invoices are generated up to five
weeks after a lesson (§5.5), so a price edited on the 3rd would otherwise silently change
what was owed for the whole previous month — the same failure §7.3 and §7.7 record.

*(Known limit: two classes in the same category cannot trial at different prices. The
categories are the business's own, so the answer is usually another category.)*

*(Deliberately not built: booking a trial for someone with no class in mind. A trial is
of a specific lesson — that is what makes it markable and what gives it a price.)*

#### Claiming: the parent adopts the record, nothing is transferred

When the parent finally has an account, the child they already have **is** their child —
the attendance, the class history and any invoicing all stay attached to the same record.
Nothing is copied or migrated, which is what makes this safe.

The admin invites them by email from the Students page. The parent sets a password and
finds their child already there, with everything the coach has recorded. If the parent
already has a SwimSync account (a second child at the same school, say) the child is
simply added to it.

*(Implemented 2026-08-14: the child's NAME is the one field the coach's record often does
not hold correctly — a coach adds a placeholder ("Anya (big)") before the parent provides
the real name, and approving a claim previously never applied the parent's name, so the
roster kept the placeholder. Now at approval the admin sees the parent's typed name beside
the roster name and applies it in one step: the parent's name is **pre-selected when they
CONFIRMED** the child is theirs, and the **current name is kept when they were UNSURE** — a
blind approve must not overwrite a coach's name with an unverified guess. The admin can also
**rename any child at any time from the Students page**, the only sanctioned way to change a
name. A rename is refused if it would duplicate another active child's name + date of birth,
and it never rewrites a name on an invoice already issued (§7.7).)*

*(Deliberately not built in this release: parents finding their own child by registering
independently. That needs matching one family's details against another's, and a way to
prove the child is theirs — see `BACKLOG.md`. Until then a parent who registers on their
own may create a duplicate, which the admin resolves.)*

#### A lesson nobody can be billed for holds the month open

A billable lesson attended by a child with no parent account **cannot be invoiced** —
there is nobody to invoice. SwimSync therefore refuses to **close** that billing month
(§7.7), names the children responsible, and offers the remedy on the same screen.

Without this the month would close over those lessons and they could never be billed at
all — not even after the parent registered, because a closed month is never reopened. It
is the same silent, permanent underbill that §7.7 records twice before.

The month is released in one of two ways:

| | What it means |
|---|---|
| **Invite the parent** | The preferred one. The lessons then bill normally and nothing is lost. |
| **Record it as settled** | The money was taken outside SwimSync (a PayNow transfer straight to the business), or is not being collected. |

A settlement records **how much** and **up to which date**, so a lesson taught afterwards
still has to be decided on its own merits rather than being covered by an earlier
decision. It can be reversed, because a family who reappears two months after being
written off must be recoverable. Recording one is the **admin's** decision, not the
coach's — though a coach marking a lesson as a *paid* trial is what tells the admin there
is money to account for.

#### A lesson recorded into an already-billed month is reported, and settled *(2026-08-12)*

The hold-the-month-open net above only catches lessons that exist **when the month is
billed**. A lesson can also enter a month *after* it is sealed — a backdated enrolment for
a family that registered after billing (the marking window deliberately reopens a billed
month, §7.6), a backdated make-up or trial, or an absent→present correction (the reverse
direction auto-issues a credit note; this one is silent). The seal is final by design, so
no invoice can ever include such a lesson — and refusing to record it was considered and
rejected: a teaching record is not only a billing record.

Instead the lesson records normally and a **standing report** on the admin's Invoices
page lists every billable lesson sitting inside a sealed month that no invoice line
covers and no live settlement clears — one line per child per month, with the lesson
count and date range. The **Invoices item in the sidebar carries a count badge** whenever
lines exist, because the report only renders on a page an admin who is not billing may
not visit for weeks. Each line persists until the admin records what happened to the
money, using the same settlement instrument as above (*paid outside SwimSync* with the
amount, or *write off*); a settlement is dated at the line's **latest lesson**, so a
lesson backdated in later reports again and is decided deliberately. The report is a
database function (`unbilled_sealed_lessons`), deliberately **counts and dates only** —
pricing lives in the billing engine, and a second implementation could silently disagree
with it. There is deliberately **no bulk settle**, mirroring the modal above.

*(That money is recorded, but does not yet appear in any revenue total — SwimSync has no
revenue reporting at all today. See `BACKLOG.md`.)*

#### A trial that doesn't convert

The child is marked **inactive** (§7.14), exactly like any student who leaves. They are
**not deleted**: the coach was paid for teaching that lesson (§7.13), and deleting the
attendance would destroy the basis for a payout that may already have been made.

---

### 7.18 Parents Claiming Their Own Child *(implemented 2026-07-26)*

§7.17 covers the case where the **admin invites** the parent: the link is asserted by
someone who knows it is right, and there is nothing to get wrong. This covers the other
direction — the parent registers on their own first, opens Add Child, and types the name
of a child their coach put on the roster weeks ago.

Before this, that produced a **second student record with none of the attendance**. The
original kept holding the billing month open with nobody to bill, the duplicate
accumulated nothing, and nothing in the product mentioned either fact. The remedy was SQL.

#### What the parent sees

Add Child confirms the details back first — name, date of birth, gender — because a
child's profile **cannot be deleted**, only set inactive (§7.14), so a typo is something
the family lives with. It then checks the roster **before it creates anything**. If a
child there looks like the one being added, the parent is asked — not told:

> **Is this your child?**
> Your coach may have already added your child.
> *Ethan T. W. M. — Saturday Beginners on Sat 11 Jul*
>
> [ Yes, that's my child ] [ I'm not sure ] [ No, add them as a new child ]

- The candidate is **masked** — first name, then initials. The parent has already typed a
  matching name, so the given name is close to information they supplied; the family name
  is not. **The masking is done in the database**, so a full name never reaches the app.
- The lesson detail is deliberate: it is what a real parent can check and a guesser cannot.
- **Yes** and **I'm not sure** both send a request to the business's admin. **Neither
  attaches the child.** A wrong link would hand a stranger a family's attendance and
  billing history, and the parent's own certainty cannot price that risk.
- **No** creates the child exactly as entered. The parent may well be right.
- While a request is waiting, that parent **cannot re-add that child** — otherwise tapping
  Save again would walk straight round the question. Their home screen shows how long it
  has been waiting and what to do about it.

#### What counts as a match *(revised 2026-07-26, after live testing)*

A candidate is only ever offered when a signal already points at it, and the signals are
**ranked alternatives** — the first that fires wins, and a missing one never blocks the
next:

| Rank | Signal | Why it is where it is |
|---|---|---|
| 1 | The parent's **email** matches the address the coach recorded | Exact and unique — it is the address they sign in with |
| 2 | The parent's **phone** matches the number the coach recorded | Independent of how the name is written; compared on the last 8 digits, so `+65` is irrelevant |
| 3 | **Name + date of birth** both match | |
| 4 | **Name** alone — the given name, or two matching name parts | Last resort |

**The contact number is required when the admin books a trial or adds a student**, precisely
so ranks 1–2 do the work. A name is written many ways — "Ethan Tan Ah Beng" and "Tan Ah
Beng Ethan" are one child, as are a nickname and a full name — and matching on it is
guessing at a string. A contact detail is not a guess.

Name matching **stays** as the fallback, because every child added before this has no
contact details recorded at all, and removing it would strand exactly the records that
most need claiming.

Two refinements that stop the fallback being too eager:

- **A shared surname alone matches nothing.** In Singapore that would turn the prompt into
  a directory of the business's unclaimed children.
- **A conflicting date of birth disqualifies a name match** — two children called "Ethan
  Tan" born on different days are namesakes, not one child. A *missing* date is not a
  conflict, which matters because the coach-added child usually has none.
- **A conflicting phone does NOT disqualify it** — it only demotes it, and warns the
  admin. A phone is a fact about whoever brought the child, and a family has several: the
  mother's number taken at the poolside while the *father* registers is the ordinary case.
  Blocking there would mean a father could never claim his own child, silently.

#### What the admin sees

A **Parent Requests** page, with a count badge in the sidebar. Each request shows what the
parent typed **next to** the record on the roster, because *"are these the same child?"*
cannot be answered from either alone — plus the parent's name, email and phone, and how
many lessons the candidate already has. Approving is a two-step confirm naming both
parties, and it silently closes any competing request on that child.

Every approval can be **undone**, until the child has been invoiced to that parent — and
undoing also **reverses what the approval wrote onto the child**. Approving fills a
missing date of birth, gender or notes from what the parent typed; an undo means the admin
decided this is *not* their child, so leaving that behind would keep a stranger's data on
another family's record — and would block the real parent, whose child now collides with
it on name + date of birth.

#### Duplicates that already exist

Two records that look like the same child are flagged on the **Students** page and can be
merged. The record holding the **history** always survives; the other is deleted, with its
contents written to the audit log first. Merging **refuses** when both records have
lessons recorded, or when the duplicate already appears on an invoice — those need a
person, not a button.

*(Implemented 2026-08-14: the banner compares only rows in the **same parent situation** —
both un-claimed, or both linked to the **same** parent. A child a family has **claimed** is a
confirmed, distinct child and is never flagged against an un-claimed look-alike; that was a
false positive on shared first names in Singapore, e.g. two different "Anya"s. The case this
gives up — a coach placeholder that is really a registered family's child — is caught earlier
by the **claim flow**, which offers the un-claimed match to the parent at registration, and
now also at the moment of creation — see *Catching a duplicate before it is created* below.)*

#### Catching a duplicate before it is created *(implemented 2026-08-14)*

When the admin adds an unregistered child (Students → *Add student*), SwimSync checks the
roster first and, if a possible duplicate is found, shows it and lets the admin decide —
*Add anyway* proceeds, or they close the dialog and find the child already on the roster.
The check is **advisory**: it never blocks the add (an existing exact name + date-of-birth
collision is still refused separately), and it fails open if it cannot run.

A child is surfaced when **either** the entered parent phone matches — the child's own
contact number, or a **claiming parent's account** number — **or** the name matches the
same rule the claim flow uses. Phone matches are shown first and separately from same-name
matches, because a shared phone is the stronger signal; a name coincidence is the weaker.
Both **active and inactive** children are checked — a family that left and returns is the
commonest silent duplicate. Matches are shown with the child's **full name** and who has
claimed them (the admin is looking at their own business, so nothing is masked).

A phone match **never blocks** the add: siblings share a parent's phone, so this is a
prompt, not a refusal. The warning exists because the *Duplicates that already exist* banner
above deliberately stops comparing a claimed child against an un-claimed look-alike — so a
placeholder created for a family that is already registered would otherwise have no
automatic net once created.

### 7.19 The Parent's Contact Details *(implemented 2026-07-26)*

§7.18 makes a child's **contact number and email the two strongest signals** for matching
them to their parent's account. Nothing could change them. A child added with a wrong
number could never be matched by phone, and the remedy was SQL — while production already
held a real child whose stored number was `964`, too short for `normalize_phone()` to use
at all, with nobody told.

The admin's **Students** page gives every child a **Contact details** action. What it shows
depends on whether the child has been claimed, and the difference is the whole design.

#### Nobody has claimed this child yet — editable

The three details taken when the child was added — **the parent's name, phone and email** —
are editable. They are the parent's details recorded on the child's row; a child has no
phone or email of their own anywhere in this product.

The name is worth recording even though nothing computes with it: it answers *whose* number
this is — a parent, a grandparent, the helper who brought them. It is also the only place
that value can be set, since neither *Add a student* nor *Book a trial* asks for it.

#### The family has an account — read-only

Once a parent holds an account, their real details live on their own profile, which **they
maintain themselves** in the app under *Profile → Contact Details*. The admin sees those,
labelled as such, and is told where the family changes them. **Every** linked parent is
shown, not one: a child has two parents, and *"use the mother's number, not the father's"*
is the ordinary reason to open this screen.

They are not editable here on purpose. A second editable copy on the child's row would be a
stale duplicate of the record that actually matters — the same fault that removed
`students.age` and `classes.price_per_lesson`. It is also not the business's data to
rewrite: a parent is global to SwimSync, not owned by one school.

#### A claim is pending — locked

When a parent is currently claiming this child, the details are **shown but frozen**, with a
link to the Parent Requests queue. The claim records *why* the candidate was offered at the
moment it was raised (§7.18). Editing the number underneath it would leave the admin
approving on a reason that had quietly stopped being true — and an approved link cannot be
undone once the child has been invoiced.

#### Checking the number

A number that is not a plausible Singapore one is **flagged, never refused** — 8 digits
beginning 6 (landline), 8 or 9 (mobile), or 3 (VoIP), with `+65` optional. Too short to
match at all is called out as exactly that. The same check appears under *Add a student*
and *Book a trial*, where a phone is still **required**; only its *shape* is advisory. The
admin is usually typing the only number a family gave them, and the product's job is to say
the number looks wrong, not to withhold the record.

---

### 7.20 Make-up Classes *(implemented 2026-08-02)*

A missed lesson (rain, coach cancellation, a parent cancelling — all marked with a
non-billable status) bills nothing and is otherwise simply gone. For an ad-hoc family
that is the whole answer: pay only for lessons taken. For a **package** family it is
not — the package count sits unspent while the expiry date approaches. A make-up is the
recourse: the **business's admin** books an enrolled child into **one lesson of another
class in the same category**, same coach or a different one.

**The model is a guest pass, deliberately.** A make-up booking is not tied to a specific
missed lesson and there is no miss-redemption ledger — the admin decides who deserves
one. It is a **booking, never an enrolment** (`makeup_bookings`, the `trial_bookings`
shape): the child is expected at that ONE lesson, appears on the host coach's roster and
marking screen for that date with a *Make-up* chip, and an **unmarked make-up holds the
billing month open** exactly as a trial does. The trial refusals invert: a trial child
must not be enrolled; a make-up child must be (active, actively enrolled).

**Also bookable from the Attendance page** *(implemented 2026-08-17)*: an absent or
cancelled row carries a **Book make-up** action, so the natural moment — looking at the miss
— is an entry point. The row already knows the child and the class they missed, so that class
is the home the make-up replaces (no home-class question), and the modal asks only for the
host class and date; the booking still lands on `makeup_bookings` and shows on the Make-ups
page, which stays the primary home (a booking you cannot see is forgotten). The action shows
**only on the child's own enrolled class** — a guest row (a trial, or another child's make-up)
carries the *host* class, not an enrolment, so seeding a make-up from it would be refused.

**Booked by the admin, from the Make-ups page** (the Trials mirror, including its
"Past — needs marking" list). The form is child-first — one search box finds the child
by **their name or their class's name** (a dropdown stops working at a few dozen
children; the admin often knows the class, not the spelling — and the search matches
**any** of their classes, not just the first), then the child's home class decides the
category, and the class list offers same-category classes *minus every class the child
is in*. **Which class is "home" is asked, not guessed, once a child has more than one**
*(implemented 2026-08-11)*: it is snapshotted onto the booking and therefore decides both
the price and the package category, so a derived answer would have been an arbitrary one.
A child with a single class is not asked. The
date list is the host's real lesson days plus any admin-scheduled off-schedule session
(`book_makeup()` accepts those — an existing session proves the lesson is real). Every
refusal lives in the RPC, not the screen: unenrolled or inactive child, inactive host
class, cross-category, **any class the child is already in** ("use Extra lesson instead" —
which is how a **private-category** make-up is done, since there is no other private class
to guest into), a home class the child is not actually in, a missing home class where the
child has several, a date the class doesn't meet, a date inside an already-billed month, a
duplicate live slot.
**The refusal is EVERY class the child attends, not merely the one named as home**
*(2026-08-11)* — and that is not a billing rule. Enrolment wins over a stray booking
(below), so booking a make-up into the child's *other* class prices perfectly correctly as
a member; what it does is **silently void the make-up**, because the child attends the
lesson they were already attending, receives nothing replacing the one they missed, and the
Make-ups page reports the booking as arranged. A child who is already in every class of
their kind therefore has no make-up host at all, and the booking form says so and points at
Extra lesson — see `BACKLOG.md` for the gap that reveals. Cancelling is soft, and a cancelled slot can be re-booked.

**What it costs follows who the family is, with two snapshots on the booking (§7.45):**

- A **package** family's attended make-up **draws from the package** at its locked rate —
  the engine matches the booking's snapshotted *category*, so re-tagging the host class
  later cannot detach the draw. This is the whole point: the count clears before expiry.
- An **ad-hoc** family pays the child's **own (home) class rate**, effective-dated on the
  make-up's own date — the make-up replaces their missed lesson, so their usual price
  applies, not the host's. The booking snapshots the *home class id* (not the rate
  number), so a later rate correction still flows through and a deactivated home class
  still prices.
- The invoice line carries the host class title suffixed **"(make-up)"**, so a
  host-class line at a home-class price explains itself.
- A guest marked absent (or rained off) bills nothing, as ever. A child enrolled in the
  host class on that date prices as a member — enrolment wins over a stray booking.

**Who sees it:** the parent's home card announces *"Make-up lesson booked — class ·
date"* **in addition to** the weekly class block; the host coach's roster shows a
*"Make-ups coming up"* panel and their class counts never treat the guest as a member;
the admin's invoice pre-flight counts the booking exactly as the engine's gate does.
Booking-level visibility follows the trials rule (the business, the host class's coach,
the child's own parent) — and `coach_serves_student()` was widened so a host coach can
read a guest's *name* (which also closed the same latent gap for trial guests).

### 7.21 Fee-Free Payment Collection *(Phase 1 implemented 2026-08-02)*

SwimSync never sits in the money path: a parent pays the business's own PayNow account
directly, and no gateway takes a percentage. What the product supplies is
**identification** — knowing who paid for what — built from three pieces
(design record: `docs/design/PAYMENT_COLLECTION_DESIGN.md`):

- **Every invoice carries a reference number** — `INV-YYYY-NNNN`, numbered within the
  business (same per-tenant scheme and volume-leak rationale as credit notes, §9.17),
  the year taken from the invoice's **own billing month**, never the clock. Assigned by
  a database trigger on insert; the billing engine is untouched. References and tokens
  are pinned — not client-writable.
  *(implemented 2026-08-02)* **The reference is what the parent app shows too**, on both
  the invoice list and the invoice detail. Those two screens printed a fragment of the
  row's UUID (`Invoice #3F2B8C1A`) while the QR, the WhatsApp reminder, the public page
  and the parent's own bank statement all carried `INV-2026-0001` — so a parent comparing
  the app against their payment saw two different numbers for one invoice. One shared
  helper renders it, falling back to the old fragment only for rows that predate the
  trigger.
- **A dynamic PayNow QR per invoice.** The business's admin enters a **UEN or mobile
  number** once (Invoices page → *PayNow details*; UEN preferred when both — a
  corporate account is guaranteed to receive the reference on its statement, a personal
  mobile proxy is best-effort and the copy never promises it). Every outstanding
  invoice then renders an EMVCo QR with the **amount and reference locked in**,
  computed client-side (`SwimSyncApp/lib/paynow.ts`, pinned to an independent
  generator's test vector). The generator **throws on dubious input** rather than
  encode a wrong-but-scannable QR.
  *(implemented 2026-08-09)* **A package request now gets the same QR** — see §7.16 —
  so "the static image is the fallback for package requests" is no longer true. What
  the static image is now: the fallback for **native builds** (no canvas) and for a
  business whose stored PayNow ID cannot be encoded. The coach-Settings upload that
  writes it is **collapsed behind a disclosure but never removed**, and the reason is
  the failure it prevents: `normalizeSgPhone` only strips non-digits and `checkSgPhone`
  never blocks, so a nine-digit mobile saves cleanly, `selectPayNowProxy` calls the
  business *configured*, the generator throws, and a business whose upload had been
  hidden would have **no way to be paid at all**.
  *(implemented 2026-08-09)* **The no-QR state is payable rather than a dead end.**
  When neither QR can be produced but the business has a PayNow ID, the parent's screen
  shows that **ID, the amount and the reference as selectable text** under *"Transfer to
  this PayNow ID"* — the flow every SwimSync parent used before 2026-08-02. A business
  that has genuinely configured nothing gets distinct copy naming the fix (*"This
  business hasn't set up PayNow yet"*), replacing *"QR not uploaded yet. Contact your
  coach directly"*, which sent the parent to chase someone who might not be able to fix
  it.
- **A tokenized public invoice page** — `swimsync.sg/invoice/<128-bit token>`, no
  login, served by the `public-invoice` Edge Function (deliberately not an anon RPC —
  §7.39). Shows business name, month, child **first names only**, amount, reference
  and the QR; a **Save QR image** button with a scan-from-gallery instruction covers
  the you-can't-scan-your-own-screen case; amount and reference are selectable text.
  Every failure mode returns one identical not-found response. The page is where the
  WhatsApp reminder link lands.
- **WhatsApp reminders, by click-to-chat** *(Phase 2, implemented 2026-08-02)*. Every
  outstanding invoice row has a **WhatsApp** button: it opens a pre-filled chat
  (wa.me — free, ToS-compliant; the fixed message carries business name, children,
  month, amount, reference and the tokenized link) and **the admin presses Send** —
  that press is WhatsApp's anti-spam boundary, and the product never automates past it
  (unofficial bridges risk banning the coach's own number; one-click bulk is the
  Cloud API backlog item). A **WhatsApp reminders** queue works down every unpaid
  invoice: never-contacted parents first, then oldest stamp; each click opens the next
  chat. The stamp deliberately reads **"chat opened"**, never "reminded" — opening a
  chat is not proof a message was sent, so rows never leave the queue until paid. A
  parent with no usable phone number is a **visible "no number" state** (with the
  advisory from `lib/sgPhone.ts`), never a broken link. A **Link** button copies the
  invoice's public URL for any other channel.

- **"I've paid" → confirm** *(Phase 3, implemented 2026-08-02; the in-app LIST surface
  added 2026-08-08)*. The parent taps **I've paid** — on the tokenized page (sessionless,
  via the edge function), or in the app on **either the invoice list or the invoice
  detail** (`claim_invoice_paid()` RPC) — which records a **timestamped
  claim, never a status change**; claiming twice keeps the first timestamp. The admin
  sees a *"parent says paid"* badge and a **Claimed** filter (outstanding + claimed —
  the rows to check against the bank first). Confirmation goes through **one RPC for
  every client**, `confirm_invoice_paid()` — gate identical to the `invoices_update`
  policy — which writes `status`/`paid_at`/`paid_marked_by` **and** the
  `payment_records` audit row atomically. (Before this, the admin panel's mark-paid
  wrote no audit fields at all and the coach app wrote them non-atomically; the direct
  update paths are deleted.)

Parents with accounts see the same dynamic QR on the in-app PayNow screen (web;
native keeps the static image).

### 7.22 Admin Calendar *(implemented 2026-08-19)*

SwimSync shall show the tenant admin **every lesson of every coach** on one calendar, so the
admin can see at a glance which class at a given time has a free slot for a make-up.

- **Admin panel → Calendar** (`/calendar`): **Day / Week / Month / Agenda** views, **Today**,
  ‹ ›, a **Location** filter (the business's managed locations, §7.24) and a **Coach** filter
  (who *teaches* the lesson, i.e. the substitute when there is one).
- **What a lesson is.** The weekday pattern of every class ∪ every existing `lesson_sessions`
  row in the range (so extra lessons show and future lessons show before anyone marks them), minus
  dates on/after a retired class's SGT retirement date. **The calendar never creates a lesson
  row** — it is read-only; writing happens on the lesson page (§7.6).
- **The card** carries the class **colour** (§7.3), the class title, the **coach** (a substitute
  is named and marked **(Sub)** in red — the money axis, never `classes.coach_id`), and the count
  **`enrolled+guests/max`** following the `2+1` roster convention: enrolled on that date by
  enrolment span, plus uncancelled trial and make-up guests booked into that lesson, over the
  class's capacity (its own, else the category default; no suffix when unlimited). *(2026-08-20)*
  This same count is now the **guard's** number — the figure the booking/enrolment refusal reports
  (§7.3). **The count is the billing gate's expected set by construction** — it is computed by the same
  `expectedStudentsOn` the invoice engine uses, so a slot the calendar calls free is one the gate
  agrees is free. A full class reads red + **FULL**. Time is not printed on the grid card (the
  axis says it); it is on the agenda card and in the tooltip.
- **State on the card:** dashed border = attendance not fully marked (past lesson, or today's
  after it ended), ✓ = fully marked, faded + *Holiday* = voided for a public holiday, *extra* =
  off-schedule.
- **Hover** shows the roster — every expected child with their attendance glyph (✓ present,
  ✗ absent, ~ cancelled, T trial, H holiday, ○ unmarked) and *trial* / *make-up* chips. **Click
  pins** the tooltip (keyboard/touch reachable; Escape unpins); **double-click** (or Enter) opens
  the lesson page `/lessons/[classId]/[date]`.
- **Day and week** are a time grid (30-minute rows) that scrolls **both ways**: concurrent lessons
  sit side by side in lanes of a minimum width rather than being squeezed, and the **time column
  and day header stay fixed** while scrolling. **Month** shows up to three chips per day and
  `+N more` / the day number jumps to that day. **Agenda** lists seven days with each lesson's
  roster beside it. Weeks start on **Monday**.
- The view, date and filters live in the URL, so refresh/back keep position; **Today** is
  computed when pressed, never stored (§7.95).
- **Double-click → the lesson page** (§7.6 *The admin marks attendance on the lesson page*),
  where attendance, the substitute and guest bookings are changed. The **Lessons** page
  (top-level, beside Calendar) is the list form of the same data, with a *Needs marking* mode. The
  read-only attendance audit lives under **Log → Attendance Log** (with Change History).

### 7.23 Owner-only Accounting *(implemented 2026-08-23)*

SwimSync tracked money **in** (invoices) and money **out** (coach wages, §7.13) but never
summed either into "what did the business make this month?". The Accounting page
(Admin → Billing → **Accounting**) is that single answer, for **one closed month at a time**.

**Owner-only.** The figures are visible to the business **owner**, not to co-admins — it is
the first concrete thing a co-admin should not see. The gate is `is_tenant_owner()`; no
capability model. The nav link shows for every admin (like Admins), but the page shows a
co-admin an *Owner only* notice, and the two RPCs (`accounting_months`,
`accounting_summary`) **refuse a non-owner server-side** — the page's hiding is honesty, the
server is the boundary.

**Accrual basis** (decided 2026-08-16): revenue is what was *issued for* the month, not cash
received. Four figures per month:

- **Revenue** = each invoice's `net_amount` **minus** its `balance_adjustment` (a prior
  month's debit folded onto this month's invoice is not this month's earning), **plus** live
  `paid_outside` settlements covering the month. A **breakdown** (gross − packages − credit −
  prior-month debit = invoiced; + settlements = revenue) makes any figure auditable.
- **Outstanding** = the month's still-unpaid invoices (raw `net_amount`, the same definition
  the Invoices page uses); it legitimately changes over time as invoices get paid.
- **Wages** = accrued cost of lessons **taught** that month (a period's own payout items plus
  corrections reallocated to it by `original_period`).
- **Net** = Revenue − Wages.

**Never a partial figure.** Only **closed** (billing-sealed) months are offered, and the
summary RPC refuses an unsealed month outright. Wages are **withheld** (shown as *Run coach
payouts to see*, not a number) whenever a rated coach has no payout run for the month —
because a partial wage sum would silently overstate Net. A month whose payouts are still
**draft** shows the figure with a *may change* note. A business with no rated coach (the
private-coach case) shows Wages S$0 and Net = Revenue.

---

### 7.24 Locations *(implemented 2026-08-24)*

A business's locations are a **managed entity**, not free text on each class. Admin →
**Locations** is a CRUD list (like Levels §7.15): each location has a **name** (unique per
business), an optional **address**, optional **notes** (parking, which gate), and a sort
order. Every class is set to one location from this list on the class form, rather than a
typist re-inventing "Clementi" vs "Clementi SC".

**Where it shows.** The admin **Classes** list, **Calendar** and **Lessons** all filter by
location; the **coach app** filters their classes and week by location (a chip row that
appears only when they teach at more than one). A **parent** sees the location **name,
address and notes** on their child's detail — so they know where to go — but does not filter
(their classes are almost always at one place).

**Delete means archive.** A location an **active** class still uses cannot be removed (the
database refuses it, not just the page); removing one only **retired** classes hold
**archives** it — gone from the list and every picker, but kept so those retired classes keep
a valid location and reactivating one never breaks. An archived name can be reused.

**Required.** Every class has a location (there is no "unassigned"), so a business creates at
least one before its first class. Migrated from the previous free-text `location_name`, which
is retained as an internal mirror during roll-out.

---

## 8. Non-Functional Requirements

### 8.1 Platform

- Mobile app for iOS and Android (SwimSync mobile)
- Simple web admin panel (SwimSync Admin)
- English only for MVP

### 8.2 Security

- Role-based access control is mandatory across all SwimSync features
- Parents must only see their own linked children and related invoices/credit notes
- Coaches must only see their own classes and assigned students
- Superadmin has full operational access
- User data must be stored securely with secure password handling
- Sensitive actions (attendance edits, credit notes, payment marking) should be logged

### 8.3 Performance

- Attendance screen should load quickly enough for real-time use before or after class
- Invoice and credit note generation should complete reliably on the month's scheduled run day (§5.5)
- Parent app should show current attendance and invoice status without noticeable delay under MVP scale

### 8.4 Reliability

- Attendance data must not be lost after being submitted
- Billing must be reproducible from attendance records
- Credit notes must be immutable and auditable
- Payment status updates and assignment changes must persist immediately

---

## 9. Data Model

Below is the detailed SwimSync MVP entity structure with field-level definitions.

### 9.1 Profiles

*Core user account for all SwimSync user types.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **email** | String | Yes | Unique login email |
| **password_hash** | String | Yes | Hashed password |
| **role** | Enum | Yes | *(implemented)* parent \| coach \| **tenant_admin** \| **platform_admin**. `superadmin` split in two (§4.3) and is retired by data, not by DDL |
| **tenant_id** | UUID (FK) | No | *(implemented)* The business this account belongs to. **NULL for parents** (global — a family may deal with several businesses) and for the platform admin (cross-tenant) |
| **full_name** | String | Yes | Display name |
| **phone** | String | No | Contact number |
| **is_active** | Boolean | Yes | Account active flag (default true) |
| **created_at** | Timestamp | Yes | Account creation timestamp |
| **updated_at** | Timestamp | Yes | Last update timestamp |

### 9.2 Coaches

*Coach-specific data extending Profiles.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **profile_id** | UUID (FK) | Yes | References Profiles.id |
| ~~**paynow_qr_url**~~ | ~~String~~ | — | *(implemented — **removed** 2026-07-19)* The payee is the **business's**, not the coach's: a school has one bank account, so an individual coach's QR would send the payment to the wrong person (§7.10). Copied to **`tenants.paynow_qr_url`** by the tenancy backfill (`20260718000600`) and dropped once the readers moved (`20260719000300`) |
| **bio** | Text | No | Optional coach bio or notes |
| **created_at** | Timestamp | Yes | Record creation timestamp |

### 9.3 Parents

*Parent-specific data extending Profiles.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **profile_id** | UUID (FK) | Yes | References Profiles.id |
| ~~**credit_balance**~~ | ~~Decimal~~ | — | *(implemented — moved)* Balances live on `parent_tenant_balances`, per (parent, business): credit never crosses businesses (§5.6) |
| **address** | String | No | *(implemented 2026-07-19)* Home address, free text. On `parents` rather than `profiles` — that table is shared with coaches and admins, and a home address is a parent-shaped fact |
| **postal_code** | String | No | *(implemented 2026-07-19)* Singapore 6-digit postal code. **TEXT, never an integer** — leading zeros are significant (`018956`) |
| **created_at** | Timestamp | Yes | Record creation timestamp |

### 9.4 Students

*Child/student profiles created by parents.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **full_name** | String | Yes | Child's full name |
| **date_of_birth** | Date | No | Date of birth |
| ~~**age**~~ | ~~Integer~~ | — | *(implemented — **removed** 2026-07-19)* Age is **derived from `date_of_birth` at read time** (`ageFromDob` in `lib/lessonDates.ts`), never stored. A stored integer beside the date it comes from is a second source of truth that goes stale the day after it is written — the same disease effective-dated pricing removed from money. Had zero readers when dropped |
| **gender** | Enum | No | male \| female \| other |
| ~~**swimming_ability**~~ | ~~Enum~~ | — | *(implemented — **removed** 2026-07-19)* Superseded by `level_id`. The fixed beginner/intermediate/advanced enum was never populated and was never the right shape — a level ladder is a business's own vocabulary. Leaving a permanently-NULL column beside a real one guarantees someone eventually writes to the wrong one |
| **level_id** | UUID (FK) | No | *(implemented)* The child's rung on their business's ladder (`tenant_levels`). Set by the business's admin; coaches have no write path to `students` by design. `ON DELETE SET NULL` — retiring a level unlevels students rather than deleting them |
| **notes** | Text | No | Optional notes from parent |
| **assignment_status** | Enum | Yes | *(implemented)* unassigned \| assigned (default unassigned). The `inactive` value was **removed** — activity is a separate axis, see §7.14 |
| **is_active** | Boolean | Yes | Still a customer of their business? (default true) — §7.14 |
| **inactivated_at** | Timestamp | No | *(implemented)* When they stopped attending. NULL while active, and NULL for children already inactive before this was added — that date was never recorded and is not guessable |
| **created_by** | UUID (FK) | No | References Profiles.id; defaults to the creating user. Lets a parent read the profile they just created before the ParentStudents link exists (RLS) |
| **created_at** | Timestamp | Yes | Record creation timestamp |
| **updated_at** | Timestamp | Yes | Last update timestamp |

### 9.5 ParentStudents

*Many-to-many link between parents and students.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **parent_id** | UUID (FK) | Yes | References Parents.id |
| **student_id** | UUID (FK) | Yes | References Students.id |
| **created_at** | Timestamp | Yes | Link creation timestamp |

### 9.6 Classes

*Recurring weekly class definitions.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **coach_id** | UUID (FK) | Yes | References Coaches.id |
| **title** | String | Yes | Class name/title |
| **day_of_week** | Enum | Yes | monday–sunday |
| **start_time** | Time | Yes | Lesson start time |
| **end_time** | Time | Yes | Lesson end time |
| **location_name** | String | Yes | Pool or venue name |
| **location_address** | String | No | Optional full address |
| **price_per_lesson** | Decimal | Yes | Rate charged per lesson |
| **is_active** | Boolean | Yes | Active flag (default true) |
| **capacity** | Smallint | No | *(2026-08-19; enforced 2026-08-20)* Max students for this class; NULL = the category's `default_capacity` (NULL there = unlimited). A hard limit — a booking is refused when the lesson's expected set reaches it, an enrolment when the active roster does (§7.3) |
| **colour** | String | No | *(2026-08-19)* Calendar palette key (`sky`, `rose`, …), never hex; NULL = neutral |
| **created_at** | Timestamp | Yes | Record creation timestamp |
| **updated_at** | Timestamp | Yes | Last update timestamp |

### 9.7 StudentClassEnrolments

*Links a student to one active class.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **student_id** | UUID (FK) | Yes | References Students.id (unique active constraint) |
| **class_id** | UUID (FK) | Yes | References Classes.id |
| **enrolled_at** | Timestamp | Yes | Enrolment date |
| **unenrolled_at** | Timestamp | No | Unenrolment date (null = active) |
| **is_active** | Boolean | Yes | Active enrolment flag |

### 9.8 LessonSessions

*Individual dated lesson instances.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **class_id** | UUID (FK) | Yes | References Classes.id |
| **session_date** | Date | Yes | Calendar date of lesson |
| **start_time** | Time | Yes | Inherited from class |
| **end_time** | Time | Yes | Inherited from class |
| **status** | Enum | Yes | scheduled \| completed \| cancelled |
| **created_at** | Timestamp | Yes | Record creation timestamp |

### 9.9 Attendance

*Per-student attendance per lesson session.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **lesson_session_id** | UUID (FK) | Yes | References LessonSessions.id |
| **student_id** | UUID (FK) | Yes | References Students.id |
| **status** | Enum | Yes | present \| absent \| cancelled_rain \| cancelled_coach \| trial_paid \| trial_free |
| **marked_by** | UUID (FK) | Yes | References Profiles.id (who marked it) |
| **marked_at** | Timestamp | Yes | When attendance was recorded |
| **last_edited_by** | UUID (FK) | No | References Profiles.id (if edited) |
| **last_edited_at** | Timestamp | No | When attendance was last edited |
| **edit_reason** | Text | No | Optional reason for attendance edit |

### 9.10 Invoices

*Monthly invoice header per parent.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **parent_id** | UUID (FK) | Yes | References Parents.id |
| **billing_month** | String | Yes | YYYY-MM format (e.g. 2026-01) |
| **gross_amount** | Decimal | Yes | Total before credit deductions |
| **credit_applied** | Decimal | Yes | Credit note amount deducted (default 0.00) |
| **net_amount** | Decimal | Yes | Amount payable (gross minus credit) |
| **status** | Enum | Yes | outstanding \| paid |
| **generated_at** | Timestamp | Yes | When invoice was generated |
| **paid_at** | Timestamp | No | When marked as paid |
| **paid_marked_by** | UUID (FK) | No | References Profiles.id |

### 9.11 InvoiceItems

*Individual lesson-level billed line items.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **invoice_id** | UUID (FK) | Yes | References Invoices.id |
| **student_id** | UUID (FK) | Yes | References Students.id |
| **lesson_session_id** | UUID (FK) | Yes | References LessonSessions.id |
| **attendance_status** | Enum | Yes | Billable status at time of invoicing |
| **amount** | Decimal | Yes | Lesson rate charged |
| **class_title** | String | Yes | Snapshot of class name |
| **session_date** | Date | Yes | Snapshot of lesson date |

### 9.12 CreditNotes

*Credit notes issued for post-invoice attendance corrections.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **reference_number** | String | Yes | Unique ref (e.g. CN-2026-0001) |
| **parent_id** | UUID (FK) | Yes | References Parents.id |
| **student_id** | UUID (FK) | Yes | References Students.id |
| **invoice_id** | UUID (FK) | Yes | References original Invoices.id |
| **invoice_item_id** | UUID (FK) | Yes | References original InvoiceItems.id |
| **lesson_session_id** | UUID (FK) | Yes | References LessonSessions.id |
| **amount** | Decimal | Yes | Credit amount (class rate of corrected lesson) |
| **original_status** | Enum | Yes | Attendance status before correction |
| **corrected_status** | Enum | Yes | Attendance status after correction |
| **reason** | Text | No | Optional reason for correction |
| **issued_at** | Timestamp | Yes | When credit note was created |
| **applied_to_invoice_id** | UUID (FK) | No | References Invoices.id when applied |
| **applied_at** | Timestamp | No | When credit was applied to an invoice |

### 9.13 PaymentRecords

*Manual paid confirmation records.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **invoice_id** | UUID (FK) | Yes | References Invoices.id |
| **marked_by** | UUID (FK) | Yes | References Profiles.id |
| **paid_at** | Timestamp | Yes | When payment was confirmed |
| **notes** | Text | No | Optional payment notes |

### 9.14 AuditLog

*System audit trail for sensitive actions.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **actor_id** | UUID (FK) | Yes | References Profiles.id |
| **action** | String | Yes | Action performed (e.g. attendance_edit, payment_marked) |
| **entity_type** | String | Yes | Entity affected (e.g. Attendance, Invoice) |
| **entity_id** | UUID | Yes | ID of the affected entity |
| **old_value** | JSON | No | Previous state snapshot |
| **new_value** | JSON | No | New state snapshot |
| **created_at** | Timestamp | Yes | When action occurred |

### 9.15 BillingPeriods *(implemented)*

*Tracks which billing months have been fully processed so the daily automatic run is idempotent. **Per business** — see §7.7.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **tenant_id** | UUID (FK) | Yes | *(implemented)* Composite primary key with `billing_month`. A single global key let the first business to finish a month close it for **every** other tenant, who then silently billed nothing |
| **billing_month** | String (YYYY-MM) | Yes | Composite primary key with `tenant_id` |
| **completed_at** | Timestamp | Yes | When the month was sealed |
| **invoices_issued** | Integer | Yes | Count issued for the month |
| **notes** | Text | No | Summary note |

### 9.16 AppSettings *(implemented)*

*Key/value store for **platform-level** switches. **(implemented — narrowed)** The billing
schedule (`auto_invoice_enabled`, `invoice_run_day`) moved onto `tenants` when generation
became per-business; leaving it here would have meant one school changing its run day
changing everyone's. Readable only by the platform admin.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **key** | String | Yes | Primary key (e.g. `auto_invoice_enabled`) |
| **value** | JSON | Yes | Setting value |
| **updated_at** | Timestamp | Yes | Last update timestamp |

### 9.17 CreditApplications *(implemented)*

*Allocation ledger recording each draw of a credit note against an invoice.
Lets a single credit note be applied partially and across multiple invoices/
months so the note ledger always reconciles with `invoices.credit_applied`
(fixes the earlier full-consumption drift). `credit_notes.status` is derived
from this: `available` until the note is fully drawn, then `applied`.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **credit_note_id** | UUID (FK) | Yes | References CreditNotes.id |
| **invoice_id** | UUID (FK) | Yes | References Invoices.id (the invoice this draw was applied to) |
| **amount** | Decimal | Yes | Amount of the note consumed by this application (> 0) |
| **applied_at** | Timestamp | Yes | When this draw occurred |

### 9.18 Tenants *(implemented)*

*A **business**. A private coach is a tenant of one, where the same person is admin and coach.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **slug** | String | Yes | Unique, stable identifier |
| **display_name** | String | Yes | The business's name. Appears on invoices and invoice emails |
| **kind** | Enum | Yes | private \| school. **Onboarding copy and future pricing only — never appears in a permission rule** |
| **logo_url** | String | No | Shown on invoice emails |
| **paynow_qr_url** | String | No | The business's payee (§7.10) |
| **join_code** | String | Yes | Unique. What a parent types to join (§5.1). Regenerable |
| **auto_invoice_enabled** | Boolean | Yes | Per-business, was global |
| **invoice_run_day** | Integer | Yes | Per-business, was global |
| **rain_pays_coach** | Boolean | Yes | Wage policy default (§7.13) |
| **wage_run_day** | Integer | Yes | Pay day, independent of `invoice_run_day` |
| **credit_note_counter** | Integer | Yes | Per-business credit-note numbering, so a shared sequence cannot leak one business's volume to another |

### 9.19 ParentTenants *(implemented)*

*Which businesses a parent has joined, via a join code. Drives the add-child picker — a
parent only ever chooses among businesses they actually deal with, never a directory.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **parent_id** | UUID (FK) | Yes | References Parents.id |
| **tenant_id** | UUID (FK) | Yes | References Tenants.id |
| **joined_at** | Timestamp | Yes | When the code was redeemed |
| **is_active** | Boolean | Yes | *(implemented)* Still a customer of THIS business? (default true). Per-business on purpose — parents are global, so one business must not be able to switch a family off at another (§7.14) |
| **inactivated_at** | Timestamp | No | *(implemented)* When they stopped being a customer here |

### 9.20 ParentTenantBalances *(implemented)*

*Credit, scoped to the business that owes it. Replaces the pooled `parents.credit_balance`
(§5.6) — credit must never cross businesses.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **parent_id** | UUID (FK) | Yes | Composite primary key with tenant_id |
| **tenant_id** | UUID (FK) | Yes | |
| **credit_balance** | Decimal | Yes | Spendable only at this business |

### 9.21 ClassRates *(implemented)*

*A class's commercial terms, **effective-dated**: what the parent pays for a lesson, and
which coach is paid for it. One row is a complete snapshot from a date onward — changing
either writes a new row carrying both (§7.3). This is what makes a lesson priced and
attributed by **its own date** rather than by whatever the class says today (§7.7, §7.13).*

*`Classes.price_per_lesson` remains as a **display** copy, kept in step automatically. It is
**not** the billing source — writing to it changes nothing about what anyone is charged.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **class_id** | UUID (FK) | Yes | References Classes.id |
| **price_per_lesson** | Decimal | Yes | What the parent is charged per lesson |
| **paid_coach_id** | UUID (FK) | Yes | Which coach earns this lesson |
| **effective_from** | Date | Yes | Unique per class; the row in force on a date is the latest one on or before it |

*Every class is guaranteed terms from the beginning of time, so no lesson can fall before
its class's earliest row — attendance can be marked a month late, so a lesson legitimately
predates the record that created its class. A lesson with no terms in force **fails the
run** rather than defaulting to zero.*

### 9.22 CoachRates / ClassRateOverrides *(implemented)*

*What a coach is paid, **effective-dated**. A raise is a new row, never an edit — see §7.13.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **coach_id** | UUID (FK) | Yes | References Coaches.id |
| **amount** | Decimal | Yes | Per `unit_minutes` of teaching |
| **unit_minutes** | Integer | Yes | Default 60 |
| **effective_from** | Date | Yes | A lesson uses the latest rate on/before its own date |

`class_rate_overrides` mirrors this per class with a `flat_amount` that replaces the
duration calculation. `session_pay_overrides` records a single session's pay/don't-pay
decision.

### 9.23 CoachPayouts / CoachPayoutItems *(implemented)*

*What a coach is owed for a month. Draft until marked paid, then frozen (§7.13).*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **tenant_id** | UUID (FK) | Yes | Unique with coach_id + period_month |
| **coach_id** | UUID (FK) | Yes | |
| **period_month** | String (YYYY-MM) | Yes | Calendar month |
| **gross_amount** | Decimal | Yes | |
| **status** | Enum | Yes | draft \| paid |
| **paid_at / paid_marked_by** | Timestamp / UUID | No | Set on freeze |

Items carry the lesson, a `basis` (duration or flat) explaining how the amount arose,
and — for a correction to an already-paid month — `is_adjustment` with the
`original_period` it belongs to.

**Invariants maintained by the invoice engine:**
- `SUM(credit_applications.amount WHERE invoice_id = X) = invoices.credit_applied` for X
- `SUM(credit_applications.amount WHERE credit_note_id = N) ≤ credit_notes.amount` for N
- `parent_tenant_balances.credit_balance = SUM of remaining across that parent's notes **from that business**` *(was `parents.credit_balance`, pooled per parent, before §5.6)*

---

## 10. Invoice Calculation Logic

For each parent account, SwimSync performs the following:

1. Find all children linked to the parent
2. Find all attendance records for those children in the target month
3. Include only: **Present** and **Paid Trial**
4. Exclude: *Absent, Cancelled due to rain, Cancelled by coach, Free Trial*
5. For each billable lesson, use the class's applicable rate
6. Sum all billable items to determine gross amount
7. Check for outstanding credit note balance on the parent's account
8. Deduct credit balance from gross amount to determine **net payable amount**
9. Generate one invoice for that parent for that month
10. Mark invoice as **Outstanding** by default (or **Paid** if credit fully covers the net amount)
11. Update the parent's remaining credit balance

---

## 11. Edge Cases

### 11.1 Last Day of Month Lesson

A lesson conducted on the last day of the month must still be included in that month's invoice. Therefore, SwimSync never generates a month's invoices until that month has ended — automatically from the configured run day of the following month (default the 7th), which also allows time for the final lessons to be marked (§5.5).

### 11.2 Parent Self-Registers Before Assignment

A parent may register on SwimSync and create child profiles before any class assignment is done. The app should show an unassigned state, not an error.

### 11.3 Parent Has Children Under Multiple Coaches

A parent should see all linked children under one SwimSync account. Each coach should still only see students assigned to that coach's classes.

### 11.4 Trial Lesson

If Trial is chosen, the coach must classify it as Paid Trial or Free Trial before saving or before invoice generation can occur.

### 11.5 Student Changes Class in Future

For MVP, each student may only have one active class enrolment at a time in SwimSync. Historical records must remain intact.

### 11.6 Attendance Correction After Invoice Generation

If a coach changes attendance from a billable to non-billable status after the invoice has been generated, SwimSync **must not modify or delete the original invoice**. Instead, a credit note is issued and applied to the next billing cycle.

- The original invoice remains as a historical record
- The credit note links back to the specific invoice and lesson
- If a parent has already paid the original invoice, the credit carries forward to the next month

### 11.7 Credit Note Exceeds Next Invoice

If a parent's accumulated credit balance exceeds the net amount of the next invoice, the invoice is marked as Paid and the remaining credit carries forward.

### 11.8 Student Leaves With Outstanding Credit

If a student is unenrolled and the parent has an outstanding credit balance with no future invoices expected, the credit remains on record. Resolution (e.g. refund) is handled manually outside SwimSync for MVP.

---

## 12. UI / UX Notes

### Parent Experience

The SwimSync parent onboarding should be simple:

1. Create account
2. Add child/children
3. Wait for assignment
4. View class/attendance/invoice once assigned

**Key information for parents:** child profile, assignment status, class info, attendance history, outstanding amount, credit balance, payment status, PayNow QR.

### Coach Experience

The SwimSync coach workflow should prioritize speed and simplicity. The most frequent action is attendance marking, so that screen should require minimal taps.

### Superadmin Experience

The SwimSync superadmin web panel should prioritize operational visibility. The **Unassigned Children** section should be easy to scan and act on.

### Payment Status Display

| Status | Visual Treatment |
|--------|-----------------|
| **Outstanding** | Red badge or label |
| **Paid** | Green badge or label |
| **Credit Applied** | Blue badge or label |

---

## 13. Suggested Tech Stack

The following technology stack is recommended for SwimSync based on the requirements of a mobile-first app with a web admin panel, relational data model, role-based access control, file storage (PayNow QR), and real-time data needs.

### 13.1 Mobile App

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Framework** | React Native (Expo) | Single codebase for iOS + Android; Expo simplifies build/deploy |
| **Navigation** | Expo Router | File-based routing, deep linking support, native feel |
| **State Management** | React Context + Zustand | Lightweight, sufficient for MVP complexity |
| **UI Components** | Tamagui or NativeWind | Cross-platform styling with good performance |

### 13.2 Web Admin Panel

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Framework** | Next.js (App Router) | React-based, server-side rendering, fast development |
| **UI Components** | shadcn/ui + Tailwind CSS | Professional admin components, highly customizable |
| **Tables / Data** | TanStack Table | Sorting, filtering, pagination for admin views |

### 13.3 Backend & Database

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Backend-as-a-Service** | Supabase | PostgreSQL, Auth, Storage, Edge Functions, RLS — all-in-one |
| **Database** | PostgreSQL (Supabase) | Relational model ideal for SwimSync's strongly linked entities |
| **Authentication** | Supabase Auth | Email/password, role-based; integrates with RLS |
| **File Storage** | Supabase Storage | PayNow QR image uploads |
| **Serverless Functions** | Supabase Edge Functions | Invoice generation, credit note processing, scheduled jobs |
| **Row Level Security** | Supabase RLS Policies | Enforce parent/coach/admin data isolation at DB level |

### 13.4 DevOps & Tooling

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Mobile Builds** | EAS Build (Expo) | Cloud builds for iOS and Android |
| **OTA Updates** | EAS Update | Push JS-level updates without app store review |
| **Web Hosting** | Vercel | Native Next.js hosting, global CDN |
| **Scheduling** | Supabase pg_cron / Edge Functions | Daily run; the engine decides which month is due and whether the run day has arrived (§5.5) |
| **Language** | TypeScript | Shared types across mobile, web, and backend |

#### Why Supabase for SwimSync?

- PostgreSQL gives full relational database capabilities ideal for SwimSync's linked entities (parents, students, classes, attendance, invoices, credit notes)
- Row Level Security (RLS) enforces data isolation at the database level — parents only see their children, coaches only see their classes
- Built-in Auth with email/password and role management matches SwimSync's three-role model
- Storage bucket for PayNow QR images with access control
- Edge Functions for server-side logic (invoice generation, credit note processing)
- Real-time subscriptions allow live attendance updates if needed
- Generous free tier supports MVP development and early launch

---

## 14. Screen Flow & Wireframe Reference

The following section provides a screen-by-screen reference for each SwimSync user role. This serves as a guide for UI implementation and vibe coding.

### 14.1 Parent App — Screen Flow

> Login/Register → Home Dashboard → Child Profile → Class Details → Attendance History → Invoices & Credit Notes → Payment (PayNow QR)

| Screen | Key Elements | Notes |
|--------|-------------|-------|
| **Login / Register** | Email, password fields; Register / Login toggle | Simple form; forgot password link |
| **Home Dashboard** | List of children with status badges; outstanding amount summary | Tap child card to drill down; show "Not Assigned Yet" if applicable |
| **Add / Edit Child** | Name, DOB, gender, notes fields | Form with save/cancel; validation on required fields (no swimming-ability field — see §5.1) |
| **Child Profile** | Child details card; assignment status; class info if assigned | Show coach name, class day/time/location when assigned |
| **Attendance History** | Chronological list of lessons with status badges | Color-coded: green = present, grey = absent, blue = trial |
| **Invoices** | Monthly invoice list with status; **pay or claim from the card itself**; tap for detail | Show gross, credit applied, net amount; red = outstanding. *(implemented — each card names the invoice by its **`INV-YYYY-NNNN` reference**, the same string as the QR and the bank statement, §7.21)*. *(implemented 2026-08-08 — an outstanding card carries **Pay via PayNow** and **I've paid** directly, so the in-app path is no longer slower than the public tokenized page the WhatsApp reminder links to. A claimed card replaces the button with the same acknowledgement line the other two surfaces use, and stays **outstanding** — a claim is a statement, never a status change)* |
| **Invoice Detail** | Line items per lesson; credit notes applied; total | PayNow QR button to open payment view. *(implemented — carries the **reference**, selectable so it can be copied into a transfer made outside the QR, §7.21)* |
| **Credit Notes** | List of credit notes with reference number and amount | Linked to original invoice; show applied/pending status |
| **PayNow QR** | The QR of the business that issued the invoice; invoice amount display | Correct QR per **business** *(implemented — changed from per-coach, §7.10)*; amount shown for reference |

### 14.2 Coach App — Screen Flow

> Login → Today's Classes → Class Roster → Mark Attendance → Invoices → Credit Notes → PayNow QR Management

| Screen | Key Elements | Notes |
|--------|-------------|-------|
| **Login** | Email/password | Coach accounts created by superadmin |
| **Today's Classes** | List of today's classes with student count; quick-action buttons | Default landing screen; highlight current/next class. *(implemented — each card also carries its **attendance state** and a breakdown of what was recorded, §7.6, and names **guests separately** from students: "4 students + 1 guest", §7.20)* |
| **My Classes** | Every class the coach teaches, **grouped by weekday with today first** | *(implemented 2026-08-02)* The tab's landing screen. It always opens here: the attendance screen lives in this tab's stack but is pushed from Today, and a leftover one used to be what the coach saw instead (§7.80) |
| **Class Roster** | Student list for selected class; attendance status per student | Tap student row to mark/edit attendance |
| **Mark Attendance** | Status picker per student: Present, Absent, Cancelled, Trial | Minimal taps; if Trial, sub-prompt for Paid/Free; **"Set all ▾"** header shortcut to set every student at once (§7.6); batch save |
| **Edit Past Attendance** | Calendar/date picker; select lesson; edit status | Warning shown if lesson already invoiced; confirm triggers credit note |
| **My Pay** | The coach's own `coach_payouts` — period, amount, draft vs paid | *(implemented 2026-08-02 — replaced the Invoices/Credit Notes screens, §7.9)* **Hidden entirely when the coach has no payouts**, which is the finished state for a private coach (§7.13), not missing setup. Only ever their own; a colleague's pay is not inferable |
| ~~Invoices~~ / ~~Credit Notes~~ | — | **Removed from the coach app 2026-08-02.** Both live on the admin panel, which is the only surface with the reference, the QR and the reminder queue (§7.9, §7.21) |
| **PayNow QR Mgmt** | Current QR image; upload/replace button | Image picker; preview before save. Only for a coach who is also the business's admin (§7.10) |

### 14.3 Superadmin Web Panel — Screen Flow

> Login → Dashboard → Unassigned Children → Assign to Class → Classes → Students → Attendance → Invoices → Credit Notes → Coaches

| Screen | Key Elements | Notes |
|--------|-------------|-------|
| **Dashboard** | Key metrics: active students, unassigned count, outstanding invoices, total credit notes | Summary cards with drill-down links. *(implemented — the metric is **Active Students**, not "total": a departed child stays a row forever because attendance and invoices reference them (§7.14), so a total answered a bookkeeping question nobody asked. The card names the count business-wide, and an inactive tally is appended only when there is one.)* |
| **Unassigned Children** | Filterable table of unassigned students with parent info | Assign button per row; batch assign option |
| **Assign to Class** | Select coach → select class → confirm assignment | Modal or side panel; show class capacity info |
| **Classes** | Table of all classes; CRUD operations; coach assignment | Create/edit class form with all fields |
| **Students** | All students table with filters; assignment status column | Click to view profile; show parent link |
| **Attendance** | Filter by class, coach, date range; per-student records | Read-only view; audit trail visible |
| **Invoices** | All invoices with filters; mark as paid; view line items | Show gross, credit, net columns |
| **Credit Notes** | All credit notes; filter by parent, status, date | Read-only; linked to invoices and lessons |
| **Coaches** | Coach list; create/edit accounts; view assigned classes | Shows the **business's** PayNow QR *(implemented — read-only here; it is set by the business's admin, §7.10)* |

### 14.4 Key Navigation Patterns

#### Parent App (Mobile)

- Bottom tab navigation: Home, Attendance, Billing, Profile
- Home tab shows children list as the primary entry point
- Billing tab shows combined invoices and credit notes across all children
- Profile tab allows editing parent info and child profiles

#### Coach App (Mobile)

- *(implemented — changed 2026-08-08)* Bottom tab navigation: **Schedule, Classes, My Pay,
  Settings** — and **My Pay is absent** unless the coach has a payout, so a private coach
  sees **three** tabs. It was *Today, Classes, Billing, Settings*; the Billing tab held an
  invoice list and a Mark Paid button, both now admin-only (§7.9), and the **Today tab
  became Schedule** (below)
- **Schedule is the default tab**, and it is a WEEK rather than a day: a week selector
  (Monday-start, fixed) over four sections — **NEEDS MARKING**, **TODAY**, **COMING UP**,
  **DONE**. It replaced the Today tab outright rather than sitting beside it, because two
  tabs both listing today's lessons with marking chips is duplication in the app's most
  prominent navigation
- Classes tab shows all assigned classes, **grouped by weekday with today's first**, and
  **always opens on that list** — pressing the tab unwinds anything the Schedule tab
  pushed into its stack (§7.80)
- Settings tab for PayNow QR upload and account management

#### Superadmin Panel (Web)

- Sidebar navigation *(implemented 2026-08-17)*: four top-level items (Dashboard, Students,
  Classes, Attendance) plus four **collapsible task groups** — Families, Billing, Scheduling,
  Settings — that remember their open/closed state and auto-expand the active page's group; a
  collapsed group's header carries the amber count badge of any page inside it. The whole panel
  also **auto-scales down on narrower screens** (root font-size media queries) so it fits a
  smaller laptop without manual browser zoom.
- Persistent search bar and filter controls on all table views
- Bulk action support where relevant (e.g. batch assign, batch mark paid)
- **Every column is sortable and every cell hugs its content** *(implemented)* — one
  comparison rule applied across all 22 tables. Blanks stay last in **both** directions
  so reversing a half-empty column never fills the screen with rows nobody can act on;
  sorting is numeric-aware (`Sun 845am` before `Sun 930am`, `Level 2` before `Level 10`),
  weekdays sort in week order rather than alphabetically, and it is stable, so a second
  key keeps the first one's grouping. Columns sort by **what is on screen** — a status by
  its label, an amount by its number — not by what the row stores underneath.
- **Scoped search on the high-traffic tables** *(implemented 2026-08-28)* — Students,
  Invoices, Credit Notes and Attendance carry a **field-scoped** search: a small dropdown
  picks the one column to search (Student / Parent / Reference), and the term is pushed
  into the **database** rather than filtered in the browser, so it reaches the whole table
  instead of the first ~1000 rows PostgREST returns (that cap is **silent** — a browser
  search over it answers "not found" for a row that exists). A search on a joined name
  (the parent behind an invoice) rides an inner join so non-matches are excluded, never
  returned blank. The platform admin's cross-business **family search** works the same way.
  Classes and Packages, whose lists are small, keep an instant in-browser search but now
  show a banner if a fetch is ever truncated. Every filter keys on **id, not title**, so
  two classes sharing a name stay distinct.
- **Change History** *(implemented 2026-08-17)* — a read-only `/history` page surfacing the
  `audit_log` trail so a disputed charge can be answered without SQL: who changed what, and
  when. One global list filtered by entity type and a date range (both applied in the database
  so the 1000-row cap bites after filtering). Each row **diffs** the `to_jsonb` before/after
  snapshots — a change shows only the fields that moved, with the old value struck through — so
  the answer to "what was the number before" is on screen. It is deliberately **"Change
  History", not "Audit log"**: the trail has holes by design (a removed admin's rows are purged;
  a no-JWT system write records nothing), and the page says so. An action by someone the admin
  cannot see renders as *"unknown user"*, never as *"system"* — an audit view must not relabel a
  real person.
- **Export to CSV** *(implemented)* — the Invoices, Credit Notes, and Attendance tables each
  carry an **Export CSV** button that downloads exactly what is on screen (post-search,
  filter, and sort), for handing to an accountant. Money is exported as raw numbers so the
  columns sum in Excel; the file carries a UTF-8 BOM so unicode names open correctly. Two
  safeguards are deliberate: a field beginning with `=`, `+`, `-`, `@`, tab, or return is
  prefixed with an apostrophe so a parent-entered name can never execute as an Excel formula;
  and when the underlying list was capped (the tables fetch at most ~1000 rows) the export is
  **refused** with a "narrow the range" message rather than silently writing an incomplete
  financial file.

---

## 15. Release Plan

### Phase 1 — Core MVP

- SwimSync authentication and parent registration
- Parent child profile creation
- Superadmin class setup and unassigned children listing
- Superadmin assignment of children to classes/coaches
- One-class enrolment per student
- Attendance tracking and parent attendance visibility
- Invoice generation after the billing month ends (run day configurable, default the 7th)
- Credit note generation for post-invoice attendance corrections
- Manual paid marking and PayNow QR display
- Basic SwimSync web admin panel

### Phase 2 — Enhancements

- Email invoice and credit note notification *(implemented: invoice emails — see §7.7; credit-note emails still pending)*
- Optional WhatsApp payment reminder
- Better filtering and search
- More polished dashboards
- Attendance edit history view

### Phase 3 — Future Features

- Makeup classes and multi-class enrolment per student
- Auto-reminders and parent notifications
- Exports and richer payment workflows
- Package or subscription pricing
- Automatic PayNow payment detection

---

## 16. Success Criteria for MVP

SwimSync MVP is successful if:

- Parents can register and add their children without admin help
- Superadmin can see and assign unassigned children easily
- Coach can manage attendance without external spreadsheets
- Parents can log in and view their children's attendance
- Monthly invoices are generated correctly from attendance
- Credit notes are issued automatically when attendance is corrected post-invoice
- Coach can easily tell which invoices are outstanding vs paid
- Parents can pay using PayNow QR and coach can manually track payment
- Parents can see their credit note history and current credit balance

---

## 17. Open Implementation Notes

> *These are not product decisions, but suggested engineering decisions for SwimSync.*

- Use Supabase (PostgreSQL) as the database because the entities are strongly linked
- Enforce access control using Supabase Row Level Security policies
- Store invoices and credit notes as generated records, not just as dynamic queries
- Store invoice line items so historical bills remain auditable even if class rates change later
- Store separate PayNow QR assets in Supabase Storage *(implemented — keyed by
  **business**, at `paynow-qr/<tenant_id>/paynow-qr`, not per coach; §7.10)*
- Prefer invoice generation from attendance records rather than class schedule count
- Add an explicit student assignment status: **Unassigned, Assigned, Inactive**
- Use Supabase Edge Functions for monthly invoice generation triggered by pg_cron
- Implement credit note processing as a database trigger or Edge Function on attendance update
- Maintain an audit log for all sensitive SwimSync operations

> **Removed UI stubs (July 2026, during deployment):** placeholder buttons that had
> no implementation were removed so the shipped app has no dead controls —
> **Notification Preferences** (coach Settings + parent Profile) and **Help & Support**
> (parent Profile). Notification Preferences is consistent with §3.2 (push notifications
> are **out of MVP scope**). **Change Password** on those screens was also a stub and is
> now **implemented** in-app (self-service password change for a logged-in coach/parent).
> Full list + restore notes: `docs/ARCHITECTURE.md` §12.

---

## 18. Final MVP Decisions Summary

| Decision Area | SwimSync MVP Decision |
|---------------|----------------------|
| **Platform** | React Native (Expo) mobile + Next.js web admin |
| **Backend** | Supabase (PostgreSQL, Auth, Storage, Edge Functions) |
| **Tenancy** | *(implemented)* **Multi-tenant.** A tenant is a business; a private coach is a tenant of one. `superadmin` split into **tenant admin** (one business) and **platform admin** (cross-tenant support). No rule branches on private-vs-school. **A business is created by the platform admin** (§4.4) — its first admin is the **owner**, who invites co-admins from the Admins page (§4.3); no public signup |
| **Parent onboarding into a business** | *(implemented)* **Join codes.** No public directory of coaches or schools — possession of the code is the proof of relationship |
| **Coach pay** | *(implemented)* On payroll when a coach **has a rate**. Effective-dated so a raise never reprices history; draft until paid, then frozen (§7.13) |
| **Initial usage** | Single coach first, but multi-coach capable |
| **Parent onboarding** | Self-register with email/password |
| **Student creation** | Done by parent *(implemented: parents also **edit** — name, DOB, gender, notes. The business, the class and activity stay the admin's, §7.4)* |
| **Child visibility** | Parent sees their own created children |
| **Assignment workflow** | Superadmin assigns children to coaches/classes |
| **Web admin** | Dedicated Unassigned Children section |
| **Class model** | One fixed weekly class per student, one coach per class |
| **Attendance statuses** | Present, Absent, Cancelled (rain/coach), Trial (Paid/Free) |
| **Attendance corrections** | Allowed; triggers credit note if lesson already invoiced |
| **Pricing** | Class-level rate, **effective-dated** — a lesson is priced by the terms in force on its OWN date, so editing a price never reprices last month (§7.3) |
| **Credit** | *(implemented)* Pooled per parent **within a business**; never spendable at another (§5.6) |
| **Billing source** | Actual attendance |
| **Invoice timing** | A billing month must have **ENDED** — the current month can never be billed, by either path (§7.7). Then: automatic from a **configurable day of the following month** (`invoice_run_day`, default the **7th**), **or** manual on-demand per month (the business's admin), toggled via the Automatic-generation switch. **All per business.** Either way, generation is **blocked while any lesson is unmarked** (§7.7) |
| **Credit notes** | Auto-issued on post-invoice corrections; applied to next invoice |
| **Invoice status** | Outstanding / Paid |
| **Payment** | External PayNow via **the business's** QR, manual verification *(implemented — changed from per-coach: a school has one bank account, §7.10)* |
| **Child identity** | *(implemented)* **Name + date of birth**, unique per business; age is **derived**, never stored. NRIC declined — partial NRIC is regulated personal data and DOB was already collected (§5.1) |
| **Swimming levels** | *(implemented)* Each business defines its **own ordered ladder**, each rung carrying a skill list. Admin-set, coach/parent read-only. No tiers or progression graph — businesses structure levels differently (§7.15) |
| **Prepaid packages** | *(implemented)* Dollars stored, lessons derived; locked rate for the package's life (a price rise is a new product); scoped by the business's own class categories; drawn down at invoice time by the same engine; ad-hoc billing unchanged and still the default (§7.16) |
| **Language** | English only |
| **Not in MVP** | Makeup lessons, auto payment reconciliation |
