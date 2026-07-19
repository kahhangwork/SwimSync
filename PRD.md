# SwimSync — Product Requirements Document

**Swim Coach Attendance & Billing App**
**MVP Version 1.0**

| | |
|---|---|
| **Status** | Draft |
| **Version** | 1.0 |
| **Date** | March 2026 |

> **Build status (July 2026):** Backend rebuilt as reproducible Supabase CLI migrations with full RLS; runs on a local Supabase stack (Docker). The **entire MVP core loop works and is verified end to end across the UI + backend**: parent self-registration, joining a business by code, child creation, admin assignment, coach attendance marking, invoice generation (automatic *and* manual on-demand, with an on/off switch), the **credit-note correction flow** (auto-issue on attendance edit + FIFO application incl. partial carry-forward — see §5.6), and **PayNow QR** (coach upload → parent display → admin view). A partial-application ledger bug found during credit-note verification was fixed via a `credit_applications` allocation table (see §9.17). An **automated test suite** now covers the billing/credit engine (Deno) and DB triggers/RLS/constraints (pgTAP). **Password reset** is implemented on the mobile app (self-service recovery flow via `resetPasswordForEmail` → in-app reset screen → `updateUser`, working across Expo web and native deep links), and login/register errors are mapped to friendly copy — see §7.1. The code lives on GitHub (public, `kahhangwork/SwimSync`). **Now live in production on its own domain (web-first, free tier):** the mobile app at **https://swimsync.sg** and the admin at **https://admin.swimsync.sg** (Vercel), backend on Supabase, real transactional email via **Resend** (`noreply@swimsync.sg`, e.g. password-reset). A real coach + 4 classes are onboarded on a clean-slate production DB. Automated tests (128 pgTAP + 67 Deno + frontend vitest/jest-expo suites) run in CI on every push. Swimming ability is no longer a parent-entered field (see §5.1). Invoice generation is **manual** (no cron on the free tier) — see `INVOICE_RUNBOOK.md`. **SwimSync is now MULTI-TENANT** *(July 2026)*: a **tenant is a business**, a **private coach is a tenant of one**, and the old global `superadmin` has split into a **tenant admin** (one business) and a **platform admin** (cross-tenant support) — see §4.3. Parents join a business with a **join code** (§5.1); there is no public directory. Invoices, credit, month-sealing, the completeness block and the billing schedule are all **per business**, credit **never crosses** businesses (§5.6), invoice emails and the PayNow payee are **the business's** (§7.10), and **coach wages** are computed from attendance with effective-dated rates (§7.13). **A lesson is priced and attributed by its OWN date** *(2026-07-19)*: a class's price and its paid coach are effective-dated, so editing a price no longer reprices the previous month and handing a class to another coach no longer moves the outgoing coach's pay — and a payout correction is carried once rather than every month thereafter (§7.3, §7.7, §7.13). Cross-tenant isolation is enforced in RLS *and*, because the billing engine bypasses RLS, in engine code. **Each parent gets one invoice per business covering every class their children attend there**, generation is **blocked until all of the month's attendance is marked** (no override — a lesson that didn't run is marked *cancelled*), a finished month is **sealed** so it is never reprocessed (but a month with **nothing recorded** is never sealed — that vacuous seal locked a month out of billing entirely until it was fixed 2026-07-18), and the automatic path waits until a **configurable day of the month** (default the 7th) — see §7.7. Removing a child from a class, or marking them inactive, is available to the **business's admin and their coach** (§7.4). **Families and children carry an active/inactive state per business** *(2026-07-19)*, with the date they left; deactivating the last child marks the family inactive too, and a departed family returns by re-entering the join code (§7.14). Generation also **emails the parent** a branded, itemized invoice on creation (best-effort, isolated from billing; live in production since 2026-07-16 — see §7.7). **Lesson sessions are created lazily, not pre-generated, and the lessons that *should* have happened are derived from each class's weekday at read time** — surfacing unmarked lessons to the coach and reporting attendance gaps to the admin before invoices are generated (see §7.5 and §7.7), which closes a hole where a forgotten lesson was silently unbillable and invisible to everyone. The only remaining gate to real billing is **real usage**: no attendance has yet been marked in production, so the engine has never processed a real lesson. Parents self-register at `swimsync.sg`, enter their coach's join code, add children, and the business's admin assigns classes. Native App/Play Store builds are deferred. Sections marked *(implemented)* reflect build decisions that extend or refine the original spec. See `HANDOVER.md` for the current working state and next steps.

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
- Support separate PayNow QR codes per coach
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
| Multiple coaches per class | Coach-created student profiles |
| Auto-detection of PayNow payment | In-app payment gateway integration |
| Export to Excel or CSV | Maps integration |
| Multi-language support | Push notifications |
| Automated reminder workflows | Household-level split billing |

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
- View invoices and credit notes related to own students/classes
- Mark invoices as paid
- Upload own PayNow QR

