# Attendance save tests — Wave 2 lane 2

_Planned 2026-10-01 via `/plan-with-confidence` (resumed from §8.133). Decisions settled with the user the same
day. Hardened by `/plan-review` 2026-10-02 — every `⚠ RISK n MITIGATION` is a finding folded into the step it
governs. **Tests only — no app code, no migration, no deploy.**_

> ⚠ **This plan contains a STOP at Step 3.** Review found a live bug: Set all drops a holiday row's state
> (`lib/attendanceBulk.ts` `applyBulkStatus` never reads `current`; confirmed in the main thread 2026-10-02).
> Step 3 says what to run and what to ask the user. Do not resolve it yourself.

`BACKLOG.md` → *Deeper component-render tests*, the attendance-save slice (Wave 2 lane 2). The marking screen's
**save path** (`features/mark-attendance/domain/useSaveAttendance.ts`) has no test of its own: its pure helpers
are pinned in `lib/` and the nightly `verify-coach-marking` driver walks it end to end, but nothing fast and local
fails when the hook's orchestration changes. **A wrong mark is a wrong invoice.**

## Decisions (user, 2026-10-01)

| # | Question | Decision |
|---|---|---|
| D1 | Test layers | **Both** — hook tests via `renderHook`, plus whole-screen tests (§8.133) |
| D2 | Save behaviours to pin | **Guards + payload**, **right lesson**, **failure paths**, **credit-note + order** |
| D3 | Screen tests | **Happy save**, **incomplete blocks**, **set-all → save** (3) |
| D4 | Set-all depth | **Hook + screen** — a new `useMarking` hook test *and* the set-all screen test |
| D5 | Pending charges two-tenant test (PARTIAL_PAYMENT RISK 6) | **Out → Wave 3** (lives on the admin Invoices page Wave 3 renders) |
| D6 | `useAttendanceLoad.test.ts` | **Port to `renderHook`**, re-proven red against the cancelled-lesson bug |
| — | Read-only role screen test | **Not added** — `screenState.test` + `StudentMarkList.test` already pin it, and the DB refuses a non-owner write |
| D7 | Set-all holiday bug (Step 3 STOP) | **A (user, 2026-10-02)** — a `fix/setall-holiday` lane lands on `main` FIRST (strict test (b) red→green, own `/commit-review`, app deploy); this lane then runs with (b) and screen test 3 green |
| D8 | Gotchas to graduate | **Three (user, 2026-10-02):** `git checkout <rev> --` stages; holiday dropped + assert `toEqual` not `not.toBe`; jest renders through `load()` read the real clock. Next free numbers from §7.311, appended at lane close. (Not: "wait on Save Attendance".) |

## Constraints

- **`jest.config.js` `testMatch` covers `lib/**` and `features/**` only — NOT `app/**`.** The screen test lives in
  `features/mark-attendance/` and imports the route; do not widen `testMatch` (a stray `app/` test file would start
  running unannounced).
- **Every test is mutation-proven (§7.25)**: mutate the *source*, run, see red **for the named reason**, restore.
  Each file records its mutations in its header, the house style of `StudentMarkList.test.tsx`.
- **Mock at the dao seam** (`../dao/markAttendance.repo`, `../dao/markAttendance.rpc`) — never `@/lib/supabase`.
  The dao modules are the hooks' only network boundary by design (COACH_ATTENDANCE_REFACTOR_PLAN Stage 3).
- **Do not touch app source.** If a test needs a seam that doesn't exist, stop and raise it — a test-only lane that
  edits `useSaveAttendance.ts` is a different lane.
- NativeWind `className` is a raw prop under jest (§7.285). A green press here says nothing about the drivers
  (§7.286).
- **jest-expo's `Platform.OS` is `ios`**, so `confirmAction` calls `Alert.alert`. Mock `@/lib/confirm` (record +
  invoke/skip `onConfirm`) rather than poking `Alert`.
- No nightly gate: this lane changes no app unit (HANDOVER §9 *GATE*). Nightly is not dispatched (CLAUDE.md).

## Steps

Branch: `test/attendance-save` off `main`. No worktree — lane 1 has shipped, nothing runs beside it.

> **As built (2026-10-02):** stacked on `fix/setall-holiday` (`d45e84d`) at the user's request — run the lane
> without deploying the fix. Baseline was therefore taken on the fix branch: **56 suites / 613 tests**
> (`useMarking.test.ts` already existed there with 2 tests). End state **58 / 642**, predicted before the run.
> `scope-check.sh` defaults its BASE to `fix/setall-holiday`. Both branches reach `main` together, after the
> nightly gate (the fix is an app unit).

