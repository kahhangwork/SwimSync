# Coach attendance (marking) screen — full-track refactor plan

_`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx`. Written 2026-09-22 via `/plan-with-confidence` (3
questions: the 3 sole-imported `lib/` modules STAY; folder `features/mark-attendance`; root checkout, branch
`refactor/coach-attendance`), then `/plan-review` (Fable 5.1 — 4 factual
errors, all held on spot-check; folded inline as ⚠ RISK n). **The second app unit and the coach's MARKING
screen — the save path is billing-critical.** Method: `FEATURE_TIER_REFACTOR_PLAYBOOK.md`. App worked example:
`COACH_ROSTER_REFACTOR_PLAN.md` (copy it, don't re-derive it). Admin mirror of the save path:
`LESSON_DETAIL_REFACTOR_PLAN.md` RISK 1._

**Rule 0: zero behaviour change.** Every stage is a move. A stage that needs a behaviour change stops, and the
change becomes a `BACKLOG.md` item.

**GATE before `main` (§7.1):** the first GREEN nightly on the roster code. `35665909744` (on `d3169f2`) died with
"runner lost communication" — inconclusive, no logs; re-dispatched as `35681798827`. Build on the branch now; merge
only after that run is green **read from its log**, and after this unit's own net (§8) passes.

---

## 1. The measure (`wc -l` / grep, 2026-09-22 — re-measure before each stage)

| | |
|---|---|
| Lines | **1,183** |
| `useState` | **10** (`grep -c 'useState[<(]'`): `classTitle` `students` `attendance` `resolved` `loading` `saving` `menuOpen` `blocked` `shadowsHere` `role`. Plus **2 `useRef`** (`loadedStatuses`, `loadToken`) and **1 `useEffect`** (`[id, date]`, :218) |
| `.from(` | **14**. Load: `classes`, `coaches`, `lesson_sessions`, `session_coaches`, `attendance` (select), `trial_bookings`, `makeup_bookings`. Save: `coaches`, `lesson_sessions` (stale re-select), `lesson_sessions` (insert), `attendance` (upsert), `session_coach_absences` ×2 (delete, upsert), `audit_log` |
| `.rpc(` | **2** direct (`coach_is_active_class_shadow`, `session_shadow_coaches`). **3 indirect** via `lib/`: `fetchMarkableFloor()` + `fetchIsMainOnSession()` (hold the client themselves), `notifyCreditNoteEmails(supabase, …)` (takes it) |
| `fetch(` | 0 |
| `@/lib/*` imports | **13** (12 helpers + the client): `supabase` `confirm` `attendanceBulk` `attendanceRoster` `attendancePayload` `attendanceSaveError` `attendanceWindow` `markableFloor` `attendanceSession` `lessonDates` `coachRoster` `sessionMainCoach` `creditNoteEmail` |
| Other | `@/store/useAppStore` (`session`, `showToast`), `@/components/PrimaryButton`, `expo-router` (`router`, `useLocalSearchParams`), `@expo/vector-icons`, `react-native` |
| Fence ledgers at 0b | **check 3 = 20** lines (:13 :21 :34 + 17 client sites: :242 :258 :314 :369 :383 :415 :461 :470 :480 :606 :629 :639 :684 :717 :724 :750 :784). **check 4 = 14** (13 `@/lib` + `@/store`). Re-derive by running the fence with empty ledgers; these numbers are the prediction to match |

## 2. The target shape

```
SwimSyncApp/features/mark-attendance/     # OUTSIDE app/ — Expo Router routes every file under app/
  types.ts                                # TopStatus, DBStatus, StudentRow, AttState (+ their comments, incl. the `existingId` note)
  constants.ts                            # TOP_STATUSES
  dao/markAttendance.repo.ts              # the 14 .from() — raw builder result, no mapping, no error handling
  dao/markAttendance.rpc.ts               # the 2 .rpc() + binds fetchMarkableFloor, fetchIsMainOnSession, notifyCreditNoteEmails(supabase, …)
  domain/attendanceStatus.ts (+ .test)    # toDBStatus / fromDBStatus / formatDate (pure)
  domain/exitHref.ts (+ .test)            # the §7.65 exitHref rule (pure), comment block verbatim
  domain/attendanceRows.ts (+ .test)      # the pure half of load() — §7
  domain/useAttendanceLoad.ts             # the spine: 8 useState + both refs + load()
  domain/useSaveAttendance.ts             # saving + handleSave — THE SAVE PATH (§6 Stage 4)
  domain/useMarking.ts                    # menuOpen + setTop / setSub / onSetAll
  ui/AttendanceLoading.tsx  ui/BlockedLesson.tsx  ui/AttendanceHeader.tsx  ui/RoleNotice.tsx
  ui/StudentMarkCard.tsx    ui/CoachesPresent.tsx ui/SetAllMenu.tsx
app/(coach)/classes/[id]/attendance.tsx   # composition: ~120 lines, 0 useState, the one [id, date] effect
```

**Import rules — the roster's, unchanged (ARCHITECTURE §6, the app's shapes):**
- `@/store/*` in `domain/` only. The route and `ui/` never import the store.
- The route imports `@/features/mark-attendance/{ui,domain}/…`, `…/types`, `…/constants`, React, `react-native`,
  `expo-router`, `@expo/vector-icons`, `@/components/*`. Never `@/lib/*`, `@/store/*`, `…/dao`.
