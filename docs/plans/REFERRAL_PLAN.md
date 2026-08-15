# Plan — parent referral codes (double-sided package discount)

_Status: **SHIPPED LIVE 2026-08-15** (§8.61, `docs/DEPLOYMENT.md` §11.23) — migration
`20260815000700_referrals.sql` + `public-package` v2 + `package-emails` v3 + both apps, deployed
backend-first (grant dump clean, RISK 12 checks 0/0). pgTAP `referrals.test.sql` (57) +
`verify-referrals.mjs` (13). DORMANT on prod (no business has `referral_enabled`). Six gotchas
graduated as §7.164–§7.169. Original plan below, unchanged._

_Settled with the user via `/plan-with-confidence` on 2026-08-15
(two rounds of questions after an online-practice review; every decision below was answered
explicitly, none is inferred). **Risk-reviewed via `/plan-review` on 2026-08-15 by an
independent reviewer agent** that verified 24 factual claims against the code (6 were wrong and
are corrected below) and ranked **16 risks**; mitigations are inlined under the steps they govern
as `⚠ RISK n MITIGATION` (1 = most product risk). Two of them changed the design: **RISK 2** (an
FK written from a BEFORE INSERT trigger would have refused every package purchase on deploy) and
**RISK 4** (the original supersede fix named an RPC that refuses rather than supersedes). Walk
the pre-commit gate at the bottom before every phase's commit._

## Why

Growth is "the business's own marketing" (PRD) and today the only route in is the tenant join
code (`SWIM-RVM9`), passed by word of mouth. Swim schools near-universally run a refer-a-friend
scheme (Goldfish $33 credit, Big Blue $50, SwimKids $75 each, Aqua Duks "one free lesson each"),
and >90 % of referral programmes are **double-sided**, releasing the reward on the friend's
**first paid purchase**. SwimSync has no discount, coupon or credit-grant mechanism of any kind
— `PRD.md` deliberately bakes volume discounts into the rate. This plan adds the **first price
modifier**, scoped tightly: it touches only what a family *pays* for a package, never what the
package is *worth* (`total_value` / `value_remaining` / invoice `package_applied` are untouched).

## What already exists — build on it, do not re-invent (read before coding)

