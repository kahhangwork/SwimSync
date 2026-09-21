# Coach roster screen — full-track refactor plan

_`SwimSyncApp/app/(coach)/classes/[id]/roster.tsx`. Written 2026-09-21 via `/plan-with-confidence` (3
questions: roster first; `@/store` in `domain/` only; root checkout, branch `refactor/coach-roster`), then
`/plan-review` (Fable 5.1). **The first coach-app unit — so it also builds the app half of the fence.**
Method: `FEATURE_TIER_REFACTOR_PLAYBOOK.md`. Worked example for a full track: `LESSON_DETAIL_REFACTOR_PLAN.md`._

**Rule 0: zero behaviour change.** Every stage is a move. A stage that needs a behaviour change stops,
and the change becomes a `BACKLOG.md` item.

**GATE before `main` (§7.1):** nightly `35587264596` (Admin L-E, on `ed6c6e5`) must be green. Build on
the branch now, but merge only after that run is green, and after this unit's own drivers (§8) pass.

---

## 1. The measure (`wc -l` / grep, 2026-09-21 — re-measure before each stage)

| | |
|---|---|
| Lines | **905** |
| `useState` | **11** (`grep -c 'useState[<(]'`, since 12 counted the import line). Plus one `React.useMemo` (:133), one `useCallback` load (:147), one `useFocusEffect` (:490) |
| `.from(` | **6**: `classes`, `lesson_sessions` ×2, `trial_bookings`, `makeup_bookings`, `students` |
| `.rpc(` | 0 direct. **2 indirect**, through `lib/` helpers: `fetchMarkableFloor()` (`markable_window_start`, imports the client itself) and `removeFromClass(supabase, …)` |
| `fetch(` | 0 |
| `@/lib/*` imports | **8** (7 helpers + the client): `supabase`, `lessonDates`, `scheduleWeek`, `markableFloor`, `attendanceCompleteness`, `attendanceSummary`, `confirm`, `studentStatus` |
| Other | `@/store/useAppStore` (`showToast`), `@/components/{Card,PrimaryButton}`, `expo-router`, `@expo/vector-icons`, `react-native` |

## 2. The target shape

```
SwimSyncApp/features/roster/            # OUTSIDE app/ — Expo Router routes every file under app/
  types.ts                              # Student, Session, ClassInfo, Guest, Extra
  dao/roster.repo.ts                    # the 6 .from() — raw { data, error }, no mapping
  dao/roster.rpc.ts                     # binds fetchMarkableFloor + removeFromClass(supabase, …)
  domain/rosterFormat.ts                # formatTime / formatDate / capitalize (pure)
  domain/rosterRows.ts (+ .test.ts)     # the pure half of loadData — see §7
  domain/useRosterData.ts               # the spine: 9 useState + loadData + todayDate + duplicateNames
  domain/useRemoveStudent.ts            # removingId + handleRemove (reads showToast from the store)
  domain/useOpenLevel.ts                # openLevelFor — the one pure-UI state
  ui/RosterHeader.tsx  ui/MarkTargetPanel.tsx  ui/UpcomingGuests.tsx
  ui/StudentList.tsx   ui/PastSessions.tsx
app/(coach)/classes/[id]/roster.tsx     # composition: ~100 lines, 0 useState
```

**Import rules for the app (settled at /plan-with-confidence):**
- **`@/store/*` in `domain/` only.** The page and `ui/` never import the store. The page imports its tiers
  (`@/features/roster/{ui,domain}/…`, `…/types`), React, `react-native`, `expo-router`,
  `@expo/vector-icons` and `@/components/*`. It never imports `@/lib/*`, `@/store/*` or `…/dao`.
- **`ui/` may import the `router` singleton from `expo-router`** so that navigation JSX moves verbatim.
  There's precedent outside `app/`: `components/ChangePasswordScreen.tsx:12`. The admin's "router at the
  page" rule (ARCHITECTURE §6) exists for a hook that needs Next's navigation context. `expo-router`'s
  `router` has no context, so that reason doesn't apply here.
