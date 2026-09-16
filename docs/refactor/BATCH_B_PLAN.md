# Admin L-B — lite batch plan (calendar pages)

_Unit 4 of 17 in the feature-tier rollout (playbook `FEATURE_TIER_REFACTOR_PLAYBOOK.md`
§7.1). Lite track, folded: **one code commit per page** (L1+L2+L3 folded, the proven L-A
default — playbook §7.1), plus one L0 (this doc + the drift-test widening) and one L4
(drivers) for the whole batch. **Nothing here changes behaviour** — every cut is a Fowler
refactor, markup verbatim, both apps' suites green at each commit (playbook §0)._

Started 2026-09-16 on branch `refactor/admin-lb` off `main`. Root checkout, no worktree,
no migration. Follows `packages` (the 2nd full giant, §8.104) — the "never two units in
flight" gate cleared by its nightly `35032652395`.

## The batch

Five admin "calendar" pages, grouped by driver net (playbook §7.1). Line counts from
`wc -l` on 2026-09-16 (re-measured, not from prose) — total **2,387**, one giant's worth
of risk, one nightly.

| Page | Lines | `useState` | `.from` / `.rpc` / `fetch` | `lib/` → MOVE (sole importer) | `lib/` → STAY (shared) |
|---|---|---|---|---|---|
| `attendance` | 867 | 24 | 9 / 2 / 0 | `makeupFromAttendance` | `csv`, `lessonDates`, `packageCoverage`, `lessonAttribution`, `tableSearch` |
| `substitutes` | 539 | 13 | 5 / 1 / 0 | — | `lessonDates`, `sessionRoster` |
| `holidays` | 443 | 14 | 8 / 2 / 0 | `holidaysCsv` | — |
| `calendar` | 282 | 7 | 0 / 0 / 0 | — | `calendarData`, `calendarLessons`, `lessonDates`, `timeOfDay` |
| `lessons` (list) | 256 | 6 | 0 / 0 / 0 | — | `attendanceWindow`, `calendarData`, `calendarLessons`, `classColours`, `lessonDates`, `markableFloor`, `timeOfDay`, `utils` |

**`attendance` is the heaviest lite page yet (867 / 24)** — top of the lite range (250–900).
Still one folded commit; one commit per page bisects a driver red to a page regardless of size.

**`calendar` and `lessons` hold no `supabase` line** — they read through
`@/lib/calendarData` (`loadCalendarData`), which does the query itself. So check 3 never
fires for them; only check 4 (their `@/lib/*` imports). `calendarData` is **bound in each
page's `dao/`** (it stays shared in `lib/`, reached from `dao/`), not moved.

**Move-or-stay rule (grep-confirmed, playbook §2 stage 5):** a `lib/` helper moves into
`<page>/domain/` only if that page is its **sole code importer**. Verified by
`grep -rln '@/lib/<mod>' SwimSyncAdmin/{app,lib,components}` on 2026-09-16:

- `makeupFromAttendance` — only `attendance/page.tsx` (+ its co-located test) → **MOVE** into `attendance/domain/`.
- `holidaysCsv` — only `holidays/page.tsx` (+ its test; `lib/csv.ts` only *mentions* it in a comment) → **MOVE** into `holidays/domain/`.
- `attendanceWindow` — **STAY** (corrected from L0). The `@/lib/` grep showed one importer, but
  `lib/lessonMarking.ts` and `lib/markableFloor.ts` import it by **relative path** (`./attendanceWindow`),
  which that grep misses. It is shared; reach `markableWindowStart` from `lessons/domain`.
  **Lesson: grep both `@/lib/<mod>` AND `./<mod>` (from inside lib/) before calling a helper sole-imported.**
