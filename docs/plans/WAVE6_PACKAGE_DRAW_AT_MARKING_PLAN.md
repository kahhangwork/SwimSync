# Wave 6 — Package-funded lessons need no monthly run (draw at marking)

_Planned 2026-10-06 with `/plan-with-confidence`. Hardened by `/plan-review` 2026-10-06 (12 risks; mitigations are inlined as
`⚠ RISK n MITIGATION`, gate at the end). BACKLOG → *Package-funded lessons need no monthly run* (L).
Status: PLANNED — not started._

## What this builds, and why

**The package purchase IS the invoice.** Today a package's stored balance (`parent_packages.value_remaining`)
moves only when the monthly engine runs. The "N left" counter is a live simulation over un-invoiced lessons
(`package_live_balances()`, newest body `20260814000400:339`). So a package family's month needs a
*Generate* that produces an invoice which arrives already **Paid**, which is pure ceremony. Little Orcas (the
package business) has never run billing at all.

After this wave, **a package-covered lesson draws from the package the moment it is marked**, and the monthly
run only ever bills **ad-hoc** lessons. A month with nothing ad-hoc needs no run.

## Decisions settled with the user (2026-10-06): do not reopen

| # | Question | Answer |
|---|---|---|
| D1 | What does a mixed family's invoice show? | **Ad-hoc lines only.** Covered lessons never appear on a new invoice. |
| D2 | Does a fully package-funded month need *Generate* to close it? | **No — Generate is OPTIONAL (refined 2026-10-06).** Nothing waits on it; Billing months shows *Nothing to bill — all package-funded*. The owner MAY press Generate: it issues **0 invoices** and **seals** the month, which puts it on Accounting and freezes its marks. Package revenue is unchanged — counted in the month each package was PAID (PRD §7.23), sealed or not. The completeness gate and "nothing recorded → no seal" still apply. |
| D3 | Where does the parent see what the package paid for? | **A usage list on the app's Packages tab**: each package expands to dated lines, returns included. |
| D4 | present→absent→present after a return? | **Re-draw.** Marking billable always draws; marking non-billable always returns. Unfundable → ad-hoc. |
| D5 | Package confirmed with a start date in the past, lessons already marked? | **Invoiced lessons stay invoiced** (the parent pays the invoice). **Un-invoiced** lessons since the start date → the admin chooses at confirm: **Draw from package** / **Keep as ad-hoc**. Asked only when such lessons exist. |
| D6 | Lessons marked out of date order near exhaustion? | **Draw in marking order, plus a GUARD**: refuse marking a child *present* on D when the package covering D would be left with fewer lessons than there are EARLIER unmarked lessons it would also cover (this child's or a sibling's — packages pool per family), counting only earlier lessons still inside the marking window. Message: *"Mark 3 Oct first — the package has 1 lesson left."* Marking absent/cancelled is never blocked. |
| D7 | Cutover of Little Orcas's one package | **Backfill draws** its un-invoiced lessons in window, oldest first. Exact before/after read from prod at deploy, before the write. |

**Prod facts (read 2026-10-06, `scripts/prod-query-ro.sh`):**
- One active package in production: Little Orcas, S$700 remaining, window 2026-07-12 → 2026-10-04 (**already
  past its expiry date**, so new lessons from 6 Oct onward will be ad-hoc unless a new package is sold), **0 ledger rows**.
- One cancelled package (S$350). Coach Kah Hang holds no packages and sealed September.
- Little Orcas has never sealed (`markable_floor` = 2026-08-03, §7.319). The cutover touches one family's lessons.
- **There is no billing cron** (DEPLOYMENT: invoicing is manual). A month seals only when someone presses Generate.

## The rules this wave obeys

- **The billing guards are not weakened** (CLAUDE.md "Billing"). The completeness gate, ended-month rule,
  ordering guard and seal still govern every **ad-hoc** lesson exactly as today. No override is added.
- **One draw rule, in one place.** One SQL matcher function, `package_match_for(...)` (STABLE), is the only
  package-matching code. The draw, the D6 guard, the backlog preview, the backlog draw and the B backfill all
  call it. The engine stops matching packages when the tenant's switch is on. `package_live_balances` stops
  simulating when the switch is on (see Read side). Two copies of the matcher is the drift PACKAGES_DESIGN
  RISK 4 exists to prevent.
- **A lesson is funded at most once**: a live marking-time application, OR an invoice item, never both.
  Enforced in **both directions by the database**: the draw refuses an invoiced lesson, and a backstop trigger
  on `invoice_items` refuses an item for a drawn lesson.
- **One switch.** `tenants.package_draw_at_marking` is the single source read by every consumer (trigger
  bodies, guard, backlog draw, engine, `package_live_balances`).
- **Expand/contract, one schema change in flight** (CLAUDE.md "Database"). Migrations A and B land in
  sequence, with the engine between them (see *Deploy order*). Both are written in the root checkout on `db/…`
  branches, never in a worktree.
- **Every new function or table grants itself** (§7.87). `table_grants.test.sql` and `function_grants.test.sql`
  stay green without a blanket grant.
- **Dates:** lesson dates are already `DATE` in SGT. Any new timestamp comparison spells out `+08:00` (§7.227).
  "Today" is `today_sg()`.
- **Failure polarity.** A guard that cannot decide **lets the mark through**. The D6 guard fails OPEN, like the
  ordering guard's "fail skippable": a wrongful refusal blocks a whole class's save with no override, while a
  missed refusal only changes which package pays.

## Design

