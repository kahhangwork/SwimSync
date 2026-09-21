# Admin L-E + the admin fence commit

_The last admin lite batch (`dashboard`, `locations`, `history`) **plus** the four auth
fence pages, taken as one unit. Written 2026-09-21, hardened the same day by `/plan-review`
(Fable 5.1), which found **8 factual errors — 7 confirmed by hand, 1 wrong**; the counts
below are the corrected ones. Method: the refactor playbook, §7.1 (lite) and §7.2 (fence).
This is the batch's L0 plan doc; the playbook is the method and is not restated here._

**Rule 0 applies in full: nothing here changes behaviour.** Markup moves verbatim, cuts are
scripted, every commit is gated. A change that would need behaviour to move is a
`BACKLOG.md` item, not a commit.

---

## 1. What is in scope, measured

`wc -l` / `grep -c` on 2026-09-21 (§7.236 — re-derive, never trust a count in a document).

**"Fence pins" is the number of lines the fence will actually pin, not the number of
queries.** `dataAccess()` (`tierBoundaries.drift.test.ts:553`) pins every line matching
`\bsupabase\b` after `stripComments()` — the `import { supabase }` line included.

| Route unit | Lines | `useState` | Fence pins (check 3) | Page imports to pin (check 4) | Drivers that OPEN it |
|---|---|---|---|---|---|
| `app/(admin)/dashboard` | 473 | 11 | 16 | 4 | join-code, orphan-report, platform-admin, **platform-admin-scope**, smoke-admin |
| `app/(admin)/locations` | 386 | 12 | 7 | 1 | locations, smoke-admin |
| `app/(admin)/history` | 302 | 7 | 2 | 2 | **smoke-admin only** |
| `app/login` | 132 | 5 | 4 | 2 | **40 drivers** (`loginAdmin()`, `lib.mjs:77`) + smoke-admin logged-out |
| `app/accept-invite` | 210 | 8 | 6 | 1 | **tenant-provisioning (full valid path)**, smoke-admin (invalid branch) |
| `app/reset-password` | 181 | 7 | 5 | 1 | smoke-admin only — **invalid branch only** |
| `app/forgot-password` | 106 | 5 | 2 | 1 | smoke-admin only |

**Lite 1,161 lines · fence 629 · seven `SCOPE_DIRS` entries · 42 check-3 pins · 12 check-4 pins.**

Corrections the review earned, kept here because the wrong version is the intuitive one:
`verify-admins.mjs:81` only asserts the string `/accept-invite` appears in an error panel —
it never navigates. `verify-smoke-app.mjs` builds its `/reset-password` and `/accept-invite`
URLs from `${EXPO}`, so those are the **parent app's** screens, not these. **But
`verify-tenant-provisioning.mjs:154-180` does open the real admin invite link, fill both
password fields and press *Set Password & Continue*** — the review claimed it had no
`accept-invite` at all; it has the only full valid-path coverage in the suite.

No page in scope has a nested route, so §7.247 does not bite. `app/page.tsx` (5 lines, a
bare `redirect("/login")`) is **out of scope** — playbook §7 excludes it by name.

### The `lib/` verdicts

Criterion (Students plan §6): `lib/` = shared across features or apps; `<page>/domain/` =
that page only.

| Module | Importers (non-test) | Verdict |
|---|---|---|
| `auditDiff` | **1** — `history/page.tsx`; admin-only, no App twin, no test-path pin | **MOVES** to `history/domain/` |
| `packageCoverage` | 19 | Stays in `lib/` |
| `studentCounts` | 3 | Stays in `lib/` |
| `adminNav` | 3 (`login/page.tsx`, `Sidebar`, `RequiresTenant`) | Stays in `lib/` — `landingRoute` reached from `login/domain/` |

---

## 2. The commits

Six, plus a ship step. One per page so a driver red at L4 bisects to a page (playbook §7.1),
folding L1–L3 per page as Admin L-A proved correct — so no page imports `dao/` in any
committed state and neither ledger needs a transitional pin.

### ⚠ THE GATE — both apps, every commit, no exceptions

