# Admin Calendar + Lesson Detail + Lessons List — Plan

_Written 2026-08-19 via `/plan-with-confidence`. Status: **SHIPPED 2026-08-19 — all three slices LIVE** (§8.71; deploy record DEPLOYMENT §11.30)._
_Product-risk review 2026-08-19: claims verified against the code; mitigations folded inline as
`⚠ RISK n MITIGATION` (n = rank, 1 = highest blast radius); corrections marked `✎ corrected by review:`.
The ranked list lives in the Pre-commit gate at the end._

## 0. Goal in one paragraph

Give the tenant admin a **Calendar** (day / week / month / agenda) of every lesson of every
coach, colour-coded per class, each card showing coach (+ substitute), and an `enrolled+guests/capacity`
count so the admin can see at a glance which class has a free slot for a make-up. Hovering a card lists
the students and their attendance; **double-click opens the lesson detail page**, where the admin
marks attendance (incl. a per-lesson Holiday void), assigns/removes a substitute, and books a make-up
or trial into that lesson. A **Lessons** list page (grouped by day) is the second entry point to the
same detail page. The existing read-only `/attendance` audit page is untouched.

Decisions settled with the user (2026-08-19):

| Decision | Answer |
|---|---|
| Capacity | `class_categories.default_capacity` + nullable per-class override `classes.capacity` |
| Count on a card | enrolled-on-date `+` guests (trial + make-up bookings that date) `/` capacity → `4+1/6`, following the existing `2+1` roster convention (PRD §7.3) |
| Pages | new `/calendar`, new `/lessons`, new `/lessons/[classId]/[date]`; keep `/attendance` audit as is |
| Lesson detail actions | mark attendance (all statuses incl. admin-only **Holiday** per lesson) · assign/remove substitute · book make-up into this lesson · book trial into this lesson |
| Colour | fixed palette of 12 swatches, per **class**, chosen on the Classes form; unset → neutral grey |
| Location | filter on distinct `classes.location_name` (free text already captured); a location entity stays in BACKLOG. Plus a Coach filter |
| Week start | Monday-first (matches coach Schedule tab + DB enum) |
| Shipping | one session, **slice by slice**: A (schema) → B (calendar) → C (lesson detail + lessons list) |

Decisions taken by the planner (state them, don't re-ask):

- **Admin marking reuses the coach app's write path verbatim** — direct `lesson_sessions` insert +
  `attendance.upsert(onConflict: lesson_session_id,student_id)`. Both `sessions_write`
  (`20260718000900_tenant_rls.sql:374`) and `attendance_write` (`20260811000200:259`) already carry
  `can_admin_tenant(...)`, and the holiday guard (`20260818000800`) already admits an admin. **No new
  RPC, no new policy** for the attendance/session writes — proven by a pgTAP test first (A.3); an RPC
  is the fallback only if that test can't be made green under RLS. All DB guards (marking window,
  weekday, credit-note trigger, CN001 lock) apply to the admin unchanged — **no override**, per CLAUDE.md.
  - ✎ corrected by review: the claim holds for `lesson_sessions` and `attendance` (grants at
    `20260804000600:84,99`; both window-guard triggers `guard_session_date` / `guard_attendance_date`
    gate on `current_user = 'authenticated'` and resolve the **class's** tenant, not the caller's, so a
    tenant admin is treated exactly like a coach — `20260806000200:181-300`; `handle_attendance_update`
    is role-agnostic, `reversed_by = auth.uid()` — `20260818000300:230`; `credit-note-emails` session
    mode already admits `can_admin_tenant` — `supabase/functions/credit-note-emails/index.ts:93-106`).
    **It does NOT hold for the `audit_log` step**: `audit_log_insert`
    (`20260804000300_audit_log_tenant_id.sql:190-196`) is `actor_id = auth.uid() AND entity_type =
    'lesson_session' AND coach_owns_session(entity_id)`, and `coach_owns_session` is
    `classes.coach_id = current_coach_id()` (`20260309000600:54`). A pure tenant admin's audit insert
    is refused by RLS (42501). See A.1 / A.3 for the fix — it IS one policy change, in the same
    migration wave.
- Lesson detail URL is `/lessons/[classId]/[date]`, **never a session id** (§7.64/§7.65 — the row may
  not exist yet).
