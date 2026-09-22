# Coach Schedule (landing tab) — full-track refactor plan

_`SwimSyncApp/app/(coach)/schedule/index.tsx`. Written 2026-09-22 via `/plan-with-confidence` (4 questions: extract
the WHOLE per-class loop as pure, tested code; `lib/scheduleBuckets` STAYS; folder `features/schedule`; root checkout,
branch `refactor/coach-schedule`), then `/plan-review` (Fable 5.1 — 12 findings, 5 spot-checked and all held; folded
inline as ⚠ RISK n (plan-review)). **The third and LAST
app giant, and the coach's landing tab. NEEDS MARKING feeds billing (§8i): a lesson missing from it is a lesson nobody
marks, and unmarked attendance blocks the month with no override.** Method: `FEATURE_TIER_REFACTOR_PLAYBOOK.md`.
Worked example: `COACH_ATTENDANCE_REFACTOR_PLAN.md` (copy it, don't re-derive it)._

**Rule 0: zero behaviour change.** Every stage is a move. A stage that needs a behaviour change stops, and the change
becomes a `BACKLOG.md` item.

**GATE before `main` (§7.1):** nightly `35712884217` on `6f1da89` (attendance) — **GREEN, 52/52, read from its log on
2026-09-22.** Merge after this unit's own net (§8) passes.

---

## 1. The measure (`wc -l` / grep, 2026-09-22 — re-measure before each stage)

| | |
|---|---|
| Lines | **1,255** |
| `useState` | **8** real (`grep -c 'useState[<(]'` = 9; one is the `⚠ AN OFFSET` comment, :297): `weekOffset` `needsMarking` `weekLessons` `locationFilter` `floor` `truncated` `expandedDays` `loading`. Plus **1 `useRef`** (`loadToken`), **1 `React.useMemo`** (`scheduleLocationOpts`), **2 `useCallback`** (`loadData`, the focus callback), **1 `useFocusEffect`** |
| `.from(` | **9**, all in `loadData`: `coaches`, `classes` (owned), `session_coaches`, `classes` (covered), `class_shadow_coaches`, `classes` (shadowed), `lesson_sessions`, `trial_bookings`, `makeup_bookings` |
| `.rpc(` | **0** direct. **2 indirect** via client-holding `lib/` helpers: `fetchMarkableFloor()`, `fetchCoveredOutSessions(probeIds)` |
| `fetch(` | 0 |
| `@/lib/*` imports | **11**: `supabase` `lessonDates` `markableFloor` `attendanceCompleteness` `timeOfDay` `attendanceSummary` `scheduleWeek` `scheduleBuckets` `locationFilter` `coachRoster` `sessionMainCoach` |
| Other | `@/store/useAppStore` (`session` only — **no `showToast`**), `@/components/Card`, `@/components/PrimaryButton`, `expo-router` (`router`, `useFocusEffect`), `@expo/vector-icons`, `react-native` |
| Module-scope | `ROW_LIMIT`, `CLASS_SELECT`, types `WeekLesson` `BacklogItem`, `formatTime` `shortDate` `dayHeading`, components `ProgressChip` `RoleBadge` `DaySection` |
| Fence ledgers at 0b (prediction) | **check 3 = 12**: imports :13 :21 :64 + 9 client sites :362 :402 :412 :439 :449 :464 :489 :552 :562. **check 4 = 12** (11 `@/lib` + `@/store`). Re-derive by running the fence with empty new pins; these are the numbers to match |

## 2. The target shape

```
SwimSyncApp/features/schedule/            # OUTSIDE app/ — Expo Router routes every file under app/
  types.ts                                # WeekLesson, BacklogItem (+ their doc comments)
  constants.ts                            # ROW_LIMIT (+ the max_rows comment block), CLASS_SELECT (+ comment)
  dao/schedule.repo.ts                    # the 9 .from() — raw builder, no mapping, no error handling
  dao/schedule.rpc.ts                     # binds fetchMarkableFloor, fetchCoveredOutSessions
  domain/scheduleFormat.ts (+ .test)      # formatTime / shortDate / dayHeading (pure)
  domain/scheduleIndex.ts (+ .test)       # sessionIndex, bookedIndex, isTruncated — the maps loadData builds
  domain/scheduleRows.ts (+ .test)        # THE PER-CLASS LOOP, pure: §7
  domain/useWeek.ts                       # weekOffset + every per-render date derivation
  domain/useScheduleLoad.ts               # the spine: needsMarking weekLessons floor truncated loading + loadToken + loadData
  domain/useScheduleSections.ts           # locationFilter + expandedDays + the render-time de-dup and buckets
  ui/ProgressChip.tsx ui/RoleBadge.tsx ui/DaySection.tsx ui/Greeting.tsx ui/WeekSelector.tsx
  ui/LocationChips.tsx ui/TruncatedNotice.tsx ui/NeedsMarkingSection.tsx ui/TodaySection.tsx ui/EmptyWeek.tsx
app/(coach)/schedule/index.tsx            # composition: ~150 lines, 0 useState, the ONE useFocusEffect
```

**Import rules — the roster's and attendance's, unchanged (ARCHITECTURE §6):** `@/store/*` in `domain/` only; the
route imports `@/features/schedule/{ui,domain}/…`, `…/types`, `…/constants`, React, `react-native`, `expo-router`,
`@expo/vector-icons`, `@/components/*`. `ui/` may import the `router` singleton and `@/lib/*` PURE helpers
(`formatSgDate`, `progressLabel`, `canMark`, `roleBadge`, `isFinished`, `isNowInRange`, `formatAttendees`).

## 3. The slices, by state cluster

| Slice | State | Moves to |
|---|---|---|
| **Week** | `weekOffset` + derived `todayDate` `nowMins` `todayStr` `selectedMonday` `weekStart` `weekEnd` `label` `showsTodaySection` | `useWeek()` |
| **Spine (load)** | `needsMarking` `weekLessons` `floor` `truncated` `loading` (5) + ref `loadToken` + `loadData` | `useScheduleLoad(…)` + pure `scheduleIndex.ts` / `scheduleRows.ts` |
| **Sections** | `locationFilter` `expandedDays` (2) + `bounds` + `toggleDay` + the render-time de-dup | `useScheduleSections(…)` |

1 + 5 + 2 = **8**, the §1 count. Assert 0 `useState` / 0 `useRef` / 0 `useMemo` on the route after Stage 5.

**Creation order = dependency order** (playbook §5: the later hook depends on the earlier, never the reverse):
`useWeek()` → `useScheduleLoad(week)` → `useScheduleSections(week, load)`. `bounds` needs `floor` (load) and
`todayDate` (week), so it is derived in `useScheduleSections`, not `useWeek` — **never** make `useWeek` take `floor`.

## 4. `lib/` verdicts — ALL 10 STAY

Sole-importer grep over `@/lib/<m>` AND `./<m>`, excluding tests, 2026-09-22:

| Module | Code importers | Verdict |
|---|---|---|
| `scheduleBuckets` | **1** (this screen) | **STAY — user's call.** Pure, has `lib/scheduleBuckets.test.ts`; its header is the NEEDS-MARKING prohibition. Moving buys cohesion for path repoints (`BACKLOG.md:374`, `docs/plans/WAVE_3_PLAN.md:52`) |
| `timeOfDay` | 1 | **STAY — TWIN** (`SwimSyncAdmin/lib/timeOfDay.ts`) |
| `lessonDates` · `attendanceCompleteness` | 20 · 4 | STAY — TWIN files |
| `scheduleWeek` · `coachRoster` | 4 · 5 | STAY — **multi-importer, NOT twins** (plan-review: no admin copy exists) |
| `attendanceSummary` · `locationFilter` | 4 · 2 | STAY |
| `markableFloor` · `sessionMainCoach` | 3 · 2 | STAY. Client-holding — bound in `dao/schedule.rpc.ts` |

No module moves, so §7.250 and the path-grep repoint don't apply. **Verify at review:** nothing imports from
`schedule/index.tsx`, and no source-scan test pins a snippet of it (`git grep -n "schedule/index" -- '*.test.*'` →
nothing, 2026-09-22).

## 5. The risks, ranked by blast radius (most → least)

_Each one is mitigated **inline at its stage in §6**. This list is the why; §6 is the what._

1. **The NEEDS MARKING filter** (Stage 2). Six `continue`/push decisions per date, in a load-bearing ORDER:
   `expected.length === 0` → fully marked → not ended → `!canMark(roleAt(date))` → probe push (`owned`, NOT
   `showsWholeSchedule`) → push. The range is `backlogFrom` (floor only), NOT the per-class enrolment floor (§7.18,
   §7.97). Cancelled → enrolment spans withheld, bookings kept. A lesson dropped here is a lesson nobody marks and a
   month that blocks with the coach's screen saying "up to date".
2. **The pure extraction itself** (Stage 2). The loop's closures (`datesIn`, `roleAt`, `lessonAt`) read seven maps
   and four dates from `loadData`'s scope. Lifting them into a function with parameters is exactly where a date
   gets swapped (`weekStart` for `backlogFrom`), `todayDate` gets re-read from a clock, or `nowMins` gets fresher
   than the captured one. **The probe list's ORDER and DUPLICATES** (a lesson in both the week and the backlog is
   pushed twice) are behaviour too. **Resolved (plan-review):** `fetchCoveredOutSessions` dedupes FIRST
   (`lib/sessionMainCoach.ts:67`), then caps the UNIQUE count at `MAX_PROBE = 200` → over the cap it returns the
   EMPTY set (fail-loud: covered lessons stay on the owner's list). So duplicates are neutral — as long as nobody
   else dedupes or slices.
3. **The load's race guard + the focus effect** (Stage 3). **7** `if (!current()) return;` checks (:365 :420 :441
   :456 :466 :578 :800) over **8** awaits (:361 :401 :439 :449 :464 :489 :550 :799) — the :578 check covers BOTH
   `sessionsRes` (:489) and the bookings (:550). And `setTruncated` (:579) commits BEFORE the probe await, so a
   superseded run can write `truncated` but not the lists — existing behaviour, preserved. `useCallback` deps `[session, todayDate, weekOffset]` are load-bearing (the ⚠ comment), and
   `useFocusEffect(useCallback(() => { loadData(); }, [loadData]))` is the ONLY trigger — an extra effect is a
   second four-query round (the ⚠ ONE EFFECT comment).