#### Coach Restrictions

- Cannot create student profiles in MVP
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

- View every business, its join code, and its student/class counts
- **Move a student to another business** — the remedy when a parent joins with the
  wrong code
- Has **no** invoice-generation or payroll controls of their own: those run for one
  business at a time and are the tenant admin's

*(Deliberately not built: a "view as tenant" impersonation mode. That would mean
scoping every admin page to a chosen tenant rather than the caller's own — far larger
than the support capability this role needs.)*

---

## 5. Key Business Rules

### 5.1 Parent Registration and Child Creation

- Parents can self-register on SwimSync using email/password
- Parent account may exist before any child is created
- A newly registered parent may create one or more child/student profiles
- **Student profile includes:** child name, age/date of birth, gender, optional notes. *(implemented: parents do **not** set a swimming ability/level — the **class** a child is assigned to indicates their level. A per-child level field is reserved for a future "coach-defined levels" feature and is not populated today.)*
- A child remains unassigned until the business's admin assigns that child to a coach/class
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
- SwimSync web admin panel shall include an **Unassigned Children** section
- Once assigned, the child appears in the relevant coach's roster and under the parent's account with class details visible
- A coach should only see children enrolled in that coach's own classes

### 5.3 Class Rules

| Rule | Detail |
|------|--------|
| **Coach per class** | Each class has only one coach |
| **Students per class** | Each class can have multiple students |
| **Classes per student** | One fixed weekly class per student in MVP |

**Class definition includes:** title/name, day of week, start time, end time, location name and/or address, class price per lesson. Superadmin can create, edit classes, and amend pricing when needed.

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

- Parents pay externally via PayNow using the coach's QR code
- Coach manually checks bank account and marks invoice as paid in SwimSync
- No automatic reconciliation in MVP

### 5.6 Credit Note Rules

SwimSync supports **credit notes** to handle attendance corrections made after an invoice has already been generated. This ensures billing accuracy without requiring invoice deletion or manual recalculation.

#### When a Credit Note Is Issued

A credit note is **automatically triggered** when a coach changes a student's attendance status on an already-invoiced lesson from a billable status (Present or Paid Trial) to a non-billable status (Absent, Cancelled due to rain, Cancelled by coach, or Free Trial).

No credit note is generated for changes within the same billing category (e.g. Present to Paid Trial).

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

- As a **tenant admin**, I want to view attendance, invoices, and credit notes across **my own** coaches so that I can run my business *(implemented: "across all coaches" was the pre-tenancy model — an admin now sees only their own business, §4.3)*

---

## 7. Functional Requirements

### 7.1 Authentication

SwimSync shall support email/password authentication for parent and coach accounts.

- Parent can self-register, log in, log out, and reset password
- Coach accounts may initially be created manually by superadmin/system owner
- Superadmin account(s) shall exist
- Role-based access must be enforced across all SwimSync features

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
- Set location name and optional address
- Set class price per lesson
- Set class active/inactive status
- Assign a coach to a class

