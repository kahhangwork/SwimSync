# A referred family cannot be brought in — plan

_Status: NOT STARTED · written 2026-11-18 · plan-reviewed 2026-11-19 · BACKLOG "Carried-over packages — a referred family cannot be brought in"_

## 1. The decision (user, 2026-11-18 — settled, do not re-open)

A family whose package is **brought in** (PRD §7.16 *A package bought before SwimSync*) is an existing customer, not a
referral. Today, if that family joined with a friend's `REF-` code, the bring-in leaves the referral **pending** (D6 of
`CARRIED_OVER_PACKAGES_PLAN.md`), so their next real purchase gets the friend's first-package discount **and** mints the
referrer a reward.

- **Refuse the bring-in** while the family has a pending referral as the referee. *(Auto-voiding at bring-in was offered
  and declined: "a lot of bugs could happen because of it".)*
- **Add a Void referral action** to the admin Referrals page as the exit. Today's **Void** voids a *reward* only; voiding
  the family's first-package reward still leaves the referral pending and convertible.
- A brought-in family **can still refer others** (unchanged) — their referrer/manual rewards must survive a Void referral.

Prod on 2026-11-18: **0 referrals, 0 carried packages** — no backfill, no data at risk. The parent `public-package`
carried fix (v5) is out of scope.

## 2. Facts this plan rests on (read from the DB, not migrations — §7.40; re-verified 2026-11-19)

| Fact | Where |
|---|---|
| A referral is created only by `join_tenant_by_code`, and only when the family is **not yet a member and holds no package**. So no referral can be created AFTER a bring-in — the only case is a referral that already exists. Only `join_tenant_by_code`, `settle_referral_reward` and `my_referrals` touch `referrals`. | `join_tenant_by_code` (`v_was_member`, `v_has_pkg`) |
| `referrals.status ∈ {pending, converted, void}`, `void_reason` free text (no CHECK), UNIQUE(referee_parent_id, tenant_id). **No `voided_at`/`voided_by` columns** — who/when lives in `audit_log`. | `referrals` constraints |
| Conversion matches `status = 'pending'` only — a voided referral can never convert. | `settle_referral_reward()` arm (c) |
| A pending referral's `referee_first` reward (exactly one, `referral_id = r.id`) is `available`, `reserved`, **or `void`** (today's Rewards "Void"). Never `used` (arm (a) and (c) fire together) and never `expired` (minted with no `expires_at`). | `join_tenant_by_code`, `settle_referral_reward` |
| `void_referral_reward(id, reason)` refuses a reserved reward whose package is `paid_claimed_at`, else restores the reserved package to full price, then voids. Gate: `is_platform_admin() OR has_admin_area(tenant, 'packages', 'edit')`. Has one `now()` (already in the frozen census). | `void_referral_reward` |
| `audit_log_tenant_of()` **RAISEs for any entity_type without an arm** — there is no `'referral'` arm today (§7.297). | `audit_log_tenant_of` |
| The carried-package D6 guards (`apply_referral_reward` / `settle_referral_reward` early `RETURN` on `carried_over_start`) still protect **referrer/manual** rewards from a carried package. | both trigger bodies |
| The Bring-in form shows a `23514` (`check_violation`) message inline; anything else is a generic error. | `SwimSyncAdmin/app/(admin)/packages/domain/useSale.ts:155` |
| The parent app renders a `void` referral ("not eligible"); `my_referrals` does not return `void_reason`. | `SwimSyncApp/features/billing/ui/ReferralSection.tsx:88` |
| Referrals nav item is area `packages`; `referrals_select` permits `packages:view`; the page has no per-button permission gating today (Void reward shows to every viewer). | `lib/adminNav.ts:91`, `referrals_select` policy |
| `carried_over_packages.test.sql` tests **20–23 bring in a package for Fay (P6), referee of a PENDING referral** — after this migration they are wrong and must be rewritten. | that file, lines 132–138, 238–252 |

## 3. Steps

### Step 0 — sequencing, before any code

