# SwimSync — Multi-Tenancy Implementation Plan

_Drafted: 2026-07-18 · Status: **ALL PHASES COMPLETE (0–5)**_

How to build what `TENANCY_DESIGN.md` specifies. Design questions are settled there
(§10); this document is order, files, verification and risk.

**Target:** a swim school pilots in **August 2026** with a few coaches and students.
**Sequencing:** tenanting lands first; the first real invoice run is postponed behind it.

**Six phases.** Each merges to `main` on its own and is a behavioural no-op while only one
tenant exists — with two exceptions flagged explicitly (1.5 and 3). Phase 5 is droppable.

> **Deploying is three separate manual steps** (`HANDOVER.md` §3). A `git push` deploys the
> two web apps via Vercel and **nothing else**. Migrations need `supabase db push`; the
> engine needs `supabase functions deploy generate-invoices`. After every backend phase run
> `supabase migration list` and confirm no row has an empty `remote` column. A merged-but-
> undeployed migration once sat broken in production for six days.

---

## Phase 0 — Prerequisites — ✅ **COMPLETE 2026-07-18**

Nothing here is tenanting; it is all removing hazards that make tenanting riskier.

> **Phase 0 was NOT the no-op it was scoped as.** Extracting the completeness rule revealed
> the four copies had **diverged**, and the engine's was wrong in a way that silently
> underbilled: it inspected only `lesson_sessions` rows that exist, so a lesson nobody
> touched was invisible to it — the month reported **"complete — billing month sealed"** and
> that lesson could never be billed afterwards. Proven with a failing test before any fix;
> full write-up in `HANDOVER.md` §7.17. The engine now derives expected lesson dates like
> everything else, from one shared definition. **Deno 51 → 55; both frontends 38 → 49.**

### 0.1 Extract the completeness-rule helper — ✅ done

`BACKLOG.md` build-order #1, and a hard prerequisite: phase 2 makes the completeness gate
per-tenant, and the rule was **hand-written in four places** that had already diverged.

Shipped as `lib/attendanceCompleteness.ts` — `isLessonFullyMarked`, `countMarked`,
`unmarkedStudents`, `unmarkedDates` — **duplicated byte-identical in both apps** (the same
deliberate arrangement as `lessonDates.ts`: separate npm projects, no workspace), with its
own test file in each. Callers keep their own *window* (billing month vs coach backlog);
only the meaning of "marked" is shared.

| File | Was | Now |
|---|---|---|
| `generate-invoices/core.ts` | inspected only sessions that EXIST — **the bug** | derives expected dates via `dates.ts`; own Deno copy |
| `SwimSyncAdmin/lib/classCoverage.ts` | own filter loop | `unmarkedDates()` |
| `SwimSyncApp/app/(coach)/today/index.tsx` | `fullyMarked` | `isLessonFullyMarked()` |
| `SwimSyncApp/app/(coach)/classes/[id]/roster.tsx` | own filter | `countMarked()` |

**Three edits, not one** — the engine's Deno copy is unavoidable (no npm resolution in Edge
Functions), so the byte-identical pair plus the Deno twin is the arrangement to maintain.

Also added: `expectedLessonDates()` to `generate-invoices/dates.ts` (mirrors the app twin),
and `completeMonth()` / `enrolledAt` / `dayOfWeek` to the Deno test helpers — a fixture that
creates one session in a month where the class met four times is now correctly an
*incomplete* month, which is what broke four existing tests and was the fix proving itself.

### 0.2 Settle the sealed July row — ✅ **DONE 2026-07-18**

**July 2026 has been unsealed on production by the user.** So `billing_periods` should be
empty (or hold no `2026-07` row), and phase 1.4 step 6 has nothing to migrate for that month.
**Re-confirm at backfill time rather than trusting this line** — it is a snapshot, and the
table is written by every completing invoice run.

### 0.3 Make the Deno suite run twice in CI — ✅ done

Gotcha §7.15: manual runs seal months, so a suite that passes once can fail on the second
run from leaked state. Phase 2 rewrites sealing entirely. Running the suite twice in CI
turns that class of bug from "discovered next week" into "discovered on the PR".

