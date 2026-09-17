# Classes page — full-track refactor plan

_Stage 0 of the feature-tier refactor (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`).
`classes/page.tsx` is the **fourth full-track giant** — after Students (pilot), `packages`
(§8.104) and `invoices` (§8.106). Those three are the worked examples; this is the plan.
Written 2026-09-17._

**The gate that governs this whole page:** the `invoices` unit must have survived a nightly
on `main` before **`classes` lands on `main`** (playbook §7.1 — one unit validated at a time).
That nightly is GREEN: run `35159359809` on `2895cf2` (= current `main` tip), full driver net
passed. So `classes` is cleared to start. Build every stage locally, gate on
`cd SwimSyncAdmin && npm run typecheck && npm test` (+ the coach-app twin once, to confirm no
shared-`lib` breakage — this page moves two `lib/` modules).

---

## 1. The measure (from `wc -l` / grep, 2026-09-17 — re-measure before each stage)

| Fact | Value |
|---|---|
| `app/(admin)/classes/page.tsx` | **1,714 lines** |
| `useState` | **51** |
| `useEffect` | **2** (mount → 5 loaders; `[drawerClass?.id, coaches.length]` → `loadShadows`) |
| `useMemo` | **3** (`locationOptions`, `pickerOptions`, `rosterByClass`) |
| `useRef` | 0 |
| `.from()` tables | classes, coaches, coach_rates, class_categories, locations, student_class_enrolments, trial_bookings, class_shadow_coaches |
| `.rpc()` | `set_class_terms`, `assign_class_shadow`, `end_class_shadow`, `schedule_extra_lesson`, `cancel_lesson`, `deactivate_class`, `reactivate_class`, `student_package_coverage` |
| `fetch()` | **none** |
| auth | **none** (no `getUser`/`getSession` on this page) |
| Local components | `Field` (form input), `capitalize` helper, `DAYS` const |

**Definition of done (playbook §6):** `page.tsx` under ~200 lines, **zero `useState`**, both
boundary ledgers empty, `domain/` pure mapping under characterisation tests, every driver in
the net run after its slice AND after the last stage, uncovered actions hand-checked + a
BACKLOG driver filed, this doc's §6/§13 completed, then survives a nightly before the next unit.

---

## 2. The target shape

```
classes/
  page.tsx              # composition — hooks + 2 effects + JSX. target ~180 lines
  constants.ts          # DAYS, ROW_LIMIT
  types.ts              # ClassRow, LocationOpt, Coach, ShadowAssignment (+ re-export Roster* )
  dao/
    classes.repo.ts     # every .from() — classes, coaches, coach_rates, categories, locations, enrolments, trial_bookings, shadows; thin { data, error }
    classes.rpc.ts      # set_class_terms, assign/end_class_shadow, schedule_extra_lesson, cancel_lesson, deactivate/reactivate_class, student_package_coverage
    (no .api.ts — this page makes no fetch())
  domain/
    classRows.ts        # PURE: row→ClassRow map (the §7.28 is_active mapping), filter, sort accessors, counts + TESTS
    classRoster.ts      # MOVED from @/lib (sole importer) + its test — buildClassRoster/format/describe + Roster* types
    locationOptions.ts  # MOVED from @/lib (sole importer) + its test — locationFilterOptions/formLocationOptions
    useClassList.ts     # classes, coaches, loading, search, capped, locationFilter, showRetired + loadClasses/loadCoaches + load()
    useRoster.ts        # enrolments, bookings, covMap, rosterError + loadRoster + rosterByClass(classes,today)
    useClassDrawer.ts   # drawerClass + shadows/shadowPick/shadowFrom/shadowBusy/shadowError + loadShadows/assign/end
    useClassForm.ts     # the create/edit modal: title…colour, categories, locations, editingId, original, correctInPlace + handleSubmit/openEdit/resetForm + loadCategories/loadLocations
    useExtraLesson.ts   # extraFor/Date/Reason/Saving/Error/Done + handleScheduleExtra/openExtra
    useCancelLesson.ts  # cancelFor/Date/Reason/Saving/Error/Done + handleCancelLesson/openCancel
    useRetire.ts        # retireFor, retireSaving, restoringId, retireError + handleRetire/handleRestore
  ui/
    Field.tsx           # the local form input atom (feature-scoped; see §5 — dup is allowed, §7.233)
    ClassToolbar.tsx    # search, location filter, show-retired toggle, cap banner, top-level retire-error banner
    ClassTable.tsx      # the Table (with useTableSort), student badge, row actions (see/edit/extra/cancel/retire/restore)
    ClassFormModal.tsx  # create/edit modal (coach/day/category/time/location/rate/capacity/colour + money-moved radio)
    ExtraLessonModal.tsx
    CancelLessonModal.tsx
    RetireModal.tsx
    RosterDrawer.tsx    # shadow-coach section + enrolled list + trials list (READ-ONLY — see §5 prohibition)
```

Dependency direction (playbook §1): `page → ui → domain → dao`. `ui/` never imports `dao/`;
`dao/` never imports React/`ui`/`@/components`; only `dao/` touches the client; `page.tsx`
imports only its own tiers + React/Next/`@/components`.

---

## 3. `@/lib` import verdicts (grep-confirmed 2026-09-17)

Sole-importer grep covered BOTH `@/lib/<mod>` AND (from inside `lib/`) `./<mod>`, excluding
`.test` — playbook §5's rule (the one that caught `attendanceWindow` on L-B).

| `@/lib` module | Symbols used | Other importers? | Verdict |
|---|---|---|---|
| `supabase` | client | everywhere | → **dao** (client leaves the page) |
| **`classRoster`** | `buildClassRoster`, `formatStudentCount`, `describeStudentCount`, `RosterEnrolment`, `RosterBooking` | **none but this page** | **MOVE → `domain/` (git mv, + `.test.ts`)** |
| **`locationOptions`** | `locationFilterOptions`, `formLocationOptions` | **none but this page** | **MOVE → `domain/` (git mv, + `.test.ts`)** |
| `sessionRoster` | `assignableClassShadows` | `substitutes/*` (3 files) | **STAY** (shared), bound/reached from domain |
| `packageCoverage` | `coverageByStudent`, `StudentCoverage` | ~10 features + `PackageChip` | STAY, reached from domain |
| `classColours` | `CLASS_COLOURS`, `colourFor` | `lessons/*`, `calendar/LessonCard` | STAY, reached from ui |
| `lessonDates` | `todayInSg`, `toSgDate`, `formatSgDate` | ~40 files | STAY, reached from domain/ui |
| `tableSort` | `dayOfWeekOrder` | `components/Table.tsx` | STAY, reached from domain |
| `utils` | `formatTime` | ~17 files | STAY, reached from ui |

**Both movers verified clean (2026-09-17):** each has a `.test.ts`, and **zero** relative
(`./`) imports and **zero** `@/lib` imports — so they `git mv` into `domain/` without any
specifier repointing (unlike L-A's `coachDisableImpact`). Still check each moved file's own
imports after the move, per playbook §5.

> **⚠ RISK 10 MITIGATION (movers — the test must move AND still run).** Re-verified at
> plan-review: the only import lines for either module in the whole repo are `page.tsx` and
> each module's own `.test.ts` (`grep -rnE "from ['\"](@/lib/|\./)(classRoster|locationOptions)['\"]"`).
> Assertions, per move (Stage 5 for `classRoster`, Stage 10 for `locationOptions`):
> - `git mv` BOTH files (`x.ts` + `x.test.ts`) — `git log --follow` on the new path shows the
>   `lib/` history; a copy+delete does not.
> - `ls SwimSyncAdmin/lib/classRoster.ts` → **no such file** (so any stale importer fails `tsc`
>   rather than silently using the old copy).
> - `npx vitest run 'classes/domain'` lists **14** cases from `classRoster.test.ts` and **7** from
>   `locationOptions.test.ts` (`grep -c '^\s*it(' ` on each, 2026-09-17). Total vitest count is
>   **unchanged** by the move (moved, not added) — the count going DOWN means a test was orphaned.
> - **Do NOT** add an import to `classRoster.ts` while moving it — it must stay clock-free
>   (`grep -c "lessonDates\|new Date" domain/classRoster.ts` = 0, see RISK 6).

---

## 4. Slices by state cluster (the 51 `useState`)

Ordered smallest/most-similar first (playbook §2 order inside 5–10). Extra/Cancel are near-twins
(a `*For` class ref, a date, a reason, saving/error/done, one RPC each) — do them consecutively.

| # | Slice → hook | State it owns | Notes |
|---|---|---|---|
| A | **List** `useClassList` | classes, coaches, loading, search, capped, locationFilter, showRetired | `load()` returned (form/retire await it). `coaches` is the **shared spine** — drawer shadow name-lookup + warning and the form's coach dropdown all read it. Load here, pass down. `loadCoaches` folds the shadow-rate `coach_rates` read. Derived filtered/visible/sort/counts live in `classRows` or the hook |
| B | **Roster** `useRoster` | enrolments, bookings, covMap, rosterError | `loadRoster` = two reads + the fire-and-forget `student_package_coverage`. `rosterByClass(classes, todayInSg())` memo — clock read in the hook, passed pure into `buildClassRoster` (§7.7). Loaded at mount |
| C | **Drawer + shadows** `useClassDrawer` | drawerClass, shadows, shadowPick, shadowFrom, shadowBusy, shadowError | owns `drawerClass` (the table's badge/See-students set it → pass `setDrawerClass` to `ClassTable`). Effect on `[drawerClass?.id, coaches.length]` → `loadShadows`; clears picks on close. Takes `coaches` for name lookup + the shadow-rate warning |
| D | **Form** `useClassForm` | showModal, saving, saveError, editingId, original, correctInPlace, title, coachId, day, startTime, endTime, locationId, rate, categoryId, capacity, colour, categories, locations | biggest. `moneyChanged` derived; `handleSubmit` (set_class_terms + the plain category/capacity/colour UPDATE), `openEdit`, `resetForm`, `loadCategories`, `loadLocations`. Takes `list.load`. `pickerOptions` memo moves here or to ui |
| E | **Extra lesson** `useExtraLesson` | extraFor, extraDate, extraReason, extraSaving, extraError, extraDone | `schedule_extra_lesson`; refusals rendered verbatim. No list reload |
| F | **Cancel lesson** `useCancelLesson` | cancelFor, cancelDate, cancelReason, cancelSaving, cancelError, cancelDone | twin of E; `cancel_lesson`. No list reload |
| G | **Retire/restore** `useRetire` | retireFor, retireSaving, restoringId, retireError | `deactivate_class` (refusals rendered) + `reactivate_class` (cannot refuse; no confirm). Takes `list.load`; `showRetired` stays in A (it is a list filter) |

**Cross-slice coupling to respect (do not duplicate the fetch):**
- `coaches` (A) → C (name lookup + shadow warning), D (coach dropdown). Pass as an argument.
- `drawerClass` (C) set by `ClassTable` (an A-tier surface) → pass `setDrawerClass` down as a prop.
- `classes` reloaded after: form submit (D), retire+restore (G). Pass `list.load` into D and G.
- `rosterByClass` (B) is read by `ClassTable` (the badge "+N") AND `RosterDrawer` — one derivation,
  same object, so the number and the names can never disagree. Compute in B, pass to both.
- **No write-back cycle exists** (unlike invoices §8.106): every dependency here points one way
  (A→C, A→D, B→table/drawer, D/G→A.load). Ordinary later-depends-on-earlier — no call-time-setter
  gymnastics needed.
- **`retireError` (G) is rendered in TWO places** — the top-level banner (`retireError && retireFor === null`,
  a toolbar surface built at Stage 4) and inside `RetireModal` (Stage 9). Both read the same
  state; the `retireFor === null` guard is what stops the restore failure and the retire refusal
  showing at once. See RISK 9 under Stage 4/9.

> **⚠ RISK 6 MITIGATION (the clock — three reads, one owner).** The page reads `todayInSg()` in
> exactly three places: `loadRoster` (the `.gte("session_date", today)` bound), the `rosterByClass`
> memo (passed into `buildClassRoster`), and `handleSubmit` (`p_effective_from`). All three stay in
> **hooks**, never in `dao/` and never in `classRoster.ts`. (§7.7 — a UTC date here makes the
> "+N" badge and the drawer disagree about who is coming.)
> - **Step (Stage 2):** `dao` trial-bookings read takes `today` as a **parameter**
>   (`loadTrialBookings(today: string)`); `useRoster.loadRoster` reads the clock once and passes it.
> - **Assertion (every stage):** `grep -rn "todayInSg\|new Date(" app/\(admin\)/classes/dao app/\(admin\)/classes/domain/classRoster.ts`
>   = **0 hits**. `grep -rn "new Date(" app/\(admin\)/classes/` = **1 hit, and it is the
>   `// new Date(...).toISOString()` comment** on the Retired badge, nowhere else (1 today).
> - **Do NOT** replace `todayInSg()` in `handleSubmit` with a value captured at hook creation — it
>   must be read at submit time, or a form left open across midnight dates the rate period yesterday.

> **⚠ RISK 7 MITIGATION (drawer effect deps).** The second effect is
> `useEffect(..., [drawerClass?.id, coaches.length])` with an `eslint-disable-next-line`. Both
> halves are load-bearing: `coaches.length` re-runs `loadShadows` once coaches arrive (else every
> name is "Unknown coach" on a fast drawer open); `?.id` not `drawerClass` (else the object identity
> refetches on every list reload). The `else` branch clears `shadows/shadowPick/shadowFrom/shadowError`
> so the next class cannot flash the previous one's assignments.
> - **Assertion (Stage 6):** the dependency array in `useClassDrawer.ts` is **byte-identical**
>   including the eslint-disable comment — pin it in the cut script's `assert old occurs once`.
> - **Do NOT** "fix" the exhaustive-deps warning by widening the array, and do NOT drop the
>   clear-on-close branch because "the drawer is unmounted" — `Drawer` keeps its children mounted
>   with `open={false}`.
> - Vigilance only (nothing structural short of RTL, which the repo does not have): hand-check at
>   Stage 6 — open class A's drawer, close, open class B: no flash of A's shadows.

---

## 5. The load-bearing comments that MUST travel with their code

Copy verbatim (playbook §2 "comments travel"). Each of these guards a real, cited trap:

- **`ClassRow.is_active` / the mapping's `c.is_active NOT e.is_active` (§7.28)** — reading the
  flag off the wrong nesting level renders every class retired. → `types.ts` + `classRows.ts`.
- **`loadClasses`' "RETIRED CLASSES ARE LOADED, AND THAT IS LOAD-BEARING"** — filtering `is_active`
  here strands a month-blocking class with no screen able to see it. → `dao/classes.repo.ts`.
- **`loadRoster`' "FETCHED SEPARATELY… PostgREST returns null for the ENTIRE select" (§7.52)** —
  why the roster is not bolted onto the class query. → `dao` + `useRoster`.
- **`handleEndShadow`' "END, never DELETE… pay re-reads that for every already-paid lesson"** →
  `dao/classes.rpc.ts` + `useClassDrawer`.
- **`loadShadows`' "ENDED ASSIGNMENTS ARE SHOWN, NOT HIDDEN"** and the "failed load must NOT render
  as nobody shadows this class" branch. → `useClassDrawer`.
- **The shadow-rate warning block** ("Met HERE rather than at payroll… refuses for the WHOLE
  business") and `Coach.shadowRateFrom`'s "A DATE, NOT A BOOLEAN". → `useClassDrawer` + `RosterDrawer` + `types.ts`.
- **`handleSubmit`' "set_class_terms, never a bare UPDATE… effective-dated"** and the "Category is
  SCOPE, not money" plain-UPDATE block. → `dao/classes.rpc.ts` + `useClassForm`.
- **RISK 1/1b** (location free-text: send name+address through the expand window; write only the FK). → `useClassForm`.
- **`handleRestore`' "No confirm, no refusal… emergency exit from a class blocking a billing month"**. → `useRetire`.
- **The table's "NOT offered on a retired class" extra-lesson block (§7.32)** and the drawer's
  **"DELIBERATELY NO WRITE CONTROLS… Do NOT add Assign/Enrol/Remove"** prohibition. → `ClassTable` + `RosterDrawer`.
- **`moneyChanged`'s "renamed the class (records nothing) vs changed the money"** intent split. → `useClassForm` + `ClassFormModal`.

**Feature-scoped `Field`:** the local `Field` component moves to `ui/Field.tsx`, NOT to
`@/components` (playbook §5 — a byte-identical dup across feature folders is allowed; a *third*
copy is the trigger to consolidate, filed in `BACKLOG.md`, not pre-empted). `capitalize` (pure,
used by table/extra-modal/drawer/form) goes to `domain/classRows.ts`, not `constants.ts`.

### 5a. Structural pins — the comments above are vigilance; these make the failures impossible

> **⚠ RISK 2 MITIGATION (§7.28 — `c.is_active`, NOT `e.is_active`).** The row map moves to
> `domain/classRows.ts` at Stage 4. The two reads are one character apart on adjacent lines and
> both typecheck. **Characterisation test in `domain/classRows.test.ts`, written in the SAME
> commit as the move** (playbook §0: header says "characterisation — pins existing behaviour"):
> - raw row `{ is_active: true, student_class_enrolments: [{ is_active: false }] }` →
>   `is_active === true` **and** `student_count === 0` (the class is active with a closed enrolment).
> - raw row `{ is_active: false, student_class_enrolments: [{ is_active: true }] }` →
>   `is_active === false` **and** `student_count === 1` (retired class, live enrolment — the
>   deactivation driver's fixture shape).
> - raw row with `is_active` **absent** → `is_active === true` (the `!== false` default is the
>   pre-`deactivate_class()` legacy shape; `Boolean(c.is_active)` would retire every legacy row).
> - `student_class_enrolments` absent → `student_count === 0`, no throw.
> The UI-level twin is `verify-class-deactivation` check 3 ("a known-ACTIVE class carries NO
> 'Retired' badge") — run it at Stage 4 too. The unit test is what makes a later "tidy" of the
> mapping go red in seconds rather than in a nightly.

> **⚠ RISK 3 MITIGATION (retired classes LOADED; roster FETCHED SEPARATELY — §7.52).** Nothing
> today pins the SHAPE of the `classes` query; a `.eq("is_active", true)` in the dao is a
> one-line "tidy" that typechecks, passes vitest, and strands a month-blocking class with no screen
> able to restore it. **Add a source-pin test at Stage 2** (`domain/classesQueryShape.test.ts`,
> the `tierBoundaries`/`sgDisplay` source-scan idiom — read `dao/classes.repo.ts` as text):
> - the `.from("classes")` builder contains **no** `is_active` filter: `/\.(eq|is|neq|filter)\(\s*["']is_active/`
>   has **0** matches between `.from("classes")` and `.limit(` — assert the match count, not a
>   sentence.
> - its `.select(` string is **byte-identical** to today's (pin the literal; it must keep
>   `is_active, deactivated_at` and `student_class_enrolments(id, is_active)`, and must NOT gain
>   `trial_bookings(` or `students(` — that is the §7.52 embed that would blank every class).
> - `student_class_enrolments` and `trial_bookings` are each opened by their **own**
>   `.from(` call (count = 1 each) — the roster never rides on the class query.
> Prove it red once (add `.eq("is_active", true)` locally, watch it fail, revert) — this is a
> new rule, so §7.25 applies in full, same as Stage 0b. The UI-level twin: `class-deactivation`
> "ticking 'Show retired' reveals it" + "after a RELOAD it is still hidden".
> **Do NOT** put the `showRetired` filter anywhere but the pure `filterClasses(...)` in `classRows.ts`.
> **Graduate to `docs/GOTCHAS.md` §7** at close: "a load-bearing *absence* of a filter needs a
> source pin, because no test can observe what a query didn't do" — third instance after §7.18's
> `NO is_active FILTER` on invoices coverage and this page.

> **⚠ RISK 1 MITIGATION (`set_class_terms` args through an UNTYPED client).**
> `lib/supabase.ts` is `createClient(` with no `Database` generic, so `supabase.rpc("set_class_terms", {…})`
> takes `any`: a dao wrapper that drops, renames or **defaults** `p_effective_from` /
> `p_correct_in_place` / `p_location_name` / `p_location_address` typechecks clean and either
> rewrites every historical rate period (mis-bills every past lesson of the class; mis-pays the
> coach) or writes a location name that disagrees with the FK (RISK 1/1b). The one driver that
> would catch it (`verify-class-terms`: a 2020 lesson still prices at 25.00, today at 55.00, a
> correction moves it to 60.00 and rewrites only its own period) is scheduled for Stage 10 — seven
> stages after the RPC moves.
> - **Step (Stage 3):** `dao/classes.rpc.ts` exports `setClassTerms(args: SetClassTermsArgs)` where
>   the type lists **all 11 `p_*` keys as REQUIRED** (`p_effective_from: string | null`,
>   `p_correct_in_place: boolean`, `p_location_address: string | null` — nullable, never optional).
>   The wrapper body is `supabase.rpc("set_class_terms", args)` — it passes the object through and
>   **computes nothing**.
> - **Assertion (Stage 3):** `grep -c "p_" dao/classes.rpc.ts` covers every key the page sends today:
>   set_class_terms **11**, assign_class_shadow **3**, end_class_shadow **3** (incl. `p_effective_to: null`
>   — an END dated null means "today" server-side; dropping the key is a different call),
>   schedule_extra_lesson **3**, cancel_lesson **3**, deactivate/reactivate **1** each. 25 `p_` keys total.
> - **Step (Stage 3, not Stage 10):** run **`verify-class-terms`** at the end of Stage 3 — the money
>   round trip is the only net for this move, and it is cheap. Run it again at Stage 10 and 11.
> - **Do NOT** give any `p_*` a default in the wrapper. **Do NOT** move the `correctInPlace ? null : todayInSg()`
>   ternary into `dao/` — it is hook logic (RISK 6) and the dao must not read a clock.
> - **Sequence pin (Stage 10):** `handleSubmit` keeps the order **validate → rpc-or-insert → plain
>   UPDATE (category/capacity/colour) → close → `list.load()`**, and the "Saved, but the category,
>   capacity and colour were not:" string survives verbatim (`grep -c` = 1 in `useClassForm.ts`).
>   The plain UPDATE is ONE statement for three fields — do NOT split it (a third partial-save state).

> **⚠ RISK 4 MITIGATION (shadow END-never-DELETE, the rate warning, the failed-load branch).**
> `verify-coach-roster` drives shadow **assign** in the drawer (select → "Shadowing from" → Add →
> "ongoing" → DB row) — so Stage 6 HAS a driver, contrary to the first draft of §7. What no driver
> exercises: **End** (the money-critical half), the **rate warning** (the fixture gives the shadow a
> rate, so the branch never fires), and the **failed-load** branch. 0 shadows on prod, so a silent
> break waits for the first real assignment.
> - **Assertion (Stage 3 and every later stage):** `grep -rn "class_shadow_coaches" app/\(admin\)/classes/`
>   shows exactly **one** `.from(` (the read in `dao/classes.repo.ts`) and **zero** `.delete(` /
>   `.update(` on that table anywhere under `classes/`. `end_class_shadow` is the only write path.
> - **Step (Stage 6, Fowler extract — allowed, pure):** lift the warning IIFE's predicate into
>   `domain/classRows.ts` as `shadowRateWarning(shadowRateFrom: string | null, startsOn: string): "none" | "late" | null`
>   (caller passes `shadowFrom || todayInSg()` — the clock stays in the hook/ui, RISK 6) and pin it
>   with three characterisation cases: `null` → `"none"`; `"2026-10-01"` vs `"2026-09-17"` → `"late"`;
>   `"2026-09-01"` vs `"2026-09-17"` → `null`; **plus** the boundary `"2026-09-17"` vs `"2026-09-17"`
>   → `null` (`<=`, lexical on `YYYY-MM-DD` — the "A DATE, NOT A BOOLEAN" note travels onto the function).
>   The JSX keeps its two sentences verbatim, switching on the result.
> - **Step (Stage 6 hand-check, screenshot named in the commit):** (a) End an ongoing shadow →
>   row reads "ended", and `SELECT count(*) FROM class_shadow_coaches WHERE class_id = …` is
>   **unchanged** before/after with `effective_to` now set; (b) pick a coach with no shadow rate →
>   the amber "no shadow rate yet" sentence appears; (c) break the read once (rename the table in
>   the dao locally) → the drawer shows the error, NOT an empty "Add a shadow…" list; revert.
> - **BACKLOG:** `verify-class-admin` must include End + the warning (§7 below). Until then the
>   hand-check is the net — say so in the Stage 6 commit message.

> **⚠ RISK 8 MITIGATION (`RosterDrawer` — the "NO WRITE CONTROLS" prohibition must survive the
> move).** The drawer's only handlers are `onClose`, `onAssignShadow`, `onEndShadow`, `setShadowPick`,
> `setShadowFrom`. Assertion (Stage 6 and 11): `ui/RosterDrawer.tsx` contains the string
> `DELIBERATELY NO WRITE CONTROLS` exactly once, imports nothing from `dao/` (fence check 1), and
> `grep -cE "Enrol|Remove|Assign to" ui/RosterDrawer.tsx` = **0** (the shadow "Add" button is the
> one permitted write and it is a payroll fact, not an enrolment). **Do NOT** pass `list.load` or
> any enrolment setter into the drawer's props — it has no reason to reload the class list.

---

## 6. Stage log (fill as each lands — commit SHA + gate result + drivers run)

_Full-track giant: twelve stages, one at a time, gate green at each. No L1–L3 folding._

| Stage | What | Commit | Gate | Drivers |
|---|---|---|---|---|
| 0+0b | This plan + widen `tierBoundaries.drift.test.ts` to `classes`; pin ledgers by file+snippet; prove all 4 checks RED then revert; tighten `imports()` `\n<>` for the "Shadowing from" false positive | `9d10e3b` | typecheck + 715 vitest, fence 6/6 | — |
| 1 | `constants.ts` (DAYS, ROW_LIMIT) + `types.ts` (ClassRow, LocationOpt, Coach, ShadowAssignment), verbatim comments (1,714 → 1,646) | `146bfc9` | typecheck + 715 vitest | — |
| 2+3 | `dao/classes.{repo,rpc}.ts` — folded; **page holds no client**; RISK 1 typed wrappers (12 keys), RISK 3 `classesQueryShape.test.ts` (proven red), RISK 4/6 grep gates (1,646 → 1,566) | `6936944` | typecheck + 720 vitest, fence 6/6 | — (drivers deferred) |
| 4 | List: `domain/classRows.ts` (+10 tests, RISK 2 proven red) → `useClassList` → `ui/ClassToolbar` + `ui/ClassTable` (1,566 → 1,318) | `54a927c` | typecheck + 730 vitest, fence 6/6 | deferred |
| 5 | Roster: `useRoster` + `classRoster` git-mv into domain (14 cases, total unchanged) (1,318 → 1,239) | `749bfe0` | typecheck + 730 vitest, fence 6/6 | deferred |
| 6 | Drawer+shadows: `useClassDrawer` + `ui/RosterDrawer`; RISK 4 `shadowRateWarning` (+4 cases), RISK 7 effect-deps, RISK 8 prohibition (1,239 → 969) | `93fdc8b` | typecheck + 734 vitest, fence 6/6 | deferred; End/warning/failed-load HAND-CHECK deferred |
| 7 | Extra lesson: `useExtraLesson` + `ui/ExtraLessonModal` + `ui/Field` (pulled forward) (969 → 854) | `9fb2c89` | typecheck + 734 vitest, fence 6/6 | deferred |
| 8 | Cancel lesson: `useCancelLesson` + `ui/CancelLessonModal` (4 testids intact) (854 → 787) | `5f8b52d` | typecheck + 734 vitest, fence 6/6 | deferred |
| 9 | Retire/restore: `useRetire` + `ui/RetireModal` (RISK 9 guards intact) (787 → 704) | `220ced0` | typecheck + 734 vitest, fence 6/6 | deferred |
| 10+11 | Form: `useClassForm` + `locationOptions` git-mv (7 cases) + `ui/ClassFormModal` + `ui/NewClassButton`; **page → composition, 164 lines, 0 useState, BOTH ledgers EMPTY** | `9cfe144` | admin typecheck + 734 vitest + fence 6/6; coach app typecheck + 429 jest | full net — DEFERRED (below) |

**DONE (code): `page.tsx` 1,714 → 164 lines, ZERO useState, both boundary ledgers empty for
classes.** Driver strategy: the user chose **defer all driver runs to the end** (one Chrome
session), so every stage above gated on typecheck + vitest + the fence + the source-pins only.
The full net + the RISK-4 hand-checks still owe a run before this lands on `main`.

**Per-stage mitigations (each is a gate for THAT stage's commit; the risk numbers are §5a's):**

| Stage | ⚠ Gate added by plan-review |
|---|---|
| 0b | The `useState` count is the meter: **51 before, 0 after Stage 11**; re-count (`grep -c "useState("` minus the import line) in every commit message. Both ledgers can only shrink. |
| 2 | **RISK 3:** write + prove-red the query-shape pin (`domain/classesQueryShape.test.ts`) in the same commit as `dao/classes.repo.ts`. **RISK 6:** trial-bookings dao read takes `today` as a parameter; `grep todayInSg dao/` = 0. |
| 3 | **RISK 1:** `SetClassTermsArgs` with 11 REQUIRED keys, 25 `p_` keys total in `classes.rpc.ts`, no defaults, no clock. **Run `verify-class-terms` here** (not first at Stage 10). **RISK 4:** `.delete(`/`.update(` on `class_shadow_coaches` under `classes/` = 0. |
| 4 | **RISK 2:** `classRows.test.ts` with the four §7.28 cases lands in the same commit as the map. **RISK 9:** `ClassTable` renders "Extra lesson" / "Cancel a lesson" / "Retire" only under `cls.is_active` and "Restore" only under `!cls.is_active` — hand-check a retired row shows exactly `See students · Edit · Restore` (§7.32); the top-level `retireError && retireFor === null` banner moves to `ClassToolbar` with the guard verbatim. Run `class-deactivation` (its check 3 is the §7.28 UI twin) + `class-edit`. |
| 5 | **RISK 10:** `git mv` both files, 14 + 7 cases listed under `classes/domain`, `lib/classRoster.ts` gone. **RISK 6:** `rosterByClass` memo reads `todayInSg()` inside `useRoster`, passes it in; `classRoster.ts` still imports nothing. Run `class-students` ("2+1" and the five NOT-badge cases are the two-way exclusion net). |
| 6 | **RISK 7:** effect deps + eslint-disable byte-identical; clear-on-close branch intact. **RISK 4:** `shadowRateWarning` extracted + 4 cases; hand-check End / warning / failed-load with screenshots; **run `verify-coach-roster`** (drives assign in this drawer — it IS this stage's driver). **RISK 8:** drawer prohibition greps. |
| 7 | **Run `verify-attendance-guard`** — it drives this exact modal ("Extra lesson — <class>" → date → reason → "Scheduled for", reason stored on `lesson_sessions`). Not dormant; the first draft of §7 missed it. |
| 8 | `cancel-lesson` reads the modal by `data-testid` (`cancel-lesson-entry`, `cancel-error`, `cancel-done`, `confirm-cancel-lesson`) — all four testids survive the move verbatim (`grep -c data-testid ui/CancelLessonModal.tsx` + `ClassTable.tsx` = 4). |
| 9 | **RISK 9:** `handleRestore` keeps the `if (restoringId) return;` guard and the named "Could not restore <title>:" message; `handleRetire` keeps reload-not-patch. Run `class-deactivation` (the full round trip incl. two refusals that "wrote nothing"). |
| 10 | **RISK 1:** submit sequence pin + "Saved, but…" string. `locations` load keeps archived rows (no `archived_at` filter — the page's own "RISK 6" note on the `locations` state, not this review's RISK 6: a reactivated class on an archived location must still be editable; add an `archived_at` filter-absence match to the RISK 3 query-shape pin for `.from("locations")`); `formLocationOptions` test moves with it. Run `class-terms` + `locations`. |
| 11 | Everything in the PRE-COMMIT GATE (§14). Full net, incl. `attendance-guard` and `coach-roster`. |

---

## 7. Driver net (playbook §4 — verified by grep + a `goto` check, names are not evidence)

Confirmed by `goto(...classes...)` in the driver body. Run the relevant one at the end of its
slice, all again after Stage 11.

| Driver | Covers | Port-hardcoded? |
|---|---|---|
| `verify-class-deactivation` | retire + restore, month-block visibility | no (`${ADMIN}`) |
| `verify-class-edit` | create/edit modal | **yes (localhost:3000)** — port-sub copy if run vs a worktree (playbook §4) |
| `verify-class-terms` | set_class_terms, correct-in-place radio | **yes (localhost:3000)** — port-sub copy for a worktree |
| `verify-class-students` | drawer roster, badge count | no |
| `verify-cancel-lesson` | advance-cancel modal | no |
| `verify-locations` | location filter + form picker | no |
| **`verify-coach-roster`** | **shadow ASSIGN in the drawer** — "See students" → `Add a shadow…` select excludes the class's own coach → fill `Shadowing from` → Add → "ongoing" → `class_shadow_coaches` row (checks 6/6b/6c/7) | no |
| **`verify-attendance-guard`** | **the Extra-lesson modal end to end** — row-scoped "Extra lesson" → date → `placeholder*="Makeup"` reason → "Schedule lesson" → "Scheduled for" → `off_schedule_reason` stored | no |
| `verify-platform-admin-scope` | cross-tenant classes visibility | no |
| `verify-tenant-admin` | admin smoke incl. classes | no |
| ~~`verify-trial-onboarding`~~ | **FALSE CREDIT — removed at plan-review.** Its only `classes` route is `${EXPO}/(coach)/classes/<id>/attendance` (coach app). It never opens admin `/classes` — the exact playbook §4 trap (`verify-student-identity` on the pilot) | — |
| `verify-smoke-admin` | route loads, h1 present, no console error | no |

> **⚠ RISK 5 MITIGATION (the net was mis-mapped).** Re-derived at plan-review with
> `grep -nE 'ADMIN\}/classes' verify-*.mjs`: two drivers that DO open the admin page were missing
> (`coach-roster`, `attendance-guard`) and one credited driver never opens it (`trial-onboarding`).
> The consequences were concrete: Stage 6 and Stage 7 would each have shipped without the driver
> that actually exercises them, and a break would have surfaced only in the nightly.
> - **Step:** the stage table above now names `coach-roster` at Stage 6 and `attendance-guard` at
>   Stage 7; both run again at Stage 11.
> - **Assertion (Stage 11):** the full-net list in the commit message has **11** drivers — the
>   11 unstruck rows above, which is exactly the set
>   `grep -lE 'ADMIN[_A-Z]*\}?/classes|localhost:3000/classes|"/classes"' verify-*.mjs` returns
>   once `smoke-app` and `stale-screen` (coach-app `/classes` routes) are dropped. Re-run that
>   grep at Stage 11; the number is the meter, this table is the hint.
> - **Do NOT** re-add `trial-onboarding` to this table without a `${ADMIN}/classes` grep hit.

We build/run on the local stack (not a worktree), so `localhost:3000` is correct as-is for
`class-edit` / `class-terms`; the port-sub copy is only needed if a sibling worktree owns :3000.

**Uncovered actions to hand-check (screenshot, name in commit, file a BACKLOG driver):**
shadow-coach **End** (assign IS covered — `coach-roster`), the **shadow-rate warning** (never fires
in `fixtures-coach-roster.sql` because the fixture deliberately gives the shadow a rate), and the
**failed-shadow-load** branch. All dormant on prod (§3 of HANDOVER — 0 shadows). Extra lesson is
NOT uncovered — `attendance-guard` drives it. `smoke-admin` loads the page; a `verify-class-admin`
driver (mirror of the `verify-invoice-admin`/`verify-packages-admin` BACKLOG items) covering End +
the warning would close the gap. File in `BACKLOG.md`.

---

## 13. Findings for `/update-docs` (fill at close)

- Two clean `git mv`s into `domain/` (`classRoster`, `locationOptions`) — both sole-imported by
  this page within admin, both with `.test.ts`, both with zero relative/`@/lib` imports, so both
  move without repointing. `classRoster` carries its `Roster*` types.
- No cross-slice write-back cycle here (contrast invoices §8.106) — dependency graph is a DAG,
  which is the common case; the invoices call-time-setter pattern is the exception, not the rule.
- `coaches` and `drawerClass` are shared spines (load once, pass down) — the packages/invoices
  "shared-spine id" pattern, third instance.
- **Still-due once-off:** the dao three-way-split + "orchestrate, never replace" rule graduates to
  `docs/ARCHITECTURE.md` §6 (trigger met since packages; now FOUR full giants exercise it).
- **Graduate to `docs/GOTCHAS.md` §7 (from plan-review, durable beyond this page):**
  (1) *a load-bearing ABSENCE of a filter needs a source pin* — no behaviour test can observe what
  a query didn't do; the `classesQueryShape` pin is the pattern (RISK 3, third instance after
  §7.18). (2) *the admin client is untyped, so `rpc()` arg objects are `any`* — every dao rpc
  wrapper takes a required-keys type and the driver that checks money runs at the RPC-move stage,
  not the UI stage (RISK 1). (3) *the driver net must be re-derived by grep at plan-review too,
  not only at Stage 0* — the first draft of this plan got three rows wrong (RISK 5).

---

## 14. PRE-COMMIT GATE — walk before EVERY stage commit; the starred ones before Stage 11

Highest value first. Each line is a pass/fail, not a reminder.

- [ ] ★ **RISK 1** `verify-class-terms` green (2020 lesson 25.00 · today 55.00 · correction 60.00,
      own period only) — at Stage 3, 10 and 11. `classes.rpc.ts`: 25 `p_` keys, 11 required on
      `SetClassTermsArgs`, zero defaults, zero `todayInSg`.
- [ ] ★ **RISK 3** `classesQueryShape.test.ts` green AND was proven red once; the `classes`
      `.select(` literal byte-identical; `is_active` filter matches = 0; roster tables opened by
      their own `.from(` (1 each).
- [ ] ★ **RISK 2** `classRows.test.ts` four §7.28 cases green; `verify-class-deactivation` check 3
      ("known-ACTIVE class carries NO Retired badge") green.
- [ ] ★ **RISK 4** `class_shadow_coaches` under `classes/`: 1 `.from(`, 0 `.delete(`, 0 `.update(`;
      `shadowRateWarning` 4 cases green; End / warning / failed-load hand-checked with screenshots
      (Stage 6 and 11); DB row count unchanged across an End.
- [ ] ★ **RISK 5** every driver in the commit message `goto`s `${ADMIN}/classes` by grep;
      `coach-roster` ran at Stage 6, `attendance-guard` at Stage 7, both again at 11.
- [ ] **RISK 6** `grep -rn "todayInSg\|new Date(" classes/dao classes/domain/classRoster.ts` = 0;
      `new Date(` under `classes/` = 1 and it is the comment.
- [ ] **RISK 7** drawer effect deps `[drawerClass?.id, coaches.length]` + eslint-disable verbatim;
      clear-on-close branch present.
- [ ] **RISK 8** `ui/RosterDrawer.tsx`: "DELIBERATELY NO WRITE CONTROLS" ×1, `Enrol|Remove|Assign to` ×0,
      no `dao/` import, no `list.load` prop.
- [ ] **RISK 9** retired row shows exactly `See students · Edit · Restore`; `retireFor === null`
      banner guard verbatim; `if (restoringId) return;` present; "Could not restore" named message.
- [ ] **RISK 10** `lib/classRoster.ts` and `lib/locationOptions.ts` gone; 14 + 7 cases listed under
      `classes/domain`; total vitest count unchanged by each move.
- [ ] **Meter** `useState` count in the commit message (51 → … → 0); both ledgers only ever shrank;
      `npm run typecheck && npm test` green in BOTH apps at least once (two `lib/` modules moved).
- [ ] **Nothing tidied.** Every `ui/` file is the JSX block with `x` → `p.x`; every string a driver
      reads by text or testid survives verbatim (`grep -c data-testid` = 4 across cancel surfaces).
</content>
</invoke>
