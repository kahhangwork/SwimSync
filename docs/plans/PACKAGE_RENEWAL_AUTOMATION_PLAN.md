# Plan — package renewal automation ("generate package invoices"), Packages page reorder, Students page package columns + actions drawer

_Status: PLANNED, not built. Settled with the user via `/plan-with-confidence` on 2026-08-15
(three rounds of questions; every decision below was answered explicitly, none is inferred).
**Risk-reviewed via `/plan-review` on 2026-08-15 by an independent reviewer agent** that
verified every claim against the code — 12 ranked risks, mitigations inlined under the steps
they govern as `⚠ RISK n MITIGATION` (1 = most product risk). Seven factual corrections from
that review are already folded in (the two material ones: `student_package_coverage.
lessons_remaining` is a FAMILY SUM, not one package's; and today's confirm dialog ignores a
pending row's `start_date`). Walk the pre-commit gate at the bottom before every phase's commit.
Picked up from `BACKLOG.md` → *Build order* → **NEXT**._

## Why

Monthly invoicing is now an operating rhythm: `generate-invoices` mints the month, the admin
works the **WhatsApp reminders** queue (`wa.me` link → tokenised public invoice page →
parent taps *I've paid* → admin marks paid). **Packages have none of that.** A renewal today
is: the admin notices a family is low (chip on Students), the parent must find the product in
the app and request it, pay, and the admin confirms. Nothing nudges the parent, and the admin
has no "send them the next package" button. This plan gives packages the same loop the
invoices have — **and only that loop**; nothing about how a package is *spent* changes.

Three surfaces change: **Packages page** (reorder + the automation), **Students page**
(package columns + an actions drawer), and a new **public package-payment page** in the app.

## What already exists — build on it, do not re-invent (read before coding)

| Primitive | Where | Reuse |
|---|---|---|
| A package sale **is** a `parent_packages` row: `pending` → PayNow (`PKG-YYYY-NNNN` dynamic QR) → admin **Payment received** → `active` | `SwimSyncAdmin/app/(admin)/packages/page.tsx` (`confirmPurchase`, `recordSale`), `SwimSyncApp/app/(parent)/billing/index.tsx` (`requestPackage`, the pending row's **Cancel**) | The **offer** is a pending row the admin creates on the parent's behalf. No invoice row, no new sales table. |
| Smart start date | `suggest_package_start(p_parent_id, p_product_id)` (`20260814000500`) | Default start of every offer. |
| Live per-child verdict | `student_package_coverage()` → `(student_id, parent_id, tenant_id, coverage, lessons_remaining)` (`20260815000400`). **`lessons_remaining` is `sum()` over every live covering package of the family.** | Extend it — it is what "running low" and the Students chip already read. |
| Live per-package balance | `package_live_balances()` (`20260802000400` + `20260814000400`); FIFO order = `expires_on, confirmed_at, id`, and the engine **skips** a package that cannot fund the lesson (`core.ts` ≈1127-1134) | Source of `live_lessons_remaining`, `expires_on`. |
| Threshold | `tenants.low_package_lessons` (default 2), edited inline on Students; **also duplicated in TS** as `isRunningLow` (`SwimSyncAdmin/lib/packageCoverage.ts:98`) and `PackageChip`'s `lowThreshold` amber rule | The lessons half of "running low". The TS copies get **deleted** (RISK 10). |
| WhatsApp queue | `SwimSyncAdmin/app/(admin)/invoices/ReminderQueue.tsx`, `SwimSyncAdmin/lib/waMessage.ts` (`toWaNumber`, `buildWaLink`) | Generalise the queue component to take rows; add `buildPackageOfferMessage`. |
| Public tokenised page + claim | `supabase/functions/public-invoice` (`?token=` GET, `{action:"claim"}` POST; `verify_jwt=false` in `supabase/config.toml` ≈L446), `SwimSyncApp/app/invoice/[token].tsx`, `SwimSyncApp/app/_layout.tsx` `PUBLIC_PATHS` (≈L49-55, carries a prohibition comment on widening it) | Mirror as `public-package` + `SwimSyncApp/app/package/[token].tsx`. |
| Token minting on invoices | `assign_invoice_public_fields` — **SECURITY DEFINER**, unconditional | Copy the doctrine, not the when-NULL shape (RISK 4). |
| Emails | `supabase/functions/package-emails` (`type: "requested" | "confirmed"`; `confirmed` only checks tenant *membership*, ≈L88-100) | Add `type: "offered"` with a real admin guard (RISK 6). |
| Drawer | `SwimSyncAdmin/components/Drawer.tsx` (right slide-over, `Modal`-shaped props; only Classes uses it) | The Students actions drawer. |
| Pin-clause trigger | `enforce_parent_package_lifecycle()` — **every new `parent_packages` column must be named in it** (§7.157) | All new columns below. |
| Reference trigger | `assign_parent_package_reference()` — SECURITY DEFINER, sorts after `_lifecycle`, pinned by `pin_parent_package_reference()` (`20260809000100`) | Home of `public_token` minting (RISK 4). |

## Decisions (locked with the user, 2026-08-15)

1. **The "package invoice" is an admin-created PENDING `parent_packages` row** ("an offer"),
   plus a public tokenised pay page. Not an invoice row — `invoices` is `UNIQUE (parent_id,
   tenant_id, billing_month)` and structurally cannot hold a sale. The parent pays via the
   page's PayNow QR (amount + `PKG-` reference locked); the admin confirms with the existing
   **Payment received**; the row goes `active` **with the offer's `start_date`** (which
   requires the confirm dialog to stop overriding it — RISK 3). Same states, same emails.
2. **What if the parent doesn't continue / wants a different package?** A pending row is inert
   (not coverage, never read by the engine). *Doesn't continue*: admin **Decline** (exists).
   *Different package*: parent requests it in the app as today; **a new pending row for the
   same family — from either side — supersedes (cancels) any open UNCLAIMED admin offer**, so
   a family never has two open offers. **An offer the parent has claimed as paid is never
   auto-cancelled** (RISK 1). The public page carries "Prefer a different package? Tell your
   coach." No self-service switch: the admin decides what is sold.
3. **"Generate all" targets low-balance HOLDERS only**, never ad-hoc families. Ad-hoc families
   deliberately stay on monthly invoices (PRD §7.16). "Low" is a **family** verdict:
   `family live lessons (the existing sum) ≤ tenants.low_package_lessons` **OR** the family's
   **latest** covering effective expiry is within **`tenants.package_expiry_warning_days`**
   (new, default 14, admin-editable next to the lessons threshold) — **AND** the family has
   no open pending row and no future-start active package (RISK 2). Both thresholds are the
   ones the Students "running low" filter uses — one definition of low, in SQL, everywhere.
4. **Default package is per CLASS CATEGORY** (`class_categories.default_product_id`), plus the
   "all classes" slot (`tenants.default_package_product_id`) as fallback. Packages are scoped by
   category; one business-wide default would propose a Group package to a Private-only child.
5. **Precedence when pre-selecting the product**: the family's **original** product (their most
   recent non-cancelled `parent_packages.product_id`) if it is still `is_active` → the default
   of the category the family's children attend (if they span several categories, the one
   the covering-low package is in; else the "all classes" default) → **nothing preselected**
   (the row is skipped in *Generate all* until the admin picks). Retired products are never
   offered; no "replaced_by" plumbing. Price always comes from the ROW's snapshot
   (`total_value`), never a live product join.