```bash
cd SwimSyncAdmin && npm run typecheck && npm test
cd SwimSyncApp   && npm run typecheck && npm test      # ⚠ NOT optional — see RISK 2
git grep -nE "from ['\"](@/app/|.*\(admin\)/)" -- 'SwimSyncAdmin/lib/*.ts'   # must print NOTHING (§7.250)
```

Green, or `git checkout -- .` and take a smaller step. **ASSERTION: 819 vitest / 84 files
before** (measured 2026-09-21) **→ 819 + N after**, N = the characterisation tests added. A
count that *drops* means a test was lost, not that a file moved. **Re-measure the jest
baseline at L0** — 429 is the last recorded figure and the runner is the fact.

---

### L0 — widen the fence, pin the ledgers, prove red

1. Add all **seven** entries to `SCOPE_DIRS` in `lib/tierBoundaries.drift.test.ts`, each
   with a comment block naming the commit that removes its violations.
2. Run the suite; **record the printed violation list verbatim** and pin every line in
   `ALLOWED_DATA_ACCESS` / `ALLOWED_PAGE_IMPORTS`, by file **and** content snippet.
   Expect 42 and 12. **If the printed numbers differ from §1, §1 is wrong — correct the
   table from the runner, never the reverse.**
3. **⚠ RISK 8 MITIGATION — prove the fence is not vacuous, with five breakers:** the four
   standard ones (a `.from()` in a `ui/` file; a `dao/` import from `ui/`; a `@/lib/utils`
   import on a scoped `page.tsx`; a React import in `dao/`), **plus one inside
   `app/login/`** — this is the first `SCOPE_DIRS` entry outside `app/(admin)`, and a walk
   that never reaches it would stay green while checking nothing — **plus one corruption of
   a ledger entry's snippet**, which must trip the stale-entry test. Record all five in the
   file header. Revert each after it goes red.
4. Commit this doc.

### 1. `dashboard` — folded L1–L3

- `dao/dashboard.repo.ts` — the counts block, the unassigned read, the invoice read, the
  `auth.getUser()` → `profiles` → `tenants` chain, the `tenants.update` rename.
- `dao/dashboard.rpc.ts` — `regenerate_join_code`, `student_package_coverage`.
- `domain/useDashboard.ts`, `domain/useTenantCard.ts`, `domain/dashboardRows.ts`
  (`formatBillingMonth`) + characterisation test.
- `ui/TenantCard.tsx`, `ui/MetricGrid.tsx`, `ui/UnassignedMini.tsx`, `ui/OutstandingMini.tsx`.

> **⚠ RISK 2 MITIGATION (§7.241) — STEP, in THIS commit:** repoint the `sgDisplay` pin in
> **both twins** — `SwimSyncAdmin/lib/sgDisplay.drift.test.ts:63` **and**
> `SwimSyncApp/lib/sgDisplay.drift.test.ts:62` — from
> `app/(admin)/dashboard/page.tsx` to `app/(admin)/dashboard/domain/dashboardRows.ts`,
> same `contains` snippet (`parseInt(month) - 1`). Both app twins scan `SwimSyncAdmin/app`.
> The invoices refactor repointed only the admin twin, passed the local gate and went
> **red on `main`**. ASSERTION: `grep -rn "dashboard/page.tsx" */lib/sgDisplay.drift.test.ts`
> prints **nothing** after this commit.

> **⚠ RISK 5 MITIGATION — STRUCTURAL, not vigilance:** `dao/dashboard.repo.ts` exports
> **one** `countMetrics()` holding the seven-way `Promise.all` **verbatim, its ORDER IS THE
> CONTRACT comment included**, and the hook keeps the positional destructure verbatim. Do
> **NOT** export seven separate count builders for the hook to re-list — that is precisely
> the edit that swaps Outstanding Invoices for the credit-note count, silently, because
> every metric is a small plausible integer.
> **PROHIBITION:** the `student_package_coverage` `.then` (`page.tsx:193`) stays
> **un-awaited**, and the tenant-card IIFE (`:222`) stays a **separate un-awaited** chain.
> Awaiting either into `load()` makes a failed RPC blank the dashboard.