| Primitive | Where (verified 2026-08-15) | Reuse |
|---|---|---|
| Tenant join code + `join_tenant_by_code(p_code)` — DEFINER, uppercase/trim, ONE generic error for every failure (`that join code was not recognised`), suspension refusal, `ON CONFLICT … DO UPDATE is_active` re-entry | latest body `20260813000300_tenant_suspension.sql:526-585`; grants `20260719000200:70-71` + anon revoke `20260804000200:116`; app `app/(parent)/home/join-tenant.tsx:29-50` | The referral code is a **second kind of join code** resolved by the same RPC. Same normalisation, same single error string. **Its `RETURNS TABLE` changes ⇒ DROP + recreate ⇒ ACL and COMMENT are destroyed (§7.150)** — see RISK 8. |
| `generate_join_code()` — 4 chars, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `random()`, `SWIM-` prefix | `20260718000500:71-82` | Copy; new prefix `REF-`, 5 chars. Not a secret ⇒ no DEFINER/CSPRNG need (§7.160 does not apply). |
| `parent_tenants(parent_id, tenant_id, is_active, joined_at)`; `authenticated` holds **SELECT only** (`20260804000600:111`, INSERT revoked `20260804000500:79`) | `20260718000500:93` | The referral code lives **on the membership row** (a parent can be in several tenants) and is read-only to clients by construction. |
| `handle_new_user()` — SECURITY DEFINER (must stay so), inserts `profiles` + `parents (profile_id)` | **latest body `20260806000100_co_admins.sql:145-195`** (five migrations define it; §7.115) | Copies `raw_user_meta_data->>'join_code'` into `parents.signup_join_code`. |
| `parents_update_self` — a parent CAN update their own `parents` row (`profile_id = auth.uid()`); `pin_parent_identity` pins only `profile_id` | `20260719002000_parent_address.sql:41-68` | The parent's own UPDATE clears `signup_join_code`. The column is therefore **client-writable** (§7.157) — harmless: it is only ever *read* by the client and passed to the RPC, which validates. |
| `register.tsx` — `signUp({options:{data:{full_name, role}}})` `:58-67`; **no session when email confirmation is on** (`:103-106`), and the post-signup `profiles`/`parents` updates at `:86-102` silently fail in that case | `SwimSyncApp/app/(auth)/register.tsx` | The code MUST travel in `user_metadata`, not in a post-signup update. |
| Lifecycle trigger `enforce_parent_package_lifecycle()` — INSERT overwrites every term (`NEW.total_value := lesson_count × rate`, `:94`); UPDATE pins terms + system-owned columns (`current_user = 'authenticated'` block `:172-181`); INVOKER | **`20260815000500_package_offers.sql:68-254`** — no later migration redefines it | Base price is set **here** (RISK 10); the discount trigger only ever *reduces* it. New sale columns join the pin block (RISK 11). |
| Triggers on `parent_packages` (complete set): `trg_parent_package_lifecycle` BEFORE INS/UPD (`20260720000100:374`), `trg_parent_package_reference` BEFORE INS (`20260809000100:189`), `trg_pin_parent_package_reference` BEFORE UPD (`:252`), `trg_supersede_open_package_offer` **AFTER INSERT**, DEFINER, cancels *other* rows `pending AND offered_by IS NOT NULL AND paid_claimed_at IS NULL` (`20260815000500:311-343`) | | `trg_zz_apply_referral_reward` sorts last of the BEFORE INSERT set. Supersede runs **after** the new row is priced (RISK 4). |
| `create_package_offer()` — DEFINER, `can_admin_tenant`, membership via `parent_tenants` (§7.162), **REFUSES when an offer is open** (`:394-405`) — it never supersedes | `20260815000500:351-411` | The supersede path is a *parent request* or *direct sale* arriving over an open offer. |
| `assign_parent_package_reference()` — DEFINER, mints token + `PKG-` ref **unconditionally**, with an explicit "do NOT restore an IS NULL guard" (`:281-284`) | `20260815000500:257-292` | Doctrine for `assign_referral_code`. |
| `public-package/core.ts` — `amount: row.total_value` (`:84`), select list `:106`, **key set pinned by `core.test.ts`** | | `amount` → `amount_payable`; add `discount_amount`, `total_value`; update the pin deliberately. |
| `package-emails` — recipient is **the package's own parent** (`index.ts:150`, fetched `:70-83`); every template field is that package (`:120-131`); `authorizePackageEmail` is a pure 3-arm switch (`email.ts:36-57`), `offered` requires `status='pending'` | | A `referral_reward` arm needs its **own recipient path** and **none of B's package fields** (RISK 3). |
| `pin_package_product_terms()` pins a **column list** (`lesson_count, rate_per_lesson, validity_months, validity_weeks, category_id, tenant_id`) | **latest body `20260814000400_package_weeks_start_date.sql:74-92`** | New override columns are outside the pin — mutable without change. |
| `tenants` / `package_products` already hold `UPDATE` for `authenticated` under admin-only policies (`20260718000500:192`, `20260720000100:136`) | | Settings + override columns need **no new grant**. |
| Generate-all: calls `create_package_offer` per family then **reads the inserted row back** (`packages/page.tsx:659-663`); WhatsApp price `:685`, queue card `:697`. Its **preview modal** shows catalogue price `lesson_count × rate` (`:1688`), as does Record-sale (`:1438`) | | Read-back is correct by construction; the two pre-insert previews are not (RISK 7). |
| Invoice netting: `package_applied` accumulates per-lesson `p.rate` (`generate-invoices/core.ts:1232-1275`), never `total_value`; there is no package payment ledger | | D14 holds — `amount_payable` is display/QR only. |
| `parents_select` / `profiles_select` (`20260718000900:230-257`) — a parent CANNOT read another parent's identity | | RISK 5: the referrer's list is served by a DEFINER RPC, first names only. |
| Grants doctrine §7.87: `table_grants.test.sql` / `function_grants.test.sql` are written **over the catalogue** (`table_grants.test.sql:6-13`, `function_grants.test.sql:3-10`) — they are NOT lists to extend; a new object with no explicit `REVOKE`/`GRANT` turns them red **unchanged** | | Every new table/function carries its own explicit grants in Migration A. Remote grant dump after deploy (§7.39, §7.89). |
| Rollback convention `supabase/rollback/<ts>_<name>_DOWN.sql` (`20260815000500_package_offers_DOWN.sql` is the precedent) | | RISK 16. |
| `verify-package-renewal.mjs` has **no price assertion**; `verify-packages.mjs:119` asserts `5 lessons · S$150.00` — a **value** cell, survives a price change | | The gate points at the right driver now. |
| Prior precedent: `BACKLOG.md` rejected self-service business signup because join codes are the only proof a family deals with a real business | | A referral code is minted per real member of a real tenant — it does not weaken that argument. Say so in the PRD. |
| No `Share` import and no `expo-clipboard` in `SwimSyncApp/`; the only clipboard precedent is `navigator.clipboard?.writeText` in the admin (`invoices/page.tsx:1426`) | | Copy + Share are **new capability**, not reuse. |

## Decisions (locked with the user, 2026-08-15)