- `useFocusEffect` stays on the page. **The hook returns `loadData` AND `todayDate`**: `todayDate` is
  used by the JSX (`markTarget.date === todayDate`, :562) and is also a `loadData` dependency.

## 3. The slices, by state cluster

| Slice | State | Moves to |
|---|---|---|
| **Spine** | `classInfo` `students` `upcomingTrials` `upcomingMakeups` `upcomingExtras` `sessions` `markTarget` `windowStart` `loading` (9) + `duplicateNames` memo + `todayDate` | `useRosterData(id)` + pure `rosterRows.ts` |
| **Remove** | `removingId` + `handleRemove` | `useRemoveStudent(id, loadData)` |
| **Level toggle** | `openLevelFor` | `useOpenLevel()` |

9 + 1 + 1 = **11**, which is the §1 count. Assert 0 `useState` on the route after Stage 5.

## 4. `lib/` verdicts — all STAY (sole-importer grep over `@/lib/<m>` AND `./<m>`, excl. tests — verified at review)

| Module | Code importers | Verdict |
|---|---|---|
| `lessonDates` | 14 | STAY. The `sgDisplay` twin rule pins it byte-identical to the admin copy |
| `scheduleWeek` | 4 | STAY |
| `markableFloor` | 3 | STAY. Bound in `dao/roster.rpc.ts` (it imports the client itself: a network reach) |
| `attendanceCompleteness` | 3 | STAY |
| `attendanceSummary` | 2 | STAY |
| `confirm` | 8 | STAY |
| `studentStatus` | **1** (this screen) | **STAY anyway**. `diff` against `SwimSyncAdmin/lib/studentStatus.ts` shows they are identical, and the header says "EDIT BOTH". Being the sole importer is necessary for a move, not sufficient. Bound in `dao/roster.rpc.ts` |

No module moves, so §7.250 (moving a pair) and the path-grep repoint don't apply. Nothing imports from
`roster.tsx`, and no source-scan test pins a snippet of it (verified at review).

## 5. The risks, ranked by blast radius (most → least)

_Each one is mitigated **inline at its stage in §6**. This list is the why; §6 is the what._

1. **The spine's mapping IS the billing gate's union** (Stage 2). If the backlog is wrong, it disagrees
   with `generate-invoices`: a blocked month, or an underbill (§7.18).
2. **`useFocusEffect` + an unstable `loadData` = a refetch loop / permanent spinner** (Stage 3). No
   jest test sees it.
3. **The net was under-derived**: the only drivers on the `target` rule (`verify-trials`) and the
   duplicate-name / age path (`verify-student-identity`) weren't listed (Stage 2/3/5).
4. **The spine's timing and clocks**: the floor overlap, the second `todayInSg()`'s read position, the
   `!cls` early return, swallowed errors, and `id` possibly `undefined` (Stage 3).
5. **The app fence can be silently weaker than the admin one**: check 3 can't see `fetchMarkableFloor`,
   and check 4 crashes (instead of failing) on an out-of-scope route file (Stage 0b).
6. **Four silent-infra lines**: `testMatch`, `SCAN_DIRS` ×2, Tailwind `content`. Each stays green while
   checking less, and NativeWind drops classes on native AND web (Stage 0b).
7. **Markup renames**: the JSX-text trap, and a driver that reads the `Remove` label (Stage 5).
8. **Remove has no driver** (Stage 4).

## 6. Stage-by-stage, one commit each

**Gate every stage:** `cd SwimSyncApp && npm run typecheck && npm test`. Green, or `git checkout -- .`.
**Scripted cuts** that assert each old string occurs exactly once (the scripts stay in the scratchpad).
Record the jest count before Stage 0b. After that it only grows, and a drop means a test was lost.

