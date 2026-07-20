# SwimSync — Prepaid Lesson Packages: Design & Implementation Plan

_Drafted 2026-07-20. Status: **plan — nothing below is built.** This document is the
plan of record for the packages feature; it graduates into PRD.md section(s) as
phases ship, the same way TENANCY_DESIGN.md did._

Mitigations from `/plan-review` are inlined next to the step they govern, marked
`⚠ RISK n`. The pre-commit gate at the bottom is walked before every commit in this
work. Risk ranking (most → least): **1** billing engine · **2** correction trigger ·
**3** RLS on new tables · **4** live-balance drift · **5** purchase integrity ·
**6** deploy ordering · **7** emails/UI.

---

## 1. The model (decisions locked with the user, 2026-07-20)

| Decision | Answer |
|---|---|
| Unit of storage | **Dollars** per package instance; the lesson counter is derived (`balance ÷ rate`) and is always exact because drawdown is locked-rate |
| Drawdown rate | The package's **locked rate, always** — regardless of the class's walk-in price. A price rise never touches an existing package; families meet the new price at renewal (a **new product**, never an edit) |
| Shortfall | Package floors at $0 (enforced by CHECK); further lessons bill at the **class's own effective-dated rate** via `class_rate_on`, i.e. today's ad-hoc path |
| Scope | Tenant-defined **class category** on the package (nullable = all classes). Categories are the class axis; package tiers (10 @ $40, 50 @ $30) are **products** against one category — a class is never duplicated per tier |
| Held by | **(parent, tenant)** — pools across siblings, never crosses tenants |
| Money moves | **At invoice time only**, in the engine. All live displays are derived |
| Precedence | Package covers its own in-scope lines at its rate; credit notes then apply to the remaining net. Two pots, never mixed |
| Multiple packages | FIFO by **earliest expiry**; ties broken by earliest `confirmed_at`, then id (deterministic) |
| Purchase | Parent requests in-app → PayNow QR → `pending` → admin confirms → `active`. Admin can also record a sale directly as `active` |
| Terms snapshot | Product terms (rate, value, validity) are **snapshotted onto the instance at request time**; confirm only flips status. A fact about a sale is never a live lookup |
| Expiry | `expires_on = confirmed_at + validity_months` (NULL while pending). Coverage judged against the **lesson's session_date**, not generation time. "Expired" is **derived from the date** — never a stored status flip, no cron |
| Corrections | Package-funded lesson corrected billable→non-billable: value **restored to the package** (even if since expired); **no cash credit note** for that line |
| Ad-hoc families | **Provably untouched** — a parent with no active package takes today's code path |
| Low-balance filter | Admin students page filters families whose applicable **live** balance ≤ N lessons; **N is per-tenant** (`tenants.low_package_lessons`, default 2), not hardcoded |
| Refunds | **Out of scope** — admin cancels the package (remaining value shown at cancellation), cash settled offline. Backlog item |
| Emails | Request → PayNow-instructions email; confirm → "package active" email. Business-branded, best-effort, isolated, no-op without key |

Deliberately not built: arbitrary-amount top-ups (buy another package instead),
per-student packages, parent-visible pricing pages, automatic expiry notifications
to parents, refund flows in-app.

---

## 2. Phase 1 — Schema (EXPAND)

New migration(s), all additive:

- **`class_categories`** — `tenant_id, name`; unique per tenant on
  `(tenant_id, lower(trim(name)))` (the `tenant_levels` expression-index pattern).
  `classes.category_id` nullable FK, `ON DELETE SET NULL` (deleting a category
  un-categorizes, never deletes classes — the `tenant_levels` rule).
- **`package_products`** — `tenant_id, name, category_id NULL, lesson_count,
  rate_per_lesson, validity_months, is_active`.
  - ⚠ RISK 5 — CHECKs: `rate_per_lesson > 0`, `lesson_count > 0`,
    `validity_months > 0`. A $0-rate package is an infinite package (§7.22's
    `Number("")` family, worse than the $0 wage). The DB refuses it even if a form
    coerces badly.
  - ⚠ RISK 5 — products are **immutable in money**: a BEFORE UPDATE trigger rejects
    changes to `rate_per_lesson`/`lesson_count`/`validity_months`/`category_id`;
    only `name` and `is_active` may change. A price change is retire + new product.
    Structural, not a UI convention.
