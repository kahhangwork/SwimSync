# Students page → feature-scoped three-tier decomposition

_Plan written 2026-09-09. The **pilot** for decomposing every oversized admin page. Nothing
here changes behaviour: every step is a refactor in Fowler's sense — a behaviour-preserving
transformation with the test suite green before and after._

_The target file is `SwimSyncAdmin/app/(admin)/students/page.tsx` — **2,284 lines / 98 KB**,
the largest source file in the repo. It was chosen because it is the worst by a real margin
(next is `packages/page.tsx` at 2,014) and because it exercises all three call shapes
(`.from()`, `.rpc()`, `fetch()` to a server route), so whatever pattern survives here
transfers to the other seven._

**Baseline, measured 2026-09-09 before any change:** `npm run typecheck` clean ·
`npm test` **56 files / 637 tests green**. That is the net. Any step that reddens it is
reverted, not debugged forward.

---

## 1. The decisions, settled with the user

| Decision | Answer |
|---|---|
| Decomposition axis | **Feature first, tier second.** Not tier-only |
| Where tiers live | Scoped to the feature: `app/(admin)/students/{ui,domain,dao}/` |
| Middle tier's name | **`domain`**, not `app` |
| Underscore prefix (`_ui`) | **No.** Not needed, and the repo has zero `_` folders |
| Constants & types | Two files at the feature root: `constants.ts`, `types.ts` |
| Where `.rpc()` goes | **`dao/`**, in its own file — never the domain tier |
| Where `fetch('/api/…')` goes | **`dao/`**, in its own file. The route handler itself does not move |
| Enforcement | A **source-scanning boundary test**, in the existing vitest suite. No ESLint |
| Commit granularity | **One feature per commit**, suite green at each |

### The target shape

```
app/(admin)/students/
  page.tsx              # composition only — target ~150 lines
  constants.ts          # ROW_LIMIT, WEEKDAY_ORDER, STATUS_FILTERS
  types.ts              # domain entities only (see §4)
  ui/                   # presentation — one file per feature surface
  domain/               # logic, hooks, orchestration
  dao/
    students.repo.ts    # .from()  ×18  → PostgREST tables
    students.rpc.ts     # .rpc()   ×5   → Postgres functions
    students.api.ts     # fetch()  ×1   → /api/invite-parent
```

Dependency direction, and the only one permitted:

```
page.tsx  →  ui  →  domain  →  dao  →  (PostgREST | rpc | /api)
```

---

## 2. Why feature-first, and not tier-only

`page.tsx` is not one feature in three layers. It is **nine slices welded together**, each
with its own state cluster, handlers, and modal. Slicing only by tier would turn one
2,284-line file into three ~760-line files that all nine slices still touch. Every future
change would still open all three. Coupling unchanged; the mess redistributed.

Fowler's sequence is *Extract Function → Extract Class → Move Function*: find the behaviour
seam first, then push each piece down to its layer. **Feature is the seam. Tier is the shelf
you put it on afterwards.**

The seam is already drawn, in the naming of the 68 `useState` calls. They cluster almost
perfectly:

```
renameFor   renameName   renameBusy   renameError
addClassFor addClassChoice addClassBusy addClassError
contactFor  contactName  contactPhone contactBusy contactError …
```

That convention is the extraction map. Follow it rather than inventing one.

### The nine slices, with their anchors in the current file

| # | Slice | Current handlers | State prefix |
|---|---|---|---|
| 1 | List, search, filters | `load` (882), `statusLabel` (1005), `runningLow` (1014) | `students` `search` `statusFilter` `covMap` `capped` |
| 2 | Merge duplicates | `doMerge` (153) | `merging` `merge*` `pending` `family` `takeSiblings` |
| 3 | Rename | `openRename` (221), `handleRename` (227) | `rename*` |
| 4 | Add to class | `openAddClass` (261), `handleAddClass` (268), `loadClasses` (555) | `addClass*` `classOptions` |
| 5 | Status / inactive | `openInactive` (297), `handleStatusChange` (312) | `busyId` `actionError` |
| 6 | Grading & levels | `loadLevels` (468), `openGrading` (485), `setLevel` (532) | `grade*` `levels` `savingLevelFor` |
| 7 | Add student (+ dup check) | `resetAddForm` (577), `handleAddStudent` (588) | `add*` |
| 8 | Contact & parent invite | `openContact` (691), `handleSaveContact` (793), `handleInviteParent` (830) | `contact*` `invite*` |
| 9 | Referral drawer | — | `drawerFor` `drawerReferral` `refereeRes` |

