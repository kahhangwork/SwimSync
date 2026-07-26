# Attendance status on the coach's lists

_Written 2026-07-26. Reviewed with `/plan-review`; mitigations are inlined under the
step they govern, not collected at the end._

**The ask.** On the coach's Today screen there is no way to tell whether a class has been
marked. Every card shows an identical solid blue **Mark Attendance** button whether the
lesson is untouched, half done, or finished — which matters most on the day the class
actually runs. Add a status indication and a breakdown of what was recorded
(`3 present · 2 cancelled (rain)`).

**Decided with the user, not open for reinterpretation:**

| Question | Answer |
|---|---|
| A class later today, nothing marked | Grey **Upcoming** until its end time, then orange **Not marked** |
| A fully marked class | Button becomes a quiet outlined **Edit attendance** (same destination) |
| Breakdown detail | Non-zero statuses only; rain and coach stay **distinct** |
| Scope | Today's cards **+** Unmarked Lessons rows **+** the class roster screen |

**No database work.** Everything comes from adding `status` to an embed that is already
being selected. No migration, no Edge Function — so the deploy is a push to `main`.

---

## Step 0 — Record the baseline BEFORE touching anything

Run these and write the numbers into this file. A mitigation that compares against a
number nobody captured is not a mitigation.

```bash
cd SwimSyncApp   && npx jest && npm run typecheck      # expect 130 tests, 10 suites
cd SwimSyncAdmin && npm test  && npm run typecheck      # expect 186 tests, 13 files
supabase test db                                        # expect 397
# Driver baseline, on the fixture this work will extend:
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
  < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen.sql
node .claude/skills/run-ui-playwright/drivers/verify-stale-screen.mjs   # expect 14/14
```

**Baseline recorded 2026-07-26, and the outcome beside it:**

| | Before | After |
|---|---|---|
| `SwimSyncApp` jest | 130 (10 suites) | **174** (12 suites) |
| `SwimSyncAdmin` vitest | 186 (13 files) | 186 — unchanged, as intended |
| pgTAP | 397 | 397 — unchanged, no DB work |
| `verify-stale-screen.mjs` | 14/14 | **18/18** |
| `verify-attendance-guard.mjs` | 14/14 | 14/14 |
| `verify-bulk-setall.mjs` | 10/10 | 10/10 |
| `verify-attendance-window.mjs` | 3/5 | 3/5 — same two failures |

> **`verify-attendance-window.mjs` does NOT score 0/4.** HANDOVER §8.16 and §8.15 both say
> it does. It has **five** checks and scores **3/5**, measured on both sides of this work by
> stashing the two screens — the two failures (a roster placeholder, and a parent
> empty-state) are pre-existing and identical. The "0/4" figure is stale prose; the runner is
> the fact. Worth correcting in HANDOVER rather than carrying forward.

---

## Step 1 — Fix the clock (its own commit, before any feature work)

`today/index.tsx:57` computes the current time from **the device**:

```js
const nowMins = now.getHours() * 60 + now.getMinutes();   // device-local
```

while the date beside it comes from `todayInSg()`. Date and time-of-day can therefore
disagree — the §7.7 shape that shipped a real double-billing bug. Today it only drives the
"Now" badge; **"Upcoming" would depend on it entirely.**

Create `SwimSyncApp/lib/timeOfDay.ts` — coach-only, following the precedent
`attendanceWindow.ts` set. Do **not** put this in `lessonDates.ts`: that file is a
byte-identical twin in `SwimSyncAdmin` and only the coach app cares about time-of-day.

```ts
export function nowMinutesInSg(now?: Date): number      // Intl.formatToParts, like todayInSg()
export function isNowInRange(start: string, end: string, nowMinutes: number): boolean
export function hasEndedInSg(end: string, nowMinutes: number): boolean
```