- `ui/` may import the `router` singleton (roster precedent). `domain/` may too (no fence check forbids it; only
  `dao/` bans `expo-router`).
- **The `[id, date]` effect stays on the route**, calling the hook's `load` — see Stage 3.

## 3. The slices, by state cluster

| Slice | State | Moves to |
|---|---|---|
| **Spine (load)** | `classTitle` `students` `attendance` `resolved` `loading` `blocked` `shadowsHere` `role` (8) + refs `loadedStatuses` `loadToken` | `useAttendanceLoad(id, date)` + pure `attendanceRows.ts` |
| **Save** | `saving` + `handleSave` | `useSaveAttendance(…)` |
| **Marking** | `menuOpen` + `setTop` `setSub` `onSetAll` | `useMarking(students, attendance, setAttendance)` |

8 + 1 + 1 = **10**, the §1 count. Assert 0 `useState` / 0 `useRef` on the route after Stage 6.

`attendance`, `shadowsHere`, `resolved` and `students` are written by the spine AND read or written by later
slices. **They stay owned by the spine**; `useAttendanceLoad` returns their setters, and the later hooks take them
as creation deps (playbook §5: the later-created hook depends on the earlier, never the reverse). The shadow tick's
inline `setShadowsHere(prev => …)` lambda moves verbatim into `ui/CoachesPresent`, with the setter destructured.

## 4. `lib/` verdicts — ALL 12 STAY (settled at /plan-with-confidence)

Sole-importer grep over `@/lib/<m>` AND `./<m>`, excluding tests, 2026-09-22:

| Module | Code importers | Verdict |
|---|---|---|
| `attendancePayload` · `attendanceSaveError` · `attendanceWindow` · `creditNoteEmail` | 1 each (this screen) | **STAY — twins.** Byte-identical to `SwimSyncAdmin/lib/…` and pinned by `SwimSyncAdmin/lib/attendanceSave.drift.test.ts:17–20`. `creditNoteEmail` is bound in `dao/…rpc.ts` (takes the client) |
| `attendanceBulk` · `attendanceRoster` · `attendanceSession` | 1 each (this screen) | **STAY — user's call.** Pure, already tested in `lib/`; moving buys cohesion at the cost of path repoints (`verify-trial-onboarding.mjs:32,:45` names `lib/attendanceRoster.ts` in comments) on the billing-critical screen |
| `markableFloor` · `sessionMainCoach` | 3 · 2 | STAY. Client-holding helpers — bound in `dao/…rpc.ts` |
| `coachRoster` · `lessonDates` · `confirm` | 3 · 18 · 8 | STAY (`lessonDates` is a TWIN FILE) |

No module moves, so §7.250 and the path-grep repoint don't apply. **Verify at review:** nothing imports from
`attendance.tsx`, and no source-scan test pins a snippet of it (`git grep -n "classes/\[id\]/attendance" -- '*.test.*'`
→ nothing, 2026-09-22).

## 5. The risks, ranked by blast radius (most → least)

_Each one is mitigated **inline at its stage in §6**. This list is the why; §6 is the what._

1. **The save path writes billing data** (Stage 4). A reordered step, a lost guard or a changed payload is a wrong
   invoice, a lesson on the wrong day (§7.64), an unsaveable lesson (§7.67), or a shadow silently unpaid. The
   step ORDER is load-bearing in five places (below).
2. **The load's race + staleness guards** (Stage 3). `loadToken` checked after every await (5 sites), the clear-
   everything-first block, `isShowingDate` holding the spinner, and the `[id, date]` deps (§7.64: `[]` wrote to the
   wrong day). Expo Router reuses the mounted screen on a `?date=` change — **no jest test sees any of it.**
3. **The roster-for-a-date mapping** (Stage 2): enrolment spans both ends inclusive, attendance/trial/make-up rows
   folded in by `mergeRoster`, initial statuses, `loadedStatuses` (feeds the credit-note guard). Wrong here = a
   child forced to be marked for a lesson they never attended, or a missed credit-note email.
4. **Who may mark** (Stage 3): `ownsClass = !me?.id || …` fails OPEN on purpose (§8i) and the shadow RPC exists
   because a table read fails CLOSED (§7.141). A "tidier" rewrite of either inverts it.
5. **The fence can be silently weaker for this screen**: `creditNoteEmail` takes the client as an arg and is NOT a
   derived helper, so check 3 sees only the `notifyCreditNoteEmails(supabase,` line, not the import (Stage 0b).
6. **Markup renames** (Stage 6): the JSX-text trap, the leaf-`<Text>` press target (`CoachesPresent`, :1126 — the
   RN-web press trap), the dropdown rendered LAST for stacking, `Alert.alert`-free.
7. **The net was under-derived last time** (§8): 11 drivers open this screen; three hardcode nothing but reach it
   only by tab taps; `verify-cancel-lesson` does NOT open it.
8. **Paths no driver covers** (§8): the cancelled-lesson block screen in the coach app, the credit-note email call
   after a billable → non-billable edit, the stale-session re-select arm.

## 6. Stage-by-stage, one commit each