### 2. `locations` — folded L1–L3

- `dao/locations.repo.ts` — **three functions, mirroring the `levels` precedent:**
  `getAuthUser()`, the `profiles.tenant_id` lookup, and the list/insert/update/archive
  calls. The hook composes them **in the page's current order**.
- `domain/useLocations.ts` (list + archive), `domain/useLocationForm.ts` (form + validation).
- `ui/LocationsTable.tsx`, `ui/LocationFormModal.tsx`, `ui/RemoveLocationModal.tsx`.

> **⚠ RISK 4 MITIGATION (§7.249) — STRUCTURAL:** `useTableSort` **stays in
> `domain/useLocations.ts`**; `LocationsTable` receives `sort` and `visible` as props.
> `load()` flips `loading` on every reload (`page.tsx:55`) and the table sits below the
> `loading ? …` switch (`:208`), so a sort held in `ui/` is destroyed after every Save and
> Remove. ASSERTION: `grep -rc useTableSort "app/(admin)/locations/ui/"` = **0**.
> **PROHIBITION:** the `err.code === "23505"` and `"23514"` branches move **verbatim** into
> the hook — they are the only thing that turns a database refusal into a sentence the
> admin can act on.

### 3. `history` — folded L1–L3, **and the `auditDiff` pair move**

- `git mv lib/auditDiff.ts lib/auditDiff.test.ts` → `app/(admin)/history/domain/`, **in this
  commit** (§7.250 — moving half makes `lib/` import a route folder).
- `dao/history.repo.ts` — the filtered `audit_log` read.
- `domain/useHistory.ts` (rows, filters, the `cancelled` latch), `domain/historyRows.ts`
  (`formatWhen`, `KIND_LABEL`) + test. `constants.ts` takes `ENTITY_TYPES`, `ROW_LIMIT`.
- **Repoint the three doc pointers in this same commit:** `docs/ARCHITECTURE.md:649`,
  `docs/TESTING.md:259`, `BACKLOG.md:802`.

> **⚠ RISK 6 MITIGATION (§7.227) — ASSERTION:** the date bounds are built as
> `` `${dateFrom}T00:00:00+08:00` `` and `` `${dateTo}T23:59:59+08:00` `` (`page.tsx:97-98`)
> and move **verbatim**. A characterisation test in `domain/historyRows.test.ts` pins both
> strings exactly. ASSERTION: `grep -rc '+08:00' "app/(admin)/history/"` = **2** after the
> commit. **PROHIBITION:** do NOT rebuild either bound from a `Date` — this page exists to
> settle disputes, and a zoneless bound moves the day boundary to the viewer's midnight.

### 4. The fence commit — all four auth pages at once (§7.2)

No `ui/` folders (§7.2: a 130-line login page does not need one). Each page gets a
`dao/<page>.repo.ts` holding its `supabase.auth.*` calls — check 3 flags the **word**
`supabase`, so every auth call moves, not just `.from()` ones — and a
`domain/use<Page>.ts` holding its state. **The JSX does not move**: the only diff in each
`page.tsx` is its import lines and the hook call.

> **⚠ RISK 1 MITIGATION — login is the front door for 40 drivers and every real admin.**
> STEP, before this commit: run `verify-platform-admin-scope` (it asserts both landings and
> the coach/parent refusal copy) and **record N/N**; re-run after → **same N/N**.
> **PROHIBITIONS:** `useRouter()` stays in `page.tsx` and the hook receives `router.push` as
> a call-time argument; the `signOut()` call moves **verbatim inside the refusal branch**
> and is never hoisted out of it. ASSERTIONS: `grep -c signOut app/login/dao/login.repo.ts`
> = 1; `grep -c landingRoute app/login/domain/useLogin.ts` = 1.

