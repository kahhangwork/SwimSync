# Plan — Complete the parent Upcoming view + advance-cancel

_Drafted 2026-08-21. The parent Upcoming view itself already shipped (2026-08-17,
`02c75e8`, PRD §7 line 1026); this plan ADDS make-ups + extra lessons to it (Phase A)
and builds a new advance-cancel-a-lesson feature reflected in it (Phase B)._

## Decisions locked (with the user)

- Advance-cancel is **admin only**, granularity **class + date** (a whole lesson that did
  not run — rain, coach sick). A single child not coming is an *absence*, not a cancel.
- Upcoming shows a cancelled lesson **struck as "Cancelled"** (not hidden — holidays are
  already hidden; a cancel is shown so the parent sees why there is no lesson).
- Make-ups appear in **both** places — Home keeps its at-a-glance chip AND Upcoming lists
  the dated row.
- Cancel/Restore admin UI lives on **both** the lesson detail page (`/lessons/[classId]/[date]`,
  reached from the read-only calendar) AND a "Cancel a lesson" entry on the Classes page.
- **Phased:** Phase A (make-ups + extra lessons) ships and is verified FIRST; Phase B
  (advance-cancel) second, isolating the billing-engine change.

## Why this is billing-critical (read before Phase B)

The engine's completeness gate (`core.ts`) BLOCKS a month for any expected weekday that has
no session and no marks — no override, by design (CLAUDE.md). Holidays do NOT work by
subtracting expected dates; they create a MARKED session (`holiday` status) that satisfies
the gate. So a cancelled future lesson must be represented as a **session the engine
excludes** from both the gate and billing — done at the SESSION level, not by marking each
enrolled child, because a child who enrols between cancel-time and bill-time would otherwise
re-block the month.

---

## Phase A — make-ups + extra lessons in parent Upcoming

_An afternoon. No migration, no engine change, no billing risk._

### Step A1 — extend the pure helper `SwimSyncApp/lib/upcomingLessons.ts`
- Add `kind: "class" | "makeup" | "extra"` to `UpcomingLesson`.
- Add two explicit-date inputs to `computeUpcomingLessons(...)`: `makeups` and `extras`.
  These are EVIDENCE (real rows), not projections — add them directly, filter to
  `today <= date <= horizon`, dedup by the existing `class_id:date` key (an explicit
  session wins over the projected weekday).

  ⚠ RISK 6 MITIGATION (STRUCTURAL — dedup by construction, not by vigilance):
  `computeUpcomingLessons` fills `seen` FIRST-WINS (`upcomingLessons.ts:44–59`). So
  **push the explicit `makeups`/`extras` rows into `seen`/`out` BEFORE the enrolment
  projection loop runs.** If the projection ran first, a same-`(class,date)` collision
  would keep the unlabelled projected row and silently drop the `kind` badge (and, once
  B5 lands, drop the struck-"Cancelled" row in favour of a live-looking lesson). Explicit
  before projected makes "explicit wins" true in the code, not just the comment.

### Step A2 — extend `SwimSyncApp/app/(parent)/attendance/index.tsx`
- In `loadAttendance`, additionally fetch, for the selected child:
  - `makeup_bookings` — future, `cancelled_at IS NULL`, join host class title.
  - `lesson_sessions` where `off_schedule_reason IS NOT NULL`, `session_date >= today`,
    `class_id` in the child's ACTIVE enrolments.
- Feed both into `computeUpcomingLessons`.
- RLS confirmed OK (fable review): parents read `makeup_bookings` via `parent_owns_student`
  and off-schedule `lesson_sessions` via `parent_has_child_in_class` (`sessions_select`,
  `20260811000200`). No policy change needed for Phase A.

  ⚠ RISK 5 FORWARD-DEBT (this query is cancel-blind until B5 fixes it): Phase A ships
  BEFORE `lesson_sessions.cancelled_at` exists, so the extras query CANNOT filter it yet.
  The instant B1 lands, an extra lesson later cancelled still matches this filter and would
  render as a live "Extra lesson" — the exact wrong-poolside-trip Upcoming exists to
  prevent. **B5 MUST amend this query; the debt is tracked there as a required step, not a
  note.**

### Step A3 — render
- Badge the card by `kind` ("Make-up" / "Extra lesson"); weekly stays unlabelled.