**Gate every stage:** `cd SwimSyncApp && npm run typecheck && npm test`. Green, or `git checkout -- .`.
**Scripted cuts** that assert each old string occurs exactly once (scripts stay in the scratchpad). Record the jest
count before 0b; after that it only grows.

| Stage | What | Ledger after (check 3 / check 4) |
|---|---|---|
| **0b** | Widen the app fence to `features/mark-attendance` + the route; pin; prove red | **20 / 14** (19 pins — :314/:629 share one) |
| **1** | `types.ts` + `constants.ts` + `domain/attendanceStatus.ts` + `domain/exitHref.ts` (verbatim) + characterisation tests | 20 / 14 |
| **2** | `domain/attendanceRows.ts`, the pure half of `load()` (§7) + characterisation tests. The route calls them; fetches stay | 20 / ≤14 |
| **3** | `dao/` (load's 7 `.from` + 2 `.rpc` + floor + isMain) + `domain/useAttendanceLoad.ts`, **one commit** | **9** / *n* |
| **4** | `dao/` (save's 7 `.from` + `notifyCreditNoteEmails`) + `domain/useSaveAttendance.ts`. **Hand-checks** | **0** / *n* |
| **5** | `domain/useMarking.ts` | 0 / *n* |
| **6** | `ui/` ×7, markup verbatim; the route is composition | **0 / 0** |
| **L4** | The full §8 net + smoke + hand-checks; §11a log; §12 findings | — |

### ⚠ Stage 0b — RISK 5 MITIGATION
- **STEP:** `SCOPE_DIRS` += `"features/mark-attendance"`, `PAGES` += `"app/(coach)/classes/[id]/attendance.tsx"`,
  **same index** (`featureOf()` pairs them). Header gains a `SCOPE:` line and the dated proof.
- **STEP:** run with empty new pins; the red list must equal §1's 21 + 14 exactly. Any difference is a finding —
  stop and explain it before pinning. Pin **by file AND snippet**; each `why` names the stage that removes it.
  - **⚠ RISK 3 MITIGATION (plan-review): :314 and :629 CANNOT be pinned apart.** `dataAccess` joins ONE following
    line, and only when the line ends in `supabase` (`lib/tierBoundaries.drift.test.ts:187-189`), so both render as
    `const { data: existingSession } = await supabase .from("lesson_sessions")` — the differing `.select` is on the
    third line, invisible. **STEP:** ONE shared pin for that text, its `why` naming **Stage 4** (the LAST remover).
    **ASSERTION after Stage 3:** comment that pin out → check 3 reports exactly ONE offender, at the save's line;
    restore. At Stage 4 delete it (the shrink test goes red if you don't). So 20 sites, **19 pins**.
  - **STEP:** :415 does not end in `supabase`; pin it as `shadowRoster } = await supabase.rpc(` (the RPC name is on
    the next line and is not joined). :639 is distinct via `newSession, error: sessionError`.
- **ASSERTION:** check 3's third leg sees `@/lib/markableFloor` AND `@/lib/sessionMainCoach` on this route
  (`HELPERS` derived). `creditNoteEmail` is not a helper — it is visible only through `notifyCreditNoteEmails(supabase,`
  (:784). **PROHIBITION:** don't "fix" that by adding `creditNoteEmail` to `HELPERS`; it holds no client, and the
  derivation is by rule, not by list.
- **PROVE RED, then revert:** `features/mark-attendance/ui/Break.tsx` → `../dao/x` (1); `dao/break.ts` → `react-native`
  (2); `domain/break.ts` → `@/lib/sessionMainCoach` (3, helper leg) and `fetch(` (3); unpinned `@/lib/timeOfDay` on
  the route (4); a corrupted pin (shrink test); `PAGES` entry typo'd (scan test RED, not TypeError); a
  `SCOPE_DIRS`/`PAGES` length mismatch (scan test red). Delete all; confirm green. The four infra lines already
  exist (roster 0b) — **verify, don't re-add**: `jest testMatch`, both `sgDisplay` `SCAN_DIRS`, Tailwind `content`.

### ⚠ Stage 1
- Verbatim, comments included — the `"holiday" is READ-ONLY` block travels with `TopStatus`, the `existingId` note
  (§7.67) with `AttState`. `formatDate` wraps `formatSgStamp`; leave its options object untouched.
- `exitHref.ts`: `exitHrefOf(from, id)` returns the exact ternary. The ⚠ **DEFAULT ARM IS THE SAFETY NET** comment
  travels verbatim. **PROHIBITION:** no `switch`, no exact `"schedule"` match. `leaveScreen()` stays a local
  function on the route (`router.replace(exitHref as any)`) until Stage 3, then is passed down.
- **ASSERTIONS (characterisation, §7.25 does not apply — say so in the header):** every `DBStatus` round-trips
  through `fromDBStatus`→`toDBStatus` EXCEPT `holiday` (→ `null`, since `toDBStatus` has no holiday arm — pin it);
  `cancelled`/`trial` with a null or wrong `sub` → `null`; `exitHrefOf("roster")` → roster route; `"today"`,
  `"schedule"`, `undefined` → `/(coach)/schedule`.

### ⚠ Stage 2 (pure mapping) — RISK 3 MITIGATION
- **STEP, before any code:** run the §8 net on the unchanged branch; record runtime counts as the baseline.
- **Pure functions, dates passed in. PROHIBITION:** no `todayInSg()` in `attendanceRows.ts`. **⚠ RISK 4 ASSERTION:** `attendanceRows.ts`
  imports `toSgDate` from `@/lib/lessonDates` (grep = 1) — never a local reimplementation (§7.227's axis).
- **What moves** (names final here): `enrolledOnDate(enrolments, date)` (the span filter, both ends inclusive, the
  ⚠ comment block verbatim); `guestRows(rows)` (the three identical `.map(a => a.students).filter(Boolean).map(…)`
  chains — **one function called three times; keep the three call sites and their order into `mergeRoster`**);
  `initialAttendance(roster, attData, sid)`; `loadedStatusesOf(initAtt)`; `shadowRows(shadowRoster)` (`"Unknown coach"`,
  `present: !r.absent`); `cancelledBlock(classTitle, date, reason)` (the cancelled notice).
- **⚠ `cancelledBlock` takes `classTitle` AS AN ARGUMENT, and the route passes the SAME stale value it reads today.**
  At :333 the message reads the `classTitle` STATE from the closure — which `setClassTitle(cls.title)` at :282 has
  not yet updated in this render. So a cold open of a cancelled lesson says "…cancelled **this lesson** on…", and a
  `?date=` change from class A inherits A's title. **PROHIBITION:** do NOT pass `cls.title` — that is a behaviour
  change (rule 0). Pin both cases in the test. **Today this text is never SEEN** — the cancelled branch never
  renders (Stage 3's latent-spinner bug) — so the two are one BACKLOG item: fixing the spinner exposes the title.
- **ASSERTIONS (named cases):**
  1. A span opening ON `date` and one closing ON `date` are both in (inclusive ends); `unenrolled_at` null = open.
  2. `enrolled_at` / `unenrolled_at` are `timestamptz` read through `toSgDate` — a 23:30Z enrolment is the NEXT SG day.
  3. `initialAttendance` with `sid === null` → every row `unmarked`, attendance ignored.
  4. With `sid`: a row with a record gets its parsed status; a row without → `unmarked`; a `holiday` record → `holiday`.
  5. `loadedStatusesOf` maps `holiday` → `null` and `unmarked` → `null` (what the credit-note guard compares).
  6. `shadowRows`: missing name → `"Unknown coach"`; `absent: true` → `present: false`; null input → `[]`.
  7. `guestRows` drops a row whose `students` join is null.
  8. `cancelledBlock` with `""` → "this lesson"; with a reason → ` — <reason>`; without → no dash.
- **ASSERTION:** after the commit, the net's drivers that touch the roster build (`verify-trials`, `verify-makeups`,
  `verify-trial-onboarding`, `verify-attendance-guard`) hit baseline.

### ⚠ Stage 3 (spine hook + load dao) — RISK 2, 4 MITIGATIONS
- **⚠ RISK 2 PROHIBITION (plan-review):** `useAttendanceLoad` does NOT call `useLocalSearchParams`. The route reads
  `id`/`date`/`from` once and passes the SAME bindings to `useAttendanceLoad`, `useSaveAttendance`, `isShowingDate`
  and the header. Two independent param reads is how a header/roster split (§7.64) re-enters.
- **The effect stays on the route, byte-identical:** `useEffect(() => { load(); // eslint-disable… }, [id, date]);`.
  The hook returns `load` as a plain function (as today — recreated each render). **PROHIBITION:** no `useCallback`
  around it, no moving the effect into the hook, no change to the deps array.
- **STEP:** temporary `console.log("[mark] load", date)`; in Expo web, open a lesson, then change `?date=` in place
  (Schedule → a second lesson of the same class): exactly ONE log per param change, and the header never shows the
  new date over the old roster. Remove before commit; record in the stage log.
- **ASSERTION (script over the hook):** the 5 `if (token !== loadToken.current) return;` lines survive, in order,
  after: the class/coach `Promise.all`; the session lookup; the roster/shadow/isMain `Promise.all`; the
  `session_shadow_coaches` RPC; the bookings. The clear block (`setResolved(null)` … `setRole("owner")`) stays FIRST
  after `setLoading(true)`.
- **ASSERTION:** `const markableFloorPromise = fetchFloor()` sits AFTER `enrolledOnDate` and BEFORE the session
  lookup; its `await` stays INSIDE the `checkMarkableDate({…})` argument. `today: todayInSg()` stays read there,
  in the hook — not hoisted, not passed in.
- **PROHIBITION:** `ownsClass = !me?.id || cls.coach_id === me.id` verbatim, with its ⚠ comment. **ASSERTION:**
  `grep -c 'ownsClass = !me?.id || cls.coach_id === me.id' features/mark-attendance/domain/useAttendanceLoad.ts` = 1. The class-shadow
  question stays an RPC (§7.141 comment verbatim). `sid ? fetchIsMainOnSession(sid) : Promise.resolve(ownsClass)`
  verbatim. `canMark` gates the shadow RPC.
- **Keep:** the `!cls` block's exact `setX` sequence (blocked → resolved `{date, sessionId: null}` → loading false);
  the cancelled branch sets blocked + loading false but **NOT `resolved`** — and that is a LIVE LATENT BUG, preserved:
  `resolved` was nulled by the clear block, `isShowingDate(null, date)` is `false` (`lib/attendanceSession.ts:85`),
  so the render guard holds the SPINNER FOREVER and the "This lesson was cancelled" screen never shows. (The `!cls`
  branch sets `resolved` for exactly this reason — its own comment says so; the cancelled branch, added later by
  §8.81, missed it.) **PROHIBITION:** do not add the `setResolved` (rule 0). **⚠ RISK 7 STEP:** reproduce via an
  ORDINARY tap — the Schedule **DONE** section on a cancelled past lesson (`schedule/index.tsx:1228`, `tappable`),
  not only a deep link (§7.252: a deep-linked click can land on the screen beneath). Screenshot BEFORE Stage 3 and
  after — both must show the spinner; record it. **Reachable from three ordinary taps** (Schedule DONE; today's card
  `openAttendance(l)`, :1192, no cancelled gate; roster `PastSessions.tsx:42-46`), and the spinner view has no
  chevron with the stack header hidden (`classes/_layout.tsx:9`) — the tab bar is the only exit. File BACKLOG
  (§12). Every swallowed error stays (only `data` read).
- **dao returns the raw builder result.** Query text and the `.select()` template literal byte-identical,
  indentation inside the backtick string included (it is a string, but PostgREST ignores whitespace — keep it
  identical anyway so the diff is a pure move). The `session?.id ? … : Promise.resolve({ data: null … })` ternary
  stays in the HOOK (it reads the store); only the builder moves. Same for `sid ? … : Promise.resolve(…)`.
- **STEP (hand-check):** the blocked screen's `Back to class` → asserted exit URL for BOTH `from` arms (`roster` →
  roster route; absent → `/(coach)/schedule`). No driver presses it.
- **STEP:** full §8 net after this commit. **ASSERTION:** `verify-stale-screen` and `verify-attendance-guard` at
  baseline, **read from their logs** (PASS/FAIL lines), not a summary — they are the §7.64/§7.65 gate.

### ⚠ Stage 4 (the SAVE) — RISK 1 MITIGATION. A wrong mark is a wrong invoice.
- **`handleSave` moves VERBATIM into `useSaveAttendance`.** Its `.from`/`.rpc` calls become dao calls, `supabase`
  args vanish; nothing else changes. **PROHIBITION:** do not extract the validation loop into a pure function
  (its early `return`s are the precedence — playbook §5, the inversion trap), do not split the body into steps, do
  not add a `try`.
- **ASSERTION (script — the ORDER, by line index in the hook; each must be strictly after the previous):**
  1. validation loop (holiday `continue` BEFORE the unmarked check) → `setSaving(true)`
  2. coach lookup → `resolveSessionForDate(resolved, date)` → stale re-select → insert → the second `!finalSessionId` guard
  3. `setResolved({ date, sessionId: finalSessionId })` → `buildAttendanceRows(…)` with the holiday `.filter` BEFORE `.map`
  4. attendance upsert (`onConflict: "lesson_session_id,student_id"`) → its error return (`attendanceSaveErrorMessage(code)`)
  5. shadow absences (delete + upsert, `Promise.all`) **AFTER** the upsert → `audit_log` insert
  6. `mayHaveIssuedCreditNote(loadedStatuses.current, savedStatuses)` → awaited `notifyCreditNoteEmails` →
     `setSaving(false)` → `showToast("Attendance saved.")` → `leaveScreen()`
- **⚠ RISK 1 ASSERTION (script, plan-review):** every dao builder chain, `supabase` stripped, is byte-identical to its
  `git show HEAD:<route>` line range **including the terminal** (`.single()` vs `.maybeSingle()` vs
  `.select("id").single()`). A swapped terminal silently changes a branch (`.single()` on 0 rows → `data: null` +
  error; the code reads only `data` → "Could not find coach record"). Pass = **14 chains identical** (Stages 3 + 4).
- **PROHIBITION:** no `useCallback` / `useMemo` around `handleSave`. A deps list is a stale `attendance` at save
  time — marks from a previous render. It stays a plain function recreated per render, as today.
- **PROHIBITION:** the absences `Promise.all` keeps both arms as UNAWAITED builders returned from dao; the
  `Promise.resolve({ error: null })` arms stay in the hook.
- **ASSERTION:** the absences payload keeps `tenant_id: "00000000-0000-0000-0000-000000000000"` (trigger-stamped)
  and `marked_by: session!.id`; `onConflict: "lesson_session_id,coach_id"`. Every `session!` stays `!`.
- **Deps:** `useSaveAttendance({ id, date, students, attendance, resolved, setResolved, shadowsHere, loadedStatuses,
  leaveScreen })` — reads `session` and `showToast` from the store itself. `loadedStatuses` is the REF (read
  `.current` at save time — **PROHIBITION:** never pass `loadedStatuses.current` as a value; it would snapshot a
  stale map at render).
- **The dao binding for the credit-note call** is `notifyCreditNotes = (sid) => notifyCreditNoteEmails(supabase, sid)`
  — strictly equivalent (§10).
- **HAND-CHECKS (DB-verified, screenshots, script in the scratchpad — DOM clicks, `waitFor` the toast, §7.252):**
  a) **billable → non-billable on a billed month** (seed a billed invoice on a past lesson): flip Present → Absent,
     Save → **`SELECT count(*) FROM credit_notes` delta = 1** AND exactly **ONE** `credit-note-emails` request
     (`lib/creditNoteEmail.ts:110`) before navigation; if an email-state column/row exists, assert it too;
     b) a **first** save on a lesson with no session row: `SELECT count(*) FROM lesson_sessions WHERE class_id=… AND
     session_date=…` = 1 and every `attendance.lesson_session_id` equals it; c) a normal re-save: credit-note delta
     = 0 and **ZERO** `credit-note-emails` requests (the guard). **STEP:** BACKLOG a coach credit-note-email driver if (a)
     has none, written from `main` at close.
