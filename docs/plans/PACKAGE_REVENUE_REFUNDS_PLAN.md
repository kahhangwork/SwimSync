# Wave 2 — package revenue + in-app package refunds — PLAN

_Planned 2026-09-27 from `WAVE_2_PACKAGES_BRIEF.md` (decisions W1–W6 there stand). Open questions Q1–Q7 settled with
the user the same day — table below. Backlog: *Package revenue on the accounting page*, *In-app package refunds*.
Hardened by `/plan-review` 2026-09-27 — every `⚠ RISK n MITIGATION` is a step, a pass/fail assertion or a named
prohibition; the pre-commit gate at the end walks them._

**Two units, one lane, strictly in order: U1 revenue → U2 refunds.** Each unit is its own `db/…` migration branch in
the ROOT checkout (never a worktree), applied + `supabase test db` + merged before the app work that consumes it (one
schema change in flight at a time). Deploy order per unit: migration → apps to `main` LAST (§7.60). No edge function
changes.

**Estimate:** U1 ≈ 4h (migration + pgTAP + mutation proofs 2h, page + tests 1h, driver 1h). U2 ≈ 6.5h (migration +
pgTAP 2.5h, Packages row + modals + tests 2.5h, driver 1.5h). About 1.5 working days.

## Decisions settled 2026-09-27 (the brief's open questions) — NOT to be re-opened by implementation

| # | Question | Answer |
|---|---|---|
| Q1 | Refund amount rule | **Admin types any amount.** No suggested figure. |
| Q1b | Hard ceiling (SQL) | **Everything paid** — `amount ≤ parent_packages.amount_payable`. A goodwill full refund is allowed even after lessons were used. |
| Q2 | Parent email / parent visibility | **Nothing in-app now.** Billing-card line + refund email filed to `BACKLOG.md` (*Show package refunds to the parent*). |
| Q3 | Refunds per package | **One live refund per package** (partial unique index on non-reversed rows). |
| Q4 | Owed vs paid out | **Paid out only.** Recording a refund means the money has been sent; its date decides its Accounting month. |
| Q5 | Refund date | **Defaults to today (SGT); may be back-dated, never into the future, never into a CLOSED month** (a month with a `billing_periods` row for the tenant), and never before the package's confirmation date. Closed figures never change. |
| Q6 | Where | **On the cancelled row** of the Packages page — cancel stays as today; a cancelled, once-paid package gets *Record refund*. Two deliberate steps. |
| Q7 | Mistakes | **Reverse, then re-record** — `reversed_at/by` like `student_settlements`; only while the refund's month is still open. |

Implied: *Record refund* shows on every **cancelled package that was confirmed** (`confirmed_at IS NOT NULL`) —
including one with S$0 value left, since the cap is what was paid, not what remains. A declined pending request was
never paid → no button, and the RPC refuses it.

---

## U0 — pre-flight (before any code; ~15 min)

1. Capture the live bodies this lane replaces — the diff base, the DOWN bodies, and the §7.40 source — to the
   scratchpad (not the repo): `accounting_summary`, `enforce_parent_package_lifecycle`, `audit_log_tenant_of` via
   `docker exec supabase_db_SwimSync psql -U postgres -Atc "select pg_get_functiondef('public.<fn>'::regproc);"`.
