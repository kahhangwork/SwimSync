# SwimSync — Session Handover

_Last updated: 2026-07-10_

This document brings the next session up to speed: current state, how to run
everything locally, key decisions/gotchas, and the planned next steps. Read
this first, then `SwimSync_PRD.md` for the product spec.

---

## 1. What SwimSync is

Swim-coach attendance & billing app for Singapore. Three roles:
- **Parent** — self-registers (mobile), adds children, views attendance/billing.
- **Coach** — marks attendance (mobile), views their students' billing.
- **Superadmin** — web admin panel: assigns children to classes, manages
  classes/coaches, oversees invoices/credit notes.

**Stack:** Expo (React Native) mobile app `SwimSyncApp/`, Next.js admin
`SwimSyncAdmin/`, Supabase backend (Postgres + Auth + Storage + Edge Functions).

---

## 2. Current state (what works)

Verified end to end against the **local** Supabase stack:
- Parent self-registration → auth trigger creates `profiles` + `parents` row.
- Add child (`students` + `parent_students`), superadmin assignment
  (`student_class_enrolments`).
- Coach attendance marking (creates `lesson_sessions` + `attendance`).
- Invoice generation — **automatic** (cron-style) and **manual on-demand**
  (admin button), sharing one `generate-invoices` function, with an on/off
  switch (`app_settings.auto_invoice_enabled`).
- Full RLS: parents see only their data, coaches only their classes,
  superadmin everything. Verified with isolation tests.

**Not yet verified / done** — see §6 (next steps).

---

## 3. How to run locally

Prereqs: Docker Desktop running, Supabase CLI installed (`supabase --version`).

```bash
cd /Users/kahhang/Documents/Code/SwimSync

# 1. Start the local Supabase stack (Postgres/Auth/Storage/Studio)
supabase start
# Studio: http://127.0.0.1:54323 · Mailpit: http://127.0.0.1:54324

# 2. Apply migrations + seed (only if you want a clean slate — WIPES test data)
supabase db reset

# 3. Serve the Edge Function (needed for invoice generation via the admin button)
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt

# 4. Admin panel (separate terminal)
cd SwimSyncAdmin && npm run dev            # http://localhost:3000

# 5. Mobile app (separate terminal)
cd SwimSyncApp && npx expo start           # press w (web) or i (iOS sim)
```

**Env files** (git-ignored) already point at local. `.env.example` files
document the shape. `CRON_SECRET=local-dev-cron-secret` is shared between
`supabase/functions/.env` and `SwimSyncAdmin/.env.local`.

**Seed accounts** (see `LOCAL_DEV_GUIDE.md`): superadmin & coach at
`*@swimsync.test` / `password123`, plus one class "Saturday Beginners".
Parents self-register in the app. Superadmin is **web-only** (mobile shows an
"unrecognised role" alert).

**Golden-path test:** register parent (app) → add child → assign in admin →
log in as coach, mark attendance → admin Invoices, pick the month, Generate.

---

## 4. Architecture & key decisions

- **Backend = ordered CLI migrations** in `supabase/migrations/` (source of
  truth). Never edit the old `Database_*` files — they're historical. `db reset`
  runs migrations `000100`→`001000` then `supabase/seed.sql`.
- **RLS** uses `SECURITY DEFINER` helper functions (`is_superadmin()`,
  `current_parent_id()`, `coach_serves_parent()`, …) to avoid policy recursion.
  See `20260309000600_rls_policies.sql`.
- **Auth trigger** (`20260309000200`) creates the `profiles` row AND the
  role-specific `parents`/`coaches` row on signup.
- **Invoice engine** is one function (`supabase/functions/generate-invoices/`)
  parameterized by `{ mode: auto|manual, force, billing_month }`. Manual bypasses
  the completeness gate + auto-switch; auto respects both and seals the month.
- **Cron** (`supabase/cloud/cron_schedule.sql`) is **cloud-only** — kept out of
  local migrations because it needs pg_cron/pg_net + project-ref + CRON_SECRET.