- **STEP:** full §8 net after this commit.

### ⚠ Stage 5 (marking)
- `setTop`, `setSub`, `onSetAll` verbatim; `onSetAll` closes the menu FIRST, reads `students`/`attendance` from the
  render (not `prev`) for `anyMarked` and the count, and uses `confirmAction` (never `Alert.alert`). The holiday
  filter inside `applyBulkStatus` stays inside the updater.
- **ASSERTION:** `verify-bulk-setall` at baseline.

### ⚠ Stage 6 (ui) — RISK 6 MITIGATION
- **Destructure the hook objects on each component's first line**; JSX byte-identical. Verify each `ui/` body by
  script against `git show HEAD:<route>` line ranges, whitespace-stripped. `grep -nE "[a-z] p\.[a-z]\.[a-z]+ [a-z]"
  features/mark-attendance/ui/*.tsx` prints nothing.
- The two headers (blocked + main) are NOT merged into one component — they differ (the main one toggles its title
  on `readOnly` and carries Set all). **PROHIBITION:** no shared header "for DRY".
- `SetAllMenu` stays rendered LAST inside the `SafeAreaView` (the stacking comment travels). The shadow name stays a
  leaf `<Text>` directly inside the `TouchableOpacity` (the ⚠ comment travels).
- **ASSERTION, Tailwind:** **`top-14`** — the ONLY class unique to this file (`text-[10px]` is also in parent
  attendance + schedule, `w-52` in `paynow.tsx`; re-grep before the move) — computes to 56px on `SetAllMenu` after
  `npx expo start --clear`; control `text-sm` 14px.