### 0. Baseline and the two lane scripts (before any test is written)

1. On `main`, from `SwimSyncApp/`: `npm test 2>&1 | tail -5` → record **suites S₀ / tests T₀** in the scratchpad.
   Then `npx jest features/mark-attendance/domain/useAttendanceLoad.test.ts --verbose` → record the **two exact
   test names** (expected: `1. resolves the date, so the spinner gives way to the notice`,
   `2. names the LOADED class, not the stale classTitle state`). At review: `features/mark-attendance` = 10 suites,
   49 tests, all green. If the baseline is red, stop and work out why before adding anything.

2. ⚠ RISK 1 MITIGATION — **write `mutate.sh` in the session scratchpad (never committed).** Every mutation proof in
   this lane, including the `61426c8^` re-proof, goes through it. No hand edits to source.
   ```bash
   #!/usr/bin/env bash
   # mutate.sh <src rel. to SwimSyncApp> <test file> <substring the red output MUST contain> perl '<perl -0pi expr>'
   # mutate.sh <src> <test> <substring> rev <git-rev>
   set -euo pipefail
   cd /Users/kahhang/Documents/Code/SwimSync/SwimSyncApp
   src=$1 test=$2 want=$3 mode=$4 arg=$5
   out="$(dirname "$0")/mutate.out"
   git diff --quiet HEAD -- "$src" || { echo "REFUSE: $src already differs from HEAD"; exit 2; }
   trap 'git checkout HEAD -- "$src"; git diff --quiet HEAD -- "$src" || { echo "RESTORE FAILED: $src"; exit 3; }' EXIT
   case $mode in
     perl) perl -0pi -e "$arg" "$src" ;;
     rev)  git show "$arg:SwimSyncApp/$src" > "$src" ;;   # worktree only — NEVER stages
   esac
   git diff --quiet HEAD -- "$src" && { echo "MUTATION DID NOT APPLY: $arg"; exit 2; }
   if npx jest "$test" >"$out" 2>&1; then echo "GREEN UNDER MUTATION — not coverage"; exit 1; fi
   grep -qF -- "$want" "$out" || { echo "RED FOR THE WRONG REASON (no '$want')"; tail -40 "$out"; exit 1; }
   echo "RED as required: $want"
   ```
   **Do NOT use `git checkout <rev> -- <path>`** anywhere in this lane. It stages the old content, and then
   `git checkout -- <path>` restores from that index and `git diff --exit-code` (working tree vs index) reads
   clean while the regression is staged. Restore is always `git checkout HEAD -- <path>`, and the check is
   always against `HEAD`.
   **Self-test before use:** run it once with a known-killing mutation on an existing file
   (`features/mark-attendance/ui/SetAllMenu.tsx`, `{menuOpen && (` → `{(menuOpen || true) && (`, want
   `renders nothing while closed`) → must print `RED as required`. Then `git status --porcelain` must be empty.

3. ⚠ RISK 1 / RISK 9 MITIGATION — **write `scope-check.sh` in the scratchpad.** It is the lane's only definition
   of "no source changed", and it must be able to fail:
   ```bash
   #!/usr/bin/env bash
   # scope-check.sh [BASE]   — BASE defaults to main; use origin/main immediately before push
   set -euo pipefail
   cd /Users/kahhang/Documents/Code/SwimSync
   BASE=${1:-main}
   ALLOW='^(SwimSyncApp/features/mark-attendance/testing/saveHarness\.ts|SwimSyncApp/features/mark-attendance/domain/useSaveAttendance\.test\.ts|SwimSyncApp/features/mark-attendance/domain/useMarking\.test\.ts|SwimSyncApp/features/mark-attendance/MarkAttendanceScreen\.test\.tsx|SwimSyncApp/features/mark-attendance/domain/useAttendanceLoad\.test\.ts|docs/plans/ATTENDANCE_SAVE_TESTS_PLAN\.md)$'
   files=$( { git diff --name-only "$BASE"...HEAD; git diff --name-only --cached; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep . || true)
   echo "scope-check vs $BASE: $(printf '%s\n' "$files" | grep -c . || true) changed path(s)"
   bad=$(printf '%s\n' "$files" | grep -vE "$ALLOW" | grep . || true)
   if [ -n "$bad" ]; then echo "OUT OF SCOPE:"; echo "$bad"; exit 1; fi
   echo "scope OK"
   ```
   Self-test: `touch SwimSyncApp/lib/zz.ts && scope-check.sh` → must exit 1 naming it; `rm SwimSyncApp/lib/zz.ts`.
   **Prohibition:** do NOT add a path to `ALLOW` to clear a red. A red here means source changed: stop.
   (`jest.config.js` is deliberately not in `ALLOW`, so widening `testMatch` also turns this red.)

