# Plan — package renewal automation ("generate package invoices"), Packages page reorder, Students page package columns + actions drawer

_Status: PLANNED, not built. Settled with the user via `/plan-with-confidence` on 2026-08-15
(three rounds of questions; every decision below was answered explicitly, none is inferred).
NOT yet `/plan-review`ed — run it before Phase 1 if the implementing session wants the risk
ranking. Picked up from `BACKLOG.md` → *Build order* → **"Package renewal automation"**._

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
| A package sale **is** a `parent_packages` row: `pending` → PayNow (`PKG-YYYY-NNNN` dynamic QR) → admin **Payment received** → `active` | `SwimSyncAdmin/app/(admin)/packages/page.tsx` (`confirmPurchase`, `recordSale`), `SwimSyncApp/app/(parent)/billing/index.tsx` (`requestPackage`, `cancelRequest`) | The **offer** is a pending row the admin creates on the parent's behalf. No invoice row, no new sales table. |
| Smart start date | `suggest_package_start(p_parent_id, p_product_id)` (`20260814000500`) | Default start of every offer. |
| Live per-child verdict | `student_package_coverage()` → `(student_id, parent_id, tenant_id, coverage, lessons_remaining)` (`20260815000400`) | Extend it — it is what "running low" and the Students chip already read. |
| Live per-package balance | `package_live_balances()` (`20260802000400` + `20260814000400`) | Source of `live_lessons_remaining`, `expires_on`. |
| Threshold | `tenants.low_package_lessons` (default 2), edited inline on Students | The lessons half of "running low". |
| WhatsApp queue | `SwimSyncAdmin/app/(admin)/invoices/ReminderQueue.tsx`, `SwimSyncAdmin/lib/waMessage.ts` (`toWaNumber`, `buildWaLink`) | Generalise the queue component to take rows; add `buildPackageOfferMessage`. |
| Public tokenised page + claim | `supabase/functions/public-invoice` (`?token=` GET, `{action:"claim"}` POST), `SwimSyncApp/app/invoice/[token].tsx` | Mirror as `public-package` + `SwimSyncApp/app/package/[token].tsx`. |
| Emails | `supabase/functions/package-emails` (`type: "requested" | "confirmed"`) | Add `type: "offered"`. |
| Drawer | `SwimSyncAdmin/components/Drawer.tsx` (right slide-over, `Modal`-shaped props; only Classes uses it) | The Students actions drawer. |
| Pin-clause trigger | `enforce_parent_package_lifecycle()` — **every new `parent_packages` column must be named in it** (§7.157) | All new columns below. |

## Decisions (locked with the user, 2026-08-15)

1. **The "package invoice" is an admin-created PENDING `parent_packages` row** ("an offer"),
   plus a public tokenised pay page. Not an invoice row — `invoices` is `UNIQUE (parent_id,
   billing_month)` and structurally cannot hold a sale. The parent pays via the page's PayNow
   QR (amount + `PKG-` reference locked); the admin confirms with the existing **Payment
   received**; the row goes `active` with the offer's `start_date`. Same states, same emails.
2. **What if the parent doesn't continue / wants a different package?** A pending row is inert
   (not coverage, never read by the engine). *Doesn't continue*: admin **Decline** (exists).
   *Different package*: parent requests it in the app as today; **a new pending row for the
   same family — from either side — supersedes (cancels) any open admin offer**, so a family
   never has two open offers. The public page carries "Prefer a different package? Tell your
   coach." No self-service switch: the admin decides what is sold.
3. **"Generate all" targets low-balance HOLDERS only**, never ad-hoc families. Ad-hoc families
   deliberately stay on monthly invoices (PRD §7.16). "Low" = the family's covering package
   has `live_lessons_remaining ≤ tenants.low_package_lessons` **OR** its effective expiry is
   within **`tenants.package_expiry_warning_days`** (new, default 14, admin-editable next to
   the lessons threshold). Both thresholds are the same ones the Students "running low"
   filter uses — one definition of low, everywhere.
4. **Default package is per CLASS CATEGORY** (`class_categories.default_product_id`), plus the
   "all classes" slot (`tenants.default_package_product_id`) as fallback. Packages are scoped by
   category; one business-wide default would propose a Group package to a Private-only child.
