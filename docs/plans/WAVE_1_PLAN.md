# Wave 1 — the eight cheap items everything after inherits

_Planned 2026-08-09 via `/plan-with-confidence`. Source of the ranking:
`BACKLOG.md` → **Build order** → *Wave 1*. That list stays the single source of truth for
**what** is in the wave; this file is **how** to build it._

Wave 1 is eight `S` items in `BACKLOG.md`, estimated there at ~2 weeks. **Two decisions
taken while planning changed that estimate** — see *Decisions settled* below. It is now
**seven S + one M, three migrations, ~3 weeks.**

---

## Decisions settled 2026-08-09 (do not re-litigate)

| Question | Answer | Consequence |
|---|---|---|
| Horizon | **Full 8-item program**, executed across ~4 sessions | This file exists so the wave survives a session boundary |
| The two schema changes | **Strictly serial**, no worktrees | One migration in flight at a time (`CLAUDE.md`). Became **three** — see the row below |
| Item #6 scope | **Engine fix *and* build class deactivation** | Promotes #6 from S to M and adds a third migration. Wave 1 is ~3 weeks, not 2 |
| Deactivating a class with **active enrolments** | **Refuse**, naming the children | Nothing is destroyed implicitly; the leave date stays the admin's explicit choice via `close_student_enrolment()` |
| Deactivating a class with **live guest bookings** | **Hard refuse**, naming child + date | A guest is expected there and nowhere else. Both `trial_bookings` **and** `makeup_bookings` |
| Where the package reference surfaces | **Admin Packages page + parent PayNow screen** | Minting a reference nobody can match is not worth a migration |
| Deploy cadence | **Per item, as each lands** | Smallest blast radius; three separate deploys with full ceremony each |

---

## Chunk 1 — Fix the signal first (no migration, no deploy)

**~1 session, 4–6h.** Goes first because the nightly sweep is the primary evidence for
every chunk after it, and one non-hermetic driver makes the whole sweep lie
(§8.30, §8.33, §7.100).

### Step 1.1 — `verify-levels.mjs` becomes hermetic (BACKLOG #8)

It asserts an empty-ladder state as check 1, then creates levels and leaves them behind, so
the second run of the day fails on the first run's data.

- Delete the tenant's `tenant_levels` in a setup step **and again on exit**, the way
  `fixtures-*-teardown.sql` does elsewhere.
- Keep the admin half runnable alone — an admin-only failure must not require port 8081.

**Assertion:** run it **twice in a row with no `supabase db reset` between**. Both runs must
report the same check count. A second run that differs from the first means it is still
carrying state.

> **⚠ RISK 8 MITIGATION — a bare `DELETE FROM tenant_levels` destroys real data silently.**
> `students.level_id` is `ON DELETE SET NULL` (`20260719001800_tenant_levels.sql:70`), so the
> delete **never errors** — it blanks the level of every student pointing at that row,
> including departed ones, and nothing anywhere records what it was (**§7.69**). The database
> is shared with the seed stack, every fixture, and any sibling checkout (**§7.55**).
>
> - **Named prohibition:** do NOT write `DELETE FROM tenant_levels WHERE tenant_id = …`.
>   Scope every delete to rows this driver owns, by label prefix, exactly as
>   `fixtures-levels-table-teardown.sql:23` does (`WHERE label LIKE 'LvlTbl %'`). Pick a
>   distinct prefix for this driver and use it on both the create and the delete.
> - ~~**Step:** delete in the order `tenant_level_skills` → `tenant_levels`.~~ **N/A to what
>   was built** — the cleanup deletes through the admin UI, which cascades skills itself.
>   The rule still governs `fixtures-admin-table-geometry-teardown.sql`, where it is followed.
> - ~~**Step:** teardown must null Maya Tan's `students.level_id` back explicitly.~~
>   **Superseded by what was built:** her seed value *is* NULL, and the driver deletes the
>   level it put her on, so `ON DELETE SET NULL` restores exactly the seed state. Verified
>   by count, not by argument: 0 → 0 across three consecutive runs.
> - **Assertion (pass/fail):** before the change, record
>   `SELECT count(*) FROM students WHERE level_id IS NOT NULL;`. After running the driver
>   twice and its teardown twice, the count must be **identical**. Any decrease is this
>   risk firing.
> - ~~**Structural, not vigilance:** put the teardown in a committed
>   `fixtures-levels-teardown.sql` … so `check-teardowns.sh` and
>   `check-fixture-roundtrip.sh` cover it from day one.~~ **WRONG — corrected 2026-08-09
>   while implementing.** Both scripts open with
>   `for f in fixtures-*.sql; do case "$f" in *-teardown.sql) continue ;; esac`, so they
>   iterate **fixtures** and a teardown is only ever reached as a *sibling* of one. A
>   `fixtures-levels-teardown.sql` with no `fixtures-levels.sql` beside it is invisible to
>   **both** guards — the coverage this bullet promised does not exist. It would also still
>   be a human step nobody is forced to run.
>
> **What was built instead — and it is strictly more structural.** The driver removes its own
> levels **through the admin UI** (`cleanupOwnLevels()`), both before check 1 and in the
> `finally` block. No SQL file, no human step, and a crashed run self-heals on the next one.
> Foreign levels are never deleted: check 1 **fails and names the offending fixture** rather
> than tidying it away.

> **⚠ RISK 8b — DISCOVERED WHILE IMPLEMENTING, 2026-08-09. The delete was not the only way to
> blank a child's level; a POSITIONAL LOCATOR did it too, and this one actually fired.**
> `verify-levels.mjs` selected its student with `page.locator("select").nth(2)`, commented
> *"Maya Tan is the 3rd student alphabetically"* — true of the seed and of nothing else. With
> `fixtures-levels-table.sql` loaded, its three `LvlTbl Child …` rows shift the ordering,
> `nth(2)` resolves to **somebody else's child**, the driver writes its own level onto them,
> and teardown then blanks it through the same `ON DELETE SET NULL`. **Measured, not
> theorised: `LvlTbl` children holding a level went 3 → 2.**
>
> - **Named prohibition:** no driver may reach a row by ordinal position when the row has a
>   name to match on. `nth(n)` over a list whose length depends on which fixtures happen to
>   be loaded is a shared-database bug wearing a locator's clothes.
> - **Step:** scope to the row —
>   `page.getByRole("row").filter({ hasText: "Maya Tan" }).locator("select")` — which cannot
>   resolve to a foreign student no matter what else is on the page.
> - **Assertion (pass/fail):** load `fixtures-levels-table.sql`, run the driver, and compare
>   `count(*) FROM students WHERE full_name LIKE 'LvlTbl %' AND level_id IS NOT NULL` before
>   and after. It must be **unchanged**, and `count(*) … WHERE label LIKE 'LvlTbl %'` must
>   be unchanged too. Verified 2026-08-09: 3 → 3 levels, 2 → 2 children, driver 8/9 with
>   only the empty-state check red — which is the correct answer, not a regression.

### Step 1.2 — Column geometry across the admin tables (BACKLOG #7)

`verify-levels-table.mjs` measures each `<th>`'s rect against its column's `<td>`. Exactly
one of **sixteen** admin table pages has this check. *(The backlog says "the other 13" and
"one of fourteen"; the real count, grepped 2026-08-09, is 16 pages rendering a `<Table>`.)*

- Lift the ~15-line assertion into `drivers/lib.mjs`.
- Point it at every admin route that renders a table — **16 of the 22 `page.tsx` files**
  under `SwimSyncAdmin/app/(admin)/`. **15 are swept**; `/platform` is excluded because it
  is a platform-admin page and renders nothing at all for a tenant admin.
- **Skip-and-log on an empty table, never silently pass.** Print the skipped list at the
  end. A page reported as "checked" when it had no rows is how §7.54 survives a second time.

**The cost is fixtures, not the assertion** — several admin tables are empty on the seed
stack. Expect ~60% of this step's time there.