**Verified 2026-07-18:** 34 pgTAP · **55** Deno (green twice in a row) · **49** admin ·
**49** app; both apps `tsc --noEmit` clean; both `attendanceCompleteness.ts` twins and both
`lessonDates.ts` twins confirmed byte-identical by `diff`.

---

## Phase 1 — Schema, backfill, RLS — ✅ **COMPLETE 2026-07-18**

The foundation. Largest single phase; nothing user-visible except 1.5.

> **Built as EXPAND/CONTRACT, changed from the original plan.** The plan said to
> drop `parents.credit_balance` and `coaches.paynow_qr_url` here. That was wrong: both
> have live readers across the two apps and the engine, so phase 1 would have shipped a
> broken deploy — and a `git push` auto-deploys the web apps while migrations need a
> separate manual `supabase db push`, so they can never land atomically. Worse, it would
> have left every suite red across the gap into phase 2, which is the money model, i.e.
> exactly when the regression signal matters most.
>
> **The columns therefore stay, deprecated and dual-written**, and are dropped by a
> CONTRACT migration once their readers move. The same discipline applies to constraints:
> `tenant_id` is only NOT NULL where a trigger already guarantees it (`coaches`,
> `classes`). `students`, `invoices`, `credit_notes` and `billing_periods` stay nullable
> until phases 2–3 update their writers, and the `invoices` UNIQUE swap and the
> `billing_periods` PK swap wait with them. **Dropping the old UNIQUE early would have
> been double billing** — two NULL-tenant invoices for one parent-month do not conflict,
> because NULLs never conflict in a UNIQUE index.
>
> **Five real bugs surfaced, four of them found by tests rather than review:**
> 1. **`tenants`, `parent_tenants` and `parent_tenant_balances` had policies but RLS was
>    never ENABLED** — so the policies were inert and every join code was readable by any
>    signed-in user, defeating the whole reason codes exist instead of a tenant picker.
> 2. **Mutual policy recursion** — `classes_select` consults enrolments and
>    `enrolments_select` consults classes. It could not happen before *because*
>    `classes_select` was `USING (TRUE)`: the leak was also what kept the graph acyclic.
>    Fixed with SECURITY DEFINER lookups (`class_tenant`, `session_tenant`,
>    `parent_has_child_in_class`).
> 3. **The credit-note trigger wrote `parents.credit_balance`** and inserted `credit_notes`
>    without a tenant — it would have thrown on the next attendance correction.
> 4. **`close_student_enrolment()` called the dropped `is_superadmin()`.** A function body
>    is not a tracked dependency, so this would have failed at RUNTIME, not at migration.
> 5. **Storage policies** also called `is_superadmin()` — caught by the DROP, which is
>    precisely why dropping beats redefining.
>
> **Verified:** pgTAP 34 → **52** (incl. 18 new cross-tenant isolation assertions) ·
> Deno **55**, green twice · admin 49 · app 49 · both apps typecheck. The backfill was
> **rehearsed against a realistic pre-migration dataset** — old schema, a parent with an
> enrolled child and an unassigned one, an invoice, a credit note and a non-zero credit
> balance — not just against an empty database. Credit reconciled exactly.

### 1.1 New tables

```
tenants            id · slug · display_name · logo_url · paynow_qr_url · kind
                   join_code (unique) · rain_pays_coach (bool, default false)
                   created_at
parent_tenants     parent_id · tenant_id · joined_at        UNIQUE(parent_id, tenant_id)
parent_tenant_balances
                   parent_id · tenant_id · credit_balance   PK(parent_id, tenant_id)
```

`kind` is `private | school` and exists for onboarding copy and future pricing only.
**It must never appear in an RLS policy** (`TENANCY_DESIGN.md` §1).

### 1.2 `tenant_id` columns

NOT NULL on `coaches`, `classes`, `students`, `invoices`, `credit_notes`.
Nullable on `profiles` (NULL = parent or platform admin) and `audit_log` (NULL =
platform-level action).

Two key changes:

