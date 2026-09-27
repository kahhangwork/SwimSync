# Wave 2 — package revenue + in-app refunds — BRIEF

> **Status: NOT STARTED — a brief, not a plan** (written 2026-09-27). Decisions are settled; code-level steps are
> deliberately **not** written, because Roles (Wave 1) will change the files and policies they would cite. Turn this
> into a full plan (`/plan-with-confidence`, ~30 min) once `ROLES_PERMISSIONS_PLAN.md` has shipped.
> Index: `docs/plans/README.md`. Backlog: *Package revenue on the accounting page*, *In-app package refunds*.

## Why these two, together

Packages are dormant on prod today, and the user plans to sell them soon. Two gaps show the moment the first one sells:

1. **Package money never reaches the owner's P&L.** `accounting_summary` (`20260823000100`) subtracts
   `package_applied` from invoice revenue and counts the purchase nowhere — a family on a package contributes S$0.
2. **A cancelled package's refund happens entirely off-app.** Cancelling freezes `value_remaining` and the modal says
   *"settle any refund with the family directly"*. Fine at one business, unauditable at ten.

They share one surface (the Accounting page), so they ship in one lane, **revenue first, then refunds**.

## Decisions (settled with the user, 2026-09-27)

| # | Decision |
|---|---|
| W1 | **Package revenue counts in the month the package is PAID** — cash-style, the month of `parent_packages.confirmed_at` (SGT), amount `amount_payable` (what the parent actually paid, after any referral discount). A **deliberate exception** to the 2026-08-16 accrual basis — do not "fix" it back to per-lesson recognition. |
| W2 | No double count: package-funded invoice lines stay subtracted from invoice revenue; the purchase is added **once**, as its **own breakdown line**. |
| W3 | **Refunds are package-only.** The one case: a package **cancelled with value left** (family moves, injury, child quits, class closed with no alternative). Monthly invoices already correct through credit notes. |
| W4 | **A refund subtracts from Revenue in the month it is paid out**, as its own breakdown line (mirror of W1). |
| W5 | **Who may refund:** anyone with `packages:edit` under Roles (the user made every area grantable, D4 of the Roles plan). The standard roles give it to *Full admin* only, so by default it is the owner's. *(Supersedes the earlier "owner-only" answer — the user chose "grantable, owner decides".)* |
| W6 | Package revenue and refunds live under the **Accounting** area for viewing, and **Packages & referrals** for acting. |

## Facts the full plan starts from

- `parent_packages` columns that matter: `status` (`pending`/`active`/`cancelled`), `confirmed_at` (admin confirms
  payment → active), `cancelled_at`, `amount_payable`, `total_value`, `value_remaining`, `discount_amount`,
  `rate_per_lesson`, `lesson_count`, `paid_claimed_at` (the parent *says* paid — not revenue).
- A `pending` package that is declined was never paid → never revenue.
- Accounting only offers **closed** (billing-sealed) months (PRD §7.23). A package paid in the current open month
  shows once that month closes — say so on the page, don't special-case it.
- Refund data needs a new table (e.g. `package_refunds`: package, amount, refunded_on, refunded_by, note), audited;
  `CHECK amount > 0 AND amount ≤ the package's refundable value`. One refund per package unless the user says
  otherwise (Q3).

## Open questions — ask before the full plan

1. **Refund amount rule.** Candidates: (a) *suggested, editable* — the 2026-07-20 convention, paid − (lessons taken ×
   walk-in rate), admin can adjust; (b) the formula, fixed; (c) pro-rata unused lessons at the package rate; (d) admin
   types any amount. The backlog's default candidate is (a).
2. **Does the parent get a refund email** (via `package-emails`)? If yes, it inherits the crash-safe claim pattern
   from Wave 1 lane 2 — or stays stateless like the other package emails.
3. One refund per package, or several partial ones?
4. Is a refund recorded as **paid out** (money already sent) or **owed** (to pay), or both states?
5. Does the parent see the refund anywhere (their Billing card)?

## Risks to carry into the plan

- **Revenue now mixes two bases** (accrual invoices + cash packages). The breakdown must label both, or a surprising
  Revenue is unexplainable (the page's own auditability rule).
- Referral discount: revenue is `amount_payable`, not `total_value` — pin it with a test using a discounted package.
- A refund must never exceed what was paid for the unused part; guard in SQL, not in the form.
- Roles: the refund RPC is born with `has_admin_area(t,'packages','edit')`; the Accounting lines with
  `accounting:view`. No owner-only special case.