> **⚠ RISK 3 MITIGATION — the timezone conversion happens in exactly ONE place, and the
> consumers take a number.**
> `isNowInRange` and `hasEndedInSg` accept `nowMinutes: number`, not a `Date`. They cannot
> read a clock, so they cannot read the wrong one; only `nowMinutesInSg()` touches
> timezones and it is tested directly.
> - **Step:** parse via `Intl.DateTimeFormat(..., {timeZone:"Asia/Singapore", hour12:false}).formatToParts` — the same reason as `todayInSg()`: Hermes' ICU is not worth betting an invoice on.
> - **Step:** handle the `hour === "24"` midnight rendering some ICU builds emit; map it to `0`.
> - **Assertion:** the suite runs `nowMinutesInSg` against a fixed instant with
>   `process.env.TZ` set to `UTC`, `America/New_York` and `Asia/Singapore` in turn; **all
>   three must return the same number**. A differing value means the device leaked in.
> - **Assertion:** for the instant `2026-07-26T23:30:00Z` (07:30 SGT the next day),
>   `nowMinutesInSg` must be `450`. The old `getHours()` version returns `1410` under
>   `TZ=UTC` — this is the test that proves the fix (§7.25).
> - **Prohibition:** do **NOT** call `new Date()`, `getHours()` or `getMinutes()` anywhere
>   in `today/index.tsx` or `roster.tsx` after this step. Verify with
>   `grep -n "getHours()\|getMinutes()" SwimSyncApp/app/\(coach\)` — must return nothing.

---

## Step 2 — One definition of "what happened at this lesson"

New `SwimSyncApp/lib/attendanceSummary.ts`. Pure, and **built on** the existing
`attendanceCompleteness` helpers rather than re-deriving them — three screens are about to
ask this question, and §7.18 is what four hand-written copies of one rule already cost.

```ts
type LessonProgress =
  | { kind: "no-students" }
  | { kind: "upcoming" }
  | { kind: "unmarked" }
  | { kind: "partial"; marked: number; total: number }
  | { kind: "complete"; total: number };

lessonProgress(expectedIds, markedIds, opts: { hasEnded: boolean }): LessonProgress
summariseStatuses(expectedIds, statusByStudent): { status: DbStatus; count: number }[]
formatSummary(counts): string          // "3 present · 2 cancelled (rain)"
```

> **⚠ RISK 1 MITIGATION — `attendanceCompleteness.ts` IS THE BILLING GATE. DO NOT EDIT IT.**
> The obvious way to handle a class with no students is to make
> `isLessonFullyMarked([], undefined)` return `false`. **That would change which months can
> be invoiced.** That file is shared with the billing engine's Deno copy and the admin
> pre-flight; `unmarkedDates()` deliberately skips dates where `expected.length === 0`, and
> the engine depends on the vacuous `true`. Getting it wrong either blocks a month that
> should bill or seals one with a lesson unbilled (§8a) — for every tenant.
> - **Prohibition:** this task changes **no** file under the `attendanceCompleteness` name,
>   in any of its three copies. The empty case is handled in the **display** layer, in
>   `lessonProgress`, which nothing bills from.
> - **Structural guard (a step, not a note):** add to `attendanceCompleteness.test.ts` a
>   test named `"an empty expected set is vacuously marked — the billing gate depends on
>   this"` asserting `isLessonFullyMarked([], undefined) === true`. Anyone who later
>   "fixes" it breaks a test that explains why not to.
> - **Assertion:** `git diff --stat` at commit time lists **no** `attendanceCompleteness.ts`
>   under either app or `supabase/functions/`. The existing drift test must still pass
>   unchanged.

> **⚠ RISK 2 MITIGATION — `no-students` is checked FIRST, and the button fails safe
> towards nagging.**
> An empty roster reaching `complete` would put "Edit attendance" on a class nobody has
> marked. The coach reads it as done, the lesson stays unmarked, and the month is blocked
> with **no override** (§8a) — silent under-billing, this repo's signature failure.
> - **Step:** order the branches `no-students` → `upcoming` → `unmarked` → `partial` →
>   `complete`, so an empty expected set **cannot fall through** to `complete`.
> - **Step:** the button is the solid **Mark Attendance** for *every* state except
>   `complete`. Written as `progress.kind === "complete" ? edit : mark` — never
>   `!== "unmarked"` — so any future state added to the union inherits the nagging
>   default rather than the silent one.
> - **Assertion:** a test asserts `lessonProgress([], undefined, {hasEnded:true}).kind ===
>   "no-students"`, and a second asserts that for all five `kind` values only `"complete"`
>   maps to the Edit button. Add a `kind` and the second test fails until you decide.
> - **Step:** counts come from `countMarked(expected, markedIds)`, which already ignores a
>   student who has a row but is no longer expected — so a departed child cannot push a
>   partial lesson to `complete`, nor make it read "5 of 4".

---

## Step 3 — Today's Classes cards

- `attendance(student_id)` → `attendance(student_id, status)` in the existing
  `windowSessions` query. **No new query** — it already spans today.
- Compute today's expected set with `expectedStudentsOn(todayDate, spans, bookedHere)`.
  The backlog loop currently `continue`s on `todayDate`, so this set exists nowhere yet.
- `TodayClass` gains `progress` and `summary`.