4. **Render-time de-dup** (Stage 4): `visibleNeedsMarking` filters today only when `showsTodaySection`; `needsKeys`
   pulls NEEDS MARKING out of the week buckets; `effLocationFilter` clamps to "". Moving any of it into `loadData`
   is the bug the comments forbid (a lesson in neither section).
5. **Markup** (Stage 5): the `NEEDS MARKING (N)` heading string is asserted with its count by FOUR drivers
   (unmarked-lessons, stale-screen, schedule-week, trials) and must stay UNIQUE for two negatives (bulk-setall,
   unmarked-lessons); section ORDER and `DaySection`'s two-`<Text>` header are load-bearing (anchored regexes); the
   `week-prev`/`week-next`/`week-today` testIDs; `DaySection`'s "future lesson → roster, never attendance" tap; the
   module-scope component rule (a component declared inside another remounts every render).
6. **Frozen clock values**: `todayDate` / `nowMins` are read ONCE per render; `nowMins` is NOT in `loadData`'s deps,
   so the load uses the value from the render that created the callback. Preserved — not "fixed".
7. **The net is broad and under-derivable by name** (§8): every coach login lands here, and every coach deep link
   lands here too (§7.254), so almost every coach driver loads this screen.

## 6. Stage-by-stage, one commit each

