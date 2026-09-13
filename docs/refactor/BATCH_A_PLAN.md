# Admin L-A — lite batch plan (people pages)

_Unit 2 of 17 in the feature-tier rollout (playbook `FEATURE_TIER_REFACTOR_PLAYBOOK.md`
§7.1). Lite track: three code commits per page (L1/L2/L3), plus one L0 (this doc + the
fence) and one L4 (drivers) for the whole batch. **Nothing here changes behaviour** —
every cut is a Fowler refactor, markup verbatim, suite green at each commit (playbook §0)._

Started 2026-09-13 on branch `refactor/admin-la` off `main`. Root checkout, no worktree,
no migration.

## The batch

Five admin "people" pages, grouped by driver net (playbook §7.1). Line counts from
`wc -l` on 2026-09-13 (re-measured, not from prose) — total **2,447**, one giant's worth
of risk, one nightly.

| Page | Lines | `useState` | `.from` / `.rpc` / `fetch` | `lib/` → MOVE (sole importer) | `lib/` → STAY (shared) |
|---|---|---|---|---|---|
| `coaches` | 622 | 17 | 6 / 0 / 3 | `coachDisableImpact` | `lessonDates` |
| `admins` | 575 | 18 | 3 / 1 / 2 | — | — |
| `parents` | 370 | 10 | 2 / 1 / 0 | — | `studentStatus`, `packageCoverage`, `lessonDates` |
| `unassigned` | 391 | 13 | 7 / 1 / 0 | — | `packageCoverage`, `lessonDates` |
| `claims` | 489 | 9 | 0 / 6 / 0 | `claimNaming` | `lessonDates`, `packageCoverage` |

**Move-or-stay rule (grep-confirmed, playbook §2 stage 5):** a `lib/` helper moves into
`<page>/domain/` only if that page is its **sole code importer**. Verified by
`grep -rln '@/lib/<mod>' SwimSyncAdmin/{app,lib,components}` on 2026-09-13:

- `coachDisableImpact` — only `coaches/page.tsx` → **MOVE** into `coaches/domain/`.
- `claimNaming` — only `claims/page.tsx` → **MOVE** into `claims/domain/`.
- `studentStatus` — `parents` + `students` (dao & domain) → **STAY** (already bound in students).
- `packageCoverage` — 12 importers → **STAY** (shared; reach it from `domain/`).
- `lessonDates` — ~25 importers → **STAY** (shared; reach it from `domain/`).
- `supabase` — the client is bound in each page's `dao/`, never imported by the page after L1.

## The driver net (grep, not the playbook's suggested list — §7.236)

`grep -lE "/<route>[\"\`/]" verify-*.mjs` over the drivers dir, 2026-09-13:

| Page | Drivers that open it |
|---|---|
| `coaches` | `coach-disable`, `platform-admin-scope`, `tenant-admin`, `smoke-admin` |
| `admins` | `admins`, `platform-admin-scope`, `smoke-admin` |
| `parents` | `active-inactive`, `platform-admin-scope`, `smoke-admin` |
| `unassigned` | `active-inactive`, `trial-visibility`, `platform-admin-scope`, `smoke-admin` |
| `claims` | `parent-claim`, `smoke-admin` |

**Batch net (dedup):** `coach-disable`, `admins`, `active-inactive`, `trial-visibility`,
`parent-claim`, `platform-admin-scope`, `tenant-admin`, `smoke-admin`.
The playbook's suggested net omitted `platform-admin-scope` (opens all five) and
`tenant-admin` (coaches) — grep is the fact. Only **`active-inactive`** hardcodes
`localhost:3000`/`8081`; irrelevant on root main (no port substitution needed).

## The commits

Gate every commit: `cd SwimSyncAdmin && npm run typecheck && npm test` **and**
`cd SwimSyncApp && npm run typecheck && npm test`. Green or `git checkout -- .` (playbook §2).

- [x] **L0** (this doc + fence) — widen `tierBoundaries.drift.test.ts` `SCOPE_DIRS` to the
      five folders, generalise `PAGE`→`PAGES`, pin every current violation in both ledgers
      (by file + snippet, each with the stage that removes it), prove all four checks red
      then revert. **Ledger opened here; never widened after L0** (playbook §3).
- [ ] **L1** — per page: `constants.ts` + `types.ts` + the whole `dao/` (`.repo`/`.rpc`/`.api`,
      client-taking `lib/` helpers bound). After L1 no page imports `@/lib/supabase`.
- [ ] **L2** — per page: `domain/` hooks + the pure mapping with a **characterisation** test
      (header says so, §0). `coachDisableImpact`→`coaches/domain/`, `claimNaming`→`claims/domain/`.
      Page still renders its own JSX.
- [ ] **L3** — per page: `ui/` surfaces + page reduced to composition (< ~200 lines, 0
      `useState`). Both ledgers → 0 for that page; icons (`lucide-react`) move into `ui/`.
- [ ] **L4** (once) — own the shared DB, run the batch net + `smoke-admin`; hand-check
      anything no driver opens, screenshot named in the commit. A red bisects by page
      (`git bisect` across the L1–L3 commits with the failing driver).

Then merge → push → delete branch. **Wait for a nightly before `packages`** (never two
units in flight, playbook §7.1).

## §12 — findings for `/update-docs` (append as they arise)

_(Nothing yet. Gotchas → `docs/GOTCHAS.md`, missing-driver items → `BACKLOG.md`,
behaviour changes → none allowed by rule 0.)_