- **`billing_periods`** — primary key becomes `(tenant_id, billing_month)`. It is
  `billing_month` alone today, so one tenant sealing a month would seal it for everyone.
- **`app_settings`** — `auto_invoice_enabled` and `invoice_run_day` become per-tenant.
  `APP_TIMEZONE` stays global.

Add a CHECK or trigger enforcing `student.tenant_id = class.tenant_id` on
`student_class_enrolments`. A cross-tenant enrolment would otherwise be the single most
damaging row in the database.

### 1.3 Role split

`user_role` gains `platform_admin` and `tenant_admin`. **Delete `is_superadmin()` rather
than redefining it** — a hard error at all 45 call sites is the goal; a silent semantic
change is how one gets missed.

New helpers: `current_tenant_id()`, `is_platform_admin()`, `is_tenant_admin(uuid)`,
`tenant_serves_parent(uuid)`.

> **PRODUCTION NAMING — a manual step after `supabase db push`.** The backfill names
> each tenant after its coach's `full_name`, which is right for a private coach but not
> when the business trades under a different name. For production the intended values are
> **coach `Coach Kah Hang`** and **business `Coach Kah Hang Swimming Lessons`**. Set the
> business name with **Rename** on the admin dashboard once the migration has run — it
> appears on invoices and invoice emails, so it wants to be the business's name, not an
> operator's. (The local seed deliberately keeps the fictional "Coach Marcus".)

### 1.4 Backfill (one-way, needs a verified backup first)

1. Create tenant 1 from the existing real coach — `kind = 'private'`.
2. Stamp `tenant_id` on every existing coach, class, student, invoice, credit note.
3. `coaches.paynow_qr_url` → `tenants.paynow_qr_url`; drop the coach column.
4. `parents.credit_balance` → `parent_tenant_balances` for tenant 1; drop the old column.
5. Backfill `parent_tenants` for every existing parent — **required**, or every current
   parent loses the ability to add a child in phase 3.
6. Migrate `billing_periods` rows to `(tenant 1, month)`, applying 0.2's finding.
7. Roles: the user `superadmin` → `platform_admin` (`tenant_id` NULL); the real coach →
   `tenant_admin` **and** keeps their `coaches` row, making tenant 1 a genuine
   private-coach tenant of one.

### 1.5 ⚠️ The one deliberate behaviour change in this phase

Step 7 gives the real coach **admin-panel access they do not have today**. That is the
intended end state, but it is a real change to a real person's account — tell them, and
check the admin panel renders correctly for a `tenant_admin` who is also a coach (the
private-coach shape, which nothing has ever exercised).

### 1.6 RLS rewrite

All 37 policies across 15 tables. Mechanical: every `is_superadmin()` becomes
`is_platform_admin() OR is_tenant_admin(<row's tenant>)`. Coach policies keep
`coach_owns_class()` / `coach_serves_student()` and gain a tenant guard — coaches see
**only their own classes** (`TENANCY_DESIGN.md` §5).

**Close the three leaks** (§7) in this same migration:

```sql
coaches_select  USING (TRUE)                       -- every coach record, platform-wide
classes_select  USING (TRUE)                       -- every class, platform-wide
profiles_select USING (… OR role = 'coach' OR …)   -- every coach's name, email, phone
```

Replace each with tenant-scoped visibility via `tenant_serves_parent()`. A parent needs
their *own* coach's name and QR — not everyone's.

Also add a tenant guard to `close_student_enrolment()` (migration `20260718000200`); it is
`SECURITY DEFINER` and therefore bypasses the policies above.

**Verify:** new `supabase/tests/tenant_isolation.test.sql` — a second tenant with its own
coach, parent, student, class, invoice and credit note, proving each role sees only its
own. **At least one case must be expected to FAIL**, per gotcha §7.16: an RLS probe written
without an explicit transaction runs as `postgres` and bypasses RLS, so every case "passes"
including the ones that must not. Existing 34 pgTAP must stay green.

---

## Phase 2 — Money model + engine — ✅ **COMPLETE 2026-07-18**

