# SwimSync — Session Handover

_Last updated: 2026-07-15_

Read this first to get up to speed, then `PRD.md` for the product spec
and `LOCAL_DEV_GUIDE.md` for the exact run/test commands and seed logins.

---

## 1. What SwimSync is

Swim-coach attendance & billing app for Singapore. Three roles:
- **Parent** — self-registers (mobile), adds children, views attendance, invoices,
  credit notes, and the coach's PayNow QR to pay.
- **Coach** — marks/edits attendance (mobile), views their students' billing,
  uploads their PayNow QR.
- **Superadmin** — web admin panel: assigns children to classes, manages
  classes/coaches, oversees invoices/credit notes.

**Stack:** Expo (React Native) mobile app `SwimSyncApp/`, Next.js admin
`SwimSyncAdmin/`, Supabase backend (Postgres + Auth + Storage + Edge Functions).

---

## 2. Where the code lives (GitHub)

- **Repo:** https://github.com/kahhangwork/SwimSync — **public**, owned by
  `kahhangwork`. `gh` CLI is installed and authenticated as that account.
- **Single `main` branch** — all work is merged there and pushed; `main` local
  and remote are in sync.
- **Workflow used this session (no PRs):** create a feature branch off `main`
  → implement → verify → `git checkout main && git merge <branch>` → push
  → delete the merged branch (local + remote). Keep using this unless the user
  asks for PRs.

---

## 3. Current state — what works (verified end to end, local stack)

The **entire MVP core loop works and is verified across the UI + backend**:
parent register → add child → superadmin assign → coach attendance →
invoice generation → credit-note corrections → PayNow QR payment display.

- **Auth & onboarding** — parent self-registration (auth trigger creates
  `profiles` + `parents`), add child, superadmin assignment.
- **Password reset (verified UI + backend)** — the "Forgot password?" link on the
  mobile login now drives a full recovery flow: `resetPasswordForEmail` → recovery
  email → in-app **Set New Password** screen → `updateUser`. Works on Expo web
  (`detectSessionInUrl`) and native (`swimsync://` deep link parsed in the root
  layout); a recovery session routes to the reset screen instead of the home tab.
  Login/register errors are mapped to friendly copy (`lib/authErrors.ts`).
- **Attendance** — coach marks/edits per session; audit-logged.
- **Invoice generation** — one `generate-invoices` engine, two modes: **automatic**
  (cron-style; respects the `app_settings.auto_invoice_enabled` switch, a
  completeness gate, and seals the month) and **manual on-demand** (admin button).
- **Credit-note flow (verified UI + backend)** — editing an invoiced attendance
  row billable→non-billable auto-issues a credit note and adds to the parent's
  pooled `credit_balance`; the next invoice draws it down FIFO. A partial-
  application ledger bug was found and fixed (see §6). Driven end to end through
  the coach edit screen → parent Billing → admin Credit Notes.
- **PayNow QR (verified UI + backend)** — coach uploads their QR in `(coach)/settings`
  (→ `paynow-qr/<coach_id>/…` storage → `coaches.paynow_qr_url`); the parent sees
  it on the invoice's PayNow screen; the admin Coaches page shows it.
- **Full RLS** — parents see only their data, coaches only their classes,
  superadmin everything. Covered by automated isolation tests.
- **Automated tests** — backend **34 pgTAP + 8 Deno**, plus frontend suites
  (`SwimSyncAdmin` vitest, `SwimSyncApp` jest-expo); all run in CI on push to `main`. See §5.

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`). The full loop is verified end to end on cloud
(incl. a live password-reset round-trip on `swimsync.sg`). A **real coach + 4 real
classes** are onboarded and the production DB is a **clean slate** (only the
superadmin + the real coach/classes). See §11.

**Not done yet** (see §9): real **parent onboarding** — parents self-register + add
their kids via **`swimsync.sg/welcome`**, then the superadmin assigns each to a class;
this is the last gate before real billing. Native App Store / Play Store builds remain
deferred (web app on iPhone for now).

---

## 4. How to run locally

Prereqs: Docker Desktop running, Supabase CLI (`supabase --version`).

```bash
cd /Users/kahhang/Documents/Code/SwimSync

# 1. Start the local Supabase stack (Postgres/Auth/Storage/Studio)
supabase start                 # Studio http://127.0.0.1:54323 · Mailpit :54324

# 2. Apply migrations + seed (clean slate — WIPES test data)
supabase db reset              # runs supabase/migrations/* then supabase/seed.sql

# 3. Serve the Edge Function (needed for invoice generation + PayNow flows)
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt

# 4. Admin panel (separate terminal)
cd SwimSyncAdmin && npm run dev            # http://localhost:3000