### 1. Shared harness — `features/mark-attendance/testing/saveHarness.ts`

A small builder, not a framework: `students()` / `attState()` factories, a dao mock recorder that logs **every call
in order** (`calls: {fn, args}[]`) so order assertions read the log, and default resolved values for every
`markAttendance.repo` / `.rpc` export. Store mock: `session: { id: "profile-1" }`, `showToast` as a `jest.fn()`.
Not a test file (no `.test.`), so `testMatch` ignores it.

- ⚠ RISK 6 MITIGATION — **the mock surface is type-complete, so a missing export fails `tsc`.** Import the dao
  modules with **`import type * as Repo from "../dao/markAttendance.repo"`** (and `Rpc`) only, and declare
  `repoMock: { [K in keyof typeof Repo]: jest.Mock }` (same for `rpcMock`). A dao export added later without a
  default then fails `npm run typecheck`, not a test at runtime.
  **Prohibition:** the harness must NOT have a runtime (value) import of either dao module or of `@/lib/supabase`.
  Check by reading: every dao import line starts `import type`.
- ⚠ RISK 6 MITIGATION — **defaults match the real return shapes, read from `dao/*.ts`**:
  - PostgREST builders resolve `{ data, error }`: `loadCoachRecord` → `{ data: { id: "coach-1" }, error: null }`,
    `loadSessionId` → `{ data: null, error: null }`, `createSession` → `{ data: { id: "sess-new" }, error: null }`,
    and `upsertAttendance` / `upsertAbsences` / `deleteAbsences` / `insertAuditLog` → `{ error: null }`.
  - Load-side defaults: `loadClass`, `loadMyCoach`, `loadSession`, `loadMyRosterRow`, `loadAttendance`,
    `loadTrialBookings`, `loadMakeupBookings`.
  - RPC side: `isActiveClassShadow` → `{ data: false }` and `sessionShadowCoaches` → `{ data: [] }`.
    **`isMainOnSession` resolves a bare boolean** (`true`), because it wraps `fetchIsMainOnSession`.
    **`fetchFloor` resolves `null`**, and `notifyCreditNotes` → `undefined`.