*(implemented)* The admin **Classes** page supports both create and edit: each class row has
an **Edit** action that opens the same form pre-filled, so day, time, coach, location, and
rate can be changed in-panel (no dashboard SQL). The **day of week is a required, explicit
choice** — the form no longer defaults it, so a class cannot be created on the wrong weekday
by leaving the picker untouched. (A class is a *recurring weekly* definition keyed by
`day_of_week`; there is no single class date — dated `lesson_sessions` are created lazily
when attendance is marked, per §7.5.)

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

### 7.4 Student Management

SwimSync shall allow **parents to create student profiles** and **superadmin to manage assignment** of those students.

- Parent can create and edit student profiles
- Profile includes: full name, age/DOB, gender, optional notes *(swimming ability is **not** parent-entered — see §5.1)*
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
- Superadmin can assign or reassign student to one class
- SwimSync shall prevent more than one active class enrolment per student for MVP

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
unique per `(class, date)` and the attendance screen accepts **any** date, so marking a
past lesson late works and never disturbs another date.

The requirement that actually mattered — knowing a lesson *should* have happened — is met
by **deriving expected lesson dates from the class's `day_of_week` at read time** rather
than materialising rows ahead of time. This is what makes a forgotten lesson visible:

- The **coach's Today tab** lists **Unmarked Lessons** (past lessons not fully marked)
  and links straight to marking them; the class roster shows expected-but-missing dates
  as a distinct *"Not marked"* state.
- The **admin's invoice-generation dialog** reports, per class, `N of M lessons marked`
  and names any missing dates before invoices are created (see §7.7).
- A lesson that legitimately didn't run is recorded with the existing non-billable
  statuses (*Cancelled — rain/coach*), which clears it from both views.
- The **coach's roster bounds marking to that same window.** Its primary action targets the
  *most recent expected lesson* (today if today is a class day, else the last one that
  passed), floored at `max(start of last month, earliest enrolment)`; earlier lessons are
  closed (a correction to an already-invoiced lesson uses a credit note). A class with nothing
  due yet shows a placeholder instead of a markable button — so a coach cannot create/bill a
  session on a non-lesson day by mistake.
- The **parent's Attendance screen uses the same derivation to tell its empty states apart:** a
  child whose first lesson hasn't happened yet reads *"No lessons have taken place yet"*, versus
  *"No lessons marked yet"* when a lesson has fallen due but the coach hasn't recorded it.

A lesson counts as marked only when every actively-enrolled student has an attendance
record on it — the same rule the invoice engine applies.

**Not provided:** parents see no "upcoming lessons" list (only marked history), and no
future-dated sessions exist. Both would follow from pre-generation if ever wanted.

### 7.6 Attendance Management

SwimSync shall allow coach to record attendance per student per lesson session.

- Coach can mark one attendance status per student per session
- Attendance statuses: Present, Absent, Cancelled due to rain, Cancelled by coach, Trial
- If Trial is selected, coach must specify Paid Trial or Free Trial
- Attendance records must store who marked them and when
- Attendance records must be editable by authorized coach/admin
- If an attendance edit changes a billable status to non-billable on an already-invoiced lesson, SwimSync shall **automatically generate a credit note**
- An audit log entry must be created for every attendance edit

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

#### Attendance-gap check before generating *(implemented)*

Because billing is derived from attendance, a lesson nobody marked has no record and is
therefore **unbillable and invisible**. Before invoices are generated, SwimSync compares
each class's weekly schedule against what is actually marked for the billing month and
reports any gaps — per class, `N of M lessons marked`, naming the missing dates (see
§7.5). Future-dated lessons in the current month are not counted as gaps.

*(implemented — updated)* The check **blocks rather than warns**, in **every** mode. If any
lesson in the billing month has unmarked attendance, **no invoices are generated at all**
and the admin is shown which lessons to fix. There is **no override**.

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
and a send failure never affects invoice generation. Only newly-created invoices are
emailed, so re-running generation never double-sends. *Credit-note* emails are not yet sent
(a separate path — see §7.8). **Live in production since 2026-07-16** (Edge Function deployed
+ `RESEND_API_KEY` secret set); the first real send is the 1 Aug generation.