- **`parent_packages`** (the instance) — `parent_id, tenant_id NOT NULL, product_id,`
  snapshot columns `rate_per_lesson, total_value, category_id, validity_months`,
  ledger-backed `value_remaining`, `expires_on DATE NULL`, `status
  pending|active|cancelled`, `requested_at, confirmed_at, confirmed_by`.
  - ⚠ RISK 1 — `CHECK (value_remaining >= 0)` and
    `CHECK (value_remaining <= total_value)`: the floor-at-zero and the
    restore-cannot-overfill rules live in the DB, not only in engine code.
  - ⚠ RISK 5 — snapshot columns are filled **at request time** from the product;
    pgTAP asserts that editing/retiring the product afterwards leaves a pending
    instance's terms unchanged.
- **`package_applications`** — `parent_package_id, invoice_item_id, amount,
  applied_at, reversed_at NULL, reversed_by NULL`. Append-only, `CHECK (amount > 0)`,
  `UNIQUE (invoice_item_id) WHERE reversed_at IS NULL` — one live funding per line.
  Balance + ledger, exactly the `credit_applications` arrangement.
- **`invoices.package_applied NUMERIC NOT NULL DEFAULT 0`** — net = gross −
  package_applied − credit_applied. DEFAULT 0 means every existing row and every
  ad-hoc invoice is automatically correct.
- **`tenants.low_package_lessons INTEGER NOT NULL DEFAULT 2`** with
  `CHECK (low_package_lessons >= 0)` — the admin-configurable filter threshold.
- **Live-balance function** `package_live_balances()`:
  `value_remaining − Σ(rate × billable attendance rows in scope, confirmed_at ≤
  session_date ≤ expires_on, not yet invoiced)` per active package, plus the same
  aggregated per (parent, tenant).
  - ⚠ RISK 4 — this is **the only derivation of pending draws anywhere**. The
    parent app and the admin filter both call it. **Do NOT reimplement "lessons
    left" in TypeScript in either app** — a second copy is §7.18 verbatim.
  - ⚠ RISK 4 — **SECURITY INVOKER**, RLS-respecting (the §7.35 platform-overview
    trap is SECURITY DEFINER aggregates; this one deliberately isn't one).
- RLS, on **every** new table:
  - ⚠ RISK 3 — explicit `ENABLE ROW LEVEL SECURITY` per table (§7.20: policies on a
    table with RLS off are not consulted). **Assertion after migration:** the §7.20
    audit query returns **zero** rows:
    `SELECT relname FROM pg_class WHERE relkind='r' AND
    relnamespace='public'::regnamespace AND NOT relrowsecurity;`
  - ⚠ RISK 3 — parent sees own instances/applications; tenant admin sees their
    tenant's; no coach policies (deny by default — coaches don't handle family
    money). Cross-table reach via SECURITY DEFINER helpers only, never a bare
    `EXISTS` (§6 recursion rule).
  - ⚠ RISK 3 — the parent request flow is `insert().select()`: the INSERT's row
    must immediately pass the SELECT policy (§7.1). pgTAP test does the insert **as
    a parent role inside a transaction** (§7.16: `SET LOCAL ROLE` outside a
    transaction silently runs as postgres) and includes at least one **expected
    DENY**, so a silently-superuser session is visible.
  - Grants per §6 ("grants matter"): explicit DML grants; default privileges do not
    cover policy intent.
- pgTAP suites added this phase: category tenant isolation; product immutability
  trigger; instance snapshot-at-request; parent/parent package isolation;
  cross-tenant package isolation; the CHECK constraints (each proven by an
  expected-failure insert).

## 3. Phase 2 — Billing engine (`core.ts`)

In engine phase 2 (per-parent invoice creation), items already sorted
chronologically:

1. Load `status = 'active'` packages for (parent, tenant), ordered
   `expires_on, confirmed_at, id`.
2. Per item, in date order: if the item's class category matches the package scope
   (NULL scope = any class of this tenant), `confirmed_at ≤ session_date ≤
   expires_on`, and `remaining ≥ rate` → price the line at the **package rate**,
   record a `package_applications` row, decrement.
3. Uncovered items keep `rateOn()` pricing (the missing-rate hard failure stays —
   never 0, never `price_per_lesson`).