| Stage | What | Ledger after (check 3 / check 4) |
|---|---|---|
| **0b** | App fence twin + the four infra lines, then prove red | **9 / 9** |
| **1** | `types.ts` + `domain/rosterFormat.ts` (verbatim) + a characterisation test | 9 / 9 |
| **2** | `domain/rosterRows.ts`, the pure half of `loadData` (§7) **+ characterisation tests**. The route calls the pure functions, and the fetches stay put | 9 / 9 |
| **3** | `dao/roster.repo.ts` + `dao/roster.rpc.ts` (floor) + `domain/useRosterData.ts`, **one commit**, so the route never imports `dao/` | 2 / *n* (`removeFromClass` line + client import) |
| **4** | `removeFromClass` binding + `useRemoveStudent` + `useOpenLevel`. **Hand-check Remove** | **0** / *n* |
| **5** | `ui/` ×5, markup verbatim; the route is reduced to composition | **0 / 0** |
| **L4** | The full §8 net + smoke + hand-checks; §11a log; §12 findings | — |

### ⚠ Stage 0b — RISK 5, 6 MITIGATIONS
- **STEP:** write `SwimSyncApp/lib/tierBoundaries.drift.test.ts` as a jest twin (the `sgDisplay` pair is
  the template), with the same 4 checks + the shrink test + "scans every scoped page". **Don't copy the
  admin regexes blind. Rewrite these three:**
  - **Check 3** flags `\bsupabase\b` / `\bfetch\s*\(` **AND any import of `@/lib/supabase` or
    `@/lib/markableFloor` outside `dao/`.** A plain twin can't see `fetchMarkableFloor()`, which imports
    the client inside `lib/`. Pin roster.tsx:23 so that check 3 = **9** (lines 13, 151, 215, 233, 295,
    301, 328, 511 + :23).
  - **Check 4** `ok =` `/^(react$|react-native$|expo-router$|@expo\/vector-icons$|@\/components\/|@\/features\/roster\/(ui|domain)\/|@\/features\/roster\/types$)/`.
    `@/store` is forbidden by omission. **Ledger = exactly 9** (8 `@/lib` + `@/store`).
  - **Check 2** (dao) also forbids `react-native` and `expo-router`. The admin `^react(-dom)?` doesn't
    match `react-native`.
- **STEP:** the route file lives OUTSIDE `SCOPE_DIRS`, so register it in a `SCOPE_FILES`/`PAGES` list that
  `sources()` reads (admin precedent: `AssessmentGrid.tsx`). **ASSERTION:** with the route path
  deliberately typo'd, the "scans every scoped page" test goes **red**, not TypeError (admin :704 does
  `srcs.find(…)!`, which throws).
- **STEP, the four infra lines, same commit:** `jest.config.js` `testMatch` += `**/features/**/*.test.ts`,
  `…tsx`; `SCAN_DIRS` += `"SwimSyncApp/features"` in **both** `sgDisplay.drift.test.ts` twins;
  `tailwind.config.js` `content` += `"./features/**/*.{js,jsx,ts,tsx}"`.
- **PROVE RED, then revert.** Each of these must go red: `features/roster/ui/Break.tsx` → `../dao/x`
  (check 1); `dao/break.ts` → `react` and → `react-native` (check 2); `domain/break.ts` → `fetch(` and
  → `import … "@/lib/markableFloor"` (check 3); an unpinned `@/lib/utils` and `@/store/x` on the route
  (check 4); `features/roster/domain/break.ts` with `new Date().toLocaleDateString()` (**sgDisplay:
  both twins red**, since `walk()` skips a missing dir with `existsSync` and the add is otherwise
  unproven); a `features/roster/domain/zz.test.ts` with `expect(1).toBe(2)` (**testMatch red**).
  Delete them all, then confirm green. Write the proof into the fence file's header.
- **Tailwind is proven at Stage 5**, since no `features/ui` file exists yet. See there.

### ⚠ Stage 1
- Verbatim, comments included. `formatDate` wraps `formatSgDate`, so leave its options object untouched.

### ⚠ Stage 2 (pure mapping) — RISK 1, 3 MITIGATIONS
- **STEP, before writing any code:** run `verify-trials` and `verify-student-identity` on the unchanged
  branch and record their check counts. Those are the baseline.
