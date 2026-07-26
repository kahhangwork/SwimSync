# SwimSync — Multi-Tenancy Design

_Drafted: 2026-07-18 · Updated: 2026-07-18 with decisions · Status: **agreed design, not built**_

> **All open questions are resolved** (§10). Implementation plan: `TENANCY_PLAN.md`.

The design for turning SwimSync from a single-business app into a multi-tenant platform,
written **before** any migration, so the 37 RLS policies get rewritten once rather than
twice.

Context: a swim school pilots the platform in **August 2026** (a few coaches and students,
not the whole school). Parents pay the school directly; SwimSync will eventually charge the
school, but the pilot is **free** and platform billing is **out of scope here**.

> **Companion documents.** `PRD.md` = what exists · `BACKLOG.md` = what doesn't yet ·
> `HANDOVER.md` = the state you're inheriting. This document is a **design for one
> unbuilt thing** and should be deleted (folded into the PRD) once it ships.

---

## 1. The core decision: a private coach is a school of one

**There is one product, one schema, one app.** "Private coach" and "swim school" are not two
product types — they are the same object at different sizes.

A **tenant** is a business. A private coach is a tenant with one coach, where the same person
holds both the admin and the coach role. That is not a modelling trick to avoid building two
products; it is just accurate. A private coach genuinely *is* a business owner who also
teaches.

Three consequences follow, and they are the reason this design is smaller than the backlog
assumed:

1. **Coach type stops being an authorization concept.** No rule ever branches on
   "private vs school". Rules ask *which tenant* and *what role*. `tenants.kind` may exist
   for onboarding copy and future pricing, but it must never appear in an RLS policy. This
   deletes most of the "build every money feature twice" risk recorded in
   `BACKLOG.md → Coach type`.
2. **Wages need no type check either.** A wage is owed when the coach is **not** the tenant
   owner. A private coach owns their tenant, so nothing upstream pays them — same rule, no
   branch.
3. **Growth needs no migration.** A private coach who hires their first assistant adds a
   coach to their tenant. On a two-platform design they would have to migrate between
   products at the exact moment they are growing.

**This work was already owed.** `is_superadmin()` is a bare global role check, and three
policies leak across any business boundary today (§7). The original "one admin, many private
coaches" plan would have hit all three at coach #2. Tenanting is not a cost the school pivot
imposed — it is a debt already on the books.

---

## 2. Where the tenant boundary falls

The single most important decision, because everything else is mechanical once it is fixed.

### Parents are global. Students are tenanted.

**`parents` does NOT get a `tenant_id`.** PRD §11.3 requires a parent to see all their
children under one account across coaches, and a family with one child at a school and one
with a private coach is completely ordinary. Tenanting the parent breaks that permanently.

**`students` DOES get a real `tenant_id` column** — not a value derived from their enrolment.
Three reasons, the last of which is decisive:

- **The unassigned queue needs it.** A parent self-registers and adds a child; the child is
  unassigned and has no enrolment yet. If tenancy came from enrolment, an unassigned child
  would belong to *no* tenant — invisible to every admin, or visible to all of them. Both are
  wrong. See §6 for how the child acquires the tenant at signup.
- **RLS stays cheap.** A column beats a join through `student_class_enrolments` in every
  policy that touches students.
- **"Remove from class" already depends on it.** That action (shipped 2026-07-18) returns a
  child to *Unassigned* while keeping them in the business. Under enrolment-derived tenancy it
  would evict them from the tenant entirely and they would vanish from the admin's queue —
  silently breaking a feature that exists precisely to unblock billing.

A tenant reaches a **parent** the way a coach does today: because one of that parent's
children is enrolled in one of that tenant's classes. `coach_serves_parent()` already encodes
exactly this shape; it generalises to `tenant_serves_parent()`.

### Table-by-table