> **⚠ RISK 9 MITIGATION — `drivers/lib.mjs` is the shared file, and a consolidated helper is
> not the same helper.**
> §7.56 says plainly: **"do not edit it, since it is shared with every worktree."** The
> *Not doing* section's "no worktrees" decision is what makes this step legal at all —
> **that dependency is now load-bearing, so if a worktree is ever opened during Wave 1 this
> step is blocked, not merely awkward.** And §7.98: two drivers' copies of "the same" helper
> were not the same, and consolidating them without reading both turned two attendance-guard
> checks red.
>
> - **Step:** add the geometry check as a **new named export** in `lib.mjs`. Do NOT modify or
>   re-shape any existing export. `verify-levels-table.mjs` keeps working through the new
>   export unchanged.
> - **Assertion (pass/fail):** run `verify-levels-table.mjs` before and after the lift. Its
>   check count and its **pass/fail per check** must be identical. A changed count means a
>   check was lost in the move.
> - **Named prohibition:** do NOT re-derive the tolerance. It is **2px, calibrated** against a
>   488px known-broken measurement (`verify-levels-table.mjs:44`, §7.54). Carry the number and
>   the calibration comment across verbatim.
> - **Named prohibition:** do NOT assert on React `validateDOMNesting` warnings. §7.54 records
>   that React logged **nothing** on the known-broken page; `verify-levels-table.mjs:163-172`
>   deliberately reports without asserting. Keep that shape.
> - **Structural:** the skip-and-log path must make a vacuous run **fail**, not pass — a driver
>   that asserted nothing and exited 0 is exactly §7.100 (two weeks of green on a driver that
>   checked nothing) and §7.79. Concretely: after the sweep, `if (checked === 0) fail()`, and
>   print the skipped list. A note saying "watch for empty tables" is not enough.
> - **Watch (vigilance — no structural option available):** §7.71, a table whose columns all
>   use `w-full` renders one column at 110px while every text assertion still passes. The
>   geometry check catches misalignment, not a nominated-nothing width. Record any table where
>   a column measures under ~80px and file it; do not silently widen it in this step.

### Step 1.3 — Documentation drift caught while planning

`HANDOVER.md`'s *Where everything lives* table still reads `§7.1–§7.99`; §7.100 shipped
2026-08-09. One line.

**Chunk 1 is done when:** both drivers green on two consecutive runs,
`check-fixture-roundtrip.sh` green at **17/17** — this chunk adds the 17th fixture, so 16/16
is the *pre-change* number and would mean the new one went missing — CI green.
**Nothing deploys.**

---

## Chunk 2 — Migration 1 of 3: package references and the PayNow chain

> **✅ SHIPPED AND DEPLOYED 2026-08-09** (`74fb16e`, migration `20260809000100`). HANDOVER
> §8.37. Mitigations that were **wrong or superseded** are struck in place below rather
> than deleted — the corrections are the durable part. Three new gotchas came out of it:
> **§7.104** (`current_user` is dead inside `SECURITY DEFINER`), **§7.105** (a boundary
> case is only worth the values where the two answers disagree), **§7.106**, **§7.107**.

**~1.5 sessions, 8–10h.** Branch `db/package-references` **in the root checkout** — a
worktree never authors a migration.

### Step 2.1 — Mint a payment reference on `parent_packages` (BACKLOG #1)

A package purchase gets no reference and no dynamic QR, so a parent still scans a static
image and types the amount by hand — the exact unattributable payment the reference was
introduced to remove.

- New column + per-tenant counter + **BEFORE INSERT** trigger, mirroring
  `20260802000600_payment_collection_schema.sql` and `20260802000800_reference_overflow.sql`.
- Format `PKG-YYYY-NNNN`. **Year from `requested_at` in SGT**, via `today_sg()` — not
  `CURRENT_DATE` (§7.94) and not `toISOString()` (§7.7).
- **Carry the `LPAD` overflow fix (§7.77).** Postgres `LPAD` *truncates* past the pad width;
  the pad must grow beyond 9999. This was latent in two prior counters.
- The migration must include **its own `GRANT`** (§7.87). A new function is callable by
  nobody until its migration grants it.
- Write a **committed** rollback file `supabase/rollback/20260809_package_references_DOWN.sql`,
  following the `20260806_co_admins_DOWN.sql` pattern.

> **⚠ RISK 4 MITIGATION — trigger ORDER decides which tenant's counter is drawn, and the
> obvious name gets it wrong.**
> Postgres fires same-timing row triggers in **alphabetical order by trigger name**.
> `parent_packages` already has `trg_parent_package_lifecycle`
> (`20260720000100_lesson_packages.sql:374`, `BEFORE INSERT OR UPDATE`), and **that trigger is
> what sets `NEW.tenant_id`** — line 268, `NEW.tenant_id := v_product.tenant_id`, because
> "the product decides the business and the terms; the client cannot."
> The parent's request inserts `{ parent_id, product_id }` and **no `tenant_id` at all**
> (`SwimSyncApp/app/(parent)/billing/index.tsx:271`). So a trigger named
> `trg_assign_package_reference` sorts BEFORE `trg_parent_package_lifecycle`, sees
> `NEW.tenant_id = NULL`, and the `next_invoice_ref` clone raises *"cannot number … for
> unknown tenant"* (`20260802000600_payment_collection_schema.sql:108`) —
> **every parent package request fails at the insert.** The admin path
> (`SwimSyncAdmin/app/(admin)/packages/page.tsx:317-324`) supplies a client-side `tenant_id`
> that the lifecycle trigger then overwrites, so there a reference can be minted against a
> *different* tenant's counter than the row ends up in.
>
> - **Structural mitigation (this is the fix — do not substitute a comment for it):** name the
>   trigger so it sorts **after** the lifecycle trigger. `trg_parent_package_reference` works
>   (`…_l` < `…_r`). Do NOT name it `trg_assign_*`, `trg_a*`, or anything sorting before
>   `trg_parent_package_lifecycle`.
> - **Second structural layer:** in the trigger function, `IF NEW.tenant_id IS NULL THEN RAISE`
>   with a message naming the ordering. Ordering is invisible in a schema dump; a loud failure
>   at apply time is the only thing that survives a future rename.
> - **Assertion (pass/fail):** a pgTAP test that inserts a package request **as the parent
>   role, supplying no `tenant_id`**, and asserts the row comes back with (a) the product's
>   tenant and (b) a reference of `PKG-<that tenant's year>-0001`. Prove it **red first**
>   (§7.25) by temporarily renaming the trigger to `trg_a_package_reference` — it must fail.
>   A test that only inserts as admin passes under the broken name and proves nothing.
> - **Assertion:** `grep -rn "\.upsert(" SwimSyncApp SwimSyncAdmin supabase | grep parent_packages`
>   must return **zero rows** before this trigger lands (§7.57 — a BEFORE INSERT trigger also
>   fires for rows that resolve to an UPDATE). Today it does; record the result in the commit
>   so a future upsert has something to contradict.