- **`buildSessions` owns `rows` from the session map through the synthesis loop to the sort.**
  **PROHIBITION:** don't split it into `sessionRows()` + `synthesise()` returning separate arrays. `seen`
  is derived from the mapped rows (:441), the loop pushes into the same array (:467), and the sort comes
  after (:484).
- **Copy the loop body verbatim.** `continue` on empty (:457) → `target = { date }` (:464) → `seen` skip
  (:466) → push. **PROHIBITION:** no reordering, no "early `seen` skip for speed".
- **The pure functions take every date as an argument.** **PROHIBITION:** no `todayInSg()` inside
  `rosterRows.ts`.
- **ASSERTIONS (the characterisation tests; header says CHARACTERISATION, and that §7.25 does not apply).
  Each one is a named case:**
  1. `target` = the LAST expected date in ascending order **even when that date is already `seen`**
     (a recorded session inside the window).
  2. Exactly one row per date when a recorded date is also a weekday in range (no double push).
  3. A cancelled session row AND a cancelled synthesised date: enrolled spans are substituted by `[]`,
     and bookings still count.
  4. A date with nobody expected produces no row and doesn't become `target`.
  5. A guest-only date on a zero-enrolment class makes a row + `target` (the 20260810 case).
  6. A mid-month joiner is absent from the earlier lesson's denominator (§8.15).
  7. Spans come from ALL enrolments (a left child still counts on old dates), while students are
     `is_active` only.
  8. DOB/level are read off `e.students`, and skills are sorted by `sort_order` client-side.
  9. Output is sorted descending, and a session **below `winStart` is kept**.
  10. `duplicateNameKeys` trims and lowercases.
  11. `namedGuests` falls back to `"A trial student"` / `"A make-up student"` when a name is missing.
- **ASSERTION:** after the commit, `verify-trials` and `verify-student-identity` hit their baseline counts.

### ⚠ Stage 3 (spine hook + dao) — RISK 2, 4 MITIGATIONS
- **ASSERTION:** `loadData` is the `useCallback(…, [id, todayDate])` value, **returned unwrapped**.
  **PROHIBITION:** the hook never returns `() => loadData()`, and never drops or extends that deps array.
  **STEP:** add a temporary `console.log("[roster] load")` in the uncommitted copy, open the screen
  in Expo web, and confirm exactly **one** log per focus. Remove it before committing, and write the
  result in the stage log.
- **ASSERTION (script):** the `const markableFloorPromise = fetchMarkableFloor…` line sits AFTER
  `setStudents(activeStudents)` and BEFORE the sessions query; its `await` sits after the spans. The dao
  binding is `export const fetchFloor = () => fetchMarkableFloor()`, with nothing that could reject.
- **PROHIBITION:** `const today = todayInSg();` stays on the line **after** the bookings `Promise.all`
  (:310), not beside `todayDate`. The two clocks stay two (rule 0).
- **PROHIBITION:** no `if (!id) return`. `useRosterData(id)` takes the page's `id` type unchanged.
  Today, an undefined `id` runs one query and hits the `!cls` return, so a guard would skip
  `setLoading(true)`.
- **Keep:** the `!cls` early return (sets `loading` false, nothing else), every swallowed error (only
  `data` is read), and the identical `setX` order. **Delete** the dead `totalStudents` (:249) and name
  it in the commit.
- **dao returns the raw builder result.** **PROHIBITION:** no `.data` unwrap, no mapping, no error
  handling in `dao/`. Query text byte-identical, with its comments.
- **STEP:** run the full §8 net after this commit, since the spine feeds every panel.