| # | Decision | Answer |
|---|---|---|
| D1 | Shape | **Double-sided.** B (referee) gets a discount on their **first** package; A (referrer) gets a discount on a **later** package. |
| D2 | When A earns | On B's first package reaching **`active`** (*Payment received*, or admin direct active sale) — never on registration or "I've paid". Once per referred family, ever. |
| D3 | How the code is entered | **The referral code IS a join code.** Register screen gains an optional *Join or referral code* field; the Join screen accepts `SWIM-XXXX` **or** `REF-XXXXX`. Entering `REF-…` joins the referrer's tenant **and** records the referral. Tenant join code stays for non-referred families. |
| D4 | Discount configuration | Tenant-wide default (**percent OR fixed $**) + optional **per-product override** (its own type + value). Override **default = NULL = inherit**; **`0` = explicit "no referral discount on this product"** and must be a conscious admin act, never a default. |
| D5 | Stacking | **A queue, one reward per package**, oldest first, FIFO. Three referrals = three discounted packages. |
| D6 | Expiry | **Tenant-wide, configurable, days from earn date; blank = never.** Applies to **A's referrer rewards only.** B's first-package discount does not expire. |
| D7 | Retroactivity | A's reward applies only to packages **created after** it is earned. An already-open offer for A is not re-priced. |
| D8 | Reversal | Cancelling B's package **after** activation does **not** revoke A's reward. |
| D9 | 0-override | A `0` product does **not** consume a queued reward; it waits for the next eligible package. |
| D10 | Cap | Fixed-$ discount caps at the package price; `amount_payable ≥ 0` always. |
| D11 | Surfaces | **Dedicated Referrals admin page** (settings + referrals list + rewards list + actions), per-product override on the product form, discount shown on Packages page / offer / pay page / emails; parent Billing tab shows *Your referral code* (one card **per business**, RISK 9) + share + reward status. The referrer sees the families they brought as **first names only** (RISK 5). |
| D12 | Admin actions | **Void** an unused reward (reason), **Grant** a reward manually (goodwill / forgot-the-code), and **Disable a family's referral code** (RISK 15). Rewards otherwise arise only from real referrals. |
| D13 | Notify | **Email A** when the reward is earned (`referral_reward` type via `package-emails`, own recipient path — RISK 3). B sees the discount on the offer / pay page; no extra email. |
| D14 | Value vs price | The discount is on **what is paid**, not on lesson value: `total_value`, `value_remaining`, invoice `package_applied` unchanged. New `discount_amount` + `amount_payable` on the sale row. |
| D15 | Programme off / unconfigured | The referral relationship is **always recorded** and B's reward always minted at join; the discount is evaluated from the **then-current** settings at purchase. Off / unset / 0 ⇒ discount 0, reward not consumed (same rule as D9). |
| D16 *(from review, RISK 1)* | Same-household guard | A referral whose referee shares a **student, phone or postal code** with the referrer is `void` (`same_household`) at conversion and mints no referrer reward. The admin's manual *Grant* (D12) is the override for a legitimate case. |

## Schema — Migration A `..._referrals.sql` (one migration; `db/referrals` branch → `main` first — §7.55, §7.60)

