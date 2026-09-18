# Admin L-D — lite batch plan (grading pages)

_Unit in the feature-tier rollout (playbook `FEATURE_TIER_REFACTOR_PLAYBOOK.md` §7.1). Lite
track, folded: **one code commit per page** (L1+L2+L3 folded, the proven L-A/L-B/L-C default),
plus one L0 (this doc + the drift-test widening), one L4 (drivers + hand-checks) for the whole
batch, and one docs commit (ARCHITECTURE §6). **Nothing here changes behaviour** — every cut is
a Fowler refactor, markup verbatim, both apps' suites green at each commit (playbook §0)._

Started 2026-09-18 on branch `refactor/admin-ld` off `main` (`fe90ead`). Root checkout, no
worktree, **no migration**. Follows `platform` (5th full giant, §8.110) — its nightly
`35306167774` went **GREEN** on `44ae740`, so the §7.1 gate is clear to merge this batch once L4
is green. Decisions settled with the user via `/plan-with-confidence` on 2026-09-18 (below).

## Decisions (user, 2026-09-18)

1. **`assessment/[classId]` takes the full lite shape** (dao + domain + ui), not the §7.2 fence
   track. It shares `assessment`'s driver, so it folds into **assessment's commit**.
2. **`components/AssessmentGrid.tsx` is brought into the batch** — its 4 direct supabase writes
   leave the component by **injection** (Option 1, recommended by a Fable 5.1 advisory agent and
   spot-checked): the grid takes a `writes` prop; each caller's hook supplies it from its own dao.
3. **The fence starts policing `AssessmentGrid.tsx`** (check 3 only) so the client cannot return.
4. **The ARCHITECTURE §6 once-off** (dao three-way split + "orchestrate, never replace") ships as
   its own docs commit in this batch.
5. **End point:** L4 green → fast-forward `main` → push (deploys both web apps; zero behaviour
   change, no backend) → dispatch a manual nightly, which becomes the gate for the next unit.

## The batch

`wc -l` on 2026-09-18 — pages total **2,667** (+ the grid: 4 write expressions, 5 check-3 sites
incl. its `import { supabase }` line). `useState` counts are grep tokens incl. the import line —
the same convention as BATCH_C. Just over the
~2,500 guide; accepted because the five share one driver net and `[classId]` is fence-sized.

| Page | Lines | `useState` | `.from` / `.rpc` / other | `lib/` → MOVE (sole importer) | `lib/` → STAY (shared) |
|---|---|---|---|---|---|
| `assessment` | 324 | 5 | 5 / 0 (6th grep hit is `Array.from`) | — | `assessment`, `lessonDates` |
| `assessment/[classId]` | 244 | 8 | 5 / 0 | — | `assessment`, `lessonDates` |
| `makeups` | 654 | 17 | 6 / 3 | — | `lessonDates`, `makeupSearch` |
| `levels` | 704 | 21 | 14 / 0 / `auth.getUser` ×2 | `skillScale` | `studentCounts` |
| `trials` | 741 | 26 | 11 / 4 / `auth.getUser` ×2 | `trialConvert` | `lessonDates`, `packageCoverage`, `sgPhone` |
| `components/AssessmentGrid` | — | (untouched) | 4 write sites | — | `assessment`, `skillProgress`, `lessonDates` |

**Move-or-stay (grep-confirmed 2026-09-18: `@/lib/<mod>` AND `./<mod>`, excluding `.test`; then
`git grep "lib/<mod>" -- '*.test.ts'` for path pins — playbook §2):**

- `skillScale` — only `levels/page.tsx` → **MOVE** to `levels/domain/` (+ `skillScale.test.ts`).
  No test path-pin. Doc pointers: `docs/ARCHITECTURE.md:587`, `docs/TESTING.md:1105` (→ §12).
- `trialConvert` — only `trials/page.tsx` → **MOVE** to `trials/domain/` (+ test). No test
  path-pin. Doc pointers: `BACKLOG.md`, `docs/GOTCHAS.md`, `docs/TESTING.md:257`,
  `docs/ARCHITECTURE.md:611` (→ §12).
- `assessment` — both assessment pages + `students/domain/useGrading` + `AssessmentGrid` → **STAY**.
- `makeupSearch` — `makeups` + `lessons/[classId]/[date]` → **STAY**.
- `studentCounts` (dashboard, students), `sgPhone`, `packageCoverage`, `lessonDates` → **STAY**.
- `supabase` — bound in each page's `dao/`, never imported by the page after its commit.