**Gate every stage:** `cd SwimSyncApp && npm run typecheck && npm test`. Green, or `git checkout -- .`.
**Scripted cuts** asserting each old string occurs exactly once (scripts in the scratchpad). jest before 0b: **484**.

| Stage | What | Ledger after (check 3 / check 4) |
|---|---|---|
| **0b** | Widen the app fence to `features/schedule` + the route; pin; prove red | **12 / 12** |
| **1** | `types.ts` + `constants.ts` + `domain/scheduleFormat.ts` (+ test) | 12 / ≤12 |
| **2** | `domain/scheduleIndex.ts` + `domain/scheduleRows.ts` — the pure half of `loadData` + characterisation tests. Fetches stay on the route | 12 / ≤12 |
| **3** | `dao/` (9 `.from` + 2 helpers) + `domain/useWeek.ts` + `domain/useScheduleLoad.ts`, **one commit** | **0** / *n* |
| **4** | `domain/useScheduleSections.ts` | 0 / *n* |
| **5** | `ui/` ×10, markup verbatim; the route is composition | **0 / 0** |
| **L4** | The full §8 net + smoke + hand-checks; §11a log; §12 findings | — |

### ⚠ Stage 0b
- `SCOPE_DIRS` += `"features/schedule"`, `PAGES` += `"app/(coach)/schedule/index.tsx"`, **same index**. `.gitkeep`
  holds the folder open (the scan test asserts it exists); Stage 1 deletes it. Header gains a `SCOPE:` line + proof.
- Run with empty new pins; the red list must equal §1's 12 + 12 exactly. Pin by file AND snippet; each `why` names
  the stage that removes it. Check the join rule (`dataAccess` joins one following line only when the line ends in
  `supabase`): :402/:412 render as `supabase .from("classes")` / `supabase .from("session_coaches")`, :552/:562 as
  `? supabase .from("trial_bookings")` / `…makeup_bookings`, :439/:464 differ by `coveredClassIds`/`shadowClassIds`.
  **ASSERTION:** 12 sites, **12 pins**, no shared pin (plan-review simulated the fence: none collide).
  **⚠ RISK (plan-review) PROHIBITION:** the :402 pin keeps the SPACE — `supabase .from("classes")`. A bare
  `.from("classes")` also matches :439/:464, so one pin would silently cover three sites and the shrink test would
  never go red for two of them.
