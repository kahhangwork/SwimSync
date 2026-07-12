# SwimSync — Product Requirements Document

**Swim Coach Attendance & Billing App**
**MVP Version 1.0**

| | |
|---|---|
| **Status** | Draft |
| **Version** | 1.0 |
| **Date** | March 2026 |

> **Build status (July 2026):** Backend rebuilt as reproducible Supabase CLI migrations with full RLS; runs on a local Supabase stack (Docker). The **entire MVP core loop works and is verified end to end across the UI + backend**: parent self-registration, child creation, superadmin assignment, coach attendance marking, invoice generation (automatic *and* manual on-demand, with an on/off switch), the **credit-note correction flow** (auto-issue on attendance edit + FIFO application incl. partial carry-forward — see §5.6), and **PayNow QR** (coach upload → parent display → admin view). A partial-application ledger bug found during credit-note verification was fixed via a `credit_applications` allocation table (see §9.17). An **automated test suite** now covers the billing/credit engine (Deno) and DB triggers/RLS/constraints (pgTAP). **Password reset** is implemented on the mobile app (self-service recovery flow via `resetPasswordForEmail` → in-app reset screen → `updateUser`, working across Expo web and native deep links), and login/register errors are mapped to friendly copy — see §7.1. The code lives on GitHub (public, `kahhangwork/SwimSync`). Not yet done: cloud deployment (project link, function deploy, cron, storage); runtime smoke-test of a few admin/detail screens; frontend/component tests + CI. Sections marked *(implemented)* reflect build decisions that extend or refine the original spec. See `HANDOVER.md` for the current working state and next steps.

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

SwimSync supports three main user types:

| User Type | Description |
|-----------|-------------|
| **Parent** | Registers, creates child profiles, views attendance and invoices |
| **Coach** | Manages attendance, tracks payments, uploads PayNow QR |
| **Superadmin** | Manages classes, assigns children to coaches, oversees platform |

> *For MVP, SwimSync may initially be used by a single coach, but the product architecture and permissions should support multiple coaches under the same app.*

### Key Purposes

- Allow parents to create accounts and add their children's profiles in SwimSync
- Allow superadmin to assign children to coaches and classes
- Help coaches manage attendance and payment tracking
- Allow parents to view their children's attendance and payment status
- Support end-of-month billing based on actual attendance
- Allow payment via each coach's own PayNow QR code
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
- Monthly invoice generation on the **1st day of the following month**
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

### 4.3 Superadmin

The superadmin manages operational setup and assignment across the SwimSync platform.

#### Superadmin Permissions

- Full system visibility across all SwimSync data
- View all parents, student profiles, and classes
- Create and edit classes
- Assign children to coaches/classes
- View and manage unassigned children
- View all credit notes and override access where required

---

## 5. Key Business Rules

### 5.1 Parent Registration and Child Creation

- Parents can self-register on SwimSync using email/password
- Parent account may exist before any child is created
- A newly registered parent may create one or more child/student profiles
- **Student profile includes:** child name, age/date of birth, gender, swimming ability, optional notes
- A child remains unassigned until superadmin assigns that child to a coach/class
- Until assignment, parent can view the child profile but class/attendance/invoice sections show a *"not assigned yet"* state

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

SwimSync generates invoices on the **1st day of the following month**. This avoids billing issues for lessons conducted on the last day of the month.

Examples:
- On **1 Feb 2026**, generate invoices for **January 2026**
- On **1 Mar 2026**, generate invoices for **February 2026**

#### Invoice Grouping

- One invoice per parent per billing month
- If a parent has multiple children, all eligible lessons for those children are included in the same invoice

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
- Coaches and superadmin can view all credit notes in the admin views
- If no future invoices are generated (e.g. student leaves), the credit remains on record for manual resolution

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

#### Student Assignment

- As a superadmin, I want to view all unassigned children so that I can assign them to the right coach/class
- As a superadmin, I want to assign a child to a coach/class so that the child appears in the correct roster

#### Class Management

- As a superadmin, I want to create classes with day, time, location, and rate so that students can be assigned properly
- As a superadmin, I want to edit class details and pricing when needed

#### Oversight

- As a superadmin, I want to view attendance, invoices, and credit notes across all coaches so that I can manage the SwimSync platform centrally

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

### 7.4 Student Management

SwimSync shall allow **parents to create student profiles** and **superadmin to manage assignment** of those students.

- Parent can create and edit student profiles
- Profile includes: full name, age/DOB, gender, swimming ability, optional notes
- Student can be marked active/inactive by superadmin
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

### 7.6 Attendance Management

SwimSync shall allow coach to record attendance per student per lesson session.

