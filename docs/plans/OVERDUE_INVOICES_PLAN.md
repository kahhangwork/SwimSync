# Overdue invoices — due date, Overdue status, per-invoice extension

_Drafted 2026-11-12, hardened by /plan-review the same day. BACKLOG → *UI restyle leftovers* → **Overdue** (old S7). Ships BEFORE October is billed (user)._

## 1. Decisions (user, 2026-11-12) — not to be re-opened

| # | Decision |
|---|---|
| D1 | **Due date = invoice's SGT generated date + N days.** Due on that day; **Overdue from the day after** (`app_today() > due_date`). |
| D2 | **N is a per-tenant setting**, default **14**. Changing it affects NEW invoices only; stored due dates never move. |
| D3 | Shown on: **admin invoice list + dashboard**, **parent app cards**, **public invoice page**, **invoice email** ("Please pay by …"). |
| D4 | **Claimed beats Overdue** in the tag. Precedence: Paid > Claimed > Overdue > Outstanding. |
| D5 | **An admin can change ONE invoice's due date**: later only, outstanding only, billing-area **Edit**; reason optional; who/when/old/new recorded. |
| D6 | **No parent notification** on a due-date change — the new date just shows. |
| D7 | **WhatsApp reminder text** names the date: "due by 26 Nov" / "was due on 26 Nov". |

Facts that shape it (verified against the local DB and code, 2026-11-12):
- The engine inserts each invoice once and never regenerates it (`core.ts` ~1280, "already_exists" skip). Nothing upserts `invoices` (every write is `.insert()`, `.update()` or an RPC). So a date fixed at insert is stable, and §7.57 does not bite.
- `invoices.generated_at` is `NOT NULL DEFAULT now()`. Defaults are applied before BEFORE triggers, so a trigger always sees it filled.
- `authenticated` holds table-level **SELECT + UPDATE** on `invoices` (no INSERT). The policy `invoices_update` = `is_platform_admin() OR has_admin_area(tenant,'billing','edit')`. The BEFORE UPDATE `pin_invoice_public_fields()` (INVOKER) already pins `reference_number`/`public_token` and `invoice_email_sent_at`/`invoice_email_claimed_at` against `authenticated`.
- `tenants` UPDATE is gated by `guard_tenant_columns()`, an **allowlist** keyed by column. An unmapped column refuses every client save.
- `app_today()`/`app_now()` are executable by `authenticated` and `service_role`, not by anon.
- `public-invoice` reads with the **service role** and maps ANY select error to the shared 404.
- Invoice email is built in three places, all in `generate-invoices/email.ts`: a fresh run (`CreatedInvoice`), the retry (`rebuildInvoices` over `INVOICE_EMAIL_SELECT`) and the admin resend (`/api/resend-invoice-email` → `resend_invoice_email`).
- Prod 2026-11-12: every invoice (Jul–Sep, 25) is paid, so no live outstanding row needs a backfilled meaning. There is no billing cron (DEPLOYMENT: "no cron").

**Overdue is decided in SQL, never in a client** (statusTone.ts header, UI_RESTYLE_PLAN 1.4). Clients read a boolean the database computed with `app_today()`, so the clock pin (`swimsync.now`) drives drivers and pgTAP too.

## 2. Units, in deploy order

### Unit 0 — Pre-flight on prod (read-only, before any code)

⚠ RISK 9 MITIGATION. Each of these is a bare `scripts/prod-query-ro.sh` call.
_Ran 2026-11-12: all four ticked._
- [x] Count October invoices: `SELECT count(*) FROM invoices WHERE billing_month='2026-10'` = **0**. If it is not 0, stop and tell the user: October already has invoices with no due date in their email.
- [x] Count stuck emails: `SELECT count(*) FROM invoices WHERE invoice_email_state(invoices) IN ('UNSENT','RETRYABLE')` = **0**. If it is not 0, stop. Those rows would be re-sent with the new "Please pay by" line carrying a past date (§7.170).
- [x] No automatic billing can fire mid-rollout. (`cron.job` does not exist on prod: `pg_cron` is not installed, `pg_extension` count = 0. Re-check with that query, not `cron.job`.)
- [x] Record one prod `public_token` of a paid invoice for the Unit 2 post-deploy probe. Keep it in the scratchpad only, never in a commit or doc.
- **Prohibition:** nobody presses Generate for October on prod until step 3 of §3 is ticked.

