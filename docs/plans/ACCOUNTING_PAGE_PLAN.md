# Owner-only accounting page — plan

_Raised: BACKLOG.md "An owner-only accounting page" (M). Decided with the user
2026-08-23. Accrual chosen 2026-08-16. Hardened by /plan-review 2026-08-23 —
`⚠ RISK n MITIGATION` markers below are load-bearing; the ranked list is at the
bottom with the pre-commit gate._

## What we're building

An **owner-only "Accounting" page** in the admin panel (`SwimSyncAdmin/`). The
owner picks a **closed month** from a dropdown and sees four figures for that
month: **Revenue** (accrual), **Outstanding**, **Wages** (accrued), **Net**.
Co-admins cannot see it. Size: M (~2–3 days).

## Settled decisions (do not re-litigate)

- **Owner-only** — gate on `is_tenant_owner()` (`20260806000100_co_admins.sql`,
  granted to `authenticated`). No capability model needed.
- **Accrual** — revenue = invoices *issued for* the month + `paid_outside`
  settlements. Never a partial figure.
- **Metrics:** Revenue, Outstanding, Wages, Net. (Cash "collected" deliberately
  dropped.)
- **Time view:** single month picker, **closed months only**.
- **Wages basis:** accrued (cost of lessons *taught* that month).
- **Net = Revenue − all coach wages.** The owner's own rate-less pay is $0 and
  drops out automatically — no "is this coach the owner?" special-casing.

## The figures, defined against real columns

For a selected month `M` (format `'YYYY-MM'`):

| Figure | Computed as |
|---|---|
| **Revenue** | `SUM(invoices.net_amount − invoices.balance_adjustment WHERE tenant_id=T AND billing_month=M)` + `SUM(student_settlements.amount WHERE tenant_id=T AND kind='paid_outside' AND reversed_at IS NULL AND to_char(settled_through,'YYYY-MM')=M)` — see ⚠ RISK 3 below for why `balance_adjustment` is subtracted. |
| **Outstanding** | `SUM(invoices.net_amount WHERE tenant_id=T AND billing_month=M AND status='outstanding')` |
| **Wages** | `SUM(coach_payout_items.amount)` over items whose parent `coach_payouts.tenant_id=T`, where **either** (`period_month=M AND is_adjustment=false`) **or** (`is_adjustment=true AND original_period=M`, any period) — see ⚠ RISK 2 below. |
| **Net** | Revenue − Wages |

**⚠ RISK 2 MITIGATION (STEP — figure DEFINITION change, wages).** The original
draft summed only `period_month=M AND is_adjustment=false`. That is wrong on
the chosen accrual basis: `generate_coach_payouts`
(`20260719000500_coach_wages_compute.sql` "Adjustments" loop) writes a
correction to an already-**paid** period M as an `is_adjustment=true` item **on
a later period's payout**, carrying `original_period = M`. Excluding all
adjustments means (a) month M's accrued wages can never reflect a correction to
it, forever, and (b) the sum of accounting-wages across months permanently
disagrees with the sum of `coach_payouts.gross_amount` actually paid.
`original_period` exists precisely to reallocate the correction to the month it
belongs to — use it: `wages(M) = Σ non-adjustment items of period M + Σ
adjustment items (any period) with original_period = M`.
**ASSERTION (pgTAP):** fixture with a paid period M, a pay-changing correction,
and a regenerated M+1 draft → `accounting_summary(M).wages` equals the
corrected owed amount for M, and `accounting_summary(M+1).wages` counts **only**
M+1's own non-adjustment items (the adjustment must not leak into M+1). This
test must go red against the adjustment-excluding draft definition.

**⚠ RISK 3 MITIGATION (STEP — figure DEFINITION change, revenue).**
`net_amount = gross_amount − package_applied − credit_applied +
balance_adjustment` (COMMENT on `invoices.balance_adjustment`,
`20260822000100_partial_payment_debit_balance.sql`). `balance_adjustment` is a
**prior-period debit** folded onto month M's invoice at settle time — it is a
collection event for an *earlier* month, not value delivered in M. Summing raw
`net_amount` would overstate M and understate the month the debit came from.
Revenue therefore uses `net_amount − balance_adjustment`. (On prod today every
`balance_adjustment` is 0 — the feature is dormant — so this costs nothing now
and prevents a silent cross-month drift later.)
Two deliberate residues, documented not fixed:
- **`package_applied` value appears in NO month's Revenue** (the package
  purchase itself is off-invoice cash). Accepted: counting it here would
  double-count the day package purchases are ever reported. Reversible
  one-liner.