1. Read HANDOVER §9: the admin unit (Step 2) is an APP unit, so the nightly covering the last APP unit must be read
   before it merges.
   ⚠ RISK 6 MITIGATION (named prohibition): Do NOT dispatch or re-run the nightly (`gh workflow run`, `gh run rerun`) or
   start the full local sweep to clear this gate. If unread, stop and ask the user.
   ⚠ RISK 6 MITIGATION (step): Clear the gate **before** pushing the migration (Step 3.2), so migration push → admin push
   happen in one sitting, minutes apart — the refusal is never live on prod for long without its exit.
2. `ls supabase/migrations | tail -1` must show `20261118000300_…` as newest; the new file
   `20261118000400_carried_over_referral_block.sql` must sort after it (pass/fail).

### Step 1 — migration `20261118000400_carried_over_referral_block.sql` (root checkout, `db/…` branch, lands alone — §7.55)

1. **`record_carried_over_package`** — `CREATE OR REPLACE` from the **DB** body (`pg_get_functiondef`, §7.40), one new
   refusal:
   ```sql
   IF EXISTS (SELECT 1 FROM referrals r
               WHERE r.referee_parent_id = p_parent AND r.tenant_id = v_product.tenant_id
                 AND r.status = 'pending') THEN
     RAISE EXCEPTION 'This family joined with a referral code. Void their referral on the Referrals page (Void referral) before bringing in a package.'
       USING ERRCODE = 'check_violation';
   END IF;
   ```
   ⚠ RISK 1 MITIGATION (step): Place the refusal as the **LAST check before the `INSERT`** — after the expiry check
   (`v_end < app_today()`), not right after the membership check. The admin is told to do an irreversible void only when
   the bring-in would otherwise succeed.
   ⚠ RISK 1 MITIGATION (assertion): pgTAP gives a pending-referral family an **expired** original start → it must get the
   *expired* message, not the referral message; and lessons > count → the *lessons* message.
   ⚠ RISK 4 MITIGATION (named prohibition): The predicate is `referee_parent_id = p_parent` only — do NOT add
   `OR referrer_parent_id = p_parent` (decision 3: a referrer can still be brought in).
   ⚠ RISK 3 MITIGATION (named prohibition): Do NOT remove or narrow the `carried_over_start` early returns in
   `apply_referral_reward` / `settle_referral_reward` — they still stop a referrer/manual reward from discounting a
   carried package. This migration does not touch those two functions.
   Signature unchanged → no caller change. Confirm `grep -rn 'record_carried_over_package' SwimSyncAdmin SwimSyncApp
   supabase/functions` → only `packages.rpc.ts:121` (§7.123). `CREATE OR REPLACE` keeps the existing ACL — assert with
   the existing carried tests 50/51 (still green).
2. **`audit_log_tenant_of`** — `CREATE OR REPLACE` from the **DB** body, adding one arm:
   `WHEN 'referral' THEN SELECT r.tenant_id INTO v_tenant FROM referrals r WHERE r.id = p_entity_id;`
   ⚠ RISK 2 MITIGATION (step): This arm is required; without it every `void_referral` RAISEs (§7.297).
   ⚠ RISK 2 MITIGATION (named prohibition): Do NOT dodge the raise by auditing under `'Tenant'`, `'ParentTenant'` or
   `'parent_package'`, or by passing a `tenant_id`.