> **Shipped.** The engine runs one tenant at a time — scoped via `opts.tenant_id`
> (the admin button) or looping every tenant independently (the cron, returning a
> `per_tenant` breakdown). Sealing, the completeness block, `auto_invoice_enabled`,
> `invoice_run_day`, credit and the blocked-generation alert are all per-tenant.
> Constraints tightened: `invoices`/`credit_notes`/`billing_periods` `tenant_id` NOT NULL,
> the `billing_periods` PK swap, and `invoices` UNIQUE → `(parent_id, tenant_id,
> billing_month)`. Credit-note references are numbered per tenant with
> `UNIQUE (tenant_id, reference_number)`.
>
> **Beyond the plan, because they would have shipped broken:**
> - **The role split had to reach the apps.** `superadmin` no longer exists, so the admin
>   login rejected *every* account — the panel was unreachable. Also fixed:
>   `create-coach` (now passes the caller's tenant, since the auth trigger refuses to
>   guess), the mobile `Role` union, and the blocked-alert recipients.
> - **The admin's billing controls still wrote `app_settings`**, which the engine no longer
>   reads — a switch that saved happily and did nothing. Moved onto `tenants`.
> - **The alert throttle was keyed by month alone**, so the first tenant blocked in a month
>   would have silenced every other business's alert. Now keyed by tenant *and* month.
>
> **Verified:** Deno 55 → **61**, green twice, incl. six cross-tenant billing tests. The
> credit-isolation test was **mutation-checked** — reverting the balance lookup to the
> pooled column fails it, so it pins the real control rather than a redundant one.
> pgTAP 52 · admin 49 · app 49 · both typecheck · and a new
> `verify-tenant-admin.mjs` drives the **real admin panel 10/10** (tenant admin logs in,
> run day persists to `tenants`, platform admin gets the notice rather than a dead button).

### Original plan for reference

The highest-risk phase: it rewrites the most-tested, most safety-critical code in the
product. **`TENANCY_DESIGN.md` §3.6 is the thing to keep in mind throughout — the engine
runs as `service_role` and bypasses RLS entirely, so none of phase 1 protects it.**

### 2.1 Engine (`core.ts`)

Currently loops every class on the platform and seals one global month. Becomes:

- **loop per tenant** — tally, gate, generate, seal, each within one tenant;
- **completeness block is per-tenant** — one school's forgotten lesson must never block an
  unrelated coach's billing. All-or-nothing still holds *inside* a tenant;
- **sealing is per-tenant**, and the §8.1 empty-month guard must be preserved per tenant —
  a tenant with nothing recorded stays open;
- **run day / auto switch** read per-tenant settings.

Preserve the two-phase structure that fixed multi-class under-billing (`HANDOVER.md` §8A) —
tally across classes first, create invoices once per parent afterwards. **Per parent *per
tenant*** now.

### 2.2 Invoices and credit

- `UNIQUE (parent_id, tenant_id, billing_month)`.
- Credit FIFO draws only from `parent_tenant_balances` for **that** tenant. Pools freely
  across a parent's children *within* a tenant; never crosses.
- `credit_applications` invariants re-scope to `(parent, tenant)`.
- `credit_notes.reference_number` becomes a per-tenant sequence — a global one leaks volume
  between tenants.

### 2.3 Admin route + UI

`SwimSyncAdmin/app/api/generate-invoices/route.ts` scopes to the caller's tenant. Do **not**
reintroduce `force: true` (gotcha §7.8); `force` still means only "skip the sealed-month
guard".

**Verify:** all 51 Deno tests revisited, plus new ones for: two tenants billed
independently; a parent with children in two tenants receiving **two** invoices; credit
earned in tenant A not drawable against a tenant B invoice; tenant A's incomplete month not
blocking tenant B; sealing A not sealing B. **Run the suite twice.** Then a dry run against
a production snapshot before any real generation.

---

## Phase 3 — Join codes, onboarding, platform admin

### 3.1 Parent-side (mobile)

- Enter-join-code screen → creates a `parent_tenants` row.
- Add-child gated on ≥1 joined tenant; auto-selects when there is exactly one, otherwise
  a picker over **joined tenants only**.
- Manage joined tenants (view, add another).