- `credit_applied` stays excluded (`net`, not `gross`) — credit is value already
  received in a prior month; `gross` would double-count it. (Original micro-
  decision 1, still holds.)
**STEP:** `accounting_summary` returns the components — `revenue_gross`,
`revenue_package_applied`, `revenue_credit_applied`,
`revenue_balance_adjustment`, `revenue_invoiced`, `revenue_settlements` — so a
surprising Revenue figure is auditable without re-deriving SQL.
**ASSERTION (pgTAP):** an invoice with `balance_adjustment > 0` in M →
`revenue_invoiced` excludes it; the components reconcile:
`revenue_invoiced = revenue_gross − revenue_package_applied −
revenue_credit_applied` exactly.

**⚠ RISK 7 MITIGATION (ASSERTION — Outstanding consistency).** Outstanding
must be definitionally identical to the invoices page's `totalOutstanding`
(`SwimSyncAdmin/app/(admin)/invoices/page.tsx` ~line 838: `status ===
"outstanding"`, sum of `net_amount`, no balance_adjustment subtraction — it is
"what is still being asked for", a cash figure, so raw `net_amount` is correct
here even though Revenue subtracts the adjustment). Put a comment on both
definitions cross-referencing each other. pgTAP: one outstanding + one paid
invoice in M → `outstanding` = the outstanding invoice's `net_amount` exactly.
Note in the UI copy that Outstanding for a closed month **changes over time**
as invoices get paid — that is the point of the figure, not staleness.

**Closed-month gate:** a month appears in the picker only if a `billing_periods`
row exists for `(tenant_id, M)` — that row *is* the seal (there is no boolean;
row-existence is the seal, per `platform_tenant_overview` / `unbilled_sealed_lessons`).

**⚠ RISK 5 MITIGATION (settlement bucketing — one STEP, one ASSERTION, two
documented edges).** `settled_through` is **effective-dated** (covers all
attendance on or before it, `20260725000100_student_settlements.sql`), not a
month bucket. Consequences, handled:
- **STEP (structural, no partial figures):** `accounting_summary` **RAISEs** if
  no `billing_periods` row exists for `(p_tenant, p_month)` — an unsealed month
  can still gain invoices and settlements, so any figure for it violates the
  "never a partial figure" decision. The picker only offers sealed months, but
  the RPC must refuse on its own (the picker is not the boundary).
  **ASSERTION (pgTAP):** calling `accounting_summary` for an unsealed month
  throws; the same month appears in `accounting_months` and returns figures
  after sealing.
- **ASSERTION (pgTAP, double-count guard):** a settlement whose
  `settled_through` sits in month M2 but which covers lessons in M1 and M2 →
  its full `amount` appears in **exactly one** month's `revenue_settlements`
  (M2), and `Σ revenue over {M1, M2}` counts it exactly once. Cross-month
  *attribution* is knowingly coarse; cross-month *conservation* is pinned.
- **No structural invoice/settlement double-count:** a `paid_outside`
  settlement exists precisely for lessons no invoice line covers — the engine
  reduces unclaimed attendance against settlements before billing (core.ts
  "Reduce unclaimed attendance against settlements"), and
  `unbilled_sealed_lessons` excludes invoice-covered lessons before suggesting
  one. Adding `net_amount` + `settlements.amount` is therefore sound.
  **ASSERTION (pgTAP):** a student with both an invoice in M and a
  `paid_outside` settlement dated in M → revenue = invoice net +
  settlement amount (both counted, once each). A `reversed_at IS NOT NULL`
  settlement contributes 0.
- **Documented edge (vigilance, accepted):** a settlement whose
  `settled_through` falls in a month the tenant never seals appears in **no**
  picker month. Rare (settlements are recorded against sealed-month orphans or
  unclaimed students in months being billed); put this sentence in the RPC's
  `COMMENT ON FUNCTION` so the eventual confused reader finds it.

**Wages-not-run state** (no wage-logic replication):