- `calendarData` — `calendar` + `lessons` (2 importers) → **STAY** (bind in each page's `dao/`).
- `sessionRoster` — `classes` (non-batch) + `substitutes` → **STAY** (shared).
- `csv` (3), `lessonAttribution` (3), `tableSearch` (7), `calendarLessons` (10),
  `classColours` (4), `markableFloor` (2), `packageCoverage` (15), `lessonDates` (34),
  `timeOfDay` (2), `utils` (17) → **STAY** (shared; reach from `domain`/`ui`).
- `supabase` — the client is bound in each page's `dao/`, never imported by the page after its commit.

## The nested-route fix (L0, done)

`app/(admin)/lessons/` holds a **separate full-track giant** at
`lessons/[classId]/[date]/page.tsx` (912 lines, its own unit). Scoping `app/(admin)/lessons`
made the drift test's recursive `walk` scan that giant too, so check 3 flagged its ~20 calls.
Fixed in `tierBoundaries.drift.test.ts`: **`walk` no longer descends into a subdirectory that
holds its own `page.tsx`** (a separate route unit — scoped on its own turn); tier folders
(`ui`/`domain`/`dao`) have no `page.tsx` and are still walked. First scoped dir with a nested
route; the fix is general.

## The driver net (grep, not the playbook's suggested list — §7.236)

`grep -rl "/<route>" verify-*.mjs` over the drivers dir, then filtered to the drivers that
open the **admin** route (the `/attendance` route also exists in the coach + parent apps —
those drivers target `${EXPO}/(coach)/classes/.../attendance`, not `${ADMIN}/attendance`), 2026-09-16:

| Page | Drivers that open the ADMIN route |
|---|---|
| `attendance` | `admin-lesson-detail`, `platform-admin-scope`, `smoke-admin` |
| `substitutes` | `coach-roster` (opens `${ADMIN}/substitutes`), `smoke-admin` |
| `holidays` | `smoke-admin` **only** (no specialised driver → hand-check its actions at L4) |
| `calendar` | `admin-calendar`, `cancel-lesson`, `smoke-admin` |
| `lessons` (list) | `admin-calendar`, `admin-lesson-detail`, `cancel-lesson`, `smoke-admin` |

**Batch net (dedup):** `admin-lesson-detail`, `platform-admin-scope`, `coach-roster`,
`admin-calendar`, `cancel-lesson`, `smoke-admin`.
The playbook's suggested net matched on the specialised ones; grep adds `platform-admin-scope`
(opens all admin routes). **`holidays` has no specialised driver** — smoke-admin opens it;
hand-check mark/unmark holiday + CSV import + extension-days at L4 with a screenshot. A
`verify-packages-admin`-style follow-up for holidays could be filed in `BACKLOG.md` if hand-checks feel thin.

## The commits

Gate every commit: `cd SwimSyncAdmin && npm run typecheck && npm test` **and**
`cd SwimSyncApp && npm run typecheck && npm test`. Green or `git checkout -- .` (playbook §2).

- [x] **L0** (this doc + the drift-test widening) — widen `SCOPE_DIRS` to the five folders,
      fix `walk` to stop at nested route pages, pin every current violation in both ledgers
      (by file + snippet, each with the commit that removes it), prove all four checks red
      then green. **Ledgers opened here; never widened after L0** (playbook §3).
- [x] **L1–L3 folded, ONE commit per page** (playbook §7.1). Order smallest/simplest first:
      `f4fbf7e` lessons (256→67) · `2dc4b4f` calendar (282→45) · `b4b775b` substitutes (539→105) ·
      `923b582` holidays (443→113) · `f3b6a8e` attendance (867→110). Every page: **0 `useState`**,
      its ledger entries deleted as the code moved. **Both ledgers now empty.** 708 vitest
      (+25 characterisation tests across the 5 pages) + 429 jest, both apps green at each commit.
- [x] **L4** (once) — full batch net GREEN on the live stack 2026-09-16, one driver at a
      time (`--only`, per-driver DB reset): **smoke-admin 64/64 · admin-calendar 21/21 ·
      admin-lesson-detail 27/27 · cancel-lesson 17/17 · coach-roster 30/30 (substitutes) ·
      platform-admin-scope 32/32**. `holidays` hand-check **9/9** (add · ext-days save · void ·
      restore · CSV import · remove) against `coach@swimsync.test` — screenshot
      `handcheck-holidays.png` (scratchpad). No product finding; the one red was a script
      ambiguity (header trigger + modal submit both read "Add holiday").

Then merge → push → delete branch. **Wait for a nightly before the next unit** (never two
units in flight, playbook §7.1). Next after L-B is a full giant (giant/batch alternation):
`invoices` (1,748) is the largest remaining.

## §12 — findings for `/update-docs` (append as they arise)

- **The drift test's `walk` recursed into a nested route page.** `lessons/[classId]/[date]`
  (a separate full-track giant) lives under `lessons/` (the L-B list page), so scoping
  `app/(admin)/lessons` dragged the giant's ~20 supabase calls into check 3. Fixed: `walk`
  skips a subdir that holds its own `page.tsx`. First scoped dir with a nested route; worth a
  playbook note — a giant that lives under another page's folder is scoped on its own turn,
  and the walk already excludes it.
- **The `@/lib/<mod>` sole-importer grep UNDER-REPORTS — it misses relative imports from
  inside `lib/`.** `attendanceWindow` looked sole-imported by `lessons/page.tsx` at L0, so it
  was pinned as a MOVE; in fact `lib/lessonMarking.ts` and `lib/markableFloor.ts` import it by
  `./attendanceWindow`, so it is shared and STAYS. **Before calling a helper sole-imported,
  grep BOTH `@/lib/<mod>` AND (from inside `lib/`) `./<mod>`, and exclude `.test`.** Cost
  nothing here (caught before the move); would have broken two lib modules if moved.
- **A `ui/` component importing a TYPE from `dao/` trips check 1** (ui never imports dao) — the
  regex does not distinguish `import type`. Shared row types (`Holiday`, `AttendanceRow`,
  `MakeupClass`) belong in a page-level `types.ts` that dao AND ui import. Playbook §1 already
  says types live in `types.ts`; this is why it matters for the boundary, not just tidiness.
- **`useRef<T>(null)` is `RefObject<T | null>` under these React types** — a prop that receives
  a passed-down ref must type it `RefObject<T | null>`, or tsc rejects the wire-up.
- **The lite fold puts each page's `useTableSort` in its `ui/…Table` component** (holidays,
  attendance) — RISK 3 from packages, an always-mounted component. Attendance's sort is created
  in the hook instead (it feeds the export's `visible`), and passed to the Th wiring; both are
  stable because the hook lives as long as the page.

_Gotchas → `docs/GOTCHAS.md` (the two grep/boundary lessons above are candidates), missing-driver
items → `BACKLOG.md` (holidays has no specialised driver — see the net table), behaviour changes
→ none (rule 0)._