5. **Precedence when pre-selecting the product**: the family's **original** product (their most
   recent non-cancelled `parent_packages.product_id`) if it is still `is_active` → the default
   of the category the family's children attend (if they span several categories, the one
   the covering-low package is in; else the "all classes" default) → **nothing preselected**
   (the row is skipped in *Generate all* until the admin picks). Retired products are never
   offered; no "replaced_by" plumbing.
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
10. **Students page**: new columns **Package** (name), **Left**, **Expires** — the expiry of the
    package currently covering that child (the one "N left" is drawn from); blank for Ad-hoc.
    Class chips with `×` and **+ Add class** stay inline; Level stays an inline dropdown;
    **everything else** (Invite parent, Contact details, Rename, Set inactive) moves into ONE
    **Actions** button that opens the right-hand `Drawer`.
11. **No cron.** `wa.me` cannot be automated and the user works the queue by hand; the "Generate
    all" is admin-triggered. Scheduled sends stay behind BACKLOG *Automated reminder workflows*.

## Schema changes (one migration per phase, `db/…` branch, land on `main` first — §7.60)

### Migration A — `..._package_offers.sql` (Phase 1)

- `parent_packages` **add**:
  - `offered_by UUID REFERENCES profiles(id)` — non-null ⇒ admin-created offer.
  - `offered_at TIMESTAMPTZ`
  - `public_token TEXT UNIQUE` — 32-hex, minted by trigger for **every** pending row (parent-
    or admin-created), never client-writable; same generator as `invoices.public_token`
    (`20260802000600`).
  - `paid_claimed_at TIMESTAMPTZ` — set only by the `public-package` function (service role).
  - `superseded_by UUID REFERENCES parent_packages(id)` — set on the offer that a newer pending
    row cancelled (status → `cancelled`, this column says why).
- **Pin all five in `enforce_parent_package_lifecycle()` in the SAME migration** (§7.157;
  parents may only ever change `status` pending→cancelled on their own row, as today).
  `offered_by`/`offered_at` settable by admins on INSERT only; immutable after.
- Supersede rule as a trigger `supersede_open_package_offer()` **AFTER INSERT** on
  `parent_packages` when `NEW.status = 'pending'`: cancel every other pending row for the same
  `(tenant_id, parent_id)` **that has `offered_by IS NOT NULL`**, stamping `superseded_by =
  NEW.id`. A parent's own pending request is never cancelled by an admin offer (the admin
  sees it in *Awaiting confirmation* and can decline it by hand). One open offer per family.
- `tenants` **add** `package_expiry_warning_days INTEGER NOT NULL DEFAULT 14 CHECK (>= 0)`
  next to `low_package_lessons`; same grant/policy shape as that column.
- New RPC `create_package_offer(p_parent_id, p_product_id, p_start_date) RETURNS uuid`
  (SECURITY DEFINER, admin-only, tenant from the caller's profile — copy the guard shape of
  `extend_package`, `20260815000300`): validates product `is_active` and same tenant, inserts
  the pending row with `offered_by = auth.uid()`, returns id. Client never inserts offers
  directly, so `offered_by` can be trusted. GRANT to `authenticated` + REVOKE FROM PUBLIC (§7.82).
- Extend `student_package_coverage()` (read the LIVE body first — `pg_get_functiondef`,
  §7.115) to also return `package_id`, `package_name`, `expires_on` of the covering package
  (the earliest-expiring active covering package — the same one the FIFO draws from), and
  `low BOOLEAN` computed with both tenant thresholds. Adding columns to a `RETURNS TABLE`
  needs `DROP FUNCTION` + re-create — check every caller (`grep -rn student_package_coverage`)
  and re-GRANT (§7.47 keeps the parent SELECT grant).
- New view-ish RPC `package_renewal_candidates()` → one row per **family** that is low: parent
  id/name/phone, children names, covering package (name, left, expires), `original_product_id`
  (still-active latest), `suggested_product_id` (precedence rule of Decision 5), and whether
  an open offer already exists (then it is listed but pre-unticked). Admin-only.