- ⚠ RISK 3 / RISK 6 MITIGATION — **one singleton store, one log.**
  - `harness.store = { session: { id: "profile-1" }, showToast }`, where `showToast` is a single module-level
    recorder fn that also pushes `{fn: "showToast", args}` onto `calls`.
  - `harness.leaveScreen()` pushes `{fn: "leaveScreen"}`.
  - `harness.confirm` records `{title, message, onConfirm, label}` and **does NOT invoke `onConfirm` by default**.
    A test that wants confirmation calls the recorded `onConfirm` itself.
  - `resetHarness()` (called in each file's `beforeEach`) empties `calls` and confirm records and reinstalls
    every default implementation. It must not rely on `mockResolvedValue` surviving.
  - **Prohibition:** no `jest.resetModules()` / `jest.isolateModules()` in these files (they split the
    singleton from the instance the mocks hold), and no `resetMocks`/`clearMocks` config change.
- ⚠ RISK 3 MITIGATION — **helpers that cannot pass vacuously:**
  - `runSave(result)`: `await act(async () => { await result.current.handleSave(); })`, then returns a frozen
    copy of `calls`. **Prohibition:** no `.catch`/`try` around `handleSave` in any test. A thrown TypeError must
    turn the test red.
  - `expectNoWrites(calls)` checks that none of `createSession, upsertAttendance, upsertAbsences, deleteAbsences,
    insertAuditLog, notifyCreditNotes, leaveScreen` is in `calls`. It **throws if `calls` holds no `showToast`
    entry** ("a guard test with no toast never reached the guard").
  - `expectIdNeverSent(calls, id)`: `JSON.stringify` of every entry's args must not contain `id`.
  - `deferred<T>()`: `{ promise, resolve }` for held-pending dao calls.
- ⚠ RISK 6 MITIGATION — **wiring pattern, the same in all three new files.** Each test file declares:
  ```ts
  jest.mock("<rel>/dao/markAttendance.repo", () => require("<rel>/testing/saveHarness").repoMock);
  jest.mock("<rel>/dao/markAttendance.rpc",  () => require("<rel>/testing/saveHarness").rpcMock);
  jest.mock("@/store/useAppStore", () => ({ useAppStore: (sel: any) => sel(require("<rel>/testing/saveHarness").store) }));
  jest.mock("@/lib/confirm", () => ({ confirmAction: (...a: any[]) => require("<rel>/testing/saveHarness").confirmAction(...a) }));
  jest.mock("@/lib/supabase", () => new Proxy({}, { get: (_t, p) => { throw new Error(`test reached @/lib/supabase.${String(p)} — mock the dao seam`); } }));
  ```
  The last line is a **tripwire, not a seam**: it guarantees no unmocked path ever builds a real client (a local
  `.env` would otherwise let one talk to the dev database).

### 2. `domain/useSaveAttendance.test.ts` — the hook (D2)

`renderHook(() => useSaveAttendance(props))`, `await act(() => result.current.handleSave())` (via `runSave`).
`setResolved` is a `jest.fn`; `leaveScreen` is `harness.leaveScreen`. One **happy fixture** (two children marked
present on `resolved = { date: DATE, sessionId: "sess-1" }`, no shadows, `loadedStatuses = { current: {} }`). Every
other case is **derived from it by one change**.

⚠ RISK 3 MITIGATION — **positive control first.** The first test is the happy save. It asserts:
- `upsertAttendance` is called once with exactly
  `[{lesson_session_id:"sess-1", student_id, status:"present", marked_by:"profile-1", last_edited_by:"profile-1"} ×2]`;
- the success toast;
- `leaveScreen` is called once;
- `result.current.saving === false`.

Every "not called" assertion below is about a fixture one change away from this one. **Prohibition:** a guard
case may not build its own fixture from scratch (§7.111: a fixture that never reaches the branch passes for free).

**Guards + payload**
- An unmarked child → error toast **naming that child** (`Please mark attendance for <name>.`);
  `expectNoWrites(calls)`; `saving === false`.
- A cancelled top with `sub: null`, and separately a trial top with `sub: null` → `Please select a sub-type for
  <name>.`; `expectNoWrites`.
- A holiday row needs no mark, and is **absent from the `upsertAttendance` payload**; every other row present.
  Assert payload `student_id`s equal exactly the non-holiday ids.
- Every row in the payload has identical keys (`hasUniformKeys`) — the §7.67 regression at the hook level. Use a
  fixture with mixed statuses (present, absent, cancelled_rain, trial_paid) so the rows actually differ.
- ⚠ RISK 3 MITIGATION — **`saving` can be seen true.** Hold `loadCoachRecord` on a `deferred`, start
  `handleSave` without awaiting, then `await waitFor(() => expect(result.current.saving).toBe(true))`. Resolve it,
  await, and expect `false`. Without this, "`saving` never left true" on the guard path passes because `saving`
  never changes at all.

**Right lesson (§7.64)**
- `resolved` for **this** date → upsert on that id; `loadSessionId`/`createSession` never called.
- `resolved` for **this** date with `sessionId: null` (`kind: "create"`) → `createSession(id, DATE)` called;
  `loadSessionId` **not** called.
- `resolved` for **another** date (`{date: OTHER, sessionId: "sess-stale"}`) → `loadSessionId(id, DATE)`
  resolving `{ id: "sess-1" }`. Its id is used, and **`expectIdNeverSent(calls, "sess-stale")`** holds across
  upsert, audit, absences and notify. That is the full meaning of "the stale one is never sent".
- Stale, and no existing session → `createSession(id, date)`, and rows carry the new id; `setResolved` gets
  `{ date, sessionId: <new> }`.
- `createSession` errors (`{ data: null, error: { message: "x" } }`) → "Could not create session record.";
  no upsert; `saving` false; `leaveScreen` not called.
- `loadCoachRecord` returns `{ data: null }` → "Could not find coach record."; `expectNoWrites`.

**Failure paths**
- Upsert fails with `code: "CN001"` → toast equals `attendanceSaveErrorMessage("CN001")` **and is not equal to**
  `attendanceSaveErrorMessage(undefined)`. No absences, no audit, no notify; `leaveScreen` not called;
  `saving` false.
- Absence write fails → the "Attendance saved, but the coaches-present list did not: …" toast, **and** the save
  still completes (success toast + `leaveScreen`).

**Credit-note + order**
- Loaded `present` → saved `absent_*`/`cancelled_*` → `notifyCreditNotes(finalSessionId)` called.
  ⚠ RISK 3 MITIGATION: set `loadedStatuses.current = { s1: "present" }` **after** `renderHook` and before
  `runSave`, mirroring the real order (load() fills the ref after first render). This pins "read at save time".
- No billable status left (`absent` → `absent`, or first mark with `current = {}`) → **not** called.
  Same fixture as the case above with only the before-status changed.
- Order from the call log: `upsertAttendance` < absence writes < `insertAuditLog` < `notifyCreditNotes` <
  `showToast("Attendance saved.")` < `leaveScreen`.
- ⚠ RISK 3 MITIGATION — **the "awaited" pin (RISK 9 of CREDIT_NOTE_EMAIL_PLAN) must be able to fail.**
  Hold `notifyCreditNotes` on a `deferred` and start `handleSave` un-awaited. Then:
  1. `await waitFor(() => expect(notify).toHaveBeenCalled())`, so the hook has reached the call.
  2. Flush: `await act(async () => { await Promise.resolve(); await Promise.resolve(); })`.
  3. Assert `leaveScreen` is not called and `saving === true`.
  4. Resolve the deferred and await; assert `leaveScreen` is called.

  Resolve the deferred in a `finally` so a red run does not leak a pending promise.
- Absences: a shadow ticked absent → `upsertAbsences` with `lesson_session_id === finalSessionId`. Ticked
  present → `deleteAbsences(finalSessionId, [coach_id])`. No shadows → neither called.
- ⚠ RISK 8 MITIGATION — **Prohibition:** do NOT pin the relative order of `deleteAbsences` vs `upsertAbsences`
  (both are started inside one `Promise.all`; their order is incidental). Do NOT pin `new_value.student_count`
  beyond `students.length` as passed.

⚠ RISK 3 MITIGATION — **required mutation proofs** (via `mutate.sh`, source
`features/mark-attendance/domain/useSaveAttendance.ts`). Each must print `RED as required`, with the substring
being the **name of the test meant to catch it**. Record all of them in the file header:

| # | Mutation | Must redden |
|---|---|---|
| M1 | delete `if (state?.top === "holiday") continue;` | holiday-row test |
| M2 | `.filter((student) => attendance[student.id].top !== "holiday")` → `.filter(() => true)` | holiday absent from payload |
| M3 | ~~`decision.kind === "use" ? decision.sessionId : null` → `resolved?.sessionId ?? null`~~ **equivalent mutant** (the stale branch overwrites it on every path) — **replaced by** `resolveSessionForDate(resolved, date)` → `(resolved, resolved?.date ?? date)` | stale-date / never-sent |
| M4 | `if (decision.kind === "stale") {` → `if (false) {` | stale → `loadSessionId` |
| M5 | `await notifyCreditNotes(` → `notifyCreditNotes(` | the awaited pin |
| M6 | `mayHaveIssuedCreditNote(loadedStatuses.current,` → `mayHaveIssuedCreditNote({},` | credit-note called |
| M7 | `(upsertError as { code?: string }).code` → `undefined` | CN001 toast |
| M8 | the `return;` after the CN001 `setSaving(false);` → removed | CN001 no audit / no leave |
| M9 | `if (delRes.error \|\| insRes.error) {` → `if (false) {` | absence-failure toast |
| M10 | `deleteAbsences(finalSessionId,` → `deleteAbsences(id,` | ticked-present absences |
| M11 | `if (!coach) {` → `if (false) {` | coach-null |
| M12 | the `setSaving(false);` inside the `sessionError \|\| !newSession` branch → removed | createSession-errors (`saving` false) |
| M13 | `setResolved({ date, sessionId: finalSessionId });` → `sessionId: null` | stale + no session → `setResolved` |

A mutation that comes back **green** means its test is vacuous. Fix the test, never the mutation list.

### 3. `domain/useMarking.test.ts` — set-all rules (D4)

Drive `setAttendance` with a real `useState` inside the `renderHook` callback, so updater functions run for real:
`renderHook(() => { const [att, setAtt] = useState(init); return { att, ...useMarking(students, att, setAtt) }; })`.
Call `result.current.onSetAll(...)` **after** any `rerender`, because `anyMarked` reads that render's closure.

- `onSetAll` on an all-unmarked roster applies **without** `confirmAction`; every child gets the option.
  ⚠ RISK 7 MITIGATION: this roster has **no holiday child**. A holiday row's `top` is `"holiday"`, not
  `"unmarked"`, so `anyMarked` is true and the confirm path runs instead.
- Any child already marked → `confirmAction` called once with title `Set all to <label>?`. **Nothing is applied
  until the test invokes the recorded `onConfirm`**; after it, every child carries the option.
- `setTop` clears `sub`; `setSub` keeps `top`.
- **A holiday row is never re-marked by set-all** (the §7.67 whole-batch failure). This is two separate tests:
  - **(a) "set-all never writes the option onto a holiday row"**: `expect(att[h]?.top).not.toBe(opt.top)`.
    Green today, and it pins the filter (mutation U1).
  - **(b) "set-all leaves a holiday row's state intact"**: `expect(att[h]).toEqual({ top: "holiday", sub: null })`.

⚠ RISK 2 MITIGATION — **STOP GATE.** Review found that (b) is **red on current code**. `applyBulkStatus`
(`lib/attendanceBulk.ts`) returns only the ids it is given, and `useMarking` replaces the whole map with that
result, so the holiday child's entry is deleted. On the screen it then shows "Not yet marked" with buttons, and
Save refuses ("Please mark attendance for <holiday child>"). If the coach marks the child, the DB guard refuses the
row and the whole batch fails (§7.67). Recovery is leaving and reopening the lesson.
1. Write (b) strict and run it. **Expected RED.** If it is green, the review was wrong; continue normally.
2. If red: **stop and ask the user**, with these options (do not choose):
   - **A.** A separate `fix/setall-holiday` lane lands first: a fix on `main` proven by (b), with its own review
     and deploy. This lane then continues with (b) and screen test 3 green.
   - **B.** This lane lands (b) as `it.failing(...)` and screen test 3 as `it.failing(...)`, each with a header
     line naming the bug, and the bug goes in BACKLOG at `/update-docs`. `it.failing` goes red the day the bug is
     fixed, which forces the test to be flipped.
3. **Prohibitions** (for whichever option the user picks):
   - Do NOT edit `useMarking.ts` or `lib/attendanceBulk.ts` in this lane.
   - Do NOT write (b) as `not.toBe(...)`, `?.top !== ...` or any assertion that passes when the key is absent.
   - Do NOT present (a) as covering (b).
   - Do NOT pin "a holiday roster always prompts confirm" (incidental, see RISK 8).

⚠ RISK 3 MITIGATION — required mutation proofs (source `features/mark-attendance/domain/useMarking.ts`):

| # | Mutation | Must redden |
|---|---|---|
| U1 | `.filter((s) => prev[s.id]?.top !== "holiday")` → `.filter(() => true)` | test (a) |
| U2 | `if (anyMarked) {` → `if (false) {` | "already marked → confirm" |
| U3 | `[studentId]: { ...prev[studentId], top, sub: null },` → `[studentId]: { ...prev[studentId], top },` | `setTop` clears `sub` |

### 4. `MarkAttendanceScreen.test.tsx` — the whole screen (D3)

In `features/mark-attendance/`, importing `@/app/(coach)/classes/[id]/attendance`. Mocks: `expo-router`
(`useLocalSearchParams` → `{ id, date, from }`, `router.replace` spy), both dao modules (load **and** save
exports, defaults from the harness), the store, `@/lib/confirm`.

- ⚠ RISK 5 MITIGATION — **pin the clock; never read it.** `load()` calls `todayInSg()` into `checkMarkableDate`,
  so a literal date with the real clock either renders the blocked screen ("hasn't happened yet") or expires
  later (§7.303 in jest; `scripts/check-test-dates.sh` does not scan jest). Use:
  ```ts
  jest.mock("@/lib/lessonDates", () => ({ ...jest.requireActual("@/lib/lessonDates"), todayInSg: () => "2026-09-05" }));
  ```
  - `DATE = "2026-09-05"`, and the class fixture's `day_of_week` is `dayOfWeekOf(DATE)` (it is `"saturday"`,
    lowercase; never `6`).
  - Enrolments carry `enrolled_at: "2026-01-01T00:00:00+08:00"` (offset spelled, §7.227).
  - **Prohibitions:** do NOT use `jest.useFakeTimers`/`setSystemTime` for this (it fights RNTL's
    `findBy`/`waitFor`). Do NOT derive `DATE` from `new Date()` (§7.7).