# 5. Mobile app (separate terminal)
cd SwimSyncApp && npx expo start           # press w (web) or i (iOS sim)
```

**Env files** (git-ignored) point at local. `.env.example` files document the
shape. `CRON_SECRET=local-dev-cron-secret` is shared between
`supabase/functions/.env` and `SwimSyncAdmin/.env.local`.

> **`config.toml` changes need a stack restart.** Auth settings like
> `[auth].additional_redirect_urls` (the password-reset redirect allow-list) are
> only read when the stack boots. After editing `supabase/config.toml`, run
> `supabase stop && supabase start` (or `supabase db reset`) or the recovery link
> will be rejected. A `supabase start` on a fresh clone already reads it, so this
> only bites when you edit the file against an already-running stack.

**Seed accounts** (see `LOCAL_DEV_GUIDE.md`): superadmin & coach at
`*@swimsync.test` / `password123`, plus one class "Saturday Beginners". Parents
self-register in the app. Superadmin is **web-only** (mobile shows an
"unrecognised role" alert).

**Driving the UI without a device:** the **`run-ui-playwright`** project skill
launches + drives both apps in the browser (Expo web + Next.js admin) via
Playwright/Chrome, and captures the RN-web quirks (login, force-click, nav). Use
it to verify UI changes or reproduce the credit-note / PayNow flows. See
`.claude/skills/run-ui-playwright/SKILL.md` and `AVAIL_SKILLS.md` for all skills.

---

## 5. Running the tests

Backend integration tests run against the **local** stack (prereq:
`supabase start`) and are hermetic (self-seed + roll back / tear down). Frontend
tests are plain unit/component tests (no stack needed). All four run in CI on
push/PR to `main` (`.github/workflows/ci.yml`).

```bash
# Backend — Database tests (pgTAP): triggers, RLS, constraints, §11 edge cases
supabase test db                                  # 34 tests across 4 files

# Backend — Function tests (Deno): generate-invoices billing math + credit ledger
supabase/functions/generate-invoices/test.sh      # 8 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component + logic tests (vitest)
cd SwimSyncAdmin && npm test                       # 35 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 29 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (4) | one-invoice-per-parent-per-month, one active enrolment per student, positive-only credit applications, credit notes immutable to app roles |
| `credit_note_trigger.test.sql` (11) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson); **11.6** the correction leaves the original invoice intact (not modified/deleted) and the note links back to it |
| `rls_isolation.test.sql` (10) | RLS parent/parent isolation + superadmin sees all; **11.3** a parent sees all their children across coaches while each coach sees only students in their own classes |
| `edge_cases.test.sql` (9) | PRD §11: **11.2** a child created before assignment defaults to unassigned with an empty (not error) class view, **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |

_Deno engine tests — `supabase/functions/generate-invoices/core.test.ts` (run by `test.sh`):_
billable-only summing, paid vs free trial, no double-billing, the auto/manual
completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, and **11.7** credit-exceeds-
invoice carry-forward (+ ledger invariants via `checkInvariants`).

_PRD §11 edge cases are now all individually tested_ — 11.1 & 11.7 (Deno),
11.2/11.4/11.5/11.8 (`edge_cases`), 11.3 (`rls_isolation`), 11.6 (`credit_note_trigger`).

_Frontend tests:_
`SwimSyncAdmin` uses **vitest** + Testing Library (`vitest.config.ts`,
`components/StatusBadge.test.tsx`, `lib/lessonDates.test.ts`,
`lib/classCoverage.test.ts`); `SwimSyncApp` uses **jest-expo**
(`jest.config.js`, `lib/authErrors.test.ts`, `lib/lessonDates.test.ts`, scoped to
`lib/**` unit tests for now). Deeper component-render tests (RN screens with mocked
Supabase, admin tables) are the natural next additions.

_Note:_ `SwimSyncApp` does **not** typecheck clean on `main` — 5 pre-existing
`tsc` errors in `app/(parent)/home/child/[id].tsx` (Supabase join typing). CI runs
jest, not `tsc`, for the app. Don't mistake them for your own breakage.

_UI drivers (`.claude/skills/run-ui-playwright/drivers/`, run by hand, not CI):_
`verify-unmarked-lessons.mjs` + `fixtures-unmarked-lessons.sql` drive the whole
unmarked-lesson loop (admin gap report → coach backlog → mark → both go green);
`verify-tz-saturday.mjs` pins the SGT-vs-UTC regression using Playwright's clock
API — it **fails on the pre-fix code**, which is the point.

See LOCAL_DEV_GUIDE §"Running the tests".

---

## 6. Architecture & key decisions