**Traps visible in the source (carry into each commit):**

- **`trials` declares `useState` mid-component (270-273, `convert*`) with a comment about the
  `if (loading)` early return (405); `useTableSort` ×2 (392, 402) sit above it too. `makeups` has
  the same shape (3 `useMemo` + `useTableSort` above its return at 349). `levels` has no early
  return.** Hook ORDER is load-bearing (React #310 / blank page).
  ⚠ RISK 3 MITIGATION (structural): the folded hook owns EVERY `useState`/`useMemo`/`useTableSort`;
  `page.tsx` makes one hook call, then `if (loading) return …`. ASSERTION per page:
  `grep -cE "useState|useMemo|useTableSort" page.tsx` = **0**, and `verify-trials`/`verify-makeups` green.
- **`trials` and `makeups` each have a private `datesFor()` + `shift()`/`pad()`.** Near-duplicates
  — **do NOT dedupe** into one helper (a second change hiding in the first, rule 0). Each goes to
  its own `domain/`, verbatim.
- **`makeups` fires TWO un-awaited loads inside `loadAll`**: `.from("parent_students")….then`
  (196-208, guarded by `if (kidIds.length)`) and `.rpc("package_live_balances").then` (210) — the
  expiry advisory's inputs, fire-and-forget by design. The dao returns the builder; the hook keeps
  each `.then` exactly where it was. ⚠ PROHIBITION (RISK 5): do NOT merge them into a
  `Promise.all` or `await` them — that makes the booking form wait on an advisory.
- **`levels` resolves `tenant_id` inline** via `(await supabase.auth.getUser()).data.user?.id`
  inside an insert payload (×2). The dao gets thin `getAuthUser()` + profile lookup; the hook keeps
  the call order (auth *before* the insert, evaluated at the same point).
- **`trials` `loadAll` is multi-round-trip** (auth → profile → 4 parallel → attendance → students).
  Every `await` boundary stays in the hook; dao functions are one query each (§6 orchestrate rule).
- **`since` refetch semantics differ between the two assessment pages.** Index: `load` is
  `useCallback(…, [since])` (193) + `useEffect(load, [load])` → editing the date REFETCHES.
  `[classId]`: `load` deps are `[classId]` only (139) → editing the date must NOT refetch; it only
  regroups fresh/stale and rewrites the Back link (`/assessment?since=`). `since` is a LAZY
  `useState(() => todayInSg())` (§7.95).
  ⚠ RISK 4 PROHIBITION: both `load` dep arrays move VERBATIM (`[since]` / `[classId]`); the
  initialiser stays lazy. "Tidying" the deps either way is a behaviour change.
- **Assessment runs at 390×844 in its driver** — the phone-width check is a real regression net
  for the grid; don't touch any class names on the `[classId]` page or the grid.

## The grid injection (Decision 2)

Surface is **3 functions** — the stroke upsert and the single-cell upsert are the same call:

```ts
// lib/assessment.ts (pure types module, already imported by every caller) — type only
export type GradeWrites = {
  upsertGrades: (cells: StrokeCell[]) => PromiseLike<{ error: { message: string } | null }>;
  clearGrade: (studentId: string, skillId: string) => PromiseLike<{ error: … | null }>;
  promoteStudent: (studentId: string, levelId: string) => PromiseLike<{ error: … | null }>;
};
```

- `AssessmentGrid` gains a required `writes: GradeWrites` prop. **Only the 4 expressions change**
  (⚠ PROHIBITION: `writes` is referenced ONLY inside those 4 expressions)
  (`await supabase.from(...)…` → `await writes.x(...)`); the RISK 4 logic (dedupe, whole-stroke
  snapshot, refetch, busy/timer refs, paint-never-clears) stays byte-identical. The `supabase`
  import is deleted. `onPromote` still reads `err.message` — the PostgREST error shape is unchanged.
- **Identity:** each caller builds `writes` as a **module-level const** in its domain hook file,
  so `flushStroke`'s `useCallback` deps are unaffected (do not add `writes` to them per render).
- **`assessment/[classId]/dao/assessClass.repo.ts`** gets `upsertGrades`, `clearGrade`,
  `promoteStudent` (verbatim queries from the grid, `onConflict: "student_id,skill_id"`).
- **`students/`** (finished feature, ledgers empty — stays empty): `students.repo.ts` gains
  `upsertGrades` + `clearGrade`; **reuse the existing `updateStudentLevel`** (line 132, identical
  query) for promote. `useGrading.ts` exports `gradeWrites`; `GradingModal.tsx` passes it. ~12 lines.
- `GradeWrites` lives in `lib/assessment.ts` so no dao imports `@/components` (check 2).
  `lib/assessment.ts` has zero imports and no App twin — safe. A module-level const is possible
  because `StrokeCell` already carries `tenant_id` (`lib/assessment.ts:310-315`).
- ⚠ RISK 1 MITIGATION (structural — the grid becomes unit-testable for the first time, so cash
  it in the SAME commit): new `components/AssessmentGrid.test.tsx` (jsdom + testing-library;
  precedents `components/Table.test.tsx`, `accounting/page.test.tsx`) with a fake `writes`:
  (a) cycle a cell → `upsertGrades([cell])` once, cell carries `tenant_id`;
  (b) cycle top → ungraded → `clearGrade(studentId, skillId)`;
  (c) paint 3 cells incl. a re-cross, advance 350 ms (fake timers) → ONE `upsertGrades` with
      deduped rows (§7.221);
  (d) rejected upsert → `onReload` called once and the painted cells restored;
  (e) promote → `promoteStudent(studentId, levelId)`.
  ASSERTION: 5 green; proven RED (§7.25) by breaking the wiring (e.g. route (c) past
  `dedupeStroke`), then reverted.

## The fence change (L0)

- `SCOPE_DIRS` += **six** entries: `app/(admin)/{levels,trials,makeups,assessment}` **and
  `app/(admin)/assessment/[classId]` as its OWN entry**. ⚠ RISK 7: `sources()` SKIPS any subdir
  holding its own `page.tsx` (test.ts:379-393) — widening `assessment` alone leaves `[classId]`
  and its tiers silently unfenced (and the vacuity test can't notice; PAGES derives from
  SCOPE_DIRS). Caught by `/plan-review` before any code.
- **New `SCOPE_FILES = ["components/AssessmentGrid.tsx"]`**, read by `sources()` through the same
  path — **do NOT walk `components/`** (AuthGuard, RequiresTenant, Sidebar would go red). Extend
  the vacuity test to assert each `SCOPE_FILES` entry is scanned. Checks 1/2/4 skip it
  automatically (not `ui/`, `dao/`, or a page); check 3 fires.
- Pin every current violation by file + snippet: the five pages' data-access lines and `@/lib`
  imports, plus the grid's **5** check-3 sites — `dataAccess()` matches `\bsupabase\b` on ANY line,
  so the `import { supabase }` line (37) is a site too — the 4 writes (`dataAccess` joins a trailing `supabase` to the next
  line: `= await supabase .from("student_skill_progress")`, `? await supabase .from(…)`,
  `: await supabase .from(…)`, `await supabase .from("students")`).
- **Prove red (§7.25):** checks 3+4 on the real violations before pinning; then breakers
  `levels/ui/Break` → `../dao`, `levels/dao/break` → React, `levels/domain/break` → `fetch(`, an
  unpinned `@/lib/utils` on `makeups/page.tsx`, **`assessment/[classId]/ui/Break` → `../dao`
  (proves the nested route is scoped)**, **and a new `supabase` line in the grid**
  (proves `SCOPE_FILES` is live). Remove breakers, all green. Record in the file header like
  every prior scope.

## The driver net (grep, not the playbook's list — §7.236)

`grep -lE "/<route>([\"'\`/?]|$)" verify-*.mjs`, 2026-09-18:

| Page | Drivers that open the ADMIN route | What they actually press |
|---|---|---|
| `levels` | `levels`, `levels-table`, `level-skills`, `platform-admin-scope`, `smoke-admin` | add level · dup-name refusal · Cancel · Remove (cleanup) · add skills · dup skill · Move up (skill, NOT down) · expand |
| `trials` | `trials`, `contact-details`, `platform-admin-scope`, `smoke-admin` | save trial price · book a new child (contact-details: opens the form + phone hint only) |
| `makeups` | `makeups`, `platform-admin-scope`, `smoke-admin` | kid search · book a make-up · duplicate-slot refusal (re-book → "already booked into that lesson") |
| `assessment` (+`[classId]`) | `assessment`, `smoke-admin` | index · class link → grid · cycle · paint · paint row · Escape · Students drawer "Grade skills" (open only) |

**Batch net (dedup, 9):** `levels`, `levels-table`, `level-skills`, `trials`, `contact-details`,
`makeups`, `assessment`, `platform-admin-scope`, `smoke-admin`.

**Hand-checks at L4 — what NO driver presses** (verified by grep 2026-09-18). Screenshot each,
name them in the L4 commit, DB-verify writes:

- **grid, `[classId]`:** **promote** — click "Move up" (the driver only asserts it *appears*).
  Cold-open with no `?since` (defaults to today).
- **`since` edits (RISK 4 ASSERTION):** index — changing the date changes the "N of M assessed"
  counts with no page reload; `[classId]` — changing it regroups greyed cells with **NO network
  request** (DevTools/`page.on("request")`) and the Back link carries the new date.
- **grid, Students modal:** one **cycle click** in the Grade-skills modal (the driver opens it and
  reads text only) — this is the only proof the students-side injection writes.
- **levels:** Edit an existing level (label/order/note) · grade-scale editor: add / rename /
  remove a grade · remove a skill · Move **down** a skill · Enter-key adds (skill, grade) · Remove
  level with students (the `describeLevelRemoval` copy). **RISK 6 ASSERTION:** the "Add grade" row
  and a new level's row carry `tenant_id` = the admin's tenant (SQL).
- **trials:** book for an **existing** student · Cancel a booking · **Convert — RISK 2
  ASSERTION (DB-verified):** with a fixture child holding a future trial, the first press shows
  "Press Convert again" and creates **0** `student_class_enrolments` rows; the second press creates
  **exactly 1** and sets `assignment_status='assigned'`.
- **makeups:** Cancel a booking · **Change** (un-pick the child) · **multi-class child — RISK 5
  ASSERTION:** the "Which class is this making up?" select appears; switching home class empties
  class + date and re-filters hosts; the `book_makeup` request's `p_home_class_id` equals the chosen
  home (network tab) · the expiry warning if a fixture gives one.

## The commits

Gate every commit: `cd SwimSyncAdmin && npm run typecheck && npm test` **and**
`cd SwimSyncApp && npm run typecheck && npm test`. Green or `git checkout -- .` (playbook §2).

- [x] **L0** — this doc + fence widening. `SCOPE_DIRS` +6 (incl. `assessment/[classId]` as its
      own entry), `SCOPE_FILES = ["components/AssessmentGrid.tsx"]` + vacuity assertion. Checks 3+4
      red on the real violations first → pinned **57 data-access snippets + 17 page imports**. Six
      breakers drove all four checks red (incl. `[classId]/ui/Break` → nested scope live, and a grid
      `supabase` line → `SCOPE_FILES` live); shrink test proven by corrupting one pin. Removed →
      6/6. Gate: 770 vitest + 429 jest, both typechecks green.
- [x] **L1–L3 folded, ONE commit per page, smallest first** — all five route units: **0 `useState` /
      `useMemo` / `useTableSort` in any `page.tsx`**, both ledgers **EMPTY** (0 pins left).
      `944ac88` assessment 324→63 + `[classId]` 244→55 + grid injection (+ students ~20 lines,
      `AssessmentGrid.test.tsx` 5/5, each proven red) · `b3bf04b` (unplanned, test-only) the §7.54
      Thead guard widened to `ui/` · `7795f7b` makeups 654→65 · `208659c` levels 704→71 (+`skillScale`
      git mv) · `d5cc8f8` trials 741→62 (+`trialConvert` git mv). **806 vitest** (770 → +36:
      5 grid + 31 characterisation across the five pages' pure modules, each module proven red by a
      planted break) + **429 jest**, both typechecks green at every commit; `tsc --noUnusedLocals`
      clean for every new file. Every `ui/` file verbatim-by-script against its original page; a
      second grep caught one prefix rename inside JSX text ("those p.t.classes") that the
      prefix-stripping verbatim check cannot see — fixed before commit.
- [x] **ARCH §6** (docs) — dao three-way split, *orchestrate, never replace*, and injected writes
      for a shared component written into `docs/ARCHITECTURE.md` §6; playbook §1 points at it and
      §7.5's last box is ticked. Moved-module pointers repointed (ARCHITECTURE §10 ×2, TESTING ×2,
      GOTCHAS §7 line, BACKLOG line).