### ⚠ Stage 4 (remove + toggle) — RISK 8 MITIGATION
- `showToast` is read **inside** `useRemoveStudent` from `@/store`. The page never imports the store.
- `confirmAction` stays (never `Alert.alert`, which does nothing on RN-web).
- **STEP (hand-check, DB-verified, screenshot):** as the seed coach, Remove a child → confirm →
  `SELECT is_active, unenrolled_at FROM student_class_enrolments WHERE …` shows it closed, the success
  toast is shown, the list shrinks by one, and the child's other class is untouched. Also check the
  level toggle's **Hide** branch (What → Hide → collapsed), which no driver covers. **STEP:** BACKLOG
  `verify-coach-remove-student`, written from `main` at close.

### ⚠ Stage 5 (ui) — RISK 6, 7 MITIGATIONS
- **Destructure the hook object on each component's first line.** The JSX stays byte-identical, with no
  prop-prefix rename. **STEP:** check each `ui/` file by script against `git show HEAD:<route>` line
  ranges, whitespace-stripped. Then run `grep -nE "[a-z] p\.[a-z]\.[a-z]+ [a-z]" features/roster/ui/*.tsx`,
  which must print nothing.
- The two IIFE blocks and the `index` keys move as-is.
- **ASSERTION:** `verify-student-identity`'s `Noah Lim … Remove` check and `verify-level-skills`'s
  `What Toddler 1 covers` check still pass (both read label text that moves into `StudentList`).
- **ASSERTION, Tailwind:** after `npx expo start --clear`, in the browser,
  `getComputedStyle` of the guests panel's `text-[11px]` footnote (a class found only in this file:
  `grep -rn 'text-\[11px\]' app components` must show roster.tsx alone before the move) reads `11px`,
  not the default. **PROHIBITION:** don't prove it with a class that also appears under `app/`, because
  that one survives regardless.
- **ASSERTION:** `grep -c 'useState' <route>` = 0. The route is ≤ ~150 lines. Both ledgers are 0.
  `npx tsc --noEmit --noUnusedLocals | grep 'features/roster\|classes/\[id\]/roster'` prints nothing.

## 7. The pure mapping — `domain/rosterRows.ts`

Pure, no clock reads, dates passed in (names final at Stage 2):
- `toClassInfo(cls)` · `toActiveStudents(cls)` · `toEnrolmentSpans(cls)` · `toUpcomingExtras(rows)`
- `upcomingBookings(rows, today)` (filter `>= today`, ascending) · `guestIdsOf(trials, makeups)` ·
  `namedGuests(rows, nameById, fallback)` · `bookedByDate(trialRows, makeupRows)`
- `buildSessions({ sessionData, spans, booked, dayOfWeek, winStart, todayDate })` → `{ rows, target }`.
  It owns the row array end to end (§6 Stage 2).
- `duplicateNameKeys(students)` (the memo body)

Cases: §6 Stage 2's 11 assertions.

## 8. The driver net — re-derived by grep (§7.236) over the screen's strings AND its entry tap

Grep strings: `Past Sessions`, `covers`, `coming up`, `Students (`, `/roster`, **`View Roster & Sessions`,
`Mark Attendance`, `Age `**. The first pass omitted the last three and missed three drivers.

| Driver | What it pins on this screen | Evidence |
|---|---|---|
| **`verify-trials`** | guest not listed as a student; Mark Attendance offered on a guest-only class; **the dated Mark button lands on the guest's lesson**, the only end-to-end check of the `target` rule | :143–196 |
| **`verify-student-identity`** | `Age 6`/`Age 8`/no `Age 7`; two-Ethan-Tans birthday disambiguation; the `Remove` label | :50–86 |
| `verify-levels` | the level label on the roster (hardcodes `:8081`) | :170–175 |
| `verify-level-skills` | `What Toddler 1 covers` collapsed → tap → skills shown (hardcodes `:8081`) | :104–115 |
| `verify-attendance-guard` | opens via `gotoAuthed …/roster` | :260, :329 |
| `verify-makeups` | make-ups panel | :140 |
| `verify-trial-visibility` | via "View Roster & Sessions" | :97 |
| `verify-smoke-app` | opens the screen | :180 |
| `verify-schedule-week` | **URL only** (`/roster\|/schedule`), no content, so it doesn't count as content coverage | :243 |