- **ASSERTION:** check 3's helper leg sees `@/lib/markableFloor` AND `@/lib/sessionMainCoach` on this route.
- **PROVE RED, then revert:** `features/schedule/ui/Break.tsx` → `../dao/x` (1); `dao/break.ts` → `expo-router` (2);
  `domain/break.ts` → `@/lib/markableFloor` (3, helper leg) and `fetch(` (3); unpinned `@/lib/timeOfDay` on the
  route (4) — **NB it is already imported there; use `@/lib/confirm` instead**; a corrupted pin (shrink test); a
  typo'd `PAGES` path and a length mismatch (scan test red, not TypeError); `domain/zz.test.ts` failing (testMatch);
  `toLocaleDateString()` in `domain/break.ts` (both `sgDisplay` twins). Infra lines (jest `testMatch`, both
  `SCAN_DIRS`, Tailwind `content`) — **verify, don't re-add**.

### ⚠ Stage 1
- Verbatim, comments included: the `max_rows` block with `ROW_LIMIT`; `CLASS_SELECT`'s template literal byte-
  identical (indentation inside the backtick string included); `WeekLesson`/`BacklogItem` with every field comment.
- `formatTime`, `shortDate`, `dayHeading` verbatim into `domain/scheduleFormat.ts`.
- **ASSERTIONS (characterisation, §7.25 does not apply — say so in the header):** `formatTime("00:05")` → `12:05 AM`,
  `"12:00"` → `12:00 PM`, `"13:30:00"` → `1:30 PM` (seconds dropped); `shortDate`/`dayHeading` on a fixed date, and
  **with the process TZ set to America/Los_Angeles** they still print the SG date.

### ⚠ Stage 2 (the pure loop) — RISK 1, 2 MITIGATION. The biggest stage.
- **STEP, before any code:** run the §8 net on the unchanged branch (Expo WITHOUT `CI=1`, §7.253); record runtime
  counts as the baseline.
- **`scheduleIndex.ts`:** `sessionIndex(windowSessions)` → `{ sessionByClassDate, sessionDatesByClass }` (the
  `forEach` verbatim, both comment blocks travel); `bookedIndex(bookingRows, makeupRows)` (the `for` verbatim,
  `[...bookingRows, ...makeupRows]` order kept); `isTruncated({ windowSessions, bookingRows, makeupRows, rosterRaw })`
  — the four `>= ROW_LIMIT` legs in order, the roster leg counted on the RAW rows (comment travels).
- **`scheduleRows.ts`:** `buildSchedule(input)` returns `{ lessons, backlogItems, probeIds }` — the `for (const {
  cls, owned, shadowed } of coachClasses)` body VERBATIM, with the inner closures (`datesIn`, `roleAt`, `lessonAt`)
  kept as inner closures, not hoisted. `input` = `{ coachClasses, sessionByClassDate, sessionDatesByClass,
  bookedByClassDate, rosteredDates, assignmentByLesson, weekStart, weekEnd, backlogFrom, todayDate, nowMins }` — the
  exact names the loop reads, so the body needs no rename. Then `applyCoveredOut(backlogItems, lessons, coveredOut)`
  → `{ ownBacklog, weekCards }` with the `.sort` (most recent first) inside.
  Also `coachClassesOf(owned, covered, shadowed, shadowedClassIds)` (the three-spread array, its comment) and
  `coveredClassIdsOf` / `shadowClassIdsOf` (the two filters).
- **PROHIBITION:** no `todayInSg()` / `nowMinutesInSg()` / `Date` in any Stage 2 file — dates and `nowMins` are
  parameters. **ASSERTION:** `grep -cE 'todayInSg|nowMinutesInSg|new Date|Date\.now' features/schedule/domain/
  schedule{Index,Rows}.ts` = 0. `toSgDate` comes from `@/lib/lessonDates` (grep = 1), never reimplemented (§7.227).
