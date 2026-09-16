# Packages page → feature-scoped three-tier decomposition (full track)

_Stage 0 of the full track for `SwimSyncAdmin/app/(admin)/packages/page.tsx`. Unit 3 of 17
in the feature-tier rollout (playbook §7) — step 3 of the §7.4 order, after the smoke driver
(unit 1, §8.102) and Admin L-A (unit 2, §8.103). The playbook is the
method; the Students plan (`STUDENTS_PAGE_REFACTOR_PLAN.md`) is the worked example. This doc
is the measured, page-specific application of both. **Nothing here changes behaviour**
(playbook rule 0)._

_Written 2026-09-14. Follows Admin L-A (§8.103). **Revised 2026-09-14 after a `/plan-review`
pass (Fable 5.1 agent)** — the review corrected the RPC count, the slice boundaries, the
`packageOffers` verdict, and the driver net; every ⚠ RISK block below came from it._

## 1. The decisions, settled with the user

- **Full track**, twelve stages (playbook §2), one commit each, gate green at every one.
- **Execution on `main`**, not a worktree: one page, admin-only, no migration. Drivers run
  against the normal `:3000` / `:8081`; **no port-substitution dance** (playbook §4 is for
  worktrees only).
- **Gate to START:** L-A must have survived a **full** nightly sweep. The 2026-09-13 nightly
  was red on a driver flake (`admin-lesson-detail` sidebar-badge race, fixed 2026-09-14,
  confirmed by a single-driver dispatch); the rolling rot issue stays open until the next
  **full** green nightly. **Do not begin Stage 1 until that full green nightly exists.**
- **One unit at a time.** `packages` does not start unit 4 until it has itself survived a
  nightly (playbook §6, §7.1).

### The target shape (playbook §1)

```
packages/
  page.tsx            # composition only. ~150–200 lines, ZERO useState
  constants.ts        # module-level consts
  types.ts            # entity types only (products, purchases, categories, offer candidates, queue rows)
  ui/                 # PackageTable, toolbar/notices, CategoriesSection, ProductModal, SaleModal, ConfirmPaymentModal, CancelModal, ExtendModal, GenerateOffersModal
  domain/             # one hook per slice + pure helpers (packageRows.ts, packageOffers.ts moved in) + tests
  dao/
    packages.repo.ts  # every .from()  (23 calls, 9 tables)
    packages.rpc.ts   # every .rpc() (6 functions) + functions.invoke + auth.getUser bound
    (no .api.ts)      # 0 fetch() calls
```

Dependency direction: `page → ui → domain → dao → (PostgREST | rpc | functions)`.

## 2. The measurement (grep on 2026-09-14, corrected by the review — re-measure before Stage 1)

| Metric | Value |
|---|---|
| Lines | 2,014 |
| `useState` | 41 calls (`grep -c` says 42 — the import line) |
| `.from()` | 23 (`class_categories` ×5, `parent_packages` ×5, `profiles` ×4, `package_products` ×3, `tenants` ×2, `parent_students`, `parent_tenants`, `referral_rewards`, `referrals` ×1) |
| `.rpc()` | 6 calls, **6 functions**: `package_live_balances` (@270), `suggest_package_start` (@574), `preview_package_price` (@589), `extend_package` (@726), `create_package_offer` (@767, multiline), `package_renewal_candidates` (@835, multiline) |
| `supabase.functions.invoke("package-emails")` | **3** — @680 confirmed-active (best-effort, `.catch`), @705 `referral_reward` **inside a detached un-awaited IIFE** (@689–707), @~787 offered. All multiline (`.functions\n.invoke`) |
| `supabase.auth.getUser()` | **4** — `myTenantId` @143 + **three nested inside insert payloads** @397, @544, @645 |
| `fetch()` | 0 — no `.api.ts` |
| `<Modal>` | 6 |

> ⚠ Check 3 of the fence matches any `\bsupabase\b` line, so `functions.invoke` and
> `auth.getUser` **must leave the page** just like `.from`/`.rpc`. The dao split has a home
> for them (Stage 3), which the first draft of this plan missed.

## 3. The slices, with their anchors in the current file