- ⚠ RISK 7 MITIGATION — **4a. spike first (≤30 min).** A throwaway `it` that renders the route with the mocks and
  awaits `findByText("Save Attendance")`.
  - If it cannot be made to render the roster without touching `app/`, **stop and raise it**. Do NOT add a
    `testID`, an export or a prop to the route or a `ui/` file. Delete the spike once tests 1–3 exist.
  - Wait on **`"Save Attendance"`** (only the markable roster has it), never on the class title. The header
    renders `"{title} · {date}"` in one Text (an exact `findByText(title)` never matches), and `BlockedLesson`
    shows the title too.
  - Assertion, in a helper `renderMarkable()`:
    `expect(screen.queryByText(/hasn't happened yet|is closed|isn't a lesson day|cancelled/)).toBeNull()`.
  - Default load fixture: an **existing** session `{ id: "sess-1", cancelled_at: null }` and `isMainOnSession → true`.
- ⚠ RISK 7 MITIGATION — **scoped presses.** "Present" appears once per child card and again in the open Set all
  menu. Copy `StudentMarkList.test.tsx`'s `card(name)` helper into this file (do NOT edit that file) and press
  `card("Anna Tan").getByText("Present")`. For Set all: press `getByText("Set all")`, then the menu option. With
  the menu open, use `getAllByText("Present")` and take the **last** (SetAllMenu renders last). Then assert
  `onSetAll`'s effect, not the press.