- **PROHIBITION:** do not reorder, merge or "simplify" the backlog `continue`s; do not replace `owned` with
  `showsWholeSchedule` at either probe push; do not collapse the two `expectedStudentsOn` ternaries into a helper
  (the ⚠ "exactly ONE expectedStudentsOn call per pair" comment is about `lessonAt` — the backlog loop has its own,
  and that is the original's shape; keep both).
- **ASSERTION (script):** every logic line of `buildSchedule` exists in `git show HEAD:<route>` :607–782 — only the
  signature/return differ. Same for `sessionIndex`, `bookedIndex`, `isTruncated`, `applyCoveredOut` against their
  ranges.
- **The route calls the pure functions** in the same places, with the same values; fetches stay on the route.
- **⚠ RISK (plan-review) STEP:** every fixture timestamp spells its offset — `enrolled_at: "2026-08-01T08:00:00+08:00"`,
  never a bare `Z` near midnight (§7.227): `toSgDate` runs INSIDE `buildSchedule`, so a `20:00Z` fixture is the next
  SG day and a case passes for the wrong reason.
- **PROHIBITION:** `probeIds` is returned RAW — no dedupe, no `.slice(0, MAX_PROBE)` in `scheduleRows`, the hook or
  dao. The lib does both, in that order.
- **ASSERTIONS (named characterisation cases, `scheduleRows.test.ts`):**
  1. owned class, weekday recurrence: every weekday in `[weekStart, weekEnd]` is a card; a session date OFF the
     weekday (extra lesson) is a card too; a booking date off the weekday is a card.
  2. covered class (not owned, not shadowed): cards ONLY on the rostered dates in range, never the recurrence.
  3a. shadowed class, no assignment: whole recurrence; `role` = shadow; 0 `probeIds`; 0 `backlogItems`.
  3b. **⚠ (plan-review) shadowed class + a `session_coaches` row on ONE date:** SUBSTITUTE BEATS SHADOW
     (`lib/coachRoster.ts:133`) → role `cover`, `canMark` true → exactly ONE backlog item on that date, still 0
     `probeIds` (`owned` false). The load-bearing half: a sub on a shadowed class is still nagged.
  4. backlog: unmarked past lesson → in; fully marked → out; nobody expected → out; today's lesson not yet ended
     (`nowMins` before `end_time`) → out, after → in.
  5. **the §7.97 case:** `backlogFrom="2026-07-01"`, booking `2026-07-15`, first enrolment `2026-08-01T08:00:00+08:00`,
     today `2026-08-20`, `nowMins=0` → `backlogItems` has `date:"2026-07-15"`, `progress.kind === "unmarked"`, and
     NO other July date (the `expected.length === 0` suppression).
  6. cancelled session: enrolled students not expected (→ out if no guests); a guest on it → still in.
  7. `probeIds`: owned + has session + unfinished → pushed; a lesson in BOTH the week and the backlog → pushed
     TWICE (order: week pass first) — pin the array exactly, e.g. `["s1","s1"]`.
  8. `applyCoveredOut`: a covered-out session leaves the backlog and flips an `owner` card to `covered`; a non-owner
     card is untouched; backlog sorted most recent first.
  9. `isTruncated`: each of the four legs alone at exactly `ROW_LIMIT` → true; all at `ROW_LIMIT - 1` → false;
     **`rosterRaw: null`** with the rest empty → false, no throw (`rosterRes.data?.length ?? 0`, :588).
  10. `lessonAt`'s `students`/`guests` split sums to `expected.length` (the `2+1` rule).
- **ASSERTION:** after the commit, the net's schedule drivers (`verify-schedule-week`, `verify-unmarked-lessons`,
  `verify-cancel-lesson`, `verify-coach-roster`, `verify-tz-saturday`, **`verify-trials`** — the §7.97 runtime proof)
  hit baseline, **bundle proven current first**.

### ⚠ Stage 3 (spine hook + dao) — RISK 3, 6 MITIGATION
- **`useWeek()`** owns `weekOffset` and returns every per-render derivation (`todayDate`, `nowMins`, `todayStr`,
  `selectedMonday`, `weekStart`, `weekEnd`, `label`, `showsTodaySection`), recomputed EVERY render exactly as now —
  **PROHIBITION:** no `useMemo` on `todayDate`/`nowMins` (the ⚠ OFFSET comment: a frozen clock is the bug). The
  `⚠ AN OFFSET, NEVER A STORED MONDAY` comment travels with the `useState`.
- **`useScheduleLoad({ weekOffset, todayDate, nowMins, weekStart, weekEnd })`** reads `session` from the store
  itself; owns the 5 states + `loadToken`; returns them + `loadData`. **`loadData` keeps its `useCallback` with deps
  `[session, todayDate, weekOffset]` byte-identical**, and the `// eslint`-free ⚠ deps comment travels. Its body
  moves verbatim, `.from` builders → dao calls, pure parts → Stage 2's functions.
- **⚠ RISK (plan-review) PROHIBITION:** no `useRef` / "latest value" ref and no `useMemo` for any hook ARGUMENT, and
  `useScheduleLoad` never calls `todayInSg()` / `nowMinutesInSg()` (they stay in `useWeek`). The args stay plain
  closures from the creating render — exactly today's capture. **ASSERTION:**
  `grep -cE 'useRef|useMemo|todayInSg|nowMinutesInSg' features/schedule/domain/useScheduleLoad.ts` = **1** (`loadToken`).
- **The focus effect STAYS ON THE ROUTE, byte-identical:** `useFocusEffect(useCallback(() => { loadData(); },
  [loadData]));` with its ⚠ ONE EFFECT comment. **PROHIBITION:** no extra `useEffect`, no moving it into the hook.