| Table | Tenancy | Note |
|---|---|---|
| `tenants` | **is the tenant** | New. |
| `profiles` | `tenant_id` **nullable** | NULL for parents (global) and the platform admin (cross-tenant). Set for tenant admins and coaches. |
| `coaches` | `tenant_id` NOT NULL | A coach belongs to exactly one business. |
| `classes` | `tenant_id` NOT NULL | Denormalised from `coach_id` deliberately — every policy reads it. |
| `students` | `tenant_id` NOT NULL | See above. |
| `parents` | **none — global** | See above. |
| `invoices` | `tenant_id` NOT NULL | Drives the new unique constraint (§3). |
| `credit_notes` | `tenant_id` NOT NULL | Credit is per (parent, tenant) — §3. |
| `billing_periods` | `tenant_id` NOT NULL | **Currently PK is `billing_month` alone — global.** §3. |
| `app_settings` | becomes per-tenant | **Currently global key/value.** §3. |
| `parent_tenants` | **is a tenant link** | New (§6). Which businesses a parent has joined via code. |
| `parent_students` | derived (via student) | Junction; follows the student. |
| `student_class_enrolments` | derived (via class) | Must enforce student.tenant = class.tenant. |
| `lesson_sessions` | derived (via class) | |
| `attendance` | derived (via session→class) | |
| `invoice_items` | derived (via invoice) | |
| `credit_applications` | derived (via invoice) | |
| `payment_records` | derived (via invoice) | |
| `audit_log` | `tenant_id` nullable | Nullable so platform-level actions can be logged too. |

**Rule of thumb:** a table gets a real `tenant_id` column when it is queried directly by an
admin screen or an RLS policy hot path. Everything else derives it through its owner, which
keeps the write path honest (one place to get wrong).

---

## 3. The money model — the part most likely to be underestimated

The RLS rewrite is tedious but mechanical. **This section is where the genuine design risk
is**, because it touches the most safety-critical, most-tested code in the product (51 Deno
tests exist because this is where bugs cost real money). None of it is in `BACKLOG.md`.

### 3.1 Invoices are per (parent, tenant, month)

```sql
UNIQUE (parent_id, billing_month)              -- today
UNIQUE (parent_id, tenant_id, billing_month)   -- required
```

A parent with a child at the school and a child with a private coach must receive **two**
invoices that month — one from each business. Today's constraint forbids it outright.

### 3.2 Credit balance must be per (parent, tenant)

`parents.credit_balance` is a single pooled number, and `HANDOVER.md` §6 documents the
pooling as deliberate. Under tenants it becomes **wrong, not just imprecise**: credit earned
at the school would be spendable against a private coach's invoice, taking money from one
business and giving it to another.

Move the balance to a per-tenant row (e.g. `parent_tenant_balances (parent_id, tenant_id,
credit_balance)`). The `credit_applications` ledger and its three invariants
(`PRD.md` §9.17) re-scope to that pair. **The FIFO draw must never cross tenants.**

### 3.3 Month sealing is per-tenant

`billing_periods` has `billing_month` as its **entire primary key**. Left alone, the school
completing July would seal July for *every* tenant on the platform — every other business
silently short-circuits on `already_complete` and bills nothing. This is the same failure
shape as the empty-month seal that already reached production (`HANDOVER.md` §8.1), but
worse: it crosses a business boundary.

### 3.4 The completeness block is per-tenant

Generation is currently blocked all-or-nothing when any lesson is unmarked (PRD §7.7). That
"all" must mean **within one tenant**. One school's forgotten lesson must not block an
unrelated coach's billing. The all-or-nothing reasoning still holds *inside* a tenant.

### 3.5 `app_settings` is global

`auto_invoice_enabled` and `invoice_run_day` are global key/value rows. One school changing
its run day would change everyone's. These become per-tenant settings with a platform
default. `APP_TIMEZONE` may stay global for now — every user is in SGT, and
`HANDOVER.md` §6 already records that call.

