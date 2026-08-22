# Partial-payment via an account balance — PLAN

_Drafted 2026-08-22. **Revised 2026-08-22 after `/plan-review` (fable)** — the review found the original
"one signed `credit_balance`" representation UNSAFE and it was replaced with a separate `debit_balance`
column (see "Representation" below). Status: **design, not built.** Dormant trigger — production holds 0
credit notes, so no void has ever reopened a paid invoice. Backlog: `BACKLOG.md` → Wave D →
*Partial-payment accounting for a voided-credit reopen*._

The problem (backlog item, §8.69): `void_credit_note` reopens a drawn invoice to `outstanding` with
`net_amount += amount`. If that invoice was already **cash-paid**, it reopens at the higher net while
`payment_records` still shows the old lower payment — so the amount owed reads too high and the admin
reconciles by hand. Root cause: SwimSync has no amount-owed model; owed = `net_amount`, and a void
mutates a *paid* invoice.

The fix: stop mutating paid invoices. Represent a post-payment correction that makes the parent owe MORE
as a **debit** on their account, carried onto the next invoice — the mirror of the credit direction,
which already works.

---

## Decisions locked (with the user, 2026-08-22)

- **Paid invoices are immutable.** A void never reopens a paid invoice again.
- **The account position is one net figure, both directions** — `credit` (we owe the parent) minus
  `debit` (the parent owes us) — carried onto the next invoice.
- **Debit collection = carry to next invoice only.** No standalone immediately-payable charge.
  **Accepted gap:** a family with no next invoice (leaving mid-cycle) is not auto-billed a debit; the
  admin chases it manually. Revisit — add an admin "collect now" standalone charge — only if that gap
  bites in practice.
- **Scope = the void path only.** `student_settlements` (the added-lesson-after-billing path, §8.48) is
  left as-is this cut; unifying it into the same balance is a later payoff, not v1.

## Representation — **separate `debit_balance`, NOT a signed `credit_balance`** (revised after plan-review)

The plan originally stored the debit as a negative `credit_balance`, on the user's "same place, sign
differs" intuition. **The review killed this:** `credit_balance` is welded to the credit-note ledger —
`apply_credit_to_invoice` (`20260818000200`), the correction trigger's three spend-signals, and the
void's undrawn-remainder math all assume `pool = Σ(note amount − live draws)` and `pool ≥ 0`. A negative
`credit_balance` lets a note's value be consumed by netting **with no `credit_applications` row**, after
which un-correct / admin-void / the credit emails all fire on stale ledger state and **overcharge the
parent** (fable risks 1, 4).