- **ASSERTION (script):** exactly **7** `if (!current()) return;` in the hook, in order, at the same await boundaries —
  NO check added after `sessionsRes` (:489). `setTruncated(` sits textually AFTER the 6th check and BEFORE the
  `fetchCoveredOutSessions` await. **PROHIBITION:** do not move `setTruncated` after the probe "for consistency". `setFloor(markableFloor)` stays right
  after the first check; the `!coach` block's four setters in order.
- **ASSERTION (script, RISK 3):** all 9 dao builder chains, `supabase` stripped, byte-identical to HEAD incl.
  terminals (`.single()`, `.limit(ROW_LIMIT)`, `.order(…)`). The `classIds.length > 0 ? … : Promise.resolve(…)` and
  `coveredClassIds.length > 0 ? await … : { data: [] }` ternaries stay in the HOOK; only builders move. Note the
  asymmetry is behaviour: `coveredRes`/`shadowRes`/`sessionsRes` fall back to a plain object, the bookings to
  `Promise.resolve` — keep both.
- **STEP:** temporary `console.log("[sched] load", weekOffset)`; in Expo web: mount → ONE log; press week-next →
  ONE; tab to Classes and back → ONE (focus refetch); idle > 1 min untouched → ZERO (no clock-driven re-trigger). Remove before commit; record in the stage log.
- **STEP:** full §8 net. **ASSERTION:** `verify-schedule-week` and `verify-unmarked-lessons` at baseline, read from
  their logs (PASS/FAIL lines).

### ⚠ Stage 4 (sections) — RISK 4 MITIGATION
- `useScheduleSections({ week, needsMarking, weekLessons, floor })` owns `locationFilter` + `expandedDays`; returns
  `bounds`, `visibleNeedsMarking`, `scheduleLocationOpts` (its `useMemo` on `[weekLessons]` kept), `effLocationFilter`,
  `buckets`, `todayLessons`, `todayStudents`, `todayGuests`, `toggleDay`, `setLocationFilter`, `openAttendance`.
  Every derivation verbatim, every comment block (DE-DUPLICATION, EXACTLY ONE section, clamp, `sessionId` IS
  DELIBERATELY NOT PASSED) travels. **PROHIBITION:** none of it moves into `loadData`.
- **ASSERTION:** `verify-schedule-week` (week nav) + `verify-unmarked-lessons` at baseline. **No driver touches the
  location chips** (plan-review: `grep ocation verify-schedule-week.mjs` = 0).
- **⚠ RISK (plan-review) HAND-CHECK (screenshots):** a coach whose week spans ≥ 2 locations (seed one if none):
  chips render, `All locations` first; selecting one hides the other's cards; week-next into a week with no lesson
  at that location → chips gone AND the week renders UNFILTERED (the clamp). PASS = other-location cards visible.

### ⚠ Stage 5 (ui) — RISK 5 MITIGATION
- **Destructure on each component's first line**; JSX byte-identical; verify by script against HEAD line ranges,
  whitespace-stripped. `grep -nE "[a-z] p\.[a-z]\.[a-z]+ [a-z]" features/schedule/ui/*.tsx` prints nothing.