### Unit 1 — Migration `db/overdue-due-date` (root checkout, expand-only)

`supabase/migrations/20261112000100_invoice_due_date.sql`. First run `ls supabase/migrations | tail -1` and confirm the name sorts after `20261111000100`.

⚠ RISK 3/4 MITIGATION, before writing anything:
- [ ] Read `pg_get_functiondef('public.pin_invoice_public_fields'::regproc)` and `pg_get_functiondef('public.guard_tenant_columns'::regproc)` from the local DB, never from a migration (§7.40). Paste those bodies as the base of the `CREATE OR REPLACE` statements below.

1. **Days to pay on the tenant.** `ALTER TABLE tenants ADD COLUMN invoice_payment_days int NOT NULL DEFAULT 14 CHECK (invoice_payment_days BETWEEN 1 AND 90)`.
   - ⚠ RISK 4 MITIGATION: `CREATE OR REPLACE guard_tenant_columns()` from the live body, adding exactly `"invoice_payment_days":"billing"` to `v_map`. Nothing else in the function changes. Diff the new body against the live one: the only changed line is the map.
   - **Prohibition:** do NOT map it `"any"`, and do NOT drop the "not mapped" refusal to make the save pass.
2. **The due-date column.** `ALTER TABLE invoices ADD COLUMN due_date date` (nullable for now).
3. **One formula, used by both writers.** `public.invoice_due_date_for(p_generated_at timestamptz, p_tenant uuid) RETURNS date`, `LANGUAGE sql STABLE`, `SET search_path = public`. Body: `SELECT (p_generated_at AT TIME ZONE 'Asia/Singapore')::date + t.invoice_payment_days FROM tenants t WHERE t.id = p_tenant`.
   - ⚠ RISK 5 MITIGATION: the backfill and the trigger both call this one function, so they cannot diverge.
   - **Prohibition:** no `::date` on a bare `timestamptz` and no `date_trunc` without `AT TIME ZONE 'Asia/Singapore'`.
   - It reads no clock (no `now()`/`app_now()`), so G2 and the frozen census in `app_clock.test.sql` stay unchanged.
   - `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`. It is reached only from the DEFINER trigger below, as `next_invoice_ref` is (§7.78).
4. **The insert trigger.** `BEFORE INSERT` trigger `trg_set_invoice_due_date` → `set_invoice_due_date()`, `SECURITY DEFINER`, `SET search_path = public`. Body: `IF NEW.due_date IS NULL THEN NEW.due_date := invoice_due_date_for(NEW.generated_at, NEW.tenant_id); END IF;`.
   - ⚠ RISK 5 MITIGATION: no `coalesce(NEW.generated_at, app_now())`. It would be dead code (`generated_at DEFAULT now()` fills first), and a dead clock branch reads as pin coverage that does not exist.
   - Insert-only: confirmed no upsert path writes `invoices`. A pgTAP test (below) still pins that an UPDATE never re-derives the date.
   - The old engine keeps working unchanged, because it does not send the column.
   - **Prohibition:** do NOT "clean up" the DEFINER on this trigger function (§7.78).
5. **Backfill, then NOT NULL**, in this order in the same file: `UPDATE invoices SET due_date = invoice_due_date_for(generated_at, tenant_id) WHERE due_date IS NULL;` then `ALTER TABLE invoices ALTER COLUMN due_date SET NOT NULL`.
   - The backfill runs as `postgres`, so the pin added in step 8 does not refuse it. Step 8 must still come after step 5 in the file, so no reader has to reason about ordering.
