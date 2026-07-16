# SwimSync — Session Handover

_Last updated: 2026-07-16_

Read this first to get up to speed, then `PRD.md` for the product spec,
`BACKLOG.md` for what's queued but unbuilt, and `LOCAL_DEV_GUIDE.md` for the exact
run/test commands and seed logins.

> **This file is one of three living documents, split by how often each changes**
> (see `README.md`): **PRD.md** = what exists · **BACKLOG.md** = what doesn't yet ·
> **HANDOVER.md** (this file) = the state you're inheriting. Keep them in their lanes —
> a feature idea belongs in `BACKLOG.md`, not §9 and not the PRD. The `/session-close`
> skill walks all three at the end of a session and updates each by its own rule.

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
- **Attendance** — coach marks/edits per session; audit-logged. A **"Set all ▾"** header
  menu bulk-sets every student to one status (Present/Absent/Cancelled-rain/coach) in one
  tap, with a confirm guard when some are already marked (§8c, PRD §7.6).
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
- **Coach Billing screen (verified UI)** — queries live invoices (RLS-scoped) and marks
  them paid (invoice update + `payment_records` insert), web-safe via Toast /
  `confirmAction`. Needs `coach_serves_parent_profile()` to show parent names (§6).
- **Unmarked-lesson safety net (verified UI + backend)** — expected lesson dates are
  derived from `classes.day_of_week` at read time (there is no session generator — §6):
  the coach's Today tab lists **Unmarked Lessons** and links straight to marking a past
  date, and the admin's invoice-generation dialog reports `N of M lessons marked` per
  class with the missing dates named. Closes the hole where a forgotten lesson was
  silently unbillable and invisible to everyone (§8g).
- **Parent Attendance states (verified UI)** — an unassigned child gets the
  "not assigned yet" state PRD §5.1 requires, distinct from "no lessons marked yet"
  (waiting on the coach) and an empty filter result (§8e).
- **Full RLS** — parents see only their data, coaches only their classes,
  superadmin everything. Covered by automated isolation tests.
- **Automated tests** — backend **34 pgTAP + 24 Deno**, plus frontend suites
  (`SwimSyncAdmin` vitest, `SwimSyncApp` jest-expo); all run in CI on push to `main`. See §5.

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`). The full loop is verified end to end on cloud
(incl. a live password-reset round-trip on `swimsync.sg`). A **real coach + 4 real
classes** are onboarded and the production DB is a **clean slate** (only the
superadmin + the real coach/classes). See §11.

> **`main` = what's live.** Vercel builds both sites from `main`, so a **push deploys** —
> there is no separate release step. `git log origin/main` is the honest answer to
> "what's in production"; don't trust a SHA written into prose here, including this one.
> As of 2026-07-16 that includes the bulk attendance **"Set all"** control, **admin class
> editing + a required day-of-week** (§8c), the unmarked-lesson safety net, and the parent
> Attendance fixes (§8e). **Caveat worth keeping:** every check on that work ran against **local
> fixtures** — none of it has been driven against the real production DB. No schema or
> migration is involved, so failure looks wrong rather than destroying data.

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
tests are plain unit/component tests (no stack needed). All four suites — plus a
`tsc --noEmit` typecheck of **both** apps — run in CI on push/PR to `main`
(`.github/workflows/ci.yml`).

```bash
# Backend — Database tests (pgTAP): triggers, RLS, constraints, §11 edge cases
supabase test db                                  # 34 tests across 4 files

# Backend — Function tests (Deno): generate-invoices billing math + credit ledger
supabase/functions/generate-invoices/test.sh      # 24 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component + logic tests (vitest)
cd SwimSyncAdmin && npm test                       # 38 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 38 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (4) | one-invoice-per-parent-per-month, one active enrolment per student, positive-only credit applications, credit notes immutable to app roles |
| `credit_note_trigger.test.sql` (11) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson); **11.6** the correction leaves the original invoice intact (not modified/deleted) and the note links back to it |
| `rls_isolation.test.sql` (10) | RLS parent/parent isolation + superadmin sees all; **11.3** a parent sees all their children across coaches while each coach sees only students in their own classes |
| `edge_cases.test.sql` (9) | PRD §11: **11.2** a child created before assignment defaults to unassigned with an empty (not error) class view, **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |

_Deno tests — `core.test.ts` + `email.test.ts` (run by `test.sh`):_ **Engine**
(`core.test.ts`): billable-only summing, paid vs free trial, no double-billing, the
auto/manual completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, **11.7** credit-exceeds-invoice
carry-forward (+ ledger invariants via `checkInvariants`), plus `result.created` shape and
two **stack-backed invoice-email orchestration** tests (recipients resolved from the DB;
no-op without a key). **Email** (`email.test.ts`): pure HTML builder + `sendInvoiceEmail`
(no-op without key, mocked-fetch success/failure, HTML escaping).

_PRD §11 edge cases are now all individually tested_ — 11.1 & 11.7 (Deno),
11.2/11.4/11.5/11.8 (`edge_cases`), 11.3 (`rls_isolation`), 11.6 (`credit_note_trigger`).