6. **Generate all = preview, not blind send.** A modal lists every low family with proposed
   product + start date, editable per row, untickable; **Confirm** creates the offers, then
   opens the WhatsApp queue for them.
7. **Channel = email + WhatsApp queue**, mirroring invoices: creating an offer fires
   `package-emails {type:"offered"}` (best-effort) with the pay link; the admin works the
   `wa.me` queue for the same rows; families without a usable phone are listed as skipped.
8. **Public package page has "I've paid"** (`paid_claimed_at` on `parent_packages`, mirrors
   invoices) → the Awaiting-confirmation panel gains a **Claimed** filter/badge.
9. **Packages page order**: *Awaiting confirmation* stays on top when non-empty (it is an action
   item), then **Class categories → What you sell → Who holds one**. Who-holds-one rows also
   list the **children's names**.
10. **Students page**: new columns **Package** (name), **Left**, **Expires**. **Left = the
    family sum `lessons_remaining` exactly as today's chip shows** (`verify-packages.mjs`
    pins "14 left" = 9 + 5). **Package/Expires = the earliest-expiring covering package that
    still has live lessons** (fallback: earliest); blank for Ad-hoc. Class chips with `×` and
    **+ Add class** stay inline; Level stays an inline dropdown; **everything else** (Invite
    parent, Contact details, Rename, Set inactive) moves into ONE **Actions** button that opens
    the right-hand `Drawer`.