4. Existing credit-note FIFO applies to the post-package remainder, **unchanged**.

Inline mitigations:

- ⚠ RISK 1 — **the no-package path must be the existing code.** Structure the
  change so package logic is entered only when the parent's package list is
  non-empty; a parent with none executes the same statements as today.
  **Assertion:** a Deno regression test runs the full engine on a no-package
  fixture and asserts the result (invoice rows, amounts, credit application,
  `created[]` shape) is identical to the pre-change engine's recorded output.
- ⚠ RISK 1 — **every new query carries `.eq("tenant_id", tenantId)`.** The engine
  bypasses RLS; the filter is the only isolation (§6). **Assertion:**
  `grep -n "parent_packages\|package_applications" core.ts` — every `.from()` hit
  in engine code must show a tenant filter on the same chain.
- ⚠ RISK 1 — write order mirrors the credit path: ledger row, then balance update;
  any package-write failure sets `invoiceWriteFailed = true`. **Assertion:** a Deno
  test proves a failed package write leaves the month **unsealed** (§7.17: the seal
  conditions are a conjunction — a new failure mode must feed it).
- ⚠ RISK 1 — **prohibition:** do NOT add any package-related bypass to `force`;
  `force` still means only "skip the sealed-month guard" (§7.8).
- ⚠ RISK 1 — **every new test is run against the un-fixed engine first** and must
  fail there (§7.25 — a test that passes on the code it exists to catch is
  worthless). Record which tests are discriminating vs regression guards, next to
  the tests.
- ⚠ RISK 1 — **run the Deno suite twice back-to-back** (§7.15: sealing leaks state;
  once proves nothing).

New Deno tests (beyond the regression above): mixed coverage on one invoice;
mid-month exhaustion cutover (package rate → class rate, chronological); FIFO
across two packages incl. the expiry tie-break; expiry boundary (lesson **on**
`expires_on` covered, day after not); lesson before `confirmed_at` not covered;
out-of-scope class billed ad-hoc; locked rate ≠ current class rate (both
directions); package + credit note precedence with the numbers from the design
conversation.

## 4. Phase 3 — Correction trigger (`handle_attendance_update`)

If the invoice item has a **live** ledger row (`reversed_at IS NULL`): mark it
reversed, restore `value_remaining`, **do not** create a credit note. Otherwise the
existing credit-note path runs byte-identical.

- ⚠ RISK 2 — the reversal is guarded `WHERE reversed_at IS NULL` (structural
  idempotence: a repeated correction cannot double-restore). pgTAP: flip
  billable→non-billable **twice** (via re-billable in between where the flow
  allows), assert exactly one reversal and one restore.
- ⚠ RISK 2 — pgTAP asserts, for a package-funded correction: value restored,
  **zero** credit_notes rows created, `parent_tenant_balances` untouched — the
  double-refund case is an explicit expected-absence test, not an assumption.
- ⚠ RISK 2 — regression: a **non**-package correction still produces exactly
  today's credit note + balance increment (pin against the existing
  `credit_note_trigger.test.sql` expectations).
- ⚠ RISK 2 — restore succeeds on an **expired** package (value wrongly taken is
  returned regardless); test included. `CHECK (value_remaining <= total_value)`
  bounds it.
- ⚠ RISK 2 — **prohibitions:** this trigger has broken production twice during
  migrations. Use `CREATE OR REPLACE`; if a signature change ever forces DROP, the
  same migration re-applies grants (§8.7: a DROP takes grants with it). After
  editing, grep migration function bodies for assumptions about it (§7.21).

## 5. Phase 4 — Admin panel

- **Categories** page (mirror of Levels) + category picker on the class form.
- **Packages** page: products (create / retire — no money edits, matching the DB
  trigger); purchases list — pending rows with Confirm / Cancel, plus "record a
  sale" (creates directly `active`).
  - ⚠ RISK 5 — Confirm executes `UPDATE … WHERE id = ? AND status = 'pending'` and
    treats 0 rows as already-handled (idempotent against double-click / two admins).
  - ⚠ RISK 5 — forms validate empty-before-coerce (§7.22); the DB CHECKs backstop.