### 7.8 Credit Note Management

SwimSync shall support credit notes for post-invoice attendance corrections.

- Credit notes are generated automatically when attendance is corrected on an already-invoiced lesson
- Each credit note records: parent, student, original invoice reference, lesson date, credit amount, reason, and timestamp
- Credit notes are immutable once created (cannot be edited or deleted)
- Outstanding credit balances are automatically applied to the next invoice during generation
- Parents can view credit note history in SwimSync's billing section
- Coaches and superadmin can view credit notes in their respective views
- Credit notes carry unique sequential reference numbers (e.g. CN-2026-0001)

### 7.9 Payment Tracking

SwimSync shall support manual payment verification.

- Parent sees invoice status and outstanding amount (net of any credits applied)
- Coach manually marks invoice as paid
- Paid timestamp should be stored
- No auto-payment detection required for MVP

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
| **paynow_qr_url** | String | No | Stored PayNow QR image URL |
| **bio** | Text | No | Optional coach bio or notes |
| **created_at** | Timestamp | Yes | Record creation timestamp |

### 9.3 Parents

*Parent-specific data extending Profiles.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **id** | UUID | Yes | Primary key |
| **profile_id** | UUID (FK) | Yes | References Profiles.id |
| **credit_balance** | Decimal | Yes | Running credit note balance (default 0.00) |
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
| **swimming_ability** | Enum | No | *(implemented)* Reserved for a future coach-defined levels feature; **not set by parents** and currently always NULL. The child's assigned **class name** indicates their level instead. |
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
| **Invoices** | Monthly invoice list with status; tap for detail | Show gross, credit applied, net amount; red = outstanding |
| **Invoice Detail** | Line items per lesson; credit notes applied; total | PayNow QR button to open payment view |
| **Credit Notes** | List of credit notes with reference number and amount | Linked to original invoice; show applied/pending status |
| **PayNow QR** | Coach's QR code image; invoice amount display | Correct QR per coach; amount shown for reference |

### 14.2 Coach App — Screen Flow

> Login → Today's Classes → Class Roster → Mark Attendance → Invoices → Credit Notes → PayNow QR Management

| Screen | Key Elements | Notes |
|--------|-------------|-------|
| **Login** | Email/password | Coach accounts created by superadmin |
| **Today's Classes** | List of today's classes with student count; quick-action buttons | Default landing screen; highlight current/next class |
| **Class Roster** | Student list for selected class; attendance status per student | Tap student row to mark/edit attendance |
| **Mark Attendance** | Status picker per student: Present, Absent, Cancelled, Trial | Minimal taps; if Trial, sub-prompt for Paid/Free; **"Set all ▾"** header shortcut to set every student at once (§7.6); batch save |
| **Edit Past Attendance** | Calendar/date picker; select lesson; edit status | Warning shown if lesson already invoiced; confirm triggers credit note |
| **Invoices** | Monthly invoice list for coach's students; filter by status | Mark as Paid button; show outstanding vs paid counts |
| **Credit Notes** | List of credit notes related to coach's students | Read-only view; linked to original invoices |
| **PayNow QR Mgmt** | Current QR image; upload/replace button | Image picker; preview before save |

### 14.3 Superadmin Web Panel — Screen Flow

> Login → Dashboard → Unassigned Children → Assign to Class → Classes → Students → Attendance → Invoices → Credit Notes → Coaches