- **⚠ RISK 6 ASSERTION (script):** the set of JSX string literals in `HEAD:<route>` equals their union over
  `ui/*.tsx`. Three rendered strings have ZERO driver coverage — `Lesson Attendance` (read-only header ternary),
  `Tap a status for each student`, `Back to class` — so the script is their only net.
- **ASSERTION:** `grep -cE 'use(State|Ref)\b' <route>` = 0 hooks declared (the `useEffect` is the one left); route
  ≤ ~150 lines; both ledgers 0; `npx tsc --noEmit --noUnusedLocals | grep 'mark-attendance\|classes/\[id\]/attendance'`
  prints nothing.

## 7. The pure mapping — `domain/attendanceRows.ts`

`enrolledOnDate(enrolments, date)` · `guestRows(rows)` · `initialAttendance(roster, attData, sid)` ·
`loadedStatusesOf(initAtt)` · `shadowRows(rows)` · `cancelledBlock(classTitle, date, reason)`. Cases: §6 Stage 2.
`mergeRoster` (lib) is called by the HOOK with the four arrays, in the same order.

## 8. The driver net — re-derived by grep (§7.236) over rendered strings, entry taps and the primary button

Grep: `/attendance?date`, `Mark Attendance`, `Save Attendance`, `Lesson Attendance`, `Set all`, `Coaches present`,
`Not yet marked`, `Back to class`, `Tap a status`, `Make-up`, `holiday`, `shadowing`. Counts are RUNTIME counts,
recorded at the Stage 2 baseline (grep counts below are hints).