- pgTAP (each proven red without the change — §7.25): parent UPDATE of each new column →
  rejected; parent cannot INSERT with `offered_by`; `create_package_offer` rejects a retired
  product and a foreign-tenant parent; supersede trigger cancels only admin offers, only the
  same family; `public_token` minted and not client-writable; coverage returns the earliest-
  expiring covering package's expiry; a family with `left > threshold` but expiry in 10 days
  is a candidate at 14 and not at 7. **Take a remote grant dump after** (§7.39, §7.89).

### Migration B — `..._default_packages.sql` (Phase 2)

- `class_categories.default_product_id UUID REFERENCES package_products(id) ON DELETE SET NULL`
- `tenants.default_package_product_id UUID REFERENCES package_products(id) ON DELETE SET NULL`
- CHECK via trigger: the default product must belong to the same tenant and, for a category,
  have `category_id = this category OR category_id IS NULL`; retiring a product (`is_active`
  → false) clears any default pointing at it (trigger on `package_products`).
- `package_renewal_candidates()` learns the defaults (Phase 1 ships it with original-only
  suggestions and a TODO-free fallback of NULL). Admin-only UPDATE via existing policies —
  check `table_grants.test.sql` stays green (§7.87).

## Delivery — 4 phases, each shippable, backend-first (§7.60: migrations → functions → apps)

### Phase 1 — the offer + public pay page + WhatsApp queue (~1.5 days)

1. Migration A. Land on `main`, `supabase test db`, deploy to prod, grant dump.
2. `supabase/functions/public-package/` — copy `public-invoice` (core.ts + index.ts split, same
   rate limiting, same single 404): GET returns `{name, lesson_count, rate, price, reference,
   start_date, expires preview, business PayNow payload, status, paid_claimed_at}`; POST
   `claim` stamps `paid_claimed_at` (only while pending). `verify_jwt = false` in config.toml.
   Deno tests mirror `public-invoice`'s. **Deploy it — a git push does not** (CLAUDE.md).
3. `package-emails` gains `type: "offered"` — subject "Your next swim package is ready to
   pay", body = product terms + start date + link `${APP_URL}/package/${public_token}`.
4. `SwimSyncApp/app/package/[token].tsx` — copy `invoice/[token].tsx`: terms, dynamic PayNow QR
   (reuse the `paynow?packageId=` builder), **I've paid**, and the "Prefer a different
   package? Tell your coach." line. Register the route like `/invoice` (public, no auth).
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
     failure marks that row and continues) → open the queue with the created offers.
   - The queue: lift `ReminderQueue.tsx` into `components/WhatsAppQueue.tsx` taking
     `{id, parentName, phone, message, link}[]` + `onOpened(id)`; invoices keep their wrapper.
     `lib/waMessage.ts` gains `buildPackageOfferMessage({business, children, packageName,
     lessons, price, reference, link})`. Stamp `reminded_at`? — **no new column**; reuse
     `offered_at` semantics: the queue's "opened" is per-sitting like invoices, and we add
     `parent_packages.reminded_at` **only if** the user asks for it later (kept out of scope
     deliberately — invoices needed it because months are chased repeatedly; an offer is
     superseded, not re-chased).
   - *Awaiting confirmation* panel: **Claimed** badge (`paid_claimed_at`), "offer" tag when
     `offered_by` is set, sort claimed-first.
   - Threshold controls: the Students toolbar's threshold input gains a sibling
     "expiry warning: N days" (`package_expiry_warning_days`); the Packages page shows both
     read-only next to *Generate all* with a link to Students to edit (one editing home).
6. Tests: vitest for the message builder, precedence rule (pure function
   `pickOfferProduct(original, defaults, categories)` — write it pure so it is testable),
   preview-modal row logic; jest for the public page's claim; pgTAP as above.
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
   (blank/"Ad-hoc" when not covered; amber when `low`). Keep the `PackageChip` in the Parent
   cell **removed** — the three columns replace it (one truth per row). Keep the running-low
   toggle; its filter now uses the RPC's `low` (lessons OR expiry) so it agrees with
   *Generate all*.