- **Grants matter:** tables created by the `postgres` migration role don't
  auto-grant DML to `authenticated`/`service_role`; `20260309000800_grants.sql`
  does it explicitly. Any new table needs this (or relies on the default
  privileges set there).

## 5. Gotchas already hit (don't re-introduce)

1. `insert().select()` under RLS needs the row to pass the SELECT policy
   immediately (see `students.created_by` fix).
2. Attendance uses `lesson_session_id` (not `session_id`); `marked_by` is a
   **profile** id, not a `coaches.id`.
3. `lesson_sessions.start_time/end_time` are NOT NULL — filled by a BEFORE
   INSERT trigger from the class (`20260309000900`).
4. `useFocusEffect` must get a sync callback, not an `async` one.
5. Original schema files had `absent` as billable — it is NOT (PRD 5.4).

---

## 6. NEXT TASK: Credit-note flow (do this first)

This is the last untested piece of the **core billing logic** and the riskiest.

**What should happen (PRD §5.6, §7.8):**
1. A lesson is invoiced (billable → has an `invoice_items` row).
2. Coach edits that lesson's attendance from billable (present/trial_paid) to
   non-billable (absent/cancelled_*/trial_free).
3. The `handle_attendance_update` trigger (`20260309000500`) auto-issues a
   `credit_notes` row (ref `CN-YYYY-NNNN`, status `available`) and adds the
   amount to `parents.credit_balance`.
4. On the **next** invoice generation, the function applies available credit
   FIFO: deducts from `credit_balance`, marks credit notes `applied`, and reduces
   the invoice `net_amount` (invoice becomes `paid` if fully covered).

**Plan:**
- **Verify the trigger** end to end with SQL against the local DB (edit an
  invoiced attendance row → confirm credit note + balance). The trigger logic
  exists but has never been exercised.
- **Drive it through the UI:** the coach "edit past attendance" path
  (`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx` handles edits via
  upsert) → check the credit note appears for the parent
  (`(parent)/billing` + `credit-notes` views) and in the admin credit-notes page.
- **Verify application:** generate a *later* month's invoice and confirm the
  credit is applied and balance drawn down.
- **Watch for:** the same column-drift / RLS-returning / grant classes of bugs
  as before. Check the parent billing screens actually render credit notes
  (columns were audited clean, but runtime not driven yet).
- Likely needs test data spanning two months (invoice month N, correct in N,
  generate N+1). Consider a small SQL helper to set that up.

After this is solid, **plan the following steps** (see §7) and pick with the user.

---

## 7. Roadmap after credit notes

- **Cloud deployment** — create the real Supabase project, `supabase link
  --project-ref …`, `supabase db push`, `supabase functions deploy
  generate-invoices`, set `CRON_SECRET` secret, run `supabase/cloud/
  cron_schedule.sql`, create the `paynow-qr` bucket (migration handles it on
  push). Re-point both `.env` files to cloud. Makes it demoable on real phones.
- **PayNow QR upload** — storage bucket + policies exist
  (`20260309000700`); the coach upload flow (`(coach)/settings`) and parent
  display (`(parent)/billing/paynow.tsx`) haven't been driven.
- **Remaining screens** — smoke-test parent billing detail, admin
  attendance/students/dashboard, coach billing (columns audited clean, runtime
  unverified).
- **Automated tests** — none exist; billing/credit math is the priority target.
- **Auth polish** — "Forgot password?" link is a no-op; no password reset flow.

---

## 8. File map

| Path | What |
|------|------|
| `supabase/migrations/` | Schema, RLS, triggers, grants (ordered, source of truth) |
| `supabase/functions/generate-invoices/` | Invoice engine (auto + manual) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/` |
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `LOCAL_DEV_GUIDE.md` | How to run/test locally, seed logins, service URLs |
| `SwimSync_PRD.md` | Product spec (sections marked *(implemented)* = build decisions) |

Memory files (in the Claude project memory dir) also capture the project state
and backend gotchas: `swimsync-project`, `swimsync-backend-gotchas`.