> **⚠ RISK 5 MITIGATION — the function you are cloning was anon-callable in production, and
> copying a function does not copy its ACL.**
> §7.82: `next_credit_note_ref(uuid)` — the same `SECURITY DEFINER` +
> `UPDATE tenants SET …_counter = …_counter + 1` shape — shipped with **no ACL at all**, and an
> unauthenticated `POST /rest/v1/rpc/next_credit_note_ref` with the anon key returned
> `CN-2026-0001` and burned the tenant's counter. §7.85: a new function in `public` is callable
> by nobody until its own migration grants it — but §7.39/§7.89: **cloud default privileges
> grant EXECUTE on new public functions to anon/authenticated/service_role**, and the local
> stack does not reproduce that, so a local `pg_proc` check is vacuous by construction.
>
> - **Step:** write both revokes explicitly, copying `20260802000600:115-119` verbatim in
>   shape: `REVOKE ALL … FROM PUBLIC;` **and** `REVOKE EXECUTE … FROM anon, authenticated,
>   service_role;`. `FROM PUBLIC` alone does not remove role grants.
> - **Named prohibition (§7.78):** the assignment trigger function stays **`SECURITY
>   DEFINER`**, and `next_package_ref` is callable by **nobody, including `service_role`**. If
>   a future permission error appears on `next_package_ref`, the bug is that the DEFINER hop
>   was flattened — do NOT "fix" it with a `GRANT`.
> - **⚠ CONSEQUENCE DISCOVERED WHILE IMPLEMENTING, 2026-08-09 — §7.104.** Because that
>   function is DEFINER, `current_user` inside it is the **owner**, so the codebase's
>   standard client seam `current_user = 'authenticated'` is **dead code there and fails
>   open**. The first version used it to refuse a client-supplied `reference_number`; the
>   refusal never fired. That matters more than it sounds: `parent_packages_insert` lets the
>   owning PARENT insert, the counter is only advanced by `next_package_ref`, so a squatted
>   number leaves the counter behind it and the **next genuine request dies on
>   `parent_packages_tenant_reference_key`** — the buy-a-package path breaks for that whole
>   business. Fixed by minting unconditionally (no role test needed at all). **Do not
>   reintroduce an `IS NULL` guard or a `current_user` check in that function.**
> - **Confirmed by the remote dump:** `next_package_ref` and
>   `assign_parent_package_reference` came out of production with **no grant lines at all**;
>   `pin_parent_package_reference`, which the migration wrote no REVOKE for, came out with
>   cloud's default `GRANT ALL … TO service_role`. Whatever you do not revoke, `service_role`
>   gets (`docs/DEPLOYMENT.md` §11.7).
> - **Assertion (pass/fail):** extend `supabase/tests/function_grants.test.sql` (currently
>   `plan(3)`) with a fourth assertion — *"next_package_ref is callable by NOBODY"* — checking
>   anon **and** authenticated **and** service_role, matching lines 58-71 exactly. Assertion 1
>   (`pg_proc`-wide, no anon EXECUTE) already covers it generically; the named one is what makes
>   a regression readable.
> - **Step:** the remote grant dump in Step 2.7 must be diffed for `next_package_ref`
>   specifically, not just taken. §7.89 — three migrations in one day each probed only what
>   they changed and left a cell of the role × object-type grid open.

> **⚠ RISK 6 MITIGATION — existing `parent_packages` rows, and the year source.**
> `20260802000600:159-186` is the pattern and it has four moves the plan's Step 2.1 does not
> name: backfill existing rows, reset the tenant counter from the backfill, **then**
> `SET NOT NULL`, **then** the `UNIQUE (tenant_id, reference)` constraint. Skip the backfill and
> either the `NOT NULL` aborts `db push` against production, or live pending package requests
> carry a NULL reference — which means Step 2.2's dynamic QR cannot build for them and they
> land on the dead end described under RISK 3.
>
> - **Step:** backfill with `ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY requested_at,
>   id)`, then `UPDATE tenants SET package_counter = (SELECT count(*) FROM parent_packages …)`,
>   then `SET NOT NULL`, then `ADD CONSTRAINT … UNIQUE (tenant_id, reference)`. That order.
> - **Named prohibition on the year:** the plan says "Year from `requested_at` in SGT, via
>   `today_sg()`". Those are two different values — `today_sg()` reads the **clock**.
>   Use the ROW: `to_char(NEW.requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY')`. Column
>   defaults are applied before BEFORE triggers, so `NEW.requested_at` is always populated.
>   `CURRENT_DATE` and `NOW()` in a function are the **session's** time zone, UTC here (§7.94),
>   and `today_sg()` would put a backfilled or late-inserted row in the wrong year.
> - ~~**Assertion (pass/fail):** a pgTAP case inserting with `requested_at` set to
>   `'2025-12-31 23:30:00+08'` must mint `PKG-2025-…`, not `PKG-2026-…`.~~ **THIS ASSERTION
>   CANNOT FAIL — corrected 2026-08-09 while implementing.** 23:30 SGT on 31 Dec is 15:30
>   **UTC on the same day**, so the SGT-correct and the UTC-broken derivations *both* answer
>   2025. Written that way it passes against the exact bug it was written to catch; verified
>   by running it against `to_char(NEW.requested_at, 'YYYY')`, where it stayed green.
>   **The discriminating case is `'2026-01-01 00:30:00+08'`** — still 2025 in UTC — which
>   goes red under the broken version and green under the correct one. Both cases are in
>   `package_references.test.sql`; the second is the one doing the work. Generalised as
>   **§7.105**: before writing a boundary case, ask which value would *differ* if the guard
>   were wrong. Test the guard **at its boundary** — §7.94's 14-test file missed a live bug
>   because every test sat far from it — but pick the side of the boundary where the two
>   answers disagree.
> - **Assertion:** `LPAD(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0')` — copy
>   `20260802000800_reference_overflow.sql:38` byte-for-byte, and pin the 10,000th reference in
>   pgTAP the way `payment_collection.test.sql:158` does. Plain `LPAD(…, 4, '0')` **truncates**.

### Step 2.2 — Unlock the dynamic QR on the parent's screen

`(parent)/billing/paynow.tsx:51` returns early on the `packageId` path before it ever
reaches `buildPayNowPayload()`.

- Remove the early return; build the payload with the package's `total_value` and its new
  reference, amount and reference locked.
- Leave the `Platform.OS === "web"` gate alone — native still skips the dynamic path.

> **⚠ RISK 3 MITIGATION (part 1 of 3) — the package query does not fetch the proxy columns,
> and the payload builder throws.**
> `paynow.tsx:54` selects `tenants(display_name, paynow_qr_url)` — **no `paynow_uen`, no
> `paynow_mobile`**. The invoice branch selects them at `:79`. Removing the early return alone
> gives you a screen that can never build a dynamic QR, silently.
>
> - **Step:** widen the package select to
>   `tenants(display_name, paynow_qr_url, paynow_uen, paynow_mobile)` and set `reference` from
>   the package's new column. Do NOT `as`-cast the result (§7.76) — a renamed field then reads
>   blank forever with no error.
> - **Step:** reuse the **existing** `selectPayNowProxy` + `buildPayNowPayload` +
>   `try/catch` block at `paynow.tsx:104-128` rather than writing a second copy. §7.18: four
>   hand-written copies of one rule caused a live underbill.
> - **Named prohibition:** do NOT remove or widen the `catch {}` at `paynow.tsx:125`. It is
>   `lib/paynow.ts`'s RISK 2 contract — *a malformed payload fails loudly in the bank app, but a
>   wrong-yet-valid one pays the wrong amount silently*, so the lib throws rather than encode
>   garbage. The throw is correct; what must change is where it lands (RISK 3 part 2).
> - **Assertion (pass/fail):** `verify-packages.mjs:73-78` already opens this screen and asserts
>   the package price (5 × $30 = $250). Run it **before** the change and record the check count;
>   after the change it must still pass, plus one new check that the reference string renders.
>   A driver that stops finding the price is this step breaking the screen, not a flake.

### Step 2.3 — The PayNow screen stops calling the business "Coach" (BACKLOG #3)

Same file, copy only, no logic.

- *"{name}'s PayNow QR Code"* — `name` is the **business** display name (PRD §7.10).
- The empty state currently says *"QR not uploaded yet. Contact your coach directly"*,
  which now describes a business that has not configured PayNow and tells the parent to
  chase someone who may not be able to fix it.

> **⚠ RISK 3 MITIGATION (part 2 of 3) — this empty state is the dead end, so make it payable.**
> `paynow.tsx:191-198` is reached whenever `dynamicQr` is null **and** `paynow_qr_url` is null.
> Today that is survivable because a business can always upload a static image. Step 2.5 removes
> that escape (see RISK 3 part 3). This step is the structural fix and **must land in the same
> commit as Step 2.5, not after it.**
>
> - **Step:** when there is no QR of either kind but the business has a `paynow_uen` or
>   `paynow_mobile`, render the proxy, the amount and the reference **as selectable text** with
>   "Transfer to this PayNow ID". A parent can then always pay by hand. This converts the dead
>   end into the pre-QR flow, which is what every SwimSync parent used before 2026-08-02.
> - **Step:** keep a genuinely-unconfigured business's empty state distinct from the above, and
>   name the fix — *"This business hasn't set up PayNow yet"* — so the parent chases the right
>   thing.
> - **Assertion (pass/fail):** with a tenant whose `paynow_uen`, `paynow_mobile` **and**
>   `paynow_qr_url` are all NULL, the screen must show the "hasn't set up PayNow yet" copy. With
>   `paynow_mobile = '912345678'` (nine digits — see RISK 3 part 3) and `paynow_qr_url` NULL, the
>   screen must show a **payable** proxy + amount + reference, never a grey placeholder. Both
>   states, both directions.
> - This is the mitigation that makes the whole PayNow chain fail **safe** rather than fail
>   **silent**, and it inherits to every future case — prefer it over any amount of care in
>   Step 2.5.