2. Actions column → one **Actions** button → `Drawer` titled with the child's name, sections:
   *Parent* (Invite parent when unclaimed, Contact details), *Student* (Rename, Set inactive /
   Reactivate). Class chips + **+ Add class** + Level dropdown stay in the table (Decision 10).
   The drawer's buttons open the SAME modals the column opened today (no logic moves — only
   the trigger). Esc/backdrop closes; the drawer closes when a modal it launched succeeds.
3. Watch §7.10/§7.58 in the drivers: the drawer overlays the table — drivers must close it
   before clicking a row. Update `verify-students` (or whichever driver clicks those actions
   — `grep -rn "Contact details\|Set inactive" .claude/skills/run-ui-playwright/drivers`)
   to open the drawer first. vitest: drawer renders the right actions per status; columns
   render the coverage shape.

### Phase 4 — the Playwright driver + docs (~½ day)

1. One registered nightly driver `verify-package-renewal`: seed a family with a 1-lesson-left
   package → Generate all preview lists them with the original product → Confirm → offer row
   pending with token → public page loads unauthenticated → I've paid → Claimed → Payment
   received → active. Tear down its own fixtures (`docs/TESTING.md` §5 rules; §7.73 family:
   never take an ordinal over a list the driver doesn't own). This also discharges the
   backlog item *A Playwright driver for the weeks/holiday package UI* if it covers Extend +
   the Holidays page in the same run — do that; it's one seed away.
2. `/update-docs`: PRD §7.16 gains "Renewal offers" (+ Students columns/drawer under the
   Students section); BACKLOG strikes this item + the driver item; the *Parent-facing package
   notifications* item is **narrowed** (offer emails now exist; what remains is the unprompted
   low-balance nudge behind cron); GOTCHAS gets whatever bit.

## Total: ~3.5 days. Phases 1→2→3 are independent of each other after Migration A; Phase 3
can be a worktree (no migration) while Phase 1's UI is built in the root.

## Risks the implementer must not skip (pre-`/plan-review` list — rank them there)

- **§7.157 again**: five new `parent_packages` columns — pin every one in the lifecycle
  trigger in the same migration, or a parent can stamp their own `paid_claimed_at`/mint a
  token. pgTAP red-then-green per column.
- **A pending offer is inert; make sure it stays inert.** Grep the engine (`core.ts`) and
  `package_live_balances` / `student_package_coverage` for `status` filters — all must be
  `= 'active'`, never `IN ('pending','active')`. The parent app's billing list already shows
  pending rows (`.in("status", ["pending","active"])`) — an admin offer will now appear there
  as "Awaiting your payment" with **Pay** and the existing **Cancel request** button; wording
  should say "Your coach has prepared your next package" when `offered_by` is set.
- **Supersede only admin offers.** Cancelling a parent's own request because the admin
  clicked Generate would silently discard money the parent may already have transferred.
- **`public-package` token = access control** (as `public-invoice`): 128-bit, rate-limited,
  one shared 404, CORS pinned to `swimsync.sg`. Never return the parent's phone/email.
- **§7.115**: rebuild `student_package_coverage()` from `pg_get_functiondef` on the live DB,
  not from `20260801000200`.
- **Deploy order** (§7.60, wrong three times): Migration A → `public-package` +
  `package-emails` deploy (`supabase functions list` to confirm) → apps on `main`. The app's
  `/package/[token]` route 404s harmlessly if pushed early; the admin's Generate button does
  NOT — it calls an RPC that must exist. Land admin last.
- **Drawer overlay vs drivers** (§7.10/§7.58) — Phase 3 step 3.
- **Threshold semantics drift**: "low" is now defined in SQL (`student_package_coverage.low`).
  The Students filter, the amber chip, `package_renewal_candidates` and *Generate all* must
  all read it — no second definition in TS.

## Out of scope (say no if asked mid-build)

Automated/scheduled sends (cron); Meta Cloud API bulk WhatsApp; a per-tenant message
template; a `reminded_at` re-chase stamp on offers; parent self-switching the offered
product; offering packages to ad-hoc families; any change to how packages are drawn down.