**Layout — decided with the user from drawn options; Option A.** The chip takes the
top-right slot and the student count moves down to the front of the breakdown line, where
it reads as the total the breakdown adds up to:

```
┌──────────────────────────────────────────┐
│ Tanglin View Sun 845am        ✓ Marked   │   green
│ 🕐 8:45 – 9:30 AM   📍 Tanglin View      │
│ 2 students · 2 present                   │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│ │         Edit attendance              │ │   OUTLINED
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ Tanglin View Sun 930am   ◐ 3 of 5 marked │   amber
│ 5 students · 2 present · 1 cancelled (rain)
│ │         Mark Attendance              │ │   SOLID
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ Tanglin View Sun 1100am      ○ Upcoming  │   grey
│ 4 students                    (no breakdown — nothing recorded yet)
│ │         Mark Attendance              │ │   SOLID
└──────────────────────────────────────────┘
```

Remaining two states: **Not marked** (orange, after the class has ended with nothing
recorded, no breakdown line) and **No students** (grey, for a class like TestClass with an
empty roster — no breakdown, and see Risk 2 for why this must never render as Marked).

Option C — chip beside the badge on one row — was rejected: at the 420 px phone viewport
`◐ 3 of 5 marked` plus `[5 students]` plus a long class title wraps.

> **Prohibition:** the breakdown line is omitted entirely when nothing is recorded. Do
> **NOT** render an empty `5 students · ` with a trailing separator.

> **⚠ RISK 5 MITIGATION — the trial-booking map is PER CLASS.**
> `bookedByDate` is built as `Map<class_id, Map<date, studentIds>>`. Passing the outer map,
> or a flattened one, would expect a trial child at **every** class — so every card would
> read `partial` forever and the coach would chase marks that do not exist.
> - **Step:** pass `bookedByClassDate.get(cls.id) ?? new Map()` — the same expression the
>   backlog loop already uses. Do **NOT** introduce a second booking lookup.
> - **Assertion:** the driver fixture already has two classes; add a trial booking to class
>   A only and assert class B's card does **not** read `partial`.

> **⚠ RISK 4 MITIGATION — cards and backlog share ONE expected-set computation.**
> Two derivations of "who was expected" is exactly how the client became the only effective
> gate before (§7.18).
> - **Step:** hoist the per-class `enrolmentSpans` / `bookedHere` / expected-set derivation
>   above the `todayDate` skip, and have both the card and the backlog read from it. There
>   must be exactly one call to `expectedStudentsOn` per (class, date) in this file — check
>   with `grep -c "expectedStudentsOn" today/index.tsx`.

---

## Step 4 — Unmarked Lessons rows

`BacklogItem` gains the same `progress` / `summary`. By construction these are only ever
`unmarked` or `partial` — a lesson that reached `complete` is not in the backlog.

