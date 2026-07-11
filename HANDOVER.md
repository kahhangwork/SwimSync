# SwimSync — Session Handover

_Last updated: 2026-07-11_

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
- **Credit-note flow (verified end to end incl. UI, 2026-07-11):** editing an
  invoiced attendance row billable→non-billable auto-issues a credit note (+adds
  to the parent's pooled `credit_balance`); the next invoice draws it down FIFO.
  Verified at the DB/function level across a Jan→Feb→Mar→Apr scenario (incl. the
  carry-forward edge case and a note spent across two months), AND driven through
  the real UI: coach edits a past invoiced session (Classes→roster→session) →
  credit note renders in the parent Billing→Credit Notes tab and the admin
  Credit Notes page → next month's invoice shows "Credit Applied" in the parent
  app. A ledger-reconciliation bug found here was fixed — see §6.
- Full RLS: parents see only their data, coaches only their classes,
  superadmin everything. Verified with isolation tests.

**Not yet verified / done** — the credit-note flow has NOT yet been driven
through the mobile/admin UI (coach edit screen → parent billing → admin
credit-notes page); only the backend was exercised. See §7 for the rest.

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

## 6. Credit-note flow — VERIFIED + bug fixed (2026-07-11)

The core billing logic (trigger → application) is now proven at the DB/function
level. What was verified and what changed:

**Behaviour confirmed (PRD §5.6, §7.8):**
1. A lesson is invoiced (billable → has an `invoice_items` row).
2. Coach edits that lesson's attendance from billable (present/trial_paid) to
   non-billable → the `handle_attendance_update` trigger (`20260309000500`)
   auto-issues a `credit_notes` row (`CN-YYYY-NNNN`, status `available`) and
   adds the amount to `parents.credit_balance`. **Precise:** no note is issued
   for billable→billable edits, nor for edits on not-yet-invoiced lessons.
3. On the next invoice generation the function applies available credit FIFO,
   reduces `net_amount` (invoice `paid` if fully covered), and carries any
   surplus forward.

**Credit is pooled at the PARENT level** (`credit_notes.parent_id` +
`parents.credit_balance`); the note's `student_id` is provenance only. Because
invoices are one-per-parent-per-month aggregating all the parent's kids, a
credit earned from one child is spendable against any child's charges. No change
needed for that — confirmed.

**Bug found + fixed — partial-application ledger drift.** The old FIFO loop
marked a whole credit note `applied` even when only part of it covered a smaller
invoice (e.g. a \$30 note vs a \$20 invoice), leaving the residual \$10 only in
the pooled balance with no backing note. `invoice.credit_applied` then no longer
reconciled with the note ledger. Fixed by adding a **`credit_applications`
allocation ledger** (migration `20260711000100`): every draw is one immutable
row (`credit_note_id`, `invoice_id`, `amount`); a note stays `available` until
fully consumed (possibly across several months) then flips to `applied`. The
invoice engine (`generate-invoices`) now draws down by the actual consumed
amount and writes a ledger row per draw. Invariants now hold:
`SUM(applications by invoice) = invoice.credit_applied`, and
`parents.credit_balance = SUM(remaining across the parent's notes)`.

**How it was verified:** a self-contained SQL seed (parent/student/class +
two-plus months of attendance) driven through the real served `generate-invoices`
function. Reusable helper kept out-of-repo in the scratchpad
(`cn-seed.sql`) — ask if you want it committed under `supabase/tests/`.

**UI verified (2026-07-11).** Drove the flow through Expo web + the Next.js admin
with Playwright (driving the installed Chrome). Coach path: Classes → class roster
→ tap a past invoiced session → set Absent → Save issues the credit note (the
screen's `upsert` with `onConflict` resolves to an UPDATE, firing the trigger).
Parent Billing→Credit Notes renders it (Available, "Present → Absent", amount);
admin Credit Notes page renders it with student/parent (nested embeds resolve
under superadmin RLS); after generating the next month, the parent's invoice
shows "Credit Applied −S$…" and the note flips to Applied. No column-drift /
RLS / grant issues surfaced. Screens read only `credit_notes`; none surface the
new `credit_applications` breakdown yet (its read-only SELECT policy is ready if
a screen wants it).

**Minor UI bug spotted (not credit-note related):** the coach tab bar renders
the hidden `classes/[id]/attendance` and `classes/[id]/roster` routes as extra
tabs (hrefs like `/classes/undefined/roster`). The `(coach)/_layout` Tabs config
should mark those with `href: null`. Worth a quick fix.

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
| `…/20260309000500_credit_note_trigger.sql` | Auto-issues a credit note on billable→non-billable edit of an invoiced lesson |
| `…/20260711000100_credit_applications.sql` | Credit-note allocation ledger (fixes partial-application drift) |
| `supabase/functions/generate-invoices/` | Invoice engine (auto + manual; applies credit FIFO via the ledger) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/` |
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `LOCAL_DEV_GUIDE.md` | How to run/test locally, seed logins, service URLs |
| `SwimSync_PRD.md` | Product spec (sections marked *(implemented)* = build decisions) |

Memory files (in the Claude project memory dir) also capture the project state
and backend gotchas: `swimsync-project`, `swimsync-backend-gotchas`.