### 3.2 Tenant admin

Display and regenerate the join code.

### 3.3 Platform admin ("super-super admin")

- **Tenant switcher** in the admin panel — view any tenant for support.
- **Reassign a student's tenant** — fixes a wrong code entered, the realistic error.
- Cross-tenant list of all tenants.

### 3.4 ⚠️ Behaviour change

New parents can no longer add a child without a join code. Existing parents are unaffected
**because 1.4 step 5 backfilled their `parent_tenants` rows** — confirm that actually
happened before this phase reaches production.

**Verify:** a `run-ui-playwright` driver covering: parent enters a code, adds a child, child
appears in the right tenant's unassigned queue; a parent joins two tenants and places one
child in each; platform admin reassigns a student. Follow gotcha §7.10 — assert only on
strings unique to the target screen, since a navigated-away screen stays in the DOM.

---

## Phase 4 — Branding and parent-facing billing — ✅ **COMPLETE 2026-07-19**

> **Shipped**, including the CONTRACT migration that finally drops
> `parents.credit_balance` and `coaches.paynow_qr_url` — the expand/contract cycle begun
> in phase 1 is now closed, and the dual-writes are gone from both the engine and the
> credit-note trigger.
>
> **⚠️ DEPLOY ORDER IS THE MIRROR OF THE EXPAND STEP.** The phase-4 *app* deploy must go
> out BEFORE `20260719000300_contract_legacy_columns.sql` is pushed. Run the migration
> first and the currently-deployed apps start querying columns that no longer exist. The
> migration carries this warning in its own header too.
>
> **Verified 6/6 in the real app** (`verify-tenant-branding.mjs` + fixture): a parent with
> children at TWO businesses sees both invoices for the same month, each labelled with the
> business that issued it, the correct summed credit on Home, and — the money-critical one
> — a PayNow payee resolved from the **invoice's business**, not the coach who taught the
> lesson. That last check was **mutation-tested**: reverting to coach-based resolution
> fails it.
>
> Also: a school coach can no longer set the PayNow QR (it is the business's, and a school
> has one bank account) — they see it read-only with a note to ask their admin. A private
> coach, being their own tenant admin, is unaffected.
>
> pgTAP 58 · Deno 61 → **64** · admin 49 · app 49 · both typecheck.

### Original plan for reference

- `tenants.display_name` / `logo_url` on invoices and invoice emails (`email.ts`). Keep
  sending isolated from billing (`HANDOVER.md` §6) — no engine changes here.
- PayNow QR resolved from the invoice's **tenant**, not the coach (§3.8). Parent app +
  admin.
- **Parent Billing tab grouped by tenant.** With "multiple kids, multiple private coaches"
  as the expected common case, an ungrouped list of invoices is unreadable — the parent
  cannot tell who each invoice is from.
- Tenant admin uploads name/logo/QR.

**Verify:** a parent with children in two tenants sees two clearly-labelled invoice groups
with the right logo and the right QR on each.

---

## Phase 5 — Coach wages — ✅ **COMPLETE 2026-07-19**

> **Shipped.** Computation lives in Postgres rather than a second Edge Function: every
> input is already there, there is no billing-style external side effect to isolate, and
> the coach app reads STORED payout rows instead of re-deriving pay on a phone.
>
> **No private-vs-school branch anywhere** — a wage exists when a coach *has a rate*, so a
> private coach falls out of payroll on data rather than a rule. That is §1 paying off.
>
> **Rates are effective-dated and inserted, never updated.** Pinned by a test that gives a
> raise in June and asserts a March lesson still prices at the old rate.
>
> **Two bugs found by driving it, not by review:**
> - A blank rate amount saved as **$0** (`Number("")` is 0, finite and ≥ 0) — a coach then
>   reads as "on payroll" and earns nothing, which is worse than having no rate at all.
> - The driver's own `input[type=number]` selector hit the policy card's `wage_run_day`
>   field instead of the rate; the bug above is what that mistake exposed.
>
> **Verified:** pgTAP 58 → **79** (21 new: the full pay-decision table, pro-rata, the flat
> override, effective dating, draft→freeze, adjustments, and coach/rate RLS) plus
> `verify-coach-wages.mjs` **10/10** across both real UIs, asserting the frozen payout in
> the database rather than trusting the toast.