**Plus one that does not belong on this page at all:** `loadPackages` (406),
`saveThreshold` (432), `saveExpiryDays` (444) — tenant-level *package* settings living on the
Students screen. See §8.

---

## 3. Why `dao/` is three files, not one

The split is by **failure mode**, not by transport. All three leave the browser; nothing above
`dao/` should be able to tell them apart.

| File | Calls | Fails with |
|---|---|---|
| `students.repo.ts` | `.from()` ×18 | RLS denial, empty result, the 1000-row PostgREST cap (`ROW_LIMIT`) |
| `students.rpc.ts` | `.rpc()` ×5 | `permission denied` after a migration (§7.87), a DB guard rejecting the write |
| `students.api.ts` | `fetch()` ×1 | HTTP status, network, the server route's own error shape |

### The rpc file carries a prohibition

The five rpcs — `merge_students`, `rename_student`, `add_unclaimed_student`,
`find_roster_duplicates`, `student_package_coverage` — are **not data access. They are business
logic that lives in Postgres**: multi-table atomic writes behind RLS, audit triggers, and the
billing guards.

> **The domain tier may orchestrate an rpc. It may never replace one.**

Filed next to row-CRUD, someone eventually reimplements one "for clarity" in TypeScript. In
this codebase that is precisely how an override lands on a guard `CLAUDE.md` says must never
have one. The separate file is the fence, and this paragraph is why it exists.

### Why the route handler does not move

`app/api/invite-parent/route.ts` **stays where it is.** Next derives the URL from the file
path — moving the file changes the URL and breaks the `fetch` at line 841. That is a
behaviour change, not a refactor.

`dao/students.api.ts` is the *client* end of that wire; the route handler is the server end.

**The rule for future work:** needs service-role / must bypass RLS → a server route in
`app/api/`, called through `dao/*.api.ts`. Everything else → `dao/*.repo.ts` or
`dao/*.rpc.ts`, direct from the client under RLS. For Students this is already settled: 1 api
call, 23 direct. `invite-parent` is server-side because it creates an auth user.

---

## 4. Why `types.ts` holds domain entities ONLY

`StudentRow` as it stands is a **database row shape rendered directly by the UI**. If it lives
in a shared `types.ts` that `ui/` imports, the presentation tier depends on the Postgres
schema — exactly what three tiers exist to prevent. The folders would look right and the
coupling would be unchanged.

So:

- **`types.ts`** — domain entities only. What a Student *is* to the business.
- **`dao/`** — row and DTO shapes. The dao maps row → entity at the boundary.
- **`ui/`** — props and form-state types, beside their component.

Boundary check 2 in §5 catches violations automatically.

---

## 5. Stage 0 — the enforcement, built BEFORE anything moves

Without this, the structure decays in weeks and the next session cannot tell a violation from
a design. `SwimSyncAdmin` has **no ESLint at all** — no config file, not in `package.json` —
so the usual `no-restricted-imports` answer means adopting a toolchain.

The repo's own idiom is cheaper and already runs in CI: a **source-scanning test**. Six exist
already (`sgDisplay.drift.test.ts`, `studentStatus.drift.test.ts`, …). Add a seventh.

**`SwimSyncAdmin/lib/tierBoundaries.drift.test.ts`**

| # | Check |
|---|---|
| 1 | No file in `ui/` imports from `dao/` |
| 2 | No file in `dao/` imports React, or anything from `ui/` |
| 3 | **No file outside `dao/` imports `@/lib/supabase` or calls `fetch(`** |
| 4 | `page.tsx` imports only from `ui/`, `domain/`, `constants`, `types` |

Check 3 is the one that pays: it is what stops the 29 inline supabase calls from ever coming
back — on this page or the seven that follow.

**Scope it to `app/(admin)/students/` for now**, and widen the glob as each later page is
converted. A check that is red on seven unconverted pages is a check nobody can keep green.

> **§7.25 applies: prove every check RED before trusting it.** Write the check, break the rule
> on purpose, watch it fail, revert. A boundary test that has never failed is decoration.

Also in Stage 0, as its own commit:

- **Delete `SwimSyncAdmin/constants/`.** One file, `placeholder.ts`, 74 lines of mock coaches
  and classes from before the backend existed. **Nothing imports it** (verified 2026-09-09).
  It also collides in name with the `students/constants.ts` this plan creates.

