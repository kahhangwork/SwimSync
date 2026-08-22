# Partial-payment follow-ups (a) + (b) — PLAN

_Drafted 2026-08-22. Follows §8.83 (partial-payment via `debit_balance`, shipped + deployed). Both items
DORMANT on prod (0 credit notes), so this is correctness + tests ahead of first use, not a live-bug fix.
Decisions locked with the user 2026-08-22. Hardened by two `/plan-review` (fable) passes — findings inlined
below as `⚠ RISK/CN` steps/assertions/prohibitions, gated at the bottom._

_**BUILT + verified locally 2026-08-23** on `db/partial-payment-followups` (migration `20260822000200`,
engine UNCHANGED). Collect-now REJECTED for the write-off ramp (debit-only guard). Verified: pgTAP
`partial_payment_followups.test.sql` 30/30 + `partial_payment.test.sql` updated, whole suite PASS; red-first
proven (30/30 fail without the migration); DOWN rehearsed (exit 0, columns/trigger/function removed); Deno
236 ×2; admin vitest 519; admin typecheck clean. **One gate item DEFERRED:** the RISK 6 two-tenant vitest —
no component-render harness exists in the admin app (the 519 vitests are lib-level), and the cross-tenant
leak is closed STRUCTURALLY by the `loadPendingDebits` `.eq("tenant_id", tid)` filter (typechecked, reviewed).
NOT deployed to prod._

## What ships
1. **(a)** Re-correcting a voided-and-debited note **auto-unwinds** the debit when it is still pending;
   keeps the `CN002` refusal once the debit has already been billed.
2. **(b)** Pending `debit_balance` is shown on the admin **Invoices** page before it bills.
3. **Guard:** offboarding (soft-deactivating) a family is **refused** while `debit_balance > 0` (debit only —
   see below). The modal copy is updated to say so.
