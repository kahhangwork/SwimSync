---
name: run-ui-playwright
description: Launch and drive SwimSync's UIs end-to-end with Playwright (the SwimSyncApp Expo mobile app in web mode + the SwimSyncAdmin Next.js panel), driving the machine's installed Chrome. Use to run/screenshot the apps or confirm a change works in the real UI across parent/coach/superadmin roles — not just tests. Captures the Expo-web login/navigation/force-click quirks so a UI run is cheap.
---

# Running & driving SwimSync's UIs (Playwright + Chrome)

Two apps: **SwimSyncApp** (Expo / React-Native, driven in **web** mode) and
**SwimSyncAdmin** (Next.js). We drive them with `playwright-core` against the
**installed Google Chrome** (`channel: "chrome"`) so there's no Chromium
download. This skill captures the non-obvious mechanics — especially for the
Expo/RN-web app — so you don't re-derive them.

## 0. Prereqs (must already be up)

- Docker Desktop running + local Supabase stack: `supabase start` (from repo
  root). API at `http://127.0.0.1:54321`, Studio at `:54323`.
- For anything that generates invoices, serve the edge function:
  `supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt`
- See `LOCAL_DEV_GUIDE.md` / `HANDOVER.md` for the full local setup.

## 1. Start the dev servers (background)

```bash
# Admin (Next.js) → http://localhost:3000
cd SwimSyncAdmin && npm run dev
# Mobile (Expo web) → http://localhost:8081  (Metro compiles on first request)
cd SwimSyncApp && npx expo start --web
```

Readiness: admin returns 307 (redirect to /login) once ready; Expo returns 200
on `/`. The Expo log may print a **favicon `readFileSync` error — ignore it**,
it's non-fatal. Poll with `curl -s -o /dev/null -w "%{http_code}" <url>`.

## 2. Install the driver (once)

```bash
cd .claude/skills/run-ui-playwright/drivers && npm install   # installs playwright-core
```

`drivers/lib.mjs` holds the reusable helpers; import it from a small script per
flow. `channel: "chrome"` uses the installed Chrome — no `playwright install`.

## 3. Seed logins (from supabase/seed.sql)

| Role | Email | Password | Lands on |
|------|-------|----------|----------|
| Superadmin | `superadmin@swimsync.test` | `password123` | admin `/dashboard` (web-only; mobile shows "unrecognised role") |
| Coach | `coach@swimsync.test` | `password123` | app `/today` |
| Parent | self-register in app, or seed an `auth.users` row with `raw_user_meta_data.role='parent'` (`password123`) | | app `/home` |

## 4. Drive it — Expo-web gotchas (READ THIS)

These cost time to rediscover:

1. **Login button vs heading collision.** The login screen has a "Sign In"
   *heading* and a "Sign In" *button* with identical text. Use
   `page.getByText("Sign In").last()` (button is last). Email field:
   `getByPlaceholder("you@email.com")`; password: `input[type="password"]`.
2. **Auth persists across reloads, the store does not.** Session lives in the
   Zustand store (in-memory), but the root `_layout` rehydrates it on launch
   from Supabase's persisted session (localStorage). So a full-page
   `page.goto(...)` reloads and *rehydrates* — fine — but there's a brief
   window where a protected screen bounces to `/login`; retry the goto (see
   lib). Prefer **in-app navigation** (click links/cards) which keeps the store
   alive and never reloads.
3. **Deep-linking to a nested stack screen is unreliable.** Navigating straight
   to `/classes/<id>/attendance?...` can resolve the URL back to the stack's
   initial route (`/today`) with the target rendered off-screen. **Navigate like
   a user instead:** tab bar link → card → row. Tab bar exposes real client-side
   links: `a[href="/classes"]`, `/billing`, `/today`, `/settings`.
4. **RN-web touchables need `click({ force: true })`.** `TouchableOpacity`
   renders with overlay siblings that intercept pointer events; a normal click
   times out ("subtree intercepts pointer events"). Force-click dispatches on
   the element and the press bubbles to the handler.
5. **`Alert.alert` is a no-op on RN-web** — no dialog appears, so don't wait for
   one to confirm a save. The DB write happens before the alert; assert against
   the DB (or the next screen) instead. A `page.on("dialog", d => d.accept())`
   handler is still harmless to keep.
6. **Both stacked screens are in the DOM.** Native-stack keeps the previous
   screen mounted under the current one, so `document.body.innerText` shows
   both. Assert on text unique to the target screen.
7. Viewport: use a mobile viewport (`{ width: 420, height: 900 }, isMobile:true`)
   for the Expo app. A benign `pageerror` about "Cannot manually set color
   scheme" appears — ignore it.

## 5. Drive it — Admin (Next.js)

Standard web app, no RN quirks. Login: `input[type="email"]`,
`input[type="password"]`, `button[type="submit"]`. Then `page.goto` any admin
route (`/credit-notes`, `/dashboard`, `/invoices`, …). Screenshots render fine.

## 6. Always look at the screenshot

Dump `document.body.innerText` for assertions AND `page.screenshot(...)`, then
actually open the PNG — a blank frame means the bundle didn't hydrate.

## Worked example — the credit-note flow (all three roles)

`drivers/example-credit-note-flow.mjs` walks the full loop: coach edits a past
invoiced session (Classes → roster → session → Absent → Save, which fires the
credit-note trigger) → assert the note in the parent Billing→Credit Notes tab
and the admin Credit Notes page → generate the next month → assert "Credit
Applied" on the parent invoice. Use it as the template for new flows.

## Reference: reusable helpers

`drivers/lib.mjs` exports `launch()`, `loginExpo(page, email, pw)`,
`loginAdmin(page, email, pw)`, `tap(locator, label)` (force-click),
`gotoAuthed(page, url)` (goto with login-bounce retry), and `dumpText(page)`.