- `ProgressChip`, `RoleBadge`, `DaySection` move as whole module-scope components with their ⚠ comments (the
  MODULE SCOPE comment's reasoning still holds in its own file — keep it). `DaySection`'s future-lesson → roster
  branch and its comment verbatim.
- The `NEEDS MARKING (N)` heading string and its ⚠ comment travel verbatim; the three testIDs stay.
- **ASSERTION, Tailwind:** **`pl-6`** — the only class unique to this file (the violet pair is also in parent
  attendance; re-grep before the move) — computes `padding-left: 24px` on `ui/DaySection`'s expanded list, on a
  Schedule reached by a TAP (§7.254), after `npx expo start --clear`; control `text-sm` = 14px.
- **⚠ RISK (plan-review) ASSERTION (script):** the ORDERED sequence of `<Text>` string literals in `HEAD:<route>`
  equals the ordered sequence over the composed route + `ui/*.tsx` in render order — a SET check cannot see a
  reordered section or a merged node. **PROHIBITION:** `DaySection`'s header stays TWO `<Text>` nodes
  (`verify-cancel-lesson.mjs:139`'s anchored `^Thu…25 Sep…$` needs `dayHeading` alone in its node); the sections
  render NEEDS MARKING → TODAY → COMING UP → DONE (`verify-coach-roster.mjs:222` splits on the headings).
- **⚠ RISK (plan-review) HAND-CHECK (screenshots) — the role UI no driver pins** (`View lesson`, `Covered`,
  on-Schedule `Shadowing` = 0 driver hits): with the coach-roster fixture, the sub's TODAY card → `Covering` +
  `Mark Attendance`; the shadow's → `Shadowing` + `View lesson` (outline); the owner's covered card → `Covered` +
  `View lesson`. PASS = all six on screen. Also tap a DONE row → URL `/classes/<id>/attendance?date=<d>&from=schedule`
  (no driver taps DONE). BACKLOG both as `check()`s at close.
- **STEP:** run `verify-cancel-lesson` at Stage 5 as well (the anchored-regex driver).
- **ASSERTION:** 0 `useState`/`useRef`/`useMemo` on the route; route ≤ ~150 lines; both ledgers 0;
  `npx tsc --noEmit --noUnusedLocals | grep 'features/schedule\|(coach)/schedule'` prints nothing.

## 7. The pure mapping — `domain/scheduleIndex.ts` + `domain/scheduleRows.ts`

`sessionIndex` · `bookedIndex` · `isTruncated` · `coveredClassIdsOf` · `shadowClassIdsOf` · `coachClassesOf` ·
`buildSchedule` · `applyCoveredOut`. Cases: §6 Stage 2. `parseAssignments` / `assignmentsByLesson` /
`rosteredDatesByClass` (lib, twin) are called by the HOOK, unchanged.

## 8. The driver net — by rendered string, testID and coach login

Grep: `NEEDS MARKING`, `week-prev|next|today`, `COMING UP`, `TODAY ·`, `DONE`, `Good morning`, `Back to this week`,
`All locations`, `No lessons`, `Too many lessons`, `Mark Attendance`, `View lesson`, `Edit attendance`,
`Covering|Shadowing|Covered`, `Cancelled by your admin`. Grep counts are hints; RUNTIME counts at the Stage 2
baseline.

| Driver | What it pins on this screen |
|---|---|
| **`verify-schedule-week`** | week nav + testIDs, week labels, sections, NEEDS MARKING (N), COMING UP → roster (NOT location chips, NOT a DONE tap — plan-review) |
| **`verify-unmarked-lessons`** | NEEDS MARKING (N) count — the floor-scoped set |
| **`verify-cancel-lesson`** | the struck card + "Cancelled by your admin" on Schedule |
| **`verify-coach-roster`** | NEEDS MARKING contents per role (the covered-out subtraction, :222) and the sub's week titles. **NOT the badges or `View lesson`** — its `Covering` is the ADMIN page (plan-review) |
| **`verify-stale-screen`** | Schedule → attendance → back, focus refetch shows the new state |
| **`verify-tz-saturday`** | the SGT long date in the greeting across the boundary (§7.7) |
| **`verify-trials`** | the trial-only lesson under NEEDS MARKING (N) + its Mark tap — **the §7.97 runtime proof** |
| `verify-bulk-setall` · `verify-smoke-app` | reach marking via this screen; bulk-setall's `!/NEEDS MARKING/` negative |

**The L4 set is all 16 coach-login drivers** (every one lands here, §7.254 — a crash reds them all): admin-lesson-detail,
cancel-lesson, bulk-setall, attendance-guard, level-skills, levels, makeups, smoke-app, schedule-week, stale-screen,
student-identity, trial-visibility, tz-saturday, trials, trial-onboarding, unmarked-lessons.

**Uncovered → hand-check:** the `truncated` notice (needs ≥ 900 rows — unit test only, say so); the location chips +
clamp (Stage 4); the role badges + `View lesson` + a DONE tap (Stage 5); the focus refetch count (Stage 3 log).

## 9. What this refactor does NOT change
No query text, no filter, no `ROW_LIMIT`, no payload, no copy, no class name, no testID, no navigation URL, no store
shape, no `lib/` module.

## 10. Accepted consequences
- No DISTINGUISHING bundle string (§7.31); CI + the drivers are the deploy check.
- `git blame` on moved lines points at this branch.
- `fetchMarkableFloor()` / `fetchCoveredOutSessions()` are bound in `dao/` — strictly equivalent calls.

## 11. The gate before `main`
1. Nightly `35712884217` green, read from the log — **DONE, 52/52.**
2. §8 net green on the finished screen at the baseline counts, plus the hand-checks.
3. `/commit-review` per stage, then `/deploy` (0 migrations, 0 edge functions → app-only).
4. Then one nightly on this unit. The full-track giants are then DONE; next are the app lite batches L-F / L-G / L-H.

## 11a. Stage log — what actually landed (branch `refactor/coach-schedule`)

| Stage | Commit | Ledger (3 / 4) | jest | Drivers / checks |
|---|---|---|---|---|
| 0b | `b05c53a` | 12 / 12 (24 pins) | 484 → 484 | Empty-ledger red list = **12 + 12 exactly** (the prediction). Proven red: checks 1–4 (helper leg via `markableFloor`, `fetch(`, `@/lib/confirm` for check 4), jest reaching `features/schedule`, BOTH sgDisplay twins, a corrupted pin (shrink + check 3), a typo'd `PAGES` path and a length mismatch (scan test). **Each of the 24 pins removed alone → exactly 1 offender.** Infra lines verified present, not re-added. `.gitkeep` holds the folder |
| 1 | `d1acf34` | 12 / 12 | 484 → 488 | — (types + pure helpers). The 3 blocks cut by line range from the route and written with only `export` added (verbatim by construction; each range asserted by its first/last text). `.gitkeep` deleted. Route 1,255 → 1,182 |
| 2 | (this commit) | 12 / **11** | 488 → 505 | **Baseline net (Stage 1 code) = 17/17 GREEN:** schedule-week 21 · unmarked-lessons 12 · cancel-lesson 17 · coach-roster 30 · stale-screen 22 · tz-saturday 6 · trials 16 · bulk-setall 10 · smoke-app **73/73** · attendance-guard 22 · makeups 15 · trial-onboarding **10/10** · trial-visibility 11 · levels 9 · level-skills 14 · student-identity 13 · admin-lesson-detail 27 (Expo WITHOUT `CI=1`). **After Stage 2** (bundle proven to carry `buildSchedule`): schedule-week 21 · unmarked-lessons 12 · cancel-lesson 17 · coach-roster 30 · tz-saturday 6 · trials 16 = baseline. Every logic line of `scheduleIndex.ts` / `scheduleRows.ts` exists in the pre-cut route (script; only headers, signatures, returns and two `const X =` → `return`). Cases 1–10 incl. **3a/3b**, the null-roster leg, fixtures in `+08:00`. **Proven able to fail** (each mutation, reverted): backlog range narrowed to the week → 3b/4/5/6 red; only owners nagged → 3b; probe list deduped → 7; not-ended guard dropped → 4; probe widened to `showsWholeSchedule` → 3a (after adding a session to 3a — it first passed). `isTruncated` takes `rosterRes` (not `rosterRaw`) so its body stays verbatim. Route import block rebuilt from usage (14 moved symbols gone, `attendanceCompleteness` pin deleted). Route 1,182 → 923 |

## 12. Findings for `/update-docs`
_(filled in per stage)_
- **BACKLOG (Stage 1): `formatTime` is now in TWO `features/*/domain` files** (roster, schedule — byte-identical) plus
  four route copies (parent attendance/home/child, coach classes — two take `string | null`). Playbook §5: a third
  feature copy is the trigger to consolidate; kept feature-scoped here (§7.233, not mid-refactor).
- **BACKLOG / TESTING §5 (Stage 2 baseline): the two "known local-only reds" were GREEN locally on 2026-09-22** —
  `smoke-app` 73/73 and `trial-onboarding` 10/10 (BACKLOG's *"Four UI drivers fail on a LOCAL full sweep"* records
  70/73 and 5/8). Re-check that item before quoting it again; it may be closable.
- **Comment drift (not fixed — rule 0 moves comments verbatim):** the `NEEDS MARKING (N)` ⚠ comment says "Three
  drivers assert on it verbatim"; plan-review counted FOUR (+ two negatives). Correct it in a later non-refactor commit.

## 13. PRE-COMMIT GATE — walk before EVERY stage commit
- [ ] `npm run typecheck && npm test` green; jest count ≥ previous stage's
- [ ] ledger counts match §6's table
- [ ] 0b: 12 pins, the :402 pin carries the space
- [ ] Stage 2: cases 1–10 incl. **3b** and the null-roster leg; fixtures spell `+08:00`; no clock in the pure files;
      logic lines verbatim by script; `probeIds` returned raw
- [ ] Stage 3: exactly 7 token checks in order, `setTruncated` before the probe; grep = 1; 9 chains identical incl. terminals; deps byte-identical; one
      `[sched] load` per mount / arrow / refocus; schedule-week + unmarked-lessons at baseline from their logs
- [ ] Stage 4: location-chip hand-check (clamp) screenshotted
- [ ] Stage 5: verbatim script clean; ORDERED string sequence equal; `pl-6` = 24px by tap; role-badge + DONE-tap
      hand-check; cancel-lesson green; 0 hooks declared on route

**Highest value, if nothing else:** case 3b + case 5 (billing), the 7-check order script, the ordered-string script.
- [ ] scripted cut asserted every old string exactly once; comments travelled with their code
- [ ] Expo started WITHOUT `CI=1`; bundle grepped for a current-stage symbol before each driver run (§7.253)
- [ ] nothing in `HANDOVER.md` / `PRD.md` / `BACKLOG.md` touched (written at close)
