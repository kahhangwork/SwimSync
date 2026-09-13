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
      then revert. **Ledger opened here; never widened after L0** (playbook §3). `78d711a`.
- [x] **L1–L3 folded, ONE commit per page** (see §12 for why folded). Each: `types`/
      `constants` + `dao/` + `domain/` (pure mapping under a characterisation test) + `ui/`
      + page-as-composition, in one gated commit. `2309eef` parents · `53a85c6` unassigned ·
      `dc060bb` claims · `2f3679f` admins · `24ffce7` coaches. Every page: 0 `useState`,
      ≤ 91 lines, its ledger entries deleted as the code moved. **Both ledgers now empty.**
- [x] **L4** (once) — full batch net GREEN on the live stack 2026-09-13:
      coach-disable 13/13 · admins 24/24 · active-inactive 17/17 · trial-visibility 11/11 ·
      parent-claim 21/21 · platform-admin-scope 32/32 · tenant-admin 10/10 · smoke-admin 64/64.
      No hand-check needed — smoke-admin opens every admin route these five pages touch and
      the specialised drivers exercise every action. (Ran one-at-a-time via `--only`; a batched
      run OOM-killed the box mid-driver — a local resource limit, not a failure. Stop expo for
      the admin-only drivers to relieve it.)

Then merge → push → delete branch. **Wait for a nightly before `packages`** (never two
units in flight, playbook §7.1).

## §12 — findings for `/update-docs` (append as they arise)

- **Folded L1+L2+L3 into ONE commit per page, not three.** The playbook's lite track lists
  L1 (page renders own JSX, imports `dao/` directly) as a committed state — but the fence's
  end state forbids a page importing `dao/`, so an L1 commit needs a *transitional* dao-import
  pin in `ALLOWED_PAGE_IMPORTS` (the Students pilot's "3 transitional dao/ pins"). Those pins
  belong at L0, and I did not predict them. Folding L1–L3 per page sidesteps it entirely: the
  page goes straight to `domain/` hooks, never imports `dao/` in any committed state, and the
  ledger only ever shrinks after L0 (§3). One commit per page still bisects a driver red to a
  page. **Suggest the playbook §7.1 note this: for the lite track, fold — or pin the
  transitional dao imports at L0.**
- **`git mv`-ing a `lib/` helper into `<page>/domain/` breaks its OWN relative imports.**
  `coachDisableImpact.ts` imported `./lessonDates` etc.; after the move those siblings are
  still in `lib/`, so the `./` specifiers must be repointed to `@/lib/`. typecheck catches it,
  but it is not obvious from the move itself. (claimNaming had no such imports and moved clean.)
- **Two `Field` components now exist** (`admins/ui/Field.tsx`, `coaches/ui/Field.tsx`), byte-
  identical. Kept feature-scoped per §7.233 (don't lift to `@/components` mid-refactor). A
  third copy is the trigger to consolidate — file in `BACKLOG.md` if a later page needs one.
- **`nextDateFor` NOT touched** (out of batch scope; it lives in the drivers, not these pages).

- **L4 batched run OOM-killed the box** (expo + admin dev + supabase + functions + chrome +
  8 node drivers with per-driver resets is too much at once). Running drivers one at a time
  via `--only`, and stopping expo before the admin-only drivers, kept it under. Not a product
  finding; worth a line in `docs/TESTING.md` §5 as a local-run caveat.

_Gotchas → `docs/GOTCHAS.md`, missing-driver items → `BACKLOG.md`, behaviour changes → none
(rule 0)._