_Frontend tests:_
`SwimSyncAdmin` uses **vitest** + Testing Library (`vitest.config.ts`,
`components/StatusBadge.test.tsx`, `lib/lessonDates.test.ts`,
`lib/classCoverage.test.ts`); `SwimSyncApp` uses **jest-expo**
(`jest.config.js`, `lib/authErrors.test.ts`, `lib/lessonDates.test.ts`,
`lib/attendanceBulk.test.ts`, scoped to `lib/**` unit tests for now). Deeper
component-render tests (RN screens with mocked Supabase, admin tables) are the natural
next additions.

_Note:_ both apps now **typecheck clean** and CI enforces it — a **Typecheck (tsc)**
step runs `tsc --noEmit` for `SwimSyncApp` and `SwimSyncAdmin` in the `frontend-tests`
matrix (§8b). The app's 5 long-standing `tsc` errors in
`app/(parent)/home/child/[id].tsx` (Supabase join typing) were cleared with an `any`
cast. Run `npm run typecheck` in either app locally — but see §7.11: a local pass can
still be a CI fail because the Next/Expo type stubs it leans on are git-ignored.

_UI drivers (`.claude/skills/run-ui-playwright/drivers/`, run by hand, not CI):_
`verify-unmarked-lessons.mjs` + `fixtures-unmarked-lessons.sql` drive the whole
unmarked-lesson loop (admin gap report → coach backlog → mark → both go green);
`verify-parent-attendance.mjs` covers the parent Attendance screen — chip geometry read
from the DOM, plus all three empty states (unassigned / nothing marked / filtered out);
`verify-tz-saturday.mjs` pins the SGT-vs-UTC regression using Playwright's clock
API — it **fails on the pre-fix code**, which is the point;
`smoke-admin-screens.mjs` drives the admin attendance/students/dashboard pages at
runtime (checks the deep joins resolve — no NaN, no empty tables);
`verify-bulk-setall.mjs` (+ reuses `fixtures-unmarked-lessons.sql`) drives the bulk
"Set all" menu — the RN-web dropdown renders, the confirm guard fires only when a student
is already marked, and a bulk save persists `cancelled_rain` to the DB;
`verify-class-edit.mjs` drives the admin Classes page — the create form no longer defaults
the day (required choice) and an existing class edits Saturday→Sunday and persists.

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
- **Invoice emails live in `email.ts`, deliberately OUT of `core.ts`** (§8). The engine
  stays pure and returns a typed `created[]`; `index.ts` calls `emailCreatedInvoices()`
  *after* generation commits, so a delivery failure can never touch billing. Sends go via
  the **Resend HTTP API** (not Auth SMTP), keyed by `RESEND_API_KEY`, and are a **logged
  no-op when the key is unset** — so local + tests never send. Don't move sending into the
  engine or make it able to throw into the generation path. **The Edge Function is deployed
  by `supabase functions deploy`, NOT by a git push** (Vercel only builds the two web apps).
- **Credit is pooled per PARENT** (`credit_notes.parent_id` + `parents.credit_balance`);
  a note's `student_id` is provenance only, so credit earned from one child is
  spendable against any child (invoices are one-per-parent-per-month).
- **`credit_applications` ledger** records every partial draw of a note against an
  invoice, so the note ledger reconciles with `invoices.credit_applied`. Invariants:
  `SUM(applications by invoice) = credit_applied`; `credit_balance = SUM(remaining across notes)`.
- **RLS** uses `SECURITY DEFINER` helpers (`is_superadmin()`, `current_parent_id()`,
  `current_coach_id()`, `coach_serves_parent()`) to avoid policy recursion — see
  `20260309000600_rls_policies.sql`. Plus `coach_serves_parent_profile()` (migration
  `20260712000100`), added because `profiles_select` otherwise hid served-parents' names
  from their own coach — the coach Billing screen needs them to label an invoice.
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
  read time from `classes.day_of_week` (`lib/lessonDates.ts`) — see §8g. Don't "fix" this
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
9. **`react-native-web` gives EVERY ScrollView `flexGrow: 1`** — horizontal ones
   included (`commonStyle` in its `ScrollView/index.js`). So a horizontal ScrollView in
   a column layout **expands to fill the leftover vertical height**, and its row content
   container then stretches every child to that height (RN's default `alignItems` is
   `stretch`). The parent Attendance chips shipped as ~180px tall capsules on web while
   looking perfect on native — same "works on native, broken on web" family as §12a.
   **Any horizontal ScrollView needs both:** `className="flex-grow-0"` on the ScrollView
   *and* `items-start` on `contentContainerClassName`. Audit:
   `grep -rn --include="*.tsx" "horizontal" SwimSyncApp/app`. Pinned by
   `verify-parent-attendance.mjs`, which measures chip height from the DOM rather than
   trusting a screenshot.