4. **Write-off (the guard's exit ramp):** an admin-only `write_off_parent_balance()` RPC that zeroes a
   parent's pending `debit_balance` (audited, reconciliation-safe) so a leaver can be offboarded. If real
   money is owed, the admin settles it OUT-OF-BAND (PayNow/cash) — no in-app collection path is built
   (deliberate: the scenario is very rare, 0 credit notes on prod).

## Decisions locked (with the user, 2026-08-22)
- **(a) is auto-unwind PENDING ONLY.** Debit still on `debit_balance` (not folded) → auto-unwind; already
  folded → keep `CN002`. The folded/mixed multi-flip state machine stays deferred.
- **(b) surfaces on the admin Invoices page.** Parent still does NOT see a pending debit until it bills.
- **Guard blocks on DEBIT ONLY.** Blocking on credit would force a leaving family to forfeit money WE owe
  THEM and fights the existing design that PRESERVES credit across offboard (returning family keeps it).
  Credit is left untouched by this work.
- **Ramp = write-off, NOT collect-now.** Collect-now (a standalone same-month invoice) was designed then
  REJECTED after review: `UNIQUE(parent,tenant,billing_month)` (`20260718001100:73`) forbids a second
  same-month invoice, so it forced an engine change (a `kind` discriminator + guard filter + version bump)
  AND still only produced a chaseable outstanding invoice rather than collecting. The write-off is a
  fraction of the scope, needs no engine change, and satisfies the guard cleanly. Out-of-band settlement
  covers the rare "actually want the money" case. *(The collect-now `kind`-discriminator lesson is worth
  keeping — see "Graduate on landing".)*

## The one hard design point (a) — telling "pending" from "billed" EXACTLY
A bare `debit_balance` compare fails: the fold zeroes the whole balance at once
(`apply_credit_to_invoice:496`) and never links a folded debit back to its invoice. **Fix: a per-application
stamp** — `credit_applications.folded_at`, set when the fold consumes that debit. A note's debit is
*pending* iff its `debited_at` rows all have `folded_at IS NULL`.

**Auto-unwind fires only for the fully-reversible case:** the note's every draw is
`debited_at IS NOT NULL AND folded_at IS NULL` (none folded, no outstanding-reopen mixed in). Then un-void
it exactly (see step 1 for the CORRECTED money moves — the naive "note → applied, don't restore credit" is
WRONG for a partial draw). Anything else → `CN002` unchanged.

---

## Steps

### 1. Migration — schema + logic (one migration, `db/…` branch; §7.55 one-in-flight)
- New columns: `credit_applications.folded_at TIMESTAMPTZ`, `folded_invoice_id UUID`,
  `written_off_at TIMESTAMPTZ`, `written_off_by UUID`.
- `apply_credit_to_invoice`: when `v_debit > 0`, stamp this parent/tenant's
  `debited_at IS NOT NULL AND folded_at IS NULL` rows with `folded_at = NOW()`,
  `folded_invoice_id = p_invoice_id`. Same lock, `CREATE OR REPLACE` (keeps grants).

  **⚠ RISK 5 MITIGATION (structural).**
  - **PROHIBITION:** the `folded_at` stamp and the unwind's safe-set check each execute *after* acquiring
    the `parent_tenant_balances` row `FOR UPDATE` (`:430`) in the same transaction — never before, never
    out-of-lock. (This makes the void↔fold race safe: a void marking `debited_at` cannot commit without its
    own balance UPDATE, `:169`, blocking on that same locked row.)
  - **ASSERTION (in-function):** after stamping, `RAISE` unless `Σ(rows just stamped) = v_debit`. Pass/fail:
    debits 12 + 10, fold on one invoice → stamped sum = **22.00**, `balance_adjustment = 22.00`.
  - **ASSERTION (migration apply-time probe, mirror `20260822000100:517`):** `RAISE` if any (parent,tenant)
    has `debit_balance <> Σ(amount) FILTER (debited_at IS NOT NULL AND folded_at IS NULL AND
    written_off_at IS NULL)`.  *(the invariant now excludes written-off rows — see step 2b.)*

- `handle_attendance_update` CN002 block: replace the unconditional raise with auto-unwind-vs-`CN002`.
  **CORRECTED money moves (the review broke the naive version):**
  - `v_drawn_sum = SUM(amount)` over the note's `debited_at IS NOT NULL AND folded_at IS NULL` applications.
    **⚠ RISK 2 PROHIBITION:** subtract exactly `v_drawn_sum` from `debit_balance` — **NEVER
    `credit_notes.amount`** (partial draws differ; the wrong value silently steals another note's debit or
    trips the `>= 0` CHECK). ASSERTION (pgTAP): two notes debited 12 + 10, unwind A → `debit_balance` =
    **10.00**.
  - Restore the undrawn remainder to `credit_balance` (mirror of the void's `:162`).
  - **⚠ RISK 1 MITIGATION (structural):** note status →
    `CASE WHEN v_drawn_sum = credit_notes.amount THEN 'applied' ELSE 'available' END` — a partially-drawn
    note MUST go back to `'available'` or its remaining value is invisible to the FIFO loop (`:447` selects
    `status='available'` only) and is stranded as unspendable credit forever. ASSERTION (pgTAP): unwind a
    $20 note drawn $12, then `apply_credit_to_invoice` on a fresh $50 invoice returns exactly **8.00**,
    `credit_balance = 0` (the naive design returns 0.00, strands 8.00).
  - **⚠ RISK 8 MITIGATION:** on unwind of a fully-drawn note, restore `applied_to_invoice_id`/`applied_at`
    from its live application's invoice (void cleared them at `:151`); cover in the round-trip assertion.
  - Auto-unwind fires ONLY when every draw is `debited_at IS NOT NULL AND folded_at IS NULL`; any folded row
    or any `reversed_at IS NOT NULL` (outstanding-reopen) draw mixed in → `CN002` unchanged.

  **⚠ RISK 7 MITIGATION:** make the folded-case CN002 message state-aware — it must NOT promise "settle or
  reverse the charge" (folding IS settlement; unsatisfiable). Point it at a real procedure and ADD that
  procedure to `INVOICE_RUNBOOK.md` (manual adjustment for a post-fold re-correction).

- **⚠ RISK 6 MITIGATION (RLS — the original step was WRONG):** the admin read already works —
  `authenticated` holds SELECT (`20260804000600:108`), policy `parent_tenant_balances_select`
  (`20260813000300:413`) has a `tenant_id = current_tenant_id()` arm. **PROHIBITION: do NOT add a new policy
  or GRANT** for reads (needless §7.87-test risk). Just verify `current_tenant_id()` resolves in the admin
  session, then stop.

### 2. Migration — offboard guard (DEBIT ONLY, on the shared trigger)
- **⚠ RISK 3 MITIGATION (structural — a per-RPC guard is bypassable):** `set_students_active` flips
  `parent_tenants.is_active=false` itself via the "no active children left ⇒ family inactive" rule
  (`20260719001200:133`), and `close_student_enrolment(p_set_inactive)` delegates to it (`:230`) — both
  called from the admin Students page AND the coach app (`SwimSyncApp/lib/studentStatus.ts:105,54`).
  Guarding only `set_parent_tenant_active` leaves the everyday offboard (deactivate last child) walking past
  it. **Put the check in ONE place:** a `BEFORE UPDATE` trigger on `parent_tenants` firing on `is_active`
  true→false, `RAISE` when `debit_balance > 0` for that (parent, tenant). §7.57: the trigger also fires for
  upsert-resolved rows — detect the update inside.
  - **ASSERTION (pgTAP):** deactivating the last active child of a family with `debit_balance = 5` RAISEs.
    (A per-RPC guard would PASS this — that is the hole.)
  - **⚠ per-tenant scoping:** the check's WHERE carries both `parent_id` AND `tenant_id`; a balance at
    tenant B must not block offboarding at tenant A. ASSERTION in the same test.
  - **PROHIBITION:** the guard checks `debit_balance` ONLY — never `credit_balance` (credit is preserved
    across offboard by design; blocking it force-forfeits money owed to a returning family).
- Committed + rehearsed DOWN (§11.37).

### 2b. Migration + UI — write-off RPC (the ramp)
`write_off_parent_balance(p_parent_id, p_tenant_id, p_reason)` — clears a parent's pending debit so a leaver
can be offboarded; money, if any, is settled out-of-band.
- **SECURITY DEFINER on the `void_credit_note` template (⚠ CN-F4):** `authenticated` cannot write these
  rows itself, so DEFINER is required. `IF NOT is_tenant_admin(p_tenant_id) THEN RAISE`
  (`20260818000300:82`); `REVOKE EXECUTE FROM anon, service_role; GRANT ... TO authenticated` (`:552` — the
  revoke is load-bearing, cloud defaults EXECUTE on new functions, §7.39). Requires a non-empty
  `p_reason` (audited, mirror `void_credit_note`).
- Under `parent_tenant_balances FOR UPDATE`: read `debit_balance`; if `0` (or no balance row) → RAISE
  "nothing to write off" (⚠ CN-R3: refuse on absent row too, not just `= 0`). Stamp `written_off_at = NOW()`,
  `written_off_by = auth.uid()` on every `debited_at IS NOT NULL AND folded_at IS NULL AND
  written_off_at IS NULL` application for this parent/tenant. **ASSERTION (in-function):** the stamped sum
  must equal `debit_balance` before zeroing it — `RAISE` otherwise (reconciliation, mirror of step 1's
  invariant). Then `debit_balance = 0`. Write an `audit_log` row (`parent_debit_written_off`, reason,
  amount).
- **Reconciliation invariant (updated for written-off rows):**
  `debit_balance = Σ(amount) FILTER (debited_at IS NOT NULL AND folded_at IS NULL AND written_off_at IS NULL)`.
  A written-off row is spent-and-closed: it never funds a debit, a fold, or an auto-unwind again (add
  `written_off_at IS NULL` to the auto-unwind safe-set predicate in step 1 too).
- **PROHIBITION:** write-off touches `debit_balance` and the `written_off_at` stamps ONLY — it never mutates
  an invoice, a credit note, or `credit_balance`. Credit is out of scope for this work.
- UI: a "Write off" action (with a reason prompt) on the Invoices-page pending-charge row (b) and/or
  parent/family detail, visible when `debit_balance > 0`.
- ASSERTION (pgTAP): write off a $20 pending debit → `debit_balance = 0`, applications stamped
  `written_off_at`, reconciliation holds, audit row written; then offboard SUCCEEDS. Coach call RAISEs;
  admin of tenant B calling for tenant A's parent RAISEs.

### 3. Tests — red-first (§7.25)  *(the assertions above are the spec; this is the suite layout)*
- pgTAP: Risk 1 (8.00 / no stranding), Risk 2 (=10.00), full-draw round-trip incl. metadata (Risk 8),
  stamped-sum reconciliation (Risk 5), offboard-via-child-deactivation RAISEs on debit>0 (Risk 3),
  per-tenant scoping, guard does NOT block on credit-only, post-fold CN002 + a following absent→present nets
  0.00 (Risk 7), write-off zeroes + reconciles + authority (2b), identity belt-and-braces
  `Σ(debited where folded_invoice_id=X) = invoices.balance_adjustment`.
- Deno **×2** (§7.15): fold stamps `folded_at`; the §7.17 retry path stamps exactly once.
- vitest: Invoices page renders the pending-charge indicator + the Write-off action; offboard error and
  write-off success surface.

### 4. Admin Invoices page (b)
- `SwimSyncAdmin/app/(admin)/invoices/page.tsx` `loadInvoices()` (`:624`): add `parent_id`/`tenant_id` to
  the select, a second read of `parent_tenant_balances.debit_balance`, render a "pending charge — not yet
  invoiced" row/banner with the Write-off action. **⚠ RISK 6 MITIGATION (structural):** key the balances
  map by **`(parent_id, tenant_id)`** and join on both — a parent enrolled at two tenants has two balance
  rows, and keying by parent alone attaches tenant B's debit to tenant A's invoices (a platform admin sees
  all tenants here; `loadInvoices` has no tenant filter, relies on RLS). ASSERTION (vitest): one parent in
  two tenants renders the banner only under the matching tenant's rows. *(The page already selects/renders
  `balance_adjustment` and tolerates empty items — `:79,629,637` — so the billed case is free.)*

### 5. Offboard modal copy
- `parents/page.tsx:331` — keep "any credit balance is kept" (still true — credit is not blocked), and ADD
  that a family with a pending charge (debit) must have it written off (or settled) before offboarding.

### 6. Deploy (`/deploy` gate)
- **Engine UNCHANGED** (collect-now dropped; the fold is all in-SQL, `core.ts:1480` only invokes the RPC) —
  confirm, then **no version bump**.
- **Grant dump REQUIRED (§7.39/§7.89):** `write_off_parent_balance` is a new SECURITY DEFINER function
  granted to `authenticated` — take a remote grant dump after applying. (No new *policy* for the reads,
  Risk 6.)
- Order: **migrations → apps to `main` LAST**. Run `/deploy` to gate the app push behind 0-pending.

## Scope boundaries (deliberate)
- (a) stays narrow: only the fully-reversible pending case auto-unwinds. Folded/mixed → `CN002`.
- No collect-now / standalone invoice path. Out-of-band settlement covers the rare "want the money" case.
- Guard is debit-only; credit is untouched and preserved across offboard as today.
- Parent does not see a pending debit until it bills (UI convention — the parent RLS arm technically permits
  the read; noted so nobody "improves" the parent card into showing it).

## Verified-safe by the reviews (do NOT re-litigate)
- Full-draw core trace nets the parent to exactly $0, no double-count (the live paid-invoice draw stands).
- Un-correction branch (absent→present) is correctly a no-op for a debited note — Q3 scope sufficient.
- Engine unchanged; four-term `net` identity untouched on every existing invoice.
- Double-fold/lost-fold is safe — `apply_credit_to_invoice` re-reads under `FOR UPDATE` + early idempotency
  return (`20260822000100:421-433`); any ordering folds exactly once.

## ⛔ Pre-commit gate — walk before committing
- [ ] **Risk 1** — pgTAP: unwind $20-drawn-$12 note → next invoice draws exactly **8.00**, `credit_balance`=0.
- [ ] **Risk 2** — pgTAP: two debits 12+10, unwind A → `debit_balance` = exactly **10.00**.
- [ ] **Risk 3** — pgTAP: deactivating a family's LAST child with `debit_balance>0` RAISEs (guard on the
      shared `parent_tenants` trigger, not just the RPC); guard does NOT block on credit-only.