| Driver | What it pins on this screen |
|---|---|
| **`verify-attendance-guard`** | past / reopened / closed / wrong-weekday dates by deep link: the block screen, Save + Set all absent when blocked |
| **`verify-stale-screen`** | §7.64/§7.65: param change reloads, Save lands on the right lesson and exits to the right screen |
| **`verify-coach-roster`** | substitute / shadow roles, read-only notice, **Coaches present** tick → Save → absence row |
| **`verify-bulk-setall`** | Set all, confirm vs no-confirm paths, sub-type rows |
| **`verify-admin-lesson-detail`** | the admin's holiday mark shows read-only; the coach save leaves it untouched (RISK 7 there) |
| `verify-trials` | the dated Mark button lands on the guest's lesson; trial row + marking |
| `verify-makeups` | make-up guest on the host class, labelled `Make-up`, no Trial button |
| `verify-trial-onboarding` | a walk-in on its own date by deep link |
| `verify-schedule-week` | COMING UP row opens `…/attendance?date=` (URL) |
| `verify-tz-saturday` | Mark Attendance reached across the SG date boundary |
| `verify-smoke-app` | opens the route with `&from=roster` |

**NOT in the net (checked):** `verify-cancel-lesson` is admin + the coach **Schedule** only (:120) — it never opens
this screen, so the cancelled block screen is uncovered. `verify-parent-attendance` is the PARENT screen.