---

## 6. The hard constraints — read before moving any `lib/` module

`students/page.tsx` imports 13 modules from `lib/`. **Only two may move into
`students/domain/`.**

| Module | Verdict |
|---|---|
| `studentStatus`, `skillProgress`, `lessonDates` | **Cannot move.** Drift-pinned byte-identical to `SwimSyncApp/lib/`. Moving reddens the drift test — loudly, which is correct |
| `lessonDates` (25 importers), `utils` (16), `packageCoverage` (11), `tableSearch` (6), `sgPhone` (5), `assessment` (4), `studentCounts` (3) | **Should not move.** Shared across admin pages |
| `duplicateStudents` (1), `rosterDuplicates` (1) | **May move.** Students-only |

> **The criterion:** `lib/` = shared across features, or across apps.
> `students/domain/` = students-only.

`skillProgress` shows both rules interacting: one importer, but pinned to SwimSyncApp, so it
stays.

### Why the folders sit inside `app/`, and must keep sitting there

`lib/sgDisplay.drift.test.ts` scans exactly:

```js
const SCAN_DIRS = [
  "SwimSyncAdmin/app", "SwimSyncAdmin/components", "SwimSyncAdmin/lib",
  "SwimSyncApp/app",   "SwimSyncApp/components",   "SwimSyncApp/lib",
];
```

Anything moved to a **new top-level folder** becomes invisible to it. The test does not fail —
it silently checks less code, and stays green. That guard exists because a timezone display
bug shipped to production (§7.229, §7.230).

`app/(admin)/students/{ui,domain,dao}/` is already inside `SwimSyncAdmin/app`, so coverage is
retained for free. **This is the reason the tiers are feature-scoped rather than top-level.**
If a future refactor moves them out, `SCAN_DIRS` must be widened in the same commit.

### Why no underscore prefix

Next.js supports colocation explicitly: **only `page.tsx` and `route.ts` make a folder
routable.** `students/domain/` can never become a URL on its own. The `_` prefix would buy a
visual route-vs-code signal, which matters only once `students/` has sub-routes — it has none.
Adding a `_` convention for one feature, in a repo with zero `_` folders, costs more
consistency than it buys. **If `/students/[id]` is ever added, rename then.**

---

## 7. Stages 1–11 — one commit each, suite green at every one

Fowler's discipline, and the reason this plan is a list of small steps rather than a branch:
**commit after each, and never let two behaviour-preserving moves ride together.** If step *n*
reddens the suite, the cause is unambiguous.

| Stage | Work | Risk | Est. |
|---|---|---|---|
| **0a** | Delete dead `constants/` | none | 2 min |
| **0b** | `tierBoundaries.drift.test.ts`, all 4 checks proven RED | none | 1 h |
| **1** | Extract `constants.ts` + `types.ts` (lines 45–106) | none | 20 min |
| **2** | `dao/students.repo.ts` — the 18 `.from()` calls, no logic | low | 1.5 h |
| **3** | `dao/students.rpc.ts` + `dao/students.api.ts` | low | 45 min |
| **4** | Slice 1 — list, search, filters → `domain/` + `ui/` | med | 1.5 h |
| **5** | Slices 3, 4, 5 — rename, add-to-class, status (small, similar) | low | 1.5 h |
| **6** | Slice 2 — merge duplicates | med | 1 h |
| **7** | Slice 7 — add student + dup check | med | 1.5 h |
| **8** | Slice 8 — contact & parent invite (the only `fetch`) | med | 1.5 h |
| **9** | Slice 6 — grading & levels | med | 1.5 h |
| **10** | Slice 9 — referral drawer | low | 45 min |
| **11** | `page.tsx` down to composition; widen boundary test | low | 45 min |

**Total: roughly 2–3 focused days.** Stage 1 is deliberately first and deliberately trivial —
it is ~60 of 2,284 lines (**2.6%**) and will not make the file readable. Its value is that it
settles the folder convention on zero-risk lines before anything else moves.

Stages 2 and 3 come before any UI work because the dao is the tier that does not exist at all;
once it does, every later slice has somewhere to put its calls.

### The gate at every stage

```bash
cd SwimSyncAdmin && npm run typecheck && npm test
```

Both green, or revert. No exceptions, and no "I'll fix it in the next commit".

---

## 8. Coverage — what actually protects this refactor