### Step 2.4 — Reference column on the admin Packages page

`SwimSyncAdmin/app/(admin)/packages/page.tsx`. This is what makes the reference worth
minting: an incoming PayNow line has to be matchable to a request.

### Step 2.5 — Demote the static PayNow QR upload (BACKLOG #2)

`(coach)/settings/index.tsx`: render the upload **only** when the business has no
`paynow_uen` and no `paynow_mobile`.

- **Do NOT delete it.** Two live consumers remain: native builds (where `paynow.tsx` skips
  the dynamic path entirely) and — until Step 2.1 ships — package payments. The
  2026-08-08 decision table says native stays web-only, so the fallback stays alive.

> **⚠ RISK 3 MITIGATION (part 3 of 3) — HIGHEST-VALUE ITEM IN CHUNK 2. Hiding this upload can
> leave a business with NO way to be paid, and it does not need native to happen.**
> `(coach)/settings/index.tsx:127` is the **only** writer of `tenants.paynow_qr_url` anywhere in
> the product — grep both apps and confirm before you touch it. Hiding it removes the only
> upload path. The reachable failure, entirely on web:
> 1. An admin types a mobile with a typo. `handleSavePaynow` stores
>    `blankToNull(normalizeSgPhone(raw))` (`SwimSyncAdmin/app/(admin)/invoices/page.tsx:183`),
>    and `normalizeSgPhone` (`SwimSyncAdmin/lib/sgPhone.ts:48-53`) only **strips non-digits** —
>    `912345678` is saved as nine digits. `checkSgPhone` is advisory and "never blocks"; there is
>    no DB `CHECK` (`20260802000600:44-47`).
> 2. `selectPayNowProxy` returns it as a proxy, so the "business has configured PayNow" test
>    passes and this step **hides the upload**.
> 3. `buildPayNowPayload` throws on `!/^\d{8}$/` (`SwimSyncApp/lib/paynow.ts:64`). `paynow.tsx:125`
>    swallows it and falls back to `paynow_qr_url` — which is NULL, because the business was
>    never offered the upload.
> 4. The parent sees *"QR not uploaded yet. Contact your coach directly."* **Nobody at that
>    business can pay.** A blank `display_name` reaches the same place via `paynow.ts:75`, and on
>    native the `Platform.OS === "web"` gate (`paynow.tsx:109`) sends **every** parent there
>    unconditionally.
>
> **✅ THE STRUCTURAL OPTION WAS TAKEN.** The upload is collapsed behind
> *"Fallback QR image — advanced"*, always present. The conditional-hide branch below was
> **not** built, so its mandatory dry-run gate never applied. `verify-paynow-fallback.mjs`
> asserts the disclosure survives all three PayNow states and was proven red by applying the
> naive `hasPaynowId` hide. The `paynow_uen`-has-no-validation watch item is filed in
> `BACKLOG.md` as *"A PayNow ID can be saved that no QR can be built from"*.
>
> - **Structural mitigation — prefer this and say why if you don't take it:** do NOT gate on
>   *"a proxy string exists"*. **Collapse the upload behind a disclosure ("Fallback QR image —
>   advanced"), always present, never conditionally removed.** That makes the dead end
>   impossible instead of unlikely, and it survives every future throw path `lib/paynow.ts`
>   grows. The BACKLOG item asks for the upload to stop being the *primary* affordance; a
>   disclosure delivers that without removing the escape hatch.
> - **If the conditional hide is taken anyway, then this is mandatory:** gate on
>   `buildPayNowPayload()` **actually succeeding** for this tenant — call it in the settings
>   screen with a $1 dry-run and the tenant's stored proxy, and hide only when it returns a
>   string. A stored-but-unencodable proxy must keep the upload visible. Gating on
>   `selectPayNowProxy() !== null` is the bug.
> - **Step:** `(coach)/settings/index.tsx:51` currently selects **only `paynow_qr_url`**. It
>   must also select `paynow_uen, paynow_mobile` before any of this is possible.
> - **Named prohibition:** do NOT ship Step 2.5 without Step 2.3 part 2 in the same commit. The
>   dead end is the whole risk; the copy change is its fix.
> - **Assertion (pass/fail):** there is **no test and no driver anywhere that touches
>   `app/(coach)/settings`** — confirmed by grep across both test suites and all 38 drivers. So
>   this step ships blind unless you add coverage. Add checks to a driver: with
>   `paynow_uen` set the upload is hidden; with `paynow_mobile = '912345678'` (unencodable) the
>   upload is **visible**; with neither set the upload is visible. Prove the middle case red
>   against a naive `selectPayNowProxy` gate first (§7.25) — it is the case that decides whether
>   this risk is real, and it is the one a happy-path driver will not reach.
> - **Watch (vigilance — no structural option):** `paynow_uen` is stored raw with no validation
>   at all (`invoices/page.tsx:183` uses `blankToNull(raw)`). A garbage UEN produces a
>   *valid-looking* QR that pays nowhere — `lib/paynow.ts`'s RISK 2 "wrong-yet-valid" case. This
>   step removes the fallback an admin would have used to work around it. Out of scope to fix;
>   file it in `BACKLOG.md`.

### Step 2.6 — Link to the admin panel from coach Settings (BACKLOG #4)

Same screen as 2.5, batch them.

- Gate on the existing `canEditQr` check (`(coach)/settings/index.tsx:62`,
  `profile?.role === "tenant_admin"`). A school coach without the role must not see it.

> **⚠ RISK 10 MITIGATION — the link lands on a gate that will refuse some of the people who can
> see it, and `canEditQr` is a stricter question than "may open the admin panel".**
> §7.91: admin-panel **entry** is the one deliberate exception to "never gate on role" — the
> login page and `RequiresTenant` refuse `coach`/`parent` profiles with *"please use the
> SwimSync app"*. `canEditQr` reads `profile?.role === "tenant_admin"`, which is the same
> predicate, so the link is aimed correctly **today**.
>
> - **Named prohibition:** if the link is ever reported as "broken" for someone, do **NOT**
>   loosen the admin-panel entry gate to fix it. §7.91 records that gate as deliberate.
> - **Watch (vigilance — no structural option):** since `20260806000100_co_admins.sql` a
>   `tenant_admin` can be **suspended** via `admin_disabled_at`, and `is_tenant_admin()` then
>   returns false while `profiles.role` still reads `tenant_admin`. Such a user sees the link and
>   is refused at the panel. Acceptable (they are suspended), but do not make `canEditQr` the
>   authority on anything beyond showing a link.
> - **Step:** the link target is the deployed panel origin, not a relative path — this screen is
>   the Expo app on a different domain. `https://admin.swimsync.sg`. Assert it opens in a new
>   tab on web and does not attempt in-app routing.
> - **Assertion (pass/fail):** log in as a plain `coach` and confirm the link is **absent**, not
>   merely disabled. Absence is the assertion; a disabled-looking link is still a leak of the
>   panel's existence to a role that cannot use it.

### Step 2.7 — Deploy

**Order: migrations → apps.** No engine change in this chunk.

1. `supabase db push`, then `supabase migration list --linked` — no empty `remote` column.
2. Remote grant dump (§7.39, §7.89) — local and cloud disagree by construction.
3. Push to `main` (this is the app deploy).
4. Grep the served bundle for a string only this build has (§7.31, §7.51). A 200 proves
   nothing.

**Chunk 2 is done when:** pgTAP covers the counter past 9999, both typechecks pass, and the
package QR path is exercised by a driver.

---

## Chunk 3 — Migration 2 of 3: the students audit trigger

**~half a session, 3–4h.** Branch `db/students-audit`.

### Step 3.1 — `AFTER UPDATE` trigger on `students` (BACKLOG #5)

Two admin paths update `students` straight from the client and record nothing: the level
picker (`setLevel()`) and the **parent contact details** modal. `provisional_contact_phone`
and `_email` are the top two ranked signals in `find_student_candidates()` — they decide
which parent is offered which child, and once a claim is approved nothing can unlink them
except that flow's own undo (§7.47).

- A **trigger**, not an RPC per call site. This supersedes what `CONTACT_DETAILS_PLAN.md`
  proposes: an RPC fixes one screen and leaves `setLevel()` and every future direct write
  unaudited. The trigger is atomic for the same reason, needs **no client change**, and is
  inherited automatically.
- Record `to_jsonb(OLD)` and `to_jsonb(NEW)`, not "edited". The dispute this exists for is
  *what the number used to be*.
- Derive `tenant_id` from the row's own `tenant_id` column, so it starts life correctly
  attributed.
- **Do NOT audit from the browser.** Since `20260804000300` a browser-written audit row for
  a `students` edit is refused outright.
- Check the write volume before landing — the invoice engine touches this table under
  `service_role`.
- Committed rollback file; execute it (§7.93).

> **⚠ RISK 2 MITIGATION — RANK 2 OVERALL. As written, this trigger REFUSES every student edit
> in the product. It is not a volume problem; it is a permissions problem.**
> The plan's own bullet — *"Do NOT audit from the browser; since `20260804000300` a
> browser-written audit row for a `students` edit is refused outright"* — **applies to the
> trigger too unless the trigger is `SECURITY DEFINER`.** A plain trigger function runs as the
> caller, so `current_user` is still `authenticated` and the RLS policy still applies:
> `audit_log_insert` (`20260804000300_audit_log_tenant_id.sql:189-196`) permits `authenticated`
> to insert **only** `entity_type = 'lesson_session' AND coach_owns_session(entity_id)`. An
> `entity_type = 'Student'` row is refused → `42501` → **the `students` UPDATE aborts**
> (§7.88: post-`20260804000600` a disallowed write raises rather than matching zero rows, and
> §7.66/§7.67: a raising trigger kills the whole statement). That breaks the admin level picker,
> the admin contact-details modal, the coach roster (`(coach)/classes/[id]/roster.tsx:295`) and
> the **parent's own edit-child screen** (`(parent)/home/edit-child.tsx:93` — §7.86: parents
> PATCH `students` directly).
> `20260804000300:69-74` states the design explicitly: *"Every other writer is inside a SECURITY
> DEFINER function, which runs as the table owner and is not subject to policies."*
>
> - **Step (mandatory):** the trigger function is
>   `SECURITY DEFINER SET search_path = public`. Without it this step cannot work at all.
> - **Assertion (pass/fail):** pgTAP — `SET LOCAL ROLE authenticated`, set a tenant admin's JWT
>   claims, `UPDATE students SET level_id = …`, assert **the update succeeds** *and* an
>   `audit_log` row exists with `entity_type = 'Student'`. Then the same as a **parent** on their
>   own child. Prove both **red** by dropping `SECURITY DEFINER` (§7.25). A test that only writes
>   as `postgres` passes against the broken build and proves nothing.
>
> **The second abort vector: `actor_id` is `NOT NULL REFERENCES profiles(id)`**
> (`20260309000100_initial_schema.sql:232`, §7.50). `auth.uid()` is **NULL** on every path with
> no JWT — a data-fix migration, `psql`, a seed, an edge function under `service_role`. NULL
> actor → NOT NULL violation → the `students` UPDATE aborts. There are ~15 `UPDATE students`
> sites in `supabase/migrations/` already; the next one would fail `supabase db push` **against
> production**.
>
> - **Structural mitigation:** `IF auth.uid() IS NULL THEN RETURN NEW; END IF;` — better,
>   resolve the actor as `SELECT id FROM profiles WHERE id = auth.uid()` and `RETURN NEW` when it
>   is NULL, which also survives a `auth.users` row with no `profiles` row. An audit gap on a
>   backend path is recoverable; a refused student write is not.
> - **Named prohibition:** do NOT make `audit_log.actor_id` nullable to solve this. It is
>   depended on elsewhere and §7.50 is the reason it is `NOT NULL`.
> - **Assertion (pass/fail):** pgTAP — `UPDATE students …` as `service_role` **and** as
>   `postgres` with no JWT. Both must **succeed**, and write **no** audit row. Prove red by
>   removing the guard.
>
> **The third abort vector: the `entity_type` string is a closed set.**
> `audit_log_tenant_of` (`20260804000300:77-110`) is a `CASE` over exactly `'Student'`,
> `'Class'`, `'lesson_session'`, `'ParentTenant'` and **`RAISE`s on anything else** — and it runs
> from `set_audit_log_tenant`, a `BEFORE INSERT` trigger on `audit_log`. `'student'`,
> `'students'` or `'Students'` therefore aborts the `students` UPDATE.
> - **Named prohibition:** the value is exactly `'Student'`. Do not invent a new one, and do not
>   add an arm to `audit_log_tenant_of` for this step.
> - The plan's *"derive `tenant_id` from the row's own `tenant_id` column"* bullet is **already
>   done for you** — `set_audit_log_tenant` derives it from the entity and **overwrites**
>   whatever you supply (`:139-142`), and `audit_log_tenant.test.sql:100` pins that. Supplying it
>   is harmless; relying on your value is wrong.