### Ledger: `package_applications` gains a marking-time key

Today a row cannot exist without `invoice_item_id` (NOT NULL, `20260720000100:383`). Migration A:

- `invoice_item_id` → **nullable**. Add `lesson_session_id UUID`, `student_id UUID` and `lesson_date DATE`
  (snapshot, set inside the draw from `lesson_sessions`, never from a client).
- CHECK: exactly one shape. Either legacy (`invoice_item_id` set AND the three new columns NULL), or
  marking-time (`invoice_item_id` NULL AND all three new columns NOT NULL).
- **Partial unique index**: one live (`reversed_at IS NULL`) marking-time application per (`lesson_session_id`,
  `student_id`). Plus a plain index on (`lesson_session_id`, `student_id`) for the engine's read.
- Legacy rows are untouched. The parent invoice detail's *Paid by package* keeps reading them.

⚠ RISK 9 MITIGATION: FK delete actions
- `student_id REFERENCES students ON DELETE NO ACTION`. **Do NOT make it CASCADE.** `merge_students` RAISEs on
  any CASCADE FK onto `students` that it has not been taught to move, which would break every merge.
- `lesson_session_id REFERENCES lesson_sessions ON DELETE NO ACTION`.
- Pass/fail: `supabase test db` (merge_students suites included) is green after A.
- Pass/fail: in `pg_constraint`, the only CASCADE on `package_applications` is the existing
  `invoice_item_id_fkey`.

⚠ RISK 9 MITIGATION: census of far-away readers
Before writing A, list every reader of `package_applications`:
- `handle_attendance_update`
- `SwimSyncApp/features/invoice-detail/{types.ts,dao/invoiceDetail.repo.ts,domain/invoiceFunding.ts}`
- `generate-invoices/{core.ts,test-helpers.ts,packages.test.ts}`
- `drivers/fixtures-paynow-fallback-teardown.sql`

Confirm each one filters by `invoice_item_id` (so marking-time rows are excluded) or is updated. Any generated
DB types are regenerated. Pass/fail: `npm run typecheck` is green in both apps, and the invoice-detail jest
suite is green.

⚠ RISK 9 MITIGATION: `handle_attendance_update` stays byte-identical. Record
`md5(pg_get_functiondef('public.handle_attendance_update'::regproc))` before A. After A and after B it must
be the same. A changed hash is a blocker.

### The switch: `tenants.package_draw_at_marking`

⚠ RISK 1 / RISK 6 / RISK 7 MITIGATION (settles "flag, settle at 1.1")
- One `BOOLEAN NOT NULL DEFAULT false` column on `tenants`, added in A.
- B sets it `true` for every tenant and changes the column DEFAULT to `true`, so tenants provisioned later and
  seed tenants start in the new mode.
- The draw and return triggers, the D6 guard, `draw_package_backlog`, `package_live_balances` and the engine
  all read **this column and nothing else**.
- **The triggers are created ENABLED in A and early-return while the tenant's switch is false.**
- **Do NOT add a second switch**: no `ALTER TABLE … DISABLE TRIGGER`, no `app_settings` key, no env var.
  `app_settings` is UPDATE-able by any platform admin.
- `guard_tenant_columns()` is redefined from its DB body (§7.40) with `"package_draw_at_marking":"nobody"`.
  Pass/fail pgTAP: a tenant owner's PATCH of the column is refused, and a platform admin's PATCH is refused.
- Per-tenant (not global) so a Deno or pgTAP test can run legacy-mode on its own tenant without flipping
  shared state.

### Draw and return: triggers on `attendance`

`package_draw_for(session, student)` and `package_return_for(session, student)`, SECURITY DEFINER. They are
called from a row-level **AFTER INSERT OR UPDATE OF status OR DELETE** trigger on `attendance`. AFTER means
§7.57's upsert-as-insert trap does not apply to the draw itself.