**Nothing tests this page's UI.** There is no vitest file for `students/page.tsx` and no
`verify-students` driver. That is the single largest risk in this plan and it is why the
staging above is so fine-grained.

What does exist:

| Net | Covers |
|---|---|
| `npm test` — 637 tests | The `lib/` logic the page imports. Green baseline 2026-09-09 |
| `npm run typecheck` | Every extraction's wiring — the main defence during moves |
| `verify-student-identity` | Rename, merge, add-unclaimed (slices 2, 3, 7) |
| `verify-class-students` | Add-to-class, roster (slice 4) |
| `verify-parent-claim` | Contact, claiming, invite (slice 8) |
| `verify-assessment` | Grading, levels (slice 6) |

All four drivers were **green in the 2026-09-08 nightly** (`34286144530`).

> **Run the relevant driver at the end of its own slice, not once at the end of the refactor.**
> The drivers are the only thing covering the *wiring*; batching them destroys the property
> that makes small commits useful — knowing which step broke it.

### These are characterisation tests, not proofs

Any test written during this refactor describes behaviour that **already exists**. §7.25's rule
— a test must be proven to fail without its fix — **cannot apply**, because there is no fix.
Say so in each test's header comment, or the next session will read them as coverage they are
not. (The boundary test in Stage 0b is the exception: it is a new rule, so §7.25 applies to it
in full.)

---

## 9. Accepted consequences

1. **More files, more imports.** ~15 files where there was 1. That is the trade being made
   deliberately: navigability over locality.
2. **The boundary test is scoped to Students at first**, so the other seven pages remain
   unguarded until converted. A check red on unconverted code is a check that gets disabled.
3. **`git blame` on the moved lines points at the refactor commit.** Unavoidable. Mitigated by
   one-feature-per-commit, which keeps `--follow` useful.
4. **Two `lib/` modules gain a second home** (`duplicateStudents`, `rosterDuplicates` move to
   `students/domain/`). Their tests move with them.
5. **No behaviour change ships.** Which also means **no served-bundle grep is possible** —
   §7.31/§7.51's deploy check needs a user-visible string only the new build has, and this
   change adds none. CI plus the four drivers stand in its place, exactly as §8.98 did.

---

## 10. Deliberately NOT doing

- **Moving the package settings off this page.** `loadPackages`, `saveThreshold`,
  `saveExpiryDays` are tenant-level *package* configuration living on the Students screen. They
  belong on Packages. Moving them is a **behaviour change, not a refactor** — it goes in
  `BACKLOG.md`, not this branch. Extract them into `domain/` in place, and leave them there.
- **Adopting ESLint.** A new toolchain in the middle of a refactor. The boundary test covers
  the one rule that matters, in the idiom the repo already uses. Revisit separately.
- **Renaming or relocating `lib/`.** 57 modules, 51 tests, three drift tests with hardcoded
  paths. A huge diff for zero behaviour change, and it would move files out of `SCAN_DIRS`.
- **Converting the other seven pages in this branch.** Students is the pilot. The pattern gets
  reviewed on one page before it is repeated on `packages` (2,014), `invoices` (1,748),
  `classes` (1,714), `platform` (1,395).
- **Adding a `verify-students` driver.** Tempting, but a new driver is new behaviour to
  maintain and the four existing ones already touch every slice. Reconsider after the pilot.

---

## 11. The rollout, after the pilot is reviewed

Order by size, which here is also roughly order by pain:

| Page | Lines |
|---|---|
| `packages/page.tsx` | 2,014 |
| `invoices/page.tsx` | 1,748 |
| `classes/page.tsx` | 1,714 |
| `platform/page.tsx` | 1,395 |
| `lessons/[classId]/[date]/page.tsx` | 912 |

Those five plus Students are **9,155 lines — 43% of all admin page code**.

**Do not start the second page until the first is merged and has survived a nightly sweep.**
The point of a pilot is that the pattern can still change.

---

## 12. Durable findings to graduate at `/update-docs`

To be filled in as the work lands. Candidates already known:

- The `SCAN_DIRS` hazard — a new top-level folder silently narrows a source-scanning guard
  rather than failing. Likely a **new gotcha** (§7.233+), since it generalises well beyond
  this refactor.
- The dao three-way split and its "orchestrate, never replace" rule — belongs in
  `docs/ARCHITECTURE.md` once proven on a second page.
- `SwimSyncAdmin` has no ESLint; structural rules are enforced by source-scanning tests.
  Belongs in `docs/TESTING.md` §5.