- **Backend = ordered CLI migrations** in `supabase/migrations/` (source of truth):
  `20260309000100`→`001000` (schema, auth trigger, credit-note trigger, RLS,
  storage, grants, session/audit, app_settings) plus `20260711000100_credit_applications`.
  Never edit the historical `Database_*` files.
- **Invoice engine split for testability:** `generate-invoices/core.ts` holds the
  billing logic (exported `generateInvoices(supabase, opts)`); `index.ts` is a thin
  Deno.serve handler (auth + client + call). Behaviour is identical either way.
- **Credit is pooled per PARENT** (`credit_notes.parent_id` + `parents.credit_balance`);
  a note's `student_id` is provenance only, so credit earned from one child is
  spendable against any child (invoices are one-per-parent-per-month).
- **`credit_applications` ledger** records every partial draw of a note against an
  invoice, so the note ledger reconciles with `invoices.credit_applied`. Invariants:
  `SUM(applications by invoice) = credit_applied`; `credit_balance = SUM(remaining across notes)`.
- **RLS** uses `SECURITY DEFINER` helpers (`is_superadmin()`, `current_parent_id()`,
  `current_coach_id()`, `coach_serves_parent()`) to avoid policy recursion — see
  `20260309000600_rls_policies.sql`.
- **Tab navigation:** every tab folder in `(coach)/` and `(parent)/` has its own
  nested `_layout.tsx` (a `Stack`), so detail screens push within the tab instead of
  leaking as extra tab buttons. Add a nested `_layout` for any new tab section.
- **Cron** (`supabase/cloud/cron_schedule.sql`) is **cloud-only** (needs pg_cron/pg_net
  + project-ref + CRON_SECRET); kept out of local migrations.
- **Grants matter:** tables created by the `postgres` migration role don't auto-grant
  DML to `authenticated`/`service_role`; `20260309000800_grants.sql` does it (and sets
  default privileges that cover later tables).