11. **No cron.** `wa.me` cannot be automated and the user works the queue by hand; the "Generate
    all" is admin-triggered. Scheduled sends stay behind BACKLOG *Automated reminder workflows*.

## Schema changes (one migration per phase, `db/…` branch, land on `main` first — §7.60)

### Migration A — `..._package_offers.sql` (Phase 1)

- `parent_packages` **add**:
  - `offered_by UUID REFERENCES profiles(id)` — non-null ⇒ admin-created offer.
  - `offered_at TIMESTAMPTZ`
  - `public_token TEXT UNIQUE` — 32-hex, minted for **every** pending row (parent- or
    admin-created), never client-writable.
  - `paid_claimed_at TIMESTAMPTZ` — set only by the `public-package` function (service role).
  - `superseded_by UUID REFERENCES parent_packages(id)` — set on the offer that a newer pending
    row cancelled (status → `cancelled`, this column says why).
- **Pin all five in `enforce_parent_package_lifecycle()` in the SAME migration** (§7.157;
  parents may only ever change `status` pending→cancelled on their own row, as today).
  `offered_by`/`offered_at` settable by admins on INSERT only; immutable after.

  > **⚠ RISK 4 MITIGATION — parents INSERT into this table directly (`parent_packages_insert`),
  > so an only-when-NULL token mint is parent-writable, and a mint inside the SECURITY INVOKER
  > lifecycle trigger dies with `permission denied for gen_random_bytes` for the parent role
  > (invoice minting only works because `assign_invoice_public_fields` is DEFINER).**
  > - STEP: mint **unconditionally** inside `assign_parent_package_reference()` (already
  >   DEFINER, already unconditional, already sorts after `_lifecycle`):
  >   `NEW.public_token := encode(extensions.gen_random_bytes(16),'hex')`; add it to
  >   `pin_parent_package_reference()`.
  > - STEP: in the lifecycle INSERT branch, when `current_user = 'authenticated' AND NOT
  >   can_admin_tenant(NEW.tenant_id)`, force `offered_by, offered_at, paid_claimed_at,
  >   superseded_by := NULL` — a parent must not be able to spoof "your coach prepared this".
  > - ASSERTIONS (pgTAP, each red before the change): as parent role, `INSERT … public_token =
  >   'deadbeef…'` → stored token ≠ supplied AND `~ '^[0-9a-f]{32}$'`; parent INSERT with
  >   `offered_by = <admin>` → stored NULL; parent UPDATE of each of `public_token`,
  >   `paid_claimed_at`, `offered_by`, `offered_at`, `superseded_by` → raises.

- Supersede rule as trigger `supersede_open_package_offer()` **AFTER INSERT** on
  `parent_packages`: cancel every other pending row for the same `(tenant_id, parent_id)`
  **that has `offered_by IS NOT NULL` AND `paid_claimed_at IS NULL`**, stamping
  `superseded_by = NEW.id`. Fires for `NEW.status IN ('pending','active')` — an admin
  `recordSale` (active insert) also closes the family's unclaimed offer, otherwise the family
  holds a live pay link for a package they already bought offline. A parent's own pending
  request is never cancelled by anything automatic.

  > **⚠ RISK 1 MITIGATION (highest) — the trigger can cancel an offer the parent already
  > PAID (paid, then tapped "Request & pay" on another product — the *Buy a package* list stays
  > visible under a pending offer, `billing/index.tsx` ≈668-700). Cancelled is terminal; the
  > `PKG-` reference on the bank statement then points at a dead row and the admin has to
  > `recordSale` by hand. Separately, if the trigger is SECURITY INVOKER it runs as
  > `authenticated` on the parent's insert and the lifecycle pin on `superseded_by` REJECTS the
  > system's own UPDATE.**
  > - STEP: `supersede_open_package_offer()` is `SECURITY DEFINER SET search_path = public`,
  >   with the explicit filter `tenant_id = NEW.tenant_id AND parent_id = NEW.parent_id AND id
  >   <> NEW.id AND status = 'pending' AND offered_by IS NOT NULL AND paid_claimed_at IS NULL`.
  >   Guard against re-entry: it only UPDATEs, and the AFTER INSERT trigger does not fire on
  >   UPDATE — but detect the upsert-resolves-to-UPDATE case anyway (§7.57): trigger is `AFTER
  >   INSERT` only, never `INSERT OR UPDATE`.
  > - NAMED PROHIBITION: **an offer with `paid_claimed_at` set is never auto-cancelled by any
  >   trigger, RPC, or button except the admin's explicit Decline.**
  > - ASSERTIONS (pgTAP, red first): (a) offer with `paid_claimed_at` set survives a new parent
  >   request → still `pending`; (b) AS THE PARENT ROLE, a new request cancels an unclaimed
  >   offer with `superseded_by = NEW.id` (proves the DEFINER hop through the pins); (c) an
  >   admin `active` insert (recordSale) cancels the family's unclaimed offer; (d) a parent's
  >   own pending request is untouched by an admin offer insert.
  > - STEP (UI): the *Awaiting confirmation* panel gets a **Superseded** filter (rows with
  >   `superseded_by`) so a stray bank transfer against an old reference can be traced.

