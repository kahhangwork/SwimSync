# SwimSync — Session Handover

_Last updated: 2026-07-12_

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
- **Automated tests** — 23 integration tests (Deno + pgTAP); see §5.

**Deployed to free cloud infra (2026-07-12, web-first)** — see §11 for the live
URLs and setup. The full loop above is **verified end to end on the live cloud
stack** (parent register → assign → attendance → Edge-Function invoice → PayNow QR).

**Not done yet** (see §9): native App Store / Play Store builds (deferred — using
the web app on iPhone for now); frontend/component tests + CI.

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
supabase test db                                  # 22 tests across 4 files

# Backend — Function tests (Deno): generate-invoices billing math + credit ledger
supabase/functions/generate-invoices/test.sh      # 8 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component tests (vitest)
cd SwimSyncAdmin && npm test                       # 3 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 6 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (4) | one-invoice-per-parent-per-month, one active enrolment per student, positive-only credit applications, credit notes immutable to app roles |
| `credit_note_trigger.test.sql` (7) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson) |
| `rls_isolation.test.sql` (5) | RLS parent/parent isolation + superadmin sees all |
| `edge_cases.test.sql` (6) | PRD §11: **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |

_Deno engine tests — `supabase/functions/generate-invoices/core.test.ts` (run by `test.sh`):_
billable-only summing, paid vs free trial, no double-billing, the auto/manual
completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, and **11.7** credit-exceeds-
invoice carry-forward (+ ledger invariants via `checkInvariants`).

_Not yet individually tested (PRD §11):_ 11.2/11.3/11.6 are exercised implicitly
by the core-loop + RLS tests but have no dedicated assertion.

_Frontend tests (first suites — greenfield tooling):_
`SwimSyncAdmin` uses **vitest** + Testing Library (`vitest.config.ts`,
`components/StatusBadge.test.tsx`); `SwimSyncApp` uses **jest-expo**
(`jest.config.js`, `lib/authErrors.test.ts`, scoped to `lib/**` unit tests for
now). Deeper component-render tests (RN screens with mocked Supabase, admin
tables) are the natural next additions.

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

---

## 8. What changed this session (2026-07-12)

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

## 8b. Previous session (2026-07-11)

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
  + `app/reset-password` pages + a link on the login (mirrors the mobile reset). Needs
  the admin reset URL (`https://swimsync-admin.vercel.app/reset-password`) in the
  Supabase redirect allow-list. UI verified on cloud; full email round-trip is a
  real-inbox test (superadmin `+admin@gmail`).
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
- **PRD §11 edge cases — now covered by dedicated tests** (see §5 catalog):
  11.1, 11.4, 11.5, 11.7, 11.8 each have an explicit pgTAP or Deno test. Only
  11.2/11.3/11.6 remain implicit (exercised by the core-loop + RLS tests, no
  dedicated assertion) — add if a regression ever warrants it.

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
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `.claude/skills/run-ui-playwright/` | Skill to launch + drive both UIs (Playwright/Chrome) |
| `AVAIL_SKILLS.md` | Reference for all available skills |
| `LOCAL_DEV_GUIDE.md` | Run/test commands, seed logins, service URLs |
| `PRD.md` | Product spec (*(implemented)* sections = build decisions) |

Memory files (Claude project memory dir) also capture project state + backend
gotchas: `swimsync-project`, `swimsync-backend-gotchas`.

---

## 11. Cloud deployment (live, free tier — 2026-07-12)

**Web-first, $0.** The user is on iPhone; rather than pay $99/yr for an iOS native
build, the Expo app is exported as a **static web app** and used in Safari. Native
store builds are deferred until the app "sticks."

| Piece | Where | Notes |
|-------|-------|-------|
| **Backend** | Supabase project `cdmjeyauhxcgulhbxmsb` (region ap-southeast-1) | Free tier. Linked via `supabase link`; schema via `supabase db push`. |
| **Edge Function** | `generate-invoices` deployed | Auth via `CRON_SECRET` secret (set with `supabase secrets set`). Cold-start ~5–8s. |
| **Admin panel** | Vercel `swimsync-admin` → https://swimsync-admin.vercel.app | Root `SwimSyncAdmin`, **framework preset = Next.js**. |
| **Mobile app (web)** | Vercel `swimsync-app` → https://swimsync-app-psi.vercel.app | Root `SwimSyncApp`, **preset = Other** (build driven by `SwimSyncApp/vercel.json`: `expo export --platform web` → `dist`, SPA rewrite). |

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