> **⚠ RISK 2b MITIGATION — this step sits directly against a standing prohibition, and the
> audit trail it creates is deletable.**
> **§7.61**: status propagation on `students`/families is *deliberately not a trigger and must
> not be "tidied" into one* — a trigger fires after the write and cannot ask the user anything.
> That prohibition is about **propagation**, not **recording**, so a pure append-only audit
> trigger does not violate it. **Write that distinction into the migration header**, naming
> §7.61, or the next session reads this trigger as the prohibited thing and reverts it.
>
> - **Step:** the trigger writes to `audit_log` and **nothing else**. Named prohibition: it must
>   never `UPDATE` another table, never cascade a status, never raise on a business rule. The
>   moment it does either, §7.61 applies and this design is wrong.
> - **Known limitation to record in the migration header, not to fix here:**
>   `prepare_admin_delete()` **purges the target's `audit_log` rows** — `actor_id` is a NOT NULL
>   FK with no cascade (`20260806000100_co_admins.sql:56`). So deleting a departing admin
>   destroys exactly the contact-detail history this trigger exists to preserve, which is the
>   dispute most likely to need it. State it; do not silently ship a trail that evaporates.
> - **Volume — the plan's premise is wrong, and that is good news:** the invoice engine only
>   **SELECT**s `students` (`core.ts:667`, `core.ts:885`, `email.ts:325`). It never updates it.
>   Engine-driven write volume from this trigger is **zero**, and an engine run cannot be aborted
>   by it. **Assertion:** `grep -n 'from("students")' supabase/functions/**/*.ts` shows only
>   `.select(` — confirm before landing, and re-confirm if the engine ever gains a write.
> - **Watch (vigilance):** `to_jsonb(OLD)`/`to_jsonb(NEW)` copies the child's full row —
>   including `provisional_contact_phone`/`_email` and date of birth — into a table with
>   different retention and a platform-admin reader. That is the point, but note it in the
>   column comment so nobody later treats `audit_log` as low-sensitivity.

### Step 3.2 — Deploy

**Migration only.** Nothing in either app changes, and nothing reads `audit_log` yet.

---

## Chunk 4 — Migration 3 of 3: inactive classes, engine and deactivation

**~1.5 sessions, 10–12h.** The only chunk that touches money. Branch `db/class-deactivation`.

### Step 4.1 — The engine stops skipping inactive classes (BACKLOG #6, part 1)

`supabase/functions/generate-invoices/core.ts:352` scans `.eq("is_active", true)`, so
deactivating a class at month end silently drops its billable lessons **and** stops it
blocking generation — a hole exactly where someone is tidying up.