### 3.6 The invoice engine runs as `service_role` and therefore bypasses RLS

**This is the most dangerous item in the document.** The Edge Function uses the service role,
so *none* of the RLS work in §4 protects it. Tenant isolation in billing must be enforced in
**engine code**: `generateInvoices` currently loops every class on the platform and seals one
global month. It must become tenant-scoped — loop per tenant, gate per tenant, seal per
tenant. Getting §4 perfect and leaving `core.ts` alone would produce cross-tenant invoices
through a path RLS never sees.

### 3.7 Credit note reference numbers

`credit_notes.reference_number` is globally UNIQUE (`CN-2026-0001`). Businesses expect their
own sequence, and a shared one leaks volume: a school can infer another tenant's activity
from the gaps. Make numbering per-tenant.

### 3.8 PayNow QR belongs to the tenant, not the coach

Today the QR lives on `coaches.paynow_qr_url` and the parent sees *their coach's* QR. For a
school **the parent pays the school**, not the individual coach — so a school with three
coaches would today show three different payees for one business.

Move the QR to `tenants.paynow_qr_url`. For a private coach, their tenant-of-one's QR is
simply their own, so nothing is lost. This also makes PRD §7.10 correct rather than
coincidental: "the right QR per invoice context" becomes "the invoice's tenant's QR", which
is now well-defined because invoices are per-tenant (§3.1).

---

## 4. Roles and identity

### The enum splits

`user_role` is `('parent', 'coach', 'superadmin')`. `superadmin` is doing two different jobs
and must split:

| Role | `tenant_id` | Sees |
|---|---|---|
| `platform_admin` | NULL | Everything, cross-tenant. **You.** For support and (later) platform billing. |
| `tenant_admin` | set | One business, entirely. A school owner, or a private coach. |
| `coach` | set | **Own classes only** (§5). |
| `parent` | NULL | Own children, across every tenant. |

**Default every existing `is_superadmin()` call site to `tenant_admin`.** Only genuine
platform operations become `platform_admin`. Guessing the other way hands schools each
other's data.

### A private coach holds two roles at once

Their profile is `role = 'tenant_admin'` **and** has a `coaches` row in the same tenant. The
apps already have `coaches`/`parents` as extension tables off `profiles`, so capability is
determined by **which extension rows exist**, not by the enum alone:

- Mobile routes to the coach UI when a `coaches` row exists (not when `role = 'coach'`).
- Admin web admits `tenant_admin` and `platform_admin`.

This is a small change to existing routing and avoids a `tenant_members` join table. If a
tenant ever needs several admins (§8), *that* is when the join table earns its place.

### New helpers

Alongside the existing `current_parent_id()` / `current_coach_id()`:

```
current_tenant_id()          -- the caller's tenant, NULL for parents/platform admin
is_platform_admin()
is_tenant_admin(t uuid)      -- admin OF that specific tenant
tenant_serves_parent(p uuid) -- generalises coach_serves_parent()
```

`is_superadmin()` should be **deleted, not redefined.** Leaving a function with that name and
new semantics is how a call site gets missed — a compile error at every one of its 45 uses is
the goal, not a silent behaviour change.

---

## 5. Coach visibility: own classes only

A coach sees **only their own classes**, not their colleagues'. Anyone needing a
cross-class view uses the tenant admin account, which is the correct home for that
capability.

This is also the **cheap direction to be wrong in**: restrictive → permissive later is
widening a policy and nobody objects. Permissive → restrictive means removing something
coaches have built habits on, after data has already been over-shared. Start closed.

Conveniently, `coach_owns_class()` / `coach_serves_student()` already implement exactly this,
so the coach-facing policies mostly need a tenant guard added rather than a rewrite.

---

## 6. How a parent and child reach the right tenant — join codes

**Decided: per-tenant join codes. No invite links.**