2. Record baseline counts from the runners (not prose): `supabase test db` (files/assertions, 0 failures),
   `supabase/functions/generate-invoices/test.sh` ×2, `cd SwimSyncAdmin && npm test`,
   `run-all-drivers.sh --only verify-packages-admin` (currently 49/49).

   ⚠ RISK 4 MITIGATION — **prod census, read-only, before U1's migration is pushed:**
   `supabase db query --linked "select count(*) filter (where confirmed_at is not null) as confirmed, count(*) filter (where confirmed_at is not null and status='cancelled') as cancelled_paid from parent_packages;"`.
   **Pass = `0 | 0`** (packages dormant). If `confirmed > 0`: list the rows (tenant, month, amount_payable) and
   **STOP and ask the user** — U1 will add them to closed months (and test sales would inflate an owner's revenue). If
   `cancelled_paid > 0`, any refund already paid off-app for them can never be recorded (Q5) → overstated forever.
   The user decides; do NOT add a back-dating override to the closed-month rule to "fix" it.

---

## U1 — package revenue on the accounting page

### U1.1 Migration `db/package-revenue` — `…_accounting_package_revenue.sql` (+ `supabase/rollback/…_DOWN.sql`)

1. **Pin `confirmed_at` against back-dating.** Today `enforce_parent_package_lifecycle` accepts a client-supplied
   `confirmed_at` on INSERT (`COALESCE(NEW.confirmed_at, NOW())`) and on pending→active
   (`COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW())`). No app code passes it (grep: 0 hits), but once it
   decides a revenue month a back-dated value would land revenue in a closed month. For `current_user =
   'authenticated'` force `NEW.confirmed_at := NOW()` on both paths; service role unchanged. Body copied from
   `pg_get_functiondef`, not a migration file (§7.40).

   ⚠ RISK 2 MITIGATION — this function sits under every package sale, request, confirmation and cancellation:
   - **Assertion:** `diff` new body vs U0 capture → **pass = exactly the two `confirmed_at` lines changed.** Any other
     hunk is a copy error; fix before applying.
   - **Assertion:** `supabase test db` failures = 0 with the new trigger. If a test goes red because its fixture
     INSERTed/confirmed as `authenticated` with a past `confirmed_at`, rewrite that fixture's write as superuser
     (`RESET ROLE`). **Do NOT relax the pin, add a bypass, or special-case a role to make a fixture pass.**
   - **Step:** `generate-invoices/test.sh` **twice** (§7.15) — the engine orders its FIFO by `confirmed_at`
     (`core.ts:1221`); both runs green.
   - **Step:** `--only` each of `verify-packages-admin`, `verify-packages`, `verify-package-renewal` → **pass = U0 counts.**
   - **Prohibition:** the `current_user` read stays in this INVOKER trigger. Do NOT make it `SECURITY DEFINER`
     (`recurring_gotchas` refuses `current_user` in a definer, §7.38 — and it would always read the owner).

2. **`accounting_summary` gains `revenue_packages NUMERIC`.** Return type changes → `DROP FUNCTION` + `CREATE`
   (same signature `(uuid, char)`). Body copied from the live DB (latest is `20260927000500`, with the
   `accounting:view` gate).
   - `v_packages := SUM(pp.amount_payable)` over `parent_packages pp WHERE pp.tenant_id = p_tenant AND
     pp.confirmed_at IS NOT NULL AND to_char(pp.confirmed_at AT TIME ZONE 'Asia/Singapore','YYYY-MM') = p_month`.
     **Status is not filtered**: a package paid then cancelled was still paid in that month (its refund is U2's
     line). `amount_payable`, never `total_value` (referral discount, W1).
   - `revenue = v_invoiced + v_settlements + v_packages`; `net` follows.
   - `revenue_package_applied` stays subtracted inside invoiced revenue (W2, no double count).

   ⚠ RISK 1 MITIGATION — make a wrong figure structurally hard:
   - **Step:** declare `v_revenue NUMERIC` and assign it ONCE (`v_revenue := v_invoiced + v_settlements +
     v_packages;`); both the `revenue` column and the `net` CASE read `v_revenue`. **Prohibition:** no revenue
     arithmetic inside `RETURN QUERY` — the live body repeats it there, and a component added to one copy only gives
     a silently wrong Net.
   - **Prohibition:** no `to_char(pp.confirmed_at, …)` / `::date` on a timestamptz without `AT TIME ZONE
     'Asia/Singapore'` (§7.7, §7.227).
   - **Assertion:** `diff` vs U0 capture → **pass = only** the new DECLAREs, the `v_packages` SELECT, the `v_revenue`
     assignment and the `RETURN QUERY` columns. The `has_admin_area(…,'accounting','view')` gate and the "month % is
     not sealed" refusal are byte-identical.
   - **Step:** same migration: `REVOKE ALL ON FUNCTION public.accounting_summary(UUID, CHAR) FROM PUBLIC, anon,
     authenticated, service_role;` then `GRANT EXECUTE … TO authenticated;` (the original `20260823000100` shape —
     cloud default privileges differ, §7.39; a bare GRANT is not enough).
   - **Assertion:** `\df accounting_summary` shows exactly **1** row (§7.124).
   - **Assertion:** `accounting_summary.test.sql` passes **all 38 existing assertions with their expectations
     unchanged** — its fixture has no packages, so any expectation edit there means the new body changed an old
     figure (blocker).

3. ⚠ RISK 3 MITIGATION (lands in U1's migration so U2 only consumes it) — `CREATE OR REPLACE audit_log_tenant_of`
   from the U0 capture, adding one arm:
   `WHEN 'parent_package' THEN SELECT pp.tenant_id INTO v_tenant FROM parent_packages pp WHERE pp.id = p_entity_id;`.
   **Assertion:** diff vs capture = that arm only. **Prohibition:** the refund RPC must NOT audit under `'Tenant'` or
   pass its own `tenant_id` to dodge the raise — the audit row must name the package. (Moving this step into U2's
   migration is fine; it must land before any refund RPC exists.)

4. pgTAP `supabase/tests/accounting_package_revenue.test.sql` — fixture uses its own tenant with **no rated coaches**
   (`wages_state='final'`, wages 0, `net` non-NULL), two sealed months `mM-1` and `mM`:
   - discounted package (total 300, payable 270) confirmed in `mM` → `revenue_packages = 270`, not 300;
   - package confirmed at `mM`-01 07:30 SGT (= previous day UTC) counts in `mM` **and not** in `mM-1` — both months
     asserted; the second is the one that catches a UTC bucket (§7.7/§7.227);
   - pending / declined package → 0; confirmed-then-cancelled → still counted;
   - invoice with `package_applied` + package bought the same month → gross − applied + payable (no double count);
   - other tenant's package → not counted;
   - **`net = revenue − wages` and `revenue = invoiced + settlements + packages`** on the wages-final month with a
     non-zero package figure;
   - an `authenticated` INSERT-as-active and an `authenticated` pending→active, each with a past `confirmed_at` →
     stored as `now()`;
   - `audit_log_tenant_of('parent_package', <pkg>)` returns the package's tenant;
   - EXECUTE on `accounting_summary`: `authenticated` yes; `anon`, `service_role`, `PUBLIC` no;
   - `table_grants.test.sql`, `function_grants.test.sql` still green.

   ⚠ RISK 8 MITIGATION — make the fixture real and the red-first proof honest:
   - **Step:** the lifecycle trigger resets `discount_amount`/`amount_payable` on every INSERT, for every role — so
     build the discounted package by superuser `UPDATE` after insert, and **assert the precondition first**
     (`total_value = 300 AND amount_payable = 270`). Without it, the "270 not 300" check is vacuous.
   - **Step:** write every fixture package's `confirmed_at` as superuser (`RESET ROLE`) — the new pin forces `now()`
     under `authenticated`.
   - **Step:** prove red by **mutating the NEW body**, one at a time, recording each in the test header (§7.25):
     (a) `to_char(pp.confirmed_at,'YYYY-MM')` without the zone → boundary pair red; (b) `total_value` for
     `amount_payable` → discount check red; (c) `AND pp.status <> 'cancelled'` → cancelled check red; (d) `net`
     computed from `v_invoiced + v_settlements` → net check red; (e) remove the pin → back-date checks red.
     **Prohibition:** "run it against the old function" does NOT count as the red proof — it errors on the missing
     column, not on the rule.

5. **DOWN** `supabase/rollback/…_accounting_package_revenue_DOWN.sql` restores the three U0-captured bodies (for
   `accounting_summary`: DROP + CREATE + REVOKE/GRANT).
   ⚠ RISK 11 MITIGATION: **execute it locally** (up → down → up). **Pass = `pg_get_functiondef` of all three
   byte-identical to the U0 capture after the down**, and `supabase test db` green after the second up (DEPLOYMENT:
   "a committed rollback file is not a verified one").

### U1.2 Admin app — Accounting page

- `types.ts` / `summaryRow.ts`: add `revenue_packages` (`accounting.rpc.ts` unchanged — it passes through).
- `Figures.tsx`: Revenue tile sub-line becomes *Invoices + settlements + packages*; breakdown gains
  `+ Packages sold (paid this month)` between *Outside settlements* and *= Revenue*.
- One note under the breakdown: *"Invoices count the month they bill; packages count the month they were paid."*
  (the mixed-basis risk from the brief). And: *"A package paid this month appears once the month closes."*
- Tests: `summaryRow.test.ts` / `page.test.tsx` — the new line renders, revenue sums three parts. Proven red first.

  ⚠ RISK 1 MITIGATION: **assertion** in `summaryRow.test.ts` — `toSummary({ …, revenue_packages: "270.00" })` →
  `revenue_packages === 270`; proven red by deleting the mapping line (without it the page silently shows "—").

  ⚠ RISK 10 MITIGATION: **assertion** in `page.test.tsx` that the two package lines are distinguishable: *− Packages
  applied* stays labelled as the invoice deduction and the new line reads exactly `+ Packages sold (paid this month)`,
  plus the note text. **Prohibition:** do NOT rename or merge the existing *− Packages applied* line (W2 keeps it); add
  a `title` on it: *"Lessons paid from a package — the package itself is counted when sold."*

### U1.3 Driver + ship

- Accounting cannot show a package sold today (today's month is never sealed).

  ⚠ RISK 8 MITIGATION — **decided now:** a new `verify-accounting-packages.mjs` with its own fixture: own tenant
  (new UUID prefix — `git grep -nE '<pp>[0-9a-f]{6}-0000' -- '*.sql' '*.mjs' '*.ts'` → 0 hits, §7.280; join
  codes/slugs grepped the same way), one package (payable ≠ total) with `confirmed_at` in a past month written as
  superuser, a `billing_periods` row for that month for the fixture tenant only, no rated coaches. The driver logs in
  as the fixture owner, picks that month, asserts the *Packages sold* line = `amount_payable` (not `total_value`) and
  Revenue = invoiced + settlements + packages. Teardown deletes the fixture tenant's rows by the full
  `'<pp>000000-%'` block. **Do NOT seal the seed tenant's current month** (moves `markable_floor`, breaks other
  drivers). Mutation proof: `total_value` in the SQL → driver red, recorded in the driver header (§7.25).
- `/commit-review` → `/deploy`: migration to prod (0 pending, **remote grant dump** after the DROP/GRANT, §11.7) →
  push apps → grep the served admin bundle.

  ⚠ RISK 11 MITIGATION:
  - **Assertion:** remote grant dump shows `accounting_summary` EXECUTE = `authenticated` only and
    `audit_log_tenant_of` unchanged.
  - **Assertion:** the bundle grep is for the contiguous literal `Packages sold (paid this month)` (§7.51); a 200
    proves nothing (§7.31).
  - **Assertion:** U0's prod census passed (`0 | 0`) before the push — that is what makes the old-app window between
    migration and app harmless (`revenue_packages = 0` everywhere).

---

## U2 — in-app package refunds

### U2.1 Migration `db/package-refunds` — `…_package_refunds.sql` (+ `supabase/rollback/…_DOWN.sql`)

1. **Table `package_refunds`**: `id`, `tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE`,
   `parent_package_id uuid NOT NULL REFERENCES parent_packages ON DELETE CASCADE`,
   `amount numeric(10,2) CHECK (amount > 0)`, `refunded_on date NOT NULL`, `note text`,
   `recorded_by uuid NOT NULL REFERENCES profiles`, `recorded_at timestamptz NOT NULL DEFAULT now()`,
   `reversed_at timestamptz`, `reversed_by uuid REFERENCES profiles`,
   `CHECK ((reversed_at IS NULL AND reversed_by IS NULL) OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL))`
   (the `student_settlements` shape).
   `CREATE UNIQUE INDEX … ON package_refunds(parent_package_id) WHERE reversed_at IS NULL` (Q3), plus
   `(tenant_id, refunded_on) WHERE reversed_at IS NULL` for the accounting read.
   `tenant_id` is set by the RPC from the locked package row — no client can INSERT (no grant), so no trigger needed.

   ⚠ RISK 7 MITIGATION:
   - **Step:** `ALTER TABLE package_refunds ENABLE ROW LEVEL SECURITY;` and
     `REVOKE ALL ON TABLE package_refunds FROM PUBLIC, anon, authenticated, service_role;` before the single
     `GRANT SELECT … TO authenticated` (cloud default privileges differ from local, §7.39).
   - **Step:** add `('package_refunds|profiles')` to `_known_pairs` in `recurring_gotchas.test.sql` — `recorded_by`
     and `reversed_by` are two FKs to `profiles` and the suite goes red on a new unlisted pair (§7.90).
   - **Assertion:** the CASCADE FKs are pinned in pgTAP (`fk_ok` / catalogue check) — they are why the driver fixture's
     `DELETE FROM parent_packages WHERE tenant_id=…` reset (§7.281) and the Deno tenant teardown (§7.258) keep working.

2. **Writes only through RPCs** (no INSERT/UPDATE grant to `authenticated`):
   - `record_package_refund(p_package uuid, p_amount numeric, p_refunded_on date, p_note text)` — `SECURITY DEFINER
     SET search_path = public`; selects the package `FOR UPDATE` first and takes the tenant from that row (never from
     a parameter); gates on `is_platform_admin() OR has_admin_area(tenant,'packages','edit')`; refuses unless
     `status='cancelled'` AND `confirmed_at IS NOT NULL`; `amount ≤ amount_payable` (Q1b, in SQL not the form);
     `refunded_on ≤` SGT today, `≥` SGT date of `confirmed_at`, and its month has **no** `billing_periods` row for the
     tenant (Q5); refuses a second live refund with a readable message *before* the insert (the unique index is the
     backstop); writes `audit_log` (`action='package_refund'`, `entity_type='parent_package'`, `entity_id` = the
     package, `new_value` = amount/date/note/refund id).
   - `reverse_package_refund(p_refund uuid)` — same gate on the refund's tenant; refuses if already reversed or its
     month is now closed; sets `reversed_at/by`; audits `package_refund_reversed`.
   - Both `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then `GRANT EXECUTE … TO authenticated`
     (§7.82, §7.87).

   ⚠ RISK 5 MITIGATION:
   - **Prohibition:** no `CURRENT_DATE`, `now()::date` or bare `::date` on a timestamptz. "Today" = `today_sg()`;
     "confirmation date" = `(confirmed_at AT TIME ZONE 'Asia/Singapore')::date`; the month key is
     `to_char(p_refunded_on,'YYYY-MM')` compared to `billing_periods.billing_month` (char(7)). (`class_terms.test.sql`
     already fails on any function containing `CURRENT_DATE`/`now()::date` — keep it green.)
   - **Step:** refuse `p_amount` with more than 2 decimals (`p_amount <> round(p_amount, 2)`) so the check and the
     stored `numeric(10,2)` value can never disagree at the ceiling.
   - **Step:** every `RAISE` text is a sentence a business owner can read (the modal shows it verbatim), e.g.
     *"That month is closed — refunds can only be dated in an open month."*
   - **Accepted, recorded in the migration header:** a back-dated refund can commit in the milliseconds after
     `generate-invoices` seals that same month (only possible for a refund dated last month, during that month's
     billing run; the engine seals over HTTP without a shared lock, and adding one is out of scope). Accounting reads
     live, so the refund simply belongs to the just-closed month. **Do NOT "close" this race by adding an override or
     a post-seal edit path.**

   ⚠ RISK 9 MITIGATION: **assertion** — two sequential `record_package_refund` calls on the same package: the second
   raises the readable "already has a refund" message (SQLSTATE `P0001`), **not** `23505`.

   ⚠ RISK 3 MITIGATION: **assertion** — after a record and a reverse, `audit_log` holds exactly 2 rows for the package,
   both with `tenant_id` = the package's tenant.

3. **RLS SELECT policy** `is_platform_admin() OR has_admin_area(tenant_id,'packages','view') OR
   has_admin_area(tenant_id,'accounting','view')` + matching `GRANT SELECT` only (`table_grants` must stay green — no
   privilege a policy can't permit). The `is_platform_admin()` arm mirrors `parent_packages_select`.

4. **`accounting_summary` gains `revenue_package_refunds`** — `SUM(amount)` of non-reversed refunds with
   `to_char(refunded_on,'YYYY-MM') = p_month` (a `date`, already SGT — no tz cast); subtracted from `revenue`. Second
   DROP + CREATE + REVOKE/GRANT; body from the live DB (U1's).

   ⚠ RISK 1 MITIGATION: the subtraction goes into the single `v_revenue` assignment
   (`v_revenue := v_invoiced + v_settlements + v_packages - v_refunds;`); the column holds a **positive** figure (the
   UI labels it "−"). **Assertion:** diff vs U1's live body = the refund hunks only; gate and unsealed refusal
   byte-identical; `\df` = 1 row; EXECUTE = `authenticated` only; `accounting_package_revenue.test.sql` and
   `accounting_summary.test.sql` still pass unchanged.

5. pgTAP `supabase/tests/package_refunds.test.sql`: gate (view-only role refused, other tenant's admin refused,
   coach/parent refused); pending/declined/active refused; amount 0 / `> payable` refused, `= payable` allowed,
   3 decimals refused; future date, closed-month date, pre-confirmation date refused; second live refund refused;
   reverse then re-record allowed; reverse in a now-closed month refused; accounting subtracts in the refund's month
   only and ignores a reversed row; audit rows written; `anon` has nothing. Every guard proven red against a mutated
   RPC, one at a time, recorded in the header (§7.25).

   ⚠ RISK 5 MITIGATION — dates tested **at** their boundaries, computed independently (§7.94, §7.260):
   `today_sg()` allowed / `today_sg() + 1` refused; a package confirmed at 07:30 SGT on day D (D−1 in UTC) → refund
   dated D allowed, D−1 refused; closed-month refusal on the last day of the sealed month, allowed on the 1st of the
   next open month.

   ⚠ RISK 8 MITIGATION: the view-only co-admin is built with a real role row (or is the owner) — a non-owner
   `tenant_admin` with no role only passes because the deferred check never fires in a rolled-back test (§7.294). The
   "accounting subtracts" check runs on a wages-final month and asserts `net` too. A refund larger than the month's
   other revenue gives a **negative** `revenue`/`net` — asserted exactly.

6. **DOWN** `supabase/rollback/…_package_refunds_DOWN.sql`: restores U1's `accounting_summary` (captured before U2's
   migration), drops both RPCs and the table, removes the `_known_pairs` row.

   ⚠ RISK 11 MITIGATION:
   - **Step:** the DOWN starts with
     `DO $$ BEGIN IF EXISTS (SELECT 1 FROM package_refunds) THEN RAISE EXCEPTION 'package_refunds holds rows — rolling back would delete recorded refunds'; END IF; END $$;`.
     **Prohibition:** never delete refund rows to make the DOWN run on prod.
   - **Step:** execute it locally (up → down → up), byte-identical `pg_get_functiondef` of `accounting_summary` after
     the down.

### U2.2 Admin app — Packages page

- `packages.repo.ts`: add `confirmed_at` to `loadPurchases`'s select; a separate `loadRefunds()` —
  `package_refunds` `id, parent_package_id, amount, refunded_on, note, reversed_at` filtered `.is("reversed_at", null)`.
  `packages.rpc.ts`: `recordPackageRefund`, `reversePackageRefund` (pass-through only — "orchestrate, never replace").

  ⚠ RISK 6 MITIGATION:
  - **Prohibition:** do NOT embed `package_refunds(...)` inside `loadPurchases` — a refund-grant problem (e.g. cloud
    §7.39) would empty the whole Packages page for every admin. With a separate query, a failure **hides all refund
    controls** and shows one inline line *"Refund details couldn't load."* (fails closed: no *Record refund* when a
    refund might exist).
  - **Step:** a pure domain helper `refundState(purchase, liveRefund, canEdit)` →
    `none | can_record | recorded | recorded_readonly`, unit-tested over the matrix: active → none; cancelled with
    `confirmed_at` NULL (declined request) → none; cancelled+confirmed with `amount_payable = 0` → none;
    cancelled+confirmed, no live refund → `can_record` / `none` by `canEdit`; live refund → `recorded` /
    `recorded_readonly`; refunds fetch failed → none. Proven red by removing the `confirmed_at` condition.
- `HeldTable` (the row component for cancelled purchases): no live refund → **Record refund** button; live refund →
  *"Refunded S$X on 3 Oct"* (`formatSgStamp`, §7.229) + **Reverse**. Buttons only with `packages:edit`; view-only sees
  the text.

  ⚠ RISK 6 MITIGATION:
  - **Step:** `canEdit = status === "ready" && can(perms, "packages", "edit")` from `usePermissions()` — while
    permissions load or fail, `canEdit` is false (fail closed).
  - **Prohibition:** `confirmAction` does not exist in SwimSyncAdmin, and `window.confirm` is auto-accepted by driver
    `launch()` (§7.279) — **Reverse confirms through a `Modal`** shaped like `CancelModal` (*"Keep it"* /
    *"Reverse refund"*), never `window.confirm`, never `Alert`.
- New `RefundModal.tsx` + `useRefund.ts`: amount; date (default `todayInSg()`, `max` today, `min` = SGT date of
  `confirmed_at` via `toSgDate`); note; server error shown inline (the SQL is the guard; the form only mirrors it).

  ⚠ RISK 10 MITIGATION: **Prohibition:** no number in the amount input's placeholder (Q1: no suggested figure). The
  ceiling is a helper line under the field: *"Up to S$270.00 — what the family paid."*

  ⚠ RISK 9 MITIGATION: **Step:** submit disabled while `busy` (the page's shared flag); the modal shows the RPC's
  `error.message` verbatim inline. **Assertion** (vitest): a mocked RPC error *"That month is closed…"* renders in the
  modal and the modal stays open.
- `CancelModal` copy: *"…settle any refund with the family directly; SwimSync keeps the record…"* →
  *"…Cancelling freezes it. If you refund the family, record it on the cancelled package afterwards."*
- Accounting `Figures.tsx`: `− Package refunds (paid out this month)` line before *= Revenue*; `types.ts`/
  `summaryRow.ts` gain `revenue_package_refunds`.

  ⚠ RISK 1 MITIGATION: **assertion** in `summaryRow.test.ts` for the new mapping (red by deleting it).
  ⚠ RISK 10 MITIGATION: **assertion** that a negative revenue renders as `-S$…` (`moneyOrDash`) on the tile and the
  breakdown.
- Tests: RefundModal validation + rendering states (vitest), rpc error surfaced, `refundState` matrix. Proven red first.

### U2.3 Driver + ship

- Extend `verify-packages-admin.mjs`: cancel an active package → *Record refund* → amount → row shows *Refunded* →
  *Reverse* (through the Modal) → button returns; each step paired with a DB assertion on `package_refunds`, not just
  the UI.

  ⚠ RISK 8 MITIGATION:
  - **Step:** fixture reset + teardown add `DELETE FROM package_refunds WHERE tenant_id = '<fixture tenant>'` before
    the `parent_packages` delete; assert a **precondition** of 0 refunds before the first write (§7.281);
    `check-fixture-roundtrip.sh` stays green.
  - **Step:** the closed-month refusal through the UI — add a `billing_periods` row for a past month to the fixture
    tenant, back-date the refund into it, assert the inline message is visible **and** 0 rows written. The future-date
    refusal is proven in pgTAP, not here (the `max` attribute stops it client-side, so a driver check would only prove
    the browser).
  - The *"Keep it"* path on Reverse is paired with a DB-unchanged assert.
  - New mutation-proof row in the header: `recordPackageRefund` wired to a no-op → driver red.
  - The *Package refunds* line on Accounting: extend `verify-accounting-packages.mjs` (U1.3) with a fixture-written
    refund in its sealed month; assert the line and the reduced Revenue.
- `/commit-review` → `/deploy`: migration → remote grant dump → apps → bundle grep.

  ⚠ RISK 7 / RISK 11 MITIGATION:
  - **Assertion:** remote grant dump shows `package_refunds` = `SELECT` to `authenticated` only (no
    `anon`/`service_role`/`PUBLIC`), RLS enabled (`relrowsecurity = true`), and both RPCs' EXECUTE = `authenticated`
    only.
  - **Assertion:** bundle grep for the contiguous literal `Record refund` **and** the new CancelModal sentence
    `record it on the cancelled package afterwards` (§7.51).

## Docs (at `/update-docs`, not mid-unit)

- PRD §7.16 (packages) + §7.23 (accounting): package revenue basis, refunds.
- BACKLOG: both items → shipped. *Show package refunds to the parent* (Billing-card line + refund email via
  `package-emails`; if it emails, inherit the crash-safe claim pattern) is already filed.
- `docs/plans/README.md`: this plan's row; the brief marked superseded.
- GOTCHAS §7: the graduations the user accepts (offered with the review).

## Deploy gate (nightly)

The app half of each unit merges only after a nightly has been read. Run `36313394669` (dispatched 2026-09-27 on the
user's word) covers Wave 1; read it before U1's app push. **Prohibition:** never dispatch or re-run the nightly
(`gh workflow run`, `gh run rerun`) or start `run-all-drivers.sh` without `--only` unasked. If the run is red or does
not cover the tree being shipped, **ask the user**. Reading runs and `--only` drivers are fine.

## Pre-commit gate — walk before EACH unit's commits; a box that cannot be ticked is a blocker

**Highest value — check these first:**
- [ ] (R1) `v_revenue` is assigned once; `revenue` and `net` both read it; no arithmetic in `RETURN QUERY`.
- [ ] (R1) `accounting_summary` body diff vs its pre-migration capture shows only the intended hunks; gate and
      unsealed refusal byte-identical; `\df` = 1 row; EXECUTE = `authenticated` only.
- [ ] (R1/R8) `net = revenue − wages` asserted on a wages-FINAL month with a non-zero package (U1) / refund (U2) figure.
- [ ] (R2) Lifecycle trigger diff = the two `confirmed_at` lines; `supabase test db` 0 failures; Deno `test.sh` green
      **twice**; the three package drivers at their U0 counts; no fixture was fixed by relaxing the pin.
- [ ] (R3) `audit_log_tenant_of` has a `'parent_package'` arm (diff = that arm); the refund pgTAP asserts 2 audit rows
      with the right tenant.
- [ ] (R4) Prod census read `0 | 0` before U1's push, or the user decided in writing.

**Everything else:**
- [ ] (R5) No `CURRENT_DATE` / `now()::date` / zoneless cast in any new or changed function; boundary tests (today /
      today+1; 07:30-SGT confirmation D / D−1; mM vs mM−1) green and each shown red by a mutation.
- [ ] (R5) The seal-race acceptance is written in the U2 migration header.
- [ ] (R6) `loadPurchases` selects `confirmed_at`; refunds come from a separate fail-closed query, not an embed;
      `refundState` matrix test green and shown red.
- [ ] (R6) Refund/Reverse controls hidden unless `packages:edit` is loaded; Reverse uses a Modal, not `window.confirm`.
- [ ] (R7) RLS enabled; REVOKE-then-GRANT SELECT only; `('package_refunds|profiles')` allowlisted;
      `recurring_gotchas`, `table_grants`, `function_grants` green; CASCADE FKs pinned.
- [ ] (R8) Each new pgTAP assertion has a recorded mutation proof (proof against the old function is not accepted);
      discounted-fixture precondition asserted.
- [ ] (R8) `verify-accounting-packages.mjs` exists with its own sealed past month; UUID prefix grep returned 0 hits;
      the seed tenant is not sealed.
- [ ] (R8) Driver fixture deletes `package_refunds`, asserts precondition 0; `check-fixture-roundtrip.sh` green.
- [ ] (R9) A second refund raises the readable message, not `23505`; the modal shows server errors inline and stays open.
- [ ] (R10) No number in the amount placeholder; *− Packages applied* unchanged; mixed-basis note present; negative
      revenue renders `-S$…`.
- [ ] (R11) DOWN executed up → down → up with a byte-identical function diff; the U2 DOWN refuses when
      `package_refunds` has rows.
- [ ] (R11) Migration on prod before the app push; remote grant dump read; bundle grepped for a contiguous new string;
      the nightly only *read*, never dispatched unasked.
- [ ] Test runners are the fact: `supabase test db`, vitest and driver counts recorded from the runners, each moved
      only by the tests this unit added.