- [ ] **Ramp (2b)** — `write_off_parent_balance` ships WITH the guard, same deploy: zeroes debit, stamps
      `written_off_at`, reconciliation holds, admin-only (coach/foreign-tenant RAISE), then offboard
      succeeds. Grant dump taken.
- [ ] **Risk 5** — in-function `Σ(stamped)=v_debit` assertions present (fold AND write-off); apply-time
      reconciliation probe present; auto-unwind safe-set excludes `written_off_at`/`folded_at`.
- [ ] **Risk 6** — no new policy/grant for reads; balances map keyed by `(parent_id, tenant_id)`;
      two-tenant vitest passes.
- [ ] **Risk 7** — folded-case CN002 message is state-aware; runbook procedure added.
- [ ] **Risk 8** — full-draw unwind restores `applied_to_invoice_id`/`applied_at`.
- [ ] Deno suite run **twice**, both green (§7.15).

**Highest-value two, called out:** Risk 1/2 (silent wrong-money in the unwind math) and Risk 3 (guard the
main offboard path bypasses). These are the two the reviewer would refuse to ship without.

## Graduate on landing (durable — to `docs/GOTCHAS.md` §7, not just this file)
- The `folded_at`/write-off lock-ordering rule (Risk 5): stamp and safe-set checks run under the balance
  `FOR UPDATE`, never out-of-lock.
- "Guard the shared `parent_tenants` flip, not each RPC" (Risk 3) — `set_students_active` and
  `close_student_enrolment` both offboard, so a per-RPC guard is bypassable.
- **The collect-now lesson (even though not built):** a standalone/adjustment invoice in the CURRENT month
  collides with `UNIQUE(parent,tenant,billing_month)` and makes the engine skip the whole month
  (`core.ts:1266`); any future second-invoice-per-month feature needs a `kind` discriminator + the engine's
  `kind='lessons'` guard filter. Record it so the trap isn't rediscovered.

**Size:** ~2.5–3 focused days (the partial-draw unwind math, the shared-trigger guard + write-off RPC, and
the reconciliation/pgTAP tests — collect-now's engine change is gone).