| Screen | Key Elements | Notes |
|--------|-------------|-------|
| **Dashboard** | Key metrics: total students, unassigned count, outstanding invoices, total credit notes | Summary cards with drill-down links |
| **Unassigned Children** | Filterable table of unassigned students with parent info | Assign button per row; batch assign option |
| **Assign to Class** | Select coach → select class → confirm assignment | Modal or side panel; show class capacity info |
| **Classes** | Table of all classes; CRUD operations; coach assignment | Create/edit class form with all fields |
| **Students** | All students table with filters; assignment status column | Click to view profile; show parent link |
| **Attendance** | Filter by class, coach, date range; per-student records | Read-only view; audit trail visible |
| **Invoices** | All invoices with filters; mark as paid; view line items | Show gross, credit, net columns |
| **Credit Notes** | All credit notes; filter by parent, status, date | Read-only; linked to invoices and lessons |
| **Coaches** | Coach list; create/edit accounts; view assigned classes | Manage PayNow QR per coach |

### 14.4 Key Navigation Patterns

#### Parent App (Mobile)

- Bottom tab navigation: Home, Attendance, Billing, Profile
- Home tab shows children list as the primary entry point
- Billing tab shows combined invoices and credit notes across all children
- Profile tab allows editing parent info and child profiles

#### Coach App (Mobile)

- Bottom tab navigation: Today, Classes, Billing, Settings
- Today tab is the default with immediate access to attendance marking
- Classes tab shows all assigned classes for date-based lookups
- Billing tab shows invoices for the coach's students with quick mark-as-paid
- Settings tab for PayNow QR upload and account management

#### Superadmin Panel (Web)

- Sidebar navigation with sections: Dashboard, Unassigned, Classes, Students, Attendance, Invoices, Credit Notes, Coaches
- Persistent search bar and filter controls on all table views
- Bulk action support where relevant (e.g. batch assign, batch mark paid)

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

- Coach-assisted assignment workflow
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
- Store separate coach PayNow QR assets in Supabase Storage
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
> Full list + restore notes: `HANDOVER.md` §12.

---

## 18. Final MVP Decisions Summary

| Decision Area | SwimSync MVP Decision |
|---------------|----------------------|
| **Platform** | React Native (Expo) mobile + Next.js web admin |
| **Backend** | Supabase (PostgreSQL, Auth, Storage, Edge Functions) |
| **Tenancy** | *(implemented)* **Multi-tenant.** A tenant is a business; a private coach is a tenant of one. `superadmin` split into **tenant admin** (one business) and **platform admin** (cross-tenant support). No rule branches on private-vs-school |
| **Parent onboarding into a business** | *(implemented)* **Join codes.** No public directory of coaches or schools — possession of the code is the proof of relationship |
| **Coach pay** | *(implemented)* On payroll when a coach **has a rate**. Effective-dated so a raise never reprices history; draft until paid, then frozen (§7.13) |
| **Initial usage** | Single coach first, but multi-coach capable |
| **Parent onboarding** | Self-register with email/password |
| **Student creation** | Done by parent |
| **Child visibility** | Parent sees their own created children |
| **Assignment workflow** | Superadmin assigns children to coaches/classes |
| **Web admin** | Dedicated Unassigned Children section |
| **Class model** | One fixed weekly class per student, one coach per class |
| **Attendance statuses** | Present, Absent, Cancelled (rain/coach), Trial (Paid/Free) |
| **Attendance corrections** | Allowed; triggers credit note if lesson already invoiced |
| **Pricing** | Class-level rate set at class level |
| **Credit** | *(implemented)* Pooled per parent **within a business**; never spendable at another (§5.6) |
| **Billing source** | Actual attendance |
| **Invoice timing** | Automatic from a **configurable day of the following month** (`invoice_run_day`, default the **7th**), **or** manual on-demand per month (the business's admin), toggled via the Automatic-generation switch. **All per business.** Either way, generation is **blocked while any lesson is unmarked** (§7.7) |
| **Credit notes** | Auto-issued on post-invoice corrections; applied to next invoice |
| **Invoice status** | Outstanding / Paid |
| **Payment** | External PayNow via coach QR, manual verification |
| **Language** | English only |
| **Not in MVP** | Makeup lessons, auto payment reconciliation |