**Codes**
- `parent_tenants.referral_code TEXT UNIQUE` (globally unique — it is resolved without a tenant) +
  `parent_tenants.referral_code_disabled_at TIMESTAMPTZ` (⚠ **RISK 15**: a leaked `REF-` code is an
  un-rotatable join code; disabling is the admin's revoke path and must exist in Phase 1 because a
  worktree never authors a migration). `generate_referral_code()` = the join-code alphabet, 5 chars,
  `REF-` prefix. Minted by a **DEFINER BEFORE INSERT trigger** `assign_referral_code` —
  unconditionally, retry on collision (the `assign_parent_package_reference` doctrine, §7.160; copy
  its defensive raise). **Backfill** every existing membership inside the migration (RISK 9 in the
  reviewer's list — trivial today, never by hand).

**Tenant settings** (all on `tenants`)
- `referral_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `referral_discount_type TEXT CHECK (IN ('percent','amount'))`, `referral_discount_value NUMERIC(10,2) CHECK (>= 0)`; `percent` additionally `≤ 100`
- `referral_reward_expiry_days INT CHECK (> 0)` — NULL = never

**Per-product override** (on `package_products`; outside the pin list)
- `referral_discount_type`, `referral_discount_value` — same checks; **both NULL = inherit**;
  a CHECK that they are null together or set together.

**`referrals`** — the relationship, one per (referee, tenant)
- `id, tenant_id, referrer_parent_id, referee_parent_id, code_used, created_at,
  status ∈ ('pending','converted','void'), void_reason, converted_package_id, converted_at`
- `UNIQUE (referee_parent_id, tenant_id)`; `CHECK (referrer_parent_id <> referee_parent_id)`

**`referral_rewards`** — the queue, one row per discountable package
- `id, tenant_id, parent_id (beneficiary), kind ∈ ('referee_first','referrer','manual'),
  referral_id NULL (NULL only for manual), status ∈ ('available','reserved','used','expired','void'),
  earned_at, expires_at NULL, reserved_package_id NULL, used_package_id NULL, used_at,
  granted_by NULL, voided_by, voided_at, void_reason`
- ⚠ **RISK 2 MITIGATION** — `reserved_package_id` and `used_package_id`
  `REFERENCES parent_packages(id) DEFERRABLE INITIALLY DEFERRED`. The reserving UPDATE runs
  from a BEFORE INSERT trigger on `parent_packages`, when the package tuple **does not exist yet**;
  a non-deferrable FK's RI check fires at the end of that inner UPDATE and raises, and every
  package purchase in the product dies. **Assertion (pgTAP):** a bare parent
  `INSERT INTO parent_packages (parent_id, product_id)` while a reward is available ⇒ **1 row
  inserted and the reward is `reserved`**; any FK error = fail.
- Expiry is **read-time**: a row is usable iff `status='available' AND (expires_at IS NULL OR
  expires_at > now())`. ⚠ **RISK 14** — there is **no `expire_referral_rewards()`** and no
  DEFINER write on a page load; the admin page *computes* "expired" from `expires_at`. Structural,
  not vigilance.

**`parent_packages`** — sale-row snapshot
- `discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0`, `amount_payable NUMERIC(10,2)`,
  `referral_reward_id UUID REFERENCES referral_rewards`
- ⚠ **RISK 10 MITIGATION** — add `amount_payable` **nullable → `UPDATE … SET amount_payable =
  total_value` → `SET NOT NULL`** (a `NOT NULL` add with no default fails on a populated table).
  The **base** is owned by `enforce_parent_package_lifecycle`'s INSERT branch —
  `NEW.discount_amount := 0; NEW.amount_payable := NEW.total_value;` immediately after
  `NEW.total_value := …` (`20260815000500:94`) — so every fixture and pgTAP insert is correct
  even if the referral trigger is dropped; `apply_referral_reward` only ever *reduces* it.
- ⚠ **RISK 11 MITIGATION** — `discount_amount`, `amount_payable`, `referral_reward_id` join the
  `current_user = 'authenticated'` pin block (`20260815000500:172-181`). `parent_packages_update`
  is row-scoped (`20260813000300:348-355`): without the pin a parent PATCHes `amount_payable` to
  `0.01` and the QR honours it. **Assertion (pgTAP, shown RED before the pin — §7.25):** a
  parent's direct UPDATE of each of the three columns raises.

**Functions / triggers**
1. `referral_discount_for(p_product_id) RETURNS (type, value)` — product override if type not
   null, else tenant default if `referral_enabled`, else `(NULL, 0)`. STABLE, pure, testable.
   **`preview_package_price(p_parent_id, p_product_id) RETURNS (total_value, discount_amount,
   amount_payable)`** — DEFINER, `can_admin_tenant`, applies exactly the rule in (2) without
   reserving; **the one source of truth for every pre-insert preview** (RISK 7).
2. `apply_referral_reward()` — **DEFINER BEFORE INSERT** on `parent_packages`, named
   `trg_zz_apply_referral_reward` so it sorts **after** `trg_parent_package_lifecycle` (trigger
   order is alphabetical — assert in pgTAP that it sees `NEW.total_value` set). ⚠ **RISK 1-family
   scoping (§7.158):** the reward query is filtered `parent_id = NEW.parent_id AND tenant_id =
   NEW.tenant_id`, always. Candidate predicate: usable rewards for that pair, **plus** rewards
   `reserved` by a row of the same pair that `supersede_open_package_offer` is about to cancel
   (`status='pending' AND offered_by IS NOT NULL AND paid_claimed_at IS NULL`) — released and
   re-reserved in the same statement. That is ⚠ **RISK 4 MITIGATION**: supersede is AFTER INSERT,
   so the old row still holds the reward while the new row is priced, and `create_package_offer`
   cannot release it (it *refuses* on an open offer; it never supersedes). Picks
   `ORDER BY earned_at, id` **`FOR UPDATE SKIP LOCKED`** (two concurrent inserts must not reserve
   one reward twice), re-checking `expires_at` **at reservation** (RISK 13). Computes
   `discount = LEAST(total_value, round(percent × total / 100, 2) or amount)`; if `discount = 0`
   (D9 / D15) → leaves the base, reward untouched. Else sets the three columns and marks the reward
   `reserved` (`reserved_package_id = NEW.id` — defaults are materialised before BEFORE-row
   triggers, and the FK is deferred per RISK 2).
3. `settle_referral_reward()` — **DEFINER AFTER INSERT OR UPDATE** on `parent_packages`, same
   explicit scoping:
   - `pending → active` with `referral_reward_id` ⇒ reward `used`, `used_package_id`, `used_at`.
     ⚠ **RISK 13 MITIGATION** — re-check `expires_at` here too: a reward that expired **while
     reserved** settles as `expired` and the discount is zeroed **only if the row is unclaimed**
     (`paid_claimed_at IS NULL`); a claimed row keeps its price (RISK 6 rule).
   - `pending → cancelled` (parent cancel, supersede) with `referral_reward_id` ⇒ reward back to
     `available` (or `expired`); the package row keeps its snapshot.
   - **Conversion:** any transition to `active` where the parent has a `referrals` row as referee
     with `status='pending'` and this is their first active package in the tenant ⇒
     ⚠ **RISK 1 MITIGATION (same-household guard, D16)** first: if the referee shares any
     `parent_students` student, `profiles.phone`, or `parents.postal_code` with the referrer ⇒
     referral `void`, `void_reason='same_household'`, **no reward minted**; else referral
     `converted`, `converted_package_id`, INSERT a `referrer` reward for A with `expires_at = now()
     + tenant.referral_reward_expiry_days` (NULL if unset). Idempotent by the referral status.
   - Active-package cancel ⇒ **nothing** (D8).
4. `join_tenant_by_code(p_code)` — extended: if no `tenants.join_code` matches, look up
   `parent_tenants.referral_code` where the membership `is_active`, `referral_code_disabled_at IS
   NULL`, tenant not suspended. Referral recorded iff (a) referrer ≠ joiner, (b) the joiner had **no**
   `parent_tenants` row for that tenant before this call, (c) the joiner has no `parent_packages` in
   that tenant. When recorded: INSERT `referrals` (pending) + INSERT a `referee_first` reward (no
   expiry). Every failure keeps the **one generic message** `that join code was not recognised`
   (anti-probing) — including disabled code, inactive referrer, self-referral. Returns
   `TABLE(tenant_id, display_name, referred BOOLEAN)`.
   ⚠ **RISK 8 MITIGATION** — the changed `RETURNS TABLE` forces **`DROP FUNCTION` + recreate**,
   which destroys the ACL and COMMENT (§7.150); on cloud the fallback is **EXECUTE to anon**
   (§7.39) while local looks fine. **Adjacent to the DROP, in the same migration:** `REVOKE ALL …
   FROM PUBLIC; REVOKE EXECUTE … FROM anon, service_role; GRANT EXECUTE … TO authenticated;
   COMMENT ON FUNCTION …` — the `student_package_coverage()` precedent at `20260815000500:432-434`.
   **Assertion:** the post-deploy remote grant dump for this function reads exactly
   `REVOKE PUBLIC + GRANT authenticated`; **any `anon` row = fail.**
5. `grant_referral_reward(p_parent_id, p_reason)` — DEFINER, `can_admin_tenant`; inserts kind
   `manual`, expiry per tenant. `void_referral_reward(p_reward_id, p_reason)` — only `available`
   / `reserved`. ⚠ **RISK 6 MITIGATION (prohibition)** — **refuses when the reserved package has
   `paid_claimed_at IS NOT NULL`**, and *no code path anywhere in this plan changes
   `discount_amount` / `amount_payable` on a row that carries a payment claim* — a WhatsApp'd QR at
   the discounted amount under a live `PKG-` reference must never silently become a higher amount
   (§7.159's family, on the amount axis). On an unclaimed reserved row, void zeroes the discount.
   `disable_referral_code(p_parent_tenant_id)` / re-enable — DEFINER, `can_admin_tenant` (RISK 15).
   `my_referrals()` — DEFINER, for the **parent**: the families they brought as **first name only**
   + status + dates (RISK 5).
6. `handle_new_user` (**latest body `20260806000100:145-195`**, keep DEFINER) — copy
   `raw_user_meta_data->>'join_code'` into new column `parents.signup_join_code`. Parent home
   applies it once via the RPC and clears it with the parent's own UPDATE (`parents_update_self`).

**RLS + grants (§7.87 — every one explicit, or the catalogue-driven grant tests go red unchanged)**
- `referrals`: SELECT for admins of the tenant, and for a parent where they are referrer **or**
  referee — ⚠ **RISK 5 MITIGATION (prohibition):** *no arm is added to `parents_select` or
  `profiles_select`*; the referrer's policy row exposes `status` / `created_at` / `converted_at`
  and ids only; names come from `my_referrals()` (first name). **Assertion (pgTAP):** a referrer
  selecting the referee's `profiles` row returns **0 rows**. No client INSERT/UPDATE/DELETE.
- `referral_rewards`: SELECT for admins and the beneficiary. No client writes.
- `parent_tenants.referral_code`: readable through the existing SELECT policies (no change).
- `tenants` settings + `package_products` overrides: existing admin UPDATE grants cover them.
- EXECUTE on every new RPC to `authenticated` only (+ explicit `REVOKE … FROM PUBLIC, anon,
  service_role`), and the join RPC re-granted per RISK 8.

**Rollback (⚠ RISK 16):** `supabase/rollback/<ts>_referrals_DOWN.sql` committed alongside — drops
two tables, three `parent_packages` columns, six `tenants`/`package_products`/`parent_tenants`
columns, two triggers, six functions, and **restores `join_tenant_by_code`, `handle_new_user` and
`enforce_parent_package_lifecycle` from `pg_get_functiondef()` taken BEFORE the migration** (§7.93,
§7.115), with their grants and comments. **Assertion:** after UP then DOWN on a fresh reset,
`pg_get_functiondef()` for those three matches the pre-migration text **byte-for-byte**, and
`supabase test db` scores its pre-migration totals.

## Delivery — 4 phases, each shippable, backend-first (§7.60: migration → functions → apps)

### Phase 1 — Migration A + engine-side functions + pgTAP (~2 days)
1. **Capture** `pg_get_functiondef()` of the three functions above into the DOWN file first
   (RISK 16). Write Migration A on `db/referrals`, apply, `supabase test db`.
2. `supabase/tests/referrals.test.sql` — every assertion **red before, green after** (§7.25):
   - code minted on membership INSERT and backfilled; format `REF-` + 5 of the alphabet; unique;
     disabled code refused with the generic message.
   - **RISK 2:** parent bare INSERT with a reward available ⇒ 1 row, reward `reserved`, no FK error.
   - join by `REF-` code: membership + `referrals(pending)` + `referee_first` reward; by `SWIM-`
     code: no referral row; `referred` flag correct.
   - self-referral, referrer inactive, disabled code, tenant suspended, joiner already a member,
     joiner already holds a package ⇒ **identical** error text (`is(SQLERRM, …)`) / no referral.
   - `referral_discount_for`: inherit; percent; amount; cap at price; product `0` ⇒ 0; product
     override beats tenant; disabled tenant ⇒ 0. `preview_package_price` = the inserted row's
     numbers for the same inputs (RISK 7).
   - reserve on INSERT (parent request, admin offer, admin direct active); release on cancel;
     consume on activate; FIFO `earned_at, id` across three rewards; expired reward skipped at
     reservation **and** at settle (RISK 13, unclaimed row zeroed; claimed row untouched);
     **trigger order** (`apply` sees `total_value`); **RISK 4:** parent requests while a discounted
     offer is open ⇒ the new row carries the discount and exactly one reward is `reserved`.
   - conversion exactly once (re-UPDATE of the same row does not mint a second referrer reward);
     expiry set from tenant days; D8; **RISK 1:** shared student / phone / postal ⇒ `void
     same_household`, no reward.
   - **RISK 11:** parent UPDATE of `discount_amount` / `amount_payable` / `referral_reward_id`
     raises (red before the pin). Parent cannot write `referral_rewards.*` / `referrals.*`.
   - **RISK 6:** `void_referral_reward` on a reward reserved by a `paid_claimed_at` row raises.
   - **RISK 5:** referrer selecting referee's `profiles` ⇒ 0 rows; `my_referrals()` returns first
     name only.
   - **RISK 1-family:** a parent's insert cannot reserve another family's reward (cross-tenant and
     cross-parent).
   - grants: RPCs callable by admin, refused for a parent (grant/void/disable); anon nothing;
     `table_grants.test.sql` + `function_grants.test.sql` green **without edits** (RISK 8).
3. `public-package/core.ts`: `amount: row.amount_payable`, add `discount_amount` and `total_value`
   to the payload + select; update the `core.test.ts` key-set pin deliberately. `package-emails`:
   new type `referral_reward` — ⚠ **RISK 3 MITIGATION (prohibition):** *its recipient is resolved
   from `referral_rewards.parent_id` (the referrer), never from the package's `parents` row, and
   its data object carries no field derived from the referee's package — no `packageName`,
   `lessonCount`, `ratePerLesson`, `totalValue`, `payUrl`*; it says only "S$X / Y % off your next
   package, expires <date>" and the business name; new `authorizePackageEmail` arm (caller admin of
   the reward's tenant). `email.test.ts` asserts the built HTML contains **none** of B's strings.
   Offered / confirmed templates print `amount_payable` with a discount line when > 0. **Deno suite
   ×2** (§7.15).
4. Merge `db/referrals` → `main`; deploy: `supabase db push` → `migration list --linked` shows
   `remote` filled → `functions deploy public-package`, `functions deploy package-emails` →
   `functions list` → **remote grant dump** (`docs/DEPLOYMENT.md` §11.7), and **RISK 8:** the
   join RPC's row shows `REVOKE PUBLIC + GRANT authenticated`, no `anon`. ⚠ **RISK 12
   MITIGATION** — the deploy is *nearly* invisible: `join_tenant_by_code` already accepts `REF-`
   codes and mints rewards before any UI exists, and `public-package` returns new keys to the old
   bundle. Replace the prose claim with two post-deploy assertions:
   `SELECT count(*) FROM parent_packages WHERE amount_payable IS DISTINCT FROM total_value` = **0**
   and `SELECT count(*) FROM tenants WHERE referral_enabled` = **0**.

### Phase 2 — parent app (~1 day, no migration)
1. `register.tsx`: optional *Join or referral code* field → `signUp({ options: { data: { …,
   join_code } } })` (metadata — the post-signup updates fail without a session). Parent home: on
   mount, if `parents.signup_join_code` is set → `rpc('join_tenant_by_code')` → clear via own
   UPDATE → toast "Joined <business>" (+ "your first package is discounted" when `referred`).
   Manual check on the local stack with **email confirmation ON**, completing on a second browser
   profile.
2. `join-tenant.tsx`: placeholder `SWIM-1234 or REF-ABCDE`; success copy names the business it
   resolved to and uses `referred`.
3. Billing tab: **Your referral code** — ⚠ **RISK 9 MITIGATION:** one card **per
   `parent_tenants` row**, labelled with `tenants.display_name` (a family at a school and a private
   coach has two codes; one card sends friends to the wrong business). *Copy* via
   `navigator.clipboard?.writeText` on web (the admin precedent) and *Share on WhatsApp* via a
   `wa.me/?text=…` link — **`Share.share` is not available on RN-web and is not imported anywhere;
   do not add `expo-clipboard` for one button.** **Rewards** block: "1 reward waiting — 10% off
   your next package · expires 14 Nov" / "reserved on your pending package". Referred families via
   `my_referrals()` (first names). Pending/active rows and `/package/[token]` show `total_value`,
   `− discount`, **`amount_payable`**; QR amount = `amount_payable`. **`Alert.alert` is a no-op on
   RN-web** — toast/inline only.
4. **The price surfaces** (reviewer's list — each classified; **do all PRICE ones in this
   commit**):
   PRICE → `amount_payable`: **`billing/paynow.tsx:91,95` (the in-app PayNow QR — a second,
   easily-missed price surface)**, `package/[token].tsx:89-95, :194`.
   VALUE (keep): `billing/index.tsx:577, :584-585`; `package/[token].tsx:197` (`n lessons · S$r
   each` — no longer sums to the headline, so the explicit "− discount" line is mandatory).
   Plumbing: `billing/index.tsx:200, :246` select lists.
5. jest: share-text builder; discount line formatter; two-membership card shape (RISK 9).
   Typecheck. Push (`main` = deploy).

### Phase 3 — admin (~1.5 days, no migration)
1. **Referrals page** (`SwimSyncAdmin/app/(admin)/referrals/page.tsx`, sidebar entry): settings
   block (enable toggle, type segmented, value, expiry days — inline editor pattern from Students
   `:343-370`); *Referrals* table (referrer, referee, joined, status incl. `void same_household`,
   converted on/package); *Rewards* table (beneficiary, kind, status with **expired computed
   client-side from `expires_at`** — RISK 14: no DEFINER write on load); actions **Grant** (family
   picker + reason), **Void** (reason; the RPC refuses on a claimed row — surface that message),
   **Disable code** per family (RISK 15).
2. Packages page: product form gains *Referral discount* — default shows "Inherits tenant default
   (10 %)", with an explicit *Override* toggle revealing type+value; **`0` requires the toggle**
   (D4). ⚠ **RISK 7 MITIGATION** — the **Record-sale** (`:1438`) and **Generate-all preview**
   (`:1688`) pickers call `preview_package_price(parent, product)` and render its
   `amount_payable`, never `lesson_count × rate`; pending (`:867, :900`) / active (`:939`) tables,
   the WhatsApp message price (`:685`) and queue card (`:697`), and the **Payment received confirm
   modal (`:1485` — the number the admin ticks off against the bank)** all show `amount_payable`
   with a discount chip. VALUE cells keep `total_value` (`:891, :933, :1200, :1213, :1544`,
   products table). Plumbing: select lists `:215, :282, :661`. After *Payment received*, if the
   activated row converted a referral (`referrals where converted_package_id = id`), call
   `package-emails` type `referral_reward` with the **reward id** (best-effort, like the others).
3. Students Actions drawer: *Referred by* / *Referrals: n* line (read-only; link to the page).
4. vitest: discount preview helper (must equal the SQL for the same inputs — share fixtures with
   the pgTAP cases), override-vs-inherit resolver, page state reducers. Typecheck. Push last.

### Phase 4 — driver + docs (~½ day)
1. `.claude/skills/run-ui-playwright/drivers/verify-referrals.mjs` (+ fixtures/teardown, own
   class/product ids — §7.163): A's code visible → B registers with it → B's offer shows discount
   → **RISK 7 assertion: the Generate-all preview string, the WhatsApp message price and the
   `/package/<token>` headline are byte-identical** → admin *Payment received* → A's reward appears
   → A's next offer discounted → void refused on a claimed row → same-household void. Register in
   `run-all-drivers.sh` / nightly.
2. `/update-docs`: PRD §7.16 *Referral discounts* subsection (incl. why a `REF-` code does not
   weaken the join-code argument); `docs/DEPLOYMENT.md` §11.23; graduate the gotchas below; strike
   the BACKLOG row.

**Total ≈ 5 days.** Phase 1 first and alone; 2 and 3 are independent of each other after Phase 1
is on prod.

## Out of scope (say no if asked mid-build)
Referral links / QR (`swimsync.sg/join?ref=`); rewards as invoice credit or cash; caps on
referrals per family; device/IP fraud checks beyond the same-household guard; a scheduled expiry
sweep or a "your reward expires soon" email (cron-gated — file beside the low-balance nudge);
referral on **invoices** (monthly-billed families) — package-only by design; per-package expiry;
parent-editable codes; a parent-side referral leaderboard.

## Pre-commit gate — walk before EVERY phase's commit

**The five that decide whether real money or PII goes wrong (a box that can't be ticked is a blocker):**

- [ ] **RISK 2** — FKs on `referral_rewards` are `DEFERRABLE INITIALLY DEFERRED`; the bare
      parent-INSERT-with-reward pgTAP is green.
- [ ] **RISK 1** — same-household pgTAP green (student / phone / postal each), red before.
- [ ] **RISK 3** — `email.test.ts` proves the reward email carries none of B's strings and goes to
      the referrer's address.
- [ ] **RISK 4** — "request over an open discounted offer keeps the discount" pgTAP green.
- [ ] **RISK 5** — referrer sees 0 `profiles` rows of the referee; no new arm on
      `parents_select` / `profiles_select` (grep the migration).

**The rest, per phase:**

- [ ] RISK 6 void-on-claimed raises · RISK 11 three-column parent UPDATE raises (was red) ·
      RISK 13 expired-while-reserved settles `expired`
- [ ] RISK 8 join RPC re-granted adjacent to its DROP; grant tests green **with no edits**;
      **remote grant dump shows no `anon` on it**
- [ ] RISK 10 `amount_payable` added nullable → backfilled → NOT NULL; lifecycle INSERT sets the base
- [ ] RISK 12 the two post-deploy counts are 0 · RISK 16 UP→DOWN restores the three functions
      byte-for-byte
- [ ] RISK 7 previews call `preview_package_price`; the driver's three-way price equality passes ·
      RISK 9 one card per business · RISK 14 no `expire_*` DEFINER function exists · RISK 15
      disable path exists and is generic-error on join
- [ ] Price surfaces: every PRICE line in the Phase 2/3 lists is `amount_payable`, including
      `billing/paynow.tsx` and the confirm modal `:1485`; `verify-packages.mjs:119` (value) still green
- [ ] Deno suite run **twice** (§7.15); pgTAP; vitest; jest; both typechecks; apps land on `main`
      **last** (§7.60)

**Graduate to `docs/GOTCHAS.md` §7 at `/update-docs`** (append the next numbers, never renumber):
1. **An FK written from inside a BEFORE INSERT trigger points at a row that does not exist yet** —
   the RI check fires at the end of the inner statement, not the outer one. Make it `DEFERRABLE
   INITIALLY DEFERRED` or don't write it there. (RISK 2)
2. **A resource reserved by a BEFORE INSERT trigger is invisible to the AFTER INSERT trigger that
   would free it** — a same-statement handoff must be resolved inside the BEFORE trigger's own
   predicate; the RPC cannot help when it refuses rather than supersedes. (RISK 4)
3. **A discount is a price concept, not a value concept**: `total_value` / `value_remaining` never
   move; only `amount_payable` does. Grep every `total_value` render and classify it — the in-app
   PayNow QR (`billing/paynow.tsx`) is a second price surface distinct from the tokenised pay page.
4. **Two BEFORE INSERT triggers on one table run alphabetically** — a trigger that depends on
   another's `NEW.*` must sort after it, and a pgTAP assertion should pin that. (Reasoning already
   inline at `20260815000500:263-271`; graduate as the general rule.)
5. Fold into **§7.150** as a second example: changing a `RETURNS TABLE` is a **security event** —
   the DROP eats the grants and on cloud the fallback is EXECUTE to `anon`, so "it still works
   locally" is the failure mode.
6. Sibling of **§7.159**: never re-price (`amount_payable`) a row that carries `paid_claimed_at` —
   the family already used that amount and reference.