6. **The computed field.** `public.is_overdue(invoices) RETURNS boolean`, `LANGUAGE sql STABLE`, `SET search_path = public`. Body: `SELECT $1.status = 'outstanding' AND app_today() > $1.due_date`. PostgREST selects it as `is_overdue`.
   - ⚠ RISK 1 MITIGATION: `REVOKE ALL ON FUNCTION public.is_overdue(public.invoices) FROM PUBLIC, anon;` then `GRANT EXECUTE … TO authenticated, service_role;`. This copies the `invoice_email_state` pattern in `20260927000100` lines 99–102. `service_role` is load-bearing: `public-invoice` reads with it, and a missing grant 404s every public link.
   - It is not refined for Claimed. The tag precedence (D4) lives in one pure helper per app (Units 3 and 4), and the dashboard count filters `paid_claimed_at IS NULL` explicitly.
7. **The audit table** `invoice_due_date_changes(id uuid pk default gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants, invoice_id uuid NOT NULL REFERENCES invoices ON DELETE CASCADE, old_due_date date NOT NULL, new_due_date date NOT NULL, reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500), changed_by uuid NOT NULL REFERENCES profiles, changed_at timestamptz NOT NULL DEFAULT now() -- clock: stamp)`.
   - ⚠ RISK 8 MITIGATION, `ON DELETE CASCADE` on `invoice_id`: driver teardowns and `generate-invoices/test-helpers.ts` delete invoices. An FK with no cascade would abort them and leak state into the second Deno run (§7.15) and `tenant_isolation` test 18.
   - Exactly ONE FK to each of tenants, invoices and profiles, or `recurring_gotchas.test.sql` assertion 1 goes red (§7.90).
   - `ENABLE ROW LEVEL SECURITY`. Policy `invoice_due_date_changes_select` FOR SELECT USING `has_admin_area(tenant_id,'billing','view')`.
   - `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated, service_role;` then `GRANT SELECT … TO authenticated;` only, which matches the policy (§7.87). No INSERT, UPDATE or DELETE grant: the DEFINER RPC is the only writer.
8. **Close the direct path (D5).** `CREATE OR REPLACE pin_invoice_public_fields()` from the live body, appending a third block: `IF NEW.due_date IS DISTINCT FROM OLD.due_date AND current_user = 'authenticated' THEN RAISE EXCEPTION 'invoices.due_date is changed only through change_invoice_due_date()' USING ERRCODE = 'check_violation'; END IF;`.
   - ⚠ RISK 3 MITIGATION, **prohibitions:**
     - do NOT use a column-level REVOKE/GRANT (`table_grants.test.sql` assertion 6, §7.292);
     - do NOT make this function SECURITY DEFINER (then `current_user` is always the owner, and `recurring_gotchas.test.sql` assertion 2 refuses it);
     - do NOT drop or reorder the two existing blocks.
   - Diff the new body against the live one: exactly one block added.
9. **The RPC** `change_invoice_due_date(p_invoice_id uuid, p_new_date date, p_reason text DEFAULT '') RETURNS date`, `SECURITY DEFINER`, `SET search_path = public`.
   - ⚠ RISK 8 MITIGATION, the body's order: raise `'not authenticated'` if `auth.uid()` is NULL. Then `SELECT … INTO v_row FROM invoices WHERE id = p_invoice_id FOR UPDATE`, serialising against `confirm_invoice_paid`, which locks the same way. Raise `'invoice not found'` if there is no row. Then refuse each of these with its own message:
     - `NOT has_admin_area(v_row.tenant_id,'billing','edit')` (false for a platform admin, a suspended business and a disabled admin, which matches the resend route);
     - `v_row.status <> 'outstanding'`;
     - `p_new_date IS NULL OR p_new_date <= v_row.due_date`;
     - `p_new_date > v_row.due_date + 365`.
   - Then INSERT the audit row (`changed_by = auth.uid()`, `reason = left(btrim(coalesce(p_reason,'')), 500)`) and `UPDATE invoices SET due_date = p_new_date WHERE id = p_invoice_id`, and `RETURN p_new_date`.
   - Every refusal RAISEs. **Prohibition:** never `RETURN NULL` or quietly do nothing — an RLS-shaped silent no-op is what `runDaySaveOutcome` exists to catch.
   - `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE … TO authenticated;`.
   - `changed_at` comes from the column default. If the body itself ever writes a stamp, mark the line `-- clock: stamp` and add the function to the frozen census in the same commit.