10. **A screen you navigate *away* from stays mounted underneath.** The native stack
    keeps the previous screen in the DOM, so `document.body.innerText` contains both.
    This produced a **false-passing test**: an assertion for "admin will assign your
    child soon" passed against the *home* screen's identical copy while the Attendance
    screen was showing something else entirely. Assert only on strings unique to the
    target screen. (Also `run-ui-playwright` gotcha #6.)
11. **A frontend `tsc` that passes locally can fail in CI — the Next/Expo type stubs are
    git-ignored.** `SwimSyncAdmin`'s tsconfig `include`s `next-env.d.ts` + `.next/types/**`,
    and `SwimSyncApp` leans on Expo's `expo-env.d.ts` / `.expo/types` — **all git-ignored**,
    so they exist on your machine (a prior `npm run dev` / `expo start` generated them) but
    **not in a fresh CI checkout**. A local `tsc --noEmit` therefore typechecks against stubs
    CI won't have. Both apps happen to pass without them today (verified), but before trusting
    any frontend typecheck, reproduce the CI condition: hide the artifacts
    (`mv .next .next__x; mv next-env.d.ts next-env.d.ts__x`) and re-run. This is why the CI
    typecheck guard (§8b) was validated against a stubbed-out fresh checkout, not just a local
    pass.

---

## 8. What changed this session (2026-07-16 — invoice email notifications)

**Parents now get emailed when their invoice is generated** — a branded, itemised "your
invoice is ready" email via the Resend HTTP API. Shipped to `main` (`d13e1b3`,
fast-forward, no PR). Best-effort and **fully isolated from billing** — an email failure
can never affect invoice generation. Was Build-order item #2 (the invoice half).

- **Where it runs.** The `generate-invoices` Edge Function. `core.ts` (the billing engine)
  stays pure — it just returns a typed `created[]` (invoice + line items). `index.ts` (now a
  thin handler) calls the new **`email.ts` → `emailCreatedInvoices()`** *after* generation
  has committed, resolving each parent's email/name + student names and sending one email per
  invoice. Adds `emails_sent` to the response; **no admin-route/UI change**.
- **Delivery = Resend HTTP API**, not Supabase Auth SMTP (which only fires on auth events —
  e.g. password reset). Same key, read as `RESEND_API_KEY`. `sendInvoiceEmail` **never
  throws** and is a **logged no-op when the key is unset**, so local dev + Deno tests never
  send and generation is unaffected.
- **No double-send.** Only invoices in `created[]` are emailed, and `core.ts` already skips
  parents who have an invoice for the month — so a manual re-run sends nothing for existing
  invoices. Pinned by a re-run test.
- **Content.** Itemised (date · class · student, date-sorted) + gross/credit/net; a `net=0`
  invoice gets a "fully covered by your credit balance — nothing to pay" variant (no PayNow
  prompt). Branded to match `templates/recovery.html`. All dynamic text is HTML-escaped.
- **Verified.** `deno check` clean; **24 Deno tests** (was 8): pure builder/sender tests
  (`email.test.ts`) + **two stack-backed orchestration tests** proving the full path
  end-to-end — recipients resolved from the DB and sent via a stubbed Resend, plus a
  no-op-without-key path proving invoice generation is untouched.

**TWO cloud actions remain before parents actually get emails (neither is done by a git
push — the Edge Function is NOT deployed by Vercel):**
1. **Deploy the function:** `supabase functions deploy generate-invoices`.
2. **Set the secret:** `supabase secrets set RESEND_API_KEY=<the Resend key>` (the same key
   that is the SMTP password on the dashboard). Optionally `APP_URL` (defaults
   `https://swimsync.sg`).
Until both are done, cloud generation behaves exactly as before (no emails).

**Found while reviewing (NOT introduced here) — a pre-existing engine bug, now in BACKLOG:**
`core.ts` loops per class and creates a parent's invoice in the *first* class they appear in,
then skips them for later classes — so a parent with children in **two different classes** is
billed only for the first. Filed under Billing. Could bite on 1 Aug if any family has
siblings in different classes.

**Not done (deliberate):**
- **Credit-note emails deferred** — credit notes are issued by the `handle_attendance_update`
  Postgres trigger, not the Edge Function, so emailing them needs `pg_net`/a DB webhook — a
  different, bigger build. In BACKLOG as its own item (reuses `email.ts`).
- **Delivery tracking / retry deferred** — best-effort, no `invoice_email_sent_at` column; a
  failed send isn't retried. In BACKLOG. Keeps the first cut an 'S'.
- **Itemised was folded IN** (not deferred) at the user's call — cheap on top of the summary.

## 8b. What changed this session (2026-07-16 — typecheck baseline + CI guard)

**Cleared the app's 5 pre-existing `tsc` errors and wired `tsc --noEmit` into CI for both
apps, so the typecheck baseline is now enforced instead of a new type error hiding in
known-broken noise.** Shipped to `main` (`e2a8e13`, fast-forward, no PR); CI/types +
tooling only — **no runtime or user-facing change** (Vercel redeploys, but nothing
user-facing moved). This was Build-order item #2.

