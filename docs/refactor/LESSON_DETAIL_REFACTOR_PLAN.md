# Lesson detail page — full-track refactor plan

_Stage 0 of the feature-tier refactor (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`).
`app/(admin)/lessons/[classId]/[date]/page.tsx` is the **sixth and last admin full-track giant** — after
Students (pilot), `packages` (§8.104), `invoices` (§8.106), `classes` (§8.108) and `platform` (§8.110).
Written 2026-09-18 on branch `refactor/lesson-detail`._

**The gate that governs this whole page (§7.1, the user's standing instruction):** build every stage on the
branch, but **do NOT merge to `main` until nightly `35319533916` (Admin L-D, on `33d4e82`) is green.**
When it is green AND this plan's §11 is walked: fast-forward to `main` and push via `/deploy` (decided by the
user 2026-09-18). A pure refactor — no migration, no edge function — so `/deploy` is the app-only path.

**The coach-app twin is not needed:** none of the three `lib/` modules this page moves has a `SwimSyncApp`
importer (`git grep` 2026-09-18).

---

## 1. The measure (`wc -l` / grep, 2026-09-18 — re-measure before each stage)

| Fact | Value |
|---|---|
| `page.tsx` | **912 lines** (829 page + an 82-line local `StatusButtons` component) |
| `useState` | **32** (`grep -c useState` = 33, counting the import) — the meter, one number per commit message |
| `useEffect` | **1** — the whole load, keyed on `[classId, date, validDate, reloadTick]`, with a `stale` guard across **three** awaits |
| `useMemo` / `useCallback` | 2 (`markability`, `makeupCandidates`) / 1 (`reload`) |
| `.from()` reads | `classes`, `lesson_sessions`, `coaches`, `student_class_enrolments`, `trial_bookings`, `makeup_bookings`, `class_rates`, `class_shadow_coaches`, `tenants`, `students` (11-way `Promise.all`), then `attendance`, `session_coaches`, `session_coach_absences` (3-way, only when the session exists) |
| `.from()` write | `session_coaches` `.delete()` (remove cover) |
| `.rpc()` | `assign_session_coach`, `book_makeup`, `book_trial`, `cancel_lesson`, `restore_lesson`, and **`supabase.rpc(fn, …)`** where `fn` is `cancel_trial_booking` / `cancel_makeup_booking` |
| auth | `supabase.auth.getSession()` (the actor id) |
| client-taking `lib/` helpers | `fetchMarkableFloor()` (`lib/markableFloor`), `supabaseSaveDeps()` (`lib/adminAttendanceSaveDeps`) |
| `fetch()` | none — **no `.api.ts`** |
| vitest baseline | **83 files / 806 tests** |

## 2. The target shape

```
lessons/[classId]/[date]/
  page.tsx                     # composition: 6 hooks, JSX of ui/ components. ≤ ~200 lines, 0 useState
  types.ts                     # ClassInfo, RosterRow, CoachOpt, EligibleKid (+ Attr, the attr state's shape)
  dao/
    lessonDetail.repo.ts       # the 14 .from() calls, getSession, fetchMarkableFloor bound
    lessonDetail.rpc.ts        # the 7 rpc names — header carries "orchestrate, never replace"
    lessonDetail.save.ts       # ← git mv lib/adminAttendanceSaveDeps.ts (it IS dao: the client, bound)
  domain/
    lessonMarking.ts (+.test)  # ← git mv lib/lessonMarking.ts
    adminAttendanceSave.ts (+.test) # ← git mv lib/adminAttendanceSave.ts (pure orchestration, deps injected)
    lessonDetailRows.ts (+.test)    # NEW pure mapping — class info, roster, coach list, eligible/trial kids
    useLessonDetail.ts         # the spine: load effect + every loaded value + draft + derived values + reload
    useAttendanceSave.ts       # saving, saveMsg, confirmHoliday; doSave/requestSave/setAll
    useSubstitute.ts           # coachPick/Busy/Msg; assignCoach/removeCover
    useGuestBooking.ts         # book*; doBook/requestBook/cancelBooking; makeupCandidates
    useCancelLesson.ts         # cancel*; doCancelLesson/doRestoreLesson
  ui/
    LessonState.tsx            # the Loading and the load-error returns
    LessonHeader.tsx           # back link + PageHeader + cancel/restore buttons
    CancelledBanner.tsx, NotALesson.tsx
    AttendancePanel.tsx        # Set-all, markability banner, table, save bar
    StatusButtons.tsx          # verbatim, with Top/TOP_LABEL/TOP_ACTIVE/topOf
    CoachesPanel.tsx, GuestsPanel.tsx
    CancelLessonModal.tsx, HolidayConfirmModal.tsx, BookGuestModal.tsx
```

`lib/makeupSearch` **stays** (shared with `makeups/domain/useMakeups`). `lib/markableFloor` **stays** (bound by
`lessons/dao` too). Every other `lib/` import is a shared pure helper, reached from `domain/`/`ui/`.

## 3. The slices, by state cluster

| Slice | `useState` | Handlers | Writes |
|---|---|---|---|
| **Spine** (load) | 16: `loading loadError cls sessionId cancelled roster draft coaches attr termsCoachId floor actorId holidayDays kids trialKids reloadTick` | `reload`, load effect | — |
| **Save** | 3: `saving saveMsg confirmHoliday` | `doSave requestSave setAll` | `saveAdminAttendance` |
| **Substitute** | 3: `coachPick coachBusy coachMsg` | `assignCoach removeCover` | rpc + `.delete()` |
| **Guests** | 5: `bookKind bookQuery bookKid bookHome bookBusy` + `bookError` = 6 | `doBook requestBook cancelBooking` | 4 rpcs |
| **Cancel/restore** | 4: `cancelOpen cancelReason cancelBusy cancelError` | `doCancelLesson doRestoreLesson` | 2 rpcs |

16 + 3 + 3 + 6 + 4 = **32**. ✔

**`draft` lives in the spine**, not in the save slice: the load writes it (`setDraft(Object.fromEntries(…prev))`)
and a reload must reset it in the same effect run. The save slice takes `draft`/`setDraft` as creation deps.

**`saveMsg` is written by THREE slices** (save, `doRestoreLesson`, `cancelBooking`) — the platform RISK 8 shape.
Resolution (playbook §5, "the later-created hook may depend on the earlier"): `useAttendanceSave` is created
**first after the spine** and owns `saveMsg`; `useGuestBooking` and `useCancelLesson` take `setSaveMsg` as a
creation dep. Until the save slice is extracted (it is last among the hooks, §6), `saveMsg` stays a page
`useState` and is passed the same way.

`cancelBusy` is shared between cancel and restore — one hook, so no cycle.

## 4. `lib/` verdicts — move or stay (sole-importer grep over `@/lib/<m>` AND `./<m>`, excl. tests; then the path grep)

| Module | Importers (code) | Verdict |
|---|---|---|
| `lessonMarking.ts` | this page only | **MOVE → `domain/`** with its test. Its own `./attendanceWindow` + `./lessonDates` → `@/lib/…` (playbook §5, the L-A trap). Path mentions: `tierBoundaries.drift.test.ts:335` (comment), ARCHITECTURE §10 row, TESTING §5 L600 — repoint in the same commit |
| `adminAttendanceSave.ts` | this page + `adminAttendanceSaveDeps.ts` (type) | **MOVE → `domain/` at STAGE 6, together with Deps — never before** (plan-review: moving it at Stage 1 leaves `lib/adminAttendanceSaveDeps.ts:6` importing a ROUTE folder for Stages 1–5). Test moves with it (its `./attendancePayload` → `@/lib/attendancePayload`). Its own `./attendancePayload`, `./attendanceSaveError`, `./creditNoteEmail` → `@/lib/…`. Path mentions to repoint: ARCHITECTURE.md:589 + :619, TESTING.md:598, `page.tsx:9` header comment, `adminAttendanceSave.ts:34`, `adminAttendanceSaveDeps.ts:1` |
| `adminAttendanceSaveDeps.ts` | this page only | **MOVE → `dao/lessonDetail.save.ts`**. `./creditNoteEmail`, `./supabase` → `@/lib/…`; `./adminAttendanceSave` → `../domain/adminAttendanceSave` (**type-only** import — dao importing a domain TYPE: check 2 forbids React/`ui/`/`@/components` only, so it is legal; say so in its header) |
| `makeupSearch.ts` | this page + `makeups` | STAY |
| `markableFloor.ts` | this page + `lessons/dao` | STAY, bound in `dao/lessonDetail.repo.ts` |
| `lessonDates`, `utils`, `classColours`, `attendanceCompleteness`, `lessonAttribution`, `calendarLessons` | many | STAY |

## 5. The risks, ranked by blast radius (most → least)

### RISK 1 — The save path (Stage 6). A wrong mark is a wrong invoice.
`doSave` builds `entries` (**filters `null` AND `undefined` drafts**, sends `prevStatus: r.prev`) and calls
`saveAdminAttendance({ deps: supabaseSaveDeps(), … knownSessionId: sessionId … })`. On `!ok` it reloads **only
when `res.step === "audit"`**. The success message has three branches (`sent === 0`, plural, `emailed`).
`requestSave` routes through the holiday confirm iff `holidayTransitions(…) > 0`; the confirm button **closes
first, then saves** (`setConfirmHoliday(null); void doSave()`). `setAll` skips non-editable rows and statuses
the row's kind forbids. **Pin:** the moved `adminAttendanceSave.test.ts` is unchanged (it is the save's own
characterisation); `doSave`/`requestSave`/`setAll` move **verbatim** (no reorder of `setSaving`/`setSaveMsg`);
`verify-admin-lesson-detail` checks 116–164 (holiday confirm, `Saved 3 marks`, DB statuses, audit row, CN001
refusal) after the stage. `setAll` has NO driver → hand-check.

### RISK 2 — The spine (Stage 2): one effect, three awaits, a `stale` guard, and swallowed errors.
Everything below must survive **exactly**:
- `fetchMarkableFloor()` is **started before** the `Promise.all` and awaited **last** (concurrency, not order).
- `stale` is checked after the `Promise.all`, after the session-scoped 3-way, and after the floor.
- The error chain is a `??` over **8** results in this order: cls → session → coaches → enrol → trials →
  makeups → rates → shadows. **`tenantRes.error`, `kidsRes.error`, `attRes/subRes/absRes.error` and the
  `getSession` error are NOT checked — deliberately preserved (rule 0), filed to BACKLOG as a finding.**
- `!clsRes.data` → "That class does not exist, or is not in your business." — checked **after** the chain.
- An invalid date short-circuits before any read.
- `setLoading(true)` on **every** reload (§7.249): the whole tree below the loading switch unmounts, so
  **no state may move into a `ui/` component** — every `useState` goes to a page-level `domain/` hook.
  (`StatusButtons` holds none; every modal input is controlled. Verified.)
**Pin:** the dao returns the raw `{data, error}` results as a tuple in the same order; the effect body stays in
`useLessonDetail` with the `??` chain inline; the pure mapping (§7) is characterised before the hook uses it.

### RISK 3 — The roster mapping (Stage 2): who is expected is the billing gate's union.
`expectedStudentsOn(date, spans, bookedByDate)` with `bookedByDate` = `{date → guest ids}`; `kind` = enrolled if
in `studentsEnrolledOn`, else the guest's kind **falling back to `"trial"`**; a marked-but-not-expected child is
appended with `expected:false`, name `names.get(id) ?? "Former student"` (vs `"Unknown"` for expected rows);
sort by `name.localeCompare`; guests' names **overwrite** enrolment names in `names` (guests loop runs second).
**Pin:** `lessonDetailRows.test.ts` has a case for every one of those, plus the attribution fallbacks
(`sid ?? "pending"`, `subRowId = subRes[0]?.id`).

### RISK 4 — Eligible / trial kids (Stage 2): two filters that look alike.
`kids` = active students with ≥1 **active** enrolment whose `classes` join is non-null; `trialKids` = active
students with **no** active enrolment (the `classes`-null check is NOT applied there). **Pin:** a test case for
an active enrolment with a null `classes` join — it counts against trial eligibility but not towards `kids`.

### RISK 5 — Substitute picker exclusion (Stage 4).
`excludedCoachId = termsCoachId ?? cls?.coach_id ?? null` — the DB refuses the rate-paid coach
(20260821000100). The derived trio (`excludedCoachId`, `classCoachName`, `substituteOptions`) moves as one.
**Pin:** `verify-admin-lesson-detail` 179/183 (assign → `(Sub)`, remove → back). Error branch: hand-check.

### RISK 6 — Guest booking (Stage 5): `homeClass` fallback and the reset order.
`homeClass` = the chosen home, else the only home if exactly one. `requestBook` refusals ("Choose a child.",
"Choose which class this make-up replaces.") precede the RPC. Success resets `bookKind, bookKid, bookHome,
bookQuery` then reloads. The search input's `onChange` clears kid AND home; the kid select clears home.
`makeupCandidates` memo deps `[kids, cls, bookQuery]`. **Pin:** driver 187–212 — **but it proves the `bookError` render of the RPC's refusal**
(`/is full on .*\(3 of 3\)/`, `verify-admin-lesson-detail.mjs:195`), the make-up chip and `3+1/4`, **NOT the
`full-notice` element** (read by no driver — plan-review). Full notice, trial booking, multi-home select,
cancel-booking: hand-check.

### RISK 7 — Cancel / restore (Stage 3).
Cancel button is rendered only when `!cancelled && !notALesson && isFuture && cls.is_active`; opening clears
`cancelError`. Restore clears `saveMsg`, writes its error into `saveMsg`. **Pin:** `verify-cancel-lesson` (18).

### RISK 8 — Fence mechanics (0b): a NESTED route (§7.247).
The `lessons` scope's walker already skips `[classId]/[date]` (it holds a `page.tsx`); this route needs its
**own** `SCOPE_DIRS` entry `app/(admin)/lessons/[classId]/[date]`. The `PAGES` list derives `…/page.tsx` from
it — confirm the `srcs` presence test lists it. **No transitional page→dao pins are needed**: every slice
creates its dao functions and the hook that wraps them in one commit (playbook §7.1 "fold"), so the page never
imports `dao/` in any committed state. Counts are taken from the red run at 0b and written into §6's table.

### RISK 9 — Markup renames (Stage 7): the JSX-text trap.
Use the playbook's JSX-aware check after every prop-prefix rename, **matched to the prop shape used** —
flat props `grep -nE "[a-z] p\.[a-z]+ [a-z]" ui/*.tsx`, two-level `grep -nE "[a-z] p\.[a-z]+\.[a-z]+ [a-z]" ui/*.tsx` — and the scripted verbatim diff against `git show HEAD:page.tsx`.
Name the page-level spine variable `ld` (no `.map((l) => …)` collision; the roster map uses `r`, candidates `k`, coaches `c`).

## 6. Stage-by-stage, one commit each

Gate every stage: `cd SwimSyncAdmin && npm run typecheck && npm test` (806 → +new tests). `useState` meter in
every message. Driver after the stage that touches it (§8).

| Stage | What | Meter | Driver after |
|---|---|---|---|
| **0** | This plan | 32 | — |
| **0b** | `SCOPE_DIRS` += the route; pin every check-3/-4 violation by file + snippet, each `why` naming its stage; prove checks 1–4 red (`[date]/ui/Break` → `../dao`, `[date]/dao/break` → React, `[date]/domain/break` → `fetch(`, an unpinned **`@/lib/money`** on the page — NOT `@/lib/utils`, which the page already imports and whose pin would cover a breaker), remove, 6/6 green | 32 | — |
| **1** | `types.ts` (verbatim, with comments) + `git mv` **`lessonMarking` only** (+test) into `domain/`, repoint its relative imports, the page's import, and the prose mentions (§4) | 32 | — |
| **2** | **Spine:** `dao/lessonDetail.repo.ts` (reads + getSession + `fetchMarkableFloor` bound), `domain/lessonDetailRows.ts` + characterisation test, `domain/useLessonDetail.ts` (16 states + effect + reload + derived: `today`, `validDate`, `markability`, `newRowsAllowed`, `notALesson`, `isFuture`, counts, `full`, `dirty`, `mainName`) | 16 | lesson-detail, cancel-lesson |
| **3** | Cancel/restore: `dao/lessonDetail.rpc.ts` (created; `cancel_lesson`, `restore_lesson`), `domain/useCancelLesson.ts` (takes `setSaveMsg`, `reload`) | 12 | cancel-lesson |
| **4** | Substitute: rpc `assign_session_coach` + repo `deleteSessionCoach`, `domain/useSubstitute.ts` (+ the exclusion trio) | 9 | lesson-detail |
| **5** | Guests: rpc `bookMakeup`/`bookTrial`/`cancelTrialBooking`/`cancelMakeupBooking`, `domain/useGuestBooking.ts` (+ `bookKidRow`, `homeClass`, `makeupCandidates`) | 3 | lesson-detail |
| **6** | Save: `git mv lib/adminAttendanceSave.ts` (+test) → `domain/`, `git mv lib/adminAttendanceSaveDeps.ts dao/lessonDetail.save.ts`, `domain/useAttendanceSave.ts` | **0** | lesson-detail |
| **7** | `ui/` — every component in §2, markup verbatim; page → composition; dead imports (`tsc --noUnusedLocals` filtered to the route); **both ledgers empty** | 0 | all four |
| **L4** | Full net + hand-checks (§8), screenshots named in the commit | 0 | all four |

`cancelBooking`'s RPC choice (`row.kind === "trial" ? … : …`) stays in the **hook**: the dao exposes two named
functions (`cancelTrialBooking`, `cancelMakeupBooking`) and holds no logic. Error text unchanged.

### Per-stage mitigations — walk the block for the stage you are on (folded from `/plan-review`, Fable 5.1)

#### Every stage
- ⚠ **ASSERTION:** `git grep -nE "@/app/|\(admin\)/" -- 'SwimSyncAdmin/lib/*.ts'` → **0 hits**. `lib/` never imports a route.
- ⚠ **ASSERTION:** vitest file count / test count written in the commit message; a drop = a lost test.
- ⚠ **PROHIBITION:** no transitional `./dao/` import on the page in ANY commit (each slice creates its dao + hook together).

#### Stage 0b
- ⚠ RISK 8 **STEP:** run the widened fence BEFORE pinning and record the red counts (check 3 lines; check 4
  specifiers — expected 12 `@/lib/*` + `lucide-react` = **13**, `@/lib/utils` is ONE pin covering two lines).
  `grep -c supabase page.tsx` = 24 is a hint only; the red run is the fact. **Recorded (0b, 2026-09-18): check 3 = 22 lines, check 4 = 13 specifiers on 14 lines — both as pre-agreed.**
- ⚠ **STEP:** the breaker for check 4 is `@/lib/money` (a module the page does not import).
- ⚠ **ASSERTION:** the `srcs` presence test lists `app/(admin)/lessons/[classId]/[date]/page.tsx`.

#### Stage 1
- ⚠ **PROHIBITION:** do NOT move `adminAttendanceSave.ts` here (§4). `lessonMarking` only.
- ⚠ RISK 10 **ASSERTION:** `git grep -n "lib/lessonMarking" -- ':!docs/plans' ':!docs/SESSIONS.md' ':!docs/refactor'` → 0.

#### Stage 2 (spine) — RISK 2/3/4
- ⚠ **ASSERTION:** `grep -c "if (stale) return" domain/useLessonDetail.ts` = **3**; the `??` chain has exactly
  **8** `.error` terms in page order; the effect dep array is literally `[classId, date, validDate, reloadTick]`;
  `setLoading(true); setLoadError(null)` precede the IIFE; `fetchMarkableFloor()` is called before `Promise.all`.
- ⚠ **STEP:** the dao returns the 11 raw results as a positional tuple in page order; the hook destructures with
  the page's names so the chain is a text-identical move.
- ⚠ **PROHIBITION:** `today = todayInSg()` and `validDate` stay plain per-render expressions — never
  `useState`/`useMemo`/`useRef` (a frozen `today` freezes `isFuture`/`markability` across SGT midnight).
  `reload` stays `useCallback(() => setReloadTick((t) => t + 1), [])`.
- ⚠ **ASSERTION:** `lessonDetailRows.test.ts` ≥ **12** cases incl.: enrolled child who ALSO has a guest booking
  → `kind:"enrolled"`, `bookingId:null`; unknown guest kind → `"trial"`; former student `expected:false`,
  "Former student"; guest name overwrites enrolment name; sort; `prev` from marks; an active enrolment with a
  null `classes` join (excluded from `kids`, still blocks `trialKids`); capacity fallback; `"Unknown coach"` + sort.
  Header says characterisation. vitest = 84 files after this stage.

#### Stage 3 (cancel/restore) — RISK 7
- ⚠ **ASSERTION:** `doRestoreLesson` calls `setSaveMsg(null)` before the rpc; the cancel open-button still does
  `setCancelError(null); setCancelOpen(true)`.
- Driver `verify-cancel-lesson` 18/18 — note only ~10 checks are on this route (`:96-104` are `/classes`,
  `:112-150` the coach app).

#### Stage 4 (substitute) — RISK 5
- ⚠ **PROHIBITION:** `removeCover` does NOT clear `coachMsg` before the delete (unlike `assignCoach`) — move
  verbatim, do not "tidy" it.
- ⚠ **ASSERTION:** `excludedCoachId`, `classCoachName`, `substituteOptions` are three consecutive lines in that
  order in `useSubstitute.ts`; the migration-reference comment moves with them.

#### Stage 5 (guests) — RISK 6
- ⚠ **PROHIBITION:** `setBookError(null)` stays in the two open-button `onClick`s, not inside a hook setter.
- ⚠ **ASSERTION:** `makeupCandidates` memo deps literal `[kids, cls, bookQuery]`; success reset order
  `setBookKind(null); setBookKid(""); setBookHome(""); setBookQuery("")` then `reload()`.

#### Stage 6 (save) — RISK 1
- ⚠ **ASSERTION:** `git diff -M HEAD --stat` shows both `adminAttendanceSave*.ts` and the test as RENAMES; the
  test's content diff is the single `./attendancePayload` → `@/lib/attendancePayload` line.
- ⚠ **ASSERTION:** `doSave`/`requestSave`/`setAll` bodies equal `git show HEAD:page.tsx` (whitespace-stripped).
- ⚠ **PROHIBITION:** no `useCallback`/`useMemo` around `doSave`/`requestSave`/`setAll`; `setSaving(false)`
  stays before either `setSaveMsg`.
- ⚠ **ASSERTION:** page hook order is spine → `useAttendanceSave` → substitute → guests → cancel, with
  `setSaveMsg` a creation dep of the last two.
- ⚠ RISK 10 **ASSERTION:** `git grep -n "lib/adminAttendanceSave" -- ':!docs/plans' ':!docs/SESSIONS.md' ':!docs/refactor'` → 0.

#### Stage 7 (ui) — RISK 4/9
- ⚠ **ASSERTION:** each driver-read string in §9 occurs in `ui/*.tsx` and **0** times in `page.tsx`.
- ⚠ **ASSERTION:** `grep -c useState ui/*.tsx page.tsx` → all 0 (§7.249 — `Modal` returns `null` when closed,
  so every input must stay hook-controlled).
- ⚠ **STEP:** the scripted verbatim diff per `ui/` file against `git show HEAD:page.tsx`, then the JSX-text grep.
- ⚠ **STEP:** `npx tsc --noEmit --noUnusedLocals | grep 'lessons/\[classId\]'` → 0.

## 7. The pure mapping, and its characterisation test

`domain/lessonDetailRows.ts` — pure, no React, no client:
- `classInfoFrom(row)` — the `ClassInfo` build (capacity falls back to the category default; `is_active !== false`).
- `coachListFrom(rows)` — map + `"Unknown coach"` + sort.
- `buildRoster({ date, enrolments, trials, makeups, marks })` → `RosterRow[]` (RISK 3).
- `eligibleKidsFrom(rows)` / `trialKidsFrom(rows)` (RISK 4).
- the attribution call stays in the hook (it is a `lib/` call with already-shaped inputs, no mapping).

The test header says: **characterisation — pins existing behaviour; §7.25's prove-red does not apply.**

## 8. The driver net — re-derived by grep (§7.236), not by name

`grep -lE 'lessons/' verify-*.mjs` → six hits; reading them, **four** open this page:

| Driver | Checks | What it proves here |
|---|---|---|
| `verify-admin-lesson-detail` | 27 (runtime; grep says 28 — the cleanup check is written twice, try + catch) | load, roster, save + holiday confirm + audit + CN001, floor banner, not-a-lesson, substitute assign/remove, FULL, make-up booking |
| `verify-cancel-lesson` | 17 (runtime; same try/catch double) | cancel modal (reason gate), banner, save/booking disabled, restore |
| `verify-admin-calendar` | 21 | double-click → this route (URL only) |
| `verify-smoke-admin` | 2 | `goto` this route; **`h1` EXACTLY equals the class title** (`"Saturday Beginners"`, `:153`) — the loading-state `"Lesson"` fails it, so the PageHeader title span moves verbatim |

(`verify-packages`, `verify-parent-attendance` match on prose — "9 lessons", "No absent lessons" — not the route.)
None hardcode ports that matter here (root checkout, `:3000`/`:8081`).

### Uncovered actions → hand-check with a screenshot, and file the driver

0. **`full-notice`** renders inside the Book modal on a 3/3 lesson ("This lesson is full (3/3)…").
1. Book a **trial** (trial child select → Book → row with Trial chip) and **Cancel booking** on it.
2. **Set all** → Present (non-editable rows untouched).
3. Cancelled sub-reasons **Rain/Coach** and trial **Paid/Free** toggles.
4. Make-up for a child with **two homes** → "Which class…" select + its refusal text.
5. Error states: invalid date (`/lessons/<id>/2026-13-99`), unknown class id, assign-substitute failure message.
6. Cancel modal **Keep the lesson** closes without writing.

→ BACKLOG: `verify-lesson-detail-guests` (trial booking, cancel booking, Set all, multi-home).

## 9. What this refactor does NOT change

The save path's steps and messages; the swallowed-error set (RISK 2); `Alert`-free UI; every `data-testid`,
`data-*` and `aria-label`. **Driver-read on THIS route** (corrected at plan-review): testids `save-attendance`,
`lesson-count`, `roster-row`, `cancel-lesson`, `cancel-reason`, `confirm-cancel-lesson`, `restore-lesson`,
`confirm-holiday`, `book-guest`, `markability`, `not-a-lesson`, `lesson-cancelled`, `save-message`; attributes
`data-student`, `data-status`; labels `Substitute coach`, `Child`; text `Teaching:`, `(Sub)`, `Make-up`,
`Remove substitute`, `Book a make-up into this lesson`, `Saved N marks`, the class-title `h1`.
(`full-notice` and `cancel-error` are NOT driver-read here — `cancel-error` is read only on `/classes`'s modal.
They still move verbatim.) the URL shape; the §7.64 rule (addressed by
`(classId, date)`, never a session id).

## 10. Accepted consequences

- No served-bundle grep is possible (§7.31) — CI + drivers are the deploy check.
- `git blame` on moved lines points at the refactor commits; `git log --follow` works per `git mv`.
- `getSession()` moves into the dao inside the same `Promise.all` — no `try` boundary moves (there is none).

## 11. The gate before `main`

1. Every stage committed with its gate result; both ledgers empty; page ≤ ~200 lines, 0 `useState`.
2. L4: all four drivers green on the finished page + the 6 hand-checks with screenshots.
3. **`gh run view 35319533916` → `conclusion: success`.** If red: triage per `docs/TESTING.md` §5 first; this
   branch does not merge onto a red L-D.
4. `/deploy` (app-only path) → fast-forward `main`, push, confirm both Vercel deploys, then trigger a nightly on
   the new `main` — it is the gate for the NEXT unit.

## 12. Findings for `/update-docs`

- **`/plan-review` (Fable 5.1) found 6 factual errors**, all verified by hand before folding in: a check-4 breaker
  the existing pin would have covered (`@/lib/utils`), a testid list with 2 wrong + 2 missing, the driver's FULL
  check misattributed (it reads the RPC refusal, not `full-notice`), the smoke driver's exact-h1 rule, an
  incomplete path-mention list, and a Stage 1/6 split that would have made `lib/` import a route folder.
- Candidate gotcha: *a `lib/` pair split across stages makes `lib/` import a route* — the playbook's sole-importer
  rule checks who imports the module, not what the module's own siblings import back.
- BACKLOG: the load's swallowed errors (`tenants`, `students`, `attendance`, `session_coaches`,
  `session_coach_absences`, `getSession`) — preserved here under rule 0.
- BACKLOG: `verify-lesson-detail-guests` (trial booking, cancel booking, Set all, multi-home, full-notice).

## 13. PRE-COMMIT GATE — walk before EVERY stage commit

**The four that matter most:**
- [ ] typecheck + vitest green; file/test counts in the message; `useState` meter in the message
- [ ] `lib/` imports no route (the every-stage grep)
- [ ] the stage's ⚠ block in §6 walked, every assertion ticked with its value
- [ ] the stage's driver run green (Stages 2–7), on a warm dev server (§7.108)

**Then:**
- [ ] no page→`dao/` import; ledgers only shrank (the shrink test is green)
- [ ] comments travelled with their code; no reflow, no rename inside moved markup
- [ ] Stage 7/L4 only: all four drivers + the 7 hand-checks with screenshots named in the commit
- [ ] before `main`: `gh run view 35319533916` = **success** (§11)