### Original plan for reference

Fully specified in `TENANCY_DESIGN.md` §7b. Not needed to run the pilot; if August tightens,
this slips without touching phases 1–4.

### 5.1 Schema

```
coach_rates            coach_id · amount · unit_minutes · effective_from
class_rate_overrides   class_id · flat_amount · effective_from
session_pay_overrides  lesson_session_id · pays_coach · set_by · set_at
coach_payouts          tenant_id · coach_id · period_month · gross_amount
                       status(draft|paid) · generated_at · paid_at · paid_marked_by
                       UNIQUE(tenant_id, coach_id, period_month)
coach_payout_items     payout_id · lesson_session_id · basis · minutes · amount
                       · is_adjustment · original_period
tenants                + rain_pays_coach · wage_run_day
```

**Rates are effective-dated, never mutated in place.** A rate change must not reprice a
past month — same class of bug as the UTC billing month (`HANDOVER.md` §7.12). This is the
single most important line in the phase.

### 5.2 Computation

Per session, in order: `cancelled_coach` → never pays · all enrolled students `absent` →
no pay · ≥1 student `present`/`trial_paid`/`trial_free` → pays · `cancelled_rain` →
`tenants.rain_pays_coach`, overridable per session.

Amount = class override if one is in effect at that date, else
`rate.amount × (class duration ÷ rate.unit_minutes)`, **pro-rata, not rounded up**.

Reuse `previousBillingMonth()` / `dateInTimeZone()` from `generate-invoices/dates.ts` for
the period boundary — do not re-derive it. Gotchas §7.7 and §7.12 both live here.

### 5.3 Lifecycle

Draft payouts recompute on read. Mark-as-paid snapshots and freezes. A correction to a
frozen period creates an adjustment item on the next payout with `original_period` set.

### 5.4 Surfaces

Admin: rates, per-class overrides, `rain_pays_coach`, `wage_run_day`, the payout run and
mark-as-paid. Coach mobile: own payout, read-only, RLS-scoped to their own `coaches.id`.

**Verify:** unit tests for the pay-decision table (each row a case), pro-rata arithmetic, and
effective-dated rates — specifically that **recomputing an old month after a rate change
returns the old amount**. Plus RLS proof that coach A cannot read coach B's payout.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Engine bypasses RLS** (`service_role`) — a perfect phase 1 still permits cross-tenant invoices | Treat 2.1 as security work, not refactoring. Cross-tenant billing tests are mandatory, not optional. |
| **Backfill is one-way** against live production data | Verified backup first. Rehearse the whole migration on a production snapshot locally before `db push`. |
| **RLS probes silently pass** as superuser | Gotcha §7.16 — wrap in explicit transactions; require at least one expected FAIL. |
| **Migration merged but not deployed** | `supabase migration list` after every backend phase; confirm no empty `remote`. |
| **Credit model reversal** loses or double-counts balances | Reconcile `SUM(parent_tenant_balances) = SUM(old parents.credit_balance)` as a backfill assertion. |
| **Phase 3 strands existing parents** | 1.4 step 5 is load-bearing; assert every existing parent has ≥1 `parent_tenants` row before phase 3 ships. |
| **July billing postponed then forgotten** | It becomes the first post-tenanting run. Track it explicitly in `HANDOVER.md` §9. |

---

## Definition of done

The school can be onboarded as tenant 2 when:

1. All suites green, Deno twice, both apps typecheck.
2. `tenant_isolation.test.sql` proves tenant 1 and tenant 2 cannot see each other —
   **written and passing before onboarding, not after**.
3. A parent with children in two tenants receives two correct invoices, with correct
   per-tenant credit.
4. July 2026 has been billed under the new model.
5. Every migration shows a non-empty `remote` in `supabase migration list`.
6. The three §7 leaks are closed, verified by a signed-in user from tenant 2 being unable to
   read tenant 1's coaches, classes or coach profiles.