- **There is no lesson-session generator, and that's deliberate** (PRD §7.5 is
  knowingly unimplemented). `lesson_sessions` rows are created **lazily** by the coach's
  attendance save — the only writer in the codebase. Sessions are keyed
  `UNIQUE (class_id, session_date)`, and the attendance screen is fully **date-driven**
  (takes any `date`, resolves-or-creates that date's session, pre-fills existing rows),
  so back-dating Just Works and nothing is ever overwritten. What was missing was not
  the rows but a **reckoning**: which lessons *should* have happened. That is derived at
  read time from `classes.day_of_week` (`lib/lessonDates.ts`) — see §8. Don't "fix" this
  by pre-generating sessions unless you have a reason the read-time derivation can't
  serve; pre-generation adds a job, a schedule, and edge cases when classes change.
  - A class that legitimately didn't run needs **no new concept**: the coach marks
    everyone `cancelled_rain`/`cancelled_coach` (non-billable), which creates the
    session and drops the date out of the backlog permanently.
  - **Completeness rule, hand-written in four places** — a lesson counts as marked only
    when its session exists **and every actively-enrolled student has an attendance row
    on it**: `core.ts:141-152` (engine gate), `SwimSyncAdmin/lib/classCoverage.ts`
    (admin dialog), `(coach)/today/index.tsx` (`fullyMarked`), and
    `(coach)/classes/[id]/roster.tsx` (`marked_count` + `isComplete`). The engine copy is
    unavoidable (Deno, no npm resolution), but the rest is duplication waiting to drift —
    **if you touch the rule, touch all four**, and consider extracting a shared helper
    while you're there.
- **Dates are Singapore-local; never derive a date string from `toISOString()`.** That
  yields the **UTC** date, which is the *previous day* in SGT (UTC+8) before 08:00 —
  this shipped a real double-billing bug (§7.7). Use `todayInSg()` / `toSgDate()` from
  `lib/lessonDates.ts`, and derive a weekday from that same string via `dayOfWeekOf()`
  rather than a separate `new Date().getDay()`. Full ISO **instants** (`paid_at`,
  `updated_at`) are fine as-is — only date-*string* derivations are affected.
- **`lib/lessonDates.ts` is duplicated byte-identical in both apps** — deliberate. There
  is no shared package: separate npm projects, no workspaces, different React majors,
  different bundlers/test runners. Sharing ~120 lines of pure date maths would need
  workspace + Metro `watchFolders` + `transpilePackages` surgery. The file has **zero
  imports** so drift is cheap to spot (`diff` the two); each has its own test file
  (identical but for jest-globals vs a vitest import). **Edit both.**
- **Swimming ability/level is NOT a parent-set field.** Parents no longer choose a
  swimming ability when adding a child, and nothing writes `students.swimming_ability`
  (it stays NULL — no hard-coded value). A child's **class name** is what indicates their
  level. The `swimming_ability` column (nullable enum) is intentionally **kept** for a
  future "coach-defined levels" feature but is unused/unshown today — the field was
  removed from the Add-Child form and from all displays (parent home + child detail, coach
  roster, admin students/dashboard/unassigned). Don't re-add a parent-facing level picker;
  when levels return, they should be coach-defined (likely free-text or a new table, not
  the current fixed beginner/intermediate/advanced enum). Verified end-to-end on the local
  stack (add child → DB NULL → parent + detail render with no level, no crash).

---

## 7. Gotchas already hit (don't re-introduce)

1. `insert().select()` under RLS needs the row to pass the SELECT policy immediately
   (see `students.created_by`).
2. Attendance uses `lesson_session_id` (not `session_id`); `marked_by` is a **profile**
   id, not a `coaches.id`. Resolve a coach from an invoice via the item's
   `lesson_session_id` → `classes.coach_id` (a bug used the invoice_item id by mistake).
3. `lesson_sessions.start_time/end_time` are NOT NULL — filled by a BEFORE INSERT
   trigger from the class (`20260309000900`).
4. `useFocusEffect` must get a sync callback, not `async`.
5. `absent` is NOT billable (only `present` + `trial_paid` are — PRD 5.4).
6. When applying credit, draw down notes by the **actual consumed amount** and write a
   `credit_applications` row; only flip a note to `applied` once fully consumed
   (regression-tested in `core.test.ts`).
7. **`new Date().toISOString().split("T")[0]` is a bug in SGT** — it's the UTC date, a
   day behind before 08:00 local. Worse, pairing it with a **local** `getDay()` lets the
   weekday and the date disagree: the Today screen listed Saturday's classes while
   writing attendance to Friday's date, and re-marking later created a second session
   that **double-billed everyone**. Use `todayInSg()` + `dayOfWeekOf()` (§6). Pinned by
   `verify-tz-saturday.mjs`; audit with
   `grep -rn --include="*.ts" --include="*.tsx" -e "toISOString()\.split" -e "toISOString()\.slice" SwimSyncApp SwimSyncAdmin`.
8. **The engine's completeness gate never fires on the admin path.**
   `SwimSyncAdmin/app/api/generate-invoices/route.ts` hardcodes `force: true`, which
   bypasses the gate, the auto switch, and the month seal — and cron isn't wired on the
   free tier, so the auto path never runs at all. The **admin confirm modal's gap report
   is therefore the only thing standing between a forgotten lesson and an underbill.**
   It warns rather than blocks, by design. Don't assume the server will catch it.

---

## 8. What changed this session (2026-07-15)

**Closed the silent-underbilling hole before the first real invoice run.**

- **The gap that was found:** `lesson_sessions` has exactly one writer — the coach's
  attendance save (`attendance.tsx`). There is no session generator (PRD §7.5 is
  unimplemented), so **a lesson nobody marked is indistinguishable from a lesson that
  never happened**. The coach had no way to reach a past date (roster only offered
  "Mark Attendance — Today"; Past Sessions queried `lesson_sessions`, so an unmarked
  Saturday rendered *nothing*). Nothing warned anyone: the engine's completeness gate
  only iterates over sessions that *exist*, and is unreachable anyway because the admin
  route hardcodes `force: true`. A forgotten Saturday ≈ **$600 silently unbilled**.
- **Fix — read-time expected-vs-marked.** No schema change, no cron, no pre-generated
  sessions. Expected lesson dates are derived from `classes.day_of_week`:
  - **Coach Today tab** — an **Unmarked Lessons** card (only when non-empty) listing
    past lessons that aren't fully marked; tap → the existing date-driven attendance
    screen → mark → it clears.
  - **Coach roster** — "Past Sessions" now merges in expected-but-missing dates as a
    third **"Not marked"** state, instead of silently omitting them.
  - **Admin Invoices** — the pre-generation modal now *queries*: per class
    `N of M lessons marked` + the **missing dates named**, or a green all-clear. It
    warns, it doesn't block (button becomes **Generate anyway**) — a class that
    genuinely didn't run is a legitimate reason to proceed.
- **Timezone bug fixed (was live, could double-bill).** `today/index.tsx` mixed two
  clocks: `getDay()` (**local**) picked the weekday while `toISOString()` (**UTC**)
  picked the date. Before 08:00 SGT these disagree — the screen listed Saturday's
  classes while writing attendance to **Friday's date**; re-marking later created a
  second session and **double-billed everyone**. Reproduced in a real browser at 07:30
  SGT (header read "Saturday, 18 July" while the app targeted `date=2026-07-17`), then
  fixed. All date strings now come from `todayInSg()`, and the weekday is *derived from
  that same string* (`dayOfWeekOf`) so the two can never diverge again.
- **New pure helpers** (unit-tested, zero imports): `lib/lessonDates.ts` — duplicated
  **byte-identical** in both apps (no shared package exists; see §6) — plus
  `SwimSyncAdmin/lib/classCoverage.ts` for the coverage maths. All date *display* now
  goes through `formatSgDate()`, which forces `timeZone: "UTC"` internally so a caller
  physically cannot reintroduce the day-drift bug.
- **Incidental fix — the coach's "Outstanding" stat card changed meaning.** Widening the
  class query for the backlog also widened `classIds`, which that card's query reuses. It
  counted outstanding invoices only among parents of students in *today's* classes — so
  on any non-Saturday it read **"0 Outstanding"**, implying everyone had paid. It now
  counts across all the coach's students, matching its own comment and its label. Called
  out here because it rode along in a backlog commit rather than arriving on its own.
- **Tests:** +23 `lessonDates` in each app, +9 `classCoverage` (admin). Frontend suites
  now 29 (app) / 35 (admin). A `run-ui-playwright` driver
  (`verify-unmarked-lessons.mjs` + `fixtures-unmarked-lessons.sql`) drives the whole
  loop; `verify-tz-saturday.mjs` pins the timezone regression and **fails on the
  pre-fix code** (verified).
- **`INVOICE_RUNBOOK.md`** — read the gap report before generating; plus a warning that
  the engine's default billing month is UTC-derived and would bill the wrong month if
  cron were ever switched on.

**Not done (deliberate):** no bulk "set all to…" on the attendance screen — cancelling
a rained-out class is 17 × 2 taps, which is where a coach abandons the task, and an
abandoned cancellation looks exactly like a forgotten lesson. Additive; ships separately.

## 8b. What changed (2026-07-13 → 07-14)

- **Production email via Resend on `swimsync.sg`** — cloud custom SMTP
  (`smtp.resend.com:465`, sender `noreply@swimsync.sg`); branded reset template
  `supabase/templates/recovery.html` wired in `config.toml` + pasted into the
  dashboard. Full reset round-trip verified live on `swimsync.sg`. See §11.
- **Custom domains live** — app **`swimsync.sg`** (apex, canonical) + `www` 308-redirect;
  admin **`admin.swimsync.sg`**. DNS on **Cloudflare**, all Vercel records **DNS-only**
  (orange proxy breaks Vercel SSL); had to delete Cloudflare's imported parking A records
  first (an A `@` blocks a CNAME `@`). Supabase Site URL + redirect allow-list moved to
  the new domain. No code change (no hard-coded URLs; reset uses `window.location.origin`).
- **Clean-slate production DB + real coach onboarded** — wiped all demo data
  (TRUNCATE business tables + delete non-superadmin `auth.users`, run in the dashboard
  SQL editor — no service key locally). Real coach **Kah Hang** (`kahhangg+coach@gmail.com`)
  + 4 Saturday classes @ Tanglin View (Beginner $40 / SwimSafer L5 $35 / L6 $35 /
  Graduated $40) + PayNow QR. **FK note:** `classes.coach_id → coaches(id)` has NO cascade,
  so a coach can't be deleted while a class references them.
- **Parent onboarding page** `swimsync.sg/welcome` (`app/welcome.tsx`) — public 4-step
  guide; a `PUBLIC_PATHS` guard in the root layout keeps it from bouncing to /login.
  Plus a WhatsApp copy for broadcast.
- **Swimming ability removed as a parent field** (see §6) — parents no longer set it;
  `students.swimming_ability` stays NULL; column kept for future coach-defined levels.
- **Attendance-confirmation modal** before invoice generation (admin Invoices page).
- **`INVOICE_RUNBOOK.md`** — monthly manual invoice-generation procedure.
- **All PRD §11 edge cases now individually tested** — added 11.2/11.3/11.6 pgTAP
  (suite 22 → 34). CI green across backend + both frontend jobs.
- All merged to `main`, pushed, CI-verified.

## 8c. Session (2026-07-12)

- **Auth polish — password reset** — implemented the mobile recovery flow end to
  end: new `(auth)/forgot-password.tsx` + `(auth)/reset-password.tsx` screens, wired
  the previously-dead "Forgot password?" link, added `PASSWORD_RECOVERY` routing +
  a native `swimsync://` deep-link handler in `app/_layout.tsx`, and switched the
  client to `detectSessionInUrl` on web only (`lib/supabase.ts`). Allow-listed the
  reset redirect URLs in `supabase/config.toml` (needs a stack restart to apply).
- **Auth error hardening** — new `lib/authErrors.ts` maps raw Supabase auth
  messages to friendly copy, wired into login/register + the two new screens.
- **Verified** end to end via `run-ui-playwright` + Mailpit (coach account): forgot →
  email → reset screen (no bounce to home) → new password → re-login. Error mapping
  checked against live Supabase strings. Coach seed password restored to `password123`.

## 8d. Session (2026-07-11)

- **Credit-note ledger fix** — added `credit_applications` (migration `20260711000100`)
  + updated the engine so partial credit reconciles; verified UI + backend.
- **Tab-bar fix** — nested `_layout.tsx` in every coach/parent tab folder (no more
  stray tab buttons; correct titles/icons).
- **PayNow QR** — implemented coach upload + fixed the parent coach-resolution bug.
- **Automated tests** — first suite (Deno + pgTAP); refactored the engine into
  `core.ts` + `index.ts`.
- **Tooling/docs** — `run-ui-playwright` skill, `AVAIL_SKILLS.md`, and pushed the whole
  repo to GitHub (see §2).

---

## 9. Next steps (pick with the user)

**The "finish MVP loose ends" plan is complete** (email, custom domain, coach
onboarding, welcome page, swimming-ability removal, invoice runbook, edge-case tests),
and the **silent-underbilling hole is closed** (§8). Genuinely open now:

- **Real parent onboarding — the gate to real billing.** Send parents
  **`swimsync.sg/welcome`** → they self-register + add their children → the superadmin
  assigns each to a class (admin **Unassigned Children**). ~17 real students are expected
  across the 4 classes. Students are **parent-created** in this model (coaches/admin can't
  create them), so this is a real onboarding push.
- **First real invoice run** — once a Saturday's attendance is marked, follow
  **`INVOICE_RUNBOOK.md`** on the 1st (manual; no cron on the free tier). The confirm
  dialog now reports any lesson with no attendance marked — **read it**; it's the only
  backstop (§7.8).
- **Bulk "set all to…" on the attendance screen** — cancelling a rained-out class is
  currently 17 × 2 taps, one student at a time. That's where a coach abandons the task,
  and an abandoned cancellation is indistinguishable from a forgotten lesson. Purely
  client-side (populate the existing state map); the highest-value small follow-up.
- **Native store builds** — EAS → Android APK / iOS TestFlight, deferred until the user
  invests (staying web-only for now).
- **If asked:** a delete-coach action in the admin UI (currently dashboard-only SQL); a
  coach-defined swimming-levels feature (the `students.swimming_ability` column is retained
  for this). Email confirmation is intentionally **OFF**.

The bullets below are a **record of already-DONE work** (kept for reference):

- **Cloud deployment — DONE (2026-07-12).** Live on free infra, web-first. See §11.
  Remaining deployment work: **native builds** (EAS → Android APK / iOS TestFlight)
  once the user decides to invest so parents can download from the stores; cron is
  intentionally **not** wired (invoices are generated manually via the admin button).
- **`Alert.alert` is a no-op on RN-web — fully swept (see §12a).** Sign Out uses
  `lib/confirm.ts` `confirmAction`; a global **Toast** (`store` + `components/Toast.tsx`
  at the root layout, `showToast(msg, type)`) now carries all login/validation/success
  feedback that was previously invisible on web; and alerts whose OK handler redirected
  (register, reset-password, add-child, attendance) now navigate directly. The **only**
  remaining `Alert.alert` is the native-only media-library permission prompt in coach
  settings (guarded by `Platform.OS !== "web"`).
- **Removed dead settings stubs** — Notification Preferences (coach + parent) and
  Help & Support (parent) had empty handlers; deleted.
- **Admin "Forgot password?" flow — DONE.** New `SwimSyncAdmin/app/forgot-password`
  + `app/reset-password` pages + a link on the login (mirrors the mobile reset). The
  admin reset URL is now `https://admin.swimsync.sg/reset-password` (in the Supabase
  redirect allow-list — see §11). UI verified on cloud.
- **Coach Billing screen — DONE (2026-07-12).** Was placeholder mock data with a dead
  button; now queries live invoices (RLS-scoped) and marks them paid (invoice update +
  `payment_records` insert), web-safe via Toast/`confirmAction`. Added migration
  `20260712000100` + `coach_serves_parent_profile()` so a coach can read served-parents'
  names. UI-verified via `run-ui-playwright`.
- **Smoke-test remaining screens — DONE (2026-07-12).** Admin attendance/students/dashboard
  driven at runtime (deep joins resolve, no NaN/empty tables) via
  `drivers/smoke-admin-screens.mjs`.
- **Frontend/component tests + CI — DONE (2026-07-12).** GitHub Actions
  (`.github/workflows/ci.yml`) runs the pgTAP + Deno suites **and** the frontend suites
  (`SwimSyncAdmin` vitest, `SwimSyncApp` jest-expo) on every push/PR to `main`. See §5.
- **Auth polish** — mobile password reset, friendly login/register errors, and the
  **admin "Forgot password?" flow** are all **done**. Still open: email confirmation
  copy/templates are Supabase defaults.
- **PRD §11 edge cases — ALL covered by dedicated tests (done)** (see §5 catalog):
  11.1 & 11.7 (Deno); 11.2/11.4/11.5/11.8 (`edge_cases`), 11.3 (`rls_isolation`),
  11.6 (`credit_note_trigger`). pgTAP suite is now 34 tests across 4 files.

---

## 10. File map

| Path | What |
|------|------|
| `supabase/migrations/` | Schema, RLS, triggers, grants (ordered, source of truth) |
| `…/20260309000500_credit_note_trigger.sql` | Auto-issues a credit note on billable→non-billable edit of an invoiced lesson |
| `…/20260711000100_credit_applications.sql` | Credit-note allocation ledger (fixes partial-application drift) |
| `supabase/functions/generate-invoices/core.ts` | Billing engine logic (exported, tested) |
| `supabase/functions/generate-invoices/index.ts` | Thin HTTP handler (auth + client + call core) |
| `supabase/functions/generate-invoices/core.test.ts` · `test.sh` | Deno integration tests + runner |
| `supabase/tests/*.test.sql` | pgTAP DB tests (trigger, RLS, constraints) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/`, each tab folder has a nested `_layout.tsx` |
| `…/(auth)/forgot-password.tsx` · `reset-password.tsx` | Password-reset flow (request link + set new password) |
| `SwimSyncApp/app/_layout.tsx` | Root: session restore + `PASSWORD_RECOVERY` routing + native recovery deep-link handler |
| `SwimSyncApp/lib/authErrors.ts` | Maps raw Supabase auth errors to friendly copy |
| `SwimSyncApp/lib/lessonDates.ts` · `SwimSyncAdmin/lib/lessonDates.ts` | **Byte-identical twins** — SG-safe date strings + expected lesson dates. Edit both (§6) |
| `SwimSyncAdmin/lib/classCoverage.ts` | Expected-vs-marked coverage maths for the admin pre-generation check |
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `.claude/skills/run-ui-playwright/` | Skill to launch + drive both UIs (Playwright/Chrome) |
| `AVAIL_SKILLS.md` | Reference for all available skills |
| `LOCAL_DEV_GUIDE.md` | Run/test commands, seed logins, service URLs |
| `INVOICE_RUNBOOK.md` | Monthly manual invoice-generation procedure (superadmin) |
| `PRD.md` | Product spec (*(implemented)* sections = build decisions) |

Memory files (Claude project memory dir) also capture project state + backend
gotchas: `swimsync-project`, `swimsync-backend-gotchas`.

---

## 11. Cloud deployment (live, free tier — 2026-07-12; custom domain + email 2026-07-14)

**Web-first, $0.** The user is on iPhone; rather than pay $99/yr for an iOS native
build, the Expo app is exported as a **static web app** and used in Safari. Native
store builds are deferred until the app "sticks."

| Piece | Where | Notes |
|-------|-------|-------|
| **Backend** | Supabase project `cdmjeyauhxcgulhbxmsb` (region ap-southeast-1) | Free tier. Linked via `supabase link`; schema via `supabase db push`. |
| **Edge Function** | `generate-invoices` deployed | Auth via `CRON_SECRET` secret (set with `supabase secrets set`). Cold-start ~5–8s. |
| **Admin panel** | Vercel `swimsync-admin` → **https://admin.swimsync.sg** (also `swimsync-admin.vercel.app`) | Root `SwimSyncAdmin`, **framework preset = Next.js**. |
| **Mobile app (web)** | Vercel `swimsync-app` → **https://swimsync.sg** (apex, canonical; `www` 308-redirects; also `swimsync-app-psi.vercel.app`) | Root `SwimSyncApp`, **preset = Other** (`SwimSyncApp/vercel.json`: `expo export --platform web` → `dist`, SPA rewrite). |
| **Email** | **Resend** → sender `noreply@swimsync.sg` | Cloud custom SMTP `smtp.resend.com:465` (user `resend`, pass = Resend API key, dashboard-only). Branded reset template (dashboard + `supabase/templates/recovery.html`). Auth email rate limit raised 2→~30/hr. Confirmation stays **OFF**. |
| **Domain / DNS** | `swimsync.sg` registered at **Exabytes**, DNS on **Cloudflare** | Vercel web records (`@`, `www`, `admin`) are **DNS-only** (grey — orange breaks Vercel SSL); apex uses Vercel's per-domain CNAME (`<hash>.vercel-dns-017.com`, Cloudflare-flattened). Resend records (`send` MX/SPF, `resend._domainkey`, `_dmarc`) coexist. **Supabase Site URL = `https://swimsync.sg`**; allow-list includes `swimsync.sg/**`, `www.swimsync.sg/**`, `admin.swimsync.sg/**`. |

**Secrets/keys** live only in the dashboards (never committed): Supabase project keys
(new-format `sb_publishable_…` / `sb_secret_…`) + `CRON_SECRET` are set as Vercel env
vars on each project (see each `.env.example` for the var names). Local `.env` files
still point at the local stack for dev.

**Config gotchas hit during deploy (don't re-trip):**
1. **Next.js `15.2.0` is CVE-blocked by Vercel** — the build compiles then "Deployment
   failed". Bumped to `^15.5.20` (commit on `main`).
2. **Admin "No Output Directory named public"** = the Vercel **Framework Preset was
   "Other"**, not Next.js. Set it to Next.js.
3. **Cloud email confirmation defaults ON**; local had it off. A self-registering
   parent got stuck (see the `register.tsx` RN-web `Alert` bug in §9). Turned **Confirm
   email OFF** in Auth → Sign In/Providers → Email to match local.
4. **Auth redirect allow-list is dashboard-only on cloud** (not `config.toml`): Site URL
   = the mobile-web URL, plus `<mobile-web-url>/reset-password` (+ `/**`) in the redirect
   allow-list, for the password-reset flow.

**Verified live** end to end via `run-ui-playwright` against the cloud URLs (all three
roles): parent register → add child → superadmin assign → coach attendance → **manual
invoice via the Edge Function** ($25) → parent sees invoice → **coach PayNow QR upload
to Storage** (GET 200 image/png) → parent sees the QR.

**Invoicing is manual:** on the 1st, the superadmin opens the admin **Invoices** page →
pick the month → **Generate Invoices** (no cron; a paused free project wouldn't run it).

---

## 12. Removed / hidden UI stubs (READ before "re-adding" a button)

During the web deployment we found several buttons that were **placeholder stubs**
— rendered in the UI but with empty `onPress={() => {}}` handlers, so they did
nothing on **any** platform (not just web). These were **removed** so the shipped
app has no dead controls. If a future session is asked to "add X back," check here
first — it was intentionally removed as unbuilt, not lost.

| Screen (file) | Removed button | Why | To restore |
|---------------|----------------|-----|-----------|
| Coach Settings `app/(coach)/settings/index.tsx` | **Notification Preferences** | Push notifications are **out of MVP scope** (PRD §3.2). Was an empty stub. | Build a notifications feature first, then re-add a real `MenuItem`. |
| Parent Profile `app/(parent)/profile/index.tsx` | **Notification Preferences** | Same as above. | Same as above. |
| Parent Profile `app/(parent)/profile/index.tsx` | **Help & Support** | Empty stub; no support content/flow exists yet. | Add a real target (support email/link/FAQ screen), then re-add the `MenuItem`. |

**Implemented (not removed):** the **Change Password** buttons on both those screens
were also empty stubs — they are now **wired to a real screen**
(`components/ChangePasswordScreen.tsx`, routes `…/settings/change-password.tsx` and
`…/profile/change-password.tsx`). Kept & working: parent **Add Child Profile**.

### 12a. `Alert.alert` is a no-op on the web build (known pattern)

`Alert.alert` has **no `react-native-web` implementation** — on the deployed web app
it does nothing (no dialog, and none of its button `onPress` handlers fire). It works
normally on native iOS/Android. **This whole family has been swept** (verified on cloud
across sign-out, register, reset-password, login errors, add-child, coach QR/attendance).
The three mechanisms — reuse them for any new user feedback so it works on web too:

1. **Confirm dialogs** → `confirmAction(title, message, onConfirm, confirmLabel)` from
   `lib/confirm.ts` (web `window.confirm` / native `Alert.alert`). Used by Sign Out.
2. **Transient feedback** (errors, "Saved", "Uploaded", …) → the **global Toast**:
   `useAppStore.showToast(message, "success" | "error" | "info")`, rendered by
   `components/Toast.tsx` (mounted once in `app/_layout.tsx`). Auto-dismisses in 3s.
3. **Form validation** on auth screens → inline `error` state under the form
   (register / reset-password / Change Password), or a toast where there's no form slot.

For alerts that used an `onPress` to redirect, the fix does the navigation **directly**
(e.g. `showToast(...); router.back()`), since the old `onPress` never fired on web.

**Do NOT reintroduce `Alert.alert` for user feedback.** The only sanctioned use left is
the **native-only media-library permission prompt** in coach settings, guarded by
`Platform.OS !== "web"`. Audit with `grep -rn "Alert.alert" SwimSyncApp/app`. See also
the `run-ui-playwright` skill gotcha #5.