**⚠ RISK 1 MITIGATION (STEP — this replaces the original binary check; top
wrong-number risk).** The original draft flagged `run_payouts` only when a
tenant *has rates* but *no `coach_payouts` row at all* for M. That check is
satisfiable while wages are **partially** generated: `generate_coach_payouts`
creates payout rows only for coaches rated **at run time** (its coach filter is
`EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)`), so a coach
hired-and-rated *after* the run — or an existing coach given their first rate
after the run — has no payout row while colleagues do. The binary check would
say "final" and silently understate Wages / overstate Net. Compute a
**coverage** state instead:

- `rated_coaches(T)` := coaches `c` with `c.tenant_id = p_tenant AND EXISTS
  (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)` — the **same filter
  `generate_coach_payouts` uses**, so the two can never disagree about who is
  on payroll. **PROHIBITION (tenant scoping):** `coach_rates` has NO
  `tenant_id` column — the EXISTS must go through the `coaches` join above.
  A bare `EXISTS (SELECT 1 FROM coach_rates)` reads other tenants' rates and
  flips production's rate-less solo coach into eternal `run_payouts`.
- `rated_coaches(T)` empty → `wages_state = 'final'`, wages 0, Net = Revenue.
  **This is production today**, so Net always shows there.
- Every rated coach has a `coach_payouts` row for M, all `status='paid'` →
  `'final'`.
- Every rated coach has a row for M but ≥1 is `status='draft'` →
  **`wages_state = 'draft'`** (new, third state): show the figure **with a
  "payouts still draft" badge** — a draft payout is rebuilt from scratch on
  every regenerate and M stays markable for a month after sealing (§8.32
  reopened marking window), so this number can legitimately still move.
  Presenting it unbadged as final is a quiet wrong number.
- Any rated coach **missing** a payout row for M → `'run_payouts'`, and Wages/
  Net render **"Run coach payouts to see."**
  **PROHIBITION:** when `wages_state = 'run_payouts'`, the RPC returns `wages`
  and `net` as **NULL, never 0 and never a partial sum** — a partial sum is
  exactly the silent understatement this feature's backlog entry warns about.

**ASSERTIONS (pgTAP, each proven red against the binary-check draft):**
- tenant with 2 rated coaches, payouts generated for M, then a 3rd coach gets a
  rate → `wages_state` flips `'final'/'draft'` → `'run_payouts'` and `wages IS
  NULL`;
- a second tenant's `coach_rates` row does NOT change a rate-less tenant's
  `wages_state='final'` (tenant-scoping pin);
- all payouts paid → `'final'`; one draft → `'draft'`;
- wages exclude same-period `is_adjustment=true` items and include
  `original_period=M` ones (shared fixture with ⚠ RISK 2).

## Baked-in micro-decisions (reversible one-liners in the RPC)

1. **Revenue uses `net_amount − balance_adjustment`**, not `gross_amount` —
   `net` is what the invoice asks for after credit/package/adjustment; `gross`
   would double-count value already received as credit in a prior month, and
   `balance_adjustment` is a prior month's debit (⚠ RISK 3 above).
2. **Settlements bucket by `settled_through` month** (the period the cash covers),
   not `recorded_at`. Conservation pinned, attribution coarse (⚠ RISK 5 above).

## Build steps

### 1. Migration — two owner-gated aggregate RPCs

One new migration file. Two `SECURITY DEFINER` SQL functions following the
`unbilled_sealed_lessons(p_tenant)` **shape** (STABLE, `SET search_path =
public`, belt-and-braces grants), but **not its gate**:

**⚠ RISK 4 MITIGATION (PROHIBITION — do not copy the template's gate line).**
`unbilled_sealed_lessons` gates on `is_platform_admin() OR
can_admin_tenant(p_tenant)` — that admits **co-admins** (and the platform
admin). Copying it verbatim hands every co-admin the P&L, which is the one
thing this page must not do. The gate for BOTH new functions is exactly:

```sql
IF NOT is_tenant_owner(p_tenant) THEN
  RAISE EXCEPTION 'only the business owner may read accounting figures';
END IF;
```

`is_tenant_owner` composes `is_tenant_admin` (`20260806000100` §4), so it is
already false for: a co-admin, a deactivated owner, an owner of a *different*
tenant passing this tenant's id, and the platform admin. Deliberate residue:
the **platform admin is refused too** (owner-only was the settled decision);
support access, if ever needed, is its own decision — do not "helpfully" add
`is_platform_admin()` back. The RAISE returns **no rows and no figures** —
refusal must not leak whether the tenant has data.

**Grants** (copy `unbilled_sealed_lessons`'s belt exactly — the REVOKE list
includes `authenticated` before the single GRANT back):
`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE …
TO authenticated;`

- `accounting_months(p_tenant UUID)` → sealed `billing_month`s, newest first.
  **⚠ RISK 4 correction (premise fix):** the draft claimed `billing_periods` is
  RLS-blocked to tenant admins. **False** — `billing_periods_select`
  (`20260718000900_tenant_rls.sql:477`) allows `is_tenant_admin(tenant_id)`,
  and `authenticated` holds SELECT (`20260804000600:86`). The RPC still exists,
  but for a different reason: it keeps the page's entire data surface behind
  **one** owner gate instead of two access paths with different audiences. Do
  NOT write a pgTAP test asserting a co-admin cannot read `billing_periods`
  directly — it would fail, correctly.
- `accounting_summary(p_tenant UUID, p_month CHAR(7))` → `revenue`,
  `revenue_invoiced`, `revenue_settlements`, `revenue_gross`,
  `revenue_package_applied`, `revenue_credit_applied`,
  `revenue_balance_adjustment`, `outstanding`, `wages`, `net`,
  `wages_state` (`'final'` | `'draft'` | `'run_payouts'`; wages/net NULL on
  `'run_payouts'`). RAISEs on an unsealed month (⚠ RISK 5). Wages per
  ⚠ RISK 1 + ⚠ RISK 2; revenue per ⚠ RISK 3.

### 2. pgTAP test — `accounting.test.sql`

Prove red without the migration, then green with it. The full assertion set
lives inline above (⚠ RISK 1/2/3/5/7); headline list:
- a co-admin calling either RPC is refused (exception, zero rows); the owner
  gets figures; an owner of tenant A passing tenant B's id is refused —
  **⚠ RISK 4 ASSERTION:** this trio must fail against a `can_admin_tenant`
  gate, which is what proves the template's gate was not copied;
- a `paid_outside` settlement is included; a `reversed` one is not; a
  multi-month settlement counts exactly once (⚠ RISK 5);
- wages: adjustment reallocation by `original_period` (⚠ RISK 2); coverage
  states incl. the newly-rated-coach flip and tenant-scoped rates (⚠ RISK 1);
- revenue components reconcile; `balance_adjustment` excluded (⚠ RISK 3);
- an un-sealed month is absent from `accounting_months` AND `accounting_summary`
  refuses it (⚠ RISK 5);
- **PROHIBITION (vacuous-fixture guard, §7.25 spirit):** every revenue/wages
  assertion compares against a hand-computed non-zero expected value — a
  fixture that sums to 0 passes against a `SELECT 0` stub and proves nothing.
  No assertion may have 0 as its expected figure except the explicit
  reversed-settlement and rate-less-tenant cases.

### 3. Admin page — `SwimSyncAdmin/app/(admin)/accounting/page.tsx`

Client component copying the `/admins` owner-gate pattern (`isOwner` check →
owner-only empty state for co-admins). Month `<select>` from `accounting_months`,
figure tiles from `accounting_summary`, the `'draft'` badge and `'run_payouts'`
state on Wages/Net.

**⚠ RISK 6 MITIGATION (STEP + PROHIBITION — no flash, no orphan errors).**
- **PROHIBITION:** render **no figure and fire no `accounting_*` RPC call**
  until `isOwner` has *resolved* `true` — the tri-state matters: "not yet
  known" renders the loading state, never the figures and never the co-admin
  empty state (§7.19's shape: refuse only a resolved negative). This kills
  both the flash-of-figures and the co-admin console-error noise from a
  refused RPC.
- The RPC remains the real boundary: even a misrendered page cannot show a
  co-admin numbers, because the server refuses (⚠ RISK 4). The UI gate is
  honesty, not the boundary — same sentence as `/admins`.
- Empty-months state: a tenant that has never sealed a month gets "No closed
  months yet — figures appear after your first billing run", not a broken
  dropdown.

### 4. Nav — `SwimSyncAdmin/lib/adminNav.ts`

**⚠ RISK 6 MITIGATION (STEP — follow the `/admins` precedent, do not invent an
owner-scope).** `NavItem.scope` is only `tenant | platform` and the Sidebar has
no owner-ness input today; `/admins` — the existing owner-managed page — is
**visible to co-admins** and owner-gates on the page itself. Do the same:
add `{ href: "/accounting", label: "Accounting", scope: "tenant" }` (Billing
group), visible to all tenant admins, page owner-gates per step 3.
**PROHIBITION:** do not add an `owner` nav scope or async owner state to the
Sidebar for this feature — a second, differently-sourced owner check is a
second thing to drift, and hiding was never the boundary. (If the user later
wants the link hidden, that is a deliberate Sidebar-data change, its own task.)
Note: `scopeForPath()` fail-closes unknown paths to `tenant`, so the route is
correctly scoped even before the NAV entry lands — but the entry must land, or
the page is reachable only by URL.

### 5. vitest

Unit the client-side state-derivation/formatter in `lib/` (wages_state → tile
rendering incl. NULL-wages handling); assert the page's owner-gate renders the
empty state for a resolved non-owner and the **loading state (not figures, not
the empty state) while owner-ness is unresolved** (⚠ RISK 6). Assert the
`run_payouts` state renders no number anywhere (a `S$0.00` here is the ⚠ RISK 1
failure leaking through the UI layer).

### 6. Verify

`supabase test db`, admin `npm run typecheck` + `npm test`, then drive the real
UI (owner sees figures; co-admin gets the empty state; a month with draft
payouts shows the badge).

## Deploy

New functions → **remote grant dump** required (§7.39/§7.89). Order: migration →
prod → grant dump → app to `main` **last**. No engine change (`core.ts`
untouched — the Deno suite is unaffected). Run `/deploy` (hard-gates the app
push behind 0-pending).

---

## Risk register (ranked, most → least; mitigations live inline above)

1. **Wages partially generated reads as final** — coverage check per rated
   coach, tenant-scoped rate lookup, NULL-not-partial, `'draft'` state.
2. **Adjustment exclusion breaks accrued wages** — reallocate by
   `original_period` (figure DEFINITION change).
3. **`balance_adjustment` inside `net_amount` contaminates Revenue across
   months** — subtract it; expose components (figure DEFINITION change).
4. **Gate copied verbatim from the template admits co-admins**, and the
   billing_periods-RLS premise was false — `is_tenant_owner` only; premise
   corrected.
5. **Settlement bucketing** — refuse unsealed months structurally; pin
   count-exactly-once; document the never-sealed edge.
6. **UI/nav owner-gate** — `/admins` precedent for nav; tri-state isOwner, no
   fetch before resolution.
7. **Outstanding drifts from the invoices page's definition** — pinned
   identical, cross-referenced comments.

## Pre-commit GATE — walk before `/commit-review`

Highest value first; the first three are the wrong-number guards:

- [ ] **Wages SQL sums `(period_month=M AND NOT is_adjustment) OR
      (is_adjustment AND original_period=M)`** — and the pgTAP adjustment
      fixture went red against the exclusion-only draft. (⚠ RISK 2)
- [ ] **`wages_state` is a per-rated-coach coverage check** (not "any payout
      row"), the rate EXISTS goes through `coaches.tenant_id`, and
      `run_payouts` returns NULL wages/net — newly-rated-coach test went red
      against the binary check. (⚠ RISK 1)
- [ ] **Revenue subtracts `balance_adjustment`** and the components-reconcile
      pgTAP assertion passes with non-zero figures. (⚠ RISK 3)
- [ ] Both RPCs gate on `is_tenant_owner(p_tenant)` — grep the migration for
      `can_admin_tenant`: **zero hits**. Co-admin + cross-tenant-owner pgTAP
      refusals pass. (⚠ RISK 4)
- [ ] `accounting_summary` RAISEs on an unsealed month; multi-month settlement
      counted exactly once. (⚠ RISK 5)
- [ ] No `accounting_*` RPC call and no figure render before `isOwner` resolves
      true; NAV entry present with `scope: "tenant"`, no new owner scope.
      (⚠ RISK 6)
- [ ] No pgTAP money assertion has an expected value of 0 outside the two
      named zero cases. (vacuous-fixture guard)
- [ ] Deploy notes intact: migration → prod → **grant dump** → app last.