**NOT in the net (checked):** `verify-class-students` is admin-only (":28 No Expo server is needed";
its "Trials coming up" is the admin drawer). `verify-coach-roster` is a name-trap: it opens
`/attendance` (:517, :552), never `/roster`.

**Uncovered → hand-check:** Remove, and the level toggle's Hide branch (Stage 4).

**Run cadence:** Stage 2 → `verify-trials`, `verify-student-identity`. Stage 3 → the full net. Stage 5 →
the full net. L4 → the full net once more + smoke. `run-all-drivers.sh --only` takes ONE name, so loop it.
Nothing else is using the local database this session, so there's no one to warn before a run.

## 9. What this refactor does NOT change
No query text, no filter, no error handling, no copy, no class name, no navigation URL, no store shape, and
none of the 8 `lib/` modules.

## 10. Accepted consequences
- **No DISTINGUISHING bundle string exists** for a zero-behaviour-change refactor, so a served-bundle grep
  has nothing to look for (§7.31 is about *which* bundle is served; the app's bundle is greppable in
  general). CI plus the drivers are the deploy check.
- `git blame` on moved lines points at this branch.
- The `dao/` binding for `removeFromClass` moves the `supabase` argument inside `dao/`. That's a strictly
  equivalent call.
- The roster's source comment citing `schedule/index.tsx:328` is already stale (the call is at :337/:380).
  It travels verbatim and is noted for `/update-docs`, not fixed (rule 0).

## 11. The gate before `main`
1. Nightly `35587264596` green (`gh run view 35587264596`).
2. §8 net green on the finished screen at the baseline counts, plus both hand-checks.
3. `/commit-review` per stage, then `/deploy` (0 migrations, 0 edge functions → app-only, `main` IS the
   deploy).

## 11a. Stage log — what actually landed (2026-09-21, branch `refactor/coach-roster`)

| Stage | Commit | Ledger (3 / 4) | jest | Drivers / checks |
|---|---|---|---|---|
| 0b | `7aa91ee` | 9 / 9 | 429 → 436 | Proven red: all 4 checks + the helper leg (`@/lib/markableFloor`) + a typo'd route path (red, not TypeError) + a corrupted pin (shrink test) + `features/` testMatch + BOTH sgDisplay twins. Admin vitest 828 |
| 1 | `81b6f61` | 9 / 9 | → 441 | — (types + formatters only). `formatTime("")` renders `12:undefined AM` — pinned, not fixed |
| 2 | `166d99d` | 9 / 8 | → 462 | trials 16/16, student-identity 13/13 (= baseline). Line-set check: every logic line of `rosterRows.ts` exists in the pre-cut route |
| 3 | `40bfbd8` | 2 / 6 | 462 | Full net = baseline (below). ONE `[roster] load` per focus (temp log, removed). Dao query text line-identical by script |
| 4 | `14127f2` | **0** / 2 | 462 | Hand-check 12/12 (`coach-roster-handchecks.mjs`), DB-verified; level-skills 14/14 |
| 5 | (this commit) | **0 / 0** | 462 | 5 `ui/` bodies VERBATIM by script; `text-[11px]` computes 11px after `--clear` (control `text-sm` 14px); full net = baseline, all 9, same three smoke-app reds |

**Baseline net (pre-Stage 3):** trials 16/16 · student-identity 13/13 · levels 9/9 · level-skills 14/14 ·
attendance-guard 22/22 · makeups 15/15 · trial-visibility 11/11 · schedule-week 21/21 · smoke-app **70/73** — the
three `/invoice/<id>` + `/package/<id>` reds that BACKLOG's *"Four UI drivers fail on a LOCAL full sweep"* records
as failing identically on `main`; neither route is the roster. Stage 3 matched it exactly, same three reds.

**The route:** 905 → **64** lines, 11 → **0** `useState`, 8 `@/lib` + `@/store` → **0**.

