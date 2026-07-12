# SwimSync — Local Dev Guide

Everything needed to run and test SwimSync on your machine: the commands, the
dummy credentials, and the test flows. All of this is **local dev only** —
never reuse these secrets/passwords in a cloud project.

Repo root: `/Users/kahhang/Documents/Code/SwimSync`

---

## 1. Start everything (typical session)

Run each block in its **own terminal** (they stay running). Order matters:
start Supabase first.

### Terminal 1 — Supabase stack (Postgres/Auth/Storage/Studio)
```bash
cd /Users/kahhang/Documents/Code/SwimSync
supabase start
```
Make sure **Docker Desktop is running** first. Check status any time with
`supabase status`. Stop everything with `supabase stop`.
> **Edited `supabase/config.toml`?** Restart the stack
> (`supabase stop && supabase start`) — auth settings such as
> `[auth].additional_redirect_urls` (the password-reset redirect allow-list) are
> only read at boot, so the mobile reset link is rejected until you restart.

### Terminal 2 — Invoice Edge Function (needed for the Generate Invoices button)
```bash
cd /Users/kahhang/Documents/Code/SwimSync
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt
```

### Terminal 3 — Admin panel (web)
```bash
cd /Users/kahhang/Documents/Code/SwimSync/SwimSyncAdmin
npm run dev
```
Opens at **http://localhost:3000**. Restart this if you change `.env.local`.

### Terminal 4 — Mobile app
```bash
cd /Users/kahhang/Documents/Code/SwimSync/SwimSyncApp
npx expo start
```
Then press **`w`** for web (simplest) or **`i`** for the iOS simulator, and
**`r`** to reload after code changes.
(Shortcuts: `npm run web`, `npm run ios`, `npm run android`.)
> A **physical phone** can't reach `127.0.0.1` — set your Mac's LAN IP in
> `SwimSyncApp/.env` instead.

---

## 2. Dummy credentials

Created by `supabase/seed.sql` on every `supabase db reset`.

| Role | Email | Password | Where to log in |
|------|-------|----------|-----------------|
| Superadmin | `superadmin@swimsync.test` | `password123` | Admin panel → http://localhost:3000 |
| Coach | `coach@swimsync.test` | `password123` | Mobile app (Coach) |
| Parent | *self-register in the app* | *you choose* | Mobile app (Parent) |

- **Parents self-register** in the app (the "Register" link on the Sign In
  screen). Registration only ever creates *parent* accounts by design.
- **Superadmin is web-only** — logging in as superadmin on mobile shows an
  "unrecognised role" alert. Use the admin panel.
- The seed also creates one class: **Saturday Beginners** (Sat 10–11am, Buona
  Vista, $25/lesson), owned by the coach above.

---

## 3. Local service URLs

| Service | URL |
|---------|-----|
| API | http://127.0.0.1:54321 |
| Studio (browse DB) | http://127.0.0.1:54323 |
| Mailpit (captured emails) | http://127.0.0.1:54324 |
| Admin panel | http://localhost:3000 |
| Edge Function | http://127.0.0.1:54321/functions/v1/generate-invoices |

---

## 4. Test flows

### Golden path (core loop)
1. Mobile app → **Register** a parent → **Add Child**.
2. Admin (superadmin) → **Unassigned Children** → assign the child to
   *Saturday Beginners*.
3. Mobile app → log out → log in as the **coach** → **mark attendance**.
4. Admin → **Invoices** → pick the billing month → **Generate Invoices**.
5. Mobile app → log in as the parent → **Billing** → see the invoice.

### Invoice generation — the two modes
- **Manual (on-demand):** Admin → Invoices → month picker → **Generate
  Invoices**. Requires Terminal 2 (function) running.
- **Automatic switch:** the **Automatic monthly generation** toggle on the same
  page flips `app_settings.auto_invoice_enabled`. When off, the scheduled/auto
  path short-circuits; manual still works.

### Credit-note flow
1. Run the golden path so a parent has an invoice for month N.
2. Coach app → **Classes** → open the class → **past sessions** → pick the
   invoiced session → change the student from **Present** to **Absent** → Save.
   → a credit note is auto-issued (parent Billing → **Credit Notes** tab shows it;
   admin → **Credit Notes** lists it).
3. Generate month N+1's invoice → the parent's invoice shows **Credit Applied**
   and a reduced net (or **Paid** if fully covered; surplus carries forward).

### PayNow QR flow
1. Coach app → **Settings** → **Upload QR Code** → pick an image. Stored at
   `paynow-qr/<coach_id>/…`, saved to `coaches.paynow_qr_url`.
2. Parent app → **Billing** → open an outstanding invoice → **Pay via PayNow QR**
   → the coach's QR renders. Admin → **Coaches** → the row shows **Uploaded** + a
   QR modal.

### Invoke the function directly (faithful test, no UI)
```bash
# Manual generation for a chosen month
curl -s -X POST http://127.0.0.1:54321/functions/v1/generate-invoices \
  -H "Authorization: Bearer local-dev-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"mode":"manual","force":true,"billing_month":"2026-07"}' | python3 -m json.tool

# Simulate the daily cron (auto mode, respects the on/off switch)
curl -s -X POST http://127.0.0.1:54321/functions/v1/generate-invoices \
  -H "Authorization: Bearer local-dev-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"mode":"auto","billing_month":"2026-07"}' | python3 -m json.tool
```

### Peek at the database from the terminal
```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -c \
  "SELECT billing_month, gross_amount, net_amount, status FROM invoices;"
```
(Or just browse in Studio → http://127.0.0.1:54323.)

### Running the tests
Integration tests for the billing/credit engine. **Prereq:** the local stack is
running (`supabase start`). Two suites:

```bash
# 1. Database tests (pgTAP) — credit-note trigger, RLS isolation, constraints.
supabase test db

# 2. Function tests (Deno) — the generate-invoices billing math + credit ledger.
#    test.sh exports SERVICE_ROLE_KEY from `supabase status` and runs deno test.
supabase/functions/generate-invoices/test.sh
```

Each test seeds its own data and rolls back / tears down, so they leave the DB as
they found it. See `supabase/tests/*.test.sql` and
`supabase/functions/generate-invoices/core.test.ts`.

---

## 5. Reset to a clean slate
```bash
cd /Users/kahhang/Documents/Code/SwimSync
supabase db reset
```
Re-applies all migrations + `seed.sql`. **Wipes** the test data you created
(parents/children/attendance/invoices) but always restores the two seed
accounts and the seed class.

---

## 6. Handy references
- `HANDOVER.md` — current build state, architecture, gotchas, next steps.
- `SwimSync_PRD.md` — product spec.
- `supabase/migrations/` — the database (source of truth).
- `.env.example` files — the shape of each project's env vars.
