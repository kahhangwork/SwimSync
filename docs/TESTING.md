# SwimSync — Test catalog and UI drivers (§5)

_Split out of `HANDOVER.md` on 2026-07-26. This is the **catalog**: what each suite covers
and which UI driver proves what. The **commands** for running them live in
`LOCAL_DEV_GUIDE.md`._

> **The test runner is the fact; the counts below are the hint.** Any number here is true
> as of the date beside it and drifts the moment a suite is added. `supabase test db`,
> `supabase/functions/generate-invoices/test.sh`, and `npm test` in each app are the
> authority.

> **The section numbers here are load-bearing.** They are cited by bare number
> (`§7.41`, `§6`) from **781 places** across this repo — including inside **applied
> migrations** and Playwright drivers, where they can never be corrected. So: items keep
> their numbers forever. Append new ones at the end, never renumber, never reuse a retired
> number, and strike a dead item in place rather than deleting it.


> **Resolving a section number you see cited anywhere:**
> §3 → `HANDOVER.md` · §5 → `docs/TESTING.md` · §6 → `docs/ARCHITECTURE.md` ·
> §7 → `docs/GOTCHAS.md` · §8 → `HANDOVER.md` (session log) · §9 → `HANDOVER.md` ·
> §10, §12 → `docs/ARCHITECTURE.md` · §11 → `docs/DEPLOYMENT.md`.
> A bare `§11.6`-style number inside a PRD sentence means the **PRD's** §11 (edge cases) —
> check which document the sentence is about before following it.

---

## 5. Running the tests

Backend integration tests run against the **local** stack (prereq:
`supabase start`) and are hermetic (self-seed + roll back / tear down). Frontend
tests are plain unit/component tests (no stack needed). All four suites — plus a
`tsc --noEmit` typecheck of **both** apps — run in CI on push/PR to `main`
(`.github/workflows/ci.yml`).