- ⚠ RISK 3 MITIGATION — **async discipline.**
  - Success assertions use `await waitFor(...)`.
  - Every negative assertion comes after a positive one in the same test (proving `handleSave` ran) and after
    `await act(async () => {})`.

Then:
1. **Happy save** — two children, press each one's status, press *Save Attendance* →
   - `upsertAttendance` rows equal exactly `[{student, status}…]` on `sess-1`;
   - success toast;
   - `router.replace` is called with the **literal** `"/(coach)/schedule"` (`from` unset).
2. **Incomplete blocks** — mark one of two, press Save → toast names the unmarked child (the positive proof that
   `handleSave` ran); `upsertAttendance` never called; `router.replace` never called; the Save button is still on
   screen.
3. **Set-all → save** — seed a holiday child (`loadAttendance` → `[{ student_id: h, status: "holiday",
   students: {...} }]`), open Set all, choose *Present*, then **invoke the recorded `onConfirm`** (the holiday row
   makes `anyMarked` true, so the confirm path runs). Save →
   - every non-holiday child is written `present`;
   - the holiday child is absent from the payload.

   ⚠ RISK 2 MITIGATION: under current code this test is **red** (save blocked on the holiday child). It follows
   whichever option the user chose at the Step 3 STOP. **Prohibition:** do NOT remove the holiday seed to get
   green.

