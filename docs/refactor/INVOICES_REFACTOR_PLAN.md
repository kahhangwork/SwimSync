# Invoices page — full-track refactor plan

_Stage 0 of the feature-tier refactor (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`).
`invoices/page.tsx` is the **third full-track giant** — after Students (the pilot) and
`packages` (§8.104). Students and `packages` are the worked examples; this is the plan.
Written 2026-09-16._

**The gate that governs this whole page:** Admin L-B's nightly (`gh run view 35095280475`)
must be green before **`invoices` lands on `main`**. Build it locally now; do not push it
until L-B is confirmed (playbook §7.1 — only one unit validated at a time). Every stage still
gates locally on `cd SwimSyncAdmin && npm run typecheck && npm test` (and the coach app twin,
untouched here but run once to confirm no shared-lib breakage).

---

## 1. The measure (from `wc -l` / grep, 2026-09-16 — re-measure before each stage)

| Fact | Value |
|---|---|
| `app/(admin)/invoices/page.tsx` | **1,748 lines** |
| `useState` | **40** (the `grep -c` of 41 counts the `import { …useState }` line) |
| `useRef` | 2 (`invoiceSeq`, `coverageRequest` — stale-response guards) |
| `useEffect` | 2 (mount → `loadTenant`; `[debouncedSearch, searchField]` → `loadInvoices`) |
| Sibling | `ReminderQueue.tsx` (67 lines, thin wrapper over `@/components/WhatsAppQueue`, **no test**) |
| `.from()` tables | profiles, tenants (r+u), classes, student_class_enrolments, lesson_sessions, trial_bookings, makeup_bookings, attendance, students, student_settlements (insert), parent_tenant_balances, invoices (select + update `reminded_at`) |
| `.rpc()` | `unbilled_sealed_lessons`, `write_off_parent_balance`, `confirm_invoice_paid` |
| `fetch()` | `POST /api/generate-invoices` |
| auth | `supabase.auth.getUser()` (×3), `getSession()` (×1) |

**Definition of done (playbook §6):** `page.tsx` under ~200 lines, **zero `useState`**, both
boundary ledgers empty, `domain/` pure mapping under characterisation tests, every driver in
the net run after its slice AND after the last stage, uncovered actions hand-checked + a
BACKLOG driver filed, this doc's §6/§13 completed, then survives a nightly before the next unit.

---

## 2. The target shape

```
invoices/
  page.tsx            # composition — hooks + 2 effects + JSX. target ~180 lines
  constants.ts        # DMY, ROW_LIMIT, STATUS_FILTERS, INVOICE_CSV_COLUMNS
  types.ts            # InvoiceRow, UnclaimedStudent, OrphanLine, PendingDebit, SearchField
  dao/
    invoices.repo.ts  # every .from() + auth.getUser/getSession, thin { data, error }
    invoices.rpc.ts   # unbilled_sealed_lessons, write_off_parent_balance, confirm_invoice_paid
    invoices.api.ts   # fetch("/api/generate-invoices")
  domain/
    invoiceRows.ts    # PURE: row→InvoiceRow map, formatBillingMonth, filter, CSV cols, sort accessors + TESTS
    useInvoiceList.ts # invoices/loading/search/searchField/capped/loadError/statusFilter/markingPaid + load()
    useTenantBilling.ts # tenantId/isPlatformAdmin/paynow/runDay/auto/businessName + loadTenant + saves
    useGenerate.ts    # genMonth/generating/genResult/showConfirm/blockedLessons/coverage… + loadCoverage + handleGenerate
    useUnclaimed.ts   # unclaimed/settling/settleAmount/settleError + handleSettle
    useOrphans.ts     # orphans/orphanSettling/orphanAmount/orphanError + loadOrphans + handleSettleOrphan
    usePendingDebits.ts # pendingDebits/writingOff/pendingDebitError + loadPendingDebits + handleWriteOff
    settlementPayload.ts  # MOVED from @/lib (sole importer) + its test
    paynow.ts             # MOVED from @/lib (sole importer) + its test
  ui/
    InvoiceToolbar.tsx    # search select+input, status filters, Export CSV, WhatsApp-reminders button, exportNotice
    InvoiceTable.tsx      # the Table (with useTableSort), cap banner, loadError banner, row actions
    GenerationPanel.tsx   # billing-month picker, Generate button, auto toggle, run-day, PayNow inputs, genResult
    ConfirmGenerateModal.tsx  # coverage pre-flight modal
    BlockedLessonsModal.tsx   # server "incomplete_attendance" modal
    UnclaimedModal.tsx        # "no parent account to bill" modal
    OrphanReport.tsx          # standing orphan-lesson section
    PendingDebits.tsx         # standing pending-charge section
    ReminderQueue.tsx         # MOVED here from the page root (git mv), unchanged body
```

Dependency direction (playbook §1): `page → ui → domain → dao`. `ui/` never imports `dao/`;
`dao/` never imports React/`ui`/`@/components`; only `dao/` touches the client or `fetch(`;
`page.tsx` imports only its own tiers + React/Next/`@/components`.

---

## 3. `@/lib` import verdicts (grep-confirmed 2026-09-16)

The sole-importer grep covered BOTH `@/lib/<mod>` AND (from inside `lib/`) `./<mod>`
excluding `.test` — playbook §5's rule, the one that caught `attendanceWindow` on L-B.

| `@/lib` module | Symbols used | Other importers? | Verdict |
|---|---|---|---|
| `supabase` | client | everywhere | → **dao** (client leaves the page) |
| **`settlementPayload`** | `settlementPayload` | **none but this page** | **MOVE → `domain/` (git mv, + `.test.ts`)** |
| **`paynow`** | `payNowProxyWarning` | **none but this page** | **MOVE → `domain/` (git mv, + `.test.ts`)** |
| `classCoverage` | `computeClassCoverage`, `ClassCoverage` | `coaches/domain/coachDisableImpact.ts` | **STAY** (shared; also imports lib siblings) |
| `csv` | `exportCsv`, `CsvColumn` | attendance, credit-notes | STAY, reached from domain |
| `lessonDates` | `todayInSg`, `monthBounds`, `formatSgDate`, `formatSgStamp`, `previousBillingMonth` | ~30 files | STAY, reached from domain/ui |
| `sgPhone` | `blankToNull`, `checkSgPhone`, `normalizeSgPhone` | students, trials, components | STAY, reached from domain/ui |
| `waMessage` | `buildReminderMessage`, `buildWaLink`, `toWaNumber` | packages | STAY, reached from domain |
| `tableSearch` | `ilikeContains` | attendance, students, packages, platform | STAY, reached from dao |

`paynow.ts` has no sibling imports → moves clean. `settlementPayload.ts` likewise. Check each
moved file's OWN relative imports after `git mv` (playbook §5 — L-A's `coachDisableImpact` trap).

---

## 4. Slices by state cluster (the 40 `useState`)

Ordered smallest/most-similar first (playbook §2 order inside 5–10).

| # | Slice → hook | State it owns | Notes |
|---|---|---|---|
| A | **List** `useInvoiceList` | invoices, loading, search, searchField, capped, loadError, statusFilter, markingPaid, `invoiceSeq` ref | `load()` returned (every write awaits it). Parent search = DB pushdown; student search + status filter = client-side (keep the `!inner` comment — RISK, financial). `handleWhatsApp`, `handleMarkPaid`, `invoiceLink`, `totalOutstanding` live here or in `invoiceRows` |
| B | **CSV** (part of list) | exportNotice | `handleExportCsv` + `INVOICE_CSV_COLUMNS` → constants; the notice state folds into `useInvoiceList` or its own tiny hook |
| C | **Unclaimed** `useUnclaimed` | unclaimed, settling, settleAmount, settleError | `unclaimed` is ALSO set by generate → the hook exposes `setUnclaimed` for `useGenerate` to call (shared state, playbook §5) |
| D | **Orphans** `useOrphans` | orphans, orphanSettling, orphanAmount, orphanError | needs `tenantId`; `loadOrphans(tid)` called on tenant resolve |
| E | **Pending debits** `usePendingDebits` | pendingDebits, writingOff, pendingDebitError | needs `tenantId`; reloaded after a successful generate |
| F | **Tenant/billing** `useTenantBilling` | tenantId, isPlatformAdmin, autoEnabled, togglingAuto, runDay, savingRunDay, paynowUen, paynowMobile, paynowSaved, businessName | `loadTenant` is the mount effect. **`tenantId` is the shared spine** — orphans/debits/generate all read it. Load it here, pass it down |
| G | **Generation** `useGenerate` | genMonth, generating, genResult, showConfirm, blockedLessons, coverage, checkingCoverage, coverageError, `coverageRequest` ref | biggest. `latestBillableMonth`, `loadCoverage`, `handleGenerate`. On success calls `list.load()` + `debits.load()` + `unclaimed.setUnclaimed()` — the cross-slice wiring stays in the page or a thin orchestrator, NOT duplicated |

**Cross-slice coupling to respect (do not duplicate the fetch):**
- `tenantId` (F) → D, E, G. Pass as an argument.
- `businessName` (F) → A's `handleWhatsApp`.
- `unclaimed` set by both C and G → C owns it, G calls its setter.
- After generate (G): reload list (A) + pending debits (E). Keep this in the page's compose
  layer or one orchestrator hook, so the sequence is in one place.

---

## 5. The load-bearing comments that MUST travel with their code

Copy verbatim (playbook §2 "comments travel"):
- The `parentEmbed` / `!inner` block in `loadInvoices` — **why student search is NOT pushed
  down** (a financial-communication bug). → `dao` + `useInvoiceList`.
- The FAIL-SAFE branch in `handleGenerate` (`invoices_created === 0 && !sealed && …`) and the
  `unclaimed_billable > 0` branch ABOVE it — the ordering is load-bearing. → `useGenerate`.
- `loadCoverage`'s `⚠ NO is_active FILTER, DELIBERATELY` block (§7.18) → `dao` + `useGenerate`.
- `settled_through` = LATEST lesson, not today (handleSettle / handleSettleOrphan). → hooks.
- `autoEnabled === null` means UNKNOWN not off; `runDay ?? 7` is invented config. → `useTenantBilling` + `GenerationPanel`.
- RISK 3 (cap/scoped search), RISK 6 (debit scoped to own tenant), RISK 7 (chat opened ≠ sent).
- The stale-response guards (`invoiceSeq`, `coverageRequest`) — keep the seq check exactly.

---

## 6. Stage log (fill as each lands — commit SHA + gate result + drivers run)

_(Fold L1–L3 shape does NOT apply — this is a full-track giant; twelve stages, one at a time.)_

| Stage | What | Commit | Gate | Drivers |
|---|---|---|---|---|
| 0 | This plan | `a1a0c51` | — | — |
| 0b | Widen `tierBoundaries.drift.test.ts` to `invoices`; pin ledgers; prove red | `a1a0c51` | typecheck + 708 vitest, fence 6/6 | — |
| 1 | `constants.ts` + `types.ts` (1,748 → 1,662) | `96a851a` | typecheck + 708 vitest | — |
| 2+3 | `dao/invoices.{repo,rpc,api}.ts` — folded; **page holds no client** (1,662 → 1,561) | `f3a12b8` | typecheck + 708 vitest, fence 6/6 | — (drivers start Stage 4) |
| 4 | List: `domain/invoiceRows.ts` (+7 tests) → `useInvoiceList` → `ui/InvoiceToolbar` + `ui/InvoiceTable` + `ReminderQueue` git-mv'd into ui (1,561 → 1,197) | `15f542a` | typecheck + 715 vitest, fence 6/6 | **verify-invoice-controls 18/18** |
| 5 | `useUnclaimed` + `ui/UnclaimedModal` (1,197 → 1,051) | `735137a` | typecheck + 715 vitest, fence 6/6 | trial-onboarding deferred to Stage 9 (modal only reachable via generation) |
| 6 | `useOrphans` + `ui/OrphanReport` + `settlementPayload` git-mv into domain (1,051 → 911) | `31cc398` | typecheck + 715 vitest, fence 6/6 | **verify-orphan-report 14/14** |
| 7 | `usePendingDebits` + `ui/PendingDebits` (911 → 808) | `229d3bf` | typecheck + 715 vitest, fence 6/6 | (unit — dormant on prod) |
| 8 | `useTenantBilling` + `ui/GenerationPanel` + `paynow` git-mv into domain (808 → 560) | `d9cd977` | typecheck + 715 vitest, fence 6/6 | **verify-invoice-controls 18/18** |
| 9+11 | `useGenerate` + `ui/ConfirmGenerateModal` + `ui/BlockedLessonsModal`; **page → composition, 200 lines, 0 useState, both ledgers EMPTY** | `f72b435` | typecheck + 715 vitest, fence 6/6 | full net (below) |

**Done. Page 1,748 → 200 lines, 0 `useState`, both boundary ledgers empty.** Full driver net,
all green (2026-09-16, local stack): invoice-controls 18/18 (×2), orphan-report 14/14,
platform-admin-scope 32/32, tenant-admin 10/10, smoke-admin 64/64, trial-onboarding 10/10,
unmarked-lessons 12/12, payment-collection 19/19.

---

## 7. Driver net (playbook §4 — verified by grep, names are not evidence)

`grep -lE '/invoices' verify-*.mjs` → these open the page. Run the relevant one at the end of
its slice, all again after Stage 11.

| Driver | Covers | Port-hardcoded? |
|---|---|---|
| `verify-invoice-controls` | generation panel, table, mark-paid | no |
| `verify-orphan-report` | orphan-lesson section | no |
| `verify-unmarked-lessons` | blocked-lessons / coverage refusal | **yes (3000/8081)** — port-sub copy if run vs a worktree (playbook §4) |
| `verify-payment-collection` | INV refs, mark-paid, WhatsApp | no |
| `verify-platform-admin-scope` | platform-admin notice, cross-tenant | no |
| `verify-tenant-admin` | smoke of admin invoices | no |
| `verify-trial-onboarding` | the `unclaimed_billable > 0` branch | no |
| `verify-smoke-admin` | route loads, h1 present, no console error | no |

**Uncovered actions to hand-check (screenshot, name in commit, file a BACKLOG driver):**
pending-debits Write-off, PayNow save + advisory, run-day save, auto-toggle, CSV export cap
banner. (Most are DORMANT on prod — §3 — so no driver exists; the hand-check is the net.)

---

## 13. Findings for `/update-docs`

- **Cross-slice cycle pattern (new, worth graduating).** `useGenerate` fills the unclaimed
  modal and `useUnclaimed`'s settle writes `genResult` (owned by `useGenerate`) — a cycle.
  Broken by making `useUnclaimed` dep-free and passing `genMonth` + `setGenResult` to
  `handleSettle` at CALL time from the page's compose layer, and creating `useGenerate` after
  `useUnclaimed` so it can take `setUnclaimed`. General rule for the remaining giants: when two
  slices write each other's state, the later-created hook takes the earlier's setter, and the
  reverse direction is passed as a call-time arg — never a creation dep. (Playbook §5 candidate.)
- **`loadTenant` returns the resolved id** so the page effect chains the tenant-scoped report
  loads (orphans, pending debits) off the return value rather than racing the `tenantId` state
  update. Pattern for any "shared-spine id loaded in one hook, needed by siblings".
- **`sgDisplay.drift.test.ts` allowlist entries are file-pinned** — moving `formatBillingMonth`
  (a `toLocaleDateString` month+year site) from `page.tsx` to `domain/invoiceRows.ts` needed the
  entry repointed in the same commit, or the scan flags it at the new path. (Same class as the
  §1 table's `sgDisplay` note; add invoices as a worked instance.)
- **Two clean `git mv`s into domain** (`paynow`, `settlementPayload`) — both sole-imported by
  this page within admin, both with their `.test.ts`, both with no lib-sibling relative imports,
  so they moved without repointing. `settlementPayload` is shared by TWO invoices hooks
  (useUnclaimed + useOrphans) — "sole importer" is the FEATURE, not one file.
- **BACKLOG driver:** four admin actions on this page have no dedicated driver — PayNow save +
  advisory, run-day save, CSV export cap banner, and pending-debits **Write off** (the last is
  dormant on prod). `smoke-admin` loads the page (h1 + no console error) and the moves are
  verbatim, but a `verify-invoice-admin` driver (mirror of the `verify-packages-admin` BACKLOG
  item from §8.104) would close the gap. File in `BACKLOG.md`.
- **Still-due once-off (unchanged by this session):** the dao three-way-split + "orchestrate,
  never replace" rule graduates to `docs/ARCHITECTURE.md` §6 (trigger met since packages; now
  three full giants exercise it).
</content>
</invoke>
