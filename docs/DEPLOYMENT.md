# SwimSync — Cloud deployment (§11)

_Split out of `HANDOVER.md` on 2026-07-26. What is live, where it lives, and the config
traps hit while getting it there._

> **`git push … :main` IS a deploy step** — Vercel builds both web apps from `main`. The
> Edge Functions are **not** deployed by a push; they need `supabase functions deploy`.
> For a backend-first change the order is **migrations → engine → apps**. See **§7.60**.

> **The section numbers here are load-bearing.** They are cited by bare number
> (`§7.41`, `§6`) from **781 places** across this repo — including inside **applied
> migrations** and Playwright drivers, where they can never be corrected. So: items keep
> their numbers forever. Append new ones at the end, never renumber, never reuse a retired
> number, and strike a dead item in place rather than deleting it.


> **Resolving a section number you see cited anywhere:**
> §3 → `HANDOVER.md` · §5 → `docs/TESTING.md` · §6 → `docs/ARCHITECTURE.md` ·
> §7 → `docs/GOTCHAS.md` · §8 → `HANDOVER.md` (session log) · §9 → `HANDOVER.md` ·
> §10, §12 → `docs/ARCHITECTURE.md` · §11 → `docs/DEPLOYMENT.md`.
> A bare `§11.6`-style number inside a PRD sentence means the **PRD's** §11 (edge cases) —
> check which document the sentence is about before following it.

---

## 11. Cloud deployment (live, free tier — 2026-07-12; custom domain + email 2026-07-14)

**Web-first, $0.** The user is on iPhone; rather than pay $99/yr for an iOS native
build, the Expo app is exported as a **static web app** and used in Safari. Native
store builds are deferred until the app "sticks."