- [ ] **L4** (once) — every driver in the net, one at a time (`--only`, per-driver DB reset),
      routes warmed first (§7.108), then the hand-checks above.
- [ ] **Ship** — fast-forward `main`, push, confirm Vercel built both apps, `gh workflow run
      ui-drivers.yml`, delete the branch. That nightly is the gate for the next unit.

## Pre-commit gate — walk before EVERY code commit; a box that can't be ticked is a blocker

**Top three:**
- [ ] **Fence scope:** `SCOPE_DIRS` has all 6 entries incl. `assessment/[classId]`; the `[classId]`
      breaker was proven red at L0; the grid's 5 sites were pinned at L0 and are deleted by commit 1.
- [ ] **Grid test:** `AssessmentGrid.test.tsx` 5/5 green, and was shown red against broken wiring.
- [ ] **Suites + hooks:** both typechecks + both suites green; `grep -cE "useState|useMemo|useTableSort"`
      on the page = 0; ledgers only shrank.

Then:
- [ ] Both assessment `load` dep arrays verbatim (`[since]` / `[classId]`); `since` initialiser lazy.
- [ ] makeups' two fire-and-forget `.then` loads still un-awaited, still separate.
- [ ] `ui/` verbatim-by-script clean; `tsc --noUnusedLocals` filtered to the page clean.
- [ ] (L4) all 9 drivers `--only` after route warm; hand-checks incl. Convert 0→1 row, `since` edits,
      promote, Students-modal cycle, Move down, makeups Change/multi-class — screenshots named in the commit.