- The calendar is **tenant-scoped** (`NavScope "tenant"`); platform admins never see it.
- URL carries view state: `/calendar?view=day|week|month|agenda&date=YYYY-MM-DD&location=…&coach=…`, so
  refresh/back keep position and the Lessons page can link into a day.
- Month view chips say `title · coach · 4+1/6`; `+N more` jumps to that day's day view.
- Holiday-voided lessons render dimmed with a *Holiday* chip; retired classes show lessons only up to
  `deactivated_at`'s SGT date.
  - ✎ corrected by review: the plan said "same predicate as `mark_day_holiday`". That RPC uses
    `c.deactivated_at::date` (`20260818000900:51,61`) — the server's date, i.e. UTC, not SGT. The
    billing engine (`core.ts:695-696`, `dateInTimeZone(…, APP_TIMEZONE)`) and the admin's
    `classCoverage.ts:162-163` (`toSgDate`) use the SGT date. **Follow the engine**: `toSgDate(deactivated_at)`;
    a class retired 00:00–08:00 SGT otherwise shows one extra lesson the engine will never bill (§7.7).
    The `::date` in `mark_day_holiday` is a pre-existing drift — note it in BACKLOG at close, do not
    fix it in this wave.
- Single click pins the hover tooltip (so it's keyboard/touch reachable); double-click navigates.
- Time axis: 30-min rows, range = `min(start)−30m … max(end)+30m` of the visible lessons, clamped to at
  least 08:00–20:00; auto-scrolls to 08:00. Gutter (`position: sticky; left: 0`) and the day header
  (`sticky; top: 0`) stay put while the grid scrolls both ways.

## 1. What already exists (reuse, don't rebuild)

| Need | Already there |
|---|---|
| Lesson dates = weekday pattern ∪ existing `lesson_sessions` | `SwimSyncAdmin/lib/sessionRoster.ts:118` `lessonDatesInMonth`; `lib/lessonDates.ts` `expectedLessonDates`, `todayInSg`, `dayOfWeekOf`, `toSgDate` |
| Who's expected on a date (enrolment SPAN + guests) | `lib/attendanceCompleteness.ts` `expectedStudentsOn`, `studentsEnrolledOn` (3-copy drift-tested — do NOT fork). Spans are INCLUSIVE both ends, built by the CALLER with `toSgDate(enrolled_at / unenrolled_at)` (`classCoverage.ts:122-123`); the engine loads enrolments **without an `is_active` filter** (`core.ts:630-632`) |
| Who actually teaches (money axis, Cover chip) | `lib/lessonAttribution.ts` `attributeLessons` (§7.152 — never `classes.coach_id` alone); `lib/sessionRoster.ts` `buildLessonRosters` |
| Lesson marking state | coach app `SwimSyncApp/lib/attendanceSummary.ts` `lessonProgress` + label map; `lib/attendancePayload.ts` `buildAttendanceRows` (uniform key set, §7.67); `lib/attendanceSaveError.ts` `attendanceSaveErrorMessage` (CN001 → message, §7.186); `lib/creditNoteEmail.ts` `mayHaveIssuedCreditNote` + `notifyCreditNoteEmails` (3 s bound) |
| Coach save path to mirror | `SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx:600-770` (resolve/insert session → `buildAttendanceRows` minus holiday rows → upsert → shadow absences → `audit_log` → bounded `notifyCreditNoteEmails`) |
| Substitute assign/remove | `substitutes/page.tsx:285,317` (`assign_session_coach` — creates the session row lazily itself, `20260811000200:368`; `session_coaches` DELETE) |
| Book make-up / trial | `makeups/page.tsx` (`book_makeup`), `trials/page.tsx` (`book_trial`); `lib/makeupFromAttendance.ts` `makeupHostChoices`. Neither RPC knows about capacity |
| Nav | `lib/adminNav.ts` `NAV` + `NAV_GROUPS` (+ test `adminNav.test.ts`) |
| UI primitives | `components/{Button,Modal,Drawer,Table,PageHeader,StatusBadge}`; Tailwind; lucide; no date/calendar lib (stay hand-rolled) |

## 2. Slice A — schema: capacity + colour (one migration, `db/…` branch from root)

**A.1 Migration `2026081900xxxx_class_capacity_colour.sql`**
- `ALTER TABLE class_categories ADD COLUMN default_capacity SMALLINT CHECK (default_capacity > 0);` (NULL = unlimited)
- `ALTER TABLE classes ADD COLUMN capacity SMALLINT CHECK (capacity > 0);` (NULL = use category default)
- `ALTER TABLE classes ADD COLUMN colour TEXT CHECK (colour ~ '^[a-z]{3,12}$');` (palette *key*, not hex; unknown key → grey in the app)
- COMMENTs stating NULL semantics. No grant changes for the columns: `classes_write` (`20260718000900:342`)
  and `class_categories_write` (`20260720000100:58`) are `FOR ALL … can_admin_tenant(tenant_id)`, UPDATE is
  granted (`20260804000600:87,90`), and no trigger on `classes` fires on these columns
  (`class_tenant_fill` is `UPDATE OF coach_id`, `trg_class_category_tenant` is `UPDATE OF category_id,
  tenant_id`, `trg_class_time_no_enrolment_clash` is `WHEN day_of_week/time change`) — verified.
- ✎ corrected by review — **add to the same migration**: widen `audit_log_insert` so the admin's
  attendance save can write its audit row:
  `DROP POLICY audit_log_insert ON audit_log; CREATE POLICY audit_log_insert … WITH CHECK (actor_id =
  auth.uid() AND entity_type = 'lesson_session' AND (coach_owns_session(entity_id) OR
  can_admin_tenant(session_tenant(entity_id))));` — the INSERT grant already exists
  (`20260804000600:85`), so `table_grants.test.sql` stays green (a policy now permits what is granted).
  Keep it to this one disjunct; the policy is the only thing that stops any signed-in user writing any
  audit row (`20260804000300:62`).
  - ⚠ RISK 1 MITIGATION (prohibition): **do not** "fix" the audit refusal by dropping the `audit_log`
    step silently, by catching-and-ignoring the error in the admin save (the coach app's unchecked
    `await` is the pattern NOT to copy), or by a blanket grant (§7.87). The row is the admin-side trail
    the `/attendance` audit page and credit-note investigations lean on.
- DOWN file alongside; rehearse it (§7.93) — the DOWN must also restore the old `audit_log_insert` body.
- `set_class_terms` is untouched: capacity/colour are not effective-dated, written by a plain UPDATE beside
  the RPC (the pattern already used at `classes/page.tsx:528`).
  - ⚠ RISK 9 MITIGATION (step): put `capacity` and `colour` in the **same** `.update({ category_id, capacity,
    colour })` statement as the existing category write, not a second statement — one failure mode, one
    "Saved, but…" message, no third partial-save state.
- ⚠ RISK 5 MITIGATION (assertion, deploy order): `supabase db push` → `supabase migration list --linked`
  lists `2026081900xxxx` as applied remotely **before** anything that selects `capacity`/`colour` is merged
  to `main`. PostgREST returns 400 on an unknown column, so the Classes page (A.4) would break for every
  tenant on the Vercel build, not just this feature. Run the remote grant dump after (§7.39/§7.89).
  → graduate to GOTCHAS §7.191 if it bites: "a column-adding migration and the UI that selects the column
  ship in different vehicles — migrations → apps, never the same push".

**A.2 pgTAP** `supabase/tests/class_capacity_colour.test.sql`: CHECKs refuse 0 / bad key; admin can UPDATE both; coach cannot.

**A.3 pgTAP** `supabase/tests/admin_marks_attendance.test.sql` — the load-bearing proof that **no new write
path is needed**: as a tenant-admin JWT (`SET LOCAL "request.jwt.claims"` + `SET ROLE authenticated`, the
pattern in `holiday_admin_guard.test.sql:61`), INSERT `lesson_sessions` for own-tenant class + weekday date;
upsert `attendance` incl. `'holiday'`; refused for another tenant; refused before `markable_floor`; refused on
an off-weekday date with no session; **INSERT `audit_log` (`entity_type 'lesson_session'`, own session)
succeeds for a pure admin (no `coaches` row) and stays refused for another tenant's admin.**
- ⚠ RISK 1 MITIGATION (assertion): this file is run and green **before** any of B/C is written, and it
  contains the four refusals above — each one is a `throws_ok` with the DB's own message, not a
  `lives_ok` of the happy path alone. Run it **twice** (a sealed month from another test must not make
  the floor case vacuous). If it cannot go green, fall back to a `SECURITY DEFINER
  admin_mark_attendance(p_class_id, p_date, p_marks jsonb)` modelled on `mark_day_holiday` — and it
  must itself call `assert_markable_date` + `assert_class_runs_on` (§7.38: the window guard's
  `current_user` seam would otherwise be bypassed) **and** call `handle_attendance_update`'s path via
  a real UPDATE (never a DELETE+INSERT, which would skip the credit-note trigger).
- ⚠ RISK 2 MITIGATION (assertion, in the same file): as the admin, UPDATE a row whose invoice line is
  already applied (fixture with `credit_notes.status='applied'`) from `absent` → `present` →
  `throws_ok` with SQLSTATE `CN001`; UPDATE a billed `present` → `absent` → a `credit_notes` row
  appears with `amount = invoice_items.amount` and **exactly one** row per `invoice_item_id` after a
  second flip-flop (the UNIQUE from `20260818000100`). The admin is a second writer of the
  credit-note trigger; prove it behaves identically to the coach.

**A.4 Admin UI for the new fields**
- `lib/classColours.ts` — the 12-swatch palette `{key, bg, border, text}` (Tailwind classes, light/dark-safe) + `colourFor(key|null)`; unit test: every key has all three, unknown → grey.
- Classes form: swatch picker + `Capacity` number (placeholder shows the category default); Classes table: colour dot + `cap` column.
- Packages page (where categories are managed, `packages/page.tsx:276`): `Default capacity` per category.

**A.5 Ship A**: `supabase test db` (twice), `supabase db push` → `supabase migration list --linked` (remote
column filled), remote grant dump (§7.39/§7.89), **then** merge to `main`. Migration queue back to empty
before B starts. (RISK 5 assertion above is the gate.)

## 3. Slice B — `/calendar`

**B.1 Pure core `lib/calendarLessons.ts`** (unit-tested, no Supabase):
```
buildCalendarLessons({ range:{from,to}, classes, sessions, enrolments, attendance,
  sessionCoaches, absences, shadows, trials, makeups, coachNames, categories, classRates, holidays })
  → CalendarLesson[] { key:`${classId}|${date}`, classId, date, start, end, title, colourKey,
      capacity|null, enrolled, guests, mainCoach{name,isCover}, subName|null,
      progress:'upcoming'|'unmarked'|'partial'|'complete'|'holiday', off_pattern,
      students:[{id,name,kind:'enrolled'|'trial'|'makeup',status|null}] }
```
- dates per class = `expectedLessonDates(day_of_week, from, to)` ∪ session rows in range, minus dates ≥
  `toSgDate(deactivated_at)` (see the correction in §0).
  - ⚠ RISK 6 MITIGATION (assertion, vitest): a class with `deactivated_at = '2026-08-10T16:30:00Z'`
    (= 2026-08-11 00:30 SGT) on a Monday pattern shows the 2026-08-10 lesson and **not** 2026-08-17;
    with `deactivated_at = '2026-08-10T15:30:00Z'` (= 23:30 SGT on the 10th) it shows neither. Mirror
    the engine's cut-off, not `mark_day_holiday`'s.
- `enrolled` = `|studentsEnrolledOn(date, spans)|`; `guests` = `|expectedStudentsOn(date, spans,
  bookedByDate)| − enrolled` — so the displayed count **is** the billing gate's expected set by
  construction (a trial-then-enrolled child counts once, exactly as `expectedStudentsOn` dedupes).
  - ⚠ RISK 3 MITIGATION (assertion, vitest): for every lesson, `enrolled + guests ===
    expectedStudentsOn(date, spans, bookedByDate).length` over a fixture containing (a) an unenrolled
    child with `unenrolled_at` before the date, (b) a child both trial-booked and enrolled that day,
    (c) a cancelled make-up (`cancelled_at` set) — expected: (a) excluded, (b) once, (c) excluded.
  - ⚠ RISK 3 MITIGATION (prohibition): `bookedByDate` is built from `trial_bookings` ∪
    `makeup_bookings` where `cancelled_at IS NULL` and host `class_id = this class`, the same shape
    as `core.ts:427-434, 566-612`. Never count a booking by `home_class_id`. Never inline the union
    (§7.18) — and never compute `enrolled` from `is_active`.
- main/sub via `attributeLessons` semantics.
  - ✎ corrected by review: the plan said "session_coaches main row else **class coach**". `attributeLessons`
    resolves the fallback from **`class_rates.paid_coach_id` on the date** (`termsCoachOn`,
    `lessonAttribution.ts:181-190`), and `isCover` = sub ≠ terms coach. Pass `classRates` into
    `buildCalendarLessons` and reuse `attributeLessons` — `classes.coach_id` alone is §7.152.
- `layoutLanes(lessons)` — interval packing into columns per overlap cluster (day view), tested (3 overlapping → 3 lanes; disjoint → 1).
- `rangeForView(view, date)` — day / Monday-first week / month grid (6×7 incl. leading/trailing days) / agenda (7 days from date). Tested, incl. month edges and `todayInSg`.
  - ⚠ RISK 8 MITIGATION (prohibition + assertion): the page holds **no date in `useState`**; the anchor
    date is the URL `date` param, and **Today** computes `todayInSg()` at click time (§7.95 — a
    long-lived admin tab crosses midnight too). Test: `rangeForView('week', d)` is pure; the page has no
    `useState(todayInSg())`/`new Date()` (grep in the driver or a lint assertion).

**B.2 Data load `lib/calendarData.ts`** — one function per range: classes (+category, coach profile,
`capacity, colour`), `class_rates`, `lesson_sessions` in range, `attendance` joined to those sessions,
`session_coaches`, `session_coach_absences`, `class_shadow_coaches`, `trial_bookings`/`makeup_bookings` in
range (`cancelled_at IS NULL`), **all** `student_class_enrolments` (+student name) for those classes — no
`is_active` filter, the span decides — and `tenant_public_holidays` in range. Week/day = a ≤7-day range;
month = ≤42 days. `isStale` flag pattern as other pages.
- ⚠ RISK 10 MITIGATION (assertion): attendance is loaded by `.in("lesson_session_id", ids)` in chunks of
  ≤200 ids (PostgREST URL length); vitest on the chunker: 450 ids → 3 calls, results concatenated, order
  irrelevant.
- ⚠ RISK 4 MITIGATION (prohibition): **no write of any kind in `calendarData.ts`, the tooltip, or any
  B component.** The calendar never creates a `lesson_sessions` row — a session row is the billing
  engine's "a lesson happened here" signal (`lessonDatesInMonth` = pattern ∪ rows), and a phantom row on
  a date the class never ran is a billable lesson. The only writer is C.1's Save.

**B.3 Page `app/(admin)/calendar/page.tsx`** + components under `components/calendar/`:
- `CalendarToolbar` — ‹ › date, label, **Today**, view switch, Location + Coach selects.
- `TimeGrid` (day + week) — sticky gutter/header; lanes ≥ 220 px in day view, ≥ 160 px per day in week (7 × 160 + gutter → horizontal scroll on narrow screens); 30-min rows, cards absolutely positioned by start/end.
- `LessonCard` — 1st line `title` (bold), 2nd `coach` (+ `Sub: name` in red), 3rd `4+1/6` (bold, red when `enrolled+guests ≥ capacity`); holiday → dimmed + chip; unmarked-past → amber left border.
- `LessonTooltip` — title, time, coaches, count, student list with status icon (✓ present, ✗ absent, ~ cancelled, T trial, M make-up, H holiday, ○ unmarked). Pin on click; `Open lesson` link.
- `MonthGrid`, `AgendaList`.
- Double-click → `router.push(/lessons/${classId}/${date})`.
- Nav: add `{ href:"/calendar", label:"Calendar", icon: CalendarDays, scope:"tenant" }` to `NAV`, top-level; update `adminNav.test.ts`.
- Empty/edge states: no classes → hint to create one; filter hides all → "No lessons at Clementi this week".

**B.4 Tests** — vitest for B.1 (≥ 15 cases incl. SGT day boundary, retired class cut-off (RISK 6 pair),
guest counting (RISK 3 parity), lanes); component test for `LessonCard` (count text, full state, cover
name); Playwright `verify-admin-calendar.mjs` (+ fixtures): day view shows fixture class card with
`x+y/cap`, hover shows a student name, double-click lands on `/lessons/...`, Today/‹/› move the URL
`date`, horizontal scroll keeps gutter (assert `scrollLeft > 0` and the gutter's bounding `x === 0`).
Add `/calendar` to `smoke-admin-screens.mjs`.
- ⚠ RISK 4 MITIGATION (assertion, driver): after the calendar driver runs (hover, pin, month view,
  filters — everything except double-click → Save), `SELECT count(*) FROM lesson_sessions` for the
  fixture tenant is **unchanged** from the fixture's count. A calendar that creates rows fails CI.

**B.5 Ship B**: typecheck + vitest + driver; merge → push (Vercel deploys); grep served bundle for `"Calendar"` nav label (§7.31).

## 4. Slice C — `/lessons/[classId]/[date]` and `/lessons`

**C.1 Lesson detail page** `app/(admin)/lessons/[classId]/[date]/page.tsx`
- Header: title · date · time · location · coach (+ Cover/Sub) · `4+1/6` · progress badge · link back to Calendar (day view of that date) and to Classes.
- **Attendance table**: one row per expected student (enrolled span + guests, chips *Trial*/*Make-up*),
  current status, `Present / Absent / Cancelled ▾(rain|coach) / Trial ▾(paid|free — guests only) /
  Holiday` and **Set all ▾**. Save = the coach-app path mirrored in `lib/adminAttendanceSave.ts`:
  resolve-or-insert session → `buildAttendanceRows` (copy `SwimSyncApp/lib/attendancePayload.ts` into
  admin `lib/` with a drift test, like `attendanceCompleteness`) → `upsert` → `audit_log`
  (`action:"attendance_saved"`, `entity_type:"lesson_session"`, `actor_id = session.user.id`,
  `new_value.actor_role:"admin"`) → `notifyCreditNoteEmails` (copy helper, drift test) when a billed
  lesson leaves `present`/`trial_paid`. Client-side `checkMarkableDate` affordance copied from
  `SwimSyncApp/lib/attendanceWindow.ts` + floor from `markable_floor(tenant)` RPC (EXECUTE is granted to
  `authenticated`, `20260806000200:697`; admin has no helper today — add `lib/markableFloor.ts`); the
  **DB remains the guard**, the UI only explains. Future date → read-only with "Can't mark a lesson that
  hasn't happened".
  - ⚠ RISK 1 MITIGATION (assertion): `adminAttendanceSave` **checks the error of every step** and
    surfaces it — session insert, upsert, audit insert, each `if (error) return { ok:false, step,
    message }`. vitest with a mock client: an audit-insert 42501 is reported as `step:"audit"` (the
    attendance is already committed; the message says so), never swallowed.
  - ⚠ RISK 2 MITIGATION (step): copy `SwimSyncApp/lib/attendanceSaveError.ts` into admin `lib/` (drift
    test) and route **every** upsert error through `attendanceSaveErrorMessage(error.code)` (§7.186 —
    one CN001 row rolls back the whole roster; the generic toast is a retry-forever trap). Surface the
    DB message verbatim; **no retry, no "force"**, and (prohibition) no splitting the batch into
    per-row upserts to "get the others through" — partial rosters are what §7.67 fixed.
  - ⚠ RISK 2 MITIGATION (step): the upsert sends **only rows whose status changed or that have no row
    yet** (filter before `buildAttendanceRows`; the key-set rule still holds because the builder is
    unchanged). An untouched billed `present` row then cannot re-fire `handle_attendance_update`, and a
    CN001 on a row the admin did not touch cannot abort the save. Test: unchanged rows absent from the
    payload; `mayHaveIssuedCreditNote` is computed over the **sent** rows only.
  - ⚠ RISK 7 MITIGATION (prohibition): the admin save **does not write `session_coach_absences`**. The
    coach path writes shadow absences from a "coaches present" checklist the admin page does not have; a
    row means *absent/unpaid*, so writing none leaves every shadow **paid** — the recoverable
    direction (`attendance.tsx:688-716`, `20260812000200` §2). Shadows stay read-only in the Coaches
    card. Test: the mock client sees no `session_coach_absences` call.
  - ⚠ RISK 7 MITIGATION (assertion, driver): after an admin save, open the same lesson as the fixture
    **coach** in the coach app: the admin's marks are shown, the coach can still save, and a
    `holiday` row the admin wrote is **left untouched** by the coach's save (the coach path filters
    holiday rows out, `attendance.tsx:653-658`). Reuse `verify-attendance-guard.mjs` fixtures.
- Per-lesson **Holiday**: same table, status `holiday` — enabled only when the date is in
  `tenant_public_holidays`? **No** — that requirement belongs to the whole-day RPC; per-lesson holiday is
  exactly the "not all classes cancelled" case (BACKLOG). Allowed on any markable date; the event-driven
  reconcile (`20260818000700`, fires on client DML too — statement-level transition-table triggers,
  §7.188) extends packages as today.
  - ⚠ RISK 4 MITIGATION (step): **Set all → Holiday** and any save that turns a `present`/`trial_paid`
    row into `holiday` goes through `confirmAction` naming the count of students and "extends their
    packages by N days" (`tenants.holiday_extension_days`). A holiday is a money-moving void for every
    parent in the lesson; the per-lesson path has no RPC-side preview, so the confirm is the preview.
- **Coaches card**: main coach, substitute select (`assign_session_coach`), remove (delete row), shadows listed read-only; same eligibility rules as Substitutes page.
- **Guests card**: "Book make-up into this lesson" (child search as on Make-ups page, host class+date
  fixed, home-class question when >1, `book_makeup`) and "Book trial into this lesson" (`book_trial`);
  cancel booking actions; bookings appear as rows in the attendance table immediately.
  - ⚠ RISK 3 MITIGATION (step): when `enrolled+guests ≥ capacity`, the Book buttons stay enabled but
    open a `confirmAction` "This lesson is full (6/6). Book anyway?" — the count is advisory, the admin
    is the authority. (prohibition) **Do not add a capacity check inside `book_makeup`/`book_trial`** in
    this wave — both are billing-adjacent RPCs with their own test matrices; a DB-side capacity rule is
    its own migration wave and a BACKLOG item.
- Deep-link safety: resolve everything from `(classId, date)`; refuse a date not on the weekday and with
  no session row ("This class doesn't run on Tuesday") instead of inventing a lesson.
  - ⚠ RISK 4 MITIGATION (assertion): the DB already refuses this (`assert_class_runs_on` in
    `guard_session_date`); the page refuses **before** Save is reachable (Save disabled + message), and
    the driver asserts `/lessons/<classId>/<off-weekday-date>` renders the message with no Save button.

**C.2 Lessons list** `app/(admin)/lessons/page.tsx`
- Reuses `buildCalendarLessons` over a week (‹ › Today, Location/Coach filter, **Needs marking** toggle
  that flips to the floor-scoped past-unmarked set, §7.95 rule: not week-scoped — and the floor is
  re-read from `markable_floor` on every load, not cached at mount). Grouped by date: time · title
  (colour dot) · coach/sub · `4+1/6` · progress badge · ›. Click → detail.
- Nav: `{ href:"/lessons", label:"Lessons", icon: ListChecks, scope:"tenant" }` in the Scheduling group; sidebar amber badge = count of past-unmarked lessons (same source as the coach NEEDS MARKING).

**C.3 Tests** — vitest: `adminAttendanceSave` payload/ordering with a mock client (session inserted once,
holiday rows kept, **only changed/new rows sent**, email only on billed-present→X, **every step's error
surfaced with its step name**, **no `session_coach_absences` call**), drift tests for the three copied
helpers (`attendancePayload`, `attendanceSaveError`, `creditNoteEmail`), lessons grouping. pgTAP already
from A.3. Playwright `verify-admin-lesson-detail.mjs`: mark a fixture lesson Present/Absent as admin →
row visible on `/attendance` audit **and** an `audit_log` row with `action='attendance_saved'` exists
for it (RISK 1); Set all; refused pre-floor date shows the DB message; a CN001 fixture shows the mapped
message (RISK 2); assign substitute → card shows Sub; book make-up → guest row appears and count becomes
`x+1/cap`; the coach-app round-trip (RISK 7). Extend `verify-unmarked-lessons.mjs` expectation if the
badge counts change nothing there (it shouldn't).

**C.4 Ship C**: same as B.5; bundle grep for `"Lessons"`.

## 5. Docs at close (`/update-docs`)
- PRD §7.3 (capacity, colour), §7.6 — **rewrite the sentence at `PRD.md:1118` "there remains no
  attendance-writing anywhere in the admin panel"** (✎ corrected by review: line 1118, not 1122); new
  §7.21 *Admin calendar & lesson page*; §9.6 fields; note the widened `audit_log_insert`.
- BACKLOG: close *Admin per-lesson attendance marking*; add *Location entity* (promote `location_name` to
  a table; blocked-on list: calendar filter, Maps link), *Parent self-enrolment* now unblocked by capacity,
  *DB-side capacity guard in `book_makeup`/`book_trial`* (RISK 3 prohibition), and *`mark_day_holiday`
  uses `deactivated_at::date` (UTC) where the engine uses SGT* (RISK 6 drift).
- GOTCHAS: whatever bites (candidates: RISK 5 migration/UI vehicle split → §7.191; sticky + overflow
  interplay; SGT cut-off for `deactivated_at`; "the audit_log INSERT policy is coach-shaped — a new
  client writer of lesson audit rows needs its own disjunct").
- HANDOVER §8.71, §9; DEPLOYMENT §11.30 (order: A migration → B/C apps).

## 6. Estimates (single engineer, this session)
- A: ~2 h (migration incl. the audit policy + DOWN rehearsal + 2 pgTAP files + form fields + deploy checks)
- B: ~5 h (core + grid + tooltip + month/agenda + tests + driver)
- C: ~5.5 h (detail page + save path + substitutes/guest cards + lessons list + tests + driver + coach round-trip)

## Pre-commit gate

Ranked by blast radius; the first three are the ones that must be green before any UI is written.

**Top three**
- [ ] **RISK 1 — admin write path under RLS, incl. the audit row.** `admin_marks_attendance.test.sql`
      green twice (A.3); `audit_log_insert` widened in A.1; `adminAttendanceSave` surfaces every step's
      error with its step name (C.1 vitest); driver sees an `audit_log` row after an admin save.
- [ ] **RISK 2 — admin as a second writer of the credit-note trigger.** pgTAP: billed `present→absent`
      mints one note, flip-flop keeps one row per `invoice_item_id`, applied-credit un-correction throws
      `CN001` (A.3); admin save sends only changed/new rows and maps `CN001` via the copied
      `attendanceSaveErrorMessage` (C.1); no retry/force/per-row split.
- [ ] **RISK 3 — count parity with the billing gate (over-slotting).** vitest
      `enrolled + guests === expectedStudentsOn(...).length` over the unenrolled / trial-then-enrolled /
      cancelled-make-up fixture (B.1); enrolments loaded without `is_active`; bookings by host class
      with `cancelled_at IS NULL`; "full" is a confirm, not a DB rule.

**The rest**
- [ ] RISK 4 — no phantom sessions: B writes nothing (driver asserts `lesson_sessions` count unchanged);
      off-weekday deep link has no Save; Holiday confirm names students + extension days.
- [ ] RISK 5 — deploy order: `supabase migration list --linked` shows the A migration applied **before**
      the A.4 UI merges to `main`; DOWN rehearsed; remote grant dump taken. → graduate to GOTCHAS §7.191
      if it bites.
- [ ] RISK 6 — retired-class cut-off uses `toSgDate(deactivated_at)` (engine parity), the 23:30/00:30 SGT
      pair in vitest; the `mark_day_holiday` drift is logged in BACKLOG, not fixed here.
- [ ] RISK 7 — coach-app regression: admin save never touches `session_coach_absences` (mock assertion);
      coach round-trip driver shows admin marks, coach save leaves admin `holiday` rows intact; main coach
      comes from `attributeLessons` / `class_rates`, never `classes.coach_id` alone.
- [ ] RISK 8 — no date in `useState`; URL is the anchor; Today/floor computed at use time (§7.95).
- [ ] RISK 9 — `capacity`/`colour` saved in the same UPDATE statement as `category_id`.
- [ ] RISK 10 — attendance `in(...)` chunked ≤200 ids, chunker unit-tested.