**Uncovered → hand-check:** the blocked screen's `Back to class` exit (Stage 3); the read-only title
`Lesson Attendance` (no driver asserts it — `verify-coach-roster` checks the notice and `shadowing`; hand-check it
as the shadow in Stage 6, and BACKLOG one `check()` in that driver); the cancelled-lesson spinner (Stage 3 screenshot), the credit-note email call and the
guard's skip (Stage 4 a/c), first-save session creation (Stage 4 b). The stale-session re-select arm
(`decision.kind === "stale"`) is unreachable from ordinary UI — covered by `lib/attendanceSession.test.ts` only;
say so, don't fabricate a path.

`verify-schedule-week` pins the URL only, never that the screen LOADED for that date — it is paired with
`verify-stale-screen` in the Stage 3 gate.

**Run cadence:** Stage 2 → the 4 roster-build drivers. Stage 3 → full net. Stage 4 → full net + hand-checks.
Stage 5 → `verify-bulk-setall`. Stage 6 → full net. L4 → full net + smoke. `--only` takes ONE name; loop it.
Nightly `35681798827` runs on GitHub's runner, not the local DB, so local drivers are safe; nothing else uses
the local database this session.

## 9. What this refactor does NOT change
No query text, no filter, no payload key, no error handling, no toast copy, no class name, no navigation URL, no
store shape, no `lib/` module.

## 10. Accepted consequences
- No DISTINGUISHING bundle string exists (§7.31); CI + the drivers are the deploy check.
- `git blame` on moved lines points at this branch.
- The `dao/` bindings for `notifyCreditNoteEmails(supabase, …)`, `fetchMarkableFloor()` and `fetchIsMainOnSession()`
  move the client (or the helper) inside `dao/` — strictly equivalent calls.
- The cancelled-lesson permanent spinner (§6 Stage 3) and its stale `classTitle` (Stage 2) are preserved and
  filed, not fixed.

## 11. The gate before `main`
1. Nightly `35681798827` (or a later one on the roster code) green, read from the log.
2. §8 net green on the finished screen at the baseline counts, plus the Stage 3/4 hand-checks.
3. `/commit-review` per stage, then `/deploy` (0 migrations, 0 edge functions → app-only; `main` IS the deploy).
4. Then one nightly on this unit before `(coach)/schedule/index` starts.

**Nightly gate — ACCEPTED by the user, 2026-09-22:** `35681798827` (on `d3169f2`, the roster code) = **51/52**; the
one red, `tenant-suspension` 10/12, is its first Expo login's fixed 6 s sleep (`verify-tenant-suspension.mjs:72`)
on a slow runner — the same parent logs in fine three checks later, and the driver is **12/12 locally**. Not the
roster. The user: "not a problem, can continue to merge to main once you are ready."

## 11a. Stage log — what actually landed (branch `refactor/coach-attendance`)

| Stage | Commit | Ledger (3 / 4) | jest | Drivers / checks |
|---|---|---|---|---|
| 0b | `79a4d85` | 20 sites, 19 pins / 14 | 462 → 462 | Empty-ledger red list = **20 + 14 exactly** (the corrected prediction). Proven red: checks 1–4 (helper leg via `sessionMainCoach`, `fetch(`), jest reaching `features/mark-attendance`, BOTH sgDisplay twins, a corrupted pin (shrink + check 3), a typo'd `PAGES` path and a length mismatch (scan test, no TypeError). Infra lines verified present, not re-added |
| 1 | `a86e1b7` | 20 / 14 | → 471 | — (types + pure helpers). 4 bodies VERBATIM by script (types, constants, attendanceStatus, exitHref's comment). `.gitkeep` deleted. Route 1,183 → 1,083. Before any driver: nightly `35681798827` = 51/52, the red `tenant-suspension` 10/12 (first Expo login's fixed 6 s sleep, :72) → **12/12 locally** |
| 2 | `8df463d` | 20 / 14 | → 480 | attendance-guard 22/22, trials 16/16, makeups 15/15, trial-onboarding 5/8 (= baseline). Every logic line of `attendanceRows.ts` exists in the pre-cut route (script; only signatures/returns/renames differ). Names final: `enrolledOn` (not `enrolledOnDate` — the route's local keeps that name) |

> **⚠ CORRECTION to Stage 2's driver evidence (found at Stage 3).** Expo had been started with `CI=1`, which turns
> Metro's file watcher OFF: it served the bundle frozen at startup (after 0b, before Stage 1) and never rebuilt —
> `exitHrefOf` was absent from the served bundle. So **Stage 2's four driver runs exercised the ORIGINAL code**, and
> `8df463d`'s "drivers = baseline" line proves nothing about Stage 2. (The baseline itself is unaffected — it was
> meant to be the original code.) Restarted without `CI=1`; the watcher proven live (a throwaway string appeared in
> the served bundle within 4 s and left again). **Stage 2 is re-proven by Stage 3's full net**, which runs on
> Stages 1–3 together. Candidate gotcha — §12.
| 3 | `e50017c` | **9 / 9** | 480 | **Full net = baseline** (attendance-guard 22, stale-screen 22, coach-roster 30, bulk-setall 10, admin-lesson-detail 27, trials 16, makeups 15, trial-onboarding 5/8, schedule-week 21, tz-saturday 6, smoke-app 70/73 — a first run's 69/73 was a one-off 502 from kong on the ROSTER's `markable_window_start`, re-run 70/73). 7 load chains identical to HEAD incl. terminals, both RPCs identical (script). Shared pin commented out → exactly ONE offender (the save's). 5 token checks in order; clear block first; floor + `todayInSg()` unmoved; `ownsClass` verbatim; no `useLocalSearchParams`/`useCallback` in the hook. Temp `[mark] load` log: exactly ONE per visit (2 lessons → 2), removed. Hand-checks: cancelled lesson via the Schedule DONE tap → permanent spinner BEFORE (original code) and AFTER (screenshots); Back to class → roster (`from=roster`) / `/schedule` (none). Route 1,028 → 746 |
| 4 | `012cf96` | **0** / 5 | 480 | **Full net = baseline** (same 11 counts; smoke-app 70/73 first time). Script: **14 of 14** dao chains identical to HEAD incl. terminals (load + save); the 21-step save ORDER strictly increasing; absences payload keys, both `Promise.resolve` arms, all 4 `session!.id` unchanged; every comment line of `handleSave` preserved; no `useCallback`; the route passes the REF. **Save hand-check 11/11 on Stage 3 code AND on Stage 4** (`handcheck-save.mjs`, DB-verified): (a) Present→Absent on an invoiced lesson → credit_notes +1, ONE `credit-note-emails` request, left to roster; (c) no-change re-save → +0, ZERO requests; (b) first save → exactly one `lesson_sessions` row, attendance attached, audit row, left to Schedule. **Proven able to fail:** with the guard forced `true ||`, (c) went red (`requests=1`, 10/11); reverted, bundle re-checked clean before the net. Route 746 → 536 |
| 5 | (this commit) | 0 / 3 | 480 | bulk-setall 10/10 (bundle confirmed to carry `useMarking`). setTop/setSub/onSetAll body VERBATIM by script; menu closed FIRST; `confirmAction`, no `Alert` in code. Route 536 → 493 |

**Baseline net (Stage 1 code, 2026-09-22):** attendance-guard 22/22 · stale-screen 22/22 · coach-roster 30/30 ·
bulk-setall 10/10 · admin-lesson-detail 27/27 · trials 16/16 · makeups 15/15 · trial-onboarding **5/8** ·
schedule-week 21/21 · tz-saturday 6/6 · smoke-app **70/73**. The two reds are BACKLOG's *"Four UI drivers fail on a
LOCAL full sweep"* (`BACKLOG.md:1827`) — same scores, same messages (the admin's unclaimed-child generation report;
`/invoice` + `/package` render). Neither is this screen.