So: add `parent_tenant_balances.debit_balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (debit_balance >= 0)`
— what the parent owes from post-payment corrections. `credit_balance` keeps its meaning, its `≥ 0`
invariant, and its corruption guard **unchanged**. The parent's net position is `credit_balance −
debit_balance`, computed where displayed. This also dissolves the pre-deploy-window bug (fable risk 5):
the old engine never reads `debit_balance`, so a debit posted before the new engine deploys simply waits.

_Alternative considered and rejected: keep one signed column but write a `credit_applications` ledger row
for every netted portion. Preserves "same place" but adds ledger machinery to every debit; the separate
column is simpler and keeps every existing sum working. If the user prefers the single-figure model, this
is the fallback — not the default._

## The `net_amount` identity (corrected)

The plan text originally wrote `net = gross − credit_applied + balance_adjustment`, which is **wrong** —
it omitted packages. The real engine formula (`core.ts:1328`, `:1485`) is:

```
net_amount = gross_amount − package_applied − credit_applied + balance_adjustment
```

`balance_adjustment` (new, on `invoices`) is the debit folded into THIS invoice. Any test or CHECK must
use the full four-term identity, not the three-term one.

---

## The mechanism, end to end

1. Void a credit note drawn against a **paid** invoice → add `amount` to `debit_balance`, and stamp the
   funding `credit_applications` row `debited_at` (so it can never fund a second debit). The invoice and
   its live discount are untouched — the value is clawed back via the balance, not by reversing the
   invoice.
2. Void against a **still-unpaid** invoice → keep today's in-place restore (`net_amount += amount`, mark
   applications `reversed_at`); it is still amendable, no debit posting.
3. Next invoice generation folds `debit_balance` in via a locked SQL function: sets
   `balance_adjustment = debit_balance`, adds it to `net_amount`, and decrements `debit_balance` by the
   folded amount in the same locked write.
4. The parent sees the amount as a labelled line on their next invoice. Credit and debit net across the
   two columns before it bills.

---

## Work items

### 1. Migration — schema (S)
- `invoices.balance_adjustment NUMERIC(10,2) NOT NULL DEFAULT 0` — the debit folded into this invoice.
- `parent_tenant_balances.debit_balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (debit_balance >= 0)`.
- `credit_applications.debited_at TIMESTAMPTZ` — marks a draw that has funded a debit posting (fable
  risk 4). A `debited_at` draw still counts as "spent" for remainder math but can never fund a second
  posting.

### 2. Migration — rewrite `void_credit_note` (M)
For each drawn invoice: **if `status = 'paid'`**, add the applied amount to `debit_balance` and stamp the
application `debited_at` — do NOT reopen, do NOT reverse the discount; **if `outstanding`**, keep the
existing in-place restore. Idempotent per application: a `debited_at` row is skipped, so void→…→void
never double-posts (fable risk 4). Same locked transaction as today (§8.69 drawdown lock preserved).
Re-activation (§8.68) retracts a debit by its `debited_at` mark — subtract from `debit_balance`, clear
`debited_at` — never by a blanket `± amount`. **Keep the `credit_balance` `≥ 0` RAISE guard** — it is
still a real corruption signal (fable risk 7). Committed, rehearsed DOWN (`pg_get_functiondef`, §11.37).

### 3. Migration + engine — the debit fold (M)
- New SQL function `fold_debit_into_invoice(p_invoice_id)` (or extend `apply_credit_to_invoice`): takes
  `FOR UPDATE` on the balance row, is idempotent under the lock (`IF invoices.balance_adjustment <> 0
  THEN return`), sets `balance_adjustment`, and uses a **relative** update
  (`debit_balance = debit_balance − v_folded`). **Not** JavaScript — the review showed a JS read-then-
  write is a lock-free TOCTOU that loses or double-bills the debit on the §7.17 retry path (fable risk 2).
- `core.ts` calls it at the balance step (`~:1316`) after credit. The estimate math must never emit a
  negative `credit_applied`; a Deno test pins that (fable risk 5, belt-and-braces).

### 4. Migration — patch `apply_credit_to_invoice` (S, but load-bearing)
The RPC ends `v_net := v_cash − v_allocated; UPDATE … net_amount = v_net` (`20260818000300:533-539`) —
it rewrites `net_amount` from scratch and would **erase `balance_adjustment`**, a permanent underbill
(fable risk 3). Change to `v_net := v_cash − v_allocated + balance_adjustment` (read the invoice's
`balance_adjustment` under the same lock), and flip `'paid'` on `v_net = 0` accordingly. pgTAP: calling
it on an adjustment-carrying invoice preserves the adjustment.

### 5. Consumers — display (S/M)
- Render `balance_adjustment` as a line on admin invoice detail, parent invoice detail
  (`SwimSyncApp/app/(parent)/billing/invoice/[id].tsx`), the public token page, and
  `public-invoice/core.ts`.
- **`email.ts` + `email.test.ts`** — pass and render `balance_adjustment` so the emailed total
  reconciles with its own line arithmetic; fix `netApplied` at `core.ts:1485` to include it; correct
  `fullyCovered = net === 0` for a debit-only invoice (fable risk 6).
- **Parent home** (`app/(parent)/home/index.tsx`, `child/[id].tsx`) already sums `credit_balance` for a
  credit chip. With a separate `debit_balance` the chip stays correct (credit is never negative); a
  pending debit is deliberately NOT shown to the parent until it lands on an invoice — same as pending
  credit today.
- **Admin balance visibility:** surface `debit_balance` on the Invoices/Students view so a pending debit
  is seen before it bills (and before an offboarding deletes it — see risk below).

### 6. Tests — red-first (M)
- pgTAP: void-on-paid posts to `debit_balance` + stamps `debited_at` + leaves the invoice paid;
  void-on-unpaid still restores in place; **the toggles** — void→re-activate→void and
  void→re-activate→un-correct — each leave the parent's net position at $0 and no path exceeds ±amount
  (fable risks 1, 4); `apply_credit_to_invoice` preserves `balance_adjustment` (risk 3).
- Deno (run **twice**, §7.15): the next invoice folds `debit_balance` into `net_amount` and clears it;
  a netting case (debit + credit before billing); an injected `invoice_items`-insert failure then rerun
  bills the debit **exactly once** (risk 2); a negative-`available` input never yields negative
  `credit_applied` (risk 5).
- **Reconciliation probe** (pgTAP): per (parent, tenant), `credit_balance = Σ note remainders` and every
  `debit_balance` traces to an un-retracted `debited_at` — the corruption check the old `< 0` RAISE used
  to give for free (fable risk 7).
- vitest / jest: the adjustment line renders; outstanding totals include it; the email sum reconciles.

---

## Deploy sequence (§7.60, §11)
Migrations → engine → **apps to `main` LAST**. Changed functions → remote grant dump (§7.39/§7.89). Run
`/deploy` to gate the app push behind 0-pending. **One schema change in flight** (§7.55): items 1–4 are
migrations; land them as an ordered set on a `db/…` branch before the engine/app work consumes them.
Dormant on prod (0 credit notes), so first firing is the first real void-on-paid.

## Residual risks / watch (after the additions above)
- **`balance_adjustment` is write-once, at invoice creation, by the fold function — never onto an
  existing invoice** (fable risk 8). Sealed-month safety depends on this; a future "collect now" feature
  must not violate it.
- **Parent-deletion cascade** (`parent_tenant_balances … ON DELETE CASCADE`, `20260718000500:116`)
  silently destroys a pending `debit_balance` on offboarding. v1 mitigation: the admin balance
  visibility (item 5) surfaces it first; file a BACKLOG line to warn/block deletion on a nonzero balance
  (fable risk 7). Not a v1 blocker given dormancy.
- **Accrual accounting** (owner page, Later): a debit raises *next* month's issued-invoice total rather
  than mutating an old one — cleaner for accrual; note it in that item.

## Open decision for the user
The separate-`debit_balance` representation replaced the locked "one signed `credit_balance`" idea for
safety. It preserves the product behaviour exactly. **Confirm** the representation change, or ask for the
single-signed-column-with-ledgering fallback (more machinery, same behaviour).

## Rough size
~3–4 focused days now (up from 2–3): the fold-as-SQL-function, the `apply_credit_to_invoice` patch, the
`debited_at` toggle state machine, and the reconciliation/email tests are the added weight.