## §12 — findings for `/update-docs` (append as they arise)

- **Moved-module doc pointers:** `lib/skillScale.ts` → `docs/ARCHITECTURE.md:587`,
  `docs/TESTING.md:1105`; `lib/trialConvert.ts` → `BACKLOG.md`, `docs/GOTCHAS.md`,
  `docs/TESTING.md:257`, `docs/ARCHITECTURE.md:611`. (Repointed in the ARCH §6 commit; plans left as
  historical records.)
- **GOTCHA candidate — the fence walk skips nested routes.** Adding a parent dir to `SCOPE_DIRS`
  never scopes a child `[param]/page.tsx`; each route unit needs its own entry. The first draft of
  this plan got it wrong; `/plan-review` (Fable 5.1) caught it (§7.233 family).
- **GOTCHA candidate — `dataAccess()` counts the `import { supabase }` line**, so a scoped file has
  N+1 check-3 sites, not N write sites.
- **Playbook candidate — injecting a prop into a shared component makes it unit-testable for the
  first time;** land the test in the same commit as the injection.
- **`/plan-review` (Fable 5.1) found 6 factual errors in the draft** (E1 nested-route scope,
  E2 `.from` count, E3 grid's 5th site, E4 two doc pointers, E5 makeups' dup-slot press, E6 the
  `since` semantics) — all verified by hand before folding in.