- Bill from classes that had sessions in the month **regardless of `is_active`**.
- `is_active` means **scheduling only** from here on.

> **⚠ RISK 1 MITIGATION — RANK 1 OVERALL. This can PERMANENTLY block a billing month with no
> override and no screen anywhere that can clear it.**
> `core.ts:352` is not only a billing filter; it decides which classes enter the **completeness
> gate** at `core.ts:463-715`. Widen it and an inactive class with `student_class_enrolments.
> is_active = true` re-enters the loop: `activeStudentIds` is non-empty → `expectedDates` is
> every weekly date in the month (`core.ts:592-594`) → there are no `lesson_sessions` → 
> `unmarkedOn()` returns everyone (`core.ts:642-652`) → `blocking` → the hard stop at
> `core.ts:927-953`, which the engine's own comment says has **no bypass and must never grow
> one** (`core.ts:684-692`).
>
> **The clearing path does not exist.** To clear it someone must mark attendance on that class —
> but the class is invisible to every role:
> - coach class list: `.eq("is_active", true)` — `SwimSyncApp/app/(coach)/classes/index.tsx:79`
> - coach Schedule tab: `.eq("is_active", true)` — `SwimSyncApp/app/(coach)/schedule/index.tsx:318`
> - admin Classes page: `.eq("is_active", true)` — `SwimSyncAdmin/app/(admin)/classes/page.tsx:235`
>
> So the month blocks, the coach cannot mark it, the admin cannot see it, and
> **`reactivate_class()` from Step 4.2 has no screen to be called from.** This is §8.32's
> deadlock through a new door — and `markable_floor()` does **not** rescue it, because that is a
> *date* gate and the obstruction here is *visibility*. Every parent of that business goes
> unbilled for the month.
>
> - **Step 1 — production data audit BEFORE the engine deploys. Pass/fail, and a fail is a
>   blocker, not a caveat.** Against production, run:
>   `SELECT c.id, c.title, c.tenant_id, count(e.*) FILTER (WHERE e.is_active) AS live_enrolments
>    FROM classes c LEFT JOIN student_class_enrolments e ON e.class_id = c.id
>    WHERE c.is_active = false GROUP BY 1,2,3;`
>   **The expected answer is zero rows** (no UI deactivates a class today). Any row with
>   `live_enrolments > 0` **will block that tenant's next billing month the day this deploys.**
>   Close those enrolments with `close_student_enrolment()` first, or do not deploy.
> - **Step 2 — narrow the scope so the failure cannot be created.** Do **not** widen to "all
>   classes". Bill from a class when it **had `lesson_sessions` in the month** — which is the
>   actual BACKLOG #6 complaint — and keep the *expected-dates* half of the gate driven by
>   whether the class was schedulable. Concretely: an inactive class contributes its recorded
>   attendance, but does **not** generate `expectedDates` for weeks it was not running. This is
>   the structural mitigation: it delivers the fix and makes the deadlock unreachable. A plain
>   `.eq()` deletion delivers the fix *and* the deadlock.
> - **Named prohibition:** whatever shape is chosen, do **NOT** add an override, a `force` arm,
>   or a tenant flag to the unmarked-attendance block to work around a class that turns out to
>   block. §7.8 — a safety gate the only live caller bypasses is not a gate. Fix the data or fix
>   the scan; never the gate.
> - **Step 3 — a class that blocks must be reachable.** Step 4.3 must ship the "show inactive"
>   affordance in the **same deploy** as this engine change. See the mitigation there.
> - **Assertion (pass/fail) — the discriminating Deno test this change needs:** a class with
>   `is_active = false`, one **active** enrolment, and no `lesson_sessions` in the month. Assert
>   the run's `status` is **not** `incomplete_attendance`. Prove it **red** against a naive
>   `.eq()` deletion (§7.25) — it must fail there, or the test is not testing this.
> - **Assertion — the existing suite will NOT catch you.** `classes.is_active = false` appears
>   in exactly **one** place in the whole Deno suite: `makeups.test.ts:390`, inside
>   *"unenrolled after booking + home class DEACTIVATED"* (`makeups.test.ts:370`). That test
>   pins the widened `class_rates` union at `core.ts:379-388`, and it pins it **only because
>   deactivating the home class is what removes it from the classes arm.** After this change the
>   class is back in the classes arm, so its rate is fetched either way and **the test goes
>   vacuous while staying green** — it would pass with the union deleted. §7.54's shape exactly.
>   → **Step:** after landing 4.1, delete the `...(makeupRows ?? []).map(m => m.home_class_id)`
>   arm at `core.ts:386` locally and run the suite. If `makeups.test.ts:370` stays **green**, its
>   guard is gone: restore the arm and give the union a test that does not depend on
>   `is_active` (e.g. a home class in a different tenant-visible state, or assert the fetched
>   `class_rates` id set directly). Record the before/after in the commit.
> - **Assertion — `rateOn()` cannot start throwing.** `rates.ts:54-70` is a hard failure with no
>   fallback, and widening the scan brings previously-skipped classes into `priceFor()`. The
>   stated invariant is that *every* class has a floor-dated `'2000-01-01'` rate (seed trigger +
>   the `20260719000700` backfill). Prove it rather than trust it, against production:
>   `SELECT count(*) FROM classes c WHERE NOT EXISTS (SELECT 1 FROM class_rates r WHERE
>    r.class_id = c.id);` — **must be 0.** Non-zero means the next run dies for that whole
>   tenant, not just that class.

> **⚠ RISK 7 MITIGATION — the widened scan can hold a month permanently OPEN even when nothing
> blocks.**
> Inactive classes now also feed `unclaimedAttendance` (`core.ts:836-843`), and
> `unclaimedBillable === 0` is the **fifth sealing condition** (`core.ts:1373`). A retired class
> whose attendance belongs to children with no parent account will keep `monthFinished` false
> forever — the run issues invoices but never seals, so the daily cron re-walks every class
> nightly and the month never closes.
>
> - **Assertion (pass/fail):** against production, before deploying —
>   `SELECT count(*) FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
>    JOIN classes c ON c.id = ls.class_id WHERE c.is_active = false;` — expected **0**. Non-zero
>   means read those students' `parent_students` rows before deploying.
> - The escape hatch already exists and is the right one: a **settlement**
>   (`student_settlements`), not an override — `core.ts:1366-1368`. Named prohibition: do not add
>   a sixth arm to `monthFinished` to work around this.
> - **Step:** run the engine against a **production snapshot** for the current open month, both
>   before and after the change, and diff `invoices_created`, `sealed`, `unclaimed_billable` and
>   `classes_still_incomplete`. Four numbers, before and after. Any movement in `sealed` or
>   `classes_still_incomplete` is this risk or RISK 1 firing and must be explained before deploy.
>   **A dry-run against seed data does not substitute** — the whole risk lives in real retired
>   classes, which seed data does not have.

### Step 4.2 — `deactivate_class()` / `reactivate_class()` (BACKLOG #6, part 2)

No UI deactivates a class today, which is why this has never bitten. Building the path is
what makes 4.1 load-bearing.

**Two hard refusals, both settled 2026-08-09:**

- **Refuse** while any **active enrolment** exists. Name the children and point at
  `close_student_enrolment()`. Nothing is closed implicitly.
- **Refuse** while any **future `trial_bookings` or `makeup_bookings`** row exists on the
  class. Name child + date. Both tables — `book_makeup()` already refuses an
  already-inactive host, but nothing guards deactivating a class that already holds
  bookings.
- **Do NOT add an override to either refusal.**
- The RPC needs its own `GRANT` in its own migration (§7.87), plus a committed rollback
  file, executed.