⚠ RISK 3 MITIGATION — required mutation proofs (sources as named):

| # | Source | Mutation | Must redden |
|---|---|---|---|
| S1 | `app/(coach)/classes/[id]/attendance.tsx` | `onPress={handleSave}` → `onPress={() => {}}` | happy save + incomplete blocks |
| S2 | same | `router.replace(exitHref as any);` → `void exitHref;` | happy save |
| S3 | same | `setTop={setTop}` → `setTop={() => {}}` | happy save |
| S4 | same | `onSetAll={onSetAll}` → `onSetAll={() => {}}` | set-all → save (under option A; under B, record that `it.failing` stays green and S4 is unprovable until the fix) |

### 5. Port `domain/useAttendanceLoad.test.ts` to `renderHook` (D6)

Drop the `jest.mock("react")` recorder and the `S` index map; assert on `result.current` after
`await act(() => result.current.load())`. Keep both cases and their wording. **Re-prove red** against `61426c8^`
(the cancelled-lesson fix). If the port can't reproduce case 2 (stale `classTitle`) under real React, **say so and
keep the old file** — the reproduction is the asset, not the style.

- ⚠ RISK 4 MITIGATION — **its own commit**, so `git revert` of that one commit restores the proven test.
  Keep this file's dao mocks **file-local and unchanged** (do not move them onto the harness). The only edits are:
  - the React recorder;
  - the `S` map;
  - the `lastSet` reads;
  - the header line "The app has no hook renderer…", which is now false. Rewrite it to say `renderHook`, and keep
    the original proven-red record.
- ⚠ RISK 4 MITIGATION — call `load` from the **initial render's** `result.current` (cold open: `classTitle`
  state is `""`). Do not `rerender()` before it. Under real React the closure still sees `""`, so case 2 should
  reproduce. It was verified at review that the hook is byte-identical to `61426c8`'s since that commit, and its
  imports match HEAD.
- ⚠ RISK 4 MITIGATION — **assertions with pass/fail values:**
  - `npx jest features/mark-attendance/domain/useAttendanceLoad.test.ts --verbose` lists **exactly the two test
    names recorded in Step 0.1**. Same count (2), same strings.
  - Re-proof: `mutate.sh features/mark-attendance/domain/useAttendanceLoad.ts
    features/mark-attendance/domain/useAttendanceLoad.test.ts "2 failed" rev 61426c8^` → `RED as required`.
  - Then confirm from `mutate.out` that case 1 failed on `resolved`/`isShowingDate` and case 2 on the
    `"this lesson on"` / `cancelled Tadpoles` text (§7.299: red for the right reason, not an import error).
  - **Prohibition:** never `git checkout 61426c8^ -- …` (Step 0.2).
  - If case 2 stays green under the port → keep the old file verbatim, and write why in the plan's DoD line.