- **The fix (1 line).** `app/(parent)/home/child/[id].tsx:99` — the nested
  `student_class_enrolments → classes → coaches` embed is inferred by supabase-js as
  **arrays** (there is **no `Database` generic** on the client, so response shapes are
  guessed from the select string alone), while the code reads them as single to-one
  objects. All 5 errors chained off one variable; `const cls: any = …` clears them, matching
  the file's own `(e: any)` idiom and every sibling screen. This file was the lone hold-out —
  `home/index.tsx` is clean only because its root row is already `any`.
- **CI guard.** Added a `typecheck` script (`tsc --noEmit`) to both `package.json`s and a
  **Typecheck (tsc)** step to the `frontend-tests` matrix in `ci.yml` (covers **both** apps),
  and rewrote the stale scope-note that said typecheck was "intentionally NOT run yet." Admin
  already typechecked clean, so the guard locks that in too.
- **Verified — incl. the CI trap (§7.11).** `tsc --noEmit` clean on both apps; app jest
  **38/38**. Critically, re-ran both typechecks with the **git-ignored generated artifacts
  hidden** (`.next`/`next-env.d.ts`, `.expo`/`expo-env.d.ts`) to mimic a fresh CI checkout —
  both still clean, so this won't be green-locally / red-in-CI.
- **Backlog.** The thorough alternative — **generate real Supabase `Database` types** — is
  filed in `BACKLOG.md` (Foundations) as **M, low-priority / do-last**: real app-wide
  compiler-enforced type safety, but only worth doing once the schema is **frozen** (the
  generated types are a snapshot that must be regenerated on every migration, or they go
  stale and lie). It supersedes and absorbs this `any` cast. The user's explicit call: do it
  last.

**Not done (deliberate):**
- **No generated `Database` types now** — that's the backlog item above; the `any` cast is
  the pragmatic `S`-sized baseline fix. Generating types is an `M` that touches every query
  site and shouldn't land while schema-changing items (active/inactive, NRIC, tenanting) are
  still ahead of it.
- **PRD untouched** — nothing shipped a behaviour change; this is types + CI + tooling only.

## 8c. What changed this session (2026-07-16 — bulk attendance + admin class management + backlog ranking)

**Shipped the bulk "Set all to…" control on the coach attendance screen (was the
backlog's #1), added admin class-editing + a required day-of-week (root-causing the
Saturday classes), and ranked the backlog into a re-work-ordered build plan.**

- **Bulk "Set all to…" (shipped, verified UI + DB).** The Mark Attendance header now has a
  **"Set all ▾"** menu that sets every enrolled student to one status at once — **Present,
  Absent, Cancelled — Rain, Cancelled — Coach** — which the coach then adjusts
  individually. It **overwrites all** students; a `confirmAction` guard fires only when
  some are already marked (fresh screen = one tap, no prompt). **Trial is deliberately
  excluded** from the bulk menu — a whole class of trials doesn't happen and its Paid/Free
  split needs a per-student choice. Closes the friction where cancelling a rained-out class
  was 17×2 taps, the point at which a coach abandons the task and an abandoned cancellation
  looks exactly like a forgotten (unbilled) lesson. PRD §7.6 updated.