**Draw** when the new status is billable (`present`, `trial_paid`, i.e. today's `BILLABLE`, `core.ts:49`) and:
1. the tenant's switch is on,
2. no live marking-time application exists for (session, student),
3. **no `invoice_items` row exists** for (session, student). An invoiced lesson is never drawn (D5).
4. no live `student_settlements` covers the lesson (`settled_through >= session_date`). This is the same rule
   as the engine and `unbilled_sealed_lessons`, held in the matcher so the backfill and the trigger share it.

Matching is `package_match_for`, today's engine rule ported once:
- the family's **active** packages in the lesson's tenant (explicit tenant clause, §7.2xx draw-predicate note),
  ordered `expires_on, confirmed_at, id`;
- the category matches. For a make-up, that is the booking's category snapshot:
  `COALESCE(mb.category_id, c.category_id)`;
- the lesson date is inside `start_date..expires_on`;
- `value_remaining >= rate_per_lesson` (no partial draw);
- `SELECT … ORDER BY expires_on, confirmed_at, id FOR UPDATE` on the candidate packages, in that fixed order
  so two coaches marking siblings at once cannot overdraw or deadlock. The existing `value_remaining >= 0`
  CHECK is the backstop.

No match → the lesson is ad-hoc and nothing is written. The amount drawn is `rate_per_lesson` (the package's
locked rate, as the engine does today).

**Return** when the status becomes non-billable, or the row is deleted (advance cancel, `cancel_lesson`): reverse
the live marking-time application (`reversed_at = now()`, `reversed_by = auth.uid()`) and add
`value_remaining += amount` **to the package it came from**, even if that package has expired or been cancelled
(today's correction rule, PRD §7.16). Legacy invoiced lines keep the existing `handle_attendance_update` path
unchanged: credit note, or legacy application reversal, which already returns value to the package. The two
paths are disjoint because of draw rule 3.

**Re-draw (D4)** falls out of this: billable again → a fresh draw by the same rule, which may pick another
package or find none (→ ad-hoc, invoiced at the next run).

**Holiday void** (`holiday` status, including `mark_day_holiday`) on a drawn lesson → a return. Holiday and
cancel **extensions** are untouched: they move `expires_on`, never `value_remaining`.

⚠ RISK 1 MITIGATION: backstop in the other direction
A BEFORE INSERT trigger on `invoice_items` (SECURITY DEFINER):
1. Takes `SELECT … FROM attendance WHERE (lesson_session_id, student_id) = … FOR SHARE` first, so it
   serialises with a concurrent mark.
2. Then RAISEs (SQLSTATE `PK002`) if a live marking-time application exists for that pair.

Pass/fail pgTAP:
- inserting an `invoice_items` row for a drawn lesson raises `PK002`;
- marking present a lesson that already has an invoice item writes 0 `package_applications` rows.

⚠ RISK 1 / RISK 2 MITIGATION: idempotent on unchanged rows
`UPDATE OF status` fires for **every** row of a supabase-js upsert, changed or not. Every branch compares
`OLD.status IS DISTINCT FROM NEW.status`, and draw/return are no-ops when their precondition already holds.
Pass/fail pgTAP: re-upserting a whole class with identical statuses writes 0 ledger rows and moves no
balance.

⚠ RISK 7 MITIGATION: definer rules
- The trigger functions are `SECURITY DEFINER SET search_path = public`.
- `package_draw_for`, `package_return_for` and `package_match_for` have EXECUTE revoked from `PUBLIC, anon,
  authenticated, service_role` (reached only through the definer trigger, §7.78).
- **No body reads `current_user`**. `recurring_gotchas.test.sql` #2 must stay green.
- The tenant is derived from `lesson_sessions → classes`, never from a parameter (§7.42).
- Pass/fail pgTAP, run **as the coach (`authenticated`)**, not as postgres: marking present draws, even though
  the coach cannot write `parent_packages`.
- Pass/fail pgTAP: an authenticated direct UPDATE of `value_remaining` is still refused ("moved by billing").

⚠ RISK 10 MITIGATION: exit order, cheapest first
The trigger exits in this order:
1. switch off
2. status unchanged or not crossing billable
3. no `parent_students` row, or no active package for any linked parent in this tenant (one `EXISTS`)

Coach Kah Hang (no packages) never gets past step 3.

⚠ RISK 11 MITIGATION: pgTAP cases, each proven red without its fix
- `mark_day_holiday` over a drawn lesson returns it; `unmark_day_holiday` writes nothing.
- An attendance DELETE of a drawn lesson returns it.
- A return onto a cancelled package goes back to that package. The status is unchanged. A re-mark present
  draws from another active package or none.
- Cancelling an active package does NOT return its draws (pinned; listed under Known consequences).
- A child linked to two parents is drawn exactly once, deterministically (FIFO across all linked parents'
  packages).
- A lesson covered by a live settlement is not drawn.
- `trial_paid` draws (engine parity).
- A make-up uses the booking's category snapshot.
- Another tenant's package is never drawn.
- Two siblings on the same date in one upsert with 1 lesson left: both rows save, exactly one is drawn, the
  other stays ad-hoc.
- An invoiced lesson flipped absent→present→absent writes 0 marking-time rows. Only the credit-note path
  acts.

### The out-of-order guard (D6)

A **BEFORE INSERT OR UPDATE** trigger on `attendance` that detects upsert-as-update inside itself (§7.57: look
up the existing row by the conflict key). It acts **only when this write would create a NEW draw**, meaning all
of these hold:
- the tenant's switch is on;
- the new status is billable;
- there is no existing row, or the existing row's status is non-billable;
- there is no live marking-time application and no invoice item;
- `package_match_for` returns a package P.

Then:
- `left_after` = `floor((P.value_remaining − P.rate_per_lesson) / P.rate_per_lesson)`
- `earlier` = expected-but-unmarked (date, child) pairs that are all of:
  - **before** D and on or after `markable_floor(tenant)`;
  - inside P's window and category;
  - for **any child linked to P's parent**.

  Counted with `LIMIT left_after + 1`.
- `earlier > left_after` → `RAISE` SQLSTATE `PK001` with the user's message plus the child and class:
  *"Mark 3 Oct first — the package has 1 lesson left. (Ava · Dolphins Fri 4pm)"*.

⚠ RISK 2 MITIGATION: one derivation of "expected"
1. Read `class_unmarked_lesson_dates` from the DB (§7.40).
2. Extract its `expected`-minus-attendance core into `class_unmarked_lesson_pairs(p_class_id) RETURNS
   TABLE(session_date date, student_id uuid)` (DEFINER, revoked from everyone but the definer callers).
3. Redefine `class_unmarked_lesson_dates` as an `array_agg(DISTINCT …)` over it.
4. The guard calls the pairs function.

**Do NOT write a third copy of "expected students".**

Pass/fail: snapshot `class_unmarked_lesson_dates(id)` for every seed class before A and after A. The diff is
0 rows.

⚠ RISK 2 MITIGATION: fails OPEN, and SQLSTATE `PK001` is the only refusal
- The counting is wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING …; RETURN NEW; END`. The
  `PK001` RAISE sits **outside** that block, so the guard's own refusal is never swallowed.
- A header comment states the polarity.
- **Do NOT invert to "block on doubt".**
- Pass/fail pgTAP: with the pairs function sabotaged to raise, a present mark saves.

⚠ RISK 2 MITIGATION: runs as definer
The guard is `SECURITY DEFINER SET search_path = public` (§7.125). Pass/fail pgTAP, run **as the coach**: a
sibling's unmarked earlier lesson in a class this coach does not teach IS counted.

⚠ RISK 2 MITIGATION: re-saves are never refused
Pass/fail pgTAP: a class already saved present (drawn, package now at 0 left, earlier unmarked lessons
existing) re-saved unchanged → succeeds. An edit of one other child in that class → succeeds.

⚠ RISK 2 MITIGATION: only clearable lessons count
- A lesson below `markable_floor` is not counted.
- A lesson on a class after its `deactivated_at` is not counted (§7.109 deadlock).
- A cancelled lesson is not counted.

All three are pgTAP cases.

⚠ RISK 2 MITIGATION: pgTAP pins absent, cancelled and holiday as never blocked, and pins the guard's trigger
name sort. It must sort after `guard_attendance_date_trg`, so a below-floor write gets the date message first
(§7.167). Pass/fail: `pg_trigger` order assertion.

⚠ RISK 10 MITIGATION: the guard computes `earlier` only after `left_after` is known, and stops counting at
`left_after + 1`.

Both save paths map `PK001` to the DB message:
`SwimSyncApp/features/mark-attendance/domain/useSaveAttendance.ts` and
`SwimSyncAdmin/app/(admin)/lessons/[classId]/[date]/domain/adminAttendanceSave.ts`. **A batch upsert rolls
back whole on one refused row (§7.67), and the coach app will not save while any child is unmarked**, so the
message is the coach's only route forward. It must name the child, the date and the class.

⚠ RISK 2 MITIGATION: the coach-app mapping ships BEFORE B (Apps-1, below)
- `attendanceSaveErrorMessage` (both apps' `lib/attendanceSaveError.ts`) returns the DB message for `PK001`.
- Prohibition: **no retry, no force, no per-row split** (the existing admin-save prohibition).
- Pass/fail vitest and jest: `PK001` → the DB text, verbatim. Proven red on the current mapper ("Please try
  again").

### Backdated activation (D5)

Activation stays a table write (`activatePendingPurchase`, `insertPurchase` via `useSale`, offer confirm).
Lessons marked **after** activation are drawn by the trigger. For lessons **already marked**:

- `package_backlog_preview(p_package)` is a **dry run of `package_match_for`** over the family's un-invoiced,
  undrawn, unsettled billable lessons from the package's `start_date`. It returns, per lesson: date, child,
  class, and the package that would fund it (this one / another / none → stays ad-hoc).
- `draw_package_backlog(p_package)` draws them oldest first (`session_date, student_id`) through the same
  draw function. Admin-only (`has_admin_area(tenant, 'packages', 'edit')`, tenant derived from the package).
- The confirm dialogs call the preview. **Non-empty → two buttons**: *Draw from package* / *Keep as ad-hoc*.
  *Keep as ad-hoc* writes nothing, and those lessons bill at the next run.

⚠ RISK 8 MITIGATION: preview and draw share one matcher
**Do NOT build the preview from a separate window/category query.** Pass/fail pgTAP: for 3 fixtures (single
package; older package with value; backlog larger than the package), the preview's "this package" rows equal
the rows `draw_package_backlog` then draws.

⚠ RISK 8 MITIGATION: the draw re-derives
`draw_package_backlog` takes no lesson list. It re-derives at call time and returns the count drawn, which the
UI shows. A second call draws 0 (double-click or two admins). It **refuses while the tenant's switch is off**.
pgTAP covers all three.

⚠ RISK 8 MITIGATION: census of activation paths
In step 1.4, grep both apps for every write that can make `parent_packages.status = 'active'`
(`.from("parent_packages")` inserts and updates, `useSale.ts:54`, `packages.repo.ts:143`, the offer confirm
path), plus SQL functions (`pg_proc` search). List them in the commit message. Each gets the dialog, or a
written reason why it cannot be backdated.

⚠ RISK 11 MITIGATION: a sealed-month un-invoiced lesson is **not** drawn by the preview, the backlog or the
backfill. This is engine parity: sealed months stay with `unbilled_sealed_lessons` and settlements. Pinned in
pgTAP. Tell the user at 1.6 (Known consequences).

### Engine (`generate-invoices`, v33)

The engine reads `tenants.package_draw_at_marking` per tenant:

- **Unconditionally (both states):** a billable item with a live marking-time application is **dropped** from
  the tally, because it is already paid. Before B no such rows exist, so flag-off output is unchanged.
- **Switch off:** today's behaviour byte-for-byte (package matching runs on the remaining items).
- **Switch on:** package matching is **skipped**, so every remaining item is ad-hoc at class rate. A parent with
  no remaining items gets **no invoice and no email**.
- The completeness gate and seal are unchanged in code.
- **The ordering guard (`orderingGuard.ts`, TypeScript, not a migration) must treat a drawn lesson as billed in
  arm 1.** Otherwise a never-run package month blocks every later month forever.

⚠ RISK 1 MITIGATION: fail closed
- The switch read and the drawn-set read each check `error`. An unreadable value returns a new per-tenant
  status `package_mode_unreadable`, which **returns, never throws** (§7.265), creates no invoice, and does not
  seal.
- The status is added to `NON_ATTEMPT_STATUSES` (`runLog.ts`) and opted out in `shouldRetryTenantEmails`
  (`email.ts`), with a test in each (§7.257, §7.266).
- **Do NOT default an unreadable switch to `false`, or an unreadable drawn set to empty.**
- Pass/fail Deno: a stubbed read error → status `package_mode_unreadable`, 0 invoices, month not sealed.

⚠ RISK 1 MITIGATION: `checkInvariants` (test-helpers.ts) gains a rule: no `invoice_items` row shares
(lesson_session_id, student_id) with a live marking-time application. It runs on every Deno test.

⚠ RISK 3 MITIGATION: ordering guard
Arm 1 of `monthHasUnbilledLessons` fetches the live marking-time applications for the month's session ids
(error → throw → caught → fail skippable, as today) and ignores those rows.

Pass/fail Deno, each proven red without the change:
- an earlier unsealed month whose present rows are all drawn does NOT block;
- one undrawn present row DOES block;
- an unmarked lesson ≥ floor still blocks.

Correct the plan's earlier claim: there is **no** ordering-guard SQL in Migration A.

⚠ RISK 3 MITIGATION: zero-invoice seal
Pass/fail Deno, switch on: a package-only tenant's ended, fully marked month → status complete, **sealed**,
0 invoices, 0 emails, one run-log row (the §7.17 positive, ≥1 class reckoned, still holds).

⚠ RISK 10 MITIGATION: ad-hoc parity
Pass/fail Deno: a no-package tenant fixture run with the switch on and with it off produces identical
invoices, items, amounts and email count. This is Coach Kah Hang's path.

### Read side

- `package_live_balances()` keeps its signature (CREATE OR REPLACE from the DB body, §7.40; no DROP, §7.150).
  **For a package whose tenant switch is on, `live_value_remaining = value_remaining`, with no simulation.**
  For switch-off tenants, today's simulation runs unchanged.

  ⚠ RISK 5 MITIGATION: this removes the second matcher instead of keeping a "simulate over undrawn" variant,
  which would disagree with the stored balance whenever a lesson is *Keep as ad-hoc* or a return frees value.
  It also stops relying on an INVOKER read of `package_applications` under RLS (§7.149). Pass/fail pgTAP:
  after B on seed, `live = stored` for every active package, including a Keep-as-ad-hoc fixture and a
  return-then-exhausted fixture. `student_package_coverage` and `package_renewal_candidates` suites stay green.

- `unbilled_sealed_lessons` (from the DB body) also excludes lessons with a live marking-time application.

  ⚠ RISK 5 MITIGATION: pass/fail pgTAP: a drawn lesson in a sealed month is NOT listed; the same lesson
  after a return IS listed. Otherwise an admin settles a lesson the package already paid for.

- `package_usage(p_package)` returns dated lines (lesson date, child, class, amount, drawn/returned). It
  **unions legacy invoice-time rows** (date via `invoice_items → lesson_sessions`) so the history is complete.
  SECURITY DEFINER with an explicit gate: platform admin, OR `has_admin_area(pkg.tenant_id,'packages','view')`,
  OR (`pkg.parent_id = current_parent_id()` AND NOT `tenant_suspended`). The parent app's Packages tab expands
  a package to it (D3).

  ⚠ RISK 7 / RISK 12 MITIGATION: pass/fail pgTAP for every caller shape: anon refused; another family's parent
  gets 0 rows or refused; a same-tenant coach is refused; another tenant's admin is refused; a front-desk
  co-admin (packages none) is refused; a packages:view admin gets the rows; the owning parent gets the rows.

- Admin **Billing months** card shows *Nothing to bill — all package-funded* (D2) **only when all of the
  following hold**:
  - the month has ended;
  - there are 0 unmarked expected lessons (same derivation as the gate);
  - ≥1 drawn lesson exists;
  - 0 billable lessons have neither an invoice item nor a live application.

  It is read via a DEFINER RPC gated on `billing:view`, because `package_applications` RLS is
  `packages:view` and a billing-only admin would otherwise miscount.

  ⚠ RISK 3 MITIGATION (§7.219, §7.17): a month with no lessons, or with unmarked lessons, never reads "Nothing
  to bill". Pass/fail vitest: empty month → existing text; unmarked month → existing text; all-drawn → "Nothing
  to bill". Each proven red.

- Admin Packages *Held* table: once the switch is on, live and stored are equal by construction, so show one
  figure (Apps-2 only).

## Deploy order (backend first — §7.60; `/deploy` drives it)

| Step | What | Why here |
|---|---|---|
| A | Migration A: ledger columns, CHECK, indexes, FKs; `package_match_for`, draw/return/guard/backstop functions **and triggers (enabled; inert while the switch is false)**; `class_unmarked_lesson_pairs` + redefined `class_unmarked_lesson_dates`; `package_live_balances` + `unbilled_sealed_lessons` redefinitions; preview/backlog/usage/billing-months RPCs; the switch column (default false) + `guard_tenant_columns` mapping. | Expand only. With every switch false, nothing behaves differently. |
| E | Engine v33. `supabase functions deploy generate-invoices`, then `supabase functions list` to confirm the version moved. | It must understand marking-time draws before any exist. |
| Apps-1 | Both apps' `PK001` save-error mapping only. | Additive and safe at any time. Coaches get the guard's words from minute one of B. |
| B | Migration B: switch on for every tenant + column DEFAULT true + **backfill**, in one transaction, with the self-check below. | Drawing and the engine switch flip atomically. There is no window where both the engine and the trigger draw. |
| Apps-2 | Admin (backdated dialog, Billing months, Held table) + App (usage list), to `main` **last**. | Same day as B. |

⚠ RISK 4 MITIGATION: B proves itself inside its own transaction
1. Capture `package_live_balances()` (live value per active package, **still under switch-off semantics**)
   into a temp table.
2. Flip the switch.
3. Backfill in the simulation's order (`session_date, student_id`) through `package_draw_for`.
4. `RAISE` (aborting `db push`) unless, for every active package, stored `value_remaining` = its pre-B stored
   value − the sum of the applications the backfill just wrote, AND no (session, student) has both an invoice
   item and a live application.
5. The step-1 capture is compared too, but only for packages with **no** settled or sealed-month un-invoiced
   lesson in their window. The switch-off simulation still subtracts those lessons (today's drift sources) and
   the backfill deliberately skips them (step 1.4 RISK 11, condition 4 of *Draw*). So for any other package, a
   difference is expected and is **reported** (`RAISE NOTICE`, package id + amount) rather than aborting. The
   prod pre-read below lists such packages for the user before push.

Pass/fail: `supabase db reset` runs A+B cleanly **twice**. Then sabotage one backfill row locally and watch B
abort, so the self-check is proven able to fail (§7.85).

⚠ RISK 4 MITIGATION: before `db push` of B, run the read-only prod reads (`scripts/prod-query-ro.sh`) and show
them to the user:
- the D7 lesson list for Little Orcas (date, child, class), count, sum, expected post-B `value_remaining`;
- whether Sep (or Aug) has been generated since 2026-10-06 (`invoices`, `billing_periods`). If so, re-read the
  list;
- `billing_runs` started in the last 15 minutes. **Do not push B while a Generate is running.**

Record the numbers in this file.

⚠ RISK 4 MITIGATION: after B, a read-only prod read must show exactly:
- stored `value_remaining` = the pre-read expected value;
- live marking-time applications = the pre-read count;
- 0 overlaps with `invoice_items`.

Any mismatch → stop and run the rollback.

⚠ RISK 2 / RISK 8 MITIGATION: deploy-order rules
- **Do NOT merge the Apps-2 branch to `main` before B is applied on prod and verified.** Merging to main IS
  the app deploy (§7.60).
- Do NOT start B unless Apps-1 is live: grep the served coach bundle for the `PK001` string (§7.31).

**Rollback of B** is `supabase/rollback/<B>_DOWN.sql`. It is rehearsed locally before prod, and the apps are
rolled back FIRST. It reverses every live marking-time application (restoring `value_remaining`), sets the
switch false for every tenant, and sets the DEFAULT back to false. That leaves the v33 engine to match packages
at the next run, exactly once.

⚠ RISK 4 MITIGATION: the rollback is only valid while no draw sits in a sealed month
The DOWN script `RAISE`s if any live marking-time application lies in a month sealed for its tenant (reversing
it would create a permanent orphan). Its header says: **the rollback window closes at the first seal of a month
containing draws.**

Rehearsal pass/fail:
- after DOWN, `package_live_balances` equals the pre-B capture;
- Deno (switch off) passes twice;
- the sealed-month refusal fires on a fixture with a sealed drawn month.

**Little Orcas running *Generate Sep* before B** is safe: the engine writes invoice items for what it draws, and
the backfill skips anything invoiced.

⚠ RISK 3 MITIGATION: the ordering guard will refuse Sep while Aug holds billable lessons, before and after B
(after B only for ad-hoc families). If the owner reports "Generate August first", that is the guard working.
Write this into the message sent to the owner.

## Steps

### 1.0 Baseline (20 min)
Run `supabase db reset`, then `supabase test db`, the Deno suite **twice** (§7.15), both app suites and both
typechecks.

Record:
- pgTAP, Deno, vitest and jest counts;
- `md5(pg_get_functiondef('public.handle_attendance_update'::regproc))`;
- a snapshot of `class_unmarked_lesson_dates(id)` for every seed class;
- `package_live_balances()` for the seed;
- the timing of one 20-student attendance upsert for a no-package seed class (`\timing`, median of 5).

Single-driver baselines (`run-all-drivers.sh --only`) for `verify-package-renewal`, the packages pages driver
and the holiday package driver. **Never the full sweep unless the user asks.**

### 1.1 Migration A + pgTAP — branch `db/package-draw-at-marking-a`, root checkout (½–1 session)
Read every body from the DB, never from the migration file (§7.40): `handle_attendance_update`,
`package_live_balances`, `unbilled_sealed_lessons`, `markable_floor`, `class_unmarked_lesson_dates`,
`guard_tenant_columns`. Diff each new body against that.

New `supabase/tests/package_draw_at_marking.test.sql`. Each test sets its own tenant's switch true. **No test
flips another tenant's switch.** Cases:
- draw on present, none on absent;
- return on flip and on delete;
- re-draw;
- FIFO by expiry;
- category scope;
- window edges;
- exhaustion → no draw;
- **an invoiced lesson is never drawn**;
- the unique index refuses a second live draw;
- the `invoice_items` backstop (`PK002`);
- switch off → no draw;
- guard refuses and allows (sibling counted, as the coach; below floor not counted; deactivated class not
  counted; absent/cancelled/holiday never blocked; unchanged re-save allowed; fail-open on sabotage);
- holiday void returns;
- backlog preview equals backlog draw; backlog idempotent; backlog refused while switch off;
- a coach marking triggers a draw even though the coach cannot write packages;
- `package_usage` caller shapes;
- `unbilled_sealed_lessons` excludes drawn;
- `live = stored` under switch on;
- the switch column is refused to owner and platform admin;
- grants (§7.87, §7.35): every new function has EXECUTE only where listed above, and nothing for anon;
- every ⚠ RISK 11 case above.

Each test is proven red without its fix (§7.25).

⚠ RISK 9 MITIGATION: pass/fail. Full `supabase test db` passes with **N baseline + new** tests, and none of the
baseline tests is lost or changed. The `class_unmarked_lesson_dates` snapshot diff is 0. The
`handle_attendance_update` md5 is unchanged.

⚠ RISK 7 MITIGATION: pass/fail. `function_grants.test.sql` and `table_grants.test.sql` are green with no
blanket grant added. Prohibition: **do NOT fix a `permission denied` by granting a trigger-internal function**
(§7.78).

Merge to `main`, `supabase db push` (via `/deploy`), then take the remote grant dump (§7.39, §7.89). Expect
zero `anon` rows for the new functions, and `authenticated` only on `package_backlog_preview`,
`draw_package_backlog`, `package_usage` and the billing-months RPC.

### 1.2 Engine v33 + Deno — branch `feat/engine-package-flag` (½ session)
The test helper gains a `drawAtMarking` option that sets the fixture tenant's switch as service_role.

**Switch-off assertion:** the baseline Deno count, unchanged, green twice.

**Switch-on scenarios:**
- package-only parent → no invoice, no email;
- mixed family → ad-hoc lines only;
- a drawn lesson is never re-billed;
- a package-only month seals with 0 invoices;
- the ordering guard passes a fully drawn earlier month and blocks on one undrawn present row;
- ad-hoc parity (switch on vs off);
- `package_mode_unreadable` fails closed (the `runLog`/`email` registries plus tests).

Update the live-balance pin (`packages.test.ts:494`, `makeups.test.ts:456`) and `checkInvariants` for
marking-time rows.

⚠ RISK 6 MITIGATION: teardown
`teardown()` deletes `package_applications` for the tenant's packages after the attendance delete and before
any `parent_packages`/`lesson_sessions` delete. Pass/fail: after run 2, 0 `package_applications` rows reference
a test tenant's packages, and no "teardown left tenant behind" error appears. **Run the suite twice.**

Deploy: `supabase functions deploy generate-invoices`, then `supabase functions list` shows the version moved.
`supabase functions download` and grep for `package_mode_unreadable` to prove the served code.

### 1.2b Apps-1 — branch `feat/pk001-message` (1 h)
Only the `PK001` mapping in `SwimSyncApp/lib/attendanceSaveError.ts` and `SwimSyncAdmin/lib/attendanceSaveError.ts`
(plus the call sites, if they pass only the code). The tests are proven red on the current mapper. Merge,
push, then grep both served bundles for a string unique to the new mapper (§7.31).

### 1.3 Migration B (+ rollback) — branch `db/package-draw-at-marking-b`, root checkout (1–2 h)
The backfill calls `package_draw_for`. **No second matcher.** pgTAP for the backfill:
- invoiced, settled and sealed-month lessons are skipped;
- order is `session_date, student_id`;
- re-running the backfill body draws 0.

Write `supabase/rollback/<B>_DOWN.sql` and rehearse it as above.

⚠ RISK 6 MITIGATION: driver fixture sweep
After B is applied locally, every fixture that marks a package family now draws at load. Run
`grep -rln parent_packages .claude/skills/run-ui-playwright/drivers/*.sql` (12 files). Each teardown deletes
`package_applications` by package id before deleting packages or sessions. Pass/fail:
`check-fixture-roundtrip.sh` is green, and `supabase test db` is green with no fixture loaded (§7.272).

⚠ RISK 6 MITIGATION: after B locally, the full pgTAP suite and Deno ×2 are green at the 1.1/1.2 counts.

### 1.4 Apps-2 — branch `feat/package-draw-at-marking` (1 session)
Admin:
- backdated dialog on **every path in the activation census** (⚠ RISK 8);
- Billing months *Nothing to bill* with the positive and complete preconditions (⚠ RISK 3);
- Held table shows one figure.

App: the Packages tab usage list, showing legacy and marking-time lines, with returns labelled.

vitest and jest, each proven red. Both typechecks green.

⚠ RISK 3 MITIGATION — SETTLED with the user 2026-10-06 (D2 refined): package-only months need no Generate;
pressing it is optional and seals with 0 invoices. Unsealed, such a month (a) is not on Accounting, (b) stays
markable (`markable_floor` does not advance — for a never-billed business it is the creation date, §7.319), and
(c) the guards look back to the last seal. Accepted. Step 1.2's assertion *a package-only month seals with 0
invoices* is what makes the optional close real — it must pass. The *Nothing to bill* card text adds: *"Generate
to close it for Accounting (optional)."* **Do NOT add an auto-seal, an auto-run, or any override.**

### 1.5 Driver `verify-package-draw-at-marking.mjs` + fixtures (prefix `w6pd_`) (½ session)
- A coach marks a package child → the counter and the stored balance drop by one lesson.
- Flip absent → the lesson returns.
- An admin confirms a backdated package → dialog → *Draw* → the count shown equals the preview.
- An out-of-order mark is refused with the message naming child, date and class. The coach marks the earlier
  lesson, then today's save succeeds.
- An unchanged re-save of a drawn class succeeds.
- The parent sees the usage line. Another family's parent does not.

Then run the baseline drivers with `--only` and compare to 1.0. The live "N left" figures are unchanged, and
any changed stored figure is explained. **Never the full sweep unasked.** Propose the nightly to the user.

⚠ RISK 10 MITIGATION: pass/fail. Re-time the 1.0 upsert of 20 students for a no-package class. More than 2×
the baseline median is a blocker. Time the same for a package family near exhaustion and record it.

### 1.6 Ship
`/deploy`: A → grant dump → E (`functions list`) → Apps-1 (bundle grep) → prod pre-read shown to the user →
B → prod post-read → grant dump → Apps-2 to `main` last (bundle grep for a new string, §7.31).

## Definition of done

- A package lesson marked on prod draws within the save. The parent's counter and the stored balance agree
  (live = stored by construction).
- Little Orcas's package shows its backfilled draws in the usage list. Post-B stored value = the pre-B read.
- An ad-hoc family's billing is unchanged: Coach Kah Hang's October run behaves as September's (Deno parity
  test + the first real October run).
- 0 rows anywhere where an invoice item and a live marking-time application share a lesson. This is a prod
  read-only check after B, and again after the first post-B Generate.
- PRD §7.16 rewritten (*Money moves at marking*), ARCHITECTURE new §6ae, TESTING §5, BACKLOG item struck,
  GOTCHAS additions offered to the user.

## Time

About **4 sessions**: A + pgTAP ½–1, engine ½, Apps-1 + B 2–3 h, Apps-2 1, driver + ship ½–1.

## Known consequences (show the user at 1.6; D2's was accepted 2026-10-06)

- **Draw order is marking order**, guarded only near exhaustion (D6). Away from exhaustion, an earlier lesson
  marked late may draw from a later-expiring package than the engine would have chosen. The value is
  identical.
- **"Keep as ad-hoc" is not remembered**: if such a lesson is later flipped absent→present, it re-draws (D4).
- **Old invoices keep their package lines**; history is not rewritten.
- **No per-lesson package view for the admin** in this wave, only the parent's usage list. Candidate for
  BACKLOG.
- **Package-only months stay unsealed** unless the owner chooses to press Generate (0 invoices, seals it):
  until then outside Accounting, and the marking window stays open (D2 refined, accepted 2026-10-06).
- **Cancelling an active package keeps its draws.** Lessons already drawn stay paid by it, and a later return
  credits the cancelled package. Today, un-invoiced lessons would instead bill ad-hoc after a cancel.
- **Little Orcas's only package expired 2026-10-04**: lessons from 6 Oct onward are ad-hoc and need a Generate
  unless a new package is sold.
- **Sealed-month un-invoiced lessons are never drawn** by backfill or backlog. They stay with settlements
  (engine parity).
- **A lesson marked before its parent claimed the child** is not drawn retroactively. It bills ad-hoc unless the
  admin runs the backlog draw.

_Gotchas from this review were graduated to `docs/GOTCHAS.md` §7.323–§7.327 on 2026-10-06 (user approved)._

## Pre-commit gate

**Highest value (a box that cannot be ticked is a blocker):**
- [ ] R1: the `invoice_items` backstop raises `PK002` for a drawn lesson, and the draw writes nothing for an
      invoiced lesson (pgTAP, proven red).
- [ ] R1: the engine drops drawn items unconditionally. An unreadable switch or drawn set → `package_mode_unreadable`,
      no seal (Deno). No second switch exists (`grep -rn "DISABLE TRIGGER\|package_draw" supabase/migrations
      SwimSync*/` shows only the one column).
- [ ] R2: an unchanged re-save of a drawn class near exhaustion succeeds. A sabotaged guard derivation fails
      open. The guard counts a sibling in another coach's class when run as the coach.
- [ ] R2: Apps-1 is live (bundle grep) before B is pushed.
- [ ] R3: `orderingGuard.ts` arm 1 ignores drawn rows (Deno, proven red). A package-only month seals with 0
      invoices when run. "Nothing to bill" is refused for empty or unmarked months.
- [ ] R4: B's in-transaction self-check is proven to abort on sabotage. Prod pre-read shown to the user and
      recorded. Post-read matches. The rollback refuses a drawn sealed month.

**All mitigations:**
- [ ] R5: switch on → `live = stored` (pgTAP). `unbilled_sealed_lessons` excludes drawn and includes returned.
- [ ] R6: Deno green twice at the baseline + new count. 0 leaked `package_applications`. `check-fixture-roundtrip.sh`
      green. pgTAP green with no fixtures loaded.
- [ ] R7: definer functions read no `current_user` (recurring_gotchas #2). Tenant derived, never a param.
      Grants exactly as listed. Remote grant dump after A and after B shows no anon. The switch column is
      refused to owner and platform admin. `package_usage` caller-shape matrix green.
- [ ] R8: preview rows = drawn rows (3 fixtures). Backlog idempotent and refused while switch off. Activation
      census listed in the commit.
- [ ] R9: no CASCADE FK onto `students`. merge_students suites green. `handle_attendance_update` md5
      unchanged. Both typechecks green.
- [ ] R10: upsert timing for a no-package class ≤ 2× baseline. Ad-hoc parity Deno test green.
- [ ] R11: every listed edge case pgTAP-pinned and proven red.
- [ ] R12: usage list includes legacy rows. Another family sees none (driver).
- [ ] `class_unmarked_lesson_dates` snapshot diff = 0.
- [x] Step 1.4 STOP: settled 2026-10-06 — D2 refined (Generate optional; seals with 0 invoices).
- [ ] Nightly proposed to the user, not dispatched.