3. **New `void_referral(p_referral_id uuid, p_reason text) RETURNS void`**, `SECURITY DEFINER`, `SET search_path TO 'public'`:
   - `auth.uid() IS NULL` → `insufficient_privilege` (as `record_carried_over_package`);
   - lock the referral `FOR UPDATE`; unknown → `no_data_found` ('No such referral.');
   - gate exactly as `void_referral_reward` (`is_platform_admin() OR has_admin_area(v_ref.tenant_id, 'packages', 'edit')`)
     → `insufficient_privilege`;
   - only `status = 'pending'` → else `check_violation` ('Only a pending referral can be voided.');
   - `v_reason := coalesce(nullif(trim(p_reason), ''), 'Voided by admin')` — used for BOTH the reward and the referral;
   - for the reward `WHERE kind = 'referee_first' AND referral_id = v_ref.id AND status IN ('available','reserved')`:
     `PERFORM void_referral_reward(id, v_reason)` — reuses the paid-claimed refusal and the price restore. A reward
     already `void` is skipped and the referral is still voided;
   - `UPDATE referrals SET status = 'void', void_reason = v_reason WHERE id = v_ref.id`;
   - `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)` —
     `auth.uid(), 'referral_voided', 'referral', v_ref.id, jsonb_build_object('status','pending'),
     jsonb_build_object('status','void','void_reason',v_reason, 'referee_reward_voided', <bool>)`.
   ⚠ RISK 4 MITIGATION (named prohibition): Select the reward by `referral_id = v_ref.id AND kind = 'referee_first'` —
   do NOT select by `parent_id` (would void the family's referrer/manual rewards).
   ⚠ RISK 5 MITIGATION (named prohibition): Do NOT wrap the `PERFORM void_referral_reward(…)` in a `BEGIN … EXCEPTION`
   block — its raise must abort the whole call so the referral is never voided while the discount survives. Void the
   reward **before** updating the referral.
   ⚠ RISK 8 MITIGATION (named prohibition): No raw clock token in any new or re-bodied body, **including comments**
   (§7.396 — word it "the raw clock"). `void_referral` needs no timestamp (`audit_log.created_at` defaults). The frozen
   census in `app_clock.test.sql` must stay unchanged.
   ⚠ RISK 8 MITIGATION (assertion): `scripts/check-migration-clock.sh supabase/migrations/20261118000400_carried_over_referral_block.sql` exits 0.
   ⚠ RISK 13 MITIGATION (accepted, vigilance only): A concurrent package activation can deadlock with a void (opposite
   lock order); Postgres aborts one with 40P01, the outcome stays atomic, the UI surfaces the error and the admin
   retries. No code for this.
4. **Grants (§7.87):** `REVOKE ALL ON FUNCTION public.void_referral(uuid,text) FROM PUBLIC, anon; GRANT EXECUTE ON
   FUNCTION public.void_referral(uuid,text) TO authenticated;` No table grant changes. Header carries the remote
   grant-dump command (§7.39).
5. **DOWN** `supabase/rollback/20261118000400_carried_over_referral_block_DOWN.sql`: restore **both**
   `record_carried_over_package` and `audit_log_tenant_of` from their current DB bodies (`pg_get_functiondef` captured
   before applying UP, byte-identical), then `DROP FUNCTION public.void_referral(uuid,text)`.
   ⚠ RISK 10 MITIGATION (step): Rehearse UP → DOWN → diff → UP (§7.93). Save `pg_get_functiondef` of both functions to
   the scratchpad before UP; after DOWN, diff — must be **empty** (pass/fail); `void_referral` must be absent; the
   **pre-change** `carried_over_packages.test.sql` passes at `plan(52)` after DOWN.
6. **Types:** `scripts/gen-db-types.sh` (root checkout) in the **same commit** (§7.350); `scripts/check-db-types.sh` exits 0.
7. **Rewrite `carried_over_packages.test.sql` 20–23** (same commit).
   ⚠ RISK 3 MITIGATION (step): Change Fay's fixture so her referral is **`converted`** and her reward is a **`referrer`**
   or **`manual`** reward (status `available`). Tests 20–22 then still prove D6 for a carried package (no discount,
   reward untouched); test 23 becomes "the converted referral is unchanged and no further referrer reward is minted".
   ⚠ RISK 3 MITIGATION (named prohibition): Do NOT delete tests 20–23 or the M5 mutation proof. Re-run **M5** (remove
   `apply_referral_reward`'s carried early return) → tests 20/21 must go red; record it in the file's MUTATION PROOFS block.
   ⚠ RISK 3 MITIGATION (assertion): the file's `plan(N)` is unchanged at 52 — a changed count means a test was lost/added.
8. **pgTAP** — new `supabase/tests/carried_over_referral_block.test.sql`, clock pinned as its first statement (copy
   `carried_over_packages.test.sql`'s header). Use a fresh UUID prefix that `grep -r` finds in neither `supabase/tests/`
   nor `drivers/` (§7.280). Cases:
   - bring-in **refused** (23514 + the exact message) for a family with a pending referral; **nothing inserted**
     (`parent_packages` count unchanged, no `package_carried_over` audit row);
   - ⚠ RISK 1: pending-referral family with an expired start → *expired* message; with lessons > count → *lessons* message;
   - bring-in **allowed** for: a converted-referral family; a void-referral family; a family that is only a **referrer**
     (pending referral where it is the referrer);
   - `void_referral` refused for: a parent, a coach, a **same-tenant staff admin with `packages:view` only**, another
     tenant's admin (each `insufficient_privilege` + message); anon (no EXECUTE); unknown id (`no_data_found`); a
     converted and a void referral ('Only a pending referral can be voided.');
   - `void_referral` on an **available** referee reward → reward `void` with reason, `voided_by` = caller; referral `void`
     with the same reason; one `audit_log` row `referral_voided` whose **`tenant_id` = the referral's tenant** (RISK 2);
   - on a **reserved unclaimed** offer → `discount_amount = 0`, `amount_payable = total_value`, `referral_reward_id IS NULL`;
   - on a **reserved paid-claimed** package → `throws_ok` with the exact paid-claimed message;
   - on a referral whose reward is **already void** (today's Rewards Void) → referral voided, no error;
   - ⚠ RISK 4: the referee also holds a **referrer** reward (from referring someone else) and a **manual** reward → both
     still `available` after `void_referral`;
   - after a void, bring-in succeeds; after a void, a real active purchase by the referee gets `discount_amount = 0`,
     does **not** convert, and mints **no** referrer reward (`referral_rewards` count for the referrer unchanged);
   - grants: `authenticated` EXECUTE yes, `anon` no.
   ⚠ RISK 9 MITIGATION (named prohibition): Every `throws_ok` names **both** errcode and exact message (§7.112) — three
   distinct refusals share 23514.
   ⚠ RISK 9 MITIGATION (step, atomicity): "Referral still pending after the paid-claimed `throws_ok`" is true by
   construction (`throws_ok` rolls back the call) — atomicity is proven by mutation instead, below.
   ⚠ RISK 9 MITIGATION (step, prove red — §7.25): (a) the whole file against the pre-migration schema fails (no
   `void_referral`); (b) mutation proofs, each applied to the live function, file re-run, reverted, recorded in the
   file's footer: **M1** drop the refusal → "refused" tests red; **M2** move the refusal to right after the membership
   check → the RISK 1 ordering tests red; **M3** select the reward by `parent_id` → RISK 4 test red; **M4** wrap the
   `PERFORM` in `EXCEPTION WHEN OTHERS THEN NULL` → the paid-claimed `throws_ok` red; **M5** drop the `'referral'` audit
   arm → every void test red.
9. `supabase test db` full — all green, including `app_clock.test.sql` (census unchanged), `function_grants.test.sql`,
   `table_grants.test.sql`, `referrals.test.sql`, and the rewritten `carried_over_packages.test.sql`. Then every
   `repo-invariants` step from `ci.yml` locally (§7.354), each exit code 0 (§7.393).

### Step 2 — admin app (feature branch, after the migration is on prod and `main` has the new types)

1. `referrals/dao/referrals.rpc.ts`: `VoidReferralArgs = { p_referral_id: string; p_reason: string }` with
   `Assert<Extends<VoidReferralArgs, Rpc<"void_referral">["Args"]>>`, and a pass-through `voidReferral(args)` (no logic,
   per the file header).
2. `referrals/domain/referralRows.ts`: pure `canVoidReferral(r: Referral): boolean` (`r.status === "pending"`) — the UI
   reads only this.
3. `referrals/domain/useReferrals.ts`: `voidReferral(id)` — same shape as `voidReward`:
   `window.prompt("Reason for voiding this referral? This also voids their unused first-package discount and cannot be undone.")`;
   `null` → no call; sets `busy`; surfaces `error.message`; reloads.
   ⚠ RISK 1 MITIGATION (step): The prompt names both consequences (discount lost, cannot be undone) — a reserved offer
   restored to full price must not surprise the admin.
4. `referrals/ui/ReferralsSection.tsx`: a **"Void referral"** button (variant danger, size sm, `disabled={busy}`) on rows
   where `canVoidReferral(r)`; a visible header column (`<Th>{""}</Th>` as `RewardsSection`, never an `sr-only` label —
   §7.399); `page.tsx` passes `busy` + `onVoid={r.voidReferral}`.
   ⚠ RISK 7 MITIGATION (named prohibition): The label is **"Void referral"**, never bare "Void" — the Rewards section's
   "Void" stays, and the refusal message names "Void referral".
   ⚠ RISK 11 MITIGATION (accepted parity): The button is visible to `packages:view` admins (as Void reward already is);
   the RPC is the authority and its refusal surfaces in the page alert.
   ⚠ RISK 11 MITIGATION (named prohibition): Do NOT add `void_reason` to `my_referrals` or any parent surface — an
   admin's free-text reason stays admin-only.
5. **vitest:**
   - `referralRows.test.ts`: `canVoidReferral` true only for `pending`;
   - new `ui/ReferralsSection.test.tsx` (jsdom): with 1 pending, 1 converted and 1 void row, exactly **1** "Void
     referral" button renders (assert the count, not a loop over buttons — §7.401);
   - `useReferrals` voidReferral: calls the RPC with the trimmed reason; prompt cancel = **no call**; RPC error surfaces
     in `error`.
   ⚠ RISK 9 MITIGATION (step): Prove each red (§7.25) — flip `canVoidReferral` to `status !== "converted"` → count test
   red; drop the `null` guard → cancel test red.
6. **Drivers:**
   - `verify-referrals.mjs`: void a pending referral **through the UI**. `page.removeAllListeners("dialog")` and answer
     the prompt explicitly, as `verify-money-admin` does (§7.279): first **dismiss** → DB unchanged (`pending`); then
     accept with a reason → DB `void|<reason>`, the row reads *Void · reason*, and the referee's `referee_first` reward
     is `void`.
   - `verify-carried-over-package.mjs`: a **separate** referred family (so the existing Ava Cop assertions don't shift):
     bring-in shows the refusal inline in the modal → void the referral on `/referrals` → bring-in succeeds.
   ⚠ RISK 12 MITIGATION (step): Fixture + teardown add explicit `DELETE FROM referral_rewards` / `DELETE FROM referrals`
   for the prefix ahead of `parent_packages`; every new UUID literal carries `0000` (`drivers/check-fixture-ids.sh`);
   `drivers/check-fixture-roundtrip.sh` exits 0.
   ⚠ RISK 12 MITIGATION (assertion): `run-all-drivers.sh --only verify-referrals`, `--only verify-carried-over-package`
   and `--only verify-money-admin` (it clicks Void on `/referrals`) — all three green; each resets the DB. Grep the
   served admin bundle for "Void referral" before the run (§7.253).

### Step 3 — deploy (`/deploy`, order: migration → app — §7.60)

1. `scripts/prod-query-ro.sh` (bare command, nothing around it): count `referrals WHERE status='pending'` and
   `parent_packages WHERE carried_over_start IS NOT NULL`. Record both.
   ⚠ RISK 6 MITIGATION (assertion): If pending > 0, Step 3.3 must follow 3.2 in the **same sitting** (Step 0 gate already
   cleared). If it can't, stop and tell the user before `db push`.
2. Migration → `main` → `supabase db push` → `supabase migration list --linked` 0 pending → **remote grant dump** for
   `void_referral`: `authenticated` EXECUTE present, no `anon`/`PUBLIC` EXECUTE (§7.39). Read back the prod body with
   `pg_get_functiondef('public.record_carried_over_package'::regproc)` and confirm it contains "Void referral".
3. **Gate (HANDOVER §9):** confirm Step 0's nightly read still covers the last APP unit. Admin app → `main`.
   ⚠ RISK 7 MITIGATION (step): `scripts/watch-deploy.sh` (under Monitor) with
   `--expect https://admin.swimsync.sg/referrals 'Reason for voiding this referral?'` — point it at the **route**
   (§7.398), with a string only the new build has; "Void" alone already exists in the bundle and proves nothing
   (§7.31/§7.51). Report "live" before CI.

### Step 4 — docs (same pushes, written from `main`)

- PRD §7.16 bring-in bullet: add "a family with a pending referral (as the referred family)" to *Refused*; referrals
  bullet: **Void referral** on a pending referral (also voids the family's unused first-package discount; refused if that
  discount sits on a package the family has already paid; cannot be undone).
- `CARRIED_OVER_PACKAGES_PLAN.md` D6: one-line pointer to this plan (the pending case is now refused, not carried; the D6
  trigger guards stay for referrer/manual rewards).
- BACKLOG: delete the item. `docs/plans/README.md` row → DONE. TESTING §5 entry (new pgTAP file, rewritten 20–23, two drivers).

## 4. Size

Migration + pgTAP + 20–23 rewrite + mutations ≈ 3.5 h · admin UI + vitest ≈ 1.5 h · drivers + fixtures ≈ 1.5 h ·
deploy + docs ≈ 1 h. **About a day.**

## 5. Pre-commit gate

**Highest value — any unticked box is a blocker:**
- [ ] The refusal is the LAST check before the INSERT; expired / lessons cases return their own messages for a
      pending-referral family; mutation M2 went red (RISK 1).
- [ ] `audit_log_tenant_of` has the `'referral'` arm; the void test asserts the audit row's `tenant_id`; M5 went red (RISK 2).
- [ ] `carried_over_packages.test.sql` 20–23 rewritten (converted referral + referrer/manual reward), still `plan(52)`,
      that file's M5 re-proven red (RISK 3).
- [ ] Reward selected by `referral_id` + `kind='referee_first'`; referrer/manual rewards survive the void; M3 went red (RISK 4).
- [ ] No EXCEPTION block around `PERFORM void_referral_reward`; M4 went red (RISK 5).

**The rest:**
- [ ] Step 0 nightly gate read before the migration push; nightly not dispatched (RISK 6).
- [ ] Prod pending-referral count recorded before `db push`; migration → app in one sitting if > 0 (RISK 6).
- [ ] Button label "Void referral"; `watch-deploy.sh --expect` points at `/referrals` with the prompt string (RISK 7).
- [ ] `check-migration-clock.sh` on the new file exits 0; `app_clock.test.sql` census unchanged; no raw clock token in
      comments (RISK 8).
- [ ] Every `throws_ok` names errcode + message; new file red on the pre-migration schema; vitest reds proven; driver
      dialogs answered explicitly with a dismiss = DB-unchanged check (RISK 9).
- [ ] DOWN restores both functions byte-identically (empty diff) and drops `void_referral`; pre-change carried file
      green after DOWN (RISK 10).
- [ ] View-only admin / coach / parent / other-tenant / anon refused in pgTAP; `my_referrals` untouched (RISK 11).
- [ ] `--only` verify-referrals, verify-carried-over-package, verify-money-admin green; `check-fixture-ids.sh` and
      `check-fixture-roundtrip.sh` exit 0 (RISK 12).
- [ ] `scripts/gen-db-types.sh` in the migration commit; `scripts/check-db-types.sh` exits 0; full `supabase test db`
      green; every `ci.yml` repo-invariants step run locally, exit 0.
- [ ] Remote grant dump after push: `void_referral` has no anon/PUBLIC EXECUTE.