- **GOTCHA candidate (§7.54 guard eroded by the refactor itself).** `components/Table.test.tsx`'s
  "Thead owns its `<tr>`" scan walked `page.tsx` only; the feature-tier programme moved tables into
  `<page>/ui/*.tsx`, so **24 ui/ files with a `<Thead>`** had silently left the guard. Widened to
  every non-test `.tsx` under `app/(admin)` (all 24 clean); proven red by planting `<Thead><Tr>` in
  `assessment/ui/ClassChecklist.tsx`. General lesson for the playbook: **any source-scanning test
  keyed on `page.tsx` loses coverage as each page is decomposed** — grep the test suite for
  `"page.tsx"` before a unit, not only the fence.
- **Playbook candidate — a sort (or any state) held BELOW a page's `if (loading) return` resets on
  every reload.** makeups' `loadAll()` flips `loading` after each Book/Cancel, which unmounts
  everything under the early return. `useTableSort` in a `ui/` table would silently reset the
  admin's sort after every write; it stays in the hook (as in `attendance`, `invoices`). Rule: a
  page that sets `loading` on RELOAD (not only first load) keeps its sort in `domain/`.
- **Latent (not fixed — rule 0):** makeups' `expiryWarning` `useMemo` omits `homeClass` from its
  deps. Harmless today (every home change clears `bookDate`, forcing a recompute) — noted in the
  hook; a BACKLOG hygiene candidate, never a refactor change.
