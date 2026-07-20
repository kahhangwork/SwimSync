# SwimSync — Session Handover

_Last updated: 2026-07-20 (eighth session — prepaid packages; built and verified
locally, NOT yet deployed — see §9)_

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
  tap, with a confirm guard when some are already marked (§8e, PRD §7.6).
- **A billing month must have ENDED before it can be billed (verified local, live)** — the
  admin's picker defaults to and is capped at the last completed month, and the **engine
  refuses** anything later, with no `force` override. Without it a mid-month run looked
  *complete* to the attendance gate, billed the lessons so far and **sealed** the month,
  stranding the rest permanently (§7.32). **Confirmed on production 2026-07-19**: the picker
  reads June 2026 and refuses to offer July.
- **Invoice generation** — one `generate-invoices` engine, two modes: **automatic**
  (cron-style; respects the `app_settings.auto_invoice_enabled` switch and
  `invoice_run_day`, default the **7th**) and **manual on-demand** (admin button). **One
  invoice per parent covering every class their children are in** (§8a), and **unmarked
  attendance blocks generation entirely in both modes — there is no override** (§8a). A
  month that finishes is **sealed**, by either mode, so later runs no-op — but a month with
  **nothing recorded** is never sealed and reports `nothing_to_bill` instead (§8a.1; this
  one bit production).
- **Closing an enrolment (verified UI + DB)** — **"Remove from class"** and **"Set
  inactive"** on the admin Students page *and* the coach roster, via the
  `close_student_enrolment()` RPC. This is what unblocks billing when a child has stopped
  attending; their already-attended lessons still bill (§8a).
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
  silently unbillable and invisible to everyone (§8i).
- **Parent Attendance states (verified UI)** — an unassigned child gets the
  "not assigned yet" state PRD §5.1 requires, distinct from "no lessons marked yet"
  (waiting on the coach) and an empty filter result (§8g).
- **Full RLS** — parents see only their data, coaches only their classes,
  superadmin everything. Covered by automated isolation tests.
- **Multi-tenancy (verified UI + backend, live)** — cross-tenant isolation proven by 24
  pgTAP assertions across two full tenants, plus UI drivers for join codes, the platform
  admin, tenant branding and wages. **Production has one tenant**, so isolation has never
  been exercised on real data.
- **Coach wages (verified UI + backend, live)** — effective-dated rates, the pay-decision
  table, draft→frozen payouts with next-period adjustments. A coach sees their own pay;
  rates are admin-only.
- **Active/inactive families and children (verified UI + backend, live)** — per business,
  with the date they left. Deactivating a child offers to take the siblings and states the
  family consequence; a departed family returns by re-entering the join code. New admin
  **Parents** page. `assignment_status` contracted to `unassigned | assigned` (PRD §7.14).
- **Effective-dated class terms (verified UI + backend, live)** — a lesson is priced, and its
  coach paid, from the terms in force on **its own date** (`class_rates`). Editing a class's
  price no longer reprices last month; a handover no longer moves the outgoing coach's pay.
  Admin class edits ask **correct-vs-change**. Closed three defects, two of them live (§8).
- **Child identity, levels and address (verified UI + backend, live)** — a child
  is identified by **name + date of birth** (age derived, never stored); each business
  defines its own **level ladder**, each rung carrying an ordered **skill list** (its
  curriculum); families have an **address**. A parent can now **edit a
  child**, which required closing two pre-existing defects first — see §8.
- **Prepaid lesson packages (verified local: pgTAP + Deno + UI driver — NOT yet
  deployed)** — a business sells N lessons at a locked rate, valid M months, scoped to
  its own class categories; a prepaid dollar balance per (parent, tenant) drawn down by
  the invoice engine at the package's rate, live-displayed via one RPC everywhere
  (parent card, admin tables, the students "running low" filter with a per-tenant
  threshold). Request → PayNow → admin confirm; corrections restore the package, never
  mint cash credit. Ad-hoc billing byte-identical (tripwire-tested). PRD §7.16,
  `PACKAGES_DESIGN.md`, §8.8.