| Piece | Where | Notes |
|-------|-------|-------|
| **Backend** | Supabase project `cdmjeyauhxcgulhbxmsb` (region ap-southeast-1) | Free tier. Linked via `supabase link`; schema via `supabase db push`. |
| **Edge Function** | `generate-invoices` deployed | Auth via `CRON_SECRET` secret (set with `supabase secrets set`). Cold-start ~5–8s. **Deployed by `supabase functions deploy generate-invoices` — a git push does NOT deploy it.** Now also emails parents on invoice creation (§8c); needs `RESEND_API_KEY` secret set, else it's a no-op. Redeployed 2026-07-17 with the timezone-correct default billing month (§8a), **2026-07-18** with the multi-class fix, the configurable run day, month sealing and the hard attendance block (§8a), **2026-07-19** with the effective-dated pricing engine (§8) then the **completed-month guard** (§8.6), and **2026-07-20** with package drawdown (§8.8), and **2026-07-27** with the attendance
window guard + per-date enrolment spans (§8.15), and **2026-08-02** with make-up bookings (PRD §7.20) — currently **platform version 18**. A **second function exists since 2026-07-20: `package-emails` v1** (purchase request/confirm emails; verify_jwt ON, no CRON_SECRET; same `RESEND_API_KEY`; **deployed separately** — deploying generate-invoices does not touch it). A **third since 2026-08-02: `public-invoice` v1** (the tokenized invoice page's data source + the sessionless "I've paid" claim; **verify_jwt = false, deliberately** — the 128-bit token is the access control, and this exists INSTEAD of an anon RPC, see `docs/ARCHITECTURE.md` §6; no secrets beyond the built-in service key; CORS pinned to swimsync.sg + localhost). `supabase functions list` is the honest answer for versions, not this cell. `APP_TIMEZONE` unset → defaults to `Asia/Singapore`. |
| **Admin panel** | Vercel `swimsync-admin` → **https://admin.swimsync.sg** (also `swimsync-admin.vercel.app`) | Root `SwimSyncAdmin`, **framework preset = Next.js**. |
| **Mobile app (web)** | Vercel `swimsync-app` → **https://swimsync.sg** (apex, canonical; `www` 308-redirects; also `swimsync-app-psi.vercel.app`) | Root `SwimSyncApp`, **preset = Other** (`SwimSyncApp/vercel.json`: `expo export --platform web` → `dist`, SPA rewrite). |
| **Email** | **Resend** → sender `noreply@swimsync.sg` | Two paths: **(1) Auth emails** (password reset) via cloud custom SMTP `smtp.resend.com:465` (user `resend`, pass = Resend API key, dashboard-only); branded reset template (dashboard + `supabase/templates/recovery.html`); auth rate limit 2→~30/hr; confirmation **OFF**. **(2) Invoice + package emails** (§8c) via the **Resend HTTP API** from the Edge Functions, keyed by the `RESEND_API_KEY` secret (same key) — set with `supabase secrets set`. **(3) Business-invite emails** (§8.9, 2026-07-21) via the Resend HTTP API from the **admin panel's Next.js route**, so `RESEND_API_KEY` is ALSO a **Vercel env var on the `swimsync-admin` project** — a Supabase secret is not visible to Vercel. The user reused the existing `swimsync-edge` Resend key rather than minting a second, so **rotating it takes down invoice, package AND invite email together**. Note the deliberate inversion: an invoice email is best-effort and swallowed, but the invite IS the deliverable, so a failed send surfaces the link in the UI instead. |
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
   allow-list, for the password-reset flow. **See §7.41** — production's list and
   `config.toml` are two separate lists that nothing keeps in step, and in 2026-07-27 both
   were found wrong in different ways.
5. **An `A` record at the apex blocks a `CNAME` at the apex.** Cloudflare had imported
   parking `A` records for `@` when the domain was transferred; Vercel's apex CNAME cannot
   be added until those are **deleted**, and the error does not say so. Delete the parking
   records first, then add the Vercel record. (Promoted from §8k, 2026-07-14.)
6. **There is no service-role key locally, so destructive production work runs in the
   dashboard SQL editor.** The clean-slate wipe (2026-07-14) was `TRUNCATE` on the business
   tables + deleting non-superadmin `auth.users`, run in the Supabase dashboard's SQL
   editor — not from a local script, because the local `.env` holds only the local stack's
   keys. Expect to do the same for any future production data surgery, and note that this
   is precisely the path with **no migration record and no CI** — write down what you ran.
   (Promoted from §8k, 2026-07-14.)

7. **`anon`'s EXECUTE grants on production are a REAL number, and it was 49.** A remote
   grant dump on 2026-08-04 — the check §7.39 says is the only honest one — found
   **49 functions** in `public` granting EXECUTE to `anon`, almost all of them from
   cloud's project-level default privileges rather than from any migration in this repo.
   `20260804000200` took it to **18**, and all 18 are trigger / event-trigger functions,
   which Postgres never privilege-checks against the writing role and PostgREST does not
   expose. **The number goes back up on its own**: every new function created on cloud
   gets the default grant, so a migration that adds one and forgets the revoke restores
   the problem silently. Re-run after any migration that creates a function:
   ```bash
   supabase db dump --linked -f /tmp/prod.sql
   grep -E '^GRANT (ALL|EXECUTE) ON FUNCTION' /tmp/prod.sql | grep '"anon"'
   ```
   `supabase/tests/function_grants.test.sql` covers the *local* half of this and passes by
   construction for the cloud half — a green run there is not evidence about production.
   **Since `20260804000400` the automatic leak is closed**: default privileges no longer
   hand `anon` (or `PUBLIC`) a new function, table or sequence, and that migration carries
   its own probes which RAISE at apply time if the revoke ever stops taking. The dump above
   is still worth running after a migration that creates a function — it catches a
   `GRANT … TO anon` somebody wrote **on purpose**, which no default can prevent — but it is
   no longer the only thing standing between you and a silent hole. (2026-08-04.)

**Verified live** end to end via `run-ui-playwright` against the cloud URLs (all three
roles): parent register → add child → superadmin assign → coach attendance → **manual
invoice via the Edge Function** ($25) → parent sees invoice → **coach PayNow QR upload
to Storage** (GET 200 image/png) → parent sees the QR.

**Invoicing is manual:** on the 1st, the superadmin opens the admin **Invoices** page →
pick the month → **Generate Invoices** (no cron; a paused free project wouldn't run it).

---