> **⚠ RISK 3 MITIGATION — the two token flows.** `accept-invite`'s valid path IS covered
> (`verify-tenant-provisioning`, full: link → password → sign-in), so **run that driver
> before and after this commit and record N/N**. `reset-password`'s valid path is covered by
> **nothing** — smoke-admin renders only the invalid branch, so a broken recovery flow is
> green at L4. STEP at L4: generate a real link with
> `supabase.auth.admin.generateLink({ type: 'recovery' })` against the local stack, open it,
> set a password, then prove `signInWithPassword` succeeds with it. Screenshot, named in the
> L4 commit.
> **PROHIBITIONS:** the `/error=/` hash check stays **first** in the effect, before any
> client call; the subscription handle from `onAuthStateChange` is **returned by the dao
> binding** so the hook can still unsubscribe, and the 3-second timer keeps its
> `clearTimeout`; **nothing that reads `window` may sit at module scope in a `dao/` file** —
> these pages prerender at `next build`, and `forgot-password:23`'s
> `` redirectTo: `${window.location.origin}/reset-password` `` is computed **inside** the
> function, at call time. Do **NOT** change any `redirectTo` value: the Supabase allow-list
> is exact-match, and a substituted URL still "works" while landing the owner nowhere useful
> (§7.41).

### 5. L4 — verification

1. **Warm the routes first** (§7.108): `run-all-drivers.sh --only` for the batch net —
   `join-code`, `orphan-report`, `platform-admin`, `platform-admin-scope`, `locations`,
   `tenant-provisioning`, `smoke-admin` — so a cold-compile timeout is not mistaken for a
   regression.
2. **Then the full sweep:** `run-all-drivers.sh` end to end, 52 drivers, ~90 min. It resets
   the DB per driver — **never beside a worktree**.
3. The hand-checks below, each with the query or screenshot that proves it.

### 5b. Ship

`cd SwimSyncAdmin && npx next build` green → `/deploy` → push → dispatch the nightly that
gates the next unit.

> **⚠ RISK 3b MITIGATION — ASSERTION:** `next build` is in no other gate, and a lost
> `"use client";` or a module-scope `window` passes typecheck and vitest and fails only on
> Vercel — which for `/login` is a dead admin panel. `head -1` of all **seven** `page.tsx`
> still reads `"use client";`.

---

## 3. The hand-checks — what no driver presses

Each needs the DB query or screenshot that proves it.

| # | Surface | Proof |
|---|---|---|
| 1 | dashboard — Rename business, Save | `SELECT display_name FROM tenants WHERE id=…` |
| 2 | dashboard — Generate a new code | `SELECT join_code …` before ≠ after; old code refused at signup |
| 3 | dashboard — six metric values | SQL per card on a fixture with **distinct non-zero** values (seed has several zeros, which cannot detect a swap) |
| 4 | locations — Remove one with ACTIVE classes | the refusal copy names the count; row **not** archived |
| 5 | locations — Remove one with RETIRED classes | `archived_at` set; retired classes keep it; sort survives a Save |
| 6 | history — each filter, Clear filters, the 1000-row notice | row counts match the same filter in SQL |
| 7 | reset-password — the whole valid path | RISK 3's generated link + sign-in |

---

## 4. Pre-commit gate — walk this before every commit

- [ ] **Both** suites green — `SwimSyncAdmin` **and** `SwimSyncApp` (RISK 2)
- [ ] vitest count 819 → 819 + N; jest unchanged from the L0 baseline
- [ ] `git grep` for a `lib/` → route-folder import prints nothing (§7.250)
- [ ] Neither ledger has grown; stale entries deleted, not re-pointed

**The four that cannot be ticked late** — each is green locally and red somewhere real:

- [ ] **Both `sgDisplay` twins repointed** in the dashboard commit (RISK 2, §7.241)
- [ ] **`useTableSort` still in `domain/`** for locations (RISK 4, §7.249)
- [ ] **`countMetrics()` is one verbatim block** (RISK 5)
- [ ] **`next build` green before the push** (RISK 3b)

## 5. Definition of done

- [ ] Seven route units in `SCOPE_DIRS`; **both ledgers empty** for all seven
- [ ] Each lite `page.tsx` under ~200 lines with **zero** `useState`
- [ ] Each fence `page.tsx` passes checks 3 and 4
- [ ] 52/52 drivers green; all 7 hand-checks recorded
- [ ] Every admin route file is now fenced — the admin half of playbook §7.5 is closed
