# Single-child packages — plan

_Status: BUILT 2026-10-11 (deploy pending) · written 2026-10-10 via `/plan-with-confidence` · hardened by `/plan-review` 2026-10-10 · BACKLOG Wave 9 item 7 · requested by Little Orcas_

## 1. What we are building

On the admin **Packages** page each package **product** is either **Shared across siblings** (today's behaviour, the
default) or **One child only**. A one-child product, when bought, is tied to **one named child**; only that child's
lessons can draw from it. Everything else about packages (locked rate, category scope, weeks, start date, holiday
extensions, refunds, referrals) is unchanged.

**Why:** Little Orcas does not let one package cover two children. Today every package pools per (parent, business)
across siblings (PRD §7.16), so a second child's lessons silently draw from the first child's package.

## 2. Decisions — settled with the user 2026-10-10 (do not reopen)

| # | Question | Answer |
|---|---|---|
| D1 | Where is shared/one-child set? | **Per product.** A business can sell both kinds. |
| D2 | Packages already sold? | **Stay shared** — they keep the terms they were sold under (incl. the Ang family's at Little Orcas). |
| D3 | A sibling's lesson the one-child package would otherwise cover? | **Ad-hoc** — billed at the next run at class price; their chip reads *Ad-hoc*. Never a refusal. |
| D4 | Change the child after sale? | **Admin may, while the package is unused** — locked once ANY lesson has ever drawn from it. |
| D5 | Family holds a shared AND a child's own package, both can pay? | **The child's own package pays first**, then the shared one; within each group, today's order (earliest expiry, confirmed_at, id). |
| D6 | Flip an existing product's flag? | **Yes — affects new sales only.** Not a money term; not pinned by `pin_package_product_terms`. |
| D7 | Parent buying a one-child product in the app? | **"Which child is this for?" picker; auto-picked (shown, not asked) when they have one child at that business.** |
| D8 | Renewal offers? | **A row per child** for a child whose own package is low/expired, offer tied to that child. Shared families keep one row per family. |
| D9 | The engine's legacy matcher (runs only when `tenants.package_draw_at_marking` is false — all 3 prod tenants are true)? | **Block, don't change the engine.** The DB refuses a one-child package in a flag-off tenant and refuses turning the flag off while one is held. Removing the legacy path entirely is a **separate BACKLOG item**, after Little Orcas seals September (it is Wave 6's rollback until then). |
| D10 | When does it go live? | **When verified** — not gated on Little Orcas' September Generate. No engine change, so engine v35's first-run proof is untouched. |
| D11 | *(added 2026-10-10, build session — the user's call, replacing the mixed-family cases)* Can one family hold both kinds? | **No — one kind per family (parent × business).** A purchase of the other kind is REFUSED while the family holds a package of the current kind that is pending, or active with ≥1 lesson left and unexpired. Once used up, expired, cancelled or refunded, the family may switch. |

**D11's consequences (build session).** Raised because §3 RISK 4's renewal-row definition (combined coverage) could not
satisfy D8 or its own assertion (Ava own-low + healthy shared → one row). With D11 a family is shared XOR one-child,
so: renewal rows are family rows for a shared family and per-child rows for a one-child family (D8 and §3 now agree);
the D5 order and `draw_rank` are KEPT, because one path still co-holds both kinds briefly — a reversed draw returns a
lesson to a used-up shared package after an own package was bought; the RISK 4 assertions become "Ava own-low + Ben
own-healthy → one row" and "Ava own-low + Ben own-low → two rows"; the "mixed family" PK001 case (§3, §6, §7) is now
reachable only through that reversal and is no longer pinned; a family row's offer picker lists shared products only
and a child row's lists one-child products only. Enforced by a SECURITY DEFINER helper `assert_package_kind_free`
called from the lifecycle trigger on INSERT (same grant shape as `assert_package_child`), under a per-family advisory
lock so two concurrent purchases cannot both pass.

Prod facts this plan relies on (read 2026-10-10): 3 tenants, all `package_draw_at_marking = true`. Little Orcas has 6
active products and 1 active package (PKG-2026-0002, the Ang family, shared, drawn from B's backfill). Its September is
unsealed and unbilled, so Wave 6's B rollback is still valid. Engine v35 is deployed and unexercised. **This plan does
not touch the engine.**

## 3. Technical decisions (taken in planning, from the code)

**Step 0 — read every body from the DB, never from a migration (§7.40, §7.336).** Before writing a line, capture
`pg_get_functiondef` plus `proacl` / `provolatile` / `prosecdef` / `proconfig` for every function touched by this plan.
The list: `package_candidates_for`, `package_draw_for`, `guard_package_draw_order`, `package_backlog_lessons`,
`package_backlog_preview`, `draw_package_backlog`, `package_backfill_draws`, `holiday_covering_package`,
`student_package_coverage`, `package_renewal_candidates`, `create_package_offer`, `supersede_open_package_offer`,
`apply_referral_reward`, `enforce_parent_package_lifecycle`, `suggest_package_start`, `book_trial`, `merge_students`,
`reassign_student_tenant`, `guard_tenant_columns`, `apply_holiday_reconcile`, `apply_cancel_reconcile`. Save them to the
scratchpad as `before/<fn>.sql` and `before/acl.txt`.
- ⚠ RISK 2 MITIGATION (step): also capture an md5 of each body **on prod** (`scripts/prod-query-ro.sh`, bare command).
  **Assertion:** each prod md5 equals the local md5 before the migration is written. A mismatch means prod holds a body
  local lacks. STOP and reconcile, because CREATE OR REPLACE would silently revert it (§7.336).
- ⚠ RISK 2 MITIGATION (step): after writing the migration, diff each new body against `before/<fn>.sql`, with the
  intended edits normalised out. **Assertion:** the remaining diff is empty for every function. Any other change is a
  regression slipped in by copying.

### Schema (one migration, `db/single-child-packages` branch in the root checkout)

- `package_products.single_child BOOLEAN NOT NULL DEFAULT false`. Editable; `pin_package_product_terms()` is NOT
  taught to pin it (D6).
- `parent_packages.student_id UUID NULL REFERENCES students(id) ON DELETE RESTRICT`. NULL = shared.
- Both columns sit on tables where `authenticated` holds table-level grants (checked 2026-10-10: `parent_packages`
  `authenticated=arw`, `package_products` `authenticated=arwd`, no column ACLs), so no new GRANT is needed.
  **Assertion:** `table_grants.test.sql` stays green unchanged.
- ⚠ RISK 13 MITIGATION (named prohibition): do NOT add the new FK's table pair to `recurring_gotchas.test.sql`'s
  allowlist. It should not be needed, because there is one direct FK. If #1 goes red, qualify embeds first (§7.90).
  ⚠ RISK 13 MITIGATION (step): every new embed of the child from `parent_packages` is written `students!student_id(full_name)`.
  It is never a bare `students(...)`, because `package_applications` already links the two tables many-to-many.
  **Assertion:** a signed-in PostgREST `curl` (admin JWT and parent JWT) of
  `parent_packages?select=id,students!student_id(full_name)` returns 200 with the name. Also run the bare form once and
  record whether it gives PGRST201; that result decides the GOTCHAS graduation item below.
- ⚠ RISK 3 MITIGATION (step, structural): before the migration, run on local AND prod (read-only):
  `SELECT referral_reward_id, count(*) FROM parent_packages WHERE referral_reward_id IS NOT NULL AND status <> 'cancelled' GROUP BY 1 HAVING count(*) > 1`.
  If both return 0 rows, the migration adds
  `ALTER TABLE parent_packages ADD CONSTRAINT one_live_package_per_reward EXCLUDE USING btree (referral_reward_id WITH =) WHERE (referral_reward_id IS NOT NULL AND status <> 'cancelled') DEFERRABLE INITIALLY DEFERRED`.
  It is deferred because §7.165's same-statement handoff briefly holds two rows. If either returns rows, STOP and ask
  the user. Do not add the constraint and do not "fix" the data.

### Invariant, enforced in `enforce_parent_package_lifecycle()` (SECURITY INVOKER; redefine from its DB body, §7.40)

- **INSERT** checks:
  - The product is `single_child` ⇒ `student_id` IS NOT NULL. The product is shared ⇒ `student_id` IS NULL.
  - The flag is read from the product at insert, like the other snapshot columns. A later flip never changes a held
    row (D2/D6).
  - Refusal copy: "Choose which child this package is for." / "This package is shared — it can't be tied to one child."
- `student_id` must be linked to `parent_id` via `parent_students`, and the student's `tenant_id` must equal `NEW.tenant_id`.
- INSERT is refused when the tenant's `package_draw_at_marking` is false and `student_id` is set (D9).
- The link, tenant and flag checks run in a new **SECURITY DEFINER helper**
  `assert_package_child(p_tenant uuid, p_parent uuid, p_student uuid)`. It is called from the invoker trigger, because a
  parent's insert runs under RLS and must not be able to name a child that is not theirs.
  - ⚠ RISK 7 MITIGATION (named prohibition): the helper takes ONLY arguments and checks facts. It must NOT read
    `current_user` or `session_user` (recurring_gotchas #2 goes red, and under DEFINER it always reads `postgres`).
  - ⚠ RISK 7 MITIGATION (step): `REVOKE ALL … FROM PUBLIC, anon`, then `GRANT EXECUTE … TO authenticated, service_role`.
    An invoker trigger runs its callees as the writing role (§7.342). **Assertion:** a pgTAP case where the parent
    (`SET LOCAL ROLE authenticated` + claims) inserts a valid one-child request succeeds. That proves the grant.
- **UPDATE** rules:
  - (a) Shared↔one-child is refused for **all roles**: `(OLD.student_id IS NULL) <> (NEW.student_id IS NULL)`. This is
    D2: sold terms.
  - (b) When `current_user = 'authenticated'`, any change to `student_id` is refused ("Use Change child"). This is the
    §7.157 pin.
  - (c) Any change to `student_id` by any role re-runs `assert_package_child` against the NEW child.
  - ⚠ RISK 7 MITIGATION (named prohibition): do NOT add `student_id` to the all-roles "terms" pin list
    (`product_id … requested_at`). DEFINER writers (`reassign_package_child`, `merge_students`) run as `postgres` and
    must be able to change it.
  - ⚠ RISK 7 MITIGATION (named prohibition): do NOT re-check the product's current `single_child` on UPDATE or on
    pending→active. Confirmation must still work for a row created before a flip.
    **Assertion (pgTAP):** a parent's shared request is pending, the admin flips the product to one-child, and the admin
    confirm succeeds with `student_id` still NULL.
- ⚠ RISK 7 MITIGATION (assertions, pgTAP, each shown red first):
  - The parent's direct `UPDATE parent_packages SET student_id = <sibling>` on their own row fails (§7.157).
  - The admin's direct PostgREST-shape UPDATE of `student_id` fails.
  - The parent's INSERT naming another family's child fails.
  - An INSERT naming a child of another tenant fails.
- ⚠ RISK 12 MITIGATION (assertion): `enforce_parent_package_lifecycle` keeps exactly 2 raw clock reads (frozen census in
  `app_clock.test.sql`). Mark each copied `NOW()` `-- clock: stamp` in the NEW migration file (§7.354).

### D9's second half

`guard_tenant_columns()` already makes `package_draw_at_marking` writable by nobody. Add a new BEFORE UPDATE trigger on
`tenants`, `guard_one_child_packages_flag()`. It refuses true→false while an active or pending `parent_packages` row
with `student_id` exists. This is belt and braces for a migration or service-role write. It applies to ALL roles.
- ⚠ RISK 12 MITIGATION (named prohibition): no `current_user` in it (recurring_gotchas #2 if DEFINER). It needs no role
  test at all.
- ⚠ RISK 9 MITIGATION (step): edit `supabase/rollback/20261006000200_package_draw_at_marking_b_DOWN.sql`. It is a
  rollback script, not an applied migration. Add a preflight as the FIRST statement inside its DO block:
  `IF EXISTS (SELECT 1 FROM parent_packages WHERE student_id IS NOT NULL AND status IN ('active','pending')) THEN RAISE EXCEPTION 'one-child packages are held (%): refund or cancel them first — switching off restores the legacy matcher, which would pool them across siblings', (SELECT string_agg(reference_number, ', ') …); END IF;`
  - **Assertion:** rehearse locally. Hold one one-child package and run the edited file inside `BEGIN … ROLLBACK`. It
    raises the preflight message, not the trigger's.
  - ⚠ RISK 9 MITIGATION (named prohibition): never disable `guard_one_child_packages_flag` to push a rollback through.
- ⚠ RISK 9 MITIGATION (step): write this migration's own `supabase/rollback/<ts>_single_child_packages_DOWN.sql`.
  - It REFUSES while any `student_id IS NOT NULL` row exists.
  - Otherwise it restores every `before/<fn>.sql` body and its ACL and drops the new triggers.
  - It never drops a column (live bundles select them) and never drops a callee (§7.335).

### New RPC `reassign_package_child(p_package UUID, p_student UUID)` (SECURITY DEFINER)

- Gate: `IF NOT COALESCE(is_platform_admin() OR has_admin_area(v_tenant,'packages','edit'), false) THEN RAISE … 42501`.
  The tenant is derived from the package row.
  ⚠ RISK 10 MITIGATION (assertion): pgTAP refuses each of: a coach, a parent of that family, another tenant's admin, and
  a view-only co-admin. One case per caller (§7.328).
- ⚠ RISK 10 MITIGATION (step, structural): FIRST statement after the gate:
  `SELECT … FROM parent_packages WHERE id = p_package FOR UPDATE`. Only then check for draws. `package_draw_for` locks
  candidate packages FOR UPDATE before inserting, so the two serialise.
- Refuses if the package is shared, cancelled, or has ANY `package_applications` row, live or reversed ("ever drawn",
  D4). Refuses if `p_student` is the current child. Runs the same `assert_package_child` checks. Writes an `audit_log`
  row (`package_child_reassigned`, old and new `student_id`).
- ⚠ RISK 10 MITIGATION (step): after the UPDATE, recompute extensions so none earned by the old child survive:
  `apply_holiday_reconcile(<distinct holiday dates in the package's nominal window for the old ∪ new child>)`, then
  `apply_cancel_reconcile(class, date)` for each cancelled lesson in the window in a class either child is enrolled in.
  **Assertion (pgTAP, red first):** a package holds a holiday extension from Ava's holiday and is reassigned to Ben. The
  extension row is gone, `holiday_extension_days` is 0, and `expires_on` is back to nominal.
- ⚠ RISK 12 MITIGATION (named prohibition): no raw `now()` / `NOW()` in its body. The frozen clock census refuses a new
  entry. Let `audit_log`'s column default stamp it, or use `app_now()` where a date decision is made.
- `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE … TO authenticated` in the same migration
  (§7.87).

### The matcher — one place, one ORDER (D5)

- ⚠ RISK 1 MITIGATION (step, structural): `package_candidates_for(p_session, p_student)` gains:
  - the filter `AND (pp.student_id IS NULL OR pp.student_id = p_student)`;
  - a new output column `draw_rank integer` computed as
    `row_number() OVER (ORDER BY (pp.student_id IS NULL), pp.expires_on, pp.confirmed_at, pp.id)`.
  The return type changes, so `DROP FUNCTION public.package_candidates_for(uuid, uuid)` and CREATE it in the same
  migration, then `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`. The ACL was `{postgres=X}` only.
- ⚠ RISK 1 MITIGATION (step): every caller orders by `draw_rank` and nothing else:
  - `package_draw_for`'s pick (`ORDER BY c.draw_rank`);
  - `guard_package_draw_order`'s package pick (`ORDER BY c.draw_rank`);
  - `package_backlog_preview`'s loop (`ORDER BY pc.draw_rank`).
  `package_backlog_lessons`, `draw_package_backlog` and `package_backfill_draws` call through and need no order change.
- ⚠ RISK 1 MITIGATION (named prohibition): do NOT change `package_draw_for`'s LOCK statement
  (`ORDER BY pp.expires_on, pp.confirmed_at, pp.id FOR UPDATE`). The lock order is a global deadlock-avoidance order,
  not the draw order.
- ⚠ RISK 1 MITIGATION (assertion, structural; pgTAP census in the new file): every `public` function whose body
  matches `package_candidates_for\(` and contains `ORDER BY` also contains `draw_rank`. **Expected:** zero offenders.
  It is a catalogue scan, so a future caller is covered too. Prove it red by temporarily reverting the preview's order.
- **Second matcher:** `holiday_covering_package(p_student_id, …)` gets the same filter and
  `ORDER BY (pp.student_id IS NULL), pp.expires_on, pp.confirmed_at, pp.id`. That way a holiday or advance-cancel
  extends the package that would actually have paid. Its callers (`apply_holiday_reconcile`, `apply_cancel_reconcile`)
  inherit it.
- ⚠ RISK 5 MITIGATION (assertion; snapshot proof that shared-only families are unchanged). With the clock pinned
  (`set_config('swimsync.now','2026-10-10 10:00+08',true)` in the session) and each of `fixtures-packages.sql` and
  `fixtures-package-draw-at-marking.sql` loaded in turn (teardown after each, §7.272), export these BEFORE the migration
  (branch base) and AFTER:
  - (i) for every `attendance` row, the candidate package-id list (before: `array_agg(package_id ORDER BY expires_on, confirmed_at, package_id)`; after: `ORDER BY draw_rank`);
  - (ii) `SELECT * FROM student_package_coverage() ORDER BY student_id, parent_id`;
  - (iii) `package_renewal_candidates()`, the pre-existing columns only, ordered;
  - (iv) `package_live_balances()`.
  **Assertion:** an empty diff on all four. Put the export in a `bash` script file, not zsh (§7.340), and execute every
  SQL string against the real DB (memory: fake proofs don't run SQL).

### PK001 guard (`guard_package_draw_order`)

- When the chosen package has a `student_id`, count only THAT child's earlier unmarked lessons: add
  `AND (v_pkg.student_id IS NULL OR p.student_id = v_pkg.student_id)`, and select `pp.student_id` into `v_pkg`. A
  sibling can never draw from it, so their unmarked lessons must not block.
- Shared packages: unchanged (still family-wide). A shared package chosen for Ava still counts a sibling who holds
  their own package. The coach resolves it by marking the named lesson first, which then draws from the sibling's own
  package. This conservative over-count is accepted and pinned by a test, not modelled.
- ⚠ RISK 2 MITIGATION (assertion; against the silent fail-open): pgTAP case where a one-child package's OWN child has an
  earlier unmarked lesson beyond its balance. Marking a later lesson **raises PK001**. Without this positive case, a
  broken new clause turns the guard into a WARNING and every "does not block" test passes vacuously.
- ⚠ RISK 2 MITIGATION (assertion): every existing PK001 case in `package_draw_at_marking.test.sql` stays green
  unchanged. The test count is identical to before, plus the new cases.
- ⚠ RISK 2 MITIGATION (named prohibition): do NOT widen or remove the guard's `EXCEPTION WHEN OTHERS` fail-open (§7.324).

### Other function changes

- **`package_backlog_lessons`**: when `pp.student_id` is set, only that child's attendance (`AND (pp.student_id IS NULL OR a.student_id = pp.student_id)`).
- **`student_package_coverage()`**: per child, use only live packages where `student_id IS NULL OR student_id = child`.
  - `lessons_remaining` = that child's usable lessons.
  - `low` is computed per child over the same set. For a shared-only family this equals today's family figure.
  - The pending/future-start `open_row` exclusion also scopes to rows usable by that child.
  - ⚠ RISK 5 MITIGATION (named prohibition): do NOT change its return columns. The app derives "own" from
    `package_id` → the parent's own package list (§4). If a column is ever unavoidable, it needs DROP + CREATE +
    `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated, service_role` (the captured ACL), and a pgTAP
    `has_function_privilege('authenticated', …)` assertion.
  - ⚠ RISK 12 MITIGATION (named prohibition): no affordability comparison (`value_remaining >= rate_per_lesson`) in it.
    `student_package_coverage.test.sql` greps for it (§7.161).
  - **Assertion:** `student_package_coverage.test.sql` stays green unchanged, and the RISK 5 snapshot diff is empty.
- **`package_renewal_candidates()`** (D8). It gains output columns `student_id uuid` (NULL = family row) and keeps every
  existing column. The return type changes, so DROP + CREATE, `REVOKE ALL FROM PUBLIC, anon`, and
  `GRANT EXECUTE TO authenticated, service_role` (the captured ACL).
  - ⚠ RISK 4 MITIGATION (step): define the rows explicitly.
    - A family with only shared packages gives one row, as today. The snapshot proves this.
    - A child row (`student_id` set) is emitted when that child's coverage is `low` and their covering set includes an
      own package, OR their own package expired within 30 days and nothing usable by them is live or pending.
    - For a child row: `children` = that child's name; `original`/`suggested_product_id` comes from that child's most
      recent own package; `has_open_offer` = an open unclaimed offer with `student_id = child`.
    - For a family row: `has_open_offer` = an open offer with `student_id IS NULL`.
    - `expired_fams`' NOT EXISTS is scoped to rows usable by the same audience.
  - **Assertion (pgTAP):** a family with Ava (low own package) and Ben (healthy shared package) yields exactly one row,
    Ava's, and it carries `student_id = Ava`. The same family with the shared package low yields two rows.
- **`create_package_offer(p_parent_id, p_product_id, p_start_date, p_student_id uuid DEFAULT NULL)`.**
  - ⚠ RISK 6 MITIGATION (step): `DROP FUNCTION public.create_package_offer(uuid, uuid, date)`, then CREATE the 4-arg
    form, `REVOKE ALL FROM PUBLIC, anon`, and `GRANT EXECUTE TO authenticated, service_role` (the captured ACL).
    **Assertion (pgTAP):** `SELECT count(*) FROM pg_proc WHERE proname = 'create_package_offer' AND pronamespace = 'public'::regnamespace` = 1,
    and `has_function_privilege('anon', …)` is false.
  - ⚠ RISK 4 MITIGATION (step): the RISK-12 "one open offer" refusal becomes per audience:
    `… AND student_id IS NOT DISTINCT FROM p_student_id`. Copy: "An offer is already open for <child>/this family — Decline it first."
    **Assertion (pgTAP):** offers for Ava and Ben both succeed; a second offer for Ava is refused.
  - ⚠ RISK 6 MITIGATION (step): before the change, `git grep -n '\.rpc(' SwimSyncAdmin SwimSyncApp .claude/skills/run-ui-playwright/drivers`
    for `create_package_offer` and `suggest_package_start` (the pattern is `\.rpc(`, HANDOVER §3), and list every call
    site in the commit message.
  - The lifecycle trigger enforces the product↔child rule.
- **`supersede_open_package_offer`**: a new purchase supersedes an open offer only when `student_id` matches
  (`IS NOT DISTINCT FROM`), so Ava's purchase does not cancel Ben's offer. It keeps its 1 raw `now()`, marked
  `-- clock: stamp`.
- **`apply_referral_reward`** (missing from the original plan):
  - ⚠ RISK 3 MITIGATION (step): its "reserved by a to-be-superseded offer" arm gains
    `AND pp.parent_id = NEW.parent_id AND pp.tenant_id = NEW.tenant_id AND pp.student_id IS NOT DISTINCT FROM NEW.student_id`.
    That is exactly the supersede predicate, so the two can never disagree. Add a comment in both bodies naming the
    other.
  - **Assertion (pgTAP, red first):** Ava's offer reserves the family's only reward, then Ben's one-child request is
    inserted. Ava's offer keeps `referral_reward_id` and its discount; Ben's row has `discount_amount = 0`; and
    `count(*) FROM parent_packages WHERE referral_reward_id = R AND status <> 'cancelled'` = 1.
  - The same-child case still hands off: Ava's offer, then Ava's own request, moves the reward to the new row and the
    offer is superseded. This is §7.165 kept.
  - **Assertion:** `referrals.test.sql` stays green unchanged, and `trg_zz_apply_referral_reward` still sorts after
    `trg_parent_package_lifecycle` (§7.167).
- **`suggest_package_start(p_parent_id, p_product_id, p_student_id uuid DEFAULT NULL)`.**
  - When given, the suggested start looks at that child's enrolments only, and overlapping `active_pkgs` are only
    packages usable by that child. When NULL (a shared product), `active_pkgs` excludes other children's one-child
    packages; this is the same as today for a shared-only family.
  - ⚠ RISK 6 MITIGATION (step): DROP the 2-arg form, CREATE the 3-arg form, `REVOKE ALL FROM PUBLIC, anon`, and
    `GRANT EXECUTE TO authenticated, service_role`. **Assertion:** one `pg_proc` row for the name.
- **`preview_package_price`: UNCHANGED, with no new parameter.**
  - ⚠ RISK 6 MITIGATION (narrower scope): the price and the referral discount are family-level and do not depend on
    the child, so the original plan's extra parameter is dropped. That is one fewer signature change.
  - Referral reward rules are unchanged (family-level, first package).
- **`book_trial`**: today it refuses if any parent holds an active package with value. Scope that to packages that can
  cover THIS child (`pp.student_id IS NULL OR pp.student_id = p_student_id`).
  **Assertion:** a trial for Ava is still refused while the family holds a shared package (control).
- **`merge_students`**: in its body, move `parent_packages.student_id` from the duplicate to the survivor, right after
  step 2 (parent links) and before the final DELETE. Otherwise the RESTRICT FK aborts the DELETE.
  - ⚠ RISK 14 MITIGATION (named prohibition): do NOT add a `moved_packages` column to its RETURNS TABLE (that is a type
    change and breaks the admin caller). Do NOT add `parent_packages` to its cascade allowlist; RESTRICT is not a cascade.
  - Keep its 1 raw clock read.
  - **Assertion:** `student_merge.test.sql` stays green, plus a new case: the duplicate holds a one-child package, and
    after the merge it belongs to the survivor, who is linked to its parent.
- **`reassign_student_tenant`**: refuse while the child holds an active or pending one-child package ("Reassign, refund
  or cancel their package first"). Keep its 1 raw clock read.
- **Unchanged on purpose:**
  - the billing engine (D9);
  - `package_live_balances()`'s flag-off simulation (unreachable for one-child packages, by D9);
  - refunds (per package), extensions' per-package arithmetic, accounting, referrals;
  - `preview_package_price`;
  - the `package-emails` Edge Function (see §4).
- ⚠ RISK 2 MITIGATION (named prohibition): the migration must NOT call `package_backfill_draws()`, `draw_package_backlog()`
  or any UPDATE of `parent_packages.value_remaining`. It changes only rules, never balances. **Assertion on prod right
  after apply:** `sum(value_remaining)` over Little Orcas' packages equals the value read immediately before.

## 4. Surfaces (apps)

⚠ RISK 13 MITIGATION (step, done first). Census every client reader of package coverage:
`git grep -n "package_live_balances\|student_package_coverage\|from(\"parent_packages\")\|livePackages" -- SwimSyncAdmin SwimSyncApp ':!*database.types.ts'`.
Classify each hit as **family-level** (a family total stays correct: ParentsTable "family's prepaid balance", claims,
`moveStudentWarning`, `usePackageSettings`) or **per-child** (must filter by `student_id`). Record the table in the
commit message. These are known per-child hits the original plan missed:
- `SwimSyncAdmin/app/(admin)/makeups/domain/makeupRows.ts` `expiryWarningFor`: filter `livePackages` to packages usable
  by the kid. That needs `student_id` per package, read from `parent_packages` beside `package_live_balances`. Do not
  change that function's return type. **Assertion (vitest):** Ben's make-up after Ava's one-child package expires gives
  no warning (Ben is ad-hoc); Ava's gives the warning.
- `SwimSyncAdmin/lib/packageCoverage.ts`: the admin twin of the app's file. Same copy rule as the app's.

**Admin (`SwimSyncAdmin/app/(admin)/packages/`)**
- `ProductModal` / `useProductForm`: a "Who can use it" choice, *Shared across siblings* / *One child only*. The
  default is Shared.
- `ProductsTable` shows the kind, with a toggle to flip it (D6). It confirms with copy "Applies to new sales only —
  packages already sold keep their terms."
- `SaleModal` / `useSale`: when the product is one-child, a required child select listing the parent's active children
  at this business, auto-selected when there is one. Passes `student_id` to `insertPurchase` and `suggest_package_start`.
  ⚠ RISK 7 MITIGATION (step): a shared product sends `student_id: null`, never the selected child. The pure helper
  `saleStudentFor(product, childId)` is unit-tested for both kinds.
- `GenerateOffersModal` / `useGenerateOffers`: per-child rows (D8) labelled with the child, passing `p_student_id`.
  - ⚠ RISK 4 MITIGATION (step): rows are keyed `${parent_id}:${student_id ?? "family"}` everywhere: the React `key`,
    `candidates` state lookups, and the WhatsApp queue.
    **Assertion (vitest):** two rows for one parent (family + Ava) render, select and price independently.
  - ⚠ RISK 4 MITIGATION (step): a pure helper `offerStudentFor(row, product)` decides what to send:
    - a one-child product on a child row sends that child;
    - a shared product sends null;
    - a one-child product on a family row is not offered in that row's product picker.
    Unit-tested for all three.
  - ⚠ RISK 4 MITIGATION (step): `createPackageOffer`'s hand-written args type gains a REQUIRED `p_student_id: string | null`
    key, and `p_student_id` is added to `NULLABLE_RPC_ARGS` for `create_package_offer` and `suggest_package_start`
    (`check-db-overrides.sh` proves it). Keep the `Assert<Extends<…>>` beside the wrapper, so dropping the key is a
    compile error (§7.345).
- `HeldTable` / `PendingPanel`: show "Ava only" for a one-child package, via
  `students!student_id(full_name)` with `?.full_name ?? "One child"` (an embed can be null under RLS, §7.344). Add a
  **Change child** action (packages:edit) that calls `reassign_package_child`.
  - ⚠ RISK 10 MITIGATION (step): show the action for one-child, non-cancelled packages. The RPC is the authority on
    "unused", because a reversed draw restores the balance, so the balance cannot tell. Map its refusal to an inline
    error in the dialog ("A lesson has already drawn from this package — refund it instead"). Never let the action
    fail silently. **Assertion (vitest):** an RPC error renders that text.
- `PackageChip` copy: for a child covered by their own package, the count is theirs, not the family's. The number comes
  from coverage unchanged; only the label changes.

**Parent app (`SwimSyncApp/features/billing/`)**
- `PackagesTab` "Request & pay": the D7 picker for a one-child product. `insertPackageRequest` gains `student_id`.
  - ⚠ RISK 7 MITIGATION (step): the children listed are the parent's linked, active children at the product's tenant.
    With exactly one, show "For Ava" without asking. With zero, show inline "Add your child at this business first" and
    disable Request. A shared product sends `student_id: null`.
  - ⚠ RISK 8 MITIGATION (named prohibition): no `Alert.alert` anywhere in this flow (it is a no-op on RN-web). Errors go
    to inline text or the global Toast. Map the trigger's "Choose which child…" refusal to inline text.
- Package cards and **Show lessons used**: "For Ava only" on a one-child package. The name comes from the parent's own
  children list by `student_id`, not a bare embed (§7.344).
- `lib/packageCoverage.ts:63`: "shared across the family" only when the counted packages are shared. A child's own
  package reads, for example, "Package — 8 · Ava's own". Derive "own" by looking up coverage's `package_id` in the
  parent's package list, which now selects `student_id`.
- `/package/[token]` public page: unchanged. It returns no child names by rule, and its selects are explicit columns.

**Emails:** ⚠ RISK 8 MITIGATION (narrower scope / named prohibition): do NOT change `package-emails` in this plan. A git
push does not deploy an Edge Function, and §5 deploys none. File "name the child in package emails" in BACKLOG instead.

## 5. Build order

1. **Migration** on `db/single-child-packages` (root checkout): schema plus every function in §3. Bodies come from the
   DB (Step 0). Add a new pgTAP `supabase/tests/single_child_packages.test.sql`, clock pinned as its first statement
   (copy a pinned file's header, G1).
   - ⚠ RISK 12 MITIGATION (step): before writing, run `supabase test db` and record the pass count N₀ and the file
     count. **Assertion after:** every pre-existing file passes with an unchanged count, and the total is N₀ + the new
     cases. A smaller existing count means a test was lost.
   - ⚠ RISK 12 MITIGATION (step): mark every copied raw clock read `-- clock: stamp` in the new file before applying
     (§7.354). **Assertion:** the frozen census in `app_clock.test.sql` is green without edits.
   - ⚠ RISK 12 MITIGATION (assertion): `function_grants.test.sql` and `table_grants.test.sql` are green without edits,
     and `recurring_gotchas.test.sql` is green without allowlist edits.
   - ⚠ RISK 2 MITIGATION (step): apply with `supabase migration up`. Never `supabase db reset` while a sibling worktree
     is running. Then run the RISK 5 snapshot diff and the Step 0 body diff.
   - ⚠ RISK 2 MITIGATION (step): run `supabase/functions/generate-invoices/test.sh` **twice** (§7.15). The engine is
     unchanged, but its suites drive marking-time draws through the rewritten DB functions. **Assertion:** both runs
     show the same `N passed | 0 failed`.
   - Regenerate types in the same commit (`scripts/gen-db-types.sh`, root checkout, §7.350), then run
     `scripts/check-db-types.sh` and `scripts/check-db-overrides.sh`. Both apps' `npm run typecheck` must be clean in
     this commit, because a push to `main` builds them.
   - ⚠ RISK 12 MITIGATION (step): run every `repo-invariants` step from `.github/workflows/ci.yml` locally (§7.354),
     including `check-migration-clock.sh`, `check-pgtap-clock.sh`, `check-test-dates.sh`, `check-sept.sh` and the
     `cmp` of the two `database.types.ts`. **Assertion:** all exit 0.
   - The migration commit holds no app code.
2. **Admin app**: products, sale, offers (re-keyed), held/pending, Change child, and the make-ups warning; vitest. Work
   on a feature branch. ⚠ RISK 8 MITIGATION (named prohibition): do not merge it to `main` before the prod migration is
   verified (§5.6).
3. **Parent app**: picker, labels, coverage copy; jest. Same prohibition.
4. **UI driver** `verify-single-child-packages.mjs`, with fixture, teardown and `// clock: pinnable`, plus one pinned
   `--only` run. ⚠ RISK 11 MITIGATION (step): the driver asserts its preconditions as separate checks: Ava's package is
   active and in range, and Ben's lesson date is inside it. Only then does it check Ben's chip reads *Ad-hoc* and
   Ava's reads *Package*. Then re-run the existing package drivers one by one with `--only`:
   - `packages`, `packages-admin`, `package-draw-at-marking`, `package-renewal`, `referrals`, `accounting-packages`;
   - plus `makeups` and `trial-onboarding` (both touched by this plan).
   ⚠ Convention prohibition: do NOT start the full sweep (`run-all-drivers.sh` without `--only`) or the CI nightly
   unless the user asks for it. Restart `next dev` before the batch (§7.332). **Assertion:**
   `check-fixture-roundtrip.sh` and its `--now '2026-10-01 07:59+08'` form both pass with the new fixture.
5. **Docs gate:** PRD §7.16 (the pooling bullet, chip copy, purchase paths, Change child). BACKLOG: strike this item,
   and file *Name the child in package emails*. (*Remove the legacy package matcher* is already filed — BACKLOG
   Wave 9 item 9, 2026-10-10 — and removes D9's guard with it.) Record in HANDOVER that the B rollback now preflights for one-child packages.
6. **Deploy** via `/deploy`: migration → apps. No Edge Function changes.
   - ⚠ RISK 8 MITIGATION (step, order): (a) `supabase db push` the migration to prod. (b) Run the prod checks below.
     (c) Only then push the migration+types commit to `main`. (d) Then merge and push the admin and parent app commits
     (§7.60).
   - ⚠ RISK 2 MITIGATION (prod assertions, read-only via `scripts/prod-query-ro.sh`, each a bare command):
     - the columns exist;
     - `count(*) FROM package_products WHERE single_child` = 0;
     - `count(*) FROM parent_packages WHERE student_id IS NOT NULL` = 0;
     - Little Orcas' `sum(value_remaining)` is unchanged;
     - each rewritten function's prod md5 equals local;
     - `SELECT package_id, draw_rank FROM package_candidates_for(<a recent Little Orcas Ang-family session>, <that child>)`
       returns PKG-2026-0002 at rank 1 (or the expected empty set if already drawn), and runs without error.
   - ⚠ RISK 6 / 12 MITIGATION (step): take a remote grant dump after the push (§7.39, DEPLOYMENT §11.7). **Assertion:**
     anon has EXECUTE on none of the new or rewritten functions; authenticated has EXECUTE on `reassign_package_child`,
     `create_package_offer`, `suggest_package_start`, `package_renewal_candidates`, `student_package_coverage` and
     `assert_package_child`; and there is exactly one `pg_proc` row each for `create_package_offer` and
     `suggest_package_start`.
   - ⚠ RISK 8 MITIGATION (step): after each app deploy, grep the served bundle for a string only the new build has
     ("Who can use it" on admin, "Which child is this for?" on the app) (§7.31, §7.51). A 200 proves nothing.
   - ⚠ RISK 8 MITIGATION (named prohibition): do NOT flip any Little Orcas product to one-child, and do not tell the
     owner the feature is live, until BOTH bundle greps pass.

## 6. Tests that must exist (each proven red without its fix, §7.25)

⚠ RISK 11 MITIGATION (rule for every case below): each negative or "not X" case first asserts its precondition as its
own check (§7.330). The control is that the same lesson DOES draw when the package is shared, or that the package is
active, in range and has balance. Each red proof is run against the real local DB by reverting that one clause, and
the red run's own failure line is recorded in the commit message. A mutant that errors is not a red proof (§7.329).

- One-child package: its child draws, and a sibling's lesson is ad-hoc. Control: the sibling's lesson draws from an
  equivalent shared package. Then: no `package_applications` row for the sibling, and the balance is unchanged.
- D5: the child's own package draws before an earlier-expiring shared one. Precondition: both are candidates. Checked
  in all three places: the actual draw (`package_draw_for`), `package_backlog_preview`'s `funding_package_id`, and
  PK001's chosen package (a sibling's unmarked lesson within the shared package does not block Ava).
- `draw_rank` census: every caller of `package_candidates_for` that orders, orders by `draw_rank`.
- Insert refusals:
  - a one-child product without a child;
  - a shared product with a child;
  - a child not linked to the parent (as the parent, through RLS);
  - a child of another tenant;
  - a flag-off tenant.
  Plus the positive case: a parent's valid one-child request succeeds, which proves the helper grant.
- Pins: a parent's direct UPDATE of `student_id` fails; an admin's direct UPDATE fails; shared↔one-child via any role fails.
- A flag flip leaves held packages untouched (D2/D6), and confirming a pre-flip pending row still succeeds.
- `reassign_package_child`:
  - works while unused;
  - refused after one draw;
  - refused after a draw that was reversed;
  - refused for each wrong caller (coach, parent, other-tenant admin, view-only co-admin);
  - holiday extensions recomputed after reassign;
  - an audit row written.
- PK001: a sibling's earlier unmarked lesson does NOT block the one-child package's child. It still blocks for a shared
  package. The one-child package's OWN earlier unmarked lesson DOES block (the positive case, against fail-open). A
  mixed family, where a shared package is chosen for Ava and Ben holds his own, still counts Ben (pinned, accepted).
- The backlog dialog lists only the package child's lessons.
- Coverage: child A "Package · N", sibling B "Ad-hoc". Shared-only families are unchanged: the existing tests are green
  and the snapshot diff is empty.
- Renewal: a per-child row for a low one-child package; family rows unchanged; per-child `has_open_offer`;
  `create_package_offer` per-child refusal scoping; supersede scoped by child.
- Referral: no double discount across siblings. The same-child handoff still works, and the EXCLUDE constraint (if
  added) rejects a second live row with the same reward.
- `holiday_covering_package` picks the package that would have paid (own before shared).
- `book_trial` is no longer refused for a sibling of a one-child holder, and is still refused under a shared package.
- `merge_students` moves the package; `reassign_student_tenant` refuses.
- Tenant flag true→false is refused while a one-child package is held, and the edited B rollback raises its own
  preflight message.
- Exactly one `pg_proc` row for each signature-changed RPC; anon cannot execute any new function.

## 7. Known consequences (accepted)

- A one-child package's child unlinked from the parent stops drawing (the matcher still requires the parent link).
  The admin can reassign it if unused, or refund.
- Little Orcas' existing products stay shared until someone flips them (the owner, or the user on their behalf), and
  only after the §5.6 bundle greps pass.
- PK001 for a SHARED package still counts every sibling, including one who holds their own package. It can ask the
  coach to mark that sibling's earlier lesson first; that is self-resolving.
- While any one-child package is held, Wave 6's B rollback refuses with a preflight message. The packages must be
  refunded or cancelled first. This is D9's intent.

## Pre-commit gate

**Highest value — do not commit without these:**
- [ ] RISK 1: every caller orders by `draw_rank`. The census pgTAP is green and was shown red. D5 is proven in the draw,
  the preview and PK001.
- [ ] RISK 2: the PK001 positive case (own child's unmarked lesson blocks) passes. The RISK 5 snapshot diff and the
  Step 0 body diff are both empty. The Deno suite is green twice with identical counts.
- [ ] RISK 3: the referral double-discount pgTAP is green and was shown red.
- [ ] RISK 6: one `pg_proc` row per changed RPC; anon has EXECUTE on nothing new.
- [ ] RISK 8: app commits are not on `main` until the prod migration and prod assertions pass. No product flip until
  both bundle greps pass.

**Everything else:**
- [ ] Step 0: prod md5 = local md5 for every rewritten function, checked before writing.
- [ ] RISK 4: offers for two children of one parent both succeed. The admin rows are keyed per child, and
  `offerStudentFor` is unit-tested.
- [ ] RISK 5: coverage return columns unchanged, and `student_package_coverage.test.sql` green unedited.
- [ ] RISK 7: parent and admin direct UPDATEs of `student_id` refused. The parent's valid insert succeeds. Confirming a
  pre-flip pending row succeeds. No `current_user` in any DEFINER body.
- [ ] RISK 9: the B rollback preflight was rehearsed and raises its own message. This migration's DOWN file exists and
  refuses while one-child rows exist.
- [ ] RISK 10: reassign takes `FOR UPDATE` before its draw check, recomputes extensions, and its inline error renders.
- [ ] RISK 11: every negative case has its precondition check and a recorded red run.
- [ ] RISK 12: `supabase test db` gives N₀ + new with no existing count changed. The frozen clock census,
  `function_grants`, `table_grants` and `recurring_gotchas` are green unedited. Every `ci.yml` repo-invariants step
  exits 0 locally. Types are regenerated in the migration commit; `check-db-types.sh` and `check-db-overrides.sh` pass.
- [ ] RISK 13: the client census table is recorded. The make-ups warning test is green. Embeds use
  `students!student_id` with `?.` fallbacks, and the signed-in curl returns 200.
- [ ] RISK 14: the merge case is green and `merge_students`' RETURNS TABLE is unchanged.
- [ ] `--only` runs green for the new driver plus packages, packages-admin, package-draw-at-marking, package-renewal,
  referrals, accounting-packages, makeups and trial-onboarding. Both fixture-roundtrip forms green. No full sweep run.
- [ ] Remote grant dump taken after the prod push.