Today a parent self-registers at `swimsync.sg/welcome`, adds a child, and the single global
superadmin assigns them. With tenants, a freshly created child has no enrolment — so **which
school's unassigned queue should they appear in?** "All of them" leaks; "none" strands them.

### The flow

1. A parent registers normally (no tenant context needed at signup).
2. The tenant gives them a **join code** — short, tenant-scoped, regenerable
   (e.g. `SWIM-4821`). The school or coach shares it however they like: WhatsApp, in person,
   over the phone.
3. The parent enters the code in the app. This creates a **`parent_tenants`** row — an
   explicit, durable "this parent deals with this business" relationship.
4. **Add child** is gated on having joined at least one tenant. With one joined tenant it is
   auto-selected; with several the parent picks from *only the tenants they have joined* —
   two options, never two hundred.

A parent with children at a school **and** two private coaches enters three codes and picks
per child. This is the expected common case, not an edge case.

### Why codes rather than a tenant picker

A browsable list of all tenants was considered and rejected. It **publishes your customer
list** to every parent and every competing school; a mis-tap **lands a child in a stranger's
roster** — visible to that tenant's admin and billed by them — because nothing in the flow
proves the parent actually deals with that business; and it stops working at scale.
**Possession of the code is the proof of relationship.** The join-code list a parent
accumulates is exactly the picker they need, scoped to businesses they have a real
relationship with.

### Why links were dropped

An earlier draft proposed `swimsync.sg/join/<tenant>` deep links. Codes supersede them
entirely: they survive WhatsApp mangling a URL, work read aloud over a phone, need no
deep-link routing on native or web (a whole class of Expo routing bugs avoided — cf.
`HANDOVER.md` §3 on the password-reset deep-link work), and produce the same
`parent_tenants` row. There is nothing a link does better.

### A code is not an approval

Anyone holding a code can join a tenant, but joining only grants "I may add a child to this
business." The child still lands in that tenant's **Unassigned** queue and the tenant admin
must assign them to a class before anything bills. **The admin retains control**, so codes
need no approval step for the pilot. Codes are regenerable if one leaks.

### `students.tenant_id` stays NOT NULL

Because add-child is gated on a joined tenant, a student cannot be created without one. The
**platform admin's rescue power is reassignment, not assignment** — moving a student from one
tenant to another. That also covers the realistic error (parent entered the wrong code), not
just the theoretical one, and avoids a nullable column that every students policy would have
to special-case.

---

## 7. Three cross-tenant leaks that exist today

All three are live in production. They are harmless with one business and are data breaches
with two, so they must land **with** the tenant boundary, not after it.

```sql
-- 1. Every signed-in user can read every coach record, platform-wide
CREATE POLICY coaches_select ON coaches FOR SELECT TO authenticated USING (TRUE);

-- 2. Every signed-in user can read every class, platform-wide
CREATE POLICY classes_select ON classes FOR SELECT TO authenticated USING (TRUE);

-- 3. Every signed-in user can read every COACH PROFILE (name, email, phone)
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR role = 'coach' OR is_superadmin());
```

`BACKLOG.md` notes #2. **#1 and #3 are not recorded anywhere** — #3 is the worst of them,
because it exposes coach email and phone across every business on the platform.

Each was a reasonable shortcut for a one-business app: parents legitimately need their own
coach's name and QR. The fix is to scope that need to the tenant the parent actually touches
(`tenant_serves_parent()`), not to grant it globally.

---

## 7a. Tenant branding

`tenants` carries `display_name`, `logo_url` and `paynow_qr_url` from the first migration.
Invoices and invoice emails render the tenant's name and logo, not SwimSync's. Cheap now
(the email builder in `email.ts` already takes structured data); expensive later, because
retrofitting means touching every template and backfilling assets.

`paynow_qr_url` **moves from `coaches` to `tenants`** (§3.8). Parents pay the business, not
the individual coach — a three-coach school must present one payee. For a private coach,
their tenant-of-one's QR is simply their own, so nothing is lost.