pgTAP `supabase/tests/invoice_due_date.test.sql`. Copy a pinned file's header verbatim (`set_config('swimsync.now', '… +08', true)` as its first statement, G1). Write `SELECT plan(N)` with N equal to the assertion count, and record N here: ___.
- Default 14 on a new tenant. A tenant set to 7 gives SGT generated date + 7.
- ⚠ RISK 5 MITIGATION, SGT boundary with differing UTC and SGT dates:
  - generated `2026-12-01 00:30+08` (= `2026-11-30 16:30Z`) → due `2026-12-15`;
  - generated `2026-11-30 23:30+08` → due `2026-12-14`;
  - the backfill expression over a pre-trigger row gives the same date as the trigger does.
- An explicit `due_date` on insert is kept.
- Changing `invoice_payment_days` after insert leaves the stored due date unchanged (D2).
- An UPDATE of another column leaves `due_date` unchanged.
- `is_overdue`:
  - pin `<due> 23:59+08` → false;
  - pin `<due+1> 00:00+08` → true;
  - paid and past due → false;
  - read through `SET LOCAL ROLE authenticated` as the parent and as a billing:view admin.
- ⚠ RISK 1 MITIGATION, grants by name:
  - `has_function_privilege('service_role','public.is_overdue(public.invoices)','EXECUTE')` = true, the same for `authenticated`, and false for `anon`;
  - `change_invoice_due_date` is false for `anon` and `service_role`;
  - `invoice_due_date_for` is false for all four roles.
- RPC refusals: an earlier date, an equal date, +366 days, NULL, a paid invoice, a view-only admin, another tenant's admin, a parent, unauthenticated.
- RPC success: it writes exactly one audit row (old, new, `changed_by`, reason), the invoice's `due_date` = new, and `is_overdue` flips to false.
- ⚠ RISK 3 MITIGATION:
  - as a billing:edit admin, a direct `UPDATE invoices SET due_date = due_date + 30` raises `check_violation`;
  - the same admin's `UPDATE invoices SET reminded_at = app_now()` **succeeds**;
  - the existing pins still refuse `reference_number` and `invoice_email_sent_at` (proof the re-body kept them);
  - `confirm_invoice_paid` still succeeds on an outstanding invoice.
- ⚠ RISK 4 MITIGATION: a billing:edit admin's `UPDATE tenants SET invoice_payment_days = 21` succeeds. An admin without billing:edit gets `insufficient_privilege`. Values 0 and 91 fail the CHECK.
- The audit table: a parent and a stranger see 0 rows; a billing:view admin sees only their own tenant's rows; deleting the invoice deletes its audit row.

Gate for Unit 1:
- `supabase test db` all green, with `table_grants`, `recurring_gotchas`, `stranger_isolation` and `app_clock` included.
- `scripts/check-migration-clock.sh` exits 0.
- ⚠ Prove each new test red (§7.25), one change at a time, restoring after each:
  - (a) swap `'Asia/Singapore'` for `'UTC'` in `invoice_due_date_for`: the 00:30 boundary goes red;
  - (b) drop the due_date pin block: the direct-UPDATE test goes red;
  - (c) remove the `v_map` entry: the tenants-save test goes red;
  - (d) drop the `service_role` grant: the privilege test goes red;
  - (e) change `>` to `>=` in `is_overdue`: the due-day test goes red.
  Record each red in the commit message.
