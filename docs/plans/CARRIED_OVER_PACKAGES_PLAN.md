# Carried-over packages — bring in a package bought before SwimSync

_Status: DONE — live 2026-11-18 (migration `20261118000200` / `8a3fa28`, admin `6df68a7`; DEPLOYMENT #110, HANDOVER §8.169). The admin UI shipped with the nightly gate bypassed on the user's word. pgTAP 52 (M1–M6 red), full 99/2239, Deno ×2 335, vitest 1367, driver 11/11 ×2. Source: user feedback #2 from Little Orcas' admin, relayed 2026-11-18._

## 1. The problem

> *"Attendance is directly linked to the package, so it may be difficult to bring our existing packages and attendance
> history over. I tried adding past attendance for Riverfront (July/August) but wasn't able to backdate it … we may
> need to start using SwimSync from a fresh package cycle, which could be quite troublesome since not all students'
> packages start/end at the same time."*

- The backdate refusal is **correct and stays**: Little Orcas' marking floor is 2026-10-01 (PRD §7.6). No override
  (CLAUDE.md — the floor is a billing guard).
- The real gap: **a sale always starts full.** `enforce_parent_package_lifecycle()` snapshots the product, so
  `value_remaining = lesson_count × rate`, and `amount_payable` lands on Accounting as revenue in the month of
  `confirmed_at`. A family 4 lessons into a 10-lesson package cannot be brought in mid-cycle without either
  over-crediting them or double-counting money paid before SwimSync.

## 2. Decisions (user, 2026-11-18)

| # | Decision |
|---|---|
| D1 | Admin enters **lessons remaining**, **as of today**. Every lesson dated before today is assumed already counted in that number — it never draws from this package, and the "lessons already marked" dialog is not offered. |
| D2 | Expiry = **original start date + the product's weeks** (same rule as a normal sale). Extensions granted outside SwimSync are added afterwards with the existing **Extend** action. |
| D3 | **Refund allowed**, capped at the value left (lessons remaining × rate) — not at `amount_payable` (which is S$0). Shows as a refund on Accounting in the month paid out. |
| D4 | The parent sees it **exactly like a normal package** — no label. (Accepted: *Show lessons used* lists fewer lessons than the counter implies.) |
| D5 *(planner default, kept)* | No "confirmed" purchase email (it would state a payment that didn't happen here). (Review: the direct-sale path in `useSale` sends no email today — this is a prohibition, not a code change.) |
| D6 *(planner default, kept, widened)* | No referral discount applied, does not settle a referral reward, and does **not convert a pending referral** (no referrer reward minted). A pending referral for this family stays pending — accepted consequence: it converts on their next real purchase. |
| D7 *(planner default, kept, hardened)* | Must use an existing, active product (rate, category, weeks, shared/one-child). Legacy terms → admin creates a product, brings in, then **retires that product**. A carried row keeps working after its product is retired. |
| D8 *(planner default, kept, widened)* | Remaining must be 1 … product `lesson_count`. Original start ≤ today. Original start + weeks ≥ today (an already-expired package can't be carried over). **New:** at most one ACTIVE carried row per (parent, product, original start, child) — a double-submit cannot double-credit. |

**Q1 — ANSWERED (user, 2026-11-18): cap = value left NOW** (`value_remaining` at refund time). Refunding lessons
already taught in SwimSync is refused. Example: 6 left at bring-in, 2 taught since → cap 4 × rate.

## 3. Data model

One migration on a `db/carried-over-packages` branch (root checkout), expand-only:

- `parent_packages.carried_over_start DATE NULL` — the original start date. **NULL ⇔ a normal sale.**
- `parent_packages.carried_over_lessons INT NULL` — lessons remaining at carry-over (audit + display).

**⚠ RISK 2/3/4 MITIGATION — CHECK constraints make the invariants structural, so a missed code path fails loudly
instead of silently.** All are scoped to `carried_over_start IS NOT NULL`, so every existing row satisfies them
trivially (migration cannot fail on prod data):
- `cop_pair`: `(carried_over_start IS NULL) = (carried_over_lessons IS NULL)`
- `cop_lessons`: `carried_over_lessons IS NULL OR carried_over_lessons BETWEEN 1 AND lesson_count`
- `cop_price`: `carried_over_start IS NULL OR (amount_payable = 0 AND discount_amount = 0 AND referral_reward_id IS NULL)` (RISK 4 — void / settle-expired cannot re-price it)
- `cop_status`: `carried_over_start IS NULL OR status <> 'pending'`
- `cop_anchor`: `carried_over_start IS NULL OR carried_over_start <= start_date`
- `cop_expiry`: `carried_over_start IS NULL OR expires_on = carried_over_start + validity_weeks*7 + holiday_extension_days + cancel_extension_days + manual_extension_days` (RISK 2 — an unpatched recompute raises instead of extending)
- Partial unique index `parent_packages_carried_once` on `(parent_id, product_id, carried_over_start, student_id) NULLS NOT DISTINCT WHERE carried_over_start IS NOT NULL AND status = 'active'` (D8, RISK 3; PG 17 locally). Cancel + re-bring-in still works.

For a carried-over row:

| Column | Value | Why |
|---|---|---|
| `start_date` | **today (SGT, `app_today()`)** — set by the trigger, never taken from the caller | Coverage start. Every draw/backlog/order-guard function already reads `lesson_date >= start_date`, so D1 (nothing before today draws) holds **without touching them**. |
| `expires_on` | `package_effective_end(carried_over_start, weeks, …)` | D2. |
| `lesson_count`, `rate_per_lesson`, `total_value` | product snapshot, unchanged | Term-pinning trigger untouched; parent sees "6 left" of a 10-pack (D4). |
| `value_remaining` | `carried_over_lessons × rate_per_lesson` | The balance. |
| `discount_amount` / `amount_payable` | `0` / `0` | Revenue = 0 automatically in `accounting_summary` (no change there); `cop_price` enforces it. |
| `status` | `active`, `confirmed_at = app_now()` | |

**Design choice reviewed — keep `start_date` = today.** The alternative (`start_date` = original + a new `draws_from`)
moves the patch burden onto the window-START readers (`package_candidates_for`, `guard_package_draw_order`,
`package_backlog_lessons`, the start sides of `holiday_covering_package` / `holiday_reconcile_on_activation` /
`reassign_package_child`, plus `HeldTable`), which are on the draw path — missing one there makes Oct–Nov lessons
draw, which breaks D1 and money. The end-side sites are 8 call sites, all expiry recomputations or one nominal-window
bound, greppable by two regexes and backstopped by `cop_expiry`. **Do NOT switch designs mid-build.**

## 4. Steps

**Step 0 — census (before writing SQL).**
1. DB census, from the DB, never migration files (§7.40):
   `SELECT p.oid::regprocedure FROM pg_proc p WHERE pronamespace='public'::regnamespace AND pg_get_functiondef(p.oid) ~ '(start_date|validity_weeks|package_effective_end|amount_payable|expires_on)';`
   plus the same regex over `pg_views.definition` and `pg_policies.qual/with_check`. **Assertion: 27 functions, 0
   views, 0 policies (2026-11-18).** A different count → re-classify before continuing.
2. ⚠ RISK 2 MITIGATION — census covers code too:
   `grep -rn -E "validity_weeks|start_date|amount_payable" supabase/functions SwimSyncApp SwimSyncAdmin --include='*.ts' --include='*.tsx'`
   (excluding tests/generated types); classify every hit in §6. Known non-DB hits are already in §6.
3. ⚠ RISK 1 MITIGATION — snapshot before touching anything. Dump `pg_get_functiondef` for every §6 "patch" function
   to the scratchpad (`before/<fn>.sql`). Then drift check vs prod (bare command):
   `scripts/prod-query-ro.sh "select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('enforce_parent_package_lifecycle','extend_package','apply_holiday_reconcile','apply_cancel_reconcile','holiday_covering_package','holiday_reconcile_on_activation','reassign_package_child','apply_referral_reward','settle_referral_reward','record_package_refund') order by 1"`
   and the same locally. **Assertion: all 10 md5s equal.** Any difference is a blocker (prod is not running the
   local body, and a replacement would overwrite it).
4. Record pass counts for the existing package pgTAP files — `lesson_packages`, `package_holiday_extension`,
   `cancel_package_extension`, `package_manual_extend`, `package_weeks_start_date`, `package_refunds`,
   `accounting_package_revenue`, `package_draw_at_marking`, `single_child_packages`, `package_offers`,
   `package_corrections`, `student_package_coverage`, `app_clock`, `function_grants`, `table_grants`,
   `recurring_gotchas` — into §6. These are the "before" numbers for Step 2.

**Step 1 — migration (`db/` branch, root checkout; a worktree never authors a migration).**
1. Add the two columns + the six CHECKs + the partial unique index (§3).
2. New RPC `record_carried_over_package(p_parent uuid, p_product uuid, p_original_start date, p_lessons_remaining int, p_student uuid DEFAULT NULL) RETURNS uuid`, `SECURITY DEFINER`, `SET search_path TO 'public'`.
   - ⚠ RISK 3 MITIGATION: tenant is read **from the product**, never a caller argument. Gate
     `is_platform_admin() OR has_admin_area(v_product.tenant_id,'packages','edit')`, else raise
     `insufficient_privilege`. Refuse unless `EXISTS parent_tenants(parent_id = p_parent, tenant_id = v_product.tenant_id)`
     (copy `create_package_offer`).
   - ⚠ RISK 3 MITIGATION: **Do NOT read `current_user` in this function** (§7.38; `recurring_gotchas.test.sql` #2 goes red).
   - Validates D7/D8 with `app_today()` only. Every user-facing refusal raises `ERRCODE = 'check_violation'` (23514)
     so the modal can show the sentence (RISK 8). Wording: "Lessons remaining must be between 1 and N.", "The
     original start date can't be in the future.", "That package expired on DD Mon YYYY — it can't be brought in."
     (`sg_date_label`), "This package has already been brought in." (catch `unique_violation` from the index and
     re-raise as 23514).
   - Inserts `status='active'`, `carried_over_start`, `carried_over_lessons`, `parent_id`, `product_id`,
     `student_id` — **no** `start_date` / `confirmed_at` / `expires_on`; the trigger owns them.
   - Writes `audit_log` (`action='package_carried_over'`, `entity_type='parent_package'`, new_value = original
     start, lessons, rate, start_date).
   - ⚠ RISK 1 MITIGATION (§7.396): no `now()` token anywhere in the body, comments included — stamps use `app_now()`.
3. Lifecycle trigger (INVOKER — keep it INVOKER; the `current_user` seam only works there):
   - **INSERT arm**, directly after the product lookup:
     `IF current_user = 'authenticated' AND (NEW.carried_over_start IS NOT NULL OR NEW.carried_over_lessons IS NOT NULL) THEN RAISE 'A carried-over package is recorded with Bring in package, not inserted directly.' (23514)` —
     parents and admins alike (⚠ RISK 3).
   - In the `ELSIF NEW.status = 'active'` branch, when `NEW.carried_over_start IS NOT NULL`: `start_date :=
     app_today()` unconditionally (ignore whatever was passed), `value_remaining := NEW.carried_over_lessons *
     NEW.rate_per_lesson`, `amount_payable := 0`, `discount_amount := 0`, `expires_on :=
     package_effective_end(COALESCE(NEW.carried_over_start, NEW.start_date), …)`. Placed AFTER the existing
     unconditional resets (§7.300).
   - **UPDATE arm**: `carried_over_start` / `carried_over_lessons` immutable **for every role** (no `current_user`
     condition — DEFINER callers run as `postgres`, §7.157).
   - Patch the pending→active arm's `package_effective_end` anchor too (unreachable for carried rows via
     `cop_status`, but keeps the census lint at zero).
4. Patch every window-END site in §6 to anchor on `COALESCE(<row>.carried_over_start, <row>.start_date)`.
   - ⚠ RISK 1 MITIGATION: build each new body **from `before/<fn>.sql`** (the DB dump), never from a migration file.
     After applying locally, dump `after/<fn>.sql` and `diff before/ after/`. **Assertion: the only changed lines are
     the anchor expressions and the carried early-returns/caps named in this step.** Any other changed line (a lost
     tenant clause, a single-child clause, a `NOW()`) is a blocker.
   - **Do NOT change any function's signature or argument list** (§7.189 — overload → PGRST203; DROP+CREATE loses
     the ACL). Keep `SECURITY DEFINER`, `STABLE`/`LANGUAGE`, `search_path` exactly as dumped.
   - **Do NOT change any window-START comparison** (`>= start_date`, `BETWEEN start_date AND`, `start_date <=
     today`). Changing those to COALESCE makes pre-today lessons draw (breaks D1) and pre-today holidays extend.
5. `apply_referral_reward`: first statement `IF NEW.carried_over_start IS NOT NULL THEN RETURN NEW; END IF;`.
   `settle_referral_reward`: first statement `IF NEW.carried_over_start IS NOT NULL THEN RETURN NULL; END IF;` —
   covers settle and the conversion arm (D6); the carried row has no reward and is never pending.
   ⚠ RISK 4 MITIGATION: `cop_price` is the backstop.
6. `record_package_refund`: cap = `CASE WHEN carried_over_start IS NULL THEN amount_payable ELSE value_remaining END`
   (Q1). Over-cap message for a carried row: "A refund cannot be more than the value left on the package (S$x)."
   The "dated before paid" check uses `confirmed_at` (unchanged).
7. ⚠ RISK 7 MITIGATION (§7.39, §7.87):
   `REVOKE ALL ON FUNCTION public.record_carried_over_package(UUID, UUID, DATE, INT, UUID) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE … TO authenticated;`
   — copy the recipe in `20261118000100_admin_edit_family_details.sql`. **Do NOT add any table grant.** Migration
   header carries the remote-dump command.
8. `app_now()` / `app_today()` only (G2). Run `scripts/check-migration-clock.sh` and
   `scripts/check-functions-sg-date.sh`. **Assertion: both pass.**
9. Regenerate types in the same commit (`scripts/gen-db-types.sh`, root checkout, §7.350).
   ⚠ RISK 10 MITIGATION: add `record_carried_over_package: ["p_student"]` to `NULLABLE_RPC_ARGS` — with its
   NULL-handling line read from `pg_get_functiondef` — in **all three** copies (`SwimSyncAdmin/lib/database.overrides.ts`,
   `SwimSyncApp/lib/database.overrides.ts`, `supabase/functions/_shared/database.overrides.ts`; copy commit
   `eb3e2f0`). **Assertion: `scripts/check-db-types.sh` and `scripts/check-db-overrides.sh` exit 0 (judge by exit
   code, §7.393).**
10. ⚠ RISK 1 MITIGATION — rollback path: write the DOWN (restore the 10 `before/` bodies, drop RPC/index/CHECKs/
    columns) as a file beside the migration; prove it runnable locally once (UP → DOWN → UP → `supabase test db`
    green). Valid only while prod has 0 carried rows.

**Step 2 — pgTAP** `supabase/tests/carried_over_packages.test.sql`. First statement pins the clock
(`set_config('swimsync.now','2026-11-18 10:00 +08',true)` — copy a pinned header). Fixture: 10-lesson, 10-week
product, original start 2026-10-07, 6 remaining → **expected expiry 2026-12-16** (the buggy today-anchor gives
2027-01-27, so they are distinguishable). Every case **as the real caller** (`set local role authenticated` + JWT
claims), never as `postgres` (§7.38). Each proven red by the named mutation (§7.25), recorded in the file header.
1. Balance = 6 × rate; `amount_payable` 0; `start_date` = 2026-11-18 even if the RPC is called with a different
   date passed in a test-only direct path. Mutation: drop the carried arm → red.
2. Accounting: in the same month also make a NORMAL sale with a known `amount_payable`; insert a `billing_periods`
   row for the fixture tenant only (§7.301 — never seal the seed tenant). **Assertion: `revenue_packages` = exactly
   the normal sale's `amount_payable` (non-zero baseline).** Mutation: set carried `amount_payable` to `total_value` → red.
3. Expiry = 2026-12-16; Extend +7 → 2026-12-23. Mutation: revert the `extend_package` anchor → red (`cop_expiry` raises).
4. Pre-today lesson: a 2026-11-11 lesson marked present → `package_applications` count 0 for this package (ad-hoc);
   today's lesson marked present → draws (count 1, balance 5 × rate).
5. Order guard: an unmarked 2026-11-11 lesson does **not** block marking 2026-11-18.
6. Holiday 2026-11-25 → extends once by the tenant's days; holiday 2026-12-30 (after true end, before today+70)
   → does **not** extend; holiday 2026-11-11 (before `start_date`) → does **not** extend. Mutations: revert the
   `holiday_covering_package` end anchor → the 12-30 case red; change the start side to COALESCE → the 11-11 case red.
7. Advance-cancelled lesson 2026-12-30 → no cancel extension; 2026-11-25 → one. `holiday_reconcile_on_activation`
   with today's holiday already marked → extends once.
8. `reassign_package_child` on a one-child carried row (no draws) → extensions recomputed inside the true window
   only; `expires_on` still satisfies `cop_expiry`.
9. Refund: cancel → refund of `value_remaining` accepted; `value_remaining + 0.01` refused; after one draw, a refund
   of `carried_over_lessons × rate` refused (Q1 default). Mutation: cap = `amount_payable` → the accepted case red.
10. Referral (⚠ RISK 4): family holds an `available` reward → after bring-in the reward is still `available`, row
    has `discount_amount` 0 and `referral_reward_id` NULL; family is the referee on a `pending` referral → stays
    `pending`, no `referral_rewards` row minted; family has an open unclaimed offer holding a reserved reward → the
    offer becomes `cancelled`/`superseded_by` = new row and the reward is back to `available` (⚠ RISK 12 — pinned
    behaviour); `void_referral_reward` cannot touch the carried row. Mutation: remove the `apply_referral_reward`
    early return → red.
11. Refusals, each with exact SQLSTATE + message: remaining 0, remaining lesson_count+1; original start tomorrow;
    already expired; inactive product; coach caller; parent caller; admin of ANOTHER tenant; parent not in the
    product's tenant; shared product with `p_student`; one-child product without; direct `INSERT` with
    `carried_over_*` as parent AND as admin; `UPDATE` of `carried_over_*` as parent, admin AND `postgres`; a second
    identical bring-in (unique index, 23514); opposite kind while another kind is live.
12. Census lint (⚠ RISK 2 — structural, permanent): zero public function bodies match
    `package_effective_end\(\s*(\w+\.)?start_date` or `start_date\s*\+\s*\(\s*(\w+\.)?validity_weeks`; prints the
    names on failure. Mutation: revert any one site → red naming it.
13. Retired product (D7): retire the product after bring-in → today's draw, Extend and refund still work.
14. `function_grants`: `record_carried_over_package` executable by `authenticated`, not `anon`/`PUBLIC`.

Then full `supabase test db`. **Assertion: every Step 0.4 file has an identical pass count** (a changed count means a
test was lost), and `app_clock`'s frozen census is unchanged. Then `supabase/functions/generate-invoices/test.sh`
**twice**, both green (§7.15).

**Step 3 — admin UI** (`SwimSyncAdmin/app/(admin)/packages/`). Needs Step 1 merged to `main` and applied. Feature branch.
1. `SaleModal`: toggle **"Existing package (bought before SwimSync)"** (shown only for packages:edit). When on:
   *Original start date* (`max = todayInSg()`), *Lessons remaining (of N)* (integer, 1…N from the chosen product);
   price preview hidden; button *Bring in package*. Helper copy: "Count every lesson before today, including any
   already marked in SwimSync — those won't come off this package."
   - ⚠ RISK 8 MITIGATION: the original start lives in **its own state** (`carriedStart`), never `saleStart`.
     **Do NOT edit the suggest/preview effect in `useSale`** (its RISK 8 — moves verbatim).
   - ⚠ RISK 11 MITIGATION: one line under the product picker when the toggle is on: "Made a product just for this?
     Retire it afterwards so families can't buy it."
   - ⚠ RISK 12 MITIGATION: if the family has an open unpaid offer for the same audience, show "Bringing this in
     cancels the open offer sent on DD Mon." before the button.
2. `dao/packages.rpc.ts`: `recordCarriedOverPackage(…)` with a hand-written required-key Args type plus
   `type _Check = Assert<Extends<Args, Rpc<"record_carried_over_package">["Args"]>>` — **Do NOT use
   `Rpc<…>['Args']` directly** (§7.345).
3. `useSale` carried path: `err.code === "23514"` → `setSaleError(err.message)`, else generic (same as sale).
   **Do NOT call `invokePackageEmail`** (D5). ~~Do NOT call `onActivated`~~ — **REVISED at build (2026-11-18): it IS
   called.** Coverage starts today, so the backlog preview can only list a lesson already marked TODAY (never an
   earlier one, D1 holds by construction), and `offer()` is silent when there is none — reusing it is the RISK 5
   notice, done by the existing dialog. The pre-submit count of earlier SwimSync lessons was dropped for static copy.
   ⚠ RISK 5 MITIGATION: after success, call `package_backlog_preview(newId)` (it can only return lessons dated
   today); if > 0 show a notice (Toast/inline, never `Alert.alert`): "N lesson(s) today were already marked before
   this package existed — use Check marked lessons to take them from it." And in the modal, before submit, show the
   count of this family's present, undrawn, un-invoiced lessons dated before today: "N lessons marked in SwimSync
   before today will bill pay-per-lesson at the next run — count them in Lessons remaining, or record them as paid
   outside." (Display only — nothing draws; D1.)
4. `HeldTable` / `packageRows`: Starts cell = `carried_over_start ?? start_date`; for a carried row a muted sub-line
   "Brought in DD Mon · N left then" (admin only; D4 is parent-only). **Check marked lessons** stays.
   ⚠ RISK 6 MITIGATION: `refundState` must stop keying on `amount_payable > 0` — use a single `refundCap(p)` =
   `carried_over_start ? value_remaining : amount_payable`, refund allowed when `refundCap(p) > 0`; `RefundModal`'s
   ceiling line reads `Up to {money(refundCap)} — {carried ? "the value left on the package" : "what the family paid"}.`
   `packages.repo.ts` select adds `carried_over_start, carried_over_lessons` as ONE string literal (§7.106).
5. vitest, each proven red by reverting its line: toggle hides preview/shows both fields; client validation copy;
   RPC args (shared → `p_student` null); changing product after typing the original start keeps it; 23514 shows the
   DB sentence; no `invokePackageEmail` / no `onActivated` on the carried path; today-notice when the preview > 0;
   `refundState` = `can_record` for a cancelled carried row with `value_remaining > 0` and `amount_payable` 0;
   ceiling copy.

**Step 4 — parent app: NO code change (D4).** ⚠ RISK 13 MITIGATION — the original Step 4 is dropped:
`features/billing/ui/PackagesTab.tsx` shows no start date; "Valid until" reads `expires_on` (correct by
construction); "N lessons remaining / S$x of S$y" reads `value_remaining`/`total_value`. `/package/[token]` takes
`valid_until_preview` from the `public-package` Edge Function (`start_date + weeks`), not the app — and a carried
row's token is never shared (no offer, no email, no pay-link action for active rows).
**Prohibition: do NOT add any surface that links a carried row's `public_token`.** If one is ever needed,
`public-package/core.ts validUntilPreview` must anchor on `carried_over_start` first (an Edge Function deploy).
**Assertion (Step 5): the parent card shows the expected count and expiry.**

**Step 5 — verify in the UI.** New driver `verify-carried-over-package.mjs`, own fixture + teardown, owning its
family/class/product (§7.163-style ids, relative dates checked by `drivers/check-driver-dates.sh` /
`check-driver-clock.sh`). Bring one in (6 of 10, original start = today − 42) → held row shows the original start
and "Brought in"; mark today present → counter 5; parent card shows "5 lessons remaining" and expiry original + 70;
cancel → Refund visible, ceiling = value left, refund records. `run-all-drivers.sh --only
verify-carried-over-package` **twice**, both green; then `check-fixture-roundtrip.sh`. **Do NOT run the full sweep
or the CI nightly** (user-requested only); not beside a worktree.

**Step 6 — ship via `/deploy`: migration → engine → apps.**
1. ⚠ RISK 7 MITIGATION: `supabase db push` the migration while `main`'s app code does not yet name
   `carried_over_*`. Confirm: `scripts/prod-query-ro.sh "select count(*) from information_schema.columns where table_name='parent_packages' and column_name like 'carried_over_%'"` — **Assertion: 2.**
2. Remote grant dump of the new function (§7.39, DEPLOYMENT §11.7). **Assertion: EXECUTE for `authenticated` only
   — no `anon`, no `PUBLIC`.**
3. Re-run Step 0.3's md5 query on prod for the 10 functions. **Assertion: each equals the local `after/` md5.**
4. Engine: no change — `generate-invoices` reads `package_applications` only; `public-package` / `package-emails`
   unchanged (Step 4). The `_shared` types-only change is runtime-identical (`scripts/check-runtime-identical.sh`),
   so **no `supabase functions deploy`**.
5. Apps to `main` **last**; watch with `scripts/watch-deploy.sh` under Monitor; grep the served admin bundle for
   "Bring in package" (§7.31 — a 200 proves nothing).
6. Docs from `main`: PRD §7.16 bullet; BACKLOG note (pending-referral consequence; public-package anchor if ever
   linked); this plan's row in `docs/plans/README.md`.

## 5. Definition of done
An admin with packages:edit can bring a mid-cycle package into SwimSync with its remaining lessons and real expiry;
it draws from today on, never from earlier lessons, shows S$0 revenue, can be refunded up to its value left, and is
indistinguishable to the parent. Every existing package behaves byte-for-byte as before (identical suite counts,
`before`/`after` diff limited to anchor lines). Live on prod, driver green ×2, tests proven red.

## 6. Census result (pre-filled by plan-review 2026-11-18 from the local DB — re-run in Step 0 to confirm)

DB: 27 functions, 0 views, 0 policies.

| Function | Reads | Class | Action |
|---|---|---|---|
| `enforce_parent_package_lifecycle` | `package_effective_end(NEW.start_date…)` ×2 (INSERT, pending→active) | END | patch both + carried arm + pins |
| `extend_package` | `package_effective_end(start_date…)` | END | patch |
| `apply_holiday_reconcile` | `package_effective_end(pp.start_date…)` | END | patch |
| `apply_cancel_reconcile` | `package_effective_end(pp.start_date…)` | END | patch |
| `holiday_covering_package` | `p_date >= start_date` / `< start_date + weeks*7` | START + END | patch END only |
| `holiday_reconcile_on_activation` | `>= NEW.start_date` / `< NEW.start_date + weeks*7` | START + END | patch END only |
| `reassign_package_child` | `v_end := start_date + weeks*7`; `>= start_date` | START + END | patch `v_end` only |
| `record_package_refund` | cap = `amount_payable` | PRICE | carried cap = `value_remaining` (Q1) |
| `apply_referral_reward` | writes `amount_payable` (BEFORE INSERT, sorts after lifecycle) | PRICE | early return for carried |
| `settle_referral_reward` | settle / expired re-price / conversion | PRICE | early return for carried |
| `void_referral_reward` | writes `amount_payable = total_value` | PRICE | none (unreachable; `cop_price` backstop) |
| `accounting_summary` | SUM `amount_payable` by `confirmed_at` month | PRICE | none (S$0 by construction) |
| `package_candidates_for`, `guard_package_draw_order`, `package_backlog_lessons` | `>= start_date`, `<= expires_on` | START | none (D1 holds) |
| `student_package_coverage`, `package_renewal_candidates` | `start_date <= today`, `expires_on` | START | none |
| `package_draw_for`, `package_live_balances`, `assert_package_kind_free`, `book_trial`, `suggest_package_start` | `expires_on` | stored END | none |
| `package_effective_end` | the formula | — | none (callers pass the anchor) |
| `create_package_offer`, `preview_package_price`, `derive_package_product_validity`, `pin_package_product_terms` | offer/preview/product | — | none |

Code (non-DB):

| File | Reads | Action |
|---|---|---|
| `supabase/functions/public-package/core.ts validUntilPreview` | `start_date + validity_weeks*7` in TS | none — carried tokens never linked (Step 4 prohibition) |
| `supabase/functions/package-emails` | `start_date`, `expires_on`, `amount_payable` | none — never invoked for carried rows (D5) |
| `supabase/functions/generate-invoices` | `package_applications` only | none |
| `SwimSyncAdmin/…/packages/domain/packageRows.ts refundState` | `amount_payable > 0` | **patch** (RISK 6) |
| `SwimSyncAdmin/…/packages/ui/RefundModal.tsx` | "Up to amount_payable" | **patch** |
| `SwimSyncAdmin/…/packages/ui/HeldTable.tsx` | `start_date` | show `carried_over_start ?? start_date` |
| `SwimSyncApp/features/billing/ui/PackagesTab.tsx` | `expires_on`, `value_remaining`; catalogue copy; `amount_payable` only in the PENDING "Pay via PayNow" / "Waiting for" copy | none — carried rows are never pending (`cop_status`) |
| `SwimSyncApp/features/paynow/*` (`usePayNow`, `paynow.repo`) | `amount_payable` for a PENDING package's QR | none — never pending |
| `SwimSyncApp/features/billing/domain/billingFormat.ts` | maps `amount_payable`, `validity_weeks` | none |
| `SwimSyncAdmin/…/packages/domain/packageOffers.ts`, `useGenerateOffers.ts`, `ui/ConfirmPaymentModal.tsx`, `ui/PendingPanel.tsx` | offer / pending `start_date`, `amount_payable` | none — offers and pending rows only |
| `supabase/functions/generate-invoices/bench/seed.ts` | bench fixture | none |

**Step 0 run 2026-11-18:** 0.1 = 27 / 0 / 0 ✅ · 0.2 = 29 files, all classified above ✅ · 0.3 = all 10 md5s prod = local ✅
(before-bodies: scratchpad `carried/before/`, 795 lines).

Step 0.4 suite counts (before, 2026-11-18 on `281e290` — full run `Files=98, Tests=2187, PASS`; per-file `plan(n)`):
lesson_packages 31 · package_holiday_extension 15 · cancel_package_extension 18 · package_manual_extend 10 ·
package_weeks_start_date 16 · package_refunds 40 · accounting_package_revenue 18 · package_draw_at_marking 62 ·
single_child_packages 70 · package_offers 22 · package_corrections 14 · student_package_coverage 25 · app_clock 31 ·
function_grants 6 · table_grants 6 · recurring_gotchas 3 · referrals 58 (added — Step 1.5 touches it).
**After Step 1, Files = 99 and Tests = 2187 + the new file's plan; every number above unchanged.**

Function-body dump from the review (27 functions, local DB, 2026-11-18) — reusable as Step 0.3's `before/`:
`/private/tmp/claude-501/-Users-kahhang-Documents-Code-SwimSync/60f3a080-8097-4c15-a78c-210c32d26081/scratchpad/fns.sql`
(scratchpad — re-dump if cleared).

## 7. Known consequences (accepted)
- Lessons the admin already marked in SwimSync before today stay as they are (ad-hoc lessons still bill at the
  next run). The admin must count them when typing "remaining" (D1, user's call) — the modal says so in its helper copy (Step 3.3 — a pre-submit count was dropped: coverage starts today).
- *Show lessons used* under-counts versus the counter (D4).
- A wrong carry-over is fixed by cancel + re-bring-in (start dates are fixed once active, as today; the unique index
  counts ACTIVE rows only).
- A pending referral where this family is the referee stays pending and converts on their next real purchase (D6).
- The held table's *Starts* column shows the original start but sorts by `start_date` (low; left as is).
- Bringing a package in cancels the family's open unpaid offer for the same audience (supersede; pinned in test 10;
  warned in the modal).

## Pre-commit gate

**Highest value — any unticked box is a blocker:**
- [ ] Step 0.3: prod md5 = local md5 for all 10 functions before; = `after/` md5 after `db push`.
- [ ] Step 1.4: `diff before/ after/` shows only anchor / early-return / cap lines; no signature changed; no START comparison changed.
- [ ] §3 CHECKs (`cop_price`, `cop_expiry`, `cop_status`) + partial unique index exist (`\d parent_packages`).
- [ ] Step 2: every Step 0.4 suite has an identical pass count; test 12 (census lint) green and shown red by one reverted site.
- [ ] Step 6.1/6.2: migration on prod (2 columns) and remote dump shows no `anon`/`PUBLIC` EXECUTE **before** any app commit naming `carried_over_*` reaches `main`.
- [ ] Refund visible for a cancelled carried row, ceiling = value left (vitest + driver).

**The rest:**
- [ ] Q1 answered by the user (D3 cap reading).
- [ ] No `current_user` in `record_carried_over_package`; `recurring_gotchas` green.
- [ ] No `now()` token in new/changed bodies (comments included); `app_clock` census unchanged; `check-migration-clock.sh` + `check-functions-sg-date.sh` exit 0.
- [ ] Every pgTAP case runs as `authenticated` with claims; mutation recorded in the header.
- [ ] Accounting test uses a sealed fixture-only month + a non-zero normal-sale baseline.
- [ ] Deno `test.sh` green twice in a row.
- [ ] Types regenerated in the migration commit; `NULLABLE_RPC_ARGS` in all 3 copies; `check-db-types.sh` + `check-db-overrides.sh` exit 0.
- [ ] `npm run typecheck` + `npm test` in SwimSyncAdmin and SwimSyncApp.
- [ ] No `invokePackageEmail` / no `onActivated` on the carried path; today-notice shown when the backlog preview > 0.
- [ ] `carriedStart` separate from `saleStart`; `useSale` effect untouched.
- [ ] DOWN proven runnable locally (UP → DOWN → UP).
- [ ] Driver `--only` ×2 green; `check-fixture-roundtrip.sh` green; no full sweep / nightly.
- [ ] Served-bundle grep for "Bring in package" after the push.