> **⚠ RISK 1b MITIGATION — the refusals are a destructive-action guard, so they must not read a
> display filter, and they must not be vacuously satisfiable.**
> §7.69: *"the filter that answers 'what should I show?' is not the filter that answers 'what
> will this destroy?' — check what the CONSTRAINT reads."* Here the thing that gets destroyed is
> a **billing month** (RISK 1), and what decides that is not `student_class_enrolments.is_active`
> alone.
>
> - **Named prohibition:** the enrolment refusal must NOT be `WHERE is_active` alone. §7.66:
>   `one_active_enrolment_per_student` is a **partial** unique index, so `is_active` is a
>   point-in-time flag, not a span. Refuse on **any enrolment whose span is open or overlaps the
>   current unsealed billing window** — i.e. `unenrolled_at IS NULL OR unenrolled_at::date >=
>   markable_floor(tenant)`. An enrolment closed *yesterday* still has unmarked lessons this
>   month, and deactivating the class hides them (RISK 1).
> - **Step (structural, closes RISK 1's remaining door):** add a **third refusal** —
>   refuse while the class has any `lesson_sessions` **or expected-but-unrecorded lesson dates**
>   at or after `markable_floor(tenant_id)` that are not fully marked. This is the refusal that
>   makes the deadlock unreachable by construction rather than by the admin remembering to close
>   enrolments first. Name the dates in the error.
> - **§7.17 — a guard made only of "nothing went wrong" negatives is vacuously satisfied on
>   empty input.** All three refusals here are of that shape. **Assertion (pass/fail):** a pgTAP
>   case where the class has **zero** enrolments, **zero** bookings and **zero** sessions must
>   still be reasoned about explicitly — decide whether an empty class may be deactivated, assert
>   that decision, and say so in the function comment. Do not let it fall through by accident.
> - **Assertion (pass/fail), both directions:** every refusal needs a test that it **refuses**
>   *and* a test that it **accepts** once the condition is cleared. A guard that refuses
>   everything satisfies the refusal tests alone — `markable_floor.test.sql` is the precedent
>   (`docs/TESTING.md` §5: *"both directions, because a floor that refuses everything would
>   satisfy the refusals alone"*).
> - **Named prohibition (§7.70):** count enrolments and bookings in SQL inside the RPC. Do NOT
>   let the admin UI decide by `.length` on a fetched array — PostgREST silently caps at
>   `max_rows = 1000`, so a large class would report "no enrolments" and sail through.
> - **Step:** `reactivate_class()` takes **no** refusals and must always succeed. It is the
>   emergency exit from RISK 1; anything that can refuse it can strand a business.

### Step 4.3 — Admin UI

`SwimSyncAdmin/app/(admin)/classes/page.tsx` — deactivate / reactivate, with the refusal
reasons **rendered**, not swallowed.

> **⚠ RISK 1c MITIGATION — as it stands this page filters out exactly the rows the new buttons
> must act on.**
> `loadClasses()` is `.eq("is_active", true)` (`classes/page.tsx:235`). A class deactivated by
> the new button **vanishes from the list on the next load**, so `reactivate_class()` is
> unreachable and RISK 1 has no manual exit.
>
> - **Step (blocking — RISK 1's mitigation depends on it):** drop `.eq("is_active", true)` from
>   `loadClasses()` and add a visible "Inactive" state plus a **Show inactive** toggle,
>   defaulting to hidden. Reactivate lives on the inactive row.
> - **Assertion (pass/fail):** deactivate a class in the UI, reload the page, and reactivate it —
>   without touching SQL. If that round trip cannot be completed through the UI alone, this step
>   is not done.
> - **Named prohibition:** do NOT ship 4.1 and 4.3 in different deploys. An engine that blocks on
>   an invisible class, with no screen that can reveal it, is the RISK 1 deadlock.
> - **Named prohibition (§7.28):** `is_active` exists on `students`,
>   `student_class_enrolments` **and** `classes`, and this page reads a nested
>   `student_class_enrolments(id, is_active)` at `:233`. Reading the flag off the wrong nesting
>   level typechecks clean and renders every class inactive. Assert on a **known-active** class
>   after the change, not only on the deactivated one.
> - **`Alert.alert` is a no-op on RN-web** — but this is the Next.js admin panel, so the refusal
>   dialog is ordinary React. The standing constraint below applies to Chunk 2's coach Settings
>   screen, not here. Do not "fix" this page for a problem it does not have.
> - **Assertion (§7.72, not §7.31):** the admin panel is Next.js and code-splits per route, so
>   after deploying grep the chunk for **the `classes` route specifically** — grepping the root
>   bundle produced eight consecutive wrong conclusions.

### Step 4.4 — Deploy

**Order: migrations → engine → apps, and `main` lands LAST** (§7.60 — got wrong twice).

1. `supabase db push`.
2. `supabase functions deploy generate-invoices` — **a git push does not deploy an edge
   function.** Confirm with `supabase functions list`.
3. Push to `main`.
4. Remote grant dump; grep the served bundle.

> **⚠ RISK 11 MITIGATION — this ordering leaves a window where `deactivate_class()` exists and
> the OLD engine is still live.**
> Step 1 lands the RPC. Step 2 lands the engine. Between them the RPC is callable over
> PostgREST, and a deactivation in that window silently drops that class's billable lessons
> from the month against the old `.eq("is_active", true)` scan — a **permanent underbill**, the
> §7.8/§7.13/§7.32 shape, and there is nothing to unwind it afterwards because sealing is
> irreversible. The window is small only because no UI calls it yet; that is luck, not a
> mitigation.
>
> - **Structural mitigation:** land the RPCs **without a `GRANT`** in step 1, and add
>   `GRANT EXECUTE … TO authenticated` in a **second, separately-numbered migration** pushed
>   *after* the engine deploy confirms. §7.87: a function is callable by nobody until its
>   migration grants it — turn that into the feature flag. Then no client can reach
>   `deactivate_class()` before the engine that makes it safe is live.
> - **Named prohibition:** do NOT number the grant migration alongside the RPC migration.
>   §7.49/§7.30 — `supabase db push` applies **everything** pending, so two files pushed together
>   are one deploy, and the ordering you wrote down did not happen.
> - **Assertion (pass/fail) between steps 2 and 3:**
>   `supabase functions list` shows a `generate-invoices` version stamped **after** the db push,
>   and a manual generation against the current open month returns the same
>   `invoices_created` / `sealed` / `classes_still_incomplete` / `unclaimed_billable` as the
>   pre-deploy dry run under RISK 7. Four numbers. Any difference is a blocker — **roll back the
>   engine before pushing to `main`**, which is still possible at this point and is not once the
>   panel is live.
> - **Named prohibition (§7.60, got wrong twice):** `git push … :main` **is** the app deploy.
>   `main` lands **last**, after the engine is confirmed. The reverse — a panel that can
>   deactivate classes against an old engine — is the underbill above, delivered to every tenant
>   at once.
> - **Rollback path, written down before it is needed:** revert `generate-invoices` by
>   redeploying the previous function build (a git revert does **not** do this), and revoke the
>   grant from step 1's companion migration to make the RPCs unreachable. Neither undoes a seal —
>   if a month sealed wrongly, the documented fix is deleting its `billing_periods` row
>   (`core.ts:1358`, `INVOICE_RUNBOOK.md`).

**Chunk 4 is done when:** the Deno suite is green **twice** (§7.15 — a completing run seals
the billing month, so passing once proves nothing), pgTAP covers both refusal paths, and a
UI driver exercises the refusal dialogs.

---

## Standing constraints for the whole wave

- **`Alert.alert` is a no-op on RN-web.** Chunks 2 and 4 both add confirmations. Use
  `confirmAction` / the global Toast / inline errors.
- **A migration that adds a policy must add the matching `GRANT`.** Never "fix" a
  `permission denied` with a blanket re-grant — `table_grants.test.sql` goes red on any
  privilege no policy permits (§7.87).
- **Tests must be proven to fail without the fix** before they count as coverage (§7.25).
- **Execute every rollback file**, don't merely write it (§7.93). Diff
  `pg_get_functiondef()` after.
- **The test runner is the fact.** Any count written in this file is a hint that has drifted.

---

## Pre-commit gate

Walk this before each chunk's commit. **A box that cannot be ticked is a blocker, not a
caveat.** Every item traces to a `⚠ RISK n MITIGATION` block above — go read it rather than
guessing what the box means.

### The four that stop a deploy

These are the ones where "we'll watch for it" is not an answer. Do not push past a red one.

- [ ] **RISK 1 — the production audit ran and returned ZERO rows** (inactive classes with live
      enrolments; inactive classes with attendance; classes with no `class_rates` row). Three
      queries, all under Step 4.1. A non-zero result is fixed **before** the engine deploys, not
      after.
- [ ] **RISK 1 — 4.1 and 4.3 are in the SAME deploy**, and the deactivate → reload → reactivate
      round trip was completed through the admin UI alone, touching no SQL.
- [ ] **RISK 2 — the `students` audit trigger is `SECURITY DEFINER`**, returns early on a NULL
      actor, and uses `entity_type = 'Student'` exactly. Proven by pgTAP updating a student **as
      `authenticated`** (admin and parent) and **with no JWT** — all three succeed.
- [ ] **RISK 3 — no reachable state leaves a parent unable to pay.** With `paynow_mobile`
      unencodable and `paynow_qr_url` NULL, the PayNow screen shows a **payable** proxy + amount
      + reference. Steps 2.3 and 2.5 shipped in one commit.

### The rest

- [ ] The relevant suites run, and any new test was proven red without its fix (§7.25)
- [ ] **The Deno suite ran TWICE** (§7.15) — Chunk 4. A completing run seals the month.
- [ ] **RISK 1 — `makeups.test.ts:370` was re-checked for vacuity**: the `home_class_id` union at
      `core.ts:386` was deleted locally and the suite went **red**. If it stayed green, the union
      lost its only guard and a replacement test landed in this commit.
- [ ] **RISK 4 — the reference trigger sorts AFTER `trg_parent_package_lifecycle`**, and a pgTAP
      case inserts a package request **as the parent, with no `tenant_id`**, and gets the
      product's tenant and `PKG-…-0001`
- [ ] **RISK 5 — `next_package_ref` is callable by NOBODY**, including `service_role`, asserted in
      `function_grants.test.sql`; the assignment trigger stayed `SECURITY DEFINER` (§7.78, §7.82)
- [ ] **RISK 6 — backfill → counter reset → `SET NOT NULL` → `UNIQUE`, in that order**; the year
      comes from `NEW.requested_at AT TIME ZONE 'Asia/Singapore'`, not `today_sg()`, tested at the
      31-Dec-23:30 boundary (§7.94)
- [ ] **RISK 11 — the RPC grant is a SEPARATELY-NUMBERED migration** pushed after the engine
      deploy is confirmed; `main` lands last (§7.60)
- [ ] **RISK 7 — the four engine numbers** (`invoices_created`, `sealed`,
      `classes_still_incomplete`, `unclaimed_billable`) match before and after, on a **production
      snapshot**, not seed data
- [x] **RISK 8 — no unscoped `DELETE FROM tenant_levels`**; cleanup is prefix-scoped (`LvlDrv `)
      and runs in the driver's own UI, not a teardown file nobody is forced to execute;
      `count(*) FROM students WHERE level_id IS NOT NULL` unchanged across two runs (§7.69).
      **Done 2026-08-09:** 0 → 0 across three consecutive runs
- [x] **RISK 8b — no driver reaches a row by ordinal position where a name exists.** With
      `fixtures-levels-table.sql` loaded, `LvlTbl` levels and `LvlTbl` children holding a level
      are both unchanged by a full run. **Done 2026-08-09:** 3 → 3 and 2 → 2
- [x] **RISK 9 — the geometry check is a NEW export in `lib.mjs`**; `verify-levels-table.mjs`'s
      check count and per-check results are identical before and after; the 2px tolerance was
      carried, not re-derived (§7.54). **Done 2026-08-09:** 12 passed / 0 failed, before and
      after, and the reference driver keeps its own inline copy on purpose
- [ ] `npm run typecheck` in both apps
- [ ] Migration (if any) has its own `GRANT`, and its rollback file was **executed** (§7.93) —
      then `pg_get_functiondef()` diffed against the pre-migration definition
- [ ] Remote grant dump taken after any privilege change, and **diffed for the specific new
      function**, not merely taken (§7.39, §7.89)
- [ ] Deploy order respected; served bundle grepped for a new-build-only **user-visible** string
      (§7.31, §7.51) — and for the admin panel, the **route's own chunk** (§7.72)
- [ ] No `Alert.alert` added
- [ ] **No override added to any refusal, to the unmarked-attendance block, or to `monthFinished`**
- [ ] No worktree was opened during Wave 1 (Step 1.2 edits shared `drivers/lib.mjs` — §7.56)

---

## Not doing, deliberately

- **No worktrees.** Three migrations, strictly serial — parallelism buys nothing here and
  the shared database cannot be reset while a sibling runs.
- **Not folding in the class-ROSTER guest fix** (`BACKLOG.md`, raised 2026-08-09 / §7.100).
  Its note says fold it into whichever item next opens `roster.tsx` — and no Wave 1 item
  does. Waves 2 and 3 both rework that screen.
- **Not extending the geometry check to non-table pages.** The bug class it catches
  (§7.54) is specifically a header row nested in the wrong place.

---

## Graduating to §7

Candidates identified by the 2026-08-09 `/plan-review`, **before** the wave lands. Each is
durable — it outlives Wave 1 and would bite the next person regardless of this plan. Promote the
ones that actually fire; drop the ones that turn out to be wrong.

1. **Same-timing triggers fire in ALPHABETICAL name order, so a new `BEFORE INSERT` trigger can
   read a column an existing one has not written yet.** `parent_packages.tenant_id` is set by
   `trg_parent_package_lifecycle`; the parent's insert supplies none. The obvious trigger name
   (`trg_assign_*`) sorts first and would break every package request. Generalises to any table
   with a lifecycle trigger — the name is load-bearing and invisible in a schema dump.
2. **A trigger that writes to an RLS-protected table is subject to that table's policies unless
   it is `SECURITY DEFINER` — so "use a trigger instead of an RPC" does not escape RLS.**
   `audit_log_insert` permits `authenticated` exactly one `entity_type`; an invoker-rights
   trigger inserting anything else aborts the *originating* write. The counterpart:
   `audit_log.actor_id` is `NOT NULL`, so any trigger writing it aborts every JWT-less path
   (migrations, seeds, `service_role`). Sharpens §7.50 and §7.88 into a rule about triggers.
3. **Widening what the invoice engine SCANS widens what BLOCKS it — the classes query at
   `core.ts:352` feeds the completeness gate, not just the tally.** And a class the gate blocks
   on may be invisible to every screen (`is_active` is filtered in the coach class list, the
   coach Schedule tab and the admin Classes page), which is §8.32's deadlock on a visibility
   axis rather than a date axis. The durable rule: **before changing what the engine
   enumerates, find every screen that could clear the resulting block.**
4. **A conditional hide can remove the only writer of a fallback, and "a value is present" is not
   "a value is usable".** `tenants.paynow_qr_url` has exactly one writer in the whole product;
   `paynow_mobile` has no DB `CHECK` and only advisory client validation, so a stored proxy can
   be unencodable. Gate a fallback's visibility on the primary path **succeeding**, never on the
   primary path being *configured*.
5. **On a shared database, `nth(n)` is a data-corruption bug, not a brittle-selector nit.** A
   positional locator resolves against whatever fixtures happen to be loaded, so a driver can
   write to a row it does not own — and if the write is a level, an FK, or a status, the
   teardown then destroys the victim's data through `ON DELETE SET NULL` while every check
   still passes. Confirmed by measurement 2026-08-09, not predicted: `verify-levels.mjs`'s
   `nth(2)` took an `LvlTbl` child's level (3 → 2). Reach for the row's name; if a row has no
   name to match on, that is the finding. **Promoted ahead of the wave landing — this one is
   already proven and applies to all 38 drivers.**
6. **A test can be made vacuous by the fix it was written to survive.** `makeups.test.ts:370`
   pins the `class_rates` union *only because* the home class is inactive; Step 4.1 removes that
   condition and the test keeps passing while guarding nothing. Extends §7.25 forward in time:
   re-prove a regression test red **after** any change to the mechanism it depends on, not only
   when it is written.