**Nightly gate:** `35587264596` (Admin L-E, `ed6c6e5`) — **success, all 52 drivers passed** (read from the log, 52
PASS / 0 FAIL), 2026-09-21 11:32Z.

**One harness trap met (not a product bug):** the hand-check's first attempt force-clicked *What Toddler 1 covers*
on a deep-linked roster and landed on the **Schedule screen mounted underneath** (§7.10) — the setup's extra Sunday
class had put a Mark card at the same coordinates, and it opened that lesson's attendance. `verify-level-skills`
never meets it because it arrives by tab taps. DOM clicks (`el.click()`) fixed the script. The first run also
slept past the toast's 3000 ms life (`components/Toast.tsx`) — wait for the toast, don't sleep past it.

## 12. Findings for `/update-docs`
- **Playbook §1 table + ARCHITECTURE §6:** the app's `tailwind.config.js` `content` must gain
  `./features/**`. It's a fourth silent-infra line beside `testMatch` / `SCAN_DIRS`, and the admin never
  hit it because its tiers sit under `app/` (§7.191's shape).
- **Playbook §3:** the app fence is NOT a straight twin. Check 3 must see `lib/` helpers that import the
  client themselves (`markableFloor`). Check 4's allowlist is app-specific. An out-of-scope route file
  needs a `SCOPE_FILES`-style entry, or check 4 throws instead of failing.
- **Playbook §4:** grep an app screen's **entry tap** (`View Roster & Sessions`) and its primary button
  text, not only the strings it renders. The first derivation here missed 3 of 9 drivers.
- **Playbook §4 (`lib/` verdicts):** being the sole importer is necessary, not sufficient. A twin file
  (`studentStatus`) stays.
- **The stale `schedule/index.tsx:328` cross-reference** in roster's comment (§10) — it travelled verbatim into
  `domain/useRosterData.ts`.
- **§7 candidate (hand-check scripts on the app):** a force-click on a DEEP-LINKED app screen can land on the
  Schedule screen mounted beneath it (§7.10's shape, met from a `gotoAuthed` rather than a tab tap). Hand-check
  scripts use `el.click()`; and a toast lives 3000 ms — `waitFor` it, never `waitForTimeout` past it.
- **TESTING §5:** the roster's characterisation suites (`rosterFormat.test.ts` 5, `rosterRows.test.ts` 21), the app
  fence (`SwimSyncApp/lib/tierBoundaries.drift.test.ts`, 8 tests), the hand-check pair in `docs/refactor/`.
- **BACKLOG:** `verify-coach-remove-student` (Remove has no driver — the hand-check is the only proof); a driver
  press of the level toggle's **Hide** branch (level-skills only expands).
- **ARCHITECTURE §6:** the first APP unit's shapes — tiers in `features/<screen>/`, the store read in `domain/` only,
  `ui/` imports expo-router's `router` singleton directly (no navigation context to protect), `useFocusEffect` on
  the route keyed on a hook-returned `loadData`.

## 13. PRE-COMMIT GATE — walk before EVERY stage commit

**The five that matter most:**
- [ ] `npm run typecheck && npm test` green; jest count ≥ the previous stage's
- [ ] ledger counts match §6's table for this stage (0b: 9 / 9)
- [ ] Stage 2: all 11 characterisation cases present by name; `verify-trials` + `verify-student-identity` at baseline
- [ ] Stage 3: one `[roster] load` per focus; `loadData` returned unwrapped; `today` read after the `Promise.all`
- [ ] Stage 5: verbatim script clean; Tailwind `text-[11px]` computes to 11px after `--clear`

**Every stage:**
- [ ] scripted cut asserted every old string exactly once
- [ ] no `todayInSg()` inside `rosterRows.ts`; no `if (!id)` guard; no error handling added in `dao/`
- [ ] comments travelled with their code
- [ ] the drivers for this stage (§8 cadence) ran and matched baseline, named in the commit message
- [ ] nothing in `HANDOVER.md` / `PRD.md` / `BACKLOG.md` touched (written at close)