- **Automated tests** — backend **244 pgTAP + 91 Deno**, plus frontend suites
  (`SwimSyncAdmin` vitest 76, `SwimSyncApp` jest-expo 69); all run in CI on push to `main`. See §5.

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`). The full loop is verified end to end on cloud
(incl. a live password-reset round-trip on `swimsync.sg`). A **real coach + 4 real
classes** are onboarded and the production DB is a **clean slate** (only the
superadmin + the real coach/classes). See §11.

> **`main` = what's live for the WEB APPS ONLY.** Vercel builds both sites from `main`, so a
> push deploys them — but a push deploys **neither the Edge Function** (`supabase functions
> deploy`) **nor migrations** (`supabase db push`). Both are separate, manual steps.
> **This bit us:** migration `20260712000100_coach_read_parent_profile` sat merged-but-
> undeployed for **six days** — the coach Billing screen could not show parent names in
> production that whole time, and nothing surfaced it. Applied 2026-07-18 alongside §8a's
> three. **After any backend change, run `supabase migration list` and check nothing has an
> empty `remote` column.** `git log origin/main` is the honest answer to
> "what's in production"; don't trust a SHA written into prose here, including this one.
> **As of 2026-07-19 production is fully caught up**: every migration through
> `20260719002200` is applied (`supabase migration list` shows nothing pending) and
> `generate-invoices` is at **v13** — the completed-month guard (§8.6), on top of the
> effective-dated pricing engine (§8). *(This line said `20260719001300` / v11 for two
> sessions after both had moved on — a version written into prose goes stale the moment
> anything deploys. `supabase functions list` and `supabase migration list` are the honest
> answers; treat this sentence as a hint, not a fact.)*
> Backups were taken before each production migration (scratchpad, not committed).
>
> The **tenancy** deploys (§8.1) had **opposite orderings** and both were deliberate — phase 4
> *dropped* columns so the app deployed first; phase 5 only *added*, so migrations went
> first. **§8's deploy got that wrong**: the push to `main` went out before
> `supabase db push`, so Vercel shipped an admin calling an RPC that did not exist yet.
> The rule governs the **push**, not just the migration command — see §7.27.
>
> As of 2026-07-18 that also includes the whole §8a underbilling cluster (multi-class invoices, the
> configurable run day, month sealing, and the hard attendance block) **and the same-day
> empty-month seal fix (§8a.1) — `supabase functions list` shows `generate-invoices` at
> version 7, deployed 2026-07-18 19:45 SGT, ~1 min after commit `0363757`**, plus the earlier bulk
> attendance **"Set all"** control, **admin class
> editing + a required day-of-week** (§8e), the unmarked-lesson safety net, and the parent
> Attendance fixes (§8g). **Caveat worth keeping:** every check on that work ran against **local
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
supabase test db                                  # 244 tests across 17 files

# Backend — Function tests (Deno): billing math, credit + package ledgers, emails
supabase/functions/generate-invoices/test.sh      # 91 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component + logic tests (vitest)
cd SwimSyncAdmin && npm test                       # 76 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 69 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (4) | one-invoice-per-parent-per-month, one active enrolment per student, positive-only credit applications, credit notes immutable to app roles |
| `credit_note_trigger.test.sql` (11) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson); **11.6** the correction leaves the original invoice intact (not modified/deleted) and the note links back to it |
| `rls_isolation.test.sql` (10) | RLS parent/parent isolation + superadmin sees all; **11.3** a parent sees all their children across coaches while each coach sees only students in their own classes |
| `edge_cases.test.sql` (9) | PRD §11: **11.2** a child created before assignment defaults to unassigned with an empty (not error) class view, **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |
| `tenant_isolation.test.sql` (24) | cross-tenant isolation across **two full tenants** — neither can see the other's families, classes, coaches, invoices, credit notes or attendance (§8.1) |
| `coach_wages.test.sql` (36) | effective-dated wage rates, the pay-decision table (§7.13), pro-rata duration maths, flat rates, draft→frozen payouts, and next-period adjustments carried **once** (see (c)) |
| `class_terms.test.sql` (14) | effective-dated class terms — a lesson priced and attributed by **its own date**, correct-vs-change, and the settled-money guard. Runs on **its own tenant** (see §7.26) |
| `active_inactive.test.sql` (20) | per-business active/inactive for families and children (§7.14), incl. the load-bearing one: **reactivating is not undone by the family having no active children** (§8) |

| `student_identity.test.sql` (9) | name + DOB identifies a child within a business; whitespace/case cannot defeat the expression index; NULL DOB is exempt (what made it safe on live data); `age` is gone |
| `student_tenant_pin.test.sql` (6) | a parent or admin **cannot move a child to another business** (§8a), while ordinary edits and the platform admin's RPC still work |
| `document_name_snapshot.test.sql` (7) | renaming a child does not rewrite an issued invoice or an immutable credit note; the note carries the name from the item it credits |
| `tenant_levels.test.sql` (9) | per-business level ladders: RLS is **enabled** (not merely written), cross-tenant writes refused, a student cannot take another business's level, deleting a level unlevels rather than deletes |
| `level_skills.test.sql` (11) | the skills taught at a level: order preserved, no duplicate skill within one level (ignoring case/whitespace), the tenant boundary, `CASCADE` on the level but `SET NULL` on the student, and the fix to the level-name constraint |
| `platform_overview.test.sql` (24) | the platform admin's overview RPCs: FOUR caller shapes get zero rows (anon-equivalent, parent, coach, **and a tenant admin — even for their own tenant**), counts never leak across the tenant boundary, and `last_attendance_date` is **NULL, not a date and not 0**, for a business that has never marked anything |
| `parent_address.test.sql` (8) | a family maintains their own address only; `postal_code` is TEXT so leading zeros survive; `profile_id` cannot be reassigned |
| `lesson_packages.test.sql` (30) | prepaid packages: RLS on all four tables, $0-rate/0-lesson products refused, product money terms immutable, request snapshots come from the PRODUCT (a parent cannot claim a price or an active status), only non-client roles move a balance, `package_live_balances()` draws locked-rate/in-scope/FIFO and leaves the stored balance alone |
| `package_corrections.test.sql` (12) | a correction on a package-funded line restores the package (even expired) and mints NO cash credit note; flip-flops refund at most once; ad-hoc lines keep the credit-note path byte-identical |

**Total: 244 across 17 files** — verified by `supabase test db` 2026-07-20 (the previous
"total" line here had been stale for several sessions while §3 was right; per §7.37,
the command is the fact and this sentence is the hint). If you add a suite, add a row.

_Deno tests — `core.test.ts` + `email.test.ts` + `dates.test.ts` (run by `test.sh`):_
**The clock is part of every fixture** — `monthEnded()` in `test-helpers.ts` supplies the
billing month, an instant at which it is billable, and an early-enough enrolment as ONE fact,
and `newScenario()` **throws** on a scenario expecting zero lessons (§7.33). The
completed-month guard is pinned by five tests including the SGT boundary (23:59 on 31 Jul
refuses July; 00:00 on 1 Aug allows it) and the year rollover. **Engine**
(`core.test.ts`): billable-only summing, paid vs free trial, no double-billing, the
auto/manual completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, **11.7** credit-exceeds-invoice
carry-forward (+ ledger invariants via `checkInvariants`), plus `result.created` shape and
two **stack-backed invoice-email orchestration** tests (recipients resolved from the DB;
no-op without a key). **Email** (`email.test.ts`): pure HTML builder + `sendInvoiceEmail`
(no-op without key, mocked-fetch success/failure, HTML escaping). **Dates**
(`dates.test.ts`, 5): `previousBillingMonth`/`dateInTimeZone` — the SGT day-boundary
regression (1 Aug 00:30 SGT bills July, **fails on the old UTC path**), year rollover, and
the `APP_TIMEZONE` seam (UTC vs SGT diverge at the boundary).

_Also in `core.test.ts` (added §8a):_ **multi-class** (one parent, two children, two
classes → ONE invoice with both classes' items; the credit case proving credit draws
against the *combined* gross), **auto-mode deferral** and its recovery, the **hard block**
(unmarked attendance stops both auto and manual; marking it *cancelled* clears it), the
**run day** (before/on/after, manual ignores it, SGT decides the day), **sealing** (a
manual run that finishes the month seals it; a forced run on an incomplete month seals
nothing; sealing twice is a no-op), and **billing-vs-enrolment** (a child unenrolled
mid-month is still billed for what they attended; unenrolling clears the block they caused).

_Also in the Deno suite (added 2026-07-20):_ **`packages.test.ts`** (10) — the
no-package TRIPWIRE (a parent with no package produces the pre-package invoice,
byte-for-byte), locked-rate coverage both ways, chronological exhaustion cutover,
FIFO-by-expiry, the expiry boundary ON `expires_on`, coverage starting at confirmation,
category scope, package-then-credit precedence, and the ⚠RISK-4 pin:
`package_live_balances()`'s prediction equals the engine's settled result, and the
fault-injection test (a failed ledger write holds the month open). All verified
failing on the pre-package engine or a mutated flag. Plus **`../package-emails/email.test.ts`**
(7) — purchase-email builders (escaping, no-key no-op), run by the same `test.sh`.

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
matrix (§8d). The app's 5 long-standing `tsc` errors in
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
the day (required choice) and an existing class edits Saturday→Sunday and persists;
`verify-packages.mjs` (+ `fixtures-packages.sql`) drives prepaid packages across both
UIs — the parent card shows the LIVE count (9 of 10, the un-invoiced lesson already
subtracted), request → PayNow (the requested package's price, not the held one's) →
pending → admin confirm → Active, and the students "running low" filter obeys its
per-tenant threshold in both directions (16 checks);
`verify-invoice-controls.mjs` drives the admin invoice controls — it MEASURES the toggle's
track and knob rects from the DOM (§7.34) in both states and asserts the knob stays inside the
track, that a click round-trips through the DB, and that the billing month defaults to and is
capped at the last completed month; `verify-attendance-window.mjs` (+ `fixtures-attendance-window.sql`) drives the attendance
window (§8b) across coach + parent — the roster button targets the most recent expected
lesson (not raw "today"), the "no lessons to mark yet" placeholder shows for a class with
nothing due, and the parent screen distinguishes "no lessons have taken place yet" from
"no lessons marked yet".

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
- **Invoice emails live in `email.ts`, deliberately OUT of `core.ts`** (§8c). The engine
  stays pure and returns a typed `created[]`; `index.ts` calls `emailCreatedInvoices()`
  *after* generation commits, so a delivery failure can never touch billing. Sends go via
  the **Resend HTTP API** (not Auth SMTP), keyed by `RESEND_API_KEY`, and are a **logged
  no-op when the key is unset** — so local + tests never send. Don't move sending into the
  engine or make it able to throw into the generation path. **The Edge Function is deployed
  by `supabase functions deploy`, NOT by a git push** (Vercel only builds the two web apps).
- **One invoice per parent per month is built in TWO PHASES** (§8a): the class loop only
  *tallies* billable items into a cross-class map; invoice creation runs once per parent
  afterwards. Creating invoices inside the class loop is what under-billed multi-class
  families — the "already has an invoice" guard skipped them on their second class. **Don't
  move invoice creation back inside the loop.**
- **Unmarked attendance BLOCKS generation, with no override, in both modes** (§8a, PRD §7.7).
  This deliberately reverses the earlier "warn + Generate anyway". The justification for the
  bypass (a class that genuinely didn't run) is already served inside the completeness rule:
  mark it `cancelled_rain`/`cancelled_coach`. `force` no longer bypasses the gate — it only
  skips the sealed-month guard. **Don't add an override**; add a way to mark the lesson.
- **`close_student_enrolment()` is a SECURITY DEFINER RPC, not an RLS policy** (migration
  `20260718000200`). The operation must also write `students.assignment_status`, and
  `students_update` is (superadmin OR creator OR owning parent) — granting coaches UPDATE on
  `students` would let them edit names, DOBs and notes too, because **RLS is row-level, not
  column-level**. The function exposes exactly one operation, keeps its three writes
  together, and is audit-logged. It deliberately offers no INSERT (assignment stays
  superadmin, PRD §5.2) and no DELETE (history must survive, PRD §11.5; credit untouched,
  §11.8). Permission is interim: when coach type lands, a private coach keeps it and a
  school coach's admin takes it over.
- **The billing timezone/run-day seam is GLOBAL, not per-tenant** — `APP_TIMEZONE` and
  `app_settings.invoice_run_day`. Same reasoning as the timezone call (§8a), reaffirmed by
  the user for the run day: multi-tenant is a don't-paint-into-a-corner concern with zero
  users today. Promoting one integer to a per-tenant column later is trivial next to the
  RLS rewrite tenanting requires anyway.
- **Credit is pooled per PARENT** (`credit_notes.parent_id` + `parents.credit_balance`);
  a note's `student_id` is provenance only, so credit earned from one child is
  spendable against any child (invoices are one-per-parent-per-month).
- **`credit_applications` ledger** records every partial draw of a note against an
  invoice, so the note ledger reconciles with `invoices.credit_applied`. Invariants:
  `SUM(applications by invoice) = credit_applied`; `credit_balance = SUM(remaining across notes)`.
- **A PACKAGE IS MONEY AT A LOCKED RATE, AND ONLY THE ENGINE MOVES IT** (2026-07-20,
  PRD §7.16, `PACKAGES_DESIGN.md`). The rules that must not be re-derived wrongly:
  - **Dollars stored, lessons derived** (`balance ÷ rate` — exact because drawdown is
    locked-rate). Don't store a lesson counter; it has no answer when a lesson isn't the
    price you expected (HANDOVER of the age/DOB rule to money).
  - **Drawdown happens at INVOICE time, in `core.ts` phase 2** — never at marking time.
    Live displays derive via **`package_live_balances()`, the ONLY derivation of pending
    draws**; parent app + admin both call it. Do NOT reimplement "lessons left" in TS —
    a Deno test pins the RPC's prediction against the engine's settled result, and the
    grep gate is `grep -rn "value_remaining" SwimSyncApp/app SwimSyncAdmin/app`
    (stored-column display only; no arithmetic with attendance).
  - **Instance terms are snapshotted from the product BY THE DB at request time**
    (lifecycle trigger, NOT SECURITY DEFINER — §7.38); product money terms are immutable
    by trigger (a price change is retire + new product); balances are CHECK-bounded
    `0 ≤ value_remaining ≤ total_value` and client-immutable via the current_user seam.
  - **Corrections restore the package** (reversal rows in `package_applications`, at
    most once per line), never a cash credit note — prepaid value and refund liability
    are separate pots. The trigger is on its SEVENTH redefinition; start any edit from
    `grep -ln "handle_attendance_update" supabase/migrations/*.sql | tail -1`.
  - **Categories scope packages and are the class axis; tiers are products.** "No
    category = private coach" is FALSE — scope-less packages are just all-classes, and
    a tenant with no packages is simply ad hoc (coach type must not sneak back in).
  - **`package-emails`** is a separate Edge Function (verify_jwt ON, caller re-checked
    in-body), sharing the project-wide `RESEND_API_KEY`. Deployed separately, like
    everything under `supabase/functions/`.
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
  read time from `classes.day_of_week` (`lib/lessonDates.ts`) — see §8h. Don't "fix" this
  by pre-generating sessions unless you have a reason the read-time derivation can't
  serve; pre-generation adds a job, a schedule, and edge cases when classes change.
  - A class that legitimately didn't run needs **no new concept**: the coach marks
    everyone `cancelled_rain`/`cancelled_coach` (non-billable), which creates the
    session and drops the date out of the backlog permanently.
  - **Completeness rule — now ONE definition** (`lib/attendanceCompleteness.ts`, extracted
    2026-07-18). A lesson counts as marked only when its session exists **and every
    actively-enrolled student has an attendance row on it**, and **a lesson with no session
    row at all is UNMARKED, not absent** — sessions are created lazily, so "no row" is
    exactly what a forgotten lesson looks like. Used by
    `SwimSyncAdmin/lib/classCoverage.ts`, `(coach)/today/index.tsx` and
    `(coach)/classes/[id]/roster.tsx`. **Duplicated byte-identical in both apps** (same
    arrangement as `lessonDates.ts`), and the engine keeps its own Deno copy — so it is
    **three edits, not one**. Callers still own their own *window* (billing month vs coach
    backlog); only the meaning of "marked" is shared.
    - **They had already diverged, and it was a live underbill — see §7.17.**
- **A PRIVATE COACH IS A TENANT OF ONE — never branch on "coach type".** They hold
  `tenant_admin` *and* a `coaches` row. This is why coach type is not an authorization
  concept anywhere, why wages needed no private-vs-school check, and why the app must
  route on **which extension rows exist**, not on the role enum (undoing that is what
  locked the real coach out — §7.19). `tenants.kind` exists for copy and future pricing
  and **must never appear in an RLS policy**. Full reasoning: `TENANCY_DESIGN.md` §1.
- **The tenant boundary: parents GLOBAL, students TENANTED.** A parent may deal with
  several businesses (the common case, per the user), so `parents` has no `tenant_id`;
  a tenant reaches a parent through their children's enrolments (`tenant_serves_parent()`).
  `students.tenant_id` is a real NOT NULL column and **must not** be re-derived from
  enrolment — an unassigned child has no enrolment, and "Remove from class" deliberately
  keeps a child in the business while removing them from the class.
- **Credit NEVER crosses tenants** (`parent_tenant_balances`), though it pools freely
  within one. This **reverses** the earlier "credit is pooled per parent" decision, with
  the user's explicit go-ahead: pooling was right for one business and wrong for two.
- **The billing engine runs as `service_role` and BYPASSES RLS.** Tenant isolation in
  billing is enforced by explicit `tenant_id` filters in `core.ts` — the 37 policies do
  not protect that path at all. If you add a query there, scope it. Audit:
  `grep -n "tenantId" supabase/functions/generate-invoices/core.ts`.
- **RLS policies must not reach across tables with a bare `EXISTS`** — that subquery runs
  under RLS too, and scoping `classes` by tenant made `classes_select` ↔ `enrolments_select`
  mutually recursive. Use a `SECURITY DEFINER` lookup (`class_tenant()`, `session_tenant()`,
  `parent_has_child_in_class()`). Note this could not happen while `classes_select` was
  `USING (TRUE)`: **the leak was also what kept the policy graph acyclic.**
- **ACTIVITY AND ASSIGNMENT ARE SEPARATE AXES, AND ACTIVITY IS PER BUSINESS.**
  `students.is_active` / `parent_tenants.is_active` answer "still a customer of THIS
  business?"; `assignment_status` (`unassigned | assigned`) answers "in a class?". A new
  signup is **active but unassigned** — collapsing them is what made "inactive" ambiguous,
  and the enum no longer carries an `inactive` value. Activity lives on `parent_tenants`
  because parents are global: a global flag would let one business switch a family off at
  another. Full spec: PRD §7.14.
  - **The family flip is a CONSEQUENCE, not an invariant, and MUST NOT become a trigger.**
    Deactivating a child asks about siblings; a family with no active children left going
    inactive follows from that and is stated, not asked. A trigger enforcing
    `no active children ⇔ family inactive` **breaks join-code reactivation**, because a
    returning family has zero active children by design and would be flipped straight
    back. Propagation is one-way and event-shaped, in `set_students_active()`.
  - **`set_students_active()` is the sole writer** of both flags, and takes an ARRAY so the
    set the admin confirmed in the prompt is the set that gets written. `parent_tenants`
    has **no UPDATE policy**, so RLS already forbids every other path.
- **A FACT ABOUT A PAST LESSON IS NEVER A LIVE LOOKUP.** This now covers the student's
  NAME as well: `invoice_items.student_name` and `credit_notes.student_name` record the
  name the document was ISSUED with (2026-07-19). Five screens previously joined it live,
  so a rename rewrote invoices already sent and credit notes PRD §7.8 calls immutable.
  Pre-snapshot rows are NULL rather than back-filled — inventing a historical name from
  today's value is a guess presented as a record. What a lesson cost and who was
  paid for it come from `class_rates` via `class_rate_on(class, session_date)` — the terms
  in force on the lesson's **own date** (`20260719000700`). Reading `classes.price_per_lesson`
  or `classes.coach_id` at generation/payroll time is the bug this removed, three times over
  (§8). `classes.price_per_lesson` survives only as a **trigger-synced display copy** and
  carries a `COMMENT` saying so. Audit:
  `grep -rn "price_per_lesson" supabase/functions SwimSyncAdmin SwimSyncApp` — every money
  path must go through `class_rate_on`.
  - **`classes.coach_id` stays where it is and means "who teaches this NOW".** It drives
    **RLS** (`coach_owns_class`, `coach_owns_session`, `coach_serves_student`,
    `coach_serves_parent`). Access follows the current coach; money follows history. Do not
    "finish the job" by moving it into `class_rates` — that trades a billing fix for a
    rewrite of the largest permission surface in the codebase.
  - **A missing rate is a HARD FAILURE in both engines**, never a fallback to 0 or to
    `classes.price_per_lesson`. Every class is guaranteed floor-dated terms
    (`'2000-01-01'`, *not* `created_at` — attendance is markable a month back, so a lesson
    legitimately predates the row that created its class).
- **An adjustment is carried ONCE, via a running total**, not "emit once then suppress":
  `owed_now − paid_originally − already_carried` (`20260719000900`). Suppression looks
  equivalent and silently swallows a *second* genuine correction to the same lesson.
- **Wage rates are EFFECTIVE-DATED and only ever INSERTED.** A lesson is priced at the rate
  in force *on the day it was taught*, so no number of raises can reprice history. Editing
  a rate in place would change what a coach was owed in March because of a June decision —
  the same family as the UTC billing-month bug. Backdating a rate *does* produce back pay,
  deliberately.
- **Expand / contract, and the deploy order flips with the direction.** Adding? Migrate
  first (the new UI queries the new tables). Dropping? Deploy the app first (the live app
  still reads the old columns). A `git push` deploys both web apps via Vercel; migrations
  are a separate manual `supabase db push`, so they can never land atomically.
- **Dates are Singapore-local; never derive a date string from `toISOString()`.** That
  yields the **UTC** date, which is the *previous day* in SGT (UTC+8) before 08:00 —
  this shipped a real double-billing bug (§7.7). Use `todayInSg()` / `toSgDate()` from
  `lib/lessonDates.ts`, and derive a weekday from that same string via `dayOfWeekOf()`
  rather than a separate `new Date().getDay()`. Full ISO **instants** (`paid_at`,
  `updated_at`) are fine as-is — only date-*string* derivations are affected. The same
  rule now covers the **invoice engine's default billing month**: it is derived in the app
  timezone via `generate-invoices/dates.ts` (`previousBillingMonth()`), **not** `new
  Date()`'s local/UTC fields — see §8a and gotcha §7.12. The timezone is a single seam
  (`APP_TIMEZONE`, default `Asia/Singapore`), **deliberately not per-tenant** — one
  configured zone is enough while all usage is SGT, and true multi-timezone folds into the
  tenanting work when that lands.
- **`lib/lessonDates.ts` is duplicated byte-identical in both apps** — deliberate. There
  is no shared package: separate npm projects, no workspaces, different React majors,
  different bundlers/test runners. Sharing ~120 lines of pure date maths would need
  workspace + Metro `watchFolders` + `transpilePackages` surgery. The file has **zero
  imports** so drift is cheap to spot (`diff` the two); each has its own test file
  (identical but for jest-globals vs a vitest import). **Edit both.**
- **A LEVEL IS THE BUSINESS'S OWN VOCABULARY, AND IT IS NEVER PARENT-SET.**
  `swimming_ability` (the fixed beginner/intermediate/advanced enum) is **gone** —
  dropped 2026-07-19 after being always-NULL since parents stopped self-reporting
  ability. Levels now live in `tenant_levels` (per business, explicitly ordered) with
  `students.level_id`, and each rung carries an ordered `tenant_level_skills` list.
  - **Don't re-add a parent-facing level picker.** Parents self-reporting ability was
    removed on purpose; a level is the coach's judgement (PRD §5.1).
  - **Skills are ROWS, not a text blob** — a curriculum is a list, and prose cannot be
    counted, ordered, or ever ticked off. This is the whole reason per-child progress
    tracking (backlogged) will not need a migration out of a description field.
  - **The ladder is FLAT and generic on purpose.** Tiers, milestone markers and
    progression graphs ("T4 → B3") are **deliberately not modelled**: businesses
    structure levels differently, so modelling one school's shape forces every other
    tenant into it. A school with 16 rungs across 5 tiers names them that way and orders
    them; `tenant_levels.note` carries any progression rule in their own words.
  - **The admin sets a student's level; coaches have no write path to `students`** —
    granting them `UPDATE` would also expose names, DOBs and notes, because RLS is
    row-level, not column-level. Coach-set levels would be an RPC, not a policy change.

- **A CHILD IS IDENTIFIED BY NAME + DATE OF BIRTH, and age is DERIVED.**
  `students_identity_uniq` is an **expression index** on
  `(tenant_id, lower(trim(full_name)), date_of_birth)` — a plain index is defeated by a
  trailing space or a capital, which is the appearance of a constraint without the
  substance. NULL DOB never collides, which is what made it safe to apply to live data
  with no backfill.
  - **`students.age` is dropped and must not come back.** A stored integer beside the
    date it derives from goes stale the day after it is written — the same disease
    `class_rates` removed from money. Use `ageFromDob()` in `lessonDates.ts` (**both
    apps**), which returns `null`, never `0`.
  - **NRIC was considered and declined.** Partial NRIC is still personal data under PDPC
    guidance and its collection is restricted, so it needs a standing justification and
    would put regulated data on every coach's roster. DOB was already collected. Don't
    reintroduce it without that reasoning changing.

- **THE TENANT BOUNDARY ON `students` IS A TRIGGER, NOT A POLICY — AND NOT COLUMN GRANTS.**
  `students_update`'s `WITH CHECK` cannot see the OLD row, so it cannot say "this column
  did not change"; a parent could therefore move their own child to another business and
  still satisfy it (fixed 2026-07-19, verified exploitable first). `pin_student_tenant()`
  pins `tenant_id` and `created_by`; `pin_parent_identity()` does the same for
  `parents.profile_id`.
  - **Column grants were rejected deliberately.** `REVOKE UPDATE` + `GRANT UPDATE (cols)`
    is equally airtight but enumerates columns, so every column added later is silently
    read-only until someone extends the grant — a trap that would have fired on the very
    next migration.
  - The seam is **`current_user`, not `auth.uid()`**: the legitimate writers are
    `SECURITY DEFINER` owned by `postgres`, so client DML is distinguishable by the role
    it arrives as. Any new SECURITY DEFINER writer inherits the exemption automatically.

- **The mark renders two different ways on purpose, and is absent from the invoice email
  on purpose.** `SwimSyncAdmin/components/Logo.tsx` inlines the SVG paths (recolourable via
  `currentColor`, no request); `SwimSyncApp/components/Logo.tsx` uses a white-knockout
  **PNG** at @1x/@2x/@3x with `tintColor`, because the app has **no `react-native-svg`** and
  adding a native module to a project that has not cut a native build is a risk branding
  does not justify. The geometry therefore lives in two places — `brand/mark.svg` (source of
  truth) and the admin component — the same duplicate-and-document arrangement used for
  `lessonDates.ts`, and `brand/README.md` says so. **Don't add the mark to the invoice email
  header**: that slot belongs to the *tenant's* logo (PRD §7.10).

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
8. **~~The engine's completeness gate never fires on the admin path.~~ FIXED 2026-07-18
   (§8a).** For months, `SwimSyncAdmin/app/api/generate-invoices/route.ts` hardcoded
   `force: true`, which bypassed the gate, the auto switch and the month seal — so the
   admin confirm modal's gap report was the *only* thing between a forgotten lesson and an
   underbill, and it merely warned. The route no longer sends `force`, and unmarked
   attendance now **blocks** generation outright in every mode. Kept here because the
   shape of the mistake is worth remembering: **a safety gate that the only live caller
   bypasses is not a gate.** `force` still means "skip the sealed-month guard" (the
   documented reopen path) and nothing more — don't re-add it to the route to "make
   generation work"; if generation refuses, the answer is to mark the lesson.
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
    typecheck guard (§8d) was validated against a stubbed-out fresh checkout, not just a local
    pass.
12. **The invoice engine's DEFAULT billing month was UTC-derived** — same family as #7,
    different door. `core.ts` computed the previous month from `new Date().getMonth()`,
    which is the **UTC** month on Edge Functions. The daily cron POSTs an empty body, so it
    used this default: at the 1am SGT run (17:00 UTC the day before) it would bill a month
    early (1 Aug → June, not July). Latent because invoicing is manual (the admin always
    sends an explicit month) and cron is off. **Fixed** (§8a) — the default now derives the
    calendar date in `APP_TIMEZONE` via `generate-invoices/dates.ts`. Don't reintroduce a
    `new Date()`-field month derivation in the engine. Audit:
    `grep -rn "getMonth\|getFullYear\|new Date()" supabase/functions/generate-invoices/core.ts`.

13. **Billing must follow ATTENDANCE ROWS, not active enrolments.** `core.ts` used to build
    its billable student set from `student_class_enrolments … is_active`, so closing an
    enrolment dropped that child's *already-attended* lessons from the invoice entirely.
    Latent while nothing could unenrol — then the "Remove from class" button (§8a) made a
    silent month-sized underbill one tap away. The two questions are genuinely different:
    **active enrolments answer "who must be marked" (the completeness gate); attendance
    rows answer "who gets billed."** Don't collapse them back together. Audit:
    `grep -n "activeStudentIds" supabase/functions/generate-invoices/core.ts`.
14. **`Number(null)` is `0`, so a "missing setting" can clamp to the *most aggressive*
    value.** `clampRunDay` coerced first and clamped into 1..28, which turned an unset
    `invoice_run_day` into **day 1** — the earliest possible run, exactly what the setting
    exists to prevent. Missing/unparseable/out-of-range-low now falls back to the default;
    only too-*high* values clamp (29–31 → 28, which would otherwise never fire in
    February). When normalising config, decide separately what "absent" means and what
    "out of range" means — they are not the same answer.
15. **A test suite that seals state can pass once and fail on the second run.** Manual runs
    now seal a month (§8a), so every completing test left a `billing_periods` row and the
    *next* run short-circuited on `already_complete`. `teardown()` clears the months its
    sessions fall in. **Run the Deno suite twice** after touching the engine — once proves
    nothing about leaked state.
16. **`SET LOCAL ROLE` outside a transaction is a no-op, and psql will not stop you.** An
    RLS check written without `BEGIN`/`COMMIT` runs as `postgres`, which **bypasses RLS
    entirely** — so every case "passes", including the ones that should be denied. Wrap
    RLS probes in an explicit transaction, and make sure at least one case is expected to
    FAIL, so a silently-superuser session is visible.
17. **A guard made of "nothing went wrong" conditions fires hardest when nothing happened.**
    The month seal required no-incomplete-class AND no-deferred-parent AND no-failed-write —
    every one of which is **vacuously true on an empty run**, so a month where nobody had
    marked any attendance sealed itself and was locked out of billing (§8a.1). It reached
    production. **When a terminal/irreversible action is gated on a conjunction of negatives,
    add a positive: require that the work actually occurred** (here: at least one class
    genuinely reckoned with). Same shape as §7.14 (`Number(null)` → 0 → the most aggressive
    value): in both, an *absence* of input silently satisfied a rule written to police
    *presence* of input. Ask what your guard does on empty input, not just on bad input.
18. **The engine's completeness gate could not see a lesson nobody touched.** FIXED
    2026-07-18 (phase 0 of tenanting). `core.ts` selected `lesson_sessions` rows that
    **exist** and checked those were fully marked — but sessions are created *lazily* by
    attendance marking (PRD §7.5), so a lesson nobody touched has **no row**, and a class
    with no rows at all was `continue`d entirely. A month with four lessons where three were
    marked reported **"complete — billing month sealed"**: it billed three, sealed the month,
    and the fourth could never be billed (later runs short-circuit on `already_complete`, and
    the no-double-billing guard skips a parent who already has an invoice). A single
    forgotten lesson became a permanent, silent underbill — the exact hole §8aD was written to
    close.
    **The shape worth remembering:** the rule existed in four hand-written copies and they
    had *drifted*. The admin's `computeClassCoverage()` derived expected dates from the class
    weekday and caught this; the engine never did. So the only effective gate was the
    **client-side** one — gotcha §7.8 inverted (there, the only live caller bypassed the
    gate; here, the real gate wasn't the server's). **Two implementations of one safety rule
    is one implementation and one liability.** Now shared — see §6.
    Pinned by four Deno tests, incl. one that fails on the pre-fix engine with
    `"complete — billing month sealed"` instead of `"incomplete_attendance"`.
19. **A type union is not a code path.** Phase 2 added `tenant_admin` to the app's `Role`
    type but left login branching on `role === "coach"`. The tenancy backfill correctly made
    the real coach a `tenant_admin`, and they were met with *"Unrecognised role. Please
    contact support."* — **locked out of production.** The design had always said to route on
    **which extension rows exist**, not the enum. When you widen a type to admit a new value,
    grep for every branch that consumes it. Now one pure function (`lib/landing.ts`) used by
    both call sites.
20. **A new table does NOT inherit RLS.** `CREATE TABLE` leaves row-level security *off*,
    and a table with policies but RLS disabled reads as though the policies were never
    written — they are simply not consulted. Three tenancy tables shipped that way in
    development, leaving **every join code world-readable**. Always
    `ALTER TABLE … ENABLE ROW LEVEL SECURITY` explicitly. Audit:
    `SELECT relname FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND NOT relrowsecurity;`
21. **Postgres does not track function bodies as dependencies.** Dropping
    `is_superadmin()` errored on the *policies* that used it (good — that is how the storage
    policies were found) but said nothing about `close_student_enrolment()` and
    `handle_attendance_update()`, which call it in their bodies. Those would have failed at
    **runtime**, on a live coach-facing path. After removing a function or column, grep the
    function bodies too: `grep -rn "<name>" supabase/migrations/`.
22. **`Number("")` is 0 — again.** A blank wage-rate field passed a `>= 0` guard and saved a
    **$0 rate**, which is worse than no rate: the coach reads as "on payroll" and earns
    nothing. Same shape as §7.14 (`Number(null)` → day 1). Check for empty *before*
    coercing, every time.
23. **Watching one app's deploy tells you nothing about the other's.** The mobile app and
    the admin are **separate Vercel projects**. After a push, `/wages` 404'd while the app
    bundle had already changed. Compare a known-good route against a known-bad one to tell
    "not deployed yet" from "broken build", and wait on the surface you actually changed.

24. **A deleted Next.js route leaves a stale generated type behind, so the admin typecheck
    fails *after* you clean up.** A throwaway `app/logocheck/page.tsx`, added to render a
    component in isolation and then deleted, left `.next/types/app/logocheck/page.ts`
    behind — and `SwimSyncAdmin/tsconfig.json` `include`s `.next/types/**`, so
    `tsc --noEmit` failed with `TS2307: Cannot find module '…/app/logocheck/page.js'`,
    naming a file that no longer exists. Same family as §7.11 from the opposite direction:
    there the git-ignored type stubs were *missing* in CI, here a *stale* one lingered
    locally. It never reaches a commit or CI (`.next` is git-ignored) — it only breaks the
    local check, confusingly, and looks like your own change broke something. Fix:
    `rm -rf SwimSyncAdmin/.next/types/app/<route>`. Related: Next treats `_`-prefixed
    folders as **private**, so a scratch route named `_logocheck` silently 404s.

25. **A test can pass for the WRONG REASON, and a green suite hides it.** Writing the
    regression test for the repricing bug (§8), I dated the price change `2026-08-01` —
    *future* relative to the test clock. The display-sync trigger only tracks rates already
    in force, so `classes.price_per_lesson` never moved and the **pre-fix engine read the
    right number by accident**. The test passed on the very code it existed to catch. It was
    only found by deliberately reverting the fix and re-running. **Every test written for a
    known bug must be run against the unfixed code before you trust it** — "it passes" is
    not the claim being made; "it fails without the fix" is. All 26 tests added this session
    were checked that way, and five of the nine wages tests do *not* discriminate (they are
    regression guards, and that is written next to them).
26. **A guard that fires correctly can look like a broken fix.** The new
    settled-money guard in `set_class_terms()` refused my own test, because the shared wages
    fixture marks a **December 2026** payout paid while the test clock is July — so
    "reprice from today" legitimately collides with a later paid period. The instinct is to
    weaken the guard to make the test pass. **Move the test instead**: `class_terms.test.sql`
    got its own tenant. A fixture is not a reason to loosen a real rule.
27. **`git push` to `main` deploys the WEB APPS but not the database.** Obvious in the
    abstract, and I still got the order wrong this session: pushing before
    `supabase db push` shipped an admin panel calling `set_class_terms()` **before the RPC
    existed**, so class editing was broken in production until the migration landed. The
    rule from §6 is directional — **adding? migrate first. dropping? deploy the app first**
    — and it governs the *push*, not just the migration command. Nothing is atomic here.

28. **A `.select()` result is `any`, so reading a column off the WRONG JOINED TABLE
    typechecks.** The parent home query nests
    `students(… student_class_enrolments(is_active …))`, and I added `s.is_active` to the
    mapping — which resolved to nothing, because `is_active` was on the *enrolment*, not
    the student. `tsc` was clean; **every child would have rendered as "Inactive"** in
    production. Only driving the app caught it. When a column name exists on more than one
    table in a nested select, read the select's shape, not the mapping's. Audit:
    `grep -n "is_active" <the select block>` and check the nesting level.
29. **Removing a value from an enum silently changes what OTHER screens say.** Dropping
    `inactive` from `assignment_status` left departed children reading **"Unassigned"** to
    their own parents, and reappearing in the admin's **Unassigned Children** queue as if
    awaiting placement — because that is now literally their assignment status. Neither is
    a type error and neither failed a test. When you retire an enum value, find every
    screen that *rendered* it and decide what it says now, not just every branch that
    compared to it (§7.19 is the compile-time half of this; this is the runtime half).

30. **`supabase db push` APPLIES EVERY PENDING MIGRATION, and auto-confirms when it is not
    on a terminal.** It prints a `[Y/n]` listing them; run non-interactively, that is a
    yes. This is §7.27's successor and it bit *harder*, because the deploy had been
    explicitly designed in two phases and the contract migration **renumbered to sort last**
    an hour earlier specifically so it could be held back. **Renumbering is a convention the
    tool does not read.** All seven went in together, production dropped
    `students.swimming_ability` while both live bundles still selected it, and six screens
    broke. To hold one back it must not be in the directory:
    `mv supabase/migrations/<contract>.sql /tmp/hold/` → push → deploy apps → move it back
    → push again. Recovery is usually **forward** (deploy the app that stopped querying the
    column), not a rollback.
31. **An HTTP 200 does not tell you which BUNDLE is being served.** Both web apps are SPAs
    that return 200 with the old JS. After the push above, the admin's `/levels` had gone
    404→200 (§7.23's comparison, working) while `swimsync.sg` was **still serving the old
    bundle including the dropped column's query**. Grep the deployed asset for a string only
    the new build has:
    `B=$(curl -s https://swimsync.sg | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1); curl -s "https://swimsync.sg$B" | grep -c "<new-string>"`

32. **A CLAMP THAT MAKES A CHECK FAIR CAN ALSO MAKE IT VACUOUS.** The completeness gate
    clamps its window to today (`windowTo = todayDate < monthEnd ? todayDate : monthEnd`) so a
    lesson that has not happened yet is not reported as a gap. Entirely correct in itself —
    and it meant a run on an **in-progress** month saw only the lessons so far, judged the
    month **COMPLETE**, billed them, and **sealed** it. Every remaining lesson of that month
    was then permanently unbillable (later runs short-circuit on the seal; the
    `already_exists` guard skips the parent even if it is reopened). Nothing validated that
    the billing month had **ended** — the engine checked only the `YYYY-MM` *format*, and the
    admin's picker defaulted to the current month with no `max`. Fixed 2026-07-19: the engine
    refuses `billingMonth > previousBillingMonth(now)` before anything can seal, and `force`
    cannot reach it. **The shape worth remembering:** when a rule is relaxed to be fair to
    incomplete input, ask what it now says about input that is *entirely* incomplete. Same
    family as §7.17 (a conjunction of negatives is satisfied hardest by an empty run) — there
    the guard was vacuously *true*, here the window was vacuously *small*.
33. **A test suite that reads the real clock changes meaning as the calendar advances.** The
    engine suite hardcoded billing months (`2026-07`, `2027-11`, `2028-02`) and mostly did not
    say what "now" was, so months sat in the *future* of the test clock — where
    `expectedLessonDates` returns nothing and the completeness gate passes by having nothing
    to check. Tests were partly inert and nobody could tell, because the suite was green.
    Correcting the clock made the gate engage for the first time and immediately exposed two
    fixtures that had never actually been complete. Fixed by making the clock part of the
    fixture (`monthEnded()` in `test-helpers.ts`), with `newScenario()` **throwing** on a
    scenario that expects zero lessons. **Never date a test's fixture relative to the wall
    clock**, and prefer a helper that cannot construct the vacuous case over a comment asking
    the next person to check for it.
34. **An absolutely-positioned element with NO `left`/`top` is placed at its STATIC position,
    which is not necessarily the corner.** The auto-generation toggle's knob was
    `absolute top-0.5` with no `left`, plus `translate-x-5` for the "on" state. A `<button>`
    **centres its content**, so the knob's static x was already ~22px into a 44px track and
    the transform pushed it to 42px — **18px outside the track**. Both states were wrong (off
    sat flush against the *right* edge), which is why the reported symptom was "a blue pill
    with no knob". Always anchor a transform-driven knob (`left-0`) so the offset is measured
    from a known origin. Found by **measuring rects from the DOM**, not by looking at a
    screenshot — `verify-invoice-controls.mjs`, same technique as §7.9. **Run a driver against
    the unfixed code first**: the 14/21 baseline is what located the cause, and without it the
    fix would have been a guess that happened to work.
35. **`CREATE FUNCTION` GRANTS `EXECUTE` TO `PUBLIC` BY DEFAULT — including `anon`.** A
    `SECURITY DEFINER` function runs as its owner and **bypasses RLS entirely**, so its own
    body is the whole boundary; there is no policy behind it to catch a mistake. Combined
    with the default grant, forgetting either layer exposes it to unauthenticated callers.
    Always **`REVOKE ALL … FROM PUBLIC`** *and* gate the body. And test the gate against
    **every caller shape that can reach it** — for `platform_tenant_overview()` that is anon,
    a parent, a coach *and* a tenant admin, not "a non-admin": three of those four arrive
    through ordinary sessions, and a test that tries only one proves almost nothing. Audit:
    `grep -n "SECURITY DEFINER" -A 12 supabase/migrations/*.sql` and check each has both.
36. **A shared table component that does not emit its own `<tr>` splits the convention, and
    the losing half is INVALID HTML.** `<th>` cannot be a child of `<thead>`; React reports
    it as a **hydration error at runtime**. `Thead` left the row to callers, so nine call
    sites wrapped their `<Th>`s and three did not — `/wages`, `/levels` and `/platform` were
    throwing hydration errors **in production** and nobody had noticed, because the page
    still renders. Fixed by making `Thead` own the `<tr>`, which makes the broken form
    unrepresentable rather than something each caller must remember. **When a shared
    component leaves part of a required structure to its callers, the callers will diverge** —
    put the required part inside. Audit: watch the Next dev overlay's issue count, and check
    the browser console on a page you have touched; a hydration error is silent otherwise.
37. **A STORED COLUMN THAT NOTHING MAINTAINS IS NOT A FACT — don't display it, derive it.**
    Two of these shipped together on the new Platform page and the user caught both within a
    minute of seeing their own row:
    - `tenants.kind` reads `'private'` because that is its **DEFAULT** and the tenancy
      backfill hardcoded it. No screen, RPC or admin control has ever set it. Displaying it
      as "Type" would have said *private* for a genuine swim school and nobody would have
      questioned it, because it looks like data.
    - The "no rate" warning fired on a **private coach**, whose absent rate is the state
      PRD §7.13 calls **correct** — their income is their parents' invoices. A warning about
      a correct state is noise that never goes away.
    Both are now derived from *is this coach also the tenant's admin* — a fact something
    actually maintains. **Before putting a column on a screen, find its writer.** If nothing
    writes it, either derive the answer or don't show it; a reserved-for-later field rendered
    as truth is worse than an empty column, because an empty column prompts a question.
    Audit: `grep -rn "<column>" supabase/migrations/ | grep -i "update\|insert\|set "` — no
    hits beyond the DDL means nothing maintains it.

38. **A `SECURITY DEFINER` trigger cannot see who the client is — `current_user` inside it
    is `postgres`, so every current_user-seam check waves everyone through.** The package
    lifecycle trigger shipped its first draft as DEFINER (to read products "safely") and a
    parent's request could insert itself as `active` — caught because pgTAP tests the
    parent role path. `pin_student_tenant()` works precisely because it is NOT definer:
    client DML arrives as `authenticated`, definer functions as `postgres`, the engine as
    `service_role`, and a plain trigger sees those differences. If a trigger needs both the
    seam and privileged reads, it is two functions, not one flag. Audit:
    `grep -B3 "current_user" supabase/migrations/*.sql | grep -i "definer"` — any hit is
    this bug.

---

## 8.8 Eighth session (2026-07-20) — PREPAID LESSON PACKAGES — BUILT, NOT YET DEPLOYED

Branch **`feat/lesson-packages`**, seven commits, **NOT merged to `main` and nothing
deployed** — the deploy sequence is §9's first item. Designed with the user across a long
walkthrough first (the record is `PACKAGES_DESIGN.md`, written via /plan-review with
mitigations inline); every phase then built and verified locally in one run.

**What shipped (local):** the full §7.16 feature — schema (`20260720000100`), engine
drawdown, correction-restore trigger (`20260720000200`), admin Packages page + class
categories + the per-tenant "running low" students filter, the parent Packages tab with
request→PayNow→confirm flow, purchase emails via a new `package-emails` Edge Function,
and `verify-packages.mjs` (16/16 against both running UIs).

**Design calls worth remembering** (full reasoning in PACKAGES_DESIGN.md §1): dollars
stored / lessons derived; locked rate always, price rise = new product; scope =
tenant-defined class categories, tiers = products (a class is never duplicated per
tier); wallet floors at zero and the INVOICE stays the only debt instrument (an early
"wallet can go negative" idea was walked back — a negative wallet and an outstanding
invoice are the same debt recorded twice); FIFO by earliest expiry; expiry judged on the
lesson's own date; restore-not-credit on corrections. The cash-vs-value-granted problem
dissolved once the discount moved into the rate itself.

**Verification:** 244 pgTAP (30 + 12 new) with the correction suite proven failing 9/12
on the pre-fix trigger; 91 Deno (10 + 7 new) run twice, all engine tests proven failing
on the pre-package engine; both apps typecheck under the §7.11 stubbed condition; the
§7.20 RLS audit returns zero rows; the ⚠RISK-1 tenant-filter grep and ⚠RISK-4
no-TS-derivation grep both pass. The pre-commit gate in PACKAGES_DESIGN.md was walked.

**Found on the way:** the SECURITY DEFINER trigger seam bug (now gotcha **§7.38** —
caught by pgTAP exercising the parent role, verified the failing way); the driver's
first run bought the wrong product (`.first()` on an ambiguous button) and one of its
own assertions was §7.10-weak (page-wide innerText matching the products table) — both
fixed, and the weak assertion replaced with a string only the held-row cell renders.

**The write-failure path is now tested too** (closed 2026-07-20, same session, after
the user asked about it): `generateInvoices` takes the client as a PARAMETER, so fault
injection is just a Proxy shim that fails exactly the `package_applications` insert —
no harness needed, an oversight in the original "can't test this" claim. The test pins:
month unsealed + no `billing_periods` row, failure named in the run log, balance
untouched (the decrement is sequenced after the ledger), `checkInvariants` DETECTS the
invoice/ledger mismatch, and a clean retry seals. Proven discriminating by mutating the
flag out and watching it fail on "must not seal" (§7.25).

**Deliberately not done:** in-app refunds (admin cancels, remaining value shown, money
settles offline); parent low-balance notifications (admin filter shipped first);
arbitrary top-ups (buy another package). All in `BACKLOG.md` with reasoning.

---

## 8.7 Seventh session (2026-07-19) — THE PLATFORM ADMIN GETS THEIR OWN PANEL — DEPLOYED

Branches `feat/platform-admin-scope` and `fix/derive-tenant-shape`, both merged and **live**.
Two migrations, `20260719002300` and `20260719002400`, both applied (`migration list` shows
47 local, none pending). Deployed **migrate first, then push** — EXPAND, the opposite of
§8.6's branch, and the reason is the direction, not habit.

**Verified in production without a login:** calling both RPCs with the public anon key
returns `permission denied for function …` — the `REVOKE ALL … FROM PUBLIC` layer holding,
before the body's gate is even reached. Re-checked *after* `002400`, because that migration
**DROPs and recreates** the function and **a DROP takes its grants with it**; re-applying both
REVOKEs is why the second check mattered.

**Confirmed on production 2026-07-19, by the user, signed in as both roles:** the platform
admin lands on Platform with only that nav item and one correct business row; the real coach
(tenant admin *and* coach — the §7.19 account) still has all eleven pages. That was the check
that mattered, and it is the one no amount of local fixture work could have made.

### The bug: every business page was open to an account with no business

`Sidebar.tsx` had a `platformOnly` flag for `/platform` but **no inverse**, so a platform
admin saw all eleven business tabs. They did not error — a platform admin's RLS reach is
every row of every table across every tenant — they rendered **several businesses' data as
though it were one**. The dashboard's *"Total Students — Across all coaches"* was really
across all *businesses*. An error teaches you a page is not for you; a page that quietly sums
two schools together looks authoritative and is wrong.

- **Gated on `tenant_id`, never on `role`.** A private coach holds `tenant_admin` *and* a
  `coaches` row; branching on the enum is what shipped *"Unrecognised role"* to the only real
  coach in production (§7.19). The question is "do you have a business?" and `tenant_id`
  answers it, so a renamed or added role keeps working.
- **The guard UNMOUNTS rather than overlaying.** A notice rendered above `children` leaves
  the page mounted — effects fire, tables paint underneath, and a test looking for the notice
  passes anyway (§7.10). `RequiresTenant` early-returns; an unmounted child cannot query.
- Applied once in the `(admin)` layout, keyed off each route's `scope` in `lib/adminNav.ts` —
  the same declaration the sidebar renders from. **Unknown paths fail closed.**
- `/dashboard` redirects (nobody chooses to visit it); everything else refuses in place.

### The platform page now answers the operator's question

One row per business: families, students, classes, coaches (flagged when any has **no rate**,
which is why payroll silently computes nothing), **last attendance**, sessions recorded vs
fully marked, and last month's billing state — plus **parents who registered but never
entered a join code**, who belong to no business and were invisible to everyone.

On the seeded stack it reads at a glance: *never marked · 1 no rate · never run*. That is
production's actual situation, and no screen said it out loud before.

- **`platform_tenant_overview()` aggregates in Postgres**, replacing an N+1 client loop that
  was also silently capped at `max_rows = 1000` — correct at one tenant, quietly wrong later
  (§7.17 / §7.32's family). See §7.35 for the SECURITY DEFINER trap it had to avoid.
- **No "unmarked lessons" column, deliberately.** That needs the expected-lesson-dates rule,
  which already exists in three hand-written copies; a fourth is what §7.18 is about. The RPC
  returns **facts about rows that exist**, and the labels say so.

### Found and fixed on the way

- **`<th>` cannot be a child of `<thead>`** — a **live hydration error** on `/wages`,
  `/levels` and `/platform`. See §7.36; `Thead` now owns the `<tr>`.
- **`verify-platform-admin.mjs` had been failing 3/4** since family status added a second
  "Search" button — a strict-mode violation nobody saw because the driver is hand-run.
  Confirmed pre-existing by running it against the unmodified page. Now 6/6.

### Then the user looked at their own row and found two things wrong

Both the same mistake — **a stored value displayed as a fact** (§7.37):

- **"1 no rate" on a private coach.** PRD §7.13 says a private coach has no rate *by design*:
  their income is their parents' invoices and there is nobody upstream to pay them. Flagging
  it warns about the correct state, forever, on every private coach's row. Now counts
  **staff** only — a coach who is *not* the owner and has no rate, which is the case where
  payroll silently pays someone nothing.
- **"Type: private"** came from `tenants.kind`, an enum defaulting to `'private'` that
  **nothing sets, changes or reads** — hardcoded by the tenancy backfill and untouched since.
  It would have read "private" for an actual swim school. Replaced with a **derived** shape:
  one coach who is also the admin is a private coach, anything else is a school.

Both discriminate on *is this coach also the tenant's admin*, never on `kind` — coach type is
not a rule in this codebase (§6), and routing on which extension rows exist is the same
principle that keeps a private coach working everywhere else.

**`20260719002400` is a NEW migration, not an edit to `002300`** — that one was already
applied in production, so editing it would have left the file disagreeing with the database
and the change would never have shipped. `DROP` before `CREATE` because the return type
changes, and both REVOKE layers re-applied because the DROP takes grants with it.

### Not done (deliberate)

- **The family-status search still scans client-side** and is capped at 1000 (`BACKLOG.md`).
  Left working, not extended — fixing it is a server-side search, its own piece of work.
- **No "view as tenant" impersonation.** Still rejected, for the reasons in PRD §4.4.
- **`tenants.kind` left in the schema, read by nothing.** It is reserved for future pricing.
  Recorded in `BACKLOG.md` → *Deliberately not doing* so nobody wires a display to it again.

---

## 8.6 Sixth session (2026-07-19) — THE BILLING MONTH MUST HAVE ENDED (+ the toggle) — DEPLOYED

Branch `fix/billing-month-guard`, merged to `main` and pushed. **No migration.** Live:
both Vercel sites rebuilt and `generate-invoices` is at **v13** (sha `7fc54436…`, was
`f90c182d…`). Deployed **admin first, then the function** — see below for why.

### The bug: you could bill a month that had not finished

The admin's month picker defaulted to the **current** month with no `max`, and the engine
validated only that `billing_month` matched `YYYY-MM`. So on 19 July the obvious action was to
generate July — and the completeness gate's today-clamp made a mid-month run look **complete**,
so it billed the lessons so far and **sealed** the month. Every remaining July lesson would
then have been permanently unbillable. Full reasoning in §7.32.

Inert only because production has no attendance rows — the exact condition §9 says is about to
change, which is why this was worth doing before the onboarding push rather than after.

- **The guard is in the ENGINE**, before the sealed-month guard so `force` cannot reach it.
  `force` still means exactly one thing: skip the sealed-month guard. The picker's `max` is an
  affordance; §7.8's lesson is that a gate only the client enforces is not a gate.
- **A refusal must RENDER as a refusal.** `handleGenerate` fell through to a generic
  *"Created N invoice(s)"* for any unknown status, so the refusal would have shown as a green
  *"Created 0 invoice(s) for July 2026"* — a correct guard presented as a completed billing,
  which is worse than the bug. The fallthrough now **fails safe** when a run created nothing,
  sealed nothing and deferred nobody, so any status added later inherits that.

### The test suite was the real work (§7.33)

The guard broke 23 of 41 Deno tests — because the suite ran on the **real clock** with
hardcoded months, so it had been partly inert and green. The months turned out to be
arbitrary (`newScenario()` gives every test its own tenant and parents, so
`UNIQUE(parent_id, billing_month)` cannot collide), so the clock is now part of the fixture
via `monthEnded()`, `completeMonth()` inherits it, and **`newScenario()` throws on a scenario
that expects zero lessons** — vacuity made impossible rather than discouraged.

Correcting the clock made the completeness gate engage for the first time and immediately
exposed two fixtures that had never been complete. One test changed meaning honestly: *"a month
with NOTHING recorded is never sealed"* now returns `incomplete_attendance` (which additionally
names the missing lessons) rather than `nothing_to_bill`, and a separate test covers the
genuine nothing-due case. The safety property — the month is not sealed — is unchanged.

**68 → 74 Deno.** Guard reverted and re-run: exactly the 4 engine guard tests go red, the
fixture-guard test correctly stays green. Suite run twice (§7.15).

### The toggle (§7.34)

Measured, not guessed. `verify-invoice-controls.mjs` reads track/knob rects from the DOM; the
**baseline against unfixed code scored 14/21** and is what located the cause — the knob had no
`left` anchor, so it was positioned from its static (button-centred) origin and overhung the
track by 18px. Also `shrink-0`, and `autoEnabled === null` now renders as *unknown* rather than
as a fabricated "off, day 7" (a platform admin has no tenant). `handleToggleAuto` deliberately
untouched — `auto_invoice_enabled` is `false` in production and enabling cron is a live
decision, so a silent regression there would block it. Driver now **21/21**.

### Deploy order for this one is ADMIN FIRST, then the function

Opposite of the usual instinct, because the UI change is purely **restrictive**: it stops
offering the current month while the engine is unchanged (harmless). Engine-first would open a
window where the engine refuses and the admin renders fake success.

```bash
git checkout main && git merge fix/billing-month-guard && git push   # 1. admin (Vercel)
# A 200 proves nothing (§7.31) — grep the served chunk for a string only the new build has:
B=$(curl -sL https://admin.swimsync.sg/invoices \
     | grep -oE '/_next/static/chunks/app/\(admin\)/invoices/[^"]+\.js' | head -1)
curl -s "https://admin.swimsync.sg$B" | grep -c month_not_ended       # expect >= 1
supabase functions deploy generate-invoices                           # 2. engine
supabase functions list                                               # confirm v12 -> v13
```

**No migration**, so `supabase db push` was never run — §7.30's trap could not fire here.

**§7.31 fired again, and the poll is why it was caught.** The first THREE polls of
`admin.swimsync.sg/invoices` returned a healthy 200 serving the **old** chunk
(`page-4ec41c53…`); only the fourth had `page-472c9b43…` containing `month_not_ended`. A
status code would have said "deployed" three times over, wrongly. **Always grep the served
asset, and poll it — the window here was over 90 seconds.**

### Verified on production 2026-07-19

The billing month reads **June 2026** and the picker refuses to offer July — checked by the
user through the UI, which is the path a real admin takes.

It was shipped before that check, resting on: v13 bundled from source containing the guard
(`core.ts:229`), 74 Deno tests over that exact code including both SGT boundary instants, and
the guard proven to fail without itself. The gap was real but bounded — worth naming rather
than glossing, which is why it sat here until it was closed.

If you ever want the server-side probe (it needs the production `CRON_SECRET`, which
correctly differs from the local one), expect `"status":"month_not_ended"` naming `2026-06`
and **no `billing_periods` row for July afterwards**:
```bash
curl -s -X POST https://cdmjeyauhxcgulhbxmsb.supabase.co/functions/v1/generate-invoices \
  -H "Authorization: Bearer $PROD_CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"mode":"manual","billing_month":"2026-07"}'
```

### Also done

Fixed three doc drifts found at session start (PRD §5.1 still called levels unbuilt; test
counts said 167; the cron line read as blocked rather than as an open decision). Amended
`.claude/skills/plan-review/SKILL.md` so review findings are folded into the step they govern
as an executable form — a step, an assertion with a pass/fail value, or a named prohibition —
rather than appended as a Risks section nobody reads at implementation time.

---

## 8. What changed (2026-07-19, fifth session — CHILD IDENTITY, LEVELS, ADDRESS — DEPLOYED, with an incident)

> **How to read the §8 sections — they are NEWEST FIRST, and the numbering does not run in
> reading order.** Five sessions happened on 2026-07-19, so the `.1`–`.4` suffixes number
> those sessions **chronologically** (`.1` = first) while they are *laid out* newest-first.
> Hence the run: **§8** (5th session) → **§8.4** (4th) → **§8.3** (3rd) → **§8.1** (1st) →
> **§8.2** (2nd) → **§8a** (2026-07-18) → **§8b…§8m** (older, each one day earlier).
>
> The newest session's own subsections are lettered **(a)–(e)**, deliberately not numbered:
> `§8.1` already means "the first session of 2026-07-19", and a second meaning would collide
> with 70+ live cross-references.
>
> **Don't "tidy" this by renumbering** — those references reach in from `PRD.md`,
> `BACKLOG.md`, `TENANCY_DESIGN.md` and `TENANCY_PLAN.md`, and the labels are load-bearing
> prose ("see §8a.1"). The cost is real and the gain is cosmetic.
>
> **RESOLVED 2026-07-19 (sixth session).** This note used to end "a sixth same-date session
> takes §8.5, and this section becomes it" — i.e. the newest session always holds the bare
> §8. That contradicts the rule directly above it: **16 references across these documents say
> a bare "§8" and all of them mean the FIFTH session** (child identity / levels / address).
> Renaming this section to §8.5 would silently repoint every one of them. So the sixth
> session took **§8.6** and sits above this one instead; "newest is always §8" was the
> cosmetic half and it lost. **New same-date sessions take the next §8.N and go on top** —
> the bare §8 is now a permanent label for the fifth session, not a moving pointer.

**Three backlog items, six commits, seven migrations — and NONE of it is in production.**
The near-term build order in `BACKLOG.md` is now empty. See §8.0 below for the deploy
runbook; it is not a normal one and the ordering is not uniform across the migrations.

### DEPLOYED 2026-07-19 — and the two-phase deploy failed. Read this before the next one.

Everything below is **live**: all 7 migrations applied, both Vercel projects serving the
new bundles, `generate-invoices` at **v12**. Backups (data + schema) were taken first.

Pre-flight probes against production all passed: **0** identity collisions, **0** students
with `swimming_ability` set, **0** with a stored `age`, and **0** invoice_items/credit_notes
(so the name backfill was a no-op). Production held 8 students, 8 parents, 1 tenant,
4 classes.

#### 🔥 THE INCIDENT: `supabase db push` APPLIES EVERYTHING, INCLUDING THE MIGRATION YOU MEANT TO HOLD BACK

The whole deploy was designed as two phases — expand, deploy the apps, *then* contract —
and the contract migration was even **renumbered to `002100` an hour earlier** so that
`db push` could be run twice. It made no difference.

`supabase db push` prints a `[Y/n]` confirmation listing every pending migration. **Run
non-interactively it auto-confirms**, so it applied all seven in one go, including
`20260719002100_drop_swimming_ability.sql`. Production dropped the column while both live
bundles still selected it — **six screens broken**: parent home, parent child detail, coach
roster, admin dashboard, admin students, admin unassigned.

**Renumbering is not a mechanism. It is a convention that the tool ignores.** To actually
hold a migration back, it must not be in the directory when you push:

```bash
mkdir -p /tmp/hold && mv supabase/migrations/<contract>.sql /tmp/hold/
supabase db push                 # expand only
# ...deploy the apps, CONFIRM they are live...
mv /tmp/hold/<contract>.sql supabase/migrations/ && supabase db push
```

Recovery was **forward**, not back: the new bundles do not query the column, and every
migration they need was already applied, so `git push` was the shortest path to a
consistent state. A rollback (recreate the enum type, re-add the column) was the
alternative and would have been slower for no benefit. Nothing was lost — the column was
verifiably always NULL.

#### The other half of the lesson: §7.23 again, and it was still worth checking

After the push, the admin's `/levels` went **404 → 200** while `/dashboard` held 200 — the
known-good/known-bad comparison saying the admin was live. **The mobile app was still
serving the OLD bundle at that moment**, `swimming_ability` query and all. Confirmed by
fetching the bundle and grepping it, not by trusting an HTTP 200 (the app returns 200
either way — it is an SPA shell). It took another ~25s.

```bash
B=$(curl -s https://swimsync.sg | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1)
curl -s "https://swimsync.sg$B" | grep -c "swimming_ability"   # 0 once correct
```

**Grep the deployed bundle for a string only the new build has.** A status code cannot
tell you which bundle is being served.

### (a) A parent could move their child into another business (SECURITY, pre-existing)

`students_update`'s `WITH CHECK` is a copy of its `USING` clause, and nothing in it mentions
the **new** `tenant_id` — while `parent_owns_student(id)` stays true after the move.
Verified exploitable: as the owning parent, one `UPDATE` put two children onto a rival
business's roster.

That defeats the **join code**, which is the only proof a family deals with a business
(PRD §5.1), and lands the child where another admin can see and bill them. **Reachable
today via a direct API call** — it has never been reachable through the UI only because
nothing in the app updates `students`, which the edit-child screen changes.

**RLS cannot express this**: a `WITH CHECK` cannot see the OLD row, so it cannot say "this
column did not change". Hence a `BEFORE UPDATE` trigger. Chose that over column grants
(`REVOKE UPDATE` + `GRANT UPDATE (cols)`) deliberately — both are airtight, but grants
enumerate columns, so every column added later is silently read-only until someone extends
the grant. That trap would have fired on the very next migration (levels).

The seam is **`current_user`, not `auth.uid()`**: the three legitimate writers are
`SECURITY DEFINER` owned by `postgres`, so `current_user` is `postgres` inside them while
client DML always arrives as `authenticated`. The platform admin's rescue RPC still works,
and is tested to prove it.

### (b) A rename rewrote invoices that had already been sent (pre-existing)

`invoice_items` snapshotted `class_title` and `session_date` but **not the student's name** —
five screens joined `students(full_name)` live. So renaming a child silently altered
invoices already in a parent's hands, and credit notes PRD §7.8 calls immutable.

The codebase already states the rule: **a fact about a past lesson is never a live lookup.**
`class_title` proves it was understood here; the name was missed. Now snapshotted on both
tables, with the credit note taking its name from the **invoice item it credits** — a note
reverses one specific line and must name the student as that line did.

Pre-snapshot rows are **NULL, not back-filled**: inventing a historical name from today's
value is a guess presented as a record, which is the failure being fixed.

> **NEAR-MISS WORTH REMEMBERING.** `handle_attendance_update` has been redefined **six
> times**, and I first wrote the `CREATE OR REPLACE` from its **original 2026-03 body**.
> That silently reverted three later fixes: dropped `credit_notes.tenant_id`, reverted
> per-tenant reference numbering to the global sequence, and moved credit accrual from
> `parent_tenant_balances` back to the deprecated `parents.credit_balance` — **quietly
> reinstating the cross-tenant credit pooling PRD §5.6 exists to forbid.** A NOT NULL
> constraint caught it; nothing else would have. Before editing a long-lived function:
> `grep -ln "<name>" supabase/migrations/*.sql | tail -1` and start from THAT body.

### (c) What shipped, feature by feature

- **Child identity = name + date of birth** (PRD §5.1). Shipped as DOB, **not NRIC**:
  partial NRIC is still personal data under PDPC guidance, and DOB was already collected,
  so the same question is answered with no new regulated data. `students_identity_uniq` is
  an **expression index** — a raw index is defeated by a trailing space or a capital.
  NULL DOB never collides, which is what makes it safe on live data with no backfill.
- **`students.age` dropped**; age derived via `ageFromDob` in `lessonDates.ts` — **both
  apps, both test files** (the twin rule). Returns null, never 0.
- **Coach roster** shows each child's age, plus the **full birth date including the year**
  for any name shared on that roster. The year is the point and was found by driving the
  UI: the default date format omits it, so two same-named children born on the same
  day-of-month rendered identically.
- **Parent edit-child screen** — makes PRD §7.4's long-standing claim true. This is what
  §8.1 and §8.2 were prerequisites for.
- **Coach-defined levels** (PRD §7.15) — `tenant_levels` per business with explicit
  `sort_order`, admin-set, coach/parent read-only. `swimming_ability` dropped.
- **Address + postal code** (PRD §5.1) — optional at signup, editable at Profile →
  Contact Details. `postal_code` is **TEXT**; leading zeros are significant.

### (f) Level skills — added after the first deploy, and deployed cleanly

A level's label says where a child is and nothing about what they are working on. Each
rung now carries an **ordered list of skills** (`tenant_level_skills`) plus an optional
**note** on the level for things that are not skills — "Progress to B3 upon completing
T4", which an admin would otherwise have to enter as a fake skill.

**A table, not a text field**, and that was the one real design decision. A description
renders identically to a reader today, but the skills are a *list*: storing them as prose
makes them uncountable, unorderable, and impossible to ever tick off. Per-child progress
tracking is **deliberately not built** (it needs coach write access to students, which
they deliberately do not have) — but it is filed, and the rows-not-prose choice is
precisely what stops it needing a migration out of a text blob later.

Coach sees it on the roster **collapsed** — six children across three levels would
otherwise be thirty lines of skills. Parent sees it on the child profile, which is the
clearest answer the app has ever given to *"what is my child working towards?"*.

> **A comment I shipped this morning was a lie, and this fixes it.** `20260719001800` said
> the level-name uniqueness was *"trimmed + lowercased … a constraint that ' Level 1'
> defeats is not a constraint"* — and the code underneath it was a plain
> `UNIQUE (tenant_id, label)`. Verified against the deployed schema: `'Seahorse'` and
> `'  seahorse  '` both inserted. The comment described the intent and the code shipped the
> exact thing the comment warned about. Now an expression index, with a guard that refuses
> rather than silently dropping a row if any business already has colliding names. **A
> comment asserting a property is not a test of it** — the pgTAP case for this fails on the
> pre-fix schema.

**+11 pgTAP** (167 → 178). `verify-level-skills.mjs` drives it 14/14 using the real
curriculum text, including that a reorder **persists across a reload** rather than being
local state.

**Deployed** (migration `20260719002200`, then the push). Pure EXPAND, so migrate-first
applied and the failure mode from earlier today could not occur. Backup taken first; the
pre-flight probe confirmed production had **0** levels, so tightening the name constraint
could not collide with anything.

Verification note worth copying: the admin's `/levels` returned **200 both before and
after**, because that route already existed — a status code proved nothing. The page chunk
is lazy-loaded behind auth, so the check that actually worked was pulling the route's own
chunk out of the HTML and grepping it:

```bash
B=$(curl -sL https://admin.swimsync.sg/levels \
     | grep -oE '/_next/static/chunks/app/\(admin\)/levels/[^"]+\.js' | head -1)
curl -s "https://admin.swimsync.sg$B" | grep -c tenant_level_skills
```

### (d) Tests

**167 pgTAP** (128 → 167, +39 across five new files) — _mid-session; §8(f) then took it to the
current **178**_ — **68 Deno** (+1), frontend **64 jest**
(+8) and **57 vitest** (+8). Four new UI drivers: `verify-student-identity.mjs` (13),
`verify-edit-child.mjs` (7), `verify-levels.mjs` (9), `verify-parent-address.mjs` (6).

Every test written for a known bug was **run against the unfixed code first** (§7.25) —
dropping the pin trigger fails 4 of 6 pin tests, nulling the snapshot fails both rename
tests, removing the engine write fails the engine test, and the four age-boundary tests
fail against a naive year-subtraction. Deno suite run twice (§7.15).

### (e) Three things the UI drivers caught that nothing else did

1. **The roster mapped `level_label` but rendered nothing** — the enum it replaced was never
   rendered either, so swapping the field produced a value no screen displayed. Typechecked
   clean, pgTAP green.
2. **The birthday disambiguator omitted the year** (above).
3. **A "duplicate rejected" check passes on a form where everything fails.** The identity
   driver now carries a **positive control** — a legitimate save must succeed — after the
   first version of that assertion proved nothing. Same shape as §7.17.

Two Playwright gotchas are now in `run-ui-playwright/SKILL.md`: `getByText` matches
**substrings**, so `getByText("Edit")` also matches **"Credit Balance"**; and direct URL
navigation to a nested route redirects to the app root **even for routes that work**, so a
redirect is not evidence a route is missing.

## 8.4 Fourth session (2026-07-19) — ACTIVE / INACTIVE, all six phases, live

### The model, and the one decision everything follows from

Three concepts, three owners, **three different words** — because "inactive" already
meant two things and a third spelling would have made it worse:

| | Column | Owner |
|---|---|---|
| **active / inactive** | `parent_tenants.is_active`, `students.is_active` | the business's admin |
| **assigned / unassigned** | `students.assignment_status` | the business's admin |
| *(enabled / disabled)* | *`profiles.is_active`* | *platform — **not built**, see below* |

**Activity is PER BUSINESS**, on `parent_tenants`. This item predated multi-tenancy and
that is the part it did not know: parents are global, so a school marking a family
inactive must not switch them off at their private coach.

**The family flip is a CONSEQUENCE, not a second question.** Deactivating a child is a
choice (do the siblings go too?) — so the UI asks, naming them. A family with no active
children being inactive follows from that — so the UI *states* it. The user proposed this
shape and it is better than the plan's original "two independent prompts".

**It is deliberately NOT a trigger, and that must not be "tidied" later.** A trigger fires
after the write and cannot ask anything, so the sibling prompt would be a lie. Worse, a
trigger maintaining `no active children ⇔ family inactive` **breaks reactivation**: a
returning family has zero active children *by design*, and would be flipped straight back.
Propagation is one-way and event-shaped.

**Re-activation is the join code and needed no new UI.** An inactive family can still log
in — they are not *disabled* — so they re-enter the business's code. A returning parent
**cannot re-sign-up**: `profiles.email` is UNIQUE, so email-as-identity is already
guaranteed by the schema and there was nothing to deduplicate.

### Bugs found — two only visible in the running app

1. **Inactive children reappeared in the Unassigned queue.** They are `unassigned` now, so
   they looked exactly like new signups awaiting placement. Needed explicit `is_active`
   guards on the queue and the dashboard counts.
2. **`is_active` was read off the wrong table.** In the parent home query it sat inside
   `student_class_enrolments`, not `students`, so `s.is_active` was `undefined` and **every
   child would have rendered as "Inactive"**. It typechecked — the query is `any`. See §7.28.
3. **A departed family was still promised a class.** The chip correctly read *Inactive*
   while the banner beneath said *"the admin will assign your child soon."* Found by
   looking at the screenshot, not by any assertion.

### Deployed — app first, then the schema

Phase 6 **drops** an enum value, so the ordering inverted: the push to `main` went out and
Vercel served the new admin (`/parents` 404 → 200 while `/dashboard` held 200 — the
known-good/known-bad comparison of §7.23) **before** the three migrations ran. The
deployed build already handled the two-value enum *and* still tolerated the old value, so
there was never a window where a live build queried something that did not exist. Backups
taken first. `generate-invoices` untouched at **v11**.

### Not done (deliberate)

- **No login blocking.** Cut on purpose after the user pushed back: it is a **platform**
  power over an account, not a business decision about a customer, which is why it gets a
  different word (enabled/disabled). The one genuine parent trigger is a PDPA
  consent-withdrawal request — and the real near-term need is revoking a **staff** account.
  Filed as *Disable a staff account* in `BACKLOG.md`, with the reasoning.
- **No trigger enforcing family/child consistency** (see above). A family can therefore be
  active with zero active children — the Parents page **flags** that state rather than
  preventing it.
- **`profiles.is_active` still means nothing.** It exists, is enforced nowhere, and now has
  a documented future owner. Do not assume it gates anything.

### Tests

**+20 pgTAP** (108 → 128) in `active_inactive.test.sql`, on its own tenants. The one worth
keeping: *reactivating is not undone by the family having no active children* — the
property that fails the moment someone converts the consequence into an invariant.
`verify-active-inactive.mjs` drives all of it (**17/17**, re-run after the enum drop), plus
a parent-app check that a departed child reads *Inactive* and is promised nothing.

## 8.3 Third session (2026-07-19) — a lesson is priced and paid by ITS OWN DATE

**Three defects of one shape, two of them live in production: a fact about a PAST lesson
was resolved by a LIVE lookup instead of recorded as of the day it happened.** All fixed,
tested, merged (`ad0e430`) and **fully deployed** — 4 migrations + `generate-invoices` **v11**.

**None of this was planned.** The session set out to plan backlog item #1
(active/inactive). It came out of the user asking a single question — *"if we let the admin
change a class's coach, does that break the money?"* — which it did, twice.

### The three bugs

1. **Editing a class price silently repriced the previous month.** `core.ts` charged each
   invoice line at the class's **current** `price_per_lesson`, read at generation time. A
   rise on the 3rd repriced every unbilled lesson of the month before. Exposure ran from the
   lesson to the invoice run — **up to five weeks** at run day 7. Invisible: the invoice
   looked internally consistent, and once created a lesson can never be re-billed (§11.6).
2. **Handing a class to another coach moved its entire unpaid history.** `session_pay_amount()`
   and the payout loop resolved the coach through `classes.coach_id`, also live. The outgoing
   coach's draft fell to **$0** and the incoming coach was paid, at their own rate, for
   lessons they never taught. On the frozen path it was worse: the outgoing coach's
   adjustment was computed from the *new* coach's rate.
3. **A payout adjustment was re-emitted forever.** Found while testing (2). The engine
   re-compared "owed now" vs "paid then" on every later run, so one **-$45** correction
   appeared on 2026-04, 2026-12 *and* 2027-01 — and would have recurred every month.
   `ON CONFLICT DO NOTHING` dedupes only *within* one payout.

### The fix

`class_rates` carries a class's commercial terms effective-dated — price **and** which coach
is paid — resolved by `class_rate_on(class, date)`. **One table, not two:** one lookup and
one way to miss, rather than two. `set_class_terms()` makes it reachable from the admin with
the **correct-vs-change** choice the RPC cannot infer (PRD §7.3).

For (3), the cure is a **running total**: `owed_now − paid_originally − already_carried`.
Emitting once and then suppressing forever would have been *wrong* — a lesson can legitimately
be corrected twice, and suppression swallows the second. There is a test for exactly that.

### Deployed, in the right order — after I got it wrong first

Additive, so **migrations lead, then the Edge Function, then Vercel**. I pushed to `main`
before migrating, so Vercel shipped an admin calling `set_class_terms` **before the RPC
existed** — class editing was broken in production for a few minutes. The plan said to
migrate first; I ran the steps out of order. Backups (schema + data) were taken first.

### Not done (deliberate)

- **`classes.coach_id` was NOT moved into `class_rates`, and must not be.** It is
  load-bearing for **RLS** — `coach_owns_class()`, `coach_owns_session()`,
  `coach_serves_student()`, `coach_serves_parent()` all resolve access through it
  (`20260309000600_rls_policies.sql:50-81`). Moving it would rewrite the largest permission
  surface in the codebase to fix a billing bug. **Access follows the current coach; money
  follows history.** Zero policies were touched. Consequence, stated so it is never a
  surprise: a coach who hands over a class loses access to its past lessons (already true
  before this change) while still being paid for them.
- **Snapshot-at-marking was rejected in favour of effective-dating.** Writing `taught_by` /
  `price` onto `lesson_sessions` when attendance is saved is cheaper, but wrong whenever a
  lesson is marked **late** — and this app deliberately supports back-marking a month. The
  user's question ("when exactly is the rate locked in?") is what exposed it. Effective
  dating has no such window: the answer is the lesson's own date, full stop.
- **No future-dating of terms.** The display sync tracks the rate in force *today* and
  nothing re-runs when a future date merely arrives, so a future row would show a wrong
  price until something touched the class. `set_class_terms()` refuses it. **Relax that and
  the sync together, never alone.**
- **Substitute coaches are not modelled** — see `BACKLOG.md` → *Deliberately not doing*.
- **Backlog item #1 (active/inactive) was designed in full and NOT built.** The whole
  six-phase design is written into its `BACKLOG.md` entry. Start at Phase 1.

### Tests

**+26** (82→108 pgTAP, 64→67 Deno). Every new billing/wages test was confirmed to **fail on
the pre-fix code** — and one of them initially *passed*, see §7.25. New:
`supabase/tests/class_terms.test.sql` (14) on its **own tenant**, because the wages fixture
marks a December payout paid and the settled-money guard correctly refused; moving the test
beat weakening a real guard. New driver `verify-class-terms.mjs` (10/10) covers the
correct-vs-change prompt, which exists only in the UI.

## 8.1 First session (2026-07-19) — MULTI-TENANCY, phases 0–5, live in production

**SwimSync is now a multi-tenant platform.** Six phases, designed and built in one
session, all deployed. `TENANCY_DESIGN.md` is the design (10 decisions, §10) and
`TENANCY_PLAN.md` the plan — **read those two before changing anything here**; this
section is the session log, not the spec.

**The reframe that made it small.** A **private coach is a school of one** — a tenant
whose single coach is also its admin. "Private" and "school" are the same object at
different sizes, so **coach type never became an authorization concept** and no rule
branches on it. `BACKLOG.md` had warned this cluster was the biggest re-work trap and
that every money feature would be built twice; that risk was avoided by reframing, not
by building carefully. Wages (phase 5) needed no private-vs-school check at all.

**Where the boundary falls** — the decision everything else follows from:
- **Parents are GLOBAL** (no `tenant_id`). A family with one child at a school and
  another with a private coach is the *common* case, per the user; tenanting the parent
  breaks it permanently.
- **Students are TENANTED**, via a real column, not derived from enrolment — an
  unassigned child has no enrolment yet but must still appear in exactly one admin's
  queue, and "Remove from class" keeps a child in the business while removing them from
  the class.

**The money model was the real work, not the RLS rewrite.** Invoices became unique per
`(parent, tenant, month)`; credit moved to `parent_tenant_balances` and **never crosses
businesses**; sealing, the completeness block, the auto switch and the run day all became
per-tenant. **The engine runs as `service_role` and bypasses RLS entirely**, so tenant
isolation in billing is enforced in engine code — none of the policy work protects it.

**Built as EXPAND / CONTRACT, and the ordering was load-bearing in both directions.**
Phase 1 kept `parents.credit_balance` and `coaches.paynow_qr_url` (dual-written) because
the live apps still read them; phase 4 moved the readers and dropped them. Constraints
followed their writers, not the design doc — and the one that mattered most:
**dropping `UNIQUE (parent_id, billing_month)` before the engine wrote a tenant would
have permitted double billing**, because two NULL-tenant invoices for one parent-month do
not conflict in a UNIQUE index.

### What each phase delivered

| Phase | Delivered |
|---|---|
| **0** | Extracted the completeness rule (`lib/attendanceCompleteness.ts`) + Deno suite runs twice in CI |
| **1** | `tenants`/`parent_tenants`/`parent_tenant_balances`, backfill, the 37-policy RLS rewrite, three leaks closed |
| **2** | Tenant-scoped billing engine, per-tenant sealing/blocking/settings, per-tenant credit-note numbering |
| **3** | Join codes (RPC + mobile UI), add-child tenant gate, platform-admin page with the student rescue tool |
| **4** | Tenant branding on invoices + emails, PayNow from the business, parent billing grouped by tenant, **contract migration** |
| **5** | Coach wages: effective-dated rates, the pay-decision table, draft→frozen payouts with adjustments |

### Bugs found — almost all by tests or by driving the UI, not by review

1. **The engine's completeness gate could not see a lesson nobody touched** (phase 0,
   §7.18). It inspected only `lesson_sessions` rows that *exist*, but those are created
   lazily — so a month with a forgotten lesson reported **"complete — billing month
   sealed"**. A single forgotten lesson was a permanent, silent underbill. **This was
   live in production.**
2. **RLS was never ENABLED on the three new tables** — policies written, inert, so every
   **join code was world-readable**, defeating the entire reason codes exist.
3. **Mutual policy recursion** (`classes` ↔ `enrolments`). It could not happen before
   *because* `classes_select` was `USING (TRUE)` — the leak was also what kept the graph
   acyclic.
4. **The credit-note trigger wrote a dropped column** and inserted rows with no tenant;
   **`close_student_enrolment()` called the dropped `is_superadmin()`** — a function body
   is not a tracked dependency, so it would have failed at *runtime*, not migration time.
5. **A private coach could not log in** (§7.19) — the backfill correctly made them
   `tenant_admin`, but routing still tested `role === "coach"`. **Live regression, hit by
   the real coach.**
6. **A blank wage rate saved as $0** — `Number("")` is 0, finite and ≥ 0. A $0 rate is
   worse than none: the coach reads as "on payroll" and earns nothing.
7. **The Deno suite leaked tenants** through a silent FK chain. Now fatal, not ignored —
   the cron path loops *every* tenant, so a leaked fixture is a row a real run processes.

### Deployed, in the right order each time

Phases 0–4 and 5 are **all live**. The two deploys had **opposite** orderings, and both
matter: phase 4 **dropped** columns so the app had to deploy *first*; phase 5 only
**added**, so migrations went first or the new page would query missing tables.
`generate-invoices` is at **v10**. Backups taken before every production migration
(scratchpad, deliberately not committed).

**Not done (deliberate):**
- **No "view as tenant" impersonation**, no platform billing, no multiple admins per
  tenant, no cross-tenant students, no per-tenant timezone, no non-calendar wage cycle.
  All recorded with reasoning in `BACKLOG.md` → *Deliberately not doing*.
- **July 2026 still unbilled.** The plan's definition of done requires it, and it cannot
  be met: **production has zero attendance records**. See §9.
- **`HANDOVER.md` §9 was left stale for most of the session** and is rewritten below —
  it claimed "phase 2 is next" long after phase 5 shipped.

## 8.2 Second session (2026-07-19) — the SwimSync logo

**The placeholder "S" tile is gone; both apps now carry a real mark — a poolside pace
clock.** Picked over two other finalists because it reads as *recurring time*, which is
what this product is: a weekly class, a monthly billing month, a run day. **This is on an
unmerged branch — see Status below. Nothing has deployed.**

- **`brand/` is the source of truth** — `mark.svg` plus white/ink recolours, an app-icon
  tile, and an Android adaptive foreground. Every PNG under `SwimSyncApp/assets/` and
  `SwimSyncAdmin/public/` is rasterised from those. `brand/README.md` carries the geometry,
  the regeneration table, and the two places the mark is deliberately absent.
- **Two `Logo` components, one per app idiom** (§6 for why they differ).
- **Nine call sites**: 5 Expo screens (welcome + the 4 auth screens), 3 admin auth pages,
  and the **Sidebar — which covers all 10 admin pages in one edit**. An `md` size was added
  to match the `w-14` tiles some screens already used, so **no layout shifted**.

**A latent bug found on the way in: `app.json` referenced four asset files that did not
exist.** `icon.png`, `splash.png`, `adaptive-icon.png` and `favicon.png` were all named in
the Expo config while `SwimSyncApp/assets/` was **missing entirely** — the app had no icon,
no splash and no favicon, and never had. This is why `run-ui-playwright`'s SKILL.md tells
you to expect a favicon `readFileSync` error on startup; that error is now gone.

**Not done (deliberate):**
- **The mark is NOT in the invoice email, and must not be added.** That header carries the
  **tenant's** logo and business name — a parent pays their coach or school, and an email
  headed "SwimSync" reads as a platform bill (PRD §7.10; `email.ts` says so in a comment at
  the point of use). SwimSync appears in the footer only.
- **The recovery email keeps its plain text wordmark.** SVG does not render in most mail
  clients, and a hosted PNG adds a broken-image and blocked-image failure mode to the one
  message a locked-out user actually needs.
- **No `react-native-svg`.** Adding a native module to an app that has not yet cut a native
  build is a risk branding does not justify; PNG + `tintColor` has no native surface. If
  that dependency ever arrives for another reason, switching the component is contained.
- **No brand-collision check** against existing swim-school or fitness marks — that is a
  search job, not a drawing job. Filed in `BACKLOG.md` → Platform and reach.

**Verified.** Both apps typecheck clean and **105 tests pass** (49 admin + 56 app; this
session added no tests). The marks were rendered in the **running** UIs rather than
asserted — admin login and the Sidebar under `next dev`, and login / register / welcome /
forgot-password under Expo web — and the generated icons were inspected at true pixel
sizes (the iOS app icon correctly carries **no alpha**; the Android adaptive foreground
correctly does).

**Status — MERGED to `main` and pushed.** The logo is `18d486d` and this doc update
`06aff62`; both sit on `origin/main`, and the
`worktree-logo-generation-and-replacement` branch has been deleted local and remote. It
had first been rebased onto `e81109c` with **zero conflicts** even though the other
2026-07-19 session touched the same two files (`Sidebar.tsx`, `(auth)/login.tsx`); both
sides were checked to have survived rather than trusted. **Vercel builds both web apps
from `main`, so the push deployed the mark to production** — no migration or Edge
Function was involved, so there was nothing else to deploy.

---

## 8a. What changed (2026-07-18 — the underbilling cluster: multi-class fix, run day, sealing, hard block, + the §8a.1 empty-month seal fix)

**Four changes that together close underbilling from both ends — A fixes billing that was
*wrong*, D prevents billing that is *incomplete*.** All merged to `main` (`b3bb2c5` →
`6014095`, fast-forward, no PR), CI green, **and fully deployed**: `supabase db push`
(4 migrations) + `supabase functions deploy generate-invoices` + Vercel from the push.

**A — a multi-class parent was billed for only ONE class** (`b3bb2c5`). `core.ts` created
invoices *inside* the per-class loop, so a parent's invoice was created during the first
class their children appeared in, and the "already has an invoice" guard then skipped them
for the second — silently dropping those lessons. Contradicted PRD §5.5 and, unlike a
forgotten lesson, was invisible to the gap report. Restructured into **two phases**: the
class loop only *tallies* into a cross-class map; invoice creation runs **once per parent**
afterwards. Auto mode also **defers** a parent whose child sits in an incomplete class
rather than writing a partial invoice tomorrow's retry could never top up.

**B — the automatic run day is configurable, default the 7th** (`7135e38`). Billing on the
1st is too early: the month's last lesson may be unmarked, and a lesson marked *after* the
invoice exists can never join it. **Key finding: "the 1st" was never a cron setting** —
`cron_schedule.sql` runs *daily* and the engine decided the month. So this is an engine-side
guard needing no pg_cron change, which also makes it admin-editable and testable.

**C — a month is sealed as soon as it is genuinely finished** (`867d228`), by *any* run,
not just an automatic one. Prerequisite that had to land with it: completeness is now
**measured always and enforced only when not forced** — `classesIncomplete` used to be
incremented inside the `!force` branch, so a forced run always reported 0 and the engine
could not tell whether the month it billed was actually complete. Sealing on that would
have been strictly worse than not sealing.

**D — generation is BLOCKED until attendance is complete, in every mode, no override**
(`6014095`). The gap check previously only warned, and the admin route **hardcoded
`force: true`** (the long-standing §7.8 gotcha), so the gate never fired on the only path
that runs. Blocking beats warning because a lesson that genuinely did not run is recorded
as `cancelled_rain`/`cancelled_coach`, which satisfies the check — so the bypass was never
covering a legitimate case, it was letting an unrecorded lesson through into a permanent
underbill. All-or-nothing, because invoicing the complete classes would strand the rest
behind the same guard. A blocked *automatic* run emails the coach + superadmin, throttled
by a fingerprint of the outstanding set so a daily cron cannot send a daily nag.

**D's prerequisite — closing an enrolment, for coach as well as admin.** Without it the
no-override design is unsafe: the gate reads **active enrolments** and never consults
`students.is_active`, so a child who left with an open enrolment keeps their class
permanently incomplete and would block **all** billing with dashboard SQL as the only
remedy. Shipped **"Remove from class"** (→ unassigned) and **"Set inactive"** on the admin
Students page and the coach roster, via `close_student_enrolment()` — see §6 for why an
RPC rather than an RLS policy.

**The trap inside that prerequisite (found before shipping, not after).** `core.ts` derived
its billable set from *active enrolments*, so closing one **silently dropped that child's
already-attended lessons** from the invoice — one tap of the new button would have cost a
month's revenue for them. Active enrolments now drive **only** the completeness gate;
billing follows the **attendance rows that exist**. Pinned by two tests.

**Three bugs found in this session's own work, all by verification rather than review:**
- `parents_deferred` was counted inside the phase-2 loop, which only visits parents *with*
  billable items — so when every class was incomplete it reported **0 while the whole month
  was blocked**, silence for the loudest case. Found by the live run, not the unit tests.
- `clampRunDay(null)` returned **day 1**: `Number(null)` is `0`, which clamped *upward*,
  turning "unset" into "bill on the 1st" — precisely what B exists to prevent.
- Manual runs began sealing months, so every completing test left a `billing_periods` row
  and the **second** run of the suite short-circuited on `already_complete`. Fixed in
  `teardown()`, which now clears the months its sessions fall in.

**Verified.** Deno **29 → 49** (all five new Part-A tests fail on the pre-fix engine — test
(a) reports gross 30 instead of 50); pgTAP 34; admin 38; app 38; both apps typecheck. Every
part also driven **live through the Edge Function** against real DB state, and the RLS
boundary tested directly in psql. Docs: PRD §7.4/§7.7, `INVOICE_RUNBOOK.md`.

**Not done (deliberate):**
- **No tenanting, no coach type.** The user asked whether the run-day setting should be
  per-tenant/per-coach; the call was **one global setting**, mirroring the `APP_TIMEZONE`
  seam decision (§8a). Tenanting is an L that rewrites nearly every RLS policy, has an
  unsettled design question (where a family that moves between coaches belongs), and has
  **zero users** — one coach, one admin, the same person. Promoting one integer to a
  per-tenant column later is trivial next to that rewrite.
- **No settle-up invoice when a child is set inactive.** Considered and rejected: invoices
  are `UNIQUE(parent_id, billing_month)`, so an early partial-month invoice would make the
  regular run skip that parent and strand their siblings' lessons — the *same* bug A just
  fixed. The normal cycle bills them, which the enrolment-decoupling above makes correct.
- **No override on the block**, at the user's explicit call. The escape hatches are marking
  the lesson cancelled, or removing the student — both verified live.
- **`is_active` vs `assignment_status` still not reconciled.** This session *writes* the
  enum but did not settle the two-sources-of-truth question; that stays the M-sized backlog
  item, now overdue.

### 8a.1 Follow-up, same day — a month with NOTHING to bill was sealing itself (`0363757`)

**Found in production, not in review.** Generating July 2026 on prod to check on it reported
*"Created 0 invoice(s) … now closed"* and **sealed the month** — after which every later run
short-circuits on `already_complete`. C (above) had just made *manual* runs seal, so the
lightest possible action — looking — permanently locked a month out of billing.

**The mechanism is worth remembering: the three seal conditions were all _vacuously_ true.**
"No class left incomplete", "no parent deferred", "no write failed" are each trivially
satisfied when the run found nothing at all, so **"nothing happened" was indistinguishable
from "everything is finished"**. Sealing now additionally requires that **at least one class
was genuinely reckoned with** (had lessons and students, and passed the completeness gate).

**Not just an empty-database case** — this is the part that made it a live hazard. Because
`lesson_sessions` rows are created **lazily** by attendance marking (§6), *any* month whose
attendance nobody has marked yet has no sessions, real classes and students included. Any
early "let me just check" run would have sealed the month.

A month that is fully marked but yields **no billable lesson** (e.g. every lesson rained off)
is genuinely finished and **still seals** — the distinction is "nothing recorded" vs "nothing
billable".

- **New `nothing_to_bill` status** returned by the engine, with a `message`; the admin
  invoices page renders it as *"No lessons are recorded … the month is still open — generate
  again once attendance has been marked"* instead of the old success-shaped copy.
- **Deployed** — `supabase functions deploy generate-invoices` ran ~1 min after the commit
  (version 7, 2026-07-18 19:45 SGT). Verified via `supabase functions list`, not assumed.
- **Verified.** Deno **49 → 51**; the empty-month test fails on the pre-fix engine.
- Also corrected two PRD claims that had drifted from shipped behaviour: invoice **timing**
  (still said the 1st; the run day has been configurable, default the 7th, since §8B) and the
  **manual-mode** description (manual is subject to the completeness gate and *does* seal a
  finished month — both changed when the hard block landed).

**✅ Resolved 2026-07-18 — July has been unsealed on production by the user.** The fix
prevented *future* vacuous seals but did not remove the `billing_periods` row the incident
already wrote; that row is now gone, so July is billable again. (Reopen path, if ever needed
again, is in `INVOICE_RUNBOOK.md`.) **Note the July run itself is now deferred behind
tenanting** — see §9.

## 8b. What changed (2026-07-17 — UTC-derived default billing month fix)

**Fixed a latent billing bug: the invoice engine's default billing month was derived in
UTC, so the daily cron would bill a month early.** Shipped to `main` (`745b3ea`,
fast-forward, no PR) **and deployed to production** (`supabase functions deploy
generate-invoices`). **No schema change; no user-facing behaviour change today** — the fix
only affects the auto/cron default path, which isn't running yet.

- **The bug (§7.12):** `core.ts` computed the previous month from `new Date().getMonth()`.
  Edge Functions run in **UTC**, so at the documented 1am SGT cron run (17:00 UTC the day
  before) the month was a day behind — 1 Aug would bill **June**, not July. The cron POSTs
  an empty body, so it relied on exactly this default. Latent only because invoicing is
  **manual** (the admin route always sends an explicit `billing_month`) and cron is off on
  the free tier. Same UTC-vs-SGT class as the shipped double-billing bug (§7.7).
- **The fix — a timezone seam, not a hardcode.** New pure helper
  **`generate-invoices/dates.ts`**: `previousBillingMonth(now, timeZone)` resolves the
  calendar date via `Intl.DateTimeFormat` (mirroring `todayInSg`, DST-safe) and takes the
  month *before* it. Timezone is `APP_TIMEZONE` (env-overridable, **default
  `Asia/Singapore`**). `core.ts` now calls `previousBillingMonth()` instead of `new Date()`
  fields. Duplicated Deno-side rather than importing the app twin (Deno, no npm resolution —
  same rationale as the completeness rule, §6).
- **Why a seam and not per-tenant** (the user's explicit call): multi-timezone is a
  "don't-paint-into-a-corner" concern, **not near-term**. One configured zone is enough
  while all usage is SGT; a future deployment re-homes by setting `APP_TIMEZONE`, and true
  per-tenant timezone folds into the tenanting work (BACKLOG) when it lands. Frontend
  `lessonDates.ts` stays SG-hardcoded — making the whole app multi-TZ is a tenanting-era
  project, deliberately out of scope.
- **Verified.** `deno check` clean; full Deno suite **24 → 29** (5 new `dates.test.ts`,
  incl. the boundary regression that fails on the pre-fix path); and the **live empty-body
  auto call** on the local stack returned the SGT-correct default month. Manual generation
  is untouched (always explicit month). Docs: `INVOICE_RUNBOOK.md`'s "cron bills UTC month"
  warning retired; `index.ts` + `cron_schedule.sql` comments updated.

**Live in production:** the Edge Function was **redeployed** with the fix (a git push does
**not** deploy functions — Vercel only builds the web apps). `APP_TIMEZONE` is intentionally
**unset** in prod, so it defaults to `Asia/Singapore`. The next time cron is enabled it will
bill the correct month.

**Not done (deliberate):**
- **No per-tenant timezone, no frontend multi-TZ** — see "Why a seam" above.
- **No save-time DB guard on `billing_month`** — out of scope; unrelated to this default-path
  fix. (The separate attendance-window save guard is still in BACKLOG → Foundations.)
- **Didn't touch the related multi-class-parent under-billing bug** (BACKLOG → Billing) —
  separate defect, still open and worth fixing before 1 Aug. _(Fixed 2026-07-18 — §8a.)_

## 8c. What changed (2026-07-17 — attendance marking window + clearer empty states)

**Bounded how far back a coach can mark attendance, and made the parent's empty states
truthful.** Shipped to `main` (`16d3db3`, fast-forward, no PR). **No schema or billing
change** — reuses the read-time lesson-date logic (`lib/lessonDates.ts`).

- **The bug (found via the user's controlled test):** the coach roster's "Mark Attendance —
  Today" button was **day-agnostic** — on a non-lesson day it let a coach create (and bill) a
  session on a day the class doesn't run. The *surfacing* (Unmarked Lessons / Past Sessions)
  was already correctly windowed; only the button + the attendance screen weren't.
- **Coach roster (`(coach)/classes/[id]/roster.tsx`):**
  - The primary button now targets the **most recent expected lesson within the window** (today
    if today is a class day, else the last class day that passed) via `expectedLessonDates` +
    `backlogWindowStart` — no more marking a phantom non-lesson day.
  - Adds a **"how far back" note**: *"You can mark lessons back to &lt;date&gt;. Earlier lessons
    are closed — a correction to an already-invoiced lesson uses a credit note instead."*
  - Shows a **"No lessons to mark yet" placeholder** when nothing has fallen due (brand-new
    class), instead of an unusable button.
- **Parent attendance (`(parent)/attendance/index.tsx`):** splits the empty-history state using
  the class weekday + join date. A lesson that has **fallen due but is unrecorded** still reads
  *"No lessons marked yet"* (coach's court); a **just-joined child with nothing due yet** now
  reads *"No lessons have taken place yet"* — the old copy wrongly implied the coach was behind
  in both cases.
- **The window rule (unchanged, now enforced not just surfaced):** floor is
  `max(start of last month, earliest enrolment)` — mark back to there but no further, because
  older lessons sit behind a generated invoice and need a credit note, not a late mark.
- **Verified.** Typecheck + jest (38) clean, and a **new hand-run driver
  `verify-attendance-window.mjs`** (+ `fixtures-attendance-window.sql`) drives all four states
  across coach + parent — **5/5**, screenshots eyeballed. See §5.

**Not done (deliberate):**
- **No save-time hard guard on the attendance screen.** The *entry points* (button, Unmarked
  Lessons, Past Sessions) are now all windowed, but `attendance.tsx` still writes whatever
  `date` it's handed — a hand-typed URL could still write out-of-window/off-weekday. A
  defense-in-depth guard is worth adding but wasn't needed for the UX fix; left as a follow-up.
- **Window floor is still a calendar proxy** (start of last month), not "earliest un-invoiced
  month" — a lesson marked right after a month is invoiced is still in-window but wouldn't bill.
  Filed in BACKLOG → Billing.

## 8d. What changed this session (2026-07-16 — invoice email notifications)

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

**LIVE in production as of 2026-07-16** — both cloud actions are done: the function was
deployed (`supabase functions deploy generate-invoices`) and the `RESEND_API_KEY` secret
set. So the **next real invoice generation (the 1 Aug run) will email each parent.** No live
send has been exercised on prod yet (it fires on the first real generation). **Note for any
future function change:** the Edge Function is deployed by `supabase functions deploy`, NOT
by a git push (Vercel only builds the two web apps) — a merged-but-not-deployed change won't
be live.

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

## 8e. What changed this session (2026-07-16 — typecheck baseline + CI guard)

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

## 8f. What changed this session (2026-07-16 — bulk attendance + admin class management + backlog ranking)

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

## 8g. What changed this session (2026-07-16 — backlog)

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
but a concurrent merge to `main` (§8g) moved `HEAD` between the branch checkout and the
commit, so the commit landed on `main` and the branch was left an empty pointer at
`8c1d5ad`. Deleted it. No harm done — the change was docs-only — but note `3e1270c`
**has no CI run of its own**: it was pushed between two other commits and the green run
is on `b89ca52`, which contains it. **Two sessions in one repo means `git status` before
`git commit`, not after.**

---

## 8h. What changed this session (2026-07-16)

**Fixed the parent Attendance screen — and shipped everything on this branch to
production.**

- **Merged to `main` and pushed: `2f746ca` → `8c1d5ad` (4 commits). CI green** across
  backend + both frontends. Vercel builds `swimsync.sg` / `admin.swimsync.sg` from
  `main`, so the unmarked-lessons work (§8i), the docs split (§8h), and the fixes below
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
  departing from it. Nothing to correct. (§8h reached the same conclusion independently
  before the work landed.)
- **`BACKLOG.md` left alone** — it was being written by a **concurrent session** while
  this one ran, and has since landed on its own as `3e1270c` (six items: coach wage
  tracking, address/postal at signup, NRIC-last-4 identification, tenanted admin
  accounts, coach type private-vs-school, active/inactive status). Not this session's to
  commit. Nothing shipped here was a backlog item, so no pruning was owed either.
  **Two sessions ran against this repo today** — check `git log` before assuming an
  uncommitted file is yours.
- **§5 test counts were stale and are now corrected** (app 29→**32**, admin 35→**38**).
  They were wrong by my own hand in §8i: three `formatSgDate`/`dayOfWeekOf` tests were
  added to each app *after* the counts were written. Verified by running both suites.

## 8i. What changed (2026-07-16 — docs split)

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
  - _Update: that work **landed** later the same day as `8c1d5ad` — see §8f. The PRD call
    above held._

## 8j. What changed (2026-07-15)

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
    genuinely didn't run is a legitimate reason to proceed. _(Reversed 2026-07-18: it now
    blocks, with no override — see §8a and PRD §7.7.)_
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

## 8k. What changed (2026-07-13 → 07-14)

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

## 8l. Session (2026-07-12)

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

## 8m. Session (2026-07-11)

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
> will drift.

### FIRST: the packages feature is built and verified but NOT deployed (§8.8)

Branch `feat/lesson-packages` is complete and green locally; nothing has touched
production. The deploy is pure EXPAND, so the order is (§6 / §7.27 / §7.30):

1. **Backup** the production DB (scratchpad, not committed).
2. `supabase migration list` — the pending set must be EXACTLY
   `20260720000100` + `20260720000200` (§7.30: db push applies everything pending).
3. `supabase db push`, then `supabase migration list` again — nothing pending.
4. `supabase functions deploy generate-invoices` (engine v13 → v14) **and**
   `supabase functions deploy package-emails` (a NEW function — a plain deploy of the
   old one does not create it). Verify both via `supabase functions list`.
5. `git checkout main && git merge feat/lesson-packages` → push → both Vercel sites
   rebuild. Delete the branch (local + remote).
6. Smoke on production as the real coach: /packages renders empty (no products yet),
   /students filter present, app Billing shows the Packages tab with the
   "doesn't offer packages yet" state.

Until step 5, production parents see no change at all; steps 3–4 are invisible to the
running apps (additive schema, and the engine change only activates when a package
exists). There is no partial-deploy hazard beyond the standing rule: never push the web
apps before the migrations.

### Then: everything from 2026-07-19 remains done

All seven prior sessions' work is merged, deployed and **confirmed on production by the
user**: the billing-month guard refuses July, the platform admin has their own panel, and
the real coach — the §7.19 account — still has all eleven (now twelve) pages.

### The one thing blocking everything else — and it has been urgent for four sessions

**No attendance has ever been marked in production.** Zero `lesson_sessions`, zero
`attendance` rows. Invoicing, credit, the completeness gate, sealing, wages, effective-dated
pricing, active/inactive, and now child identity and levels are all tested against fixtures
and driven through the real UI — and **none of it has processed a single real lesson.**

**Seven** sessions of building have now stacked on top of that, which is itself the argument:
each one adds surface that a first real lesson would exercise for the first time. The newest
addition is the sharpest illustration — the Platform page's *last attendance* column reads
**never**, in red, which is the first time any screen has said out loud what has been true
since launch.

Two things now depend on that not staying true much longer:

- The **`class_rates` backfill** (§8.3) is *correct by emptiness*. Floor-dating every class's
  terms is vacuously right while there is no attendance for it to be wrong about.
- The **completeness gate** has never refused a real month, and the block-notification email
  has never fired in production.

1. **Get the coach marking attendance.** An onboarding push, not a build task, and the gate
   on everything below.
2. **Then bill a real month**, following `INVOICE_RUNBOOK.md`. Expect the gate to refuse
   until every lesson is marked — working as designed; mark them (or mark them cancelled),
   never override.
3. **Then onboard the school as tenant 2.** Cross-tenant isolation is proven in pgTAP across
   two tenants and driven through both UIs, but **production has only ever had one tenant**.
   Inherent until the school arrives — and that is when it matters most.

### If you would rather build than onboard

**`BACKLOG.md` → `## Build order` is now EMPTY** — all three near-term items shipped this
session. Pick from the themed sections below it, or from the clusters. The nearest
candidates with no dependencies: **credit-note emails** (the other half of the notification
work), **coach-created student profiles** (unblocked by tenancy, and the friction the
onboarding push is feeling right now), or **an upcoming-lessons view for parents** (small,
and the building block already exists).

### Small, concrete, and outstanding

- **The join code is `SWIM-RVM9`.** The *only* route in — no directory, so a parent without
  it cannot add a child at all. It is also now the **re-entry** route for a family that was
  marked inactive (§8).
- **`auto_invoice_enabled` is `false`** on the tenant. Automatic generation will not run
  until it is turned on.
- **Set a coach rate** if you want payroll to compute anything (Admin → Coach Wages). A
  coach with no rate is deliberately not on payroll.

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

## 10. File map

| Path | What |
|------|------|
| `TENANCY_DESIGN.md` | **The multi-tenancy design of record.** 10 settled decisions (§10). Read before changing anything tenant-shaped |
| `TENANCY_PLAN.md` | The 6-phase build, its risks, and the definition of done |
| `supabase/migrations/20260718000400…20260719000600` | The tenancy migrations: roles, tenants, backfill, RLS rewrite, billing constraints, join codes, wages, contract |
| `supabase/tests/tenant_isolation.test.sql` | Cross-tenant isolation — two full tenants proving they cannot see each other |
| `supabase/tests/coach_wages.test.sql` | The pay-decision table, pro-rata, effective dating, draft→freeze, adjustments |
| `SwimSyncApp/lib/landing.ts` | Where a signed-in user lands. Routes on **extension rows**, not the role enum (§7.19) |
| `SwimSyncApp/lib/attendanceCompleteness.ts` | The completeness rule, shared. **Twin in SwimSyncAdmin; a third copy in the Deno engine — three edits** |
| `SwimSyncAdmin/app/(admin)/wages/page.tsx` | Coach payroll: rates, policy, run, mark paid |
| `SwimSyncAdmin/app/(admin)/platform/page.tsx` | Platform admin: every business + the student rescue tool |
| `supabase/migrations/` | Schema, RLS, triggers, grants (ordered, source of truth) |
| `…/20260309000500_credit_note_trigger.sql` | Auto-issues a credit note on billable→non-billable edit of an invoiced lesson |
| `…/20260711000100_credit_applications.sql` | Credit-note allocation ledger (fixes partial-application drift) |
| `supabase/functions/generate-invoices/core.ts` | Billing engine logic (exported, tested) |
| `supabase/functions/generate-invoices/index.ts` | Thin HTTP handler (auth + client + call core) |
| `supabase/functions/generate-invoices/email.ts` | Invoice-email builders + Resend sender + `emailCreatedInvoices()` orchestration (§8c) |
| `supabase/migrations/20260718000200_coach_close_enrolment.sql` | `close_student_enrolment()` RPC — remove-from-class / set-inactive for the tenant admin **and** the owning coach (§6, §8a) |
| `supabase/migrations/20260718000100_…invoice_run_day` · `…000300_…invoice_block_notice` | `app_settings` seeds: automatic run day (default 7) + blocked-alert throttle state |
| `SwimSyncAdmin/lib/studentStatus.ts` · `SwimSyncApp/lib/studentStatus.ts` | **Byte-identical twins** — `removeFromClass` / `setStudentInactive` over the RPC. Edit both (§6) |
| `supabase/migrations/20260719001200_active_inactive_rpcs.sql` | `set_students_active()` (sole writer), `set_parent_tenant_active()`, `family_active_children()` (the read behind the prompt), join-code reactivation |
| `supabase/migrations/20260719001300_drop_inactive_assignment_status.sql` | Enum contract, with the `pg_proc` guard that refuses if a function body still casts to the retired value (§7.21) |
| `SwimSyncAdmin/app/(admin)/parents/page.tsx` | Families at this business — there was no Parents page before |
| `supabase/tests/active_inactive.test.sql` | Family consequence both ways, the one-way property, the tenant boundary |
| `supabase/functions/generate-invoices/rates.ts` | `rateOn()` — the terms in force on a lesson's date. Pure + unit-tested, like `dates.ts`. Dates compared as **YYYY-MM-DD strings**, never parsed to `Date` (keeps the timezone traps of §7.7/§7.12 out). A missing rate **throws** (§6) |
| `supabase/migrations/20260719000700_class_rates.sql` | Effective-dated price + paid coach, `class_rate_on()`, floor-dated backfill + seed trigger, display sync, RLS |
| `supabase/migrations/20260719001000_set_class_terms.sql` | The only sanctioned class edit: both tables in one transaction, correct-vs-change, settled-money guards |
| `supabase/tests/class_terms.test.sql` | correct-vs-change, rename-records-nothing, future-dating, cross-tenant coach, sealed-month refusal |
| `supabase/functions/generate-invoices/dates.ts` | Timezone seam: `APP_TIMEZONE` + `previousBillingMonth()` (SGT-correct default month, §8a) + `dayOfMonthInTimeZone`/`clampRunDay` for the run day (§8a) |
| `supabase/functions/generate-invoices/core.test.ts` · `email.test.ts` · `dates.test.ts` · `test.sh` | Deno integration + email + billing-month tests + runner |
| `supabase/tests/*.test.sql` | pgTAP DB tests (trigger, RLS, constraints) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/`, each tab folder has a nested `_layout.tsx` |
| `…/(auth)/forgot-password.tsx` · `reset-password.tsx` | Password-reset flow (request link + set new password) |
| `SwimSyncApp/app/_layout.tsx` | Root: session restore + `PASSWORD_RECOVERY` routing + native recovery deep-link handler |
| `SwimSyncApp/lib/authErrors.ts` | Maps raw Supabase auth errors to friendly copy |
| `SwimSyncApp/lib/attendanceBulk.ts` · `.test.ts` | Bulk "Set all to…" helper (`applyBulkStatus` + options) for the coach attendance screen (§8e) |
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
| `brand/` | **The mark's source of truth** (`mark.svg`) + recolours, app-icon tile, adaptive foreground. `README.md` there has the regeneration table and where the mark must NOT go |
| `SwimSyncApp/components/Logo.tsx` | The mark in the app: white-knockout **PNG** + `tintColor`. Deliberately not SVG — no `react-native-svg` (§6) |
| `SwimSyncAdmin/components/Logo.tsx` | The mark in the admin: **inline SVG**, `currentColor`. Hand-kept copy of `brand/mark.svg` — edit both |
| `supabase/migrations/20260719001400…002200` | This session: student identity + derived age, the tenant pin, document name snapshots, `tenant_levels`, the `swimming_ability` drop (CONTRACT), parent address, level skills |
| `SwimSyncApp/lib/lessonDates.ts` | Also holds **`ageFromDob()`** — age is derived, never stored. **Twin file**: edit `SwimSyncAdmin/lib/lessonDates.ts` too |
| `SwimSyncApp/app/(parent)/home/edit-child.tsx` | Parent edits their child (name/DOB/gender/notes). The first thing in the app that mutates `students` — see §6 on the tenant pin |
| `SwimSyncApp/app/(parent)/profile/contact.tsx` | Parent's address + postal code, editable after signup (the backfill path for parents who predate the fields) |
| `SwimSyncAdmin/app/(admin)/levels/page.tsx` | The business's level ladder **and** each rung's skill list (expand a row). Order is set here and preserved everywhere |
| `supabase/tests/student_identity · student_tenant_pin · document_name_snapshot · tenant_levels · level_skills · parent_address` | This session's pgTAP (+50). Each was confirmed to FAIL without its fix |
| `.claude/skills/run-ui-playwright/drivers/verify-{student-identity,edit-child,levels,level-skills,parent-address}.mjs` | Fifth session's UI drivers (49 checks). They caught three defects that typechecked clean and passed pgTAP |
| `.claude/skills/run-ui-playwright/drivers/verify-invoice-controls.mjs` | Sixth session (21 checks): MEASURES the toggle's track/knob rects from the DOM and asserts the billing-month default + cap. Its **14/21 baseline on unfixed code** is what located the knob bug (§7.34) |
| `SwimSyncAdmin/lib/adminNav.ts` (+ test) | Which pages an account can use, keyed on **`tenant_id`, never `role`** (§7.19). Sidebar, the layout gate and the post-login landing all derive from it, so they cannot disagree. Unknown routes fail closed |
| `SwimSyncAdmin/components/RequiresTenant.tsx` | The audience gate, applied once in the `(admin)` layout. **Early-returns** so a refused page's children never mount — an overlay would leave the queries running (§7.10) |
| `supabase/migrations/2026071900{2300,2400}` | `platform_tenant_overview()` + `platform_stranded_parents()`, then the derived-shape correction. SECURITY DEFINER, gated internally, REVOKEd from PUBLIC (§7.35) |
| `.claude/skills/run-ui-playwright/drivers/verify-platform-admin-scope.mjs` | 30 checks: every refusal asserts the **absence of rows**, and the tenant-admin half asserts all eleven pages render their **content** — "no refusal" would also pass on a blank page |
| `supabase/functions/generate-invoices/test-helpers.ts` → `monthEnded()` | The suite's clock seam. Supplies billing month + a clock at which it is billable + an early-enough enrolment as ONE fact, and **throws on a scenario expecting zero lessons** (§7.33) |

gotchas: `swimsync-project`, `swimsync-backend-gotchas`.

---

## 11. Cloud deployment (live, free tier — 2026-07-12; custom domain + email 2026-07-14)

**Web-first, $0.** The user is on iPhone; rather than pay $99/yr for an iOS native
build, the Expo app is exported as a **static web app** and used in Safari. Native
store builds are deferred until the app "sticks."

| Piece | Where | Notes |
|-------|-------|-------|
| **Backend** | Supabase project `cdmjeyauhxcgulhbxmsb` (region ap-southeast-1) | Free tier. Linked via `supabase link`; schema via `supabase db push`. |
| **Edge Function** | `generate-invoices` deployed | Auth via `CRON_SECRET` secret (set with `supabase secrets set`). Cold-start ~5–8s. **Deployed by `supabase functions deploy generate-invoices` — a git push does NOT deploy it.** Now also emails parents on invoice creation (§8c); needs `RESEND_API_KEY` secret set, else it's a no-op. Redeployed 2026-07-17 with the timezone-correct default billing month (§8a), **2026-07-18** with the multi-class fix, the configurable run day, month sealing and the hard attendance block (§8a), and **2026-07-19** with the effective-dated pricing engine (§8) then the **completed-month guard** (§8.6) — currently **v13**. `supabase functions list` is the honest answer for the version, not this cell. `APP_TIMEZONE` unset → defaults to `Asia/Singapore`. |
| **Admin panel** | Vercel `swimsync-admin` → **https://admin.swimsync.sg** (also `swimsync-admin.vercel.app`) | Root `SwimSyncAdmin`, **framework preset = Next.js**. |
| **Mobile app (web)** | Vercel `swimsync-app` → **https://swimsync.sg** (apex, canonical; `www` 308-redirects; also `swimsync-app-psi.vercel.app`) | Root `SwimSyncApp`, **preset = Other** (`SwimSyncApp/vercel.json`: `expo export --platform web` → `dist`, SPA rewrite). |
| **Email** | **Resend** → sender `noreply@swimsync.sg` | Two paths: **(1) Auth emails** (password reset) via cloud custom SMTP `smtp.resend.com:465` (user `resend`, pass = Resend API key, dashboard-only); branded reset template (dashboard + `supabase/templates/recovery.html`); auth rate limit 2→~30/hr; confirmation **OFF**. **(2) Invoice emails** (§8c) via the **Resend HTTP API** from the Edge Function, keyed by the `RESEND_API_KEY` secret (same key) — set with `supabase secrets set`. |
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