| # | Slice | State | Surface | Data |
|---|---|---|---|---|
| 0 | **shared** | `busy error` (+ `load`) | every button's `disabled={busy}`; the top error banner | — |
| 1 | **list-core** | `categories products purchases parents businessName tenantReferral loading heldSearch capped queue showSuperseded` | table, search, `showSuperseded` toggle, notices, `WhatsAppQueue`; **`setProductActive` Retire/Reoffer @557 lives here (table action)** | most `.from()`; `matchesAnyField`, `discountLabel` |
| 2 | **categories** | `newCategory tenantDefaultProduct` | "Class categories" section + all-classes fallback select (@1091–1206) | `class_categories` insert/delete/update (@391/418/441/465), `tenants`; `addCategory`, `removeCategory`, `setCategoryDefault`, `setCategoryCapacity`, `setAllClassesDefault` (@478) |
| 3 | **product modal** | `productModal pName pCategory pLessons pRate pWeeks pRefOverride pRefType pRefValue formError` | "Add package" (@1461) | `package_products` insert (`saveProduct` @531, nested getUser @544) |
| 4 | **sale / preview** | `saleModal saleParent saleProduct saleStart salePreview` | "Record a sale" (@1596) | `parent_packages` insert (`recordSale` @630, nested getUser @645); the `[saleModal, saleParent, saleProduct]` effect → `suggest_package_start` + `preview_package_price` |
| 5 | **confirm-payment** | `confirming confirmStart` | "Confirm payment received?" (@1692) | `parent_packages` update; the `[confirming]` effect + `defaultConfirmStart` (@624); `referrals`/`referral_rewards` reads; `package-emails` ×2 (incl. the IIFE) |
| 6 | **cancel** | `cancelling` | Cancel modal (@1753) | `parent_packages` update |
| 7 | **extend** | `extending extendWeeks extendReason extendError` | "Extend {name}" (@1793) | `extend_package` |
| 8 | **generate-offers** | `genModal candidates genBusy genProgress` (+ shares `queue`) | "Generate renewal offers" (@1844) | `package_renewal_candidates`, `package_live_balances`, `create_package_offer` + `pickOfferProduct` (@847); `buildPackageOfferMessage`, `buildWaLink`, `toWaNumber` |

**⚠ RISK 2 — `busy` and `error` are ONE flag and ONE banner shared by every slice.** They
live in `usePackageList` and are PASSED to every other hook as `{ busy, setBusy, setError,
reload }`. **Prohibition:** no slice hook declares its own `useState` for busy or error — a
per-hook `busy` silently changes the cross-modal disabling (a behaviour change no driver
sees). Assertion at Stage 11: exactly ONE `domain/*.ts` has `useState(false)` named busy and
ONE has `useState<string | null>(null)` named error. Hand check: open Extend while a Retire
is in flight — its buttons are disabled (as today).