### 6. Verify

1. `cd SwimSyncApp && npm test` — green. ⚠ RISK 4 / RISK 9 MITIGATION:
   - suites = **S₀ + 3** exactly (save hook, `useMarking`, screen; the load file replaces itself);
   - tests = T₀ + (new tests) exactly. Add up the new `it`s by file and write the sum before running. A different
     number means a test was lost or never ran.
2. Every mutation in the tables above through `mutate.sh`, each `RED as required`; the header of each file lists
   them. After the last one: `git status --porcelain -- SwimSyncApp/app SwimSyncApp/lib SwimSyncApp/features` shows
   **only** the four test files + harness.
3. `npm run typecheck` — clean (it also proves the harness mock surface is complete, RISK 6).
4. `scope-check.sh` → `scope OK`.
5. Commit per step via `/commit-review` (port in its own commit). Merge to `main`, then
   **`scope-check.sh origin/main` immediately before `git push`** (a push to `main` is the app deploy). Push and
   delete the branch.

### 7. Docs (at `/update-docs`, not mid-lane)
- `docs/TESTING.md` §5 — the component-render paragraph: move "the attendance save flow" from *Still to do* to
  pinned, naming the four files.
- `BACKLOG.md` — Wave 2 lane 2 struck through; *Deeper component-render tests* "What remains" loses the attendance
  save flow; RISK 6 two-tenant test noted as **Wave 3** (D5).
- ⚠ RISK 2 MITIGATION — under option B: a BACKLOG bug entry "Set all drops a holiday row's state; the lesson
  becomes unsaveable until reopened", citing the two `it.failing` tests by name.

## Definition of done
- [ ] Four test files (save hook, `useMarking`, screen, ported load) green, each with its mutations in its header.
- [ ] Load test port re-proven red against `61426c8^` via `mutate.sh … rev` (or kept, with the reason written in
      its header); exactly the two Step 0 test names.
- [ ] `scope-check.sh origin/main` → `scope OK` (the five lane files + this plan only; harness allowlisted by name).
- [x] Step 3 STOP resolved by the user — **option A** (D7).
- [ ] The `fix/setall-holiday` lane is on `main` (and deployed) before Step 3 runs here.
- [ ] D8's three gotchas appended to `docs/GOTCHAS.md` (§7.311+), never renumbering.
- [ ] typecheck clean; merged and pushed.

## Estimate
About 5.5–6.5h:
- hook test ~1.5h;
- screen ~1.5h (mock wiring is the risk; 30 min spike inside that);
- `useMarking` ~30 min;
- port ~45 min;
- mutation proofs ~1h (about 25 through `mutate.sh`);
- scripts + baseline ~30 min;
- the Step 3 STOP is user time.

## Pre-commit gate

**Highest value — any unticked box blocks the commit:**
- [ ] `scope-check.sh` → `scope OK`, and before push `scope-check.sh origin/main` → `scope OK` (RISK 1)
- [ ] `git diff HEAD --exit-code -- SwimSyncApp/app SwimSyncApp/lib SwimSyncApp/features/mark-attendance/domain/*.ts SwimSyncApp/features/mark-attendance/ui SwimSyncApp/features/mark-attendance/dao` → exit 0 (test files excepted); `git diff --cached --name-only` lists only lane files (RISK 1)
- [ ] Every mutation printed `RED as required` with its named test; none green (RISK 3)
- [ ] Step 3 holiday STOP answered by the user; no weakened (b), no dropped holiday seed (RISK 2)
- [ ] Load test: the same 2 names, red against `61426c8^` for the right reasons (RISK 4)

**Also:**
- [ ] Suites = S₀ + 3; tests = the sum written in advance (RISK 4/9)
- [ ] Screen test pins `todayInSg`; no `new Date()`, no fake timers (RISK 5)
- [ ] Harness: dao imports are `import type` only; `npm run typecheck` clean (RISK 6)
- [ ] Every new file carries the `@/lib/supabase` tripwire mock (RISK 6)
- [ ] No edit to `app/`, `ui/`, `jest.config.js`, `StudentMarkList.test.tsx` (RISK 7/9)
- [ ] No pin on `Promise.all` order or holiday-inflated counts (RISK 8)