- `tenants` **add** `package_expiry_warning_days INTEGER NOT NULL DEFAULT 14 CHECK (>= 0)`
  next to `low_package_lessons`; same grant/policy shape as that column.
- New RPC `create_package_offer(p_parent_id, p_product_id, p_start_date) RETURNS uuid`
  (SECURITY DEFINER, admin-only, tenant from the caller's profile — copy the guard shape of
  `extend_package`, `20260815000300`): validates product `is_active` and same tenant, inserts
  the pending row with `offered_by = auth.uid()`, returns id. Client never inserts offers
  directly, so `offered_by` can be trusted. GRANT to `authenticated` + REVOKE FROM PUBLIC (§7.82).

  > **⚠ RISK 12 MITIGATION — two admins, or a double-click on Generate all, create two offers
  > per family, two emails, and the first link 404s.**
  > - STEP: `create_package_offer` RAISES (`unique_violation`-style, message "An offer is
  >   already open for this family — Decline it first") when an unclaimed open offer already
  >   exists for `(tenant, parent)`; the preview modal disables Confirm while a request is in
  >   flight.
  > - ASSERTION (pgTAP): second `create_package_offer` for the same family raises; after Decline
  >   it succeeds.

- Extend `student_package_coverage()` (read the LIVE body first — `pg_get_functiondef`,
  §7.115) to ALSO return `package_id`, `package_name`, `expires_on`, `low BOOLEAN`.
  `lessons_remaining` stays the family sum, unchanged.

  > **⚠ RISK 2 MITIGATION — a per-package "low" over-offers and mis-flags, and expired holders
  > drop out entirely.** (a) A family holding an almost-done package + a fresh one would be
  > "low" and Generate all offers a third; (b) a future-start active package or an open pending
  > row is not in `live`, so the family is "low" and offered again; (c) a package that expired
  > yesterday with lessons left is filtered out of `live` (`expires_on >= today`) → coverage
  > `ad_hoc` → the family most in need of renewal is NOT a candidate.
  > - STEP: `low := (family_sum <= low_package_lessons OR max(effective expires_on over
  >   covering packages) - today <= package_expiry_warning_days) AND NOT EXISTS (same-family
  >   parent_packages with status = 'pending' OR (status = 'active' AND start_date > today))`.
  > - STEP: `package_id/package_name/expires_on` = the earliest-expiring covering package
  >   **with `live_lessons_remaining > 0`** (fallback: earliest) — the FIFO skips exhausted ones.
  > - STEP: `package_renewal_candidates()` additionally lists families whose latest active
  >   package **expired within the last 30 days** (label "Expired N days ago"), same open-row
  >   exclusion.
  > - ASSERTIONS (pgTAP): family {9 left expiring in 5 d, 20 left expiring in 90 d}, warning 14
  >   → `low = false`; family with an open pending request → not a candidate; family expired
  >   3 days ago with 4 lessons left → candidate; family with `left > threshold` and expiry in
  >   10 days → candidate at 14, not at 7. `verify-packages.mjs` "14 left" / threshold-2 checks
  >   stay green **unchanged**.

  > **⚠ RISK 7 MITIGATION — the `RETURNS TABLE` change needs `DROP FUNCTION` + re-create, which
  > drops the ACL; 12 callers (`SwimSyncApp/app/(parent)/home/index.tsx`, `home/child/[id].tsx`,
  > 9 admin pages, `supabase/tests/student_package_coverage.test.sql`) — the two
  > `lib/packageCoverage.ts` files pick fields by name, so extra columns are additive.**
  > - STEP: in the same migration, after CREATE: `REVOKE ALL ON FUNCTION … FROM PUBLIC; REVOKE
  >   EXECUTE … FROM anon; GRANT EXECUTE … TO authenticated, service_role` (the ACL currently at
  >   `20260801000200:128-132`; §7.82/§7.87 — NOT §7.47, which is about unlinking a parent).
  > - ASSERTION: `function_grants.test.sql` green + a named
  >   `has_function_privilege('authenticated','student_package_coverage()','EXECUTE') = true`
  >   and `anon = false`. Remote grant dump after (§7.39, §7.89).

- New RPC `package_renewal_candidates()` → one row per **family** that is low: parent
  id/name/phone, children names, covering package (name, left, expires), `original_product_id`
  (still-active latest), `suggested_product_id` (precedence rule of Decision 5), and whether
  an open offer already exists (then it is listed but pre-unticked). **SECURITY INVOKER**
  (RLS-scoped) — if it must be DEFINER, copy `extend_package`'s tenant guard.
- pgTAP: everything listed in the RISK boxes above, plus `create_package_offer` rejects a
  retired product and a foreign-tenant parent. **Take a remote grant dump after** (§7.39, §7.89).

### Migration B — `..._default_packages.sql` (Phase 2)

- `class_categories.default_product_id UUID REFERENCES package_products(id) ON DELETE SET NULL`
- `tenants.default_package_product_id UUID REFERENCES package_products(id) ON DELETE SET NULL`
- CHECK via trigger: the default product must belong to the same tenant and, for a category,
  have `category_id = this category OR category_id IS NULL`; retiring a product (`is_active`
  → false) clears any default pointing at it (trigger on `package_products`). Retiring leaves
  already-open offers valid — terms are snapshotted on the row.
- `package_renewal_candidates()` learns the defaults (Phase 1 ships it with original-only
  suggestions and NULL otherwise). Admin-only UPDATE via existing policies — check
  `table_grants.test.sql` stays green (§7.87).

## Delivery — 4 phases, each shippable, backend-first (§7.60: migrations → functions → apps)

> **⚠ RISK 11 MITIGATION — deploy order specific to this plan.** The admin Packages page calls
> `create_package_offer` / `package_renewal_candidates`, and Phase 3 Students reads `low` /
> `package_name` — both break against the old schema. The app's `/package/[token]` needs
> `public-package` deployed AND `[functions.public-package] verify_jwt = false` in
> `supabase/config.toml` (copy `public-invoice`'s entry ≈L446-447) — without it the anon fetch
> gets 401. ORDER: Migration A → `config.toml` entry + `supabase functions deploy
> public-package` + `deploy package-emails` → `supabase functions list` → parent app on
> `main` → admin on `main` (LAST). ASSERTION before pushing any app: `curl -s
> "$FN/public-package?token=zz"` returns `{"error":"not_found"}` with 404, **not 401**.

### Phase 1 — the offer + public pay page + WhatsApp queue (~1.5–2 days)

1. Migration A. Land on `main`, `supabase test db`, deploy to prod, grant dump.
2. `supabase/functions/public-package/` — copy `public-invoice` (core.ts + index.ts split, same
   rate limiting, same single 404): GET returns the pinned key-set below; POST `claim` stamps
   `paid_claimed_at`. `verify_jwt = false` in config.toml. Deno tests mirror
   `public-invoice/core.test.ts`. **Deploy it — a git push does not** (CLAUDE.md).

   > **⚠ RISK 5 MITIGATION — a link in WhatsApp history for a superseded / already-active
   > offer must not show a payable QR (paid twice).**
   > - STEP: GET returns `status`; the page renders QR + *I've paid* **only when `status ===
   >   'pending'`**; `claim` returns null unless `status = 'pending' AND paid_claimed_at IS NULL`.
   > - ASSERTIONS (Deno): claim on cancelled → null; claim twice → second null; serializer
   >   key-set pinned = `{business_name, paynow_uen, paynow_mobile, reference, amount,
   >   package_name, lesson_count, rate, start_date, valid_until_preview, status,
   >   paid_claimed_at}` and NOTHING else.
   > - NAMED PROHIBITION: **no parent name/email/phone, no UUIDs, no children's names in the
   >   public response.**

   > **⚠ RISK 9 MITIGATION — a suspended business must not sell a prepayment.** `public-invoice`
   > deliberately ignores suspension (`20260813000300` header, decision 8) because an invoice is
   > money owed for lessons delivered; an offer is money for lessons that may never run.
   > - STEP: `public-package` GET and claim treat `tenants.suspended_at IS NOT NULL` as
   >   not-found (the uniform 404); record the divergence from decision 8 in `core.ts`'s header.
   > - ASSERTION (Deno): suspended tenant's token → null for both GET and claim.

3. `package-emails` gains `type: "offered"` — subject "Your next swim package is ready to
   pay", body = product terms + start date + link `${APP_URL}/package/${public_token}`
   (select `start_date, validity_weeks, public_token` for it).

   > **⚠ RISK 6 MITIGATION — `package-emails` is invoked from the client with the caller's JWT;
   > `confirmed` today only checks tenant MEMBERSHIP, so copying it lets a coach — or, copying
   > `requested`, the parent — fire offer emails.**
   > - STEP: `offered` requires the caller to be an admin of `pkg.tenant_id` (tenant_admin /
   >   co-admin — same test `can_admin_tenant` encodes) AND `pkg.offered_by IS NOT NULL` AND
   >   `pkg.status = 'pending'`.
   > - ASSERTION (Deno): parent JWT + `offered` → 403; coach JWT → 403; admin + a
   >   parent-created pending row → 403; admin + offer → 200.

4. `SwimSyncApp/app/package/[token].tsx` — copy `invoice/[token].tsx`: terms, dynamic PayNow QR
   (reuse the `paynow?packageId=` builder), **I've paid**, and the "Prefer a different
   package? Tell your coach." line; copy reads "valid until at least <preview>" (holiday
   extension can only lengthen). Add `"/package"` to `PUBLIC_PATHS` in `_layout.tsx` **and
   rewrite the comment there that forbids widening it** — it now names two public payment
   routes and why; do not silently contradict it. Parent app billing list: an admin offer
   already renders as a pending row with zero changes; add the wording "Your coach has
   prepared your next package" when `offered_by` is set (visible to the parent under the
   existing select policy). The parent's **Cancel** on it is fine — it is a decline.
5. Admin Packages page:
   - Reorder sections per Decision 9; who-holds-one rows show children names (one query via
     `students` by `parent_id`, or extend the page's existing family fetch).
   - Per-row **Generate invoice** button (family grain: on a row it acts on that row's
     parent) → modal: product select (preselected per Decision 5, retired hidden), start date
     (from `suggest_package_start`, editable), price preview → `create_package_offer` →
     best-effort `package-emails {type:"offered"}` → toast with **Open WhatsApp** for that
     one family.
   - Toolbar **Generate all invoices** → preview modal fed by `package_renewal_candidates()`
     (Decision 6) → on Confirm, loop `create_package_offer` (sequential; show progress; a
     failure marks that row and continues; Confirm disabled while in flight — RISK 12) → open
     the queue with the created offers.
   - The queue: lift `ReminderQueue.tsx` into `components/WhatsAppQueue.tsx` taking
     `{id, parentName, phone, message, link}[]` + `onOpened(id)`; invoices keep their wrapper.
     `lib/waMessage.ts` gains `buildPackageOfferMessage({business, children, packageName,
     lessons, price, reference, link})`. NAMED PROHIBITION: no `reminded_at` on offers — an
     offer is superseded, not re-chased (out of scope unless the user asks).
   - *Awaiting confirmation* panel: **Claimed** badge (`paid_claimed_at`), "offer" tag when
     `offered_by` is set, **Superseded** filter (RISK 1), sort claimed-first.

     > **⚠ RISK 3 MITIGATION — today's confirm dialog IGNORES the pending row's `start_date`**
     > (`confirmPurchase`, `packages/page.tsx` ≈380-388, 429: `confirmStart` is pre-filled from
     > `suggest_package_start` and sent as `start_date: confirmStart || todayInSg()`; the
     > trigger takes `NEW.start_date` first). The parent paid against "starts 1 Sep, valid to
     > 24 Nov" and would get a different window.
     > - STEP: pure `defaultConfirmStart(row, suggested)` → `row.start_date ?? suggested`; the
     >   confirm modal shows "Offered start: <date>" read-only beside the editable field when
     >   `offered_by` is set.
     > - ASSERTION (vitest): offer with `start_date` → returns it; parent request without →
     >   suggested. Driver (Phase 4) asserts the activated row's `start_date` equals the
     >   offer's.
   - Threshold controls: the Students toolbar's threshold input gains a sibling
     "expiry warning: N days" (`package_expiry_warning_days`); the Packages page shows both
     read-only next to *Generate all* with a link to Students to edit (one editing home).
6. Tests: vitest for the message builder, precedence rule (pure function
   `pickOfferProduct(original, defaults, categories)` — write it pure so it is testable),
   preview-modal row logic, `defaultConfirmStart`; jest for the public page's claim; pgTAP
   and Deno as in the RISK boxes above.
7. Verify in the real UI (`/run-ui-playwright`): create offer → open link in a fresh
   incognito → I've paid → Claimed shows → Payment received → active with the offer's start.

### Phase 2 — default packages (~½ day)

1. Migration B. Land, test, deploy, grant dump.
2. Packages page: in **Class categories** each row gets a "Default: <select>" (active products
   valid for that category or all-classes); an "All classes default" select under the list.
   In **What you sell**, a "Default for Group" chip on the product row.
3. `pickOfferProduct` consumes the defaults; `package_renewal_candidates()` returns
   `suggested_product_id` per Decision 5. vitest: original beats default; retired original
   falls to category default; no default ⇒ null ⇒ row unticked.

### Phase 3 — Students page columns + actions drawer (~1 day, app-only, no migration)

1. Read `student_package_coverage()`'s new columns; add **Package · Left · Expires** columns
   (blank/"Ad-hoc" when not covered; amber when `low`). Remove the `PackageChip` from the
   Parent cell — the three columns replace it (one truth per row). Keep the running-low
   toggle; its filter now uses the RPC's `low` (lessons OR expiry) so it agrees with
   *Generate all*.

   > **⚠ RISK 10 MITIGATION — "low" is now defined in SQL; the TS copies must go, or the chip
   > and the Generate-all list disagree.**
   > - STEP: delete `isRunningLow` (`SwimSyncAdmin/lib/packageCoverage.ts:98`); Students
   >   filter/amber read `row.low`; `PackageChip` drops `lowThreshold` (takes `low: boolean`
   >   if still used elsewhere).
   > - ASSERTION: `grep -rn "low_package_lessons\|isRunningLow" SwimSyncAdmin/app
   >   SwimSyncAdmin/lib` returns only the threshold editor.

2. Actions column → one **Actions** button → `Drawer` titled with the child's name, sections:
   *Parent* (Invite parent when unclaimed, Contact details), *Student* (Rename, Set inactive /
   Reactivate). Class chips + **+ Add class** + Level dropdown stay in the table (Decision 10).
   The drawer's buttons open the SAME modals the column opened today (no logic moves — only
   the trigger). Esc/backdrop closes; the drawer closes when a modal it launched succeeds.
3. Drivers.

   > **⚠ RISK 8 MITIGATION — three nightly drivers break on this change.**
   > `verify-packages.mjs:156` asserts `Package · 14 left` in a Students row;
   > `verify-active-inactive.mjs:60,101,118` and `verify-contact-details.mjs:71` click
   > row-scoped **Set inactive / Reactivate / Contact details** buttons that now live in the
   > drawer.
   > - STEP: update those three drivers **in the same commit** (open **Actions** first; close
   >   the drawer before touching the next row — §7.10/§7.58); the Left column keeps the
   >   family-sum number so the "14 left" regex only loses its "Package ·" prefix.
   > - ASSERTION: `verify-packages`, `verify-active-inactive`, `verify-contact-details`,
   >   `verify-admin-table-geometry` all green locally before merge.
   > - NAMED PROHIBITION: no `click({force:true})` on a row while the drawer is open.

   vitest: drawer renders the right actions per status; columns render the coverage shape.

### Phase 4 — the Playwright driver + docs (~½ day)

1. One registered nightly driver `verify-package-renewal`: seed a family with a 1-lesson-left
   package → Generate all preview lists them with the original product → Confirm → offer row
   pending with token → public page loads unauthenticated → I've paid → Claimed → Payment
   received → active **with the offer's start_date** (RISK 3). Tear down its own fixtures
   (`docs/TESTING.md` §5 rules; §7.73 family: never take an ordinal over a list the driver
   doesn't own). This also discharges the backlog item *A Playwright driver for the
   weeks/holiday package UI* if it covers Extend + the Holidays page in the same run — do
   that; it's one seed away.
2. `/update-docs`: PRD §7.16 gains "Renewal offers" (+ Students columns/drawer under the
   Students section); BACKLOG strikes this item + the driver item; the *Parent-facing package
   notifications* item is **narrowed** (offer emails now exist; what remains is the unprompted
   low-balance nudge behind cron); GOTCHAS gets the graduates listed in the gate below.

## Total: ~4 days. Phases 1→2→3 are independent of each other after Migration A; Phase 3
can be a worktree (no migration) while Phase 1's UI is built in the root.

## Out of scope (say no if asked mid-build)

Automated/scheduled sends (cron); Meta Cloud API bulk WhatsApp; a per-tenant message
template; a `reminded_at` re-chase stamp on offers; parent self-switching the offered
product; offering packages to ad-hoc families; any change to how packages are drawn down.

## Pre-commit gate — walk before EVERY phase's commit

**The four that decide whether real money goes wrong (a box that can't be ticked is a blocker):**

- [ ] **RISK 1** — pgTAP (a)–(d) green and were red before; the trigger is DEFINER with the
      explicit tenant/parent filter and `paid_claimed_at IS NULL`.
- [ ] **RISK 4** — token minted in `assign_parent_package_reference`, unconditionally; the five
      parent-UPDATE assertions and the parent-INSERT-spoof assertions green, red before.
- [ ] **RISK 2** — the four candidate/low assertions green; `verify-packages.mjs` "14 left"
      unchanged.
- [ ] **RISK 3** — `defaultConfirmStart` test green; driver asserts activated `start_date` =
      offer's.

**The rest, per phase:**

- [ ] RISK 5 key-set pinned + claim-on-non-pending null (Deno) · RISK 9 suspended → 404 (Deno)
- [ ] RISK 6 three 403 cases (Deno) · RISK 12 second offer raises (pgTAP)
- [ ] RISK 7 ACL re-issued in the migration; `function_grants.test.sql` + named privilege
      assertions green; **remote grant dump taken**
- [ ] RISK 11 `curl` returns 404 not 401 before any app push; `supabase functions list` shows
      both functions at the new version; admin lands on `main` LAST
- [ ] RISK 8 three drivers updated in the same commit and green · RISK 10 grep returns only
      the threshold editor
- [ ] `PUBLIC_PATHS` comment in `_layout.tsx` rewritten, not contradicted
- [ ] Deno suite run **twice** (§7.15); pgTAP; vitest; jest; both typechecks

**Graduate to `docs/GOTCHAS.md` §7 at `/update-docs`** (append the next numbers, never renumber):
1. A trigger that must UPDATE a sibling row on behalf of a parent-initiated INSERT has to be
   SECURITY DEFINER — otherwise the lifecycle pins (§7.157) reject the system's own write —
   and a DEFINER trigger must carry explicit tenant/parent scoping because it bypasses RLS.
2. Never auto-cancel a row that carries a payment claim (`paid_claimed_at`) — cancelled is
   terminal and the bank reference then points at nothing.
3. Minting a secret from `extensions.gen_random_bytes` inside a SECURITY INVOKER trigger fails
   for the client role; mint from the DEFINER trigger, and mint unconditionally on any table
   parents can INSERT into (the `assign_parent_package_reference` doctrine).
4. `student_package_coverage.lessons_remaining` is a family SUM; "the covering package" is a
   different question, and the FIFO skips exhausted ones.