- Then run `scripts/gen-db-types.sh` **in the same commit** (both apps' `lib/database.types.ts`) and `scripts/check-db-types.sh` = 0.
- ⚠ RISK 10 MITIGATION: `cd SwimSyncAdmin && npm run typecheck` and `cd SwimSyncApp && npm run typecheck` both pass on that commit. The generated `Insert` now requires `due_date`. If any typed invoice insert breaks, widen it in `lib/database.overrides.ts`; never hand-edit the generated file.
- Apply to prod. `supabase migration list --linked` shows 0 pending.
- ⚠ RISK 1 MITIGATION: take a remote grant dump (§11.7). It must show `is_overdue` with `authenticated` and `service_role` only, `change_invoice_due_date` with `authenticated` only, `invoice_due_date_for` with nobody, and `invoice_due_date_changes` with `authenticated=r` only. Any anon entry is a blocker.
- Then merge `db/…` to `main`. That push is an app deploy carrying only the types.

### Unit 2 — Engine email + public-invoice (Edge Functions)

**generate-invoices**
- The insert becomes `.select("id, due_date")`.
- ⚠ RISK 2 MITIGATION: add `due_date: string` as a **required** field on `CreatedInvoice` and `dueDate: string` as **required** on `InvoiceEmailData`. Because they are required, Deno type-check (CI, every entry point) forces all three builders. Add `due_date` to `INVOICE_EMAIL_SELECT`, which covers both retry and resend, and map `r.due_date` in `rebuildInvoices`.
- **Prohibition:** no TypeScript computes a due date (`generated + 14`, `new Date`, `todayInSg()`). The email prints the stored column, nothing else.
- `buildInvoiceEmailHtml` adds "Please pay by **26 Nov 2026**." **inside the payable branch of `payBlock` only**. Format it with `formatSessionDate()`, which does a string parse with no `Date` object.
- Deno tests in `email.test.ts`:
  - a payable invoice contains `Please pay by` and the exact date;
  - `net === 0` (`fullyCovered`) does NOT contain `Please pay by`;
  - a malformed date string prints raw and does not throw.
- Engine test in `core.test.ts`: a tenant set to 7 gives `created[0].due_date` = SGT today + 7, read from the DB row. The test restores the tenant's value in `finally` (§7.15).
- Retry/resend test: an UNSENT invoice rebuilt by `rebuildInvoices` carries `due_date`.
- Prove the email test red by moving the line outside the branch.
- Run `test.sh` **twice**; both green with the same count, recorded: ___.
- ⚠ Before deploying: write one payable and one fully-covered `buildInvoiceEmailHtml` output to the scratchpad and open both by eye.

**public-invoice**
- Add `due_date, is_overdue` to the `lookupInvoice` select. Keep it one string literal: no `+`-joined widening, so the current literal style stays (§7.1072 shape).
- Add `due_date: string` and `is_overdue: boolean` to `PublicInvoice` and `serializePublicInvoice` (`is_overdue: row.is_overdue === true`).
- ⚠ RISK 1 MITIGATION: update `core.test.ts`'s exact-key-set pin to gain exactly these two keys and nothing else. Cover the three states: outstanding, overdue, claimed-and-overdue (Claimed still wins, D4, at render).
- **Prohibition:** do not touch `corsHeaders` or add a request header (§7.264).
- Rendering the page is an APP change (`SwimSyncApp/app/invoice/[token].tsx`), so it ships in Unit 4, not here.
- ⚠ RISK 1 MITIGATION, local probe before deploying: `curl -s "http://127.0.0.1:54321/functions/v1/public-invoice?token=<seed token>"` returns 200 with `"due_date":"20` and `"is_overdue":`. A 404 here is a blocker; check the edge-runtime gotchas in `docs/GOTCHAS.md` first.

**Deploy**
- From a clean tree: `supabase functions deploy public-invoice` first, which carries only additive keys, then `supabase functions deploy generate-invoices`.
- `supabase functions list` shows both versions bumped (record both).
- ⚠ RISK 1 MITIGATION, prod probe: curl prod `public-invoice?token=<Unit 0 token>` → 200, body contains `"due_date":"2026-` and `"is_overdue":false`. Anything else: redeploy the previous version at once, because that page is every family's payment link.
- The email line is verified by the Deno test and the eyeball check. The first live proof is October (§3 step 4).

### Unit 3 — Admin panel (`SwimSyncAdmin`)

**Settings**
- "Days to pay" number field beside the run day in `BillingSettingsCard.tsx` / `useTenantBilling.ts` + `invoices.repo.ts`: add `invoice_payment_days` to `fetchTenant`'s select and update through `updateTenant`. Save on blur like the run day, clamp to 1–90, helper text "New invoices only".
- ⚠ RISK 4 MITIGATION: copy `handleSaveRunDay`'s pattern exactly. Save, then **re-read** the stored value, and show it plus the error inline (a refused or RLS-filtered save must not look saved). A `daysToPaySaveOutcome` pure helper gets a vitest test covering the error, empty-response and stored-value cases.

**Invoice table**
- Add `due_date, is_overdue` to `fetchInvoices`' select literal.
- A **Due** column formatted with `formatSgStamp(due_date, …)`.
- ⚠ RISK 6 MITIGATION, one tag helper: `invoiceTag({status, paid_claimed_at, is_overdue})` in `invoiceRows.ts` returns `Paid | Claimed | Overdue | Outstanding`. `is_overdue === true` is the only overdue truth; null or undefined means not overdue.
  - The helper's parameter type requires the `is_overdue` key, so a row type whose select forgot it fails typecheck.
  - `InvoiceTable` and `OutstandingMini` render only through it.
  - vitest covers all 8 combinations, including claimed+overdue → Claimed and paid+overdue → Paid.
- **Prohibition:** no `new Date()`, `todayInSg()` or due-date comparison in any admin file. Grep the diff: `git diff main -- SwimSyncAdmin | grep -nE "new Date\(|todayInSg|due_date *[<>]"` returns nothing new.
- The status filter "Outstanding" keeps matching `status === 'outstanding'`, so overdue rows stay listed under it. A vitest test pins this. No new filter value (out of scope).
- `Overdue` already maps to `danger` in `lib/statusTone.ts`.

**Change due date**
- A modal: a date input, an optional reason (max 500) and a call to the RPC.
- `min` = the day after the current due date, from a pure `nextSgDay("YYYY-MM-DD")` helper with string arithmetic and a vitest test that covers month and year ends. The server stays the authority.
- The entry point is the row's "…" `RowMenu` (new on Invoices). The existing inline Mark Paid / WhatsApp / Link stay put, and BACKLOG *Admin tables still carrying several inline row actions* is untouched.
- The entry shows only for `status === 'outstanding'`, and it is hidden for view-only admins and platform admins (`has_admin_area` is false for them).
- ⚠ RISK 8 MITIGATION: a refusal shows the RPC's message inline in the modal. On success the list **refetches** the row, and the tag and Due column come from the fresh `is_overdue`/`due_date`. **Prohibition:** never flip the tag locally.

**Dashboard**
- ⚠ RISK 6 MITIGATION: `countMetrics()` gains ONE head count, **appended LAST** in the `Promise.all`, and the positional destructure is extended at its end only (the file's ORDER IS THE CONTRACT note). The count is `.from("invoices").select("id",{count:"exact",head:true}).eq("is_overdue", true).is("paid_claimed_at", null)`, which excludes Claimed because Claimed beats Overdue (D4).
- First confirm with a local curl that PostgREST accepts `is_overdue=eq.true` in a head count.
- A vitest test asserts the new metric reads the 8th result and the first 7 are unchanged.
- `loadOutstandingInvoices` adds `due_date, is_overdue, paid_claimed_at` and tags through `invoiceTag`.

**WhatsApp**
- `lib/waMessage.ts` `ReminderMessageOpts` gains **required** `dueDate: string` and `isOverdue: boolean`. Wording per D7: "due by 26 Nov" / "was due on 26 Nov". The day-and-month label comes from a string parse, no `Date`.
- `waMessage.test.ts` covers both wordings and a malformed date.
- `ReminderQueue` sorts by tag Overdue first and is otherwise stable.

Then vitest and `npm run typecheck`.

### Unit 4 — Parent app (`SwimSyncApp`)

⚠ RISK 6 MITIGATION: these are the surfaces, as verified in code:
- `features/billing/dao/billing.repo.ts` → `InvoicesTab.tsx`;
- `app/(parent)/billing/invoice/[id].tsx` + `features/invoice-detail/dao/invoiceDetail.repo.ts`;
- the public page `app/invoice/[token].tsx` + `features/public-invoice/types.ts` / `ui/AmountCard.tsx`.

`parent-home`, `child-profile` and `paynow` only sum `net_amount` or render no tag. **Do not touch them.**

- Add `due_date, is_overdue` to each touched select. Each stays one string literal.
- One shared pure helper, `lib/invoiceTag.ts`, with the same contract as the admin's: a required `is_overdue` key, `=== true` only, D4 order. jest covers all 8 combinations. All three surfaces render the tag through it.
- Card: a "Due 26 Nov" line under the amount for an outstanding invoice, and "Overdue — was due 26 Nov" when overdue. A paid invoice shows no due line. Dates via `formatSgStamp`.
- Public page: "Due 26 Nov 2026" or the red "Overdue — was due …"; Claimed still wins.
- **Prohibitions:**
  - no `new Date()`/`todayInSg()` comparison: grep the diff as in Unit 3;
  - `Alert.alert` stays unused;
  - the public page's fetch keeps `content-type` only (§7.264), and `FUNCTIONS_URL` stays the literal `process.env.EXPO_PUBLIC_SUPABASE_URL`.

Then jest and typecheck.

### Unit 5 — UI drivers + docs

⚠ RISK 7 MITIGATION:
- `--now` can only replay a PAST moment, and fixture invoices get the real `now()` as `generated_at`. So do NOT try to "pin past a due date". Overdue state comes from the FIXTURE: insert the invoice with `generated_at = app_now() - interval '20 days'` (§7.360: a fixture backdates from the scenario's now). Add a second row with `generated_at = app_now() - interval '14 days'` so that, at real time, it is due today and not overdue. That second row gives the boundary at the UI layer.
- Extend the fixtures that already own invoices:
  - `fixtures-payment-collection.sql`, used by `verify-payment-collection` and `verify-parent-pay-claim`: one overdue, one claimed+overdue, one due-today invoice;
  - `fixtures-invoice-admin.sql`, used by `verify-invoice-admin`: the Days-to-pay save through the REAL tenants PATCH, so it exercises `guard_tenant_columns` (RISK 4), plus its reload read-back.
- Teardowns delete `invoice_due_date_changes` rows through the cascade. `check-teardowns.sh` and `check-fixture-roundtrip.sh` stay green.
- Driver checks:
  - Overdue tag on admin and parent;
  - Claimed beats it;
  - the dashboard overdue count equals the number of Overdue tags in the fixture;
  - Change due date clears it after the refetch (DB `due_date` moved, one audit row);
  - a view-only admin sees no menu entry;
  - the public page for the overdue token shows "Overdue".
- Every changed check is proven red once, for example by flipping `invoiceTag`'s order (§7.25).
- Run singly with `run-all-drivers.sh --only <driver>` for each of:
  - `payment-collection`, `parent-pay-claim`, `invoice-admin`;
  - `invoice-controls`, `admin-table-geometry` (the new column + RowMenu at 1280px, §7.239);
  - `app-money`, `smoke-admin`, `smoke-app`;
  - plus `check-fixture-roundtrip.sh`.
  Record pass counts before and after. A count that drops means a check was lost.
- **No full sweep.** Never dispatch or re-run the nightly.

Docs:
- Update the header comments of both `statusTone.ts` twins identically: a due-date source now exists, and Overdue comes from `is_overdue`. The twin drift test stays green.
- PRD: invoice status, settings, the parent Invoices row.
- BACKLOG: remove the Overdue bullet; file a *due-date change history screen* item (§5).
- `INVOICE_RUNBOOK.md`, one line: due dates are set at generation; extend with Change due date.

### Then — bill October on the new engine (§3 step 4).

## 3. Ship order and gates

1. **Unit 0** pre-flight ticked → **Unit 1** on prod (0 pending, grant dump clean) → merge `db/…` to `main`.
2. **Unit 2** deployed. Both function versions recorded, and the prod `public-invoice` probe returns `due_date` + `is_overdue:false`.
3. **Units 3–4** to `main` via `/deploy`. This is an APP unit, not visual-only: the public token page and the admin money surfaces are on §7.363's never-visual list, so the §9 nightly gate applies. The last green nightly is `43135062308` on `03256d8`. If any app commit lands first, READ the next nightly. **Do not dispatch it** (user's rule).
   - Then grep the served bundles for "Days to pay" (admin) and "Overdue — was due" (app) (§7.31). A 200 proves nothing.
   - ⚠ RISK 4 MITIGATION, on prod: save Days to pay once on a test tenant or the user's own, re-read it, then restore the value.
4. ⚠ RISK 2/5 MITIGATION, October: generate ONE tenant first. Then (bare `prod-query-ro.sh`) check that each new invoice's `due_date` = `(generated_at AT TIME ZONE 'Asia/Singapore')::date + invoice_payment_days`, and have the user open one received email for the "Please pay by" line. Only then generate the remaining tenants.

**Rollback**
- Unit 1 is expand-only. The column, trigger and RPC are harmless if unused, so no down-migration is needed.
- Unit 2: redeploy the previous function version recorded at deploy time.
- Units 3–4: revert the app commit on `main`.

## 4. Size

About 2–2.5 days:
- migration + pgTAP + red-proofs ~¾ day;
- engine/public ~3 h;
- admin ~½ day;
- parent ~3 h;
- drivers + docs ~3 h.

## 5. Out of scope

- Automatic overdue reminders (cron stays parked).
- Late fees.
- Notifying the parent of a date change (D6).
- Moving the Invoices table's existing inline actions.
- An "Overdue" status filter.
- A screen showing the due-date change history (the table is recorded and readable, not yet displayed).

## 6. Pre-commit gate

**Highest value. Any unticked box is a blocker:**
- [ ] RISK 1: pgTAP shows `service_role` and `authenticated` hold EXECUTE on `is_overdue` and anon does not. The local `public-invoice` curl and the post-deploy prod probe both return 200 with `due_date` and `is_overdue`.
- [ ] RISK 2: Deno email tests show the payable branch has "Please pay by <date>" and the fully-covered branch does not. `dueDate` is required, so all three builders typecheck. `test.sh` green twice with the same count.
- [ ] RISK 3: as a billing:edit admin, a direct `UPDATE … due_date` is refused while `reminded_at` still saves. The existing reference/token and email pins still refuse. The pin function is INVOKER, with no column grant anywhere.
- [ ] RISK 4: `guard_tenant_columns` maps `invoice_payment_days` → `billing`. pgTAP shows the save working for billing:edit and refused otherwise. `verify-invoice-admin` saves through the real PATCH.
- [ ] RISK 5: the 00:30+08 boundary test was proven red with a UTC formula. The backfill and the trigger both call `invoice_due_date_for`.

**Everything else:**
- [ ] Unit 0 prod counts: 0 October invoices, 0 UNSENT/RETRYABLE, 0 `cron.job`.
- [ ] Every new test proven red once; each red recorded in the commit message.
- [ ] `supabase test db` green, including `table_grants`, `recurring_gotchas`, `stranger_isolation`, `app_clock`. `check-migration-clock.sh` exits 0.
- [ ] Types regenerated in the migration commit; `check-db-types.sh` = 0; both apps typecheck.
- [ ] Remote grant dump matches the Unit 1 list exactly, with no anon.
- [ ] One `invoiceTag` helper per app, each with a required `is_overdue` key. The dashboard count excludes Claimed and is appended LAST. The diff grep finds no client date comparison.
- [ ] The RPC locks `FOR UPDATE` and raises on every refusal. The UI refetches after a change and never flips the tag locally.
- [ ] Driver fixtures backdate from `app_now()`. The listed drivers ran singly, with counts before and after recorded. `check-fixture-roundtrip.sh` and `check-teardowns.sh` green. No full sweep, no nightly dispatch.
- [ ] Deploy order: migrations → functions (versions recorded) → apps to `main` last. Bundle grep done. October generated for one tenant and checked before the rest.