**Deviation (0b):** the scan test asserts every `SCOPE_DIRS` folder EXISTS (roster Stage 1 added that), so
`features/mark-attendance/.gitkeep` holds the folder open. **Stage 1 deletes it** in the same commit that adds
`types.ts`.

## 12. Findings for `/update-docs`
_(filled in per stage)_ Known at planning:
- **BACKLOG (a real bug, found at planning): a coach opening an admin-CANCELLED lesson gets a permanent spinner.**
  The cancelled branch of `load()` sets `blocked` but never `resolved`, so `isShowingDate` holds the loader; the
  "This lesson was cancelled" screen has never rendered. Harmless to billing (the DB trigger refuses the write and
  there is nothing to mark) — but a dead end reachable from THREE ordinary taps (Schedule DONE, today's card,
  roster Past Sessions) with no back affordance; the tab bar is the only exit. The fix is one `setResolved({ date, sessionId: sid })`; it then exposes
  the stale `classTitle` in the message (pass `cls.title`). A coach-app driver for the block screen comes with it.
- BACKLOG: a coach-side credit-note-email driver if Stage 4's hand-check (a) finds none.
- **§7 candidate (found at Stage 3): `CI=1 npx expo start` serves a FROZEN bundle — Metro does not watch files in CI
  mode.** Every local driver run after an edit then tests the code as it was at startup, and passes, because nothing
  changed. Start Expo for local driver work WITHOUT `CI=1` (`< /dev/null` suffices for a non-interactive start), and
  prove the bundle is current before trusting a run: `curl` the entry bundle and grep for a string only the new code
  has. §7.31's served-bundle rule, met on localhost.

## 13. PRE-COMMIT GATE — walk before EVERY stage commit
- [ ] `npm run typecheck && npm test` green; jest count ≥ previous stage's
- [ ] ledger counts match §6's table (0b: 20 / 14, 19 pins)
- [ ] Stage 2: all 8 cases present by name; `cancelledBlock` receives the stale `classTitle`, not `cls.title`
- [ ] Stage 3: one `[mark] load` per param change; effect + deps byte-identical on the route; 5 token checks in
      order; no `useLocalSearchParams` in the hook; stale-screen + attendance-guard at baseline from their logs
- [ ] Stage 4: the six-step ORDER script clean; 14 dao chains identical incl. terminals; hand-checks a/b/c
      DB-verified (credit-note delta 1/0, request count 1/0); `loadedStatuses` passed as the ref; no `useCallback`
- [ ] Stage 6: verbatim script clean; JSX string-literal set equal; `top-14` computes 56px after `--clear`;
      0 `useState`/`useRef` on the route
- [ ] scripted cut asserted every old string exactly once; comments travelled with their code
- [ ] nothing in `HANDOVER.md` / `PRD.md` / `BACKLOG.md` touched (written at close)
