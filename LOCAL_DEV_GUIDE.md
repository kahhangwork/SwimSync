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

### Terminal 2 — Edge Functions (needed for Generate Invoices, and package emails)
```bash
cd /Users/kahhang/Documents/Code/SwimSync
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt
```

There are **two** Edge Functions. `generate-invoices` is the one you need for the core
loop. If you're working on **prepaid packages** (PRD §7.16), the purchase-email path
lives in a second function and needs its own terminal:

```bash
supabase functions serve package-emails --env-file supabase/functions/.env
```
> Note the **missing `--no-verify-jwt`**: `package-emails` runs with `verify_jwt` ON and
> re-checks the caller in-body, so it must receive a real user JWT. Both functions are
> deployed **separately** (`supabase functions deploy <name>`) — deploying one does not
> touch the other, and a `git push` deploys neither.

Emails are a **logged no-op unless `RESEND_API_KEY` is set** in
`supabase/functions/.env`, so leaving it blank locally is expected and correct.

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
| Platform admin | `superadmin@swimsync.test` | `password123` | Admin panel → lands on **`/platform`**, and the eleven single-business pages refuse them by design (PRD §4.4) |
| Coach | `coach@swimsync.test` | `password123` | Mobile app (Coach) |
| Parent | *self-register in the app* | *you choose* | Mobile app (Parent) |

- **Parents self-register** in the app (the "Register" link on the Sign In
  screen). Registration only ever creates *parent* accounts by design.
- **Roles changed with multi-tenancy** (PRD §4.3). The seed now creates a
  **platform_admin** (`superadmin@…`, cross-tenant support, belongs to no business) and a
  **private coach** (`coach@…`) who is a **tenant_admin AND a coach** — the shape
  production has. The seed tenant is *Coach Marcus Swim School*, join code **`SWIM-TEST`**.
  Deliberately fictional; production's real names are set separately.
- **A parent must enter a join code before adding a child.** Register in the app, then
  enter `SWIM-TEST`. Without it, Add Child shows a "Join your coach first" gate.
- **An admin who does not teach is web-only** — logging in on mobile shows an
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
2. Admin (the tenant admin — log in as `coach@swimsync.test`, who is both) →
   **Unassigned Children** → assign the child to
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
The QR belongs to the **business**, not the coach (PRD §7.10) — a school has one bank
account. The seed coach is also their tenant's admin, so they can set it.

1. Coach app → **Settings** → **Upload QR Code** → pick an image. Stored at
   `paynow-qr/<tenant_id>/paynow-qr`, saved to **`tenants.paynow_qr_url`**.
2. Parent app → **Billing** → open an outstanding invoice → **Pay via PayNow QR**
   → the QR of the business that *issued that invoice* renders. Admin → **Coaches** →
   the row shows **Uploaded** + a QR modal.

### Prepaid packages flow (PRD §7.16)
Packages are **dormant until a product exists** — with no category or product, every
family bills ad hoc exactly as before. To switch them on locally:

1. Admin → **Packages** → create a **class category**, then a **product** (N lessons,
   a locked rate, valid M months, scoped to that category).
2. Admin → **Classes** → tag the relevant classes with that category.
3. Parent app → **Billing → Packages** → request the package → **PayNow** screen shows
   the *requested* product's price.
4. Admin → **Packages** → confirm the pending request → it becomes **Active**.
5. Mark attendance, then generate invoices: the engine draws the balance down **at the
   package's locked rate**, at invoice time (never at marking time).

The parent card and the admin tables both read live balances from the
**`package_live_balances()`** RPC — the only derivation of pending draws. Don't
recompute "lessons left" in TypeScript. The admin students **"Package running low"**
filter uses the per-tenant `tenants.low_package_lessons` threshold; families with no
package are never "running low", they're ad hoc.

There's a UI driver that walks this whole flow end to end across both apps:
`.claude/skills/run-ui-playwright/drivers/verify-packages.mjs` (+ `fixtures-packages.sql`).

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

# 2. Function tests (Deno) — generate-invoices billing math + credit ledger + package
#    drawdown, plus the invoice- and package-email builders/senders + orchestration.
#    test.sh exports SERVICE_ROLE_KEY from `supabase status` and runs deno test. (Local
#    generation sends no emails unless RESEND_API_KEY is set in supabase/functions/.env
#    — leaving it blank is expected.)
supabase/functions/generate-invoices/test.sh
```

> **Run the Deno suite twice** after touching the engine. A completing run **seals** its
> billing month, so leaked state makes a second run short-circuit on `already_complete` —
> passing once proves nothing (HANDOVER §7.15).

The frontend suites need no stack: `cd SwimSyncAdmin && npm test` (vitest) and
`cd SwimSyncApp && npm test` (jest-expo). Current counts live in HANDOVER §5 — and by
its own rule, **the test runner is the fact and the prose is the hint**.

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
- `PRD.md` — product spec.
- `supabase/migrations/` — the database (source of truth).
- `.env.example` files — the shape of each project's env vars.