- Coach can mark one attendance status per student per session
- Attendance statuses: Present, Absent, Cancelled due to rain, Cancelled by coach, Trial
- If Trial is selected, coach must specify Paid Trial or Free Trial
- Attendance records must store who marked them and when
- Attendance records must be editable by authorized coach/admin
- If an attendance edit changes a billable status to non-billable on an already-invoiced lesson, SwimSync shall **automatically generate a credit note**
- An audit log entry must be created for every attendance edit

### 7.7 Invoice Generation

SwimSync shall generate invoices monthly, with two trigger modes sharing one billing engine.

- Invoice generation date is the 1st day of the following month
- Invoice must cover the previous calendar month only
- Invoice amount must be calculated from attendance records
- Only billable attendance items must be included (Present, Paid Trial)
- One invoice per parent per month with line items per lesson
- Invoice status shall include at minimum: Outstanding, Paid
- Outstanding credit note balance must be deducted from the gross invoice total to determine the net payable amount
- An invoice fully covered by credit is created directly as **Paid**

> *For internal implementation, additional statuses such as Draft or Issued may be used if helpful.*

#### Automatic vs Manual Generation *(implemented)*

Both modes run the **same** `generate-invoices` function, so billing math is identical either way:

- **Automatic** — a daily scheduled run (cron) that generates invoices for the previous month on/after the 1st. It respects a global **Automatic generation** switch (`app_settings.auto_invoice_enabled`), only bills a class once every active student has an attendance record for every session that month (completeness gate), and seals a month once fully processed so it is never re-billed.
- **Manual (on-demand)** — a superadmin action in the web admin panel that generates invoices for a chosen billing month immediately. It bills whatever attendance is currently marked (bypasses the completeness gate), ignores the automatic switch, and never seals the month (so the scheduled run can still finalise it). Both modes skip parents who already have an invoice for that month (no double-billing).

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

SwimSync shall support separate PayNow QR code per coach.

- Coach can upload/update own PayNow QR image
- Parents should see the correct QR code for invoices related to that coach
- If a parent has children under different coaches, the correct coach QR must be shown per invoice context

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
- Invoice and credit note generation should complete reliably on the 1st day of each month
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
| **role** | Enum | Yes | parent \| coach \| superadmin |
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
| **age** | Integer | No | Age (if DOB not provided) |
| **gender** | Enum | No | male \| female \| other |
| **swimming_ability** | String | No | Free text or enum: beginner \| intermediate \| advanced |
| **notes** | Text | No | Optional notes from parent |
| **assignment_status** | Enum | Yes | unassigned \| assigned \| inactive (default unassigned) |
| **is_active** | Boolean | Yes | Active flag (default true) |
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

*Tracks which billing months have been fully processed so the daily automatic run is idempotent.*

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **billing_month** | String (YYYY-MM) | Yes | Primary key |
| **completed_at** | Timestamp | Yes | When the month was sealed |
| **invoices_issued** | Integer | Yes | Count issued for the month |
| **notes** | Text | No | Summary note |

### 9.16 AppSettings *(implemented)*

*Key/value store for platform switches.*

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

**Invariants maintained by the invoice engine:**
- `SUM(credit_applications.amount WHERE invoice_id = X) = invoices.credit_applied` for X
- `SUM(credit_applications.amount WHERE credit_note_id = N) ≤ credit_notes.amount` for N
- `parents.credit_balance = SUM of remaining (amount − applied) across the parent's notes`

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

A lesson conducted on the last day of the month must still be included in that month's invoice. Therefore, SwimSync generates invoices on the 1st day of the next month.

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
| **Scheduling** | Supabase pg_cron / Edge Functions | Monthly invoice generation on 1st of month |
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
| **Add / Edit Child** | Name, DOB, gender, swimming ability, notes fields | Form with save/cancel; validation on required fields |
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
| **Mark Attendance** | Status picker per student: Present, Absent, Cancelled, Trial | Minimal taps; if Trial, sub-prompt for Paid/Free; batch save |
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
- Invoice generation on 1st of following month
- Credit note generation for post-invoice attendance corrections
- Manual paid marking and PayNow QR display
- Basic SwimSync web admin panel

### Phase 2 — Enhancements

- Email invoice and credit note notification
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
| **Billing source** | Actual attendance |
| **Invoice timing** | Automatic on the 1st of the following month, **or** manual on-demand per month (superadmin), toggled via Automatic-generation switch |
| **Credit notes** | Auto-issued on post-invoice corrections; applied to next invoice |
| **Invoice status** | Outstanding / Paid |
| **Payment** | External PayNow via coach QR, manual verification |
| **Language** | English only |
| **Not in MVP** | Makeup lessons, auto payment reconciliation |