- **Students page low-balance filter**: reads `package_live_balances()`, threshold
  from `tenants.low_package_lessons`, editable inline (persisted per tenant).
  - ⚠ RISK 4 — **prohibition:** the filter must not compute lessons-left
    client-side from raw tables; it calls the RPC. (Also avoids the client-side
    scan-and-cap wart already on the backlog for family search.)
- Invoices page shows `package_applied` alongside credit.

## 6. Phase 5 — Parent app

- Billing tab package card: per business — lessons remaining (from
  `package_live_balances()`), dollar value, expiry date, `pending` state for
  requested-but-unconfirmed purchases.
  - ⚠ RISK 4 — same prohibition: no TS derivation of pending draws; the RPC is the
    only source. The card may divide by the snapshot rate for display — that
    division is presentation, not derivation.
- Request-purchase flow: pick product → instance created `pending` (snapshot taken
  by the DB layer) → PayNow QR screen (tenant's QR, per PRD §7.10).
  - ⚠ RISK 3 — this is the `insert().select()` path tested in Phase 1.
- UI notes: any horizontal ScrollView needs `flex-grow-0` + `items-start` (§7.9);
  new tab sections need a nested `_layout.tsx` (§6).

## 7. Phase 6 — Emails

Two sends, both the invoice-email pattern (business-branded, best-effort, isolated,
**no-op when key unset** so local/tests never send):

- On request (from the app path): amount + PayNow instructions.
- On confirm (from the admin panel): "package active — N lessons, valid until D".
- Infra: `RESEND_API_KEY` added to `SwimSyncAdmin` env (Vercel + `.env.local`
  documented in `.env.example`) — a **new secret surface**, called out on deploy.
- ⚠ RISK 7 — **prohibition:** sends stay out of the engine and out of any DB
  transaction path; a delivery failure may never touch billing or a purchase state
  change (§6's email rule). Reuse `email.ts` escaping; unit-test both templates.

## 8. Phase 7 — Verification & deploy

- Playwright driver `verify-packages.mjs` (+ fixtures): request → confirm → mark
  attendance → derived count drops same-day → generate invoices → invoice shows
  package applied, status `paid` when fully covered → correct attendance → count
  restored → shortfall case shows net due at class rate.
  - Driver asserts on strings unique to the target screen (§7.10 stale-DOM trap).
- Full suites: pgTAP, Deno (×2), both frontend suites, `tsc --noEmit` under the
  stubbed-out fresh-checkout condition (§7.11).
- ⚠ RISK 6 — deploy order, pure EXPAND, so: **backup → `supabase db push` →
  `supabase migration list` shows nothing pending → `supabase functions deploy
  generate-invoices` → verify version bump via `supabase functions list` → `git
  push`** (web apps last — they may reference new tables/RPCs only after those
  exist; §6/§7.27: the rule governs the push).
  - ⚠ RISK 6 — `db push` applies **every** pending migration and auto-confirms
    when non-interactive (§7.30): before pushing, `supabase migration list` and
    read the pending set — it must be exactly this feature's migrations.
- Docs at session close: PRD gains the packages section (implemented-behaviour
  only, per lane rules), BACKLOG gains the refund item + parent expiry
  notifications, HANDOVER §7 graduates any new gotchas hit during the build.

---

## Pre-commit gate

Walk before **every** commit in this work; a box that cannot be ticked is a
blocker. The first three are the ones that matter most:

- [ ] **No-package regression test passes AND was shown to discriminate** (it fails
      if package logic leaks into the no-package path).
- [ ] **Every new engine query greps as tenant-filtered**
      (`grep -n "parent_packages\|package_applications" core.ts`).
- [ ] **§7.20 RLS audit query returns zero rows** on the migrated local DB.
- [ ] Every new bug-shaped test was run against un-fixed code and failed there
      (§7.25); regression-only tests are labelled as such.
- [ ] Deno suite run twice, both green (§7.15).
- [ ] pgTAP: package-funded correction produces **no** credit note; non-package
      correction unchanged; double-correction restores once.
- [ ] No TypeScript derivation of pending draws exists
      (`grep -rn "value_remaining" SwimSyncApp SwimSyncAdmin` shows only RPC reads
      and display division).
- [ ] Both apps typecheck under the CI condition (§7.11).
- [ ] `supabase migration list`: pending set is exactly this feature's migrations.