### Step A4 — tests `SwimSyncApp/lib/upcomingLessons.test.ts`
- Make-up appears; extra appears; dedup holds; past + cancelled excluded.
- Prove RED without the change first (CLAUDE.md: a test must fail without the fix).

  ⚠ RISK 6 MITIGATION (ASSERTIONS with pass/fail values):
  - explicit + projected on the SAME `(class,date)` ⇒ exactly ONE row, and its
    `kind !== "class"`. (A second row, or a `"class"` kind, = the dedup dropped the wrong one.)
  - a make-up in class B on the same date as the child's own class-A lesson ⇒ exactly TWO
    rows. (Make-ups key on the HOST class, so this is correct product behaviour — assert it
    deliberately so a future dedup change can't collapse it silently.)

### Step A5 — verify
- `cd SwimSyncApp && npm test && npm run typecheck`.

---

## Phase B — advance-cancel a lesson

_A few days. Touches the billing engine — the test matrix is most of it._

### Step B1 — migration (on a `db/…` branch off `main`, landed FIRST)
- `lesson_sessions` gains `cancelled_at TIMESTAMPTZ`, `cancelled_by UUID`,
  `cancellation_reason TEXT`.
- `cancel_lesson(p_class_id, p_date, p_reason)` and `restore_lesson(p_class_id, p_date)`:
  admin-only, `SECURITY DEFINER` (mirrors `schedule_extra_lesson`), reason mandatory.
  Creates the session row (if none) with `cancelled_at` set; restore clears it.
- Matching `GRANT EXECUTE`; committed DOWN rehearsed.

  ⚠ RISK 2 MITIGATION (STRUCTURAL refusals in the RPC body AND pinned by pgTAP —
  advance-cancel means *advance*):
  - `cancel_lesson` REFUSES `p_date <= today_sg()`. Dates via `today_sg()`, NEVER
    `now()::date` (§7.7). A past no-run uses the coach's existing `cancelled_rain`/
    `cancelled_coach` status — core.ts:872–877 says outright "there is no case that needs
    a bypass."
  - `cancel_lesson` REFUSES if ANY `attendance` rows exist on that session (a lesson that
    was marked actually ran — cancelling it would delete billed reality).
  - `restore_lesson` REFUSES when a `billing_periods` row covers the date's month (a
    restored-into-sealed lesson can never bill — §11.6).

  ⚠ RISK 3 MITIGATION (STRUCTURAL — cancel-vs-booking race + stranded credit):
  - `cancel_lesson` takes the class row `FOR UPDATE` (same discipline as
    `20260821000400_booking_retire_race.sql`), THEN refuses if live
    (`cancelled_at IS NULL`) `makeup_bookings`/`trial_bookings` exist on that
    `(class_id, p_date)`. The error NAMES them so the admin moves the guests first — never
    silently voids a parent's make-up credit.
  - SYMMETRIC refusal: `book_makeup`, `book_trial`, and `schedule_extra_lesson` refuse a
    `(class,date)` whose session is `cancelled_at IS NOT NULL`, re-checked under their
    existing lock. (Otherwise a booking lands on a dead date and either deadlocks the month
    or evaporates.)

  ⚠ RISK 4 MITIGATION (STRUCTURAL — makes B3's UI exclusion cosmetic, not load-bearing):
  extend `guard_attendance_date()` (`20260727000100`) to REFUSE a NEW attendance row whose
  session has `cancelled_at IS NOT NULL`. The correction/upsert branch stays open (same
  carve-out the trigger already has). §7.199's lesson: a UI/RPC refusal over a `FOR ALL`
  policy + table grant is bypassable by raw PostgREST — the trigger is the only path that
  covers a stale coach screen, a deep link, or a raw POST.

### Step B2 — billing engine `core.ts` (redeploy)
- Load cancelled-session dates per class; subtract from **`expectedDates` ONLY**.

  ⚠ RISK 1 — THE MOST DANGEROUS STEP. NAMED PROHIBITION (add verbatim next to the code):
  **Cancelled dates may be subtracted ONLY from `expectedDates` — the weekday PROJECTION.
  They must NEVER be filtered out of the `sessionByDate` or `bookingsByDate` contributions
  to `datesToCheck` (core.ts:802–810), and never from the billable set.** This is the
  §7.18 / core.ts:735 clamp under a new name: a cancelled date that ALSO carries a live
  make-up/trial booking, or real attendance rows, must still reach the gate. A cancelled
  session satisfies the gate the way a holiday mark does — `unmarkedOn(date)` returns `[]`
  for a cancelled session ONLY when that date has no live booking and no attendance rows;
  if either exists, the date still BLOCKS, loudly. Subtracting from the union instead
  trades a loud block for a silent permanent underbill (§11.6: a sealed month's lesson can
  never be billed after).
- New Deno tests (RISK 1 + RISK 2 pins, pass/fail), run the suite TWICE (§7.15):
  - cancelled date, nothing else on it ⇒ does NOT block, does NOT bill.
  - **cancelled date WITH a live make-up booking on it ⇒ result is `incomplete_attendance`,
    NOT sealed.** (This is the assertion that proves the prohibition held.)
  - cancelled date that somehow has `present` attendance rows ⇒ still bills those (B1
    refuses creating this state, but the engine must not depend on B1 to be safe).

### Step B3 — coach app
- NEEDS MARKING excludes cancelled sessions. (COSMETIC ONLY — the load-bearing refusal is
  the `guard_attendance_date()` trigger in B1's RISK 4 mitigation. This step just hides the
  affordance; it must not be the only thing stopping a mark on a cancelled session.)

### Step B4 — admin UI (both homes)
- `/lessons/[classId]/[date]`: Cancel / Restore action (reason prompt).
- Classes page: "Cancel a lesson" entry (pick class + future date → same RPC).
- Read-only calendar shows a cancelled lesson faded, like the existing holiday void.

### Step B5 — parent app
- Cancelled dates render struck as "Cancelled" in Upcoming.

  ⚠ RISK 5 MITIGATION (REQUIRED STEP — pays off the Phase A forward-debt): amend the A2
  queries so BOTH the extras fetch AND the weekly-projection exclusion read `cancelled_at`.
  An off-schedule session with `cancelled_at` set must NOT render as a plain "Extra lesson".
  Jest test proven RED first: cancelled extra session ⇒ struck "Cancelled" row, never a
  live upcoming row.

### Step B6 — tests
- pgTAP (RPC auth + gate), Deno ×2, vitest (admin), jest (parent), one UI driver.

### Step B7 — deploy
- Order: migration → engine → apps (apps LAST). Grant dump after (§7.39, §7.89).

  ⚠ RISK 7 MITIGATION (ASSERTION with pass/fail — the new functions are the whole risk):
  the post-push REMOTE grant dump shows, for BOTH `cancel_lesson` and `restore_lesson`,
  exactly `authenticated` EXECUTE and NOTHING for `anon`/`PUBLIC`/`service_role`. Any dump
  line differing from that is a DEPLOY BLOCKER (mirror the REVOKE block at the bottom of
  `20260727000100`). Local privileges lie here by construction (§7.39) — the remote dump
  is the fact. No grant at all ⇒ dead feature for every admin (§7.87).

---

## Pre-commit gate

**The three highest-value boxes — a month's revenue rides on each. Cannot tick ⇒ blocker:**
- [x] **RISK 1** — Deno test: cancelled date + live make-up booking ⇒ `incomplete_attendance`,
      NOT sealed. (Proves the subtraction touched `expectedDates` only, never the union.)
      `cancelledLessons.test.ts`, 2026-08-21.
- [x] **RISK 2** — pgTAP: `cancel_lesson` refuses past/today, refuses a session with attendance
      rows; `restore_lesson` refuses a sealed month. `advance_cancel_lesson.test.sql` 2, 3, 30, 24.
- [x] **RISK 4** — pgTAP: a raw `attendance` INSERT on a cancelled session is refused by the
      trigger (not just hidden by B3's UI). `advance_cancel_lesson.test.sql` 14 (future) and 19
      (PAST — red on the pre-migration trigger body).

**The rest:**
- [x] Phase A tests proven RED before the fix (RISK 6 dedup assertions included). (2026-08-21, §8.80)
- [x] RISK 5 — B5 amended the A2 queries; jest red-first that a cancelled extra is struck, not live.
      (`upcomingLessons.test.ts` → "cancelled lessons"; the extras query now reads `cancelled_at IS NULL`.)
- [x] `npm test` + `npm run typecheck` green in both apps. (jest 400, vitest 519.)
- [x] Phase B: Deno suite run TWICE, both green (§7.15). (232 / 232.)
- [x] Phase B: migration DOWN rehearsed (applied, probed, re-applied — `20260821000700…DOWN.sql`).
- [ ] RISK 7 remote grant dump clean for both new functions — AT DEPLOY.

**Graduated 2026-08-21:** RISK 1 → `docs/GOTCHAS.md` §7.203; RISK 4 → §7.204.

**Not built, deliberately scoped out (in `BACKLOG.md`):** a UI driver for the cancel/restore flow
(`verify-cancel-lesson`); what an advance cancel means for a PREPAID PACKAGE (a holiday void extends
the package; a cancel currently does not — a product decision, not an omission the code can settle);
cancelling TODAY's lesson from the admin panel (the coach's `cancelled_rain`/`cancelled_coach` mark is
the path, as locked above — revisit if the admin asks for it).

## Graduate on landing
When Phase B ships, promote to `docs/GOTCHAS.md` §7 (they outlive this plan file):
- **RISK 1** — "a cancelled-date subtraction is the `bookingsByDate` clamp under a new name;
  subtract from `expectedDates` only." Sits beside §7.18 / core.ts:735.
- **RISK 4** — "a cancelled-session mark-refusal belongs in `guard_attendance_date()`, not the
  UI; §7.199's raw-PostgREST-bypass lesson on the attendance axis."