- **How it's built.** Pure logic in **`SwimSyncApp/lib/attendanceBulk.ts`**
  (`applyBulkStatus` + `SET_ALL_OPTIONS`) with a colocated test — extracted because jest
  only runs `lib/**`. The screen (`(coach)/classes/[id]/attendance.tsx`) gained the header
  button, an `onSetAll` handler, and an **inline dropdown overlay** (a `Pressable` backdrop
  + absolute-positioned menu card — there is **no menu/dropdown component in the app**, so
  it's built inline). **No change to `handleSave`, schema, or billing** — it only populates
  the existing per-student state map, which `handleSave` already upserts wholesale.
  `existingId` is preserved so a bulk edit of an already-saved session updates in place.
- **Verified.** App jest 32→**38** (6 new); no *new* `tsc` errors; a new
  `run-ui-playwright` driver **`verify-bulk-setall.mjs`** drives it **10/10** — the
  dropdown renders correctly on RN-web (the real risk: absolute overlay + z-index, the
  "works on native, breaks on web" family), the confirm guard fires only when a student is
  already marked, one tap sets everyone on a fresh screen, and a bulk save **persisted
  `cancelled_rain` for both students** (checked in the DB) and cleared the unmarked backlog.
- **Backlog ranked into a `## Build order` section** (top of `BACKLOG.md`), ordered to
  **prevent re-work** — e.g. extract the completeness helper *before* active/inactive edits
  it; reconcile the students table's status model *before* piling NRIC/address/levels onto
  it; and the tenant/coach-type/wage cluster is one schema decision that gates any
  coach/admin money feature. The ranking lives **only there** (one source of truth, not
  stamped on every heading). With bulk set-all shipped, the near-term list is renumbered
  1–8, led by the **UTC-billing-month fix**.
- **Admin class management — edit-in-UI + required day (shipped, verified).** Root-caused
  why the 4 real classes were on Saturday: the admin **New Class** form
  (`SwimSyncAdmin/app/(admin)/classes/page.tsx`) **silently defaulted the day to Saturday**
  (`useState("saturday")`) and — unlike every other field — **never validated it**, so a
  class created without touching the dropdown became Saturday. Two fixes: (1) the day now
  defaults to a blank *"— Choose a day —"* and is required (`!day` in the submit check), so
  a class can't be created on the wrong weekday by inaction; (2) the page is **no longer
  create-only** — an **Edit** action per row opens the same modal pre-filled (`openEdit` +
  an `UPDATE` path in `handleSubmit`), so day/time/coach/rate/location can be changed
  in-app instead of dashboard SQL. RLS already allowed it (`classes_write` is
  `FOR ALL … USING (is_superadmin())`). Verified 5/5 via `verify-class-edit.mjs` (day
  defaults empty, create-without-day blocked, edit Saturday→Sunday persists).
- **Class day Saturday→Sunday — still a pending PRODUCTION action for the user.** The coach
  actually teaches **Sunday** (attendance marked 12/19/26 Jul — all Sundays; confirmed), but
  the real classes are still Saturday in the **production** DB. Two ways to fix it (the
  edit-class UI is **now live** — the feature above): **admin → Classes → Edit → set day to
  Sunday**; or one statement in the Supabase **dashboard SQL editor**:
  `UPDATE classes SET day_of_week = 'sunday' WHERE day_of_week = 'saturday';` No
  `lesson_sessions` exist yet, so nothing else needs touching — expected-lesson dates derive
  from `day_of_week` at read time. **Confirm it's done before the first Sunday is marked**,
  or the gap report expects the wrong weekday. _(The user said they'll do this via the UI.)_
- **All merged to `main` and live; CI green.** Both features shipped through `6fca53d`
  (fast-forward, no PR), then a follow-up bumped the CI actions to Node 24 runtimes
  (`02764c1`): `actions/checkout` + `actions/setup-node` v4→**v7** (both `node24`) and
  `supabase/setup-cli` v1→**v3** (now a **composite** action, so no Node runtime to
  deprecate) — clearing GitHub's "Node.js 20 is deprecated" warnings. Verified each
  target's runtime before pinning; `version: latest` on setup-cli is unchanged. CI is green
  across all three jobs and Vercel is deploying both sites from `main`.

**Not done (deliberate):**
- **No reusable dropdown/menu component.** One use didn't justify a shared component; the
  inline overlay is enough. If a second menu appears, that's the trigger to extract one.
- **Didn't extract shared attendance-status types** (the enum↔label/colour maps are
  duplicated across three screens). Real, but a separate cleanup — the bulk helper stayed
  self-contained rather than dragging that refactor in.
- **Local seed left as "Saturday Beginners"/`'saturday'`** — it's a dev fixture and
  "Saturday" is load-bearing in several test suites (`classCoverage.test.ts`,
  `lessonDates.test.ts`, `verify-tz-saturday.mjs`). Only the *production* classes move.
- **Didn't run the production class-day SQL** — no service key locally and it's the user's
  live DB; provided the statement for the dashboard instead.

---

## 8d. What changed this session (2026-07-16 — backlog)

**Recorded six future features in `BACKLOG.md`. No code changed; nothing shipped.**

Requested by the user as a queue for future work. Written against the current schema
rather than from memory, which changed what three of them are:

- **Tenanted admin accounts — L.** Each admin sees only their own coaches' families.
  Now the biggest item in the document. `is_superadmin()` is a bare `role = 'superadmin'`
  with no tenant dimension, and it appears in nearly every policy.
- **Coach type: private vs school — M.** Decides who a coach answers to, and gates the
  wage item below.
- **Active / inactive for parents and children — M**, with the cascade rules and an
  inactivated date.
- **Coach wage tracking — M.** School coaches only — a private coach has no wage.
- **Address + postal code at parent signup — S.** Smaller than asked: email and phone
  are already collected.
- **NRIC last 4 + derived age — S.** Also smaller: child DOB is already required today.

**Package pricing was already a backlog item**, so the two new decisions were folded
into it rather than duplicated — it coexists with pay-per-use (the model belongs to the
enrolment), and a package balance **pools per parent** across their children, matching
the `parents.credit_balance` precedent.

**Found while writing — worth knowing before the active/inactive item is picked up:**
`students.assignment_status` is an enum whose values are `unassigned | assigned |
inactive` (`20260309000100_initial_schema.sql:14`), and it renders as the status chip on
`(parent)/home/index.tsx:243`. So "this child is inactive" is **already sayable two
ways** — that enum and `students.is_active`. Reconcile them before adding a third; the
item says so. Related: the invoice engine's completeness gate reads **active enrolments
only** and never consults `students.is_active`
(`generate-invoices/core.ts:122-130`), so deactivating a child without closing their
enrolment would still raise unmarked-lesson alarms.

**Not done (deliberate):**

- **PRD untouched** — nothing shipped a behaviour change. Six ideas is exactly what
  `BACKLOG.md` is for; putting any of it in the PRD would make the PRD describe things
  that don't exist.
- **§9 untouched** — it already points at `BACKLOG.md` for the queue, and none of these
  six displace the current shift (onboarding → first invoice run → bulk set-all).
- **No item tagged with a provenance tag.** The tags map to PRD §3.2 / §15 / handover
  origins; these came from the user directly and inventing a tag would fake a lineage.

**Process note:** the six items were committed as `3e1270c` **directly to `main`** —
unintentionally. The branch `docs/backlog-future-features` had been created for them,
but a concurrent merge to `main` (§8e) moved `HEAD` between the branch checkout and the
commit, so the commit landed on `main` and the branch was left an empty pointer at
`8c1d5ad`. Deleted it. No harm done — the change was docs-only — but note `3e1270c`
**has no CI run of its own**: it was pushed between two other commits and the green run
is on `b89ca52`, which contains it. **Two sessions in one repo means `git status` before
`git commit`, not after.**

---

## 8e. What changed this session (2026-07-16)

**Fixed the parent Attendance screen — and shipped everything on this branch to
production.**

- **Merged to `main` and pushed: `2f746ca` → `8c1d5ad` (4 commits). CI green** across
  backend + both frontends. Vercel builds `swimsync.sg` / `admin.swimsync.sg` from
  `main`, so the unmarked-lessons work (§8g), the docs split (§8f), and the fixes below
  are **now live**. Note what that means: everything before this was verified against
  **local fixtures only** — this is the first time any of it runs against the real
  production DB (clean slate, real coach, 4 real classes). Nothing here touches schema
  or migrations, so a bad outcome looks wrong rather than corrupting data;
  `git revert` + push redeploys.
- **Chips rendered as ~180px tall capsules** on the parent Attendance screen (spotted on
  the live site, not by any test). Cause: `react-native-web` applies `flexGrow: 1` to
  **every** ScrollView — horizontal ones included — so both chip rows expanded to fill
  the column's leftover height, and their row content container stretched each chip to
  match. Native was never affected. Fixed with `flex-grow-0` + `items-start`; chips are
  now 30px, measured from the DOM. Full mechanism + audit command: **§7.9**.
- **Added the "not assigned yet" state that PRD §5.1 already required.** An unassigned
  child showed *"No records found"*, which reads as broken when the real answer is that
  the admin hasn't assigned them yet — **the exact state every parent being onboarded
  right now lands in**. Three empty states are now distinguished:

  | Situation | What the parent sees |
  |---|---|
  | Child `unassigned` | "*&lt;first name&gt;* isn't in a class yet" + the admin will assign soon |
  | Assigned, nothing marked | "No lessons marked yet" — waiting on the coach |
  | Filter excludes everything | "No absent lessons" — names the active filter |

  Only `unassigned` gets the new state, so an `inactive` child still renders their
  history (PRD §11.5 — re-enrol keeps history). Deliberate: treating them as
  "not assigned yet" would hide real records.
- **`verify-parent-attendance.mjs`** — new driver (§10). Measures chip **geometry from
  the DOM**, so the capsule regression cannot silently return; drives all three empty
  states. Needed an unassigned child in the shared fixture, so
  `verify-unmarked-lessons.mjs` was re-run afterwards to prove the fixture change didn't
  break it (still 12/12).

**Not done (deliberate):**
- **PRD untouched — the gate genuinely wasn't met.** §5.1 *already* specified the
  "not assigned yet" state, so this fix makes the code match the spec rather than
  departing from it. Nothing to correct. (§8f reached the same conclusion independently
  before the work landed.)
- **`BACKLOG.md` left alone** — it was being written by a **concurrent session** while
  this one ran, and has since landed on its own as `3e1270c` (six items: coach wage
  tracking, address/postal at signup, NRIC-last-4 identification, tenanted admin
  accounts, coach type private-vs-school, active/inactive status). Not this session's to
  commit. Nothing shipped here was a backlog item, so no pruning was owed either.
  **Two sessions ran against this repo today** — check `git log` before assuming an
  uncommitted file is yours.
- **§5 test counts were stale and are now corrected** (app 29→**32**, admin 35→**38**).
  They were wrong by my own hand in §8g: three `formatSgDate`/`dayOfWeekOf` tests were
  added to each app *after* the counts were written. Verified by running both suites.

## 8f. What changed (2026-07-16 — docs split)

**Split the docs into three, so each one can be trusted for a different question.**

No product code changed — this session was documentation and tooling only. The PRD is
deliberately **untouched**: nothing shipped a behaviour change, which is the only thing
that earns a PRD edit now.

- **The problem:** three documents were all half-doing the same job. `PRD.md` had drifted
  from "spec" to "spec + as-built record" (a 40-line build-status blockquote, *(implemented)*
  annotations throughout), and **§9 of this file was serving as the backlog** — it held
  the queue, mixed with a growing "record of already-DONE work" tail. §9 is rewritten every
  session by design, so ideas parked there had no owner and would quietly fall out.
- **The split** (documented in the new `README.md`, which the repo didn't have at all —
  it doubles as the public front door):

  | Document | Answers | Changes when |
  |---|---|---|
  | `PRD.md` | How does SwimSync behave? | A **shipped** behaviour changes |
  | `BACKLOG.md` | What could we build, and why does it matter? | An idea arrives, or ships |
  | `HANDOVER.md` | What's the state now, what's next? | Every session |

- **`BACKLOG.md` — new.** 33 items across seven themes. **Every item carries a `Why`** —
  that's the rule that stops it becoming a wishlist, and the bar for adding one. The
  **Notes** field on each item is where prior decisions and rejected approaches live;
  it's worth more than the item title. Includes a **Deliberately not doing** table so
  settled questions (pre-generating sessions, parent-facing ability picker, `Alert.alert`)
  don't get re-litigated.
  - All **14** items from PRD **§3.2** (Out of Scope for MVP) are mirrored in as live
    options, tagged `[MVP-excluded]` — the user's call, on the reasoning that SwimSync is
    moving past pure MVP-building. **§3.2 itself stays in the PRD as-written**: it's the
    historical record of the scope decision, not a to-do list.
- **`/session-close` skill — new** (`.claude/skills/session-close/`). Walks all three docs
  and updates each by its own rule. It **gates** each one rather than writing to all three —
  the failure mode of an auto-updater is bloat, which would collapse the split back into
  three copies of the same thing. A session touching only this file is the *correct*
  outcome, not a skipped step. Hands off to `/commit-review` to commit.
- **Writing the `Why` fields surfaced two items worth ranking above most of the feature
  list**, both now in `BACKLOG.md`:
  - **Email invoice notifications** — likely the best effort-to-value item in the repo.
    Resend is already live and paid for on `noreply@swimsync.sg` with a branded template
    pattern; today an invoice appears silently, so the coach chases payment for a bill the
    parent never knew existed.
  - **The UTC-derived default billing month** — a live latent bug, harmless *only* because
    invoicing is manual and cron is off. Switching cron on bills the wrong month. Same
    UTC-vs-SGT class of error that already shipped a real double-billing bug (§7.7).
    **Fix it before enabling cron, not after.**

**Not done (deliberate):**
- **§9's DONE tail was pruned, not preserved.** Entries whose reasoning already lives in
  the PRD or a §8x log were dropped — git history is the record of what shipped. §9 is for
  what's *next*.
- **Nothing was migrated out of the PRD into the backlog.** The PRD's §3.2 and §15 release
  plan stay as-written; the backlog mirrors them rather than moving them, so the original
  reasoning stays reachable via the provenance tags.
- **The parent attendance screen has uncommitted changes that are NOT part of this
  session** (unassigned empty state, "no lessons marked yet" state, an RN-web
  `flex-grow-0` ScrollView fix). Left untouched at the user's instruction — work in
  progress, and another session was active concurrently. Needs no PRD change when it
  lands: **§5.1 already specifies** the "not assigned yet" state, so it makes the code
  match the spec rather than departing from it.
  - _Update: that work **landed** later the same day as `8c1d5ad` — see §8e. The PRD call
    above held._

## 8g. What changed (2026-07-15)

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

## 8h. What changed (2026-07-13 → 07-14)

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

## 8i. Session (2026-07-12)

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

## 8j. Session (2026-07-11)

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

> **This is the current shift, not the queue.** The full list of unbuilt ideas — with
> the reasoning for each — lives in **`BACKLOG.md`**. Don't restate it here; the two
> will drift. Keep this section to what's genuinely next.

The MVP loop is built and live; the silent-underbilling hole is closed (§8g). **The
product is no longer the blocker — real usage is.** The real classes are now on **Sunday**
in production (the user moved them via the admin edit-class UI shipped in §8c), so the gap
report expects the right weekday.

**Current status (2026-07-16):** parent onboarding is **ongoing** (~17 students expected
across the 4 Sunday classes); the **first real invoice run is 1 Aug 2026** (July's billing,
manual — no cron on the free tier). Everything below sequences around those two facts.

**⚠ Two cloud actions before 1 Aug, if invoice emails should go out.** The email feature
shipped this session (§8) but is **NOT yet live** — a git push does not deploy the Edge
Function. Run `supabase functions deploy generate-invoices` **and**
`supabase secrets set RESEND_API_KEY=<key>` (the same key that is the SMTP password on the
dashboard). Without them, generation still works but emails nothing.

In order:

1. **Finish parent onboarding — the gate to real billing.** Parents self-register + add
   their children via **`swimsync.sg/welcome`**, then the superadmin assigns each to a class
   (admin **Unassigned Children**). Students are **parent-created** (coaches/admin can't
   create them), so this is an onboarding push, not a build task.
2. **First real invoice run — 1 Aug 2026.** Once the Sundays are marked, follow
   **`INVOICE_RUNBOOK.md`** on the 1st (manual). The confirm dialog reports any lesson with
   no attendance marked: **read it** — it is the only backstop against an underbill (§7.8).
   Pick July explicitly in the month picker, which also sidesteps the UTC-billing-month
   warning in the runbook. (Deploy + set the secret first if parents should be emailed — see
   above.)
3. **Pick the next build item from `BACKLOG.md` → `## Build order`.** Three old near-term
   items have now **shipped** and been removed from the ranking: bulk "set all" (§8c), the
   **`tsc` baseline + CI typecheck guard** (§8b), and **invoice email notifications** (§8,
   this session — the invoice half; credit-note emails remain, deferred). The list is now led
   by the **UTC-billing-month fix** (do *before* enabling cron — it mis-bills the month
   otherwise). **Also newly filed: a pre-existing multi-class-parent under-billing bug** (§8,
   BACKLOG → Billing) — worth fixing before 1 Aug if any family has siblings in different
   classes.

_Optional, low-cost:_ click through the live screens merged 2026-07-16 that have only ever
run against local fixtures (§3) — parent **Attendance** (chips are pills, not tall
capsules), coach **Today**, admin **Invoices → Generate**. Hard-refresh (static SPA).

---

## 10. File map

| Path | What |
|------|------|
| `supabase/migrations/` | Schema, RLS, triggers, grants (ordered, source of truth) |
| `…/20260309000500_credit_note_trigger.sql` | Auto-issues a credit note on billable→non-billable edit of an invoiced lesson |
| `…/20260711000100_credit_applications.sql` | Credit-note allocation ledger (fixes partial-application drift) |
| `supabase/functions/generate-invoices/core.ts` | Billing engine logic (exported, tested) |
| `supabase/functions/generate-invoices/index.ts` | Thin HTTP handler (auth + client + call core) |
| `supabase/functions/generate-invoices/email.ts` | Invoice-email builders + Resend sender + `emailCreatedInvoices()` orchestration (§8) |
| `supabase/functions/generate-invoices/core.test.ts` · `email.test.ts` · `test.sh` | Deno integration + email tests + runner |
| `supabase/tests/*.test.sql` | pgTAP DB tests (trigger, RLS, constraints) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/`, each tab folder has a nested `_layout.tsx` |
| `…/(auth)/forgot-password.tsx` · `reset-password.tsx` | Password-reset flow (request link + set new password) |
| `SwimSyncApp/app/_layout.tsx` | Root: session restore + `PASSWORD_RECOVERY` routing + native recovery deep-link handler |
| `SwimSyncApp/lib/authErrors.ts` | Maps raw Supabase auth errors to friendly copy |
| `SwimSyncApp/lib/attendanceBulk.ts` · `.test.ts` | Bulk "Set all to…" helper (`applyBulkStatus` + options) for the coach attendance screen (§8c) |
| `SwimSyncApp/lib/lessonDates.ts` · `SwimSyncAdmin/lib/lessonDates.ts` | **Byte-identical twins** — SG-safe date strings + expected lesson dates. Edit both (§6) |
| `SwimSyncAdmin/lib/classCoverage.ts` | Expected-vs-marked coverage maths for the admin pre-generation check |
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `.claude/skills/run-ui-playwright/` | Skill to launch + drive both UIs (Playwright/Chrome) |
| `.claude/skills/session-close/` | Skill: update PRD/BACKLOG/HANDOVER by their own rules at session end |
| `AVAIL_SKILLS.md` | Reference for all available skills |
| `LOCAL_DEV_GUIDE.md` | Run/test commands, seed logins, service URLs |
| `INVOICE_RUNBOOK.md` | Monthly manual invoice-generation procedure (superadmin) |
| `README.md` | Front door + **the rule for which document to write in** |
| `PRD.md` | Product spec — **what exists** (*(implemented)* sections = build decisions) |
| `BACKLOG.md` | **What doesn't exist yet** — every item carries a `Why` |

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
| **Edge Function** | `generate-invoices` deployed | Auth via `CRON_SECRET` secret (set with `supabase secrets set`). Cold-start ~5–8s. **Deployed by `supabase functions deploy generate-invoices` — a git push does NOT deploy it.** Now also emails parents on invoice creation (§8); needs `RESEND_API_KEY` secret set, else it's a no-op. |
| **Admin panel** | Vercel `swimsync-admin` → **https://admin.swimsync.sg** (also `swimsync-admin.vercel.app`) | Root `SwimSyncAdmin`, **framework preset = Next.js**. |
| **Mobile app (web)** | Vercel `swimsync-app` → **https://swimsync.sg** (apex, canonical; `www` 308-redirects; also `swimsync-app-psi.vercel.app`) | Root `SwimSyncApp`, **preset = Other** (`SwimSyncApp/vercel.json`: `expo export --platform web` → `dist`, SPA rewrite). |
| **Email** | **Resend** → sender `noreply@swimsync.sg` | Two paths: **(1) Auth emails** (password reset) via cloud custom SMTP `smtp.resend.com:465` (user `resend`, pass = Resend API key, dashboard-only); branded reset template (dashboard + `supabase/templates/recovery.html`); auth rate limit 2→~30/hr; confirmation **OFF**. **(2) Invoice emails** (§8) via the **Resend HTTP API** from the Edge Function, keyed by the `RESEND_API_KEY` secret (same key) — set with `supabase secrets set`. |
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