**⚠ RISK 4 — `suggest_package_start` / `preview_package_price` are used by slices 4, 5 AND 8.**
Extract them ONCE at Stage 3 into `dao/packages.rpc.ts` verbatim (their try/catch +
`todayInSg()` / `null` **fail-open fallbacks** are the ⚠ RISK 7 contract — comments travel
with them). Every hook imports them; none re-implements. Assertion:
`grep -rn 'rpc("suggest_package_start"\|rpc("preview_package_price"' 'app/(admin)/packages' | wc -l`
= 2 after Stage 3, still 2 at Stage 11. (Count the `.rpc(` call sites, not the bare names —
the page's comments name both RPCs five more times, and those comments travel into `ui/`.)

> Shared state the plan must thread, not duplicate: `busy`, `error`, `activeProducts`
> (derived; read by categories, product, sale, generate-offers), `businessName`
> (generate-offers), `categories` + `tenantReferral` (product modal — the inherit hint
> @1552), `parents` (sale), and the two RPC helpers above. Keep each in the hook that loads it, pass it down.

## 4. `lib/` verdicts (grep of importers, 2026-09-14)

| Helper | Other importers | Verdict |
|---|---|---|
| `packageOffers` (`defaultConfirmStart`, `pickOfferProduct`) | **0** | **MOVE** → `packages/domain/packageOffers.ts` + its test, **at Stage 5** (confirm-payment @624 is the first consumer; generate-offers @847 the second). **NOT the sale slice** — sale imports nothing from it. It has no relative imports, so it moves clean (§5, like `claimNaming`). |
| `waMessage` (`buildPackageOfferMessage`, `buildWaLink`, `toWaNumber`) | 1 (invoices) | **STAY** — shared pure helper, imported by `domain/`/`ui/` |
| `referralDiscount` (`discountLabel`) | 1 (referrals) | **STAY** |
| `tableSearch` (`matchesAnyField`) | 5 | **STAY** |
| `lessonDates` (`todayInSg`, `formatSgStamp`) | 30 | **STAY** (drift-pinned display helper) |
| `supabase` client | — | lives **only** in `dao/` after Stage 3 |

## 5. Stage 0b — the fence, built BEFORE anything moves (playbook §3)

Widen `SwimSyncAdmin/lib/tierBoundaries.drift.test.ts`: append `app/(admin)/packages` to
`SCOPE_DIRS`. Checks 3 (data access outside `dao/`) and 4 (page imports `@/lib/*` / `dao/`)
go **red on day one** — correct. Pin every current violation in `ALLOWED_DATA_ACCESS` /
`ALLOWED_PAGE_IMPORTS` **by file + content snippet**, each with a `why` naming the stage that
removes it. The ledger can only shrink after this. On the full track the transitional
page→dao pins are honest — list them at 0b, each `why` naming the stage (4–9) whose hook
wraps that call: `load()`/`setProductActive` leave at Stage 4, the category writes at 5,
the product insert at 6, `extend_package` at 7, the sale insert at 8, the offer RPCs at 9
(playbook §7.1).

Prove each check red before trusting it: a `ui/Break.tsx` importing `../dao/x`, a
`dao/break.ts` importing React, a `domain/break.ts` calling `fetch(`, and one swapped `@/lib`
import on the page. Watch each fail, delete, confirm green. Record it in the test header.

## 6. Stages — one commit each, gate green at every one

**The gate, every stage:** `cd SwimSyncAdmin && npm run typecheck && npm test` **and**
`cd SwimSyncApp && npm run typecheck && npm test`. Plus these structural greps (cheap, catch
RISK 2/4/6):

```bash
# run from SwimSyncAdmin/ — the paths are relative to the app root
grep -c "useState" 'app/(admin)/packages/page.tsx'                                   # only ever DOWN (42 today = 41 calls + the import line), 0 at Stage 11
grep -rn "\bsupabase\b" 'app/(admin)/packages' --include='*.ts' --include='*.tsx' | grep -v /dao/ | wc -l   # 0 from Stage 3 — QUOTE the includes: unquoted, zsh aborts on the glob and `wc` prints a false 0
grep -rho "todayInSg()" 'app/(admin)/packages/domain' | wc -l                        # fail-open sites in domain/: 4 once Stage 9 lands (sale insert @640, confirm @668, create-offer @772, candidate seed @862); dao/ holds suggest's 2 (@578/@581), ui/ the held-table's 1 (@1336). A 5th in domain/ = a duplicate helper
```

Green, or `git checkout -- .` and take a smaller step. Never "fix it in the next commit".

| Stage | What |
|---|---|
| 0 | This plan doc |
| 0b | Fence widened, ledgers pinned, each check proven red (§5) |
| 1 | `constants.ts` + `types.ts`, verbatim with comments |
| 2 | `dao/packages.repo.ts` — 23 `.from()`, thin `{ data, error }`, **no logic/mapping**, error handling unchanged char-for-char |
| 3 | `dao/packages.rpc.ts` — 6 RPCs + **`invokePackageEmail(body)` = `supabase.functions.invoke("package-emails", { body })` (returns the promise, NO catch inside — caller keeps its own `.catch`)** + **`getCurrentUser()`** (as `students.repo.ts`). Header carries *orchestrate, never replace*. Page imports no client after this |
| 4 | list-core: `domain/packageRows.ts` (pure mapping/filters/labels + **characterisation tests**) → `domain/usePackageList.ts` (state, `load()`, search effect, `busy`/`error`, `setProductActive`) → `ui/` toolbar + notices |
| 5 | **confirm-payment + cancel + categories** (three small write-then-reload slices, one commit): `domain/usePurchaseActions.ts`, `domain/useCategories.ts`, `ui/ConfirmPaymentModal`, `ui/CancelModal`, `ui/CategoriesSection`. **Move `packageOffers` into `domain/` here.** |
| 6 | **product modal**: `domain/useProductForm.ts` + `ui/ProductModal` |
| 7 | **extend**: `domain/useExtend.ts` + `ui/ExtendModal` |
| 8 | **sale / preview**: `domain/useSale.ts` + `ui/SaleModal` |
| 9 | **generate-offers** (riskiest, last): `domain/useGenerateOffers.ts` + `ui/GenerateOffersModal` |
| 10 | (unused — packages has 8 slices, no spare) |
| 11 | table → `ui/PackageTable.tsx` (with `useTableSort`); delete dead imports (grep each symbol); **both ledgers → zero**, header dated |

**DONE 2026-09-16 — every stage shipped to `main`, nightly-confirmed (`35032652395`, a full 1h20m sweep on
`f0cbcb5`, green; rot issue #10 closed):** 0b `69b9683` · 1 `a38b9f8` · 2 `6c48ab4` · 3 `8dc7cc2` ·
4 `0f8a31d` · 5 `69ad8b2` · 6 `c5cfe66` · 7 `28c96ef` · 8 `5e887ad` · 9 `0bff67b` · 11 `f0cbcb5`.
`page.tsx` 2,014 → 244 lines, **0 `useState`**, both boundary ledgers empty. Deviation from §11's wording:
**three** table components (`ui/PendingPanel` + `ui/ProductsTable` + `ui/HeldTable`), not one `PackageTable`
— the three tables differ too much to share; each holds its own `useTableSort` in an always-mounted
component (RISK 3), and the page renders `PendingPanel` unconditionally (it returns null when empty) so the
sort survives a reload. Also: the transitional page→dao import pins (§5) had to be added at Stages 2/3 (when
the import first appears), NOT at 0b — a pin with no matching import fails the shrink-test; the DATA_ACCESS
`why`s therefore read Stage 2/3 (§6 grep gate), and only the page→dao IMPORT pins run to Stages 4–9.

**⚠ RISK 6 (Stages 3, 5) — the email + auth reaches.** Stage 3 binds the invoke and the
user lookup in `dao/`; Stage 5 moves the `referral_reward` IIFE (@689–707)
as ONE block into `usePurchaseActions`, **still un-awaited, still `.catch(() => {})`
on both the IIFE and the invoke** — do NOT `await` it, do NOT hoist it above `load()`
(awaiting it makes confirm-payment fail on an email error — a behaviour change). The three
nested `(await supabase.auth.getUser()).data.user?.id` become `await getCurrentUser()` (or
`myTenantId()`) evaluated in the SAME position inside the insert payload literal.

**⚠ RISK 8 (Stages 5, 8) — the sale/confirm effects have no reset and carry
`eslint-disable exhaustive-deps`.** Both effects move VERBATIM including the disable comment
and dep arrays `[saleModal, saleParent, saleProduct]` / `[confirming]`. **Prohibitions:** no
cancellation flag, no `AbortController`, no reset of `saleParent/saleProduct/saleStart` on
close (only `recordSale` resets them today), no reset of `confirmStart` on
`setConfirming(null)`. Expose `setSaleModal`, not an `open()/close()` that resets. Hand
check: Record a sale → pick parent+product → Cancel → reopen → the previous pair is still
selected and the preview reappears (today's behaviour).

**⚠ RISK 9 (Stage 9) — generate-offers reads render-scope closures.**
`useGenerateOffers({ activeProducts, businessName, setQueue, setError, reload })` — the
first three are PARAMETERS (they belong to list-core: `queue` is rendered by the
always-mounted `WhatsAppQueue`, and `confirmGenerateAll` @908 fills it), not re-derived. The 25-line inline `onChange` on the
product select (@1897–1922) becomes ONE method `changeCandidateProduct(i, productId)` with
the identical body. The sequential `for` loop + per-iteration `setGenProgress` +
swallow-and-continue `catch {}`, and the `onClose={() => !genBusy && setGenModal(false)}`
guard, all move verbatim.

**⚠ RISK 3 (Stage 11) — `useTableSort` ×3 must stay in an ALWAYS-mounted component.** All
three sorts live at page level today and survive `load()` (which sets `loading=true` on every
write-then-reload). The products/held tables render under `loading ? … : <Table>`; the
pending panel under `pending.length > 0`. Keep each `useTableSort` in the section component
ABOVE that branch, never inside the branch that unmounts on reload — or the user's sort
resets after every Retire/Confirm/Extend. Hand check after Stage 11: sort "Who holds one" by
Expires, Retire a product, sort is still Expires.

## 7. Verification — the drivers are the net, and the net is THINNER than it looks

**The automated coverage, grepped from the driver bodies on 2026-09-14 (re-confirm before
relying on it):**

| Driver | What it ACTUALLY exercises on /packages |
|---|---|
| `verify-packages` | route renders, "Awaiting confirmation (1)", live-balance cell, **Payment received** (row + modal) |
| `verify-package-renewal` | **Generate renewal offers → Create N offer(s)**, WA-queue Done, Payment received adopts the OFFER start_date |
| `verify-referrals` | Generate-offers preview "Pays S$288.00", Create offers, Payment received → referrer reward |
| `verify-smoke-admin` | route renders, h1 "Packages", no console error |

**⚠ RISK 1 — NO driver clicks:** Record a sale · Decline · Cancel package · Extend ·
Retire/Reoffer · Add package · Add category · category Default / Max · held search · Show
superseded. **Each is a HAND CHECK with a screenshot, at the END of the stage that moves it,
named in the commit** (playbook §4). Checklist:

- **Stage 4** (list-core): held search narrows + "No held package matches"; Show/Hide superseded toggles rows; Retire a product then Reoffer
- **Stage 5** (confirm/cancel): Decline a pending → gone; Cancel an active → status Cancelled, value frozen
- **Stage 5** (categories): Add category; set Default; set Max to 5 then blank; Remove → 23503 message on a sold-against category
- **Stage 6** (product): Add package with each validation message + one with a referral override
- **Stage 7** (extend): Extend 1 week → expires_on +7, "+7 days · manual"; 60 weeks → "52 weeks is the most"
- **Stage 8** (sale): parent → product → start date auto-fills AND "Pays S$…" appears; swap product → both change; Record sale → held row Active

Run `verify-packages` after 4/5/6/8 (Stage 4 moves `load()` and every row mapping the
driver reads — the queue count and the live-balance cell), `verify-package-renewal` after
8/9, `verify-referrals` after 6/9. **All four after Stage 11.** A red on a **cold** dev server is §7.108 first —
re-run warm. Drivers reset the shared DB; own it before running, never edit the page while
one runs. **File ONE `BACKLOG.md` item: a `verify-packages-admin` driver for the ten
uncovered actions.**

## 8. Accepted consequences (playbook rule 0)

- **No served-bundle grep** (§7.31). CI + drivers + hand checks are the deploy check.
- Every test here is a **characterisation test** — say so in each header; §7.25's prove-red
  rule does not apply. The fence (Stage 0b) is the exception, proven red in full.
- `git blame` on moved lines points at the refactor commit; one slice per commit keeps
  `--follow` useful.

## 9. Deliberately NOT doing

- **No behaviour change.** If a stage needs one, stop — it is a `BACKLOG.md` item. The
  tempting ones are all named as prohibitions in §6 (await the IIFE, add effect resets/deps,
  make the category `Max` input controlled, split `busy`/`error` per hook).
- **`waMessage` / `referralDiscount` / `tableSearch` / `lessonDates` stay in `lib/`.**
- **No lifting a shared `ui/` atom to `@/components`** mid-refactor (§7.233). A third copy of
  an atom already duplicated in L-A → `BACKLOG.md`, don't pre-share.

## 10. Estimate

~1 session. The Students pilot did 2,284 lines in one; packages is 2,014 with 8 slices and 41
`useState`. Cost is in keeping each stage small enough that none needs debugging.

## 11. The gate order, restated

1. **Full green nightly** confirming L-A (the flake fix) — precondition for Stage 1.
2. Stages 0b–11 on `main`, gated per commit (typecheck + tests + the three greps).
3. Drivers after their slices and after Stage 11; hand checks per §7.
4. **`packages` survives a full nightly** before unit 4 starts.

## 12. Pre-commit gate (walk it every stage; a box you can't tick is a blocker)

- [ ] typecheck + both test suites green; page `useState` count went DOWN, never up
- [ ] no `\bsupabase\b` outside `dao/` (from Stage 3)
- [ ] the stage's §7 hand-check done, screenshot named in the commit; the message names the gate result and the drivers run, and the commit hash goes into the §6 stage table (playbook §6)
- [ ] the relevant driver(s) run warm and green (§7.108 first on a cold red)
- [ ] **top three prohibitions held:** (1) `busy`/`error` still single, passed down — no new `useState(false)` in a slice hook; (2) no effect gained a dep, reset, or cancellation; (3) the referral-reward IIFE is still un-awaited

## 13. Durable findings to graduate at `/update-docs`

_(Append as they arise during execution. GRADUATED 2026-09-16 at `/update-docs`.)_

- **The /packages driver net is thin** — ten admin actions have no automated coverage
  (Record a sale, Decline, Cancel, Extend, Retire/Reoffer, Add package, Add category,
  category Default/Max, held search, Show superseded). All were hand-checked with
  screenshots across Stages 4–11; a `verify-packages-admin` driver is filed in
  `BACKLOG.md`. **→ graduated to `BACKLOG.md`.**
- **The local stack OOM-kills the DB under the driver load** (Docker + Supabase + 2 dev
  servers + Playwright); `supabase stop && start` recovers, a bare re-`start` hits a stale
  lock. **→ graduated to `docs/GOTCHAS.md` §7.239.**
- **packages is the SECOND full-track page** (after Students), so the programme trigger to
  graduate the dao three-way split + "orchestrate an rpc, never replace one" into
  `docs/ARCHITECTURE.md` §6 is now MET. **→ noted in `BACKLOG.md` (Feature-tier item) as
  ready; not yet written, to avoid duplicating the playbook/dao-header copies.**