## 7b. Coach wages *(phase 5 — independently droppable)*

In scope, but **last**, and designed so it can slip without disturbing anything else. Per §1
it needs no coach-type branch: a wage is owed when the coach is **not** the tenant owner.

### Rate model — a coach-level default with per-class overrides

- **Every coach has a default rate expressed per unit of time** — an amount plus a
  configurable unit (e.g. $30 per 60 min, $15 per 30 min). Duration comes from
  `classes.start_time`/`end_time`, so a 90-minute lane pays correctly with no second rate.
- **Any individual class may override it with a flat per-class rate.** So a coach can teach
  classes 1–3 at their normal hourly rate and class 4 at a special flat rate.
- **Rates are effective-dated, never mutated in place.** Recomputing an old month must not
  reprice history — the same class of bug as the UTC billing month (`HANDOVER.md` §7.12).
  This is an engineering call, not a product one, and is not negotiable in the design.

### When a lesson pays

Evaluated per session, in this order:

| Situation | Coach paid? |
|---|---|
| At least one student `present` / `trial_paid` / `trial_free` | **Yes** |
| All enrolled students `absent` | **No** — nobody turned up |
| `cancelled_coach` | **No** — always, not configurable |
| `cancelled_rain` | **Tenant default** (a per-tenant pay/don't-pay setting), **overridable per session** by the admin |

The "one student turned up" rule is deliberately *attendance-derived*, not a cancellation
concept: a lesson where four students were all marked absent still ran on paper, and this is
what stops it being paid.

### Payouts are durable records, drafted then frozen

A wage run creates a **`coach_payouts`** row per coach per month with itemised
**`coach_payout_items`** — mirroring `invoices` / `invoice_items` / `payment_records`, so
there is an audit trail of what was actually paid.

**Lifecycle: `draft` → `paid`.**

- While **draft**, the payout **recomputes freely** from current attendance. Ordinary late
  corrections simply flow in, with no adjustment machinery.
- On **mark-as-paid** it **freezes** — snapshot, timestamp, and who marked it. Money has left
  the bank; the record must not silently change afterwards.
- A correction arriving **after** freeze becomes an **adjustment item on the next payout**,
  carrying the original session date so it is traceable to the month it belongs to.

This is deliberately *not* the credit-note model. Invoices freeze on generation because a
parent has already been sent one; a payout has no such external artefact until it is paid, so
the draft window costs nothing and removes most adjustments entirely.

### Period and visibility

- **Period is the calendar month**, the same boundary as billing — reusing the tested SGT
  month-boundary logic (`generate-invoices/dates.ts`).
- **The run day is independent:** a per-tenant `wage_run_day`, separate from
  `invoice_run_day`. A school may bill parents on the 7th and pay coaches on the 15th.
- **A coach sees their own payout, read-only, and never anyone else's.** RLS scoped to their
  own `coaches.id`. This is the point of the feature for them; it removes the monthly
  "how much am I getting?" message to the admin.

### Smaller calls (stated, not asked)

- **Rate = amount + `unit_minutes`**; partial units pay **pro-rata, never rounded up**
  (a 45-min class at $30/60min pays $22.50). Rounding up overpays every short lesson quietly.
- **A per-class override replaces** the duration calculation with a flat amount.
- **`trial_free` counts as attendance for pay.** The coach taught the lesson even though
  nobody was billed for it.
- **No hard exclusion of the tenant owner.** A wage exists when a coach **has a rate**; a
  private coach simply has none. Data-driven rather than a rule, and it lets a school owner
  who also teaches pay themselves.

## 8. Deliberately not in this design

- **Multiple admins per tenant.** One `tenant_admin` per tenant for now. Filed in
  `BACKLOG.md`. The design above does not preclude it — that is the point at which a
  `tenant_members (tenant_id, profile_id, role)` table replaces the role-on-profile shortcut.
- **Platform billing (SwimSync charging the school).** The pilot is free. `tenants` is the
  natural billing subject when it arrives, so nothing here blocks it. Do not build it now.
- ~~**Coach wage tracking.**~~ **Now IN scope as phase 5** — see §7b.
- **Cross-tenant students.** A student belongs to one tenant; `one_active_enrolment_per_student`
  already enforces one active class. A child taking lessons at two businesses is out of scope.
  Note this *is* a real thing in Singapore — revisit only on demand.
- **Per-tenant timezone.** `APP_TIMEZONE` stays global (`HANDOVER.md` §6, §8a).

---

## 9. Sequencing

**Decided: tenanting comes first; the first real invoice run is postponed behind it.**

An earlier draft sequenced tenanting *after* a 1 Aug billing run, to keep that run on a
known-good single-tenant engine. The user's call is to postpone their own billing test
instead. That is the right trade: July's attendance data is not going anywhere, and billing
it *after* tenanting means it is billed once, on the schema it will live on — rather than
billed on the old model and then migrated underneath.

**Consequences to carry into the plan:**

- July 2026 attendance must survive the migration intact and be billable afterwards under
  `(tenant, month)`.
- The possibly-still-sealed `billing_periods` row for `2026-07` (`HANDOVER.md` §8.1) must be
  resolved **as part of the backfill**, not left for the first post-migration run to trip on.
- The billing engine will meet real data for the first time *and* be newly tenant-scoped at
  the same moment. That doubles the value of the cross-tenant test suite and of a dry run
  against a production snapshot before the real run.

Phases are detailed in `TENANCY_PLAN.md`. Order: **0** prerequisites → **1** schema, backfill,
RLS → **2** money model + engine → **3** join codes + platform admin → **4** branding →
**5** wages (droppable).

**Do not onboard the school onto the current schema "just to start testing".** With one
global superadmin and the three leaks in §7, the school's families would be visible to the
existing coach and vice versa.

---

## 10. Decisions (all resolved 2026-07-18)

| # | Question | Decision |
|---|---|---|
| 1 | §6 join flow | **Join codes, no links.** Parent registers, enters a per-tenant code, picks per child from joined tenants. `students.tenant_id` stays NOT NULL; platform admin **reassigns**. |
| 2 | §3.2 credit across tenants | **Never crosses tenants; pools freely within one.** Explicitly reverses `HANDOVER.md` §6 ("credit is pooled per parent") with the user's go-ahead. |
| 3 | Tenant branding | **In, from the first migration** — name, logo, PayNow QR on `tenants`; invoices and emails render them (§7a). |
| 4 | Tenant 1's admin | **The real coach owns their tenant** (`tenant_admin` + `coach`); the user steps back to `platform_admin`. Tenant 1 therefore exercises the real private-coach shape. |
| 5 | Delivery | **Incremental merges**, each a no-op while only one tenant exists (§9). |
| 6 | Wages | **In, as phase 5**, independently droppable (§7b). |
| 7 | Sequencing vs 1 Aug | **Tenanting first**; the first real invoice run is postponed behind it (§9). |

| 8 | §7b payout model | **Durable `coach_payouts` records**, draft → frozen on mark-as-paid; corrections after freeze become next-period adjustments. |
| 9 | §7b wage period | **Calendar month**, with a per-tenant `wage_run_day` independent of `invoice_run_day`. |
| 10 | §7b coach visibility | **Coach sees their own payout, read-only.** Never anyone else's. |

**Still open, deliberately** — does not block any phase:

- **What happens to a coach who leaves a school.** Their classes and attendance history belong
  to the tenant; their profile does not. It decides whether `coaches.tenant_id` can ever be
  reassigned. Not needed for the pilot.
- **Whether a non-calendar wage cycle** (e.g. 16th–15th) is ever wanted. The design assumes
  calendar months; a different boundary would be a new period concept, not a setting.