```bash
# Backend — Database tests (pgTAP): triggers, RLS, constraints, §11 edge cases
supabase test db                                  # 397 tests across 22 files

# Backend — Function tests (Deno): billing math, credit + package ledgers, emails
supabase/functions/generate-invoices/test.sh      # 108 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component + logic tests (vitest)
cd SwimSyncAdmin && npm test                       # 151 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 91 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (6) | one-invoice-per-parent-per-month, one active enrolment per student **PER CLASS** (plus the positive case — a second, non-overlapping class is allowed — and the overlap refusal; the old wording said "two active class enrolments" and would have gone on passing while describing a rule Wave 2 deleted, because the statement re-inserts the SAME class), positive-only credit applications, credit notes immutable to app roles — that last one asserts a **`42501`** now, not a silent zero-row UPDATE: since `20260804000600` the grant is gone as well as the policy, so the privilege check fails first (§7.88) |
| `credit_note_trigger.test.sql` (11) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson); **11.6** the correction leaves the original invoice intact (not modified/deleted) and the note links back to it |
| `rls_isolation.test.sql` (10) | RLS parent/parent isolation + superadmin sees all; **11.3** a parent sees all their children across coaches while each coach sees only students in their own classes |
| `edge_cases.test.sql` (9) | PRD §11: **11.2** a child created before assignment defaults to unassigned with an empty (not error) class view, **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |
| `tenant_isolation.test.sql` (24) | cross-tenant isolation across **two full tenants** — neither can see the other's families, classes, coaches, invoices, credit notes or attendance (§8.1) |
| `coach_wages.test.sql` (36) | effective-dated wage rates, the pay-decision table (§7.13), pro-rata duration maths, flat rates, draft→frozen payouts, and next-period adjustments carried **once** (see (c)) |
| `class_terms.test.sql` (14) | effective-dated class terms — a lesson priced and attributed by **its own date**, correct-vs-change, and the settled-money guard. Runs on **its own tenant** (see §7.26) |
| `active_inactive.test.sql` (20) | per-business active/inactive for families and children (§7.14), incl. the load-bearing one: **reactivating is not undone by the family having no active children** (§8) |
| `student_identity.test.sql` (9) | name + DOB identifies a child within a business; whitespace/case cannot defeat the expression index; NULL DOB is exempt (what made it safe on live data); `age` is gone |
| `student_tenant_pin.test.sql` (6) | a parent or admin **cannot move a child to another business** (§8a), while ordinary edits and the platform admin's RPC still work |
| `document_name_snapshot.test.sql` (7) | renaming a child does not rewrite an issued invoice or an immutable credit note; the note carries the name from the item it credits |
| `tenant_levels.test.sql` (9) | per-business level ladders: RLS is **enabled** (not merely written), cross-tenant writes refused, a student cannot take another business's level, deleting a level unlevels rather than deletes |
| `level_skills.test.sql` (11) | the skills taught at a level: order preserved, no duplicate skill within one level (ignoring case/whitespace), the tenant boundary, `CASCADE` on the level but `SET NULL` on the student, and the fix to the level-name constraint |
| `platform_overview.test.sql` (24) | the platform admin's overview RPCs: FOUR caller shapes get zero rows (anon-equivalent, parent, coach, **and a tenant admin — even for their own tenant**), counts never leak across the tenant boundary, and `last_attendance_date` is **NULL, not a date and not 0**, for a business that has never marked anything |
| `parent_address.test.sql` (8) | a family maintains their own address only; `postal_code` is TEXT so leading zeros survive; `profile_id` cannot be reassigned |
| `lesson_packages.test.sql` (30) | prepaid packages: RLS on all four tables, $0-rate/0-lesson products refused, product money terms immutable, request snapshots come from the PRODUCT (a parent cannot claim a price or an active status), only non-client roles move a balance, `package_live_balances()` draws locked-rate/in-scope/FIFO and leaves the stored balance alone |
| `tenant_provisioning.test.sql` (21) | creating a business: parent, coach, **tenant admin** and anon all REFUSED (each in an explicit transaction, 7.16) and `tenants` does not grow after any of them; slug derivation incl. a **non-ASCII name** that would otherwise violate NOT NULL; join-code shape + uniqueness; a fresh tenant reports `admin_status = none`. The two ACL assertions are near-vacuous locally by construction (7.39) |
| `package_corrections.test.sql` (12) | a correction on a package-funded line restores the package (even expired) and mints NO cash credit note; flip-flops refund at most once; ad-hoc lines keep the credit-note path byte-identical |
| `session_coach_roster.test.sql` (40) | Wave 3's roster, in the order the risks were ranked. **Mechanics:** `assign_session_coach()` resolve-or-creates the lesson row and is idempotent (twice ⇒ one row), the partial unique index holds one main, `set_session_main_coach()` swaps without a raw 23505, an off-pattern date is refused, and a **cross-tenant coach is refused with a REAL foreign id** — resolved as superuser on purpose, because fetching it under RLS returns NULL and the refusal would then be a null check proving nothing. **The substitute walk** (any single missing policy fails it): class row, session, enrolments, child, **trial guest, make-up guest, both guest children**, then writes attendance. **The gates that must stay shut:** `coach_serves_student()` is FALSE for a substitute and `set_students_active()` refuses them (the door decision 2 does not guard); a shadow reads and cannot mark; the class's own coach loses write while covered. **Pay:** three deliberately unequal rates give three different amounts on one lesson (equal ones would let the coach argument be ignored), the replaced coach is owed **nothing**, the 1-arg form still exists and delegates to the roster main (§7.123), and a lesson with no roster row still pays the class's own coach. **The money assertion:** a cover recorded after the month was PAID claws the replaced coach back and pays the substitute in a period they had no payout in — **carried once** across three re-runs and a later period (`SUM` per coach per session is exactly `0.00` and `50.00`). **Proven red by running the DOWN file**: 0 of 40 pass, the gates do not exist |
| `multi_class.test.sql` (16) | Wave 2's refusals: `book_makeup()` asks WHICH class is home once a child has two and snapshots the NAMED one (the money assertion — it prices the make-up line and decides package coverage), refuses **every** class the child is in as a host (the silent-void case: billing stays right, the make-up is worthless), and still derives silently for a one-class child; `close_student_enrolment()` closes one named class, refuses a NULL, leaves the other enrolments alone, keeps the child `assigned` until the LAST class goes, and — the discriminating one — refuses a coach who genuinely teaches the child but does **not** own the class being closed; the classes trigger refuses a clashing time move and ignores a non-schedule edit. **Proven red by running the DOWN file**: it dies at the fixture, because the two-enrolment state cannot be built without the migration |
| `student_package_coverage.test.sql` (21) | the per-child payment-method verdict: the **discriminating case** (a Private-package family's Group-only child is `ad_hoc`, not "10 left"), NULL-category covers all, an **inactive** enrolment never covers, the no-enrolment tenant-scoped fallback, date-expired active packages excluded **in SQL**, an **exhausted package is `package · 0`, never `ad_hoc`** (the affordability rule pinned OUT of the predicate by a `pg_proc`-source grep), **RLS parity** (parent-role verdict == admin-role verdict for the same child — the silent-mislabel catcher), sibling counts shared, a coach gets no package verdict at all, anon refused, and — since Wave 2 — a real **`'mixed'`** assertion (a child in a covered category AND an uncovered one) with its counter-case (two classes in the SAME category is one category, so `ad_hoc`, never `'mixed'`). That slot used to hold a pin asserting `one_active_enrolment_per_student` still existed, deliberately, so the day it was dropped would be loud; it worked — the index drop turned this file red on the first run |
| `student_claims.test.sql` (49) | parents claiming their own child: the disclosure surface (a surname-only overlap returns **nothing**; an unjoined tenant is **refused**, not handed an empty set; a claimed child is never a candidate; masking happens in SQL), the phone signal matching across `+65` vs 8 digits, the **tripwire** that a non-matching child is created exactly as before, Confirm **not** linking, the pending block **with a NULL dob on both sides** (fails on `=`), claim RLS both ways, approve auto-declining competing claims, the dob enrichment, **undo**, `list_student_claims()` seeing a parent `profiles_select` hides (§7.48), and the contract: a parent can no longer INSERT a student directly while the admin still can |
| `student_merge.test.sql` (20) | folding a duplicate into the row with the history: five refusals (cross-tenant, both-marked, **wrong direction**, invoiced duplicate, same row) each asserting `students` did not shrink; the move of parent links, trial bookings and settlements with **global counts unchanged** — a merge moves rows, never destroys them; and §7.46's guard, proved by **creating a cascading FK at runtime** and asserting the merge refuses |
| `trial_onboarding.test.sql` (32) | a child before their parent: THREE refusal shapes for `add_unclaimed_student()` (parent, cross-tenant coach, anon) each asserting `students` did not grow, the **tenant derived from the class** (nothing downstream would catch a wrong one — §7.42), `created_by` = the calling coach, a trial enrolment closed on its own date, **session idempotency** (two walk-ins on one date share ONE session — §7.43), the plain-English duplicate name+DOB error, settlement RLS, and `link_invited_parent()` incl. same-parent idempotency vs a different parent refused |

| `attendance_window.test.sql` (31) | the marking window as a RULE: a coach refused off-weekday, below the floor and in the future (each asserting `lesson_sessions` did not grow), `off_schedule_reason` unwritable by a client, the **seam** (`service_role` and `postgres` exempt — they build the past the rule is about), the FOUR upsert assertions of §7.57 incl. a mixed multi-row statement proving the existing row is **unchanged**, and `schedule_extra_lesson()` refused for parent / coach / cross-tenant admin, idempotent on a second call, and markable by the coach afterwards |
| `markable_floor.test.sql` (18) | the marking floor as `LEAST(calendar, month after the latest seal, else `created_at`)` — four tenants, one per state the function can be in, plus **assertion 8: the SAFETY PROPERTY over every tenant at once** (`markable_floor(t) <= session_window_start()`), which is the whole argument that the change can only ever widen the window and is the assertion to watch when editing it. Also `markable_floor(NULL)` = the calendar floor (both guards pass their tenant lookup straight through, so this is what an unresolvable class does — it must fail OPEN), tenant isolation (one business's seal must not move another's), the deadlock end to end (a coach inserts a session **and** attendance below the calendar floor as `authenticated`), and all three admin RPCs refused below the floor **and accepted above it** — both directions, because a floor that refuses everything would satisfy the refusals alone. Proven red two ways: 18/18 without the migration, 12/18 against a deliberately inverted `GREATEST` build |
| `payment_collection.test.sql` (10) | Phase 0 of fee-free payment collection: the **RISK 1 engine tripwire** (a service_role-shaped INSERT gets reference + token from the trigger — the assertion that goes red if the DEFINER hop is ever flattened), `INV-YYYY-NNNN` with the year from the invoice's **own billing_month** (§7.7) and per-tenant numbering (both tenants start 0001), the pin on `reference_number`/`public_token` against client writes while `reminded_at` deliberately stays admin-writable, parent RLS both sides (§7.59), and `next_invoice_ref` callable by nobody external (the anon layer is §7.39's remote dump, not asserted here) |
| `package_references.test.sql` (12) | `PKG-YYYY-NNNN` on `parent_packages` (20260809000100). **Assertion 1 is the file's reason to exist**: it inserts *as the parent role, supplying no `tenant_id`*, which is what the app actually sends — because the reference trigger must fire AFTER `trg_parent_package_lifecycle` (the one that fills `tenant_id` from the product) and Postgres decides that by ALPHABETICAL TRIGGER NAME. A test that inserted as admin would pass against a broken name and prove nothing. Also: the year comes from the row's own `requested_at` **in SGT**, asserted at the discriminating boundary (00:30 SGT on 1 Jan is still 2025 in UTC — the plan's own suggested case, 23:30 on 31 Dec, passes under the broken version); per-tenant numbering restarting at 0001; the counter NOT resetting per year; `LPAD` growing past 9999 (§7.77); a client-supplied reference DISCARDED on insert (a squatted number would break the next request on the unique constraint) and pinned against UPDATE; the trigger order re-asserted from `pg_trigger`; and `next_package_ref` callable by nobody |
| `function_grants.test.sql` (4) | **The general rule, asserted over `pg_proc` rather than over a list of names:** *no function in `public` grants EXECUTE to `anon`* — failures name the offenders. Written this way because every earlier grant assertion here pins ONE function, so none of them could fail for a function nobody thought to name, which is exactly how `next_credit_note_ref` sat on the bare `PUBLIC` default with an unauthenticated write path (§7.82). Plus all three reference counters pinned callable-by-**nobody** (`next_credit_note_ref`, `next_invoice_ref`, `next_package_ref`). Catches the LOCAL half only; the cloud half is still §7.39's remote dump |
| `audit_log_tenant.test.sql` (8) | every audit row knows its business: the stamp follows the **entity** across a tenant boundary (a `Student` row takes the student's business, not the actor's), `lesson_session` resolves through its class, a **supplied `tenant_id` is overwritten** by the derived one, an unknown `entity_type` **RAISES** rather than writing an invisible row, a writer that sets no `tenant_id` (`schedule_extra_lesson`) comes out stamped anyway, and the narrowed INSERT policy **both ways** — a coach may audit a session they own and may **not** fabricate a row about a student |
| `students_audit.test.sql` (11) | the `students` audit trigger (`20260809000200`). **The "still succeeds" half is the point** — this trigger's failure mode is not a missing audit row, it is a REFUSED STUDENT EDIT, so every write here is made as the role that actually makes it: a test that only writes as `postgres` passes against the broken build, because the owner is exempt from the policy the bug trips over. Assertion 1 (the admin level picker) dies with **42501** the moment the function is `ALTER`ed to `SECURITY INVOKER`, taking the whole transaction and assertions 2–11 with it — which is the honest picture of that bug: not one broken screen, every student edit in the product. Assertions 9–10 (a `postgres` and a `service_role` UPDATE with no JWT) die with **23502** if the NULL-actor guard is removed, which is what would fail the next data-fix migration against production. Also: the parent's own edit-child path asserted separately from the admin's (§7.86 — different RLS route), `to_jsonb(OLD)` carrying **what the phone number used to be**, `tenant_id` arriving from `set_audit_log_tenant`'s derivation rather than from the trigger, and a no-op UPDATE recording nothing |
| `class_deactivation.test.sql` (23) | retiring a class (`20260809000300`) — `deactivate_class()` / `reactivate_class()` and the `class_unmarked_lesson_dates()` helper. **Every refusal is tested in BOTH directions, and that is the file's structure, not padding**: a guard that refuses everything satisfies all three refusal assertions on its own (`markable_floor.test.sql` is the precedent). Each of the three was proven red by **breaking it in the database and re-running** — enrolment refusal rewritten as `WHERE is_active` (§7.66) kills assertion 5, dropping the `makeup_bookings` arm kills 9, deleting refusal 3 kills 11. Two assertions had to be re-aimed to get there and the reasons are §7.111 and §7.112: assertion 5's fixture enrolment spans **exactly one marked date**, because a wider span let refusal 3 do the refusing and the §7.66 bug went undetected; and the cross-tenant assertion targets the **already-retired** class, because pointed at an enrolled one it went green from the enrolment refusal's own `P0001`. Assertion 2 pins the deliberate decision that an **EMPTY class IS retired** (§7.17 — all three refusals are "nothing went wrong" negatives). Assertions 14–15 reach the helper's enrolment and make-up arms directly, since neither is reachable through `deactivate_class()` once refusals 1 and 2 have passed. Also: `deactivated_at` recorded and cleared, a second press NOT moving it (it is what the engine bills against), and `reactivate_class()` tenant-scoped — its only barrier, since it has no refusals |
| `booking_class_active.test.sql` (14) | nothing new can be put into a RETIRED class (`20260810000100`) — `book_trial()` and `schedule_extra_lesson()` refuse one, plus the `classes` CHECK that makes `deactivate_class()` the only way to retire. **Every refusal is paired with a `lives_ok` on the same subject after `reactivate_class()`**, because `book_trial()` carries six other refusals and `throws_ok(…, 'P0001', NULL, …)` matches any of them (§7.112); the message is asserted, and assertions 1–2 pin that the subject date is above the floor and IS the class's weekday, so neither of those guards can be what fires. The fixture retires its subjects through `deactivate_class()` rather than a raw UPDATE — the product's own path, and the only one the new constraint permits. **The measured sabotage signature is in the file header** (red: 4, 5, 7, 8, 10, 11, 13; green: 6, 9, 12, 14) so a change producing a different set is visibly not this change. The trial partner books **one week later** on purpose: on a sabotage run the refusal does not fire, the call succeeds, and an identical re-run dies on `trial_bookings_live_slot_uniq` instead of passing — §7.117 |
| `parent_link_forgery.test.sql` (9) | the two forged links closed by `20260804000500`, reproduced as HTTP 201/201/200 before the fix: a self-registered **stranger** cannot insert their own `parent_tenants` row naming an arbitrary business (so the `join_code` stays invisible), cannot attach themselves to an arbitrary child, and therefore cannot modify that child — `students_update` is untouched and correct, it was ownership that was forgeable (§7.86). Assertion 1 is the positive control that makes a silently-superuser run visible (§7.16); 7–9 are the **green guard** that the join code and Add Child still work, because the failure this file must not hide is an onboarding outage |
| `table_grants.test.sql` (6) | the standing invariant behind `20260804000600`, over `pg_class`/`pg_policies` so a table added next month is covered on the day it is created: `authenticated` holds a table privilege **if and only if** a policy could permit it (both directions, failures named), no TRUNCATE/REFERENCES/TRIGGER anywhere, `anon` holds nothing, no postgres-owned default privilege names either role, and nothing escapes the invariant's reach (views/partitions/foreign tables, plus **column-level** ACLs, which `has_table_privilege()` cannot see and a table-level REVOKE does not remove). **Scoped to `authenticated` + `anon` deliberately** — it is false for `service_role` (bypasses RLS) and meaningless for `postgres` (owns the tables), and a test that is red against a correct database gets disabled (§7.87). Excludes extension-owned relations, or pgTAP's own views fail it inside its own harness |
| `stranger_isolation.test.sql` (4) | the persona no other isolation file covers — a self-registered parent belonging to **nothing**, which is what an attacker is, since signup is open. Sweeps **all 37 tables at once** and asserts they see only their own `profiles` and `parents` row; assertion 1 pins what a real member sees across 15 tables so "sees nothing" can never pass vacuously, assertion 3 proves the sweep covered every table rather than a subset, and assertion 4 proves the one profile they read is *theirs*. One forged link takes it red naming **six** tables, two of which were not on the list when it was written — which is the argument for sweeping rather than naming |
| `admin_management.test.sql` (38) | co-admins (`20260806000100`): the **first** tenant_admin claims `tenants.owner_profile_id` (per tenant, a later one never steals it) and a plain empty-metadata parent signup still works — the control that matters, since `handle_new_user` fires on **every** signup; the escalation guards (`role` / `tenant_id` / `admin_disabled_at` / `owner_profile_id` unwritable by a client while `full_name` stays editable — without them assertion 6's self-promotion **lands**, and 13 assertions fall over downstream of the corruption); deactivation through the one `is_tenant_admin()` clause (writes 0 rows, `audit_log` dark) while a coach-admin's `current_coach_id()` survives, **plus the deliberate residue pinned as chosen**: membership reads via `current_tenant_id()` persist (the ban that ends them is auth-layer, covered by `verify-admins.mjs`); the four owner-gated RPCs (owner-immune, tenant-scoped, deactivate/reactivate **idempotent** because the API route's retry is the recovery for a half-failed ban pair); `prepare_admin_delete` refusing coach-admins and referenced admins via the **catalogue-derived** reference map (pinned to see `students.created_by` — a column the first hardcoded draft missed), purging the target's audit rows and writing an owner-attributed `admin_deleted` row whose `tenant_id` proves the `'Profile'` derivation arm; anon EXECUTE on none of the four; the overview reporting the **owner column**, not the oldest admin |
| `owner_transfer.test.sql` (27) | owner transfer (`20260813000100`) — the platform-admin-only gate on **both** RPCs: every other role (owner included — no self-service, by decision) refused with the message **pinned**, and the dropdown feed returns them 0 rows; the transfer moves `owner_profile_id`, audited through the new `'Tenant'` arm (the INSERT reaching the table at all proves the arm — the ELSE RAISES, §7.37) with an idempotent re-run writing no second row; refused targets (cross-tenant, deactivated, non-admin, unknown tenant); the **lost-owner** NULL column recovering through the same RPC; `platform_tenant_overview()` following the column (the same keying `resend-invite` uses); anon EXECUTE on neither. Four measured sabotages recorded in the header; the gate probes for the remaining roles are APPENDED (25–27) so the sabotage records' assertion numbers stay true |
| `unbilled_sealed_lessons.test.sql` (18) | the Wave 4 orphan-lesson report (`20260812000400`) — billable attendance inside a SEALED month that no `invoice_items` row covers and no live settlement clears. The fixture seals **last month**, deliberately inside §8.32's reopened marking window (the real trigger shape: July billed on 2 August, July still recordable). Every WHERE clause is pinned by an assertion a targeted sabotage turns red — **seven sabotages, each measured**: drop the billable-status filter, make the seal check tenant-blind or month-blind, match invoices per-student instead of per-(student, lesson), ignore invoices entirely, ignore settlements, demote the authorisation RAISE to a NOTICE. The per-(student, lesson) case is the one that matters most: a child billed for the month who gained ONE extra lesson afterwards reports that lesson alone. Settlement coverage in three acts — full clear, **partial** (`settled_through` mid-range leaves the later lesson reporting), and reversal restoring both. Grants: `authenticated` EXECUTE, `anon` none |
| `coach_disable.test.sql` (55) | disable a coach (`20260813000200`, Wave 5 chunk 2) — the gate on both RPCs (coach, parent, CROSS-TENANT admin, disabled coach's self-rescue, all messages **pinned** — probe ids come from a `GRANT`ed temp table, §7.147); pre-write refusals naming only ACTIVE classes; the sole-owner-coach guard (extension-rows-decided, tenant B's owner is its only coach); THE DISABLE by a co-admin with the previous month sealed (⚠ RISK 7a — the normal arrears state): effective-dated `class_rates` handover, retired class untouched, shadow rows END-DATED by the actor, future substitute overrides deleted with past kept, audit through the new `'Coach'` arm, idempotent re-run rowless; authority dark (helper NULL, 0 classes/lessons, attendance refused) **with the `current_tenant_id()` residue pinned as EXPECTED** (⚠ RISK 5 — ban enforces); the guard's load-bearing case (a disabled coach's own `UPDATE` clearing `disabled_at`, proven red by dropping the trigger); ⚠ RISK 8 (replacement cannot mark the override lesson, admin can, month completes); July payroll still paying the disabled coach's taught lesson; admin-who-coaches keeping their admin half and reactivating their own coach half; reactivation taking no refusals and NOT handing classes back; ⚠ RISK 7b (a PAID current-month payout aborts ATOMICALLY — nothing moved, no audit row); the staff-shape invariant chunk 3's bulk ban leans on; anon EXECUTE none. **Five measured sabotages in the header** |
**Total: 835 across 43 files** — verified by `supabase test db` 2026-08-13 (the previous
"total" line here had been stale for several sessions while §3 was right; per §7.37,
the command is the fact and this sentence is the hint). If you add a suite, add a row.

_Deno tests (run by `generate-invoices/test.sh`, which also carries
`../package-emails/email.test.ts` and `../public-invoice/core.test.ts` — the latter
pins the public serializer's EXACT key set, first-names-only students, uniform
null-for-every-failure, and claim idempotency against the local stack):_
**The clock is part of every fixture** — `monthEnded()` in `test-helpers.ts` supplies the
billing month, an instant at which it is billable, and an early-enough enrolment as ONE fact,
and `newScenario()` **throws** on a scenario expecting zero lessons (§7.33). The
completed-month guard is pinned by five tests including the SGT boundary (23:59 on 31 Jul
refuses July; 00:00 on 1 Aug allows it) and the year rollover. **Engine**
(`core.test.ts`): billable-only summing, paid vs free trial, no double-billing, the
auto/manual completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, **11.7** credit-exceeds-invoice
carry-forward (+ ledger invariants via `checkInvariants`), plus `result.created` shape and
two **stack-backed invoice-email orchestration** tests (recipients resolved from the DB;
no-op without a key). **Email** (`email.test.ts`): pure HTML builder + `sendInvoiceEmail`
(no-op without key, mocked-fetch success/failure, HTML escaping). **Dates**
(`dates.test.ts`, 5): `previousBillingMonth`/`dateInTimeZone` — the SGT day-boundary
regression (1 Aug 00:30 SGT bills July, **fails on the old UTC path**), year rollover, and
the `APP_TIMEZONE` seam (UTC vs SGT diverge at the boundary).

_Also in `core.test.ts` (added §8a):_ **multi-class** (one parent, two children, two
classes → ONE invoice with both classes' items; the credit case proving credit draws
against the *combined* gross), **auto-mode deferral** and its recovery, the **hard block**
(unmarked attendance stops both auto and manual; marking it *cancelled* clears it), the
**run day** (before/on/after, manual ignores it, SGT decides the day), **sealing** (a
manual run that finishes the month seals it; a forced run on an incomplete month seals
nothing; sealing twice is a no-op), and **billing-vs-enrolment** (a child unenrolled
mid-month is still billed for what they attended; unenrolling clears the block they caused).

_Also in the Deno suite (added 2026-07-20):_ **`packages.test.ts`** (10) — the
no-package TRIPWIRE (a parent with no package produces the pre-package invoice,
byte-for-byte), locked-rate coverage both ways, chronological exhaustion cutover,
FIFO-by-expiry, the expiry boundary ON `expires_on`, coverage starting at confirmation,
category scope, package-then-credit precedence, and the ⚠RISK-4 pin:
`package_live_balances()`'s prediction equals the engine's settled result, and the
fault-injection test (a failed ledger write holds the month open). All verified
failing on the pre-package engine or a mutated flag. Plus **`../package-emails/email.test.ts`**
(7) — purchase-email builders (escaping, no-key no-op), run by the same `test.sh`.

_Also in the Deno suite (added 2026-08-09):_ **`classDeactivation.test.ts`** (5) —
`classes.is_active` means scheduling, never billing. The file's shape is two
assertions pulling in **opposite directions**, and both are needed: a retired class
with nothing recorded must NOT block (§7.109's deadlock), and a lesson unmarked
*before* it was retired must STILL block (the permanent underbill). Proven red **both
ways** — a naive `.eq("is_active", true)` deletion fails the first pair, a blanket
exemption instead of a `deactivated_at` date clamp fails the second. Also: a class
retired at month end still bills what it taught (the BACKLOG item's actual complaint),
dates after deactivation not expected, and — since 2026-08-10 — the legacy row
(inactive, no date) asserted as **unconstructible** rather than as an engine behaviour:
`classes_inactive_requires_deactivated_at` refuses that shape, so the case now proves the
UPDATE raises `23514` and the class is untouched. **`service_role` does not bypass a CHECK
constraint** (§7.116), and the old version performed the same write without checking its
error, so it would have gone on believing the class was retired. **No `completeMonth()` in the two gate
cases, deliberately** — §7.111: it satisfies the gate under test and both cases were
vacuous until the call was removed.

_And (added 2026-08-10):_ **`guestOnlyClass.test.ts`** (4) — the unmarked-booking
underbill. A class with no ACTIVE enrolments but an unmarked trial or make-up booking was
skipped by both of `core.ts`'s early guards, so the guest was neither billed nor blocking
and any other class billing **sealed** the month over them. **Only cases 1 and 2 are
evidence the bug existed** (proven red by reverting both guards; case 1 fails with
`sealed === true`, which is the bug itself). Cases 3 and 4 pass without the fix and that is
correct: 3 is the counterweight — an entirely empty class must still not block, the
mirror-image failure WAVE_1_PLAN ranked first overall — and 4 pins that a MARKED guest
still bills, which a naive "widen `billableStudentIds`" fix would have put at risk. Do not
"strengthen" 3 or 4 into failing cases. Case 1 uses `completeMonth()` on the **other**
class deliberately: without it that class blocks too and `sealed === false` would be true
whatever the guest class did (§7.111 applies only to the class under test).

_PRD §11 edge cases are now all individually tested_ — 11.1 & 11.7 (Deno),
11.2/11.4/11.5/11.8 (`edge_cases`), 11.3 (`rls_isolation`), 11.6 (`credit_note_trigger`).

_Frontend tests:_
`SwimSyncAdmin` uses **vitest** + Testing Library (`vitest.config.ts`) — **22 files, 299
tests** (2026-08-11; the runner is the fact, this number is a hint that drifts). Wave 5
chunk 2 added `lib/coachDisableImpact.test.ts` — the disable dialog's ⚠ RISK 8 list
(unmarked override-carrying lessons up to TODAY, future ones excluded because the RPC
deletes their overrides), reusing the shared completeness rule so guests count as expected
(§7.18); proven red by removing the future clamp and by blinding it to bookings. Wave 4 added
`lib/settlementPayload.test.ts` — the settlement INSERT payload, extracted so the unclaimed
modal and the orphan-lesson report build it through ONE function; it pins the DB CHECK
`settlement_amount_matches_kind` client-side (paid_outside carries the amount, written_off
strips it even when one was passed) and that `settled_through` is the line's latest lesson
passed through untouched. Proven red by sabotaging the builder. Wave 3 added
`lib/sessionRoster.test.ts` and `lib/payoutItems.test.ts` — the two pure modules behind the
Lesson Coaches page and the Coach Wages breakdown, which **disagree on purpose**: the roster
module resolves access and uses `classes.coach_id`, the payout module resolves money and never
mentions it. Earlier: the eleven above plus `lib/tableSort.test.ts`,
`lib/studentCounts.test.ts`, `components/Table.test.tsx` extended for sorting, and the
payment-method pair `lib/packageCoverage.test.ts` + `components/PackageChip.test.tsx`
(the null-input fail-safe, the never-flag-ad-hoc and exhausted-is-low rules of
`isRunningLow`, the family-grain expiry filter, and the chip's three states incl.
"Package · 0 left" tinted, never "Ad-hoc").
`tableSort.test.ts` includes a case that runs in **four timezones**, pinning that sorting
never constructs a `Date` (§7.7 by construction). `studentCounts.test.ts` has one named for
the bug it prevents — *"NEVER says nobody when only inactive children hold the level"*
(§7.69). `Table.test.tsx` gained sortable-header render tests (click, reverse, `firstDir`,
`aria-sort`, non-sortable columns) plus width assertions, and keeps its `<Thead>`-owns-its-
`<tr>` call-site scan.
`SwimSyncApp` uses **jest-expo** (`jest.config.js`) — **19 files, 348 tests** (2026-08-11).
Wave 3 added `lib/coachRoster.test.ts` (+23, pure role resolution: main / shadow / covered /
mine) and `lib/payoutBreakdown.test.ts` (+17, lessons vs corrections — a clawback-only line is
not a lesson taught). Historically **14 files, 188 tests**, scoped to
`lib/**` unit tests: `attendanceBulk`, `attendanceCompleteness`, `attendancePayload`,
`attendanceRoster`, `attendanceSession`, `attendanceSummary`, `attendanceWindow`,
`authErrors`, `claimCandidates`, `invoiceFunding` (which invoice lines a package funded —
a **reversed** draw is not funding, and garbage input yields no tags, never a crash),
`landing`, `lessonDates`, `packageCoverage` (the
mapper's fail-safe and `describeCoverage`'s exact Balances-line copy), `timeOfDay`. Deeper
component-render tests (RN screens with mocked Supabase, admin tables) are the natural next
additions.

Four of the app's suites exist because of bugs that reached production on 2026-07-26, and
what each one *pins* is the point:
- **`timeOfDay`** — `nowMinutesInSg()` returns the same number under four process
  timezones. 12 of its 21 assertions fail against the `getHours()` expression it replaced
  (§7.7).
- **`attendanceSession`** — a session id is inseparable from the date it was resolved for;
  anything else is `stale` and must be re-resolved (§7.64).
- **`attendancePayload`** — every row of an upsert carries an identical key set, and
  `hasUniformKeys()` catches the exact body shape that broke (§7.67).
- **`attendanceSummary`** — an empty roster is `no-students`, never `complete`, and only
  `complete` may quieten the Mark Attendance button. One test enumerates the whole state
  union, so **adding a state fails it** until someone decides where it belongs (§7.68).
- **`attendanceCompleteness`** also now pins the *opposite* rule deliberately: an empty
  expected set IS vacuously marked, because invoicing depends on it. The comment above that
  test explains why not to "fix" it.

> *This list had gone stale by six files before 2026-07-26 — it named five admin suites
> when eleven existed. Per §7.37 the runner is the fact and this paragraph is the hint:
> `find components lib -name "*.test.ts*"` in either app is the answer.*

_Note:_ both apps now **typecheck clean** and CI enforces it — a **Typecheck (tsc)**
step runs `tsc --noEmit` for `SwimSyncApp` and `SwimSyncAdmin` in the `frontend-tests`
matrix (§8d). The app's 5 long-standing `tsc` errors in
`app/(parent)/home/child/[id].tsx` (Supabase join typing) were cleared with an `any`
cast. Run `npm run typecheck` in either app locally — but see §7.11: a local pass can
still be a CI fail because the Next/Expo type stubs it leans on are git-ignored.

> **Every fixture has a `-teardown.sql`, and CI enforces it** (2026-07-26). `fixtures-*.sql`
> seed the **one** local database that every worktree shares, and `/session-close` forbids
> `supabase db reset` as the cleanup — so a fixture without a teardown leaves a session no
> safe way to clean up. `drivers/check-teardowns.sh` fails the build if a new fixture arrives
> without one; run it locally any time. Each teardown ends with a SELECT printing **0** for
> what it removed and **1** for each seed identity that had to survive — read that output.
>
> **Every fixture is now LOADED by CI too** (2026-08-01), by
> `drivers/check-fixture-roundtrip.sh` — a step in `backend-tests`, which already boots a
> Supabase stack. It runs **two passes**:
>
> - **Pass 1, isolated** — snapshot every base-table row count in `public`/`auth`/`storage`,
>   apply the fixture with **`ON_ERROR_STOP=1`**, apply its teardown, assert the counts came
>   back identical. This is the round-trip from `docs/WORKTREES.md` Phase 4, automated.
> - **Pass 2, stacked** — apply all 14 in sequence *without* tearing down between them, then
>   unwind in reverse. Each fixture's per-table footprint is compared against its isolated
>   one: a fixture that touches only its own rows behaves identically on top of thirteen
>   siblings, so **a divergence is §7.63's signature** and fails the build.
>
> **`ON_ERROR_STOP=1` is the load-bearing part.** Measured 2026-08-01 by re-introducing
> §7.62 (dropping `tenant_id` from a fixture's insert): plain `psql` **exits 0**, buries one
> `ERROR` line in its output, and creates **1 of 3** students. The fixture half-loads, the
> driver then scores low, and the low score reads as a *product* regression. With
> `ON_ERROR_STOP=1` it exits 1 and names the constraint. Re-introducing §7.63's unscoped
> `CROSS JOIN` reproduced its documented second-order failure — the
> `one_active_enrolment_per_student` violation that means the fixture's **own** children
> never enrol. Both detectors were proven to fail without the fix (§7.25) before shipping.
>
> Run it locally any time (the stack must be up); it restores what it found, so it is safe
> beside a sibling worktree. `--only <name>` checks one fixture, `--isolated-only` skips
> pass 2.
>
> **Two rules for writing a new fixture, both learned by this check refusing to run:**
> 1. **It must load against a bare seeded database.** `fixtures-phase4-billing.sql` used to
>    `RAISE` unless a human had registered its parent through a browser first, which made it
>    the one fixture nothing automated could ever check. A fixture that needs an account
>    seeds it itself (insert `auth.users`; `handle_new_user` fans out to profiles/parents),
>    guarded by an existence test **on the email**, since a UI registration mints a random id.
> 2. **Scope every write to rows you own** (§7.63), and never reach for an unordered
>    `LIMIT 1` (§7.73). If a fixture genuinely must write beyond its own rows, declare it with
>    `-- roundtrip-exempt: cross-fixture-writes — <why>` and make the teardown compensate; the
>    declaration is echoed on every run and exempts pass 2 only, never pass 1. **Nothing
>    declares it today.** The one fixture that did — `fixtures-trial-onboarding.sql`, which
>    marks every child enrolled in its class to build a *complete* month — stopped needing it
>    on 2026-08-01 by owning its class instead of borrowing one. Prefer that fix: an exemption
>    is a compensated hazard, and this one broke CI before it was removed (§7.73).

> **Every driver runs NIGHTLY in CI as of 2026-08-05** (`.github/workflows/ui-drivers.yml`,
> 04:00 SGT daily + a manual Run-workflow button), via
> `drivers/run-all-drivers.sh` — which is also the way to run the whole set locally.
> The protocol per driver is uniform, deliberately: `supabase db reset` → kong restart
> (§7.44) → load its fixture → run it under a hard timeout. The next reset is the cleanup,
> so teardowns are not run — which is why this must NEVER run beside a sibling worktree
> (§7.55). Exceptions and the fixture map live in the script header. On failure the
> workflow updates ONE rolling `ui-driver-rot` issue (green closes it); triage rule:
> product changed → real regression; driver/calendar assumption moved (§7.73) → fix the
> driver. Its first full sweep found and repaired SEVEN rotted drivers and one flake —
> none of them a product bug.

_UI drivers (`.claude/skills/run-ui-playwright/drivers/`, each also runnable by hand):_
`verify-unmarked-lessons.mjs` + `fixtures-unmarked-lessons.sql` drive the whole
unmarked-lesson loop (admin gap report → coach backlog → mark → both go green);
`verify-parent-attendance.mjs` covers the parent Attendance screen — chip geometry read
from the DOM, plus all three empty states (unassigned / nothing marked / filtered out);
`verify-tz-saturday.mjs` pins the SGT-vs-UTC regression (§7.7) using Playwright's clock
API — it **fails on the pre-fix code**, which is the point. **5 checks**, needing only
seed data and no fixture: pinned to 2026-07-18 07:30 SGT (= Friday 23:30 **UTC**), it
asserts the header, the class list *and* the date the attendance screen actually targets,
because the list can be right while the target is wrong — and that disagreement *is* the
bug. Hardened 2026-08-03 after a bad heuristic wrongly filed it as assertion-less: it now
carries `detail` on every check, records a crash as a **failed check**, closes the browser
in `finally`, and **exits non-zero on a run that asserted nothing**. All three guards
proven by mutation;
`smoke-admin-screens.mjs` drives the admin attendance/students/dashboard pages at
runtime (checks the deep joins resolve — no NaN, no empty tables);
`verify-bulk-setall.mjs` (+ reuses `fixtures-unmarked-lessons.sql`) drives the bulk
"Set all" menu — the RN-web dropdown renders, the confirm guard fires only when a student
is already marked, and a bulk save persists `cancelled_rain` to the DB;
`verify-class-edit.mjs` drives the admin Classes page — the create form no longer defaults
the day (required choice) and an existing class edits Saturday→Sunday and persists;
`verify-packages.mjs` (+ `fixtures-packages.sql`) drives prepaid packages across both
UIs — the parent card shows the LIVE count (9 of 10, the un-invoiced lesson already
subtracted), request → PayNow (the requested package's price, not the held one's) →
pending → admin confirm → Active, the students "running low" filter obeys its
per-tenant threshold in both directions, and the **payment-method chip is asserted BY
NAME on the discriminating siblings** (§7.75): Pablo (Group class, covered) wears
"Package · 9 left" on the parent home / "· 14 left" on the admin Students row after the
second purchase, while Pia (Private-only, same family) wears "Ad-hoc" on both — the pair
the old by-parent sum labelled identically — plus the child profile's family-shared
Balances line, and — since 2026-08-09 — that the package's PayNow screen carries its
`PKG-YYYY-NNNN` reference (22 checks);
`verify-class-deactivation.mjs` (+ `fixtures-class-deactivation.sql` and its
`-teardown.sql`) — **21 checks, and check 7 is a DEPLOY GATE, not a regression test.**
§7.109's whole mitigation is that the retire → reload → restore round trip completes
**through the UI alone, touching no SQL**; if it cannot be made green, the engine change
must not ship, because the alternative is a month blocking on a class nobody can see.
Proven red by restoring `loadClasses()`'s `.eq("is_active", true)` — it fails on exactly
that check. Check 3 is the §7.28 control (a **known-ACTIVE** class carries no *Retired*
badge): assert only on the retired one and a page that badges everything passes. Checks
8–11 drive both refusals and assert the message NAMES the child or the guest, plus that
nothing was written. Its fixture uses `ON CONFLICT DO UPDATE` to reset `is_active` /
`deactivated_at` — §7.113, learned when a sabotage run died mid-way and the next run
blamed the fixture. Three consecutive clean runs.

`verify-paynow-fallback.mjs` (+ `fixtures-paynow-fallback.sql` and its `-teardown.sql`)
drives the PayNow chain through **all three states a business can be in** (21 checks), and
exists because before it **nothing in either test suite and no other driver touched
`app/(coach)/settings`** — the only writer of `tenants.paynow_qr_url` anywhere in
the product. It flips the seed tenant's `paynow_uen`/`paynow_mobile`/`paynow_qr_url`
between cases and **restores them in a `finally`** (plus again in its teardown), because
those are rows it does not own. **Case B is the one that earns the file**: a
stored-but-UNENCODABLE mobile — `912345678`, nine digits, which `normalizeSgPhone` saves
without complaint because it only strips non-digits and `checkSgPhone` never blocks. There
`selectPayNowProxy` says *configured* while `buildPayNowPayload` throws, so a gate of the
form "hide the upload when a proxy exists" would leave that business with **no way to be
paid at all**. Asserted from both sides: the parent still gets a payable PayNow ID, amount
and reference rather than a grey placeholder, and the coach can still reach the upload.
Proven red both ways (§7.25): restoring the `packageId` early return turned 7 checks red,
and applying the naive `hasPaynowId` hide turned the disclosure check red;
`verify-tenant-provisioning.mjs` drives creating a business end to end across the platform
panel and a second browser context - mismatched confirmation email refused, join code shown,
the delivery outcome stated explicitly, `invited` -> accept -> **the new admin signs in** ->
`active` (15 checks; the sign-in is the load-bearing one, per 7.19);
`verify-invoice-controls.mjs` drives the admin invoice controls — it MEASURES the toggle's
track and knob rects from the DOM (§7.34) in both states and asserts the knob stays inside the
track, that a click round-trips through the DB, and that the billing month defaults to and is
capped at the last completed month;
`verify-trial-onboarding.mjs` (+ `fixtures-trial-onboarding.sql`) drives the case of a
**billable lesson with nobody to bill** (10 checks): generation names the unclaimed child,
explains it as a *missing parent account* rather than unmarked attendance, offers the settle
actions inline, and **does not seal the month** — sealing would strand those lessons the
moment the parent finally registered, the permanent-underbill shape of §7.8/§7.13/§7.32.
It refuses to run at all (**exit 1**) when its fixture is absent, rather than scoring on an
empty database — §7.62's lesson applied at the driver.
> **Rewritten 2026-08-01 after a week broken, and how it broke is the lesson.** It used to
> open by adding a walk-in through the coach's attendance screen; `912bd11` deleted that
> control **two hours after the driver was written**, when a trial became a booking the admin
> arranges ahead of time. From then it failed check 1 and then *crashed* on the tap, so the
> six billing checks behind it were unreachable and it guarded nothing. The repair was to
> change the **subject** — every surviving assertion now points at the fixture's
> `Fixture Walkin` and reaches the screens by URL — not to rebuild a deleted flow. Two checks
> were dropped deliberately, and the reasoning is in the driver's own header.
> Its roster check is **defence in depth** (the walk-in arrives via either the
> both-ends-inclusive enrolment span or the attendance union), so one regression will not turn
> it red; `lib/attendanceRoster.test.ts` pins the two mechanisms separately;

`verify-payment-collection.mjs` (+ `fixtures-payment-collection.sql` and its
`-teardown.sql`) drives fee-free payment collection (PRD §7.21) end to end (19 checks):
the admin's PayNow settings round-trip incl. `+65` normalization, the WhatsApp button's
**popup is caught, never Sent** — asserting the right number and that the message
carries the tokenized link and reference (wa.me 302s to `api.whatsapp.com/send`, so the
number, not the host, is the assertion), the "chat opened" stamp wording (never
"reminded" — RISK 7), the tokenized page rendering **sessionless** (amount, reference,
computed QR, Save-QR), the RISK 4 auth-gate pair (sessionless `/billing` still bounces
to login; a SIGNED-IN parent opening the public link is not stolen from it), the
sessionless "I've paid" claim, the admin's "parent says paid" badge + Claimed filter,
the converged RPC Mark Paid, and the public page's paid state. **The fixture resets its
invoice on every load** — re-load before each run. Requires `supabase functions serve
public-invoice` alongside both dev servers. What it deliberately does NOT prove: a real
bank app accepting the QR (that is the manual release gate);
`verify-makeups.mjs` (+ `fixtures-makeups.sql` and its `-teardown.sql`) drives a make-up —
an enrolled child guesting one lesson of another same-category class — end to end through
both real UIs (15 checks): the admin's booking form is child-first via **one search box
matched against the child's name OR their class's title** (`lib/makeupSearch.ts`; the
driver exercises both paths — found by class name first, by child name on the second
pass), the class list is the same category **minus the child's own class**, the date list is the host's real lesson
days **plus the fixture's off-schedule extra session on today's date** (which is what lets
the coach marking-screen checks run whatever weekday it is), the duplicate-slot refusal
surfaces the RPC's own sentence (§7.32), the host coach's roster shows a "Make-ups coming
up" panel **naming the guest** (the widened `coach_serves_student()` at work — an RLS gap
here silently `.filter(Boolean)`s the child away rather than erroring), the guest is NOT
counted a member (`Students (0)`), the marking screen lists them with a "Make-up" chip,
and the parent's home card announces the make-up **in addition to** the weekly class
block. Coach screens are reached by fixed-id deep links (§7.58 — tab taps force-click the
overlaying screen). **Re-load the fixture between runs** — the driver books through the
real UI, so a second run against the same state trips its own duplicate refusal;
`verify-trial-visibility.mjs` (+ `fixtures-trial-visibility.sql`) drives a booked trial from
all three sides — the parent is told WHEN, the coach's roster lists trials coming up, and
Unassigned Children **excludes** an upcoming trial while **keeping** a past one; its last
two checks book a trial *while the admin page is already open* and prove the enrolment
guard refuses the first press **and wrote nothing** (11 checks). **It found two RLS gaps
that would have shipped the parent card completely dead** — see §7.48;
`verify-trials.mjs` (no fixture — it drives the seed's one class and writes through the
UI, so a reset is its cleanup) covers the admin half: the unpriced-category reminder
disappearing **per category**, the trial price saving as a new effective-dated row, the
lesson picker offering only that class's weekday, the booking landing on the Trials page,
and then the coach half — the trial child is **not** on the class roster (a booking is not
an enrolment) but **is** on the attendance screen for their own lesson, labelled *Trial*
(11 checks; both servers).
> **It had been asserting nothing for two weeks, and the sweep called it PASS — §7.100.**
> Two independent defects. It never filled the booking form's **phone**, mandatory since
> §8.12, so the form refused before `book_trial()` was reached; and it skipped itself
> unless today was the class's weekday, computed from `new Date()` in the **runner's** zone,
> which is UTC. The nightly's cron is 20:00 UTC — already the next SGT day — so the skip
> fired on the wrong days and the driver only truly ran when the UTC date was a Saturday.
> Every scheduled sweep in between counted it PASS without reaching the first coach check.
> **Two changes made it run daily rather than one day in seven.** The target lesson is now
> the most recent that has fallen due, chosen by comparing ISO option **values** against
> today-in-SGT (never rendered labels). And marking is reached through the Schedule tab's
> **NEEDS MARKING**, not the class roster: at the time, the roster gated its button on
> `activeStudentIds.length > 0` — enrolments only — so a lesson whose only attendee is a
> guest was invisible there, and the seed has zero enrolments, meaning that route could
> never have worked from a clean reset.
> **That gate was removed on 2026-08-10 and the driver now covers BOTH surfaces** (11 → 16
> checks). The roster half asserts it no longer reads *"No lessons to mark yet"*, offers
> *Mark Attendance*, and that pressing it lands on the **guest's own** lesson; the Schedule
> half is unchanged. Checking one surface alone cannot see a regression on the other, which
> is the whole point of the pair — the bug was the two disagreeing. Proven red by restoring
> the enrolment gate: both roster checks fail, the Schedule checks stay green.
> The last check closes the loop the engine opened — **marking the guest CLEARS the lesson
> from NEEDS MARKING**, because as of 2026-08-10 an unmarked booking blocks the billing
> month with no override, and a block with no exit strands a whole business. It is asserted
> as a **count** (`NEEDS MARKING (N)` before vs after) with the baseline captured first, and
> marking goes through **Set all** rather than one row's Present — both for reasons that
> cost real time and are written up as §7.118.
> Assertions read `visibleText()`, and the unreachable SKIP is now a **FAIL** — exiting 0
> without asserting is the whole lesson. Scores **6/10 → 11/11**; the phone fix alone is
> 7/10, so both halves are proven load-bearing (§7.25).
> `lib.mjs` gained **`pressByTextMatch(page, /re/)`** for it — visible-only like
> `pressByText`, but regex, and it presses **only on a unique match** (§7.98's walk rule),
> because a label carrying a date has no exact string to match on;
`verify-parent-claim.mjs` (+ `fixtures-parent-claim.sql`) drives the whole claim + merge
loop across both real UIs — the popup OPENS (slice 1 shipped an invisible modal, §8.10),
the candidate is masked, Confirm is inert until one is chosen, the parent is **blocked**
from re-adding, the admin queue shows who is asking, approve is a two-step confirm, undo
is offered, and the "no, different child" branch produces a duplicate that the Students
page flags and merges (21 checks). **It found two bugs no unit test could reach** — both
read paths rather than RPCs (§7.48, and duplicate detection hiding same-parent pairs).
**It was itself red from 58 minutes after it was written until 2026-08-04**: `handleSave()`
gained an *"Is this right?"* review modal (`bad1294`, 01:59) an hour after the driver was
committed (`0cf8036`, 01:01), so it waited for a candidates popup the app would never show
and aborted at check 1 — 0/5 for months, while the product was correct the whole time.
Repaired by tapping the modal after each of the three saves. **Two things to know before
running it:** it needs a full `supabase db reset` **and** `docker restart
supabase_kong_SwimSync` first, and a second run without one fails at check 1 *identically*
to the staleness bug above — the run files a claim, approves it and merges a duplicate, and
re-loading the fixture does not undo those rows;
`verify-class-students.mjs` (+ `fixtures-class-students.sql` and its
`-teardown.sql`) drives the admin Classes page's **"See students" drawer** — the badge
reads `2+1` (and is asserted *not* to read 3 / 2+2 / 2+3 / 3+1, each a specific way the
rule could have been got wrong), the drawer lists the two enrolled children with level and
joined date plus the one upcoming trial, and the three negative controls — a **closed**
enrolment, a **past** trial and a **cancelled** future trial — appear nowhere. **Its first
six checks are database checks that those three rows EXIST**, because an absence assertion
against a row that was never created passes while proving nothing (32 checks). Admin-only:
no Expo server needed. Run it on **port 3100**, not 3000 — the stack and ports are shared
with other worktrees: `ADMIN_URL=http://localhost:3100 node drivers/verify-class-students.mjs`;
`verify-coach-roster.mjs` (+ `fixtures-coach-roster.sql` and its `-teardown.sql`) drives
**Wave 3's lesson-level coach roster** end to end — **25 checks**, across the admin panel and
the coach app, as three personas. Wave 3 shipped with none of this: 40 pgTAP, 40 vitest, 40
jest and a manual walk, and nothing in the nightly sweep. What only a browser can reach is the
**substitute's RLS path** — the class title rendering at all, the enrolled child, and above all
the **trial guest**, whose invisibility is a billing month that will not close with no override
and nothing on any screen saying why. The two coaches are deliberately NOT admins (§7.131 — the
seed coach is also the tenant admin, so no narrowing can be observed on him), and the teardown
is CLASS-scoped across every month, because `assign_session_coach()` creates lesson rows the
fixture never named (§7.132) and a lesson at `today - 7` straddles two months near the 1st. **Its sabotage signature is measured, and measuring it found two checks
that were decorative**: with the client sabotaged to hide every lesson it still scored 25/25
until the fixture gave the second class's lesson a `lesson_sessions` row (the Schedule tab only
probes a lesson that has one), and with `sessions_i_am_main_on` dropped entirely it scored
25/25 until the replaced-coach checks were moved BEFORE the substitute marks the lesson — a
fully marked lesson leaves the backlog whatever its roster says (§7.140). The signature now
reads: revert the guard → abort at 6b; delete only the absence branch → 6c; hide everything →
17; drop the RPC → 16. ⚠ **Not re-runnable by hand** — check 14 marks the lesson and check 0
needs it unmarked; apply the teardown and the fixture between runs. Log in as
`coach@swimsync.test` for the admin half; the two roster coaches are `roster-sub@` and
`roster-shadow@swimsync.test`, `password123`;
`verify-orphan-report.mjs` (+ `fixtures-orphan-report.sql` and its `-teardown.sql`) drives
**Wave 4's standing orphan-lesson report** — 13 checks: the sidebar badge from a page that is
NOT /invoices, both report lines with counts and the sealed month's label, **Write off**
clearing one line while the other **survives** (the per-line persistence claim), **Paid
outside** with an amount emptying the section, and the settlement rows checked in the DB —
`written_off:NULL` and `paid_outside:60.00` dated at the line's **latest lesson**, never
today. The fixture builds a **dedicated tenant** (`orphan-admin@swimsync.test`) because the
report needs a SEALED month and sealing one for the seed tenant would short-circuit
`verify-invoice-controls`' generation flow on a hand-run. Its DB-side RPC probes impersonate
the fixture admin via the JWT-claims GUC — the RPC refuses psql's superuser (no JWT), which
is correct and is pinned by pgTAP. ⚠ **Not re-runnable by hand** — settling is the driver's
whole act and a live settlement is exactly what empties the report; the fixture guard names
the leftover settlements and says to apply the teardown first;
`verify-coach-disable.mjs` (+ `fixtures-coach-disable.sql` and its `-teardown.sql`) drives
**Wave 5 chunk 2's disable/reactivate** — 13 checks across BOTH apps: the dialog demanding
a replacement (confirm dead until chosen) and naming the ⚠ RISK 8 marking-backlog lesson;
the disable moving the class to the replacement's row; then the part only a browser can
prove (bans live in auth, not the database, the `verify-admins` precedent) — the disabled
coach's **Expo login dying**, the replacement's week showing the inherited class, and after
reactivation the login returning while the class deliberately does NOT. The two fixture
coaches are non-admin for the §7.131 reason and the fixture refuses to apply if one has
become an admin, or if a prior run left the target disabled. ⚠ **Not re-runnable by
hand** — the class stays with the replacement; apply the teardown and fixture between runs.
Personas: `dc-target@` / `dc-replace@swimsync.test`, `password123`, actor `coach@swimsync.test`;
`verify-multi-class.mjs` (+ `fixtures-multi-class.sql` and its `-teardown.sql`) drives
**a child in two classes** (Wave 2) across admin, database and parent app — 17 checks. The
one that carries the weight is the **reveal guard**: it counts remove-buttons *inside
Amelia's own row* (2) against Ben's (1), because asserting "Mon" and "Wed" are both on the
Students page proves nothing when the page renders every child and a sibling fixture could
supply either string. Ben is the single-class control, so "show every class" cannot pass by
being indistinguishable from "show everything". It also proves the write path is per-class:
removing one chip leaves the other enrolment ACTIVE, leaves the child `assigned`, and closes
rather than deletes. **Its sabotage signature is measured, not predicted** — truncating the
Students page to the first class makes the run *abort* (the removal step has no Wednesday
chip to click), and dropping `trg_enrolment_schedule` gives 15/17. That measurement caught a
**vacuous check of its own**: the coach-deduplication check counted a hardcoded name this
seed does not use, matched zero times, and passed while testing nothing — it now reads the
name from the database. ⚠ It **mutates state and is not re-runnable alone**: apply the
teardown before a second hand-run. Log in as `coach@swimsync.test`, not the seed
superadmin — the platform admin is refused every single-business page by design (PRD §4.4)
and renders zero rows, which reads exactly like a broken query;
`verify-levels-table.mjs` (+ `fixtures-levels-table.sql` and its `-teardown.sql`) pins the
Swimming Levels table's **column geometry** — it MEASURES each `th`'s rect against its
column's `td` and fails if they diverge by more than 2px. Written because §7.54's bug was
invisible to every text assertion: the labels were all correct and merely in the wrong
place. **It fails on the pre-fix code with a worst offset of 488px, which is the point**
(12 checks; admin-only, port 3100). **It deliberately keeps its own inline copy of the
measurement** rather than importing `lib.mjs`'s: it is the *calibrated reference*, and an
edit to the shared helper must not be able to move what it asserts;
`verify-admin-table-geometry.mjs` (+ `fixtures-admin-table-geometry.sql` and its
`-teardown.sql`) applies that same measurement to the **other admin tables** — 15 of the 16
routes that render a `<Table>`, via `lib.mjs`'s `measureTableGeometry()` /
`TABLE_GEOMETRY_TOLERANCE`. `/platform` is excluded because it is a *platform-admin* page
and renders nothing for a tenant admin — a missing role, not missing data. Three checks per
route: header row not nested, cell count matches the header, and every header within 2px of
its column (46 checks, 15/15 measured, admin-only). **Proven load-bearing by injecting
§7.54's nesting into `/parents`: 675px, two checks red.** Two rules it is built around —
**an empty table is SKIPPED and listed, never counted as a pass**, and a run that measures
zero tables FAILS; and **a route that THROWS is a failure, not a skip**, because collapsing
"empty" and "blew up" into one non-failing bucket is how a half-dead sweep exits 0 (§7.100).
Column *width* is reported, never asserted (§7.71) — it currently prints `/makeups` and
`/trials` at 79px. **Only the first `<table>` on a page is measured**, a known gap.
Its fixture exists because the bare seed leaves **ten of sixteen** admin tables empty, so
without it the sweep checks six pages and silently skips ten;
`verify-contact-details.mjs` (+ `fixtures-contact-details.sql` and its `-teardown.sql`)
drives all four states of the admin's parent-contact modal — an unclaimed child edits and
persists (a cleared field lands as **NULL, not `''`**, matching the creation path); a
claimed child is read-only and shows **both** of its parents' details, asserted as the
**exact seeded strings** because the `any`-typed join renders blank when nested wrong
(§7.28); a claimed child with **no enrolment**, whose parent has no other children, still
resolves — the non-vacuous test that `tenant_serves_parent()` keys off `students.tenant_id`;
and a child with a **pending claim** offers no Save at all. It also proves the phone check
never blocks: `964` warns on *Add a student* and the child **is still created** (21 checks;
admin-only). The driver **resets the fields it edits**, so a second run cannot fail in a way
that looks like a regression (§7.53's lesson, applied at the driver rather than the fixture);
`verify-attendance-guard.mjs` (+ `fixtures-attendance-guard.sql`) drives the marking window
across both UIs — the admin schedules an extra lesson off the class's weekday (and a second
identical press leaves exactly ONE session, §7.7), the coach is told it is coming and cannot
mark it before the day, a past in-window lesson opens with **only the children enrolled on
that date** (the late joiner is absent — the whole point), an out-of-window date and a
non-lesson day are each refused **in English with no markable roster**, and a save followed
by a correction round-trips through the real upsert path that §7.57 governs. Since
2026-08-07 its fixture also **seals a billing month four back**, so the business's floor
sits earlier than the calendar rule and the driver can prove the half that pgTAP cannot:
a lesson below the CALENDAR floor **opens and offers a markable roster** because its month
was never billed (§7.6). The database was never the hard part there — the coach's screen
simply never OFFERED the date. Both checks were proven red by stubbing `fetchMarkableFloor`
to `null`: they fail and **the other 20 still pass**, which demonstrates the degradation
guarantee in the real UI rather than arguing for it. The driver **asserts its own premise**
before launching a browser (business floor < calendar floor, and `D_REOPEN` between them)
so an unloaded fixture fails saying so instead of looking like a product regression.
**Scores 6/12 on the pre-fix screen**, which is what makes it worth having. Its fixture
derives every date from ONE clock anchor rather than hardcoding — deliberately the opposite
of §7.33's rule for unit suites, because the behaviour under test IS relative to now(). It
carries `pressByText()` for §7.58; needs both servers;
`verify-admins.mjs` (+ `fixtures-admins.sql` and its `-teardown.sql`) drives co-admin
management (§8.31) across five personas — what only a driver can prove, since bans live in
auth, not the database: the owner's roster with Owner badge and levers; the invite path
**asserting the hand-over-link warning, not a fake success** (no RESEND key locally);
deactivating a PURE admin flips the pill AND **kills their login** (the ban half),
reactivate restores both; a deactivated COACH-admin still logs in (never banned — coaching
survives) and lands on the suspension screen; a co-admin sees the same roster with **no
buttons**; the typed-DELETE modal's button is dead until the word is typed, warns about the
audit purge, removes the row and the login; and a plain coach is refused at the login door
with "use the SwimSync app", not "access denied" (21 checks; admin-only). **The driver
consumes state** (deletes one fixture admin, invites another) — teardown or reset between
runs. The same session's driver pass is what caught §7.90: `verify-tenant-provisioning`'s
accept-invite check went red within the hour of the migration applying;

> **It absorbed `verify-attendance-window.mjs` on 2026-08-01 and now runs 19 checks.** That
> driver had rotted to **2/5** with the product correct in every case: its fixture pinned a
> child's enrolment to `2026-07-16` and needed "no Sunday since", true for three days in
> July 2026. Two drivers over one rule is why nobody noticed. The three behaviours nothing
> else guarded were rebuilt on this fixture's anchor:
> - the coach roster's **"No lessons to mark yet"** placeholder, on a class whose weekday is
>   *tomorrow's* so its first lesson is always still ahead;
> - the parent's **"No lessons marked yet"** (a lesson happened, the coach is behind), on a
>   second class whose weekday is *yesterday's* so a lesson is always overdue;
> - the parent's **"No lessons have taken place yet"** (nothing happened, nobody is behind).
>
> **Each parent check asserts its sibling sentence is ABSENT, not merely that its own is
> present.** A previous screen stays mounted under the current one (§7.10, §7.58), so a
> present-only assertion can pass on the *other* child's panel — and these two sentences are
> the entire behaviour: saying the first when the second is true accuses a coach of being
> late when they are not (PRD §5.1). Both weekdays are derived away from Saturday, and the
> driver **asserts the new class's `day_of_week` is not `saturday`** — a collision would make
> the "nothing has happened yet" premise false silently, and only on Fridays.
> All three were observed RED (by flipping the enrolment dates) before being accepted (§7.25).

`verify-stale-screen.mjs` (+ `fixtures-stale-screen.sql`) is the only driver that can reach
the three 2026-07-26 attendance bugs, **because all three live in the router or the wire
format rather than in any function**. It navigates **in-app** — Today's card, then the
backlog row — which is the whole reason it exists: a deep link mounts a fresh screen and
passes cleanly, which is exactly how `verify-attendance-guard.mjs` scored 14/14 against a
build that was silently writing attendance to the wrong day. **22 checks**: rows land on
the lesson the coach is looking at (§7.64), saving leaves the attendance screen instead of
popping into a different lesson (§7.65), a *partially* marked lesson can be completed at all
(§7.67 — a fully marked or fully unmarked one cannot reproduce it), and the status chips read
correctly with no empty roster ever labelled *Marked* (§7.68). Scores **4/8 → 18/18** across
the three fixes;
> **+4 checks on 2026-08-02 for §7.80**, the other half of §7.65: pressing the **Classes**
> tab must land on the class list rather than the leftover attendance screen the Schedule tab
> pushed into that stack, today's classes must be grouped under a *Today* heading, and —
> the regression the fix could itself cause — Today's *Mark Attendance* must still push
> through. Scored **18/22 → 22/22**. The same change made the driver **record a crash as a
> failed check**: four checks appended below the last `check()` threw on their first line
> and the run still printed *18/18 passed* and exited 0, because `finally` reached
> `process.exit` first (§7.79). the two-class fixture is required because one class cannot express "marked
two lessons in one sitting". Its fixture derives dates from one clock anchor, like the guard
driver's. **It selects buttons by the card for a named class, never by page index** — an
index broke the moment a finished class started saying *Edit attendance* — and its
`pressByText` filters on `aria-hidden` so a press cannot land on a screen React Navigation
has left mounted. Coach app only; no admin server needed.
> **2026-08-08, the Today tab became the Schedule tab.** Still **22 checks** — the label
> diff against `main` is two renames and nothing lost. Two of them were rewired: the
> backlog heading is now `NEEDS MARKING (N)` (**keep the count in the regex** — it is the
> only assertion that the floor-scoped set is neither larger nor smaller than it should
> be), and the tab press is `"Schedule"`. The important change is that the
> weekday-grouping check now reads **`visibleText()`**, not `dumpText()`: the Schedule
> screen renders its own `TODAY · <date>` heading and stays mounted under the Classes tab,
> so the old assertion would have matched the screen it had navigated *away from* and the
> Classes tab's grouping could have been deleted outright while it stayed green (§7.98).

`verify-schedule-week.mjs` (reuses `fixtures-stale-screen.sql`) owns the **Schedule tab's
week selector**, split out of the driver above because driving the selector inside it
destabilised seven downstream checks — that driver needs the screen left where it starts.
**21 checks.** The load-bearing one is *"a straggler from ANOTHER week still appears under
NEEDS MARKING"*: that list is **floor-scoped, not week-scoped**, so a lesson from three
weeks back stays visible whatever the selector shows. Week-scoping it would hide a lesson
the coach has no reason to go looking for, and unmarked attendance blocks billing with no
override. **Proven RED** by scoping the query to the week (§7.25). Also pins: TODAY renders
only in the current week, the *Back to this week* escape appears exactly when needed, the
arrows stop at the marking floor and at the end of next week, and a COMING UP row never
reaches the attendance screen (a future date is refused there, so it would be a dead tap).
**Not** covered here: the week surviving a Sunday→Monday boundary with the app mounted —
that is why the screen holds an offset rather than a date (§7.95), and only
`lib/scheduleWeek.test.ts` can move the clock far enough to prove it.

> **Two of the 21 exist because the COMING UP tap silently stopped testing COMING UP**
> (2026-08-10, `287142b`). The driver expanded a day with `.last()` over a bare day-header
> regex, which takes whichever day sorts latest — the **seed's** Saturday class, not the
> fixture's. The lesson was never revealed, the following tap fell through to the NEEDS
> MARKING straggler, and the two COMING UP checks failed against a correct product on every
> weekday except Sat/Sun. It now addresses its own day by name (`TODAY + 7`) and asserts
> **the header matches exactly 1 element** and **that expanding it reveals the lesson** —
> so a missed expand is a legible FAIL instead of two checks quietly asserting nothing.
> Labels come from the app's own `toLocaleDateString` call, never SQL (**§7.121**).
> Sabotage signature is in the file header: restore the old locator → **18/21**, guard
> reporting `2 -> 2`. §7.75, §7.101.

`verify-parent-pay-claim.mjs` (reuses `fixtures-payment-collection.sql`) covers **Pay via
PayNow and I've paid on the parent's invoice LIST** (PRD §7.21), which no other driver
walks. **16 checks**: both controls render on an outstanding card, Pay opens the PayNow
screen carrying `invoiceId` without routing via the detail screen, the claim raises exactly
one confirm dialog and does not navigate, the claimed line replaces the button in place and
survives a reload, and the invoice stays **outstanding** — a claim is a statement, never a
status change. ⚠ Its "one dialog / no navigation" pair are OUTCOME guards only: the nesting
they were written to catch was tested by deliberately re-nesting the buttons and the driver
still scored 16/16, because RN's responder system does not propagate a press to ancestor
Touchables. Do not cite them as the nesting guard.

**⚠ Hand-run caveats, collected (the sweep resets per driver, so these bite ONLY a
hand-run).** Four drivers are **not re-runnable without their teardown**:
`verify-coach-disable` (moves the class to the replacement and reactivation does not hand
it back; its fixture refuses to apply over the leftovers and names the teardown),
`verify-coach-roster` (marks the lesson; its shadow assignment is refused a second time by
a unique index — it also **collides with `verify-schedule-week`**, same weekday last week,
leaving that driver 20/21 if its fixture stays in place), `verify-multi-class` (removes a
class through the UI; the fixture's `NOT EXISTS` guard is keyed regardless of `is_active`,
so a second run finds the row present-but-closed and does not restore it), and
`verify-orphan-report` (settling is its whole act). Three more **mutate SHARED seed
state**: `verify-paynow-fallback` writes the seed tenant's PayNow columns,
`verify-class-deactivation` retires a seed-adjacent class, and `verify-trials` **leaves a
booking behind on every run** — it has no fixture at all, hence its *Set all* marking step
and a final assertion that counts rather than tests presence (§7.118).

### Class-level shadow coaches (2026-08-12)

- **`class_shadow_coaches.test.sql` (49; was 50 until `20260812000300` dropped the compat shim
  and its grant assertion with it)** — the assignment, the absence, the shadow rate, the
  seals, precedence, and the two RLS-hiding cases. Each proven red by *targeted* sabotage; the
  campaign is worth copying rather than re-inventing. **Three of its cases exist only because
  nothing on any screen would show them failing**: an absence restored after a month is paid,
  the tenant-wide vs per-coach seal, and Adjustments B's class-shadow arm — the last is
  reachable only by disabling the seal trigger inside the transaction, which the file does
  deliberately and puts back.
- **`sessions_i_am_main_on.test.sql` (9)** — split out of `session_roster_guard.test.sql`,
  which was **deleted** with the guard it tested. Only 7 of that file's 16 checks were about
  the guard; these nine were the batch roster gate's only coverage, in the migration that
  rewrote its sole dependency. **When a suite tests two things and one is retired, split
  before deleting** — a per-file count that drops has lost a test, not passed one.
- **`verify-coach-roster.mjs` — now 30 checks**, rewritten for the split model: substitutes on
  Lesson Coaches, shadows on the Classes drawer, and the *Coaches present* tick. Its measured
  sabotage table is in its header and includes one case that was **green over nothing** on the
  first run — the assignment was left at today's default date and covered none of the
  fixture's past lessons, so the list under test was correctly empty. ⚠ It **collides with
  `verify-schedule-week` on a hand-run**: both put their lesson on the same weekday last week,
  and leaving this fixture in place scores that driver 20/21. The sweep resets per driver.

See LOCAL_DEV_GUIDE §"Running the tests".

---