> **⚠ RISK 4 MITIGATION (continued) — MEMBERSHIP MUST NOT CHANGE. Display only.**
> If a refactor alters which rows appear, a forgotten lesson either vanishes (unbillable
> and invisible to everyone — §7.18's shape) or a finished one reappears and the coach
> re-marks it. An existing driver already depends on this:
> `verify-bulk-setall.mjs:111` asserts `!/Unmarked Lessons/.test(text)` after a bulk save,
> i.e. the **whole section disappears** when the backlog empties.
> - **Step:** keep the `{!loading && backlog.length > 0 && ...}` guard. Do **NOT** render
>   the heading when the list is empty, and do **NOT** render a "nothing to do" state here.
> - **Step:** run `verify-bulk-setall.mjs` before and after this step. It is the only driver
>   that pins the section's disappearance.
> - **Assertion:** on the unchanged `fixtures-stale-screen.sql`, the backlog heading reads
>   `Unmarked Lessons (1)` both before and after this work. A different number means
>   membership moved, which is a blocker, not a cosmetic diff.

---

## Step 5 — Class roster screen

`roster.tsx` already computes `marked_count`, `total_count` and `isComplete()`. Only the
breakdown is missing.

- Add `status` to its `attendance(id, student_id)` select.
- Replace the local `isComplete()` (line 357, used **only** at line 637) with
  `lessonProgress`, and add the breakdown to each lesson row.

> **⚠ RISK 2 MITIGATION (continued) — do NOT touch `markTarget`.**
> `markTarget` decides **which lesson the Mark Attendance button sends the coach to** — the
> entry point §8.15 built, and the only route to recording attendance from this screen. It
> is computed separately (~lines 306–340) and does **not** use `isComplete`, so this step
> has no reason to go near it.
> - **Prohibition:** do **NOT** change `markTarget`'s computation or its button label
>   `Mark Attendance — <date>[ (Today)]`. `verify-attendance-window.mjs:51` asserts that
>   exact string. That driver is already known-stale at 0/4 (HANDOVER §8.16) — leave it no
>   *more* broken.
> - **Assertion:** `git diff roster.tsx` touches the lesson-row render and the select, and
>   nothing between the `markTarget` state declaration and its `setMarkTarget` call.

---

## Step 6 — Verification

- **Unit:** `timeOfDay.test.ts` and `attendanceSummary.test.ts`. Every case proven to fail
  without the fix (§7.25) — for the clock that means running the assertions against the old
  `getHours()` expression and recording the failure count here.
- **Driver:** extend `verify-stale-screen.mjs`. Its fixture already produces the three
  states — a fully marked lesson, a partially marked one, and an untouched one — so assert
  the chip text and breakdown for each, plus that the button reads `Edit attendance` only
  when complete.

> **⚠ RISK 6 MITIGATION — know which drivers read the strings being changed.**
> The chip and the badge move rewrites text other drivers assert on.
> - **Step:** before editing, run
>   `grep -rn "students\|Mark Attendance\|Unmarked Lessons" .claude/skills/run-ui-playwright/drivers/*.mjs`
>   and list every driver that asserts on a Today-screen or roster string. Currently:
>   `verify-bulk-setall.mjs`, `verify-attendance-window.mjs`.
> - **Step:** run both of those before and after, and record the scores. `verify-bulk-setall`
>   must not regress; `verify-attendance-window` must stay at its existing 0/4 rather than
>   getting worse.

> **⚠ RISK 7 MITIGATION — the extra column must not change the row count.**
> Adding `status` to an embed selects no additional rows and crosses no new RLS boundary
> (`attendance_select` already grants the owning coach the whole row). But the Today query
> carries a documented silent ceiling: PostgREST `max_rows = 1000`, past which the backlog
> **under-reports rather than errors**.
> - **Assertion:** the driver's `Unmarked Lessons (n)` count is unchanged (see Risk 4).
> - **Prohibition:** do **NOT** add a second round trip to fetch statuses. If the breakdown
>   ever needs data outside this embed, stop and move the whole thing server-side rather
>   than adding a query per class.

---

## Pre-commit gate

Do not commit until every box is ticked. A box that cannot be ticked is a blocker.

- [ ] **Highest value —** `git diff --stat` lists **no** `attendanceCompleteness.ts`, in any of its three copies (Risk 1)
- [ ] **Highest value —** `grep -n "getHours()\|getMinutes()" SwimSyncApp/app/\(coach\)` returns nothing (Risk 3)
- [ ] **Highest value —** driver backlog heading reads `Unmarked Lessons (1)` on the unchanged fixture, same as baseline (Risk 4)
- [ ] `nowMinutesInSg` returns an identical value under `TZ=UTC`, `America/New_York`, `Asia/Singapore` (Risk 3)
- [ ] Only `kind === "complete"` yields the Edit button; a new `kind` fails a test (Risk 2)
- [ ] `markTarget` and its label are untouched in `roster.tsx` (Risk 2)
- [ ] Exactly one `expectedStudentsOn` call per (class, date) in `today/index.tsx` (Risk 4)
- [ ] `verify-bulk-setall.mjs` did not regress; `verify-attendance-window.mjs` no worse than 0/4 (Risk 6)
- [ ] Every new test proven to fail without the fix, failure counts recorded above (§7.25)
- [ ] app jest ≥ 130 + new, admin vitest 186 unchanged, pgTAP 397 unchanged, both typechecks clean
- [ ] `verify-stale-screen.mjs` at 14/14 + the new checks

## Graduating to §7

These outlive the task and belong in `docs/GOTCHAS.md`, not only here:

- **The display layer must not fix the billing gate's vacuous-true.** An empty expected set
  is *correctly* "fully marked" for invoicing and *wrong* to show as marked — two different
  questions, one of which is load-bearing for money. (From Risk 1.)
- **A time-of-day comparison is a §7.7 instance and this codebase already had one live.**
  `getHours()` beside `todayInSg()` is the same date/weekday disagreement in a new place.
  Extend §7.7 rather than adding a new number.

## Not doing, deliberately

- No database work, no admin-panel changes, and the three summary tiles at the top of Today
  ("5 Classes Today") are left alone — the ask was about the cards.
- Not adding a "nothing to do" empty state to the backlog section (Risk 4 forbids it).
