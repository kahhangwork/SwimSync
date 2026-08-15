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

   **Extended the same day, because `anon` was only one cell of the grid.** Default
   privileges are **role × object type**, and three migrations each closed a different
   corner while all their probes passed: `000400` did functions for `anon` and `PUBLIC`,
   `000600` did tables and sequences for `authenticated`, and only a dump taken *after*
   `000600` landed revealed `GRANT ALL ON FUNCTIONS TO "authenticated"` still standing —
   closed by `000700` (§7.89). **Run this after ANY migration that touches privileges**;
   it checks the whole grid at once and must return **zero rows**:
   ```sql
   SELECT pg_get_userbyid(defaclrole), defaclnamespace::regnamespace, defaclobjtype, defaclacl
     FROM pg_default_acl
    WHERE pg_get_userbyid(defaclrole) = 'postgres'
      AND (defaclacl::text LIKE '%anon=%' OR defaclacl::text LIKE '%authenticated=%'
           OR defaclacl::text LIKE '%service_role=%');
   ```
   The `supabase_admin`-owned rows still name all three roles and are **deliberately left
   alone** — nothing in this repo creates objects as `supabase_admin`, and on cloud
   `postgres` may not hold the membership to change them. Don't "fix" them.

   **`service_role` joined the closed set on 2026-08-14 (`20260814000300`, §11.20)** — the
   `postgres`-owned default no longer hands it a new function, table or sequence either, so
   the grid query includes it above and must still return zero rows. It carries the same
   apply-time probes as `20260804000400`. The **existing 37 tables keep their `service_role`
   grants** — this closed the automatic leak for FUTURE objects only, so the consequence for
   every later migration is: a table/function a NEW feature needs from an edge function or
   admin route must `GRANT … TO service_role` explicitly, or the first call is a loud
   `permission denied` in dev (that is the intended failure mode, not a regression).

   **Re-run 2026-08-11 after `20260811000100`** (Wave 2 — created two trigger functions and
   re-created two RPCs under new signatures): `anon` EXECUTE still **18**, unchanged from the
   2026-08-04 baseline, so the automatic leak stayed closed across a migration that creates
   functions. The dump also confirmed the half a `db push` cannot: **both old signatures are
   gone** (`book_makeup(uuid,date,uuid)`, `close_student_enrolment(uuid,boolean)`) and both
   new ones carry `TO "authenticated"`. That check is worth copying whenever a signature
   changes — the grant is only half of it, and a surviving old overload is the other half
   (§7.124). ⚠ **Grep the dump with QUOTED identifiers** (`"public"."book_makeup"`): a
   `public.book_makeup` pattern matches nothing and reads exactly like a failed deploy.

   **Re-run 2026-08-12 after `20260812000100`** (the roster guard — creates one function,
   `sessions_i_am_main_on(uuid[])`, and replaces `assign_session_coach`): `anon` EXECUTE
   still **18**, unchanged from the 2026-08-04 baseline for the third migration running, so
   the closed leak has now survived three function-creating migrations. The new function
   carries `REVOKE ALL … FROM PUBLIC` plus `TO "service_role"` and `TO "authenticated"` and
   nothing else. **Nothing about this one needed the signature half of the check** — it adds
   an overload-free new name and replaces an existing signature in place, so there was no old
   overload to strand (contrast Wave 2, above, where that half was the point).

   **`service_role` still gets a default EXECUTE on every new function, and that is the
   untouched-by-design cell** (§8.29 scoped the sweep to the client roles). Observed
   2026-08-06: `is_tenant_owner()` and `profile_reference_columns()` came out of
   `20260806000100` with a cloud-side `GRANT … TO service_role` neither migration wrote,
   while the four co-admin RPCs don't — they carry an explicit
   `REVOKE … FROM service_role`. Harmless for these (both are `auth.uid()`-keyed or
   catalog reads), but it is a standing local/cloud drift: don't read a service_role grant
   in a remote dump as evidence someone granted it.

   **Confirmed a third time 2026-08-09, and the shape is now clear enough to predict.**
   `20260809000100` shipped three functions. The two its migration wrote explicit REVOKEs
   for — `next_package_ref` and `assign_parent_package_reference` — came out of the dump
   with **no grant lines at all**. The one it didn't, `pin_parent_package_reference`, came
   out with `GRANT ALL … TO "service_role"`. So the rule is simply: **whatever you do not
   revoke, `service_role` gets.** The dump's `anon` count stayed at **18**, unchanged,
   which is `20260804000400` doing its job. `pin_parent_package_reference` was left as-is
   because it matches eight sibling pin/enforce trigger functions
   (`pin_parent_identity`, `pin_student_tenant`, `pin_package_product_terms`, …) and
   trigger functions are not privilege-checked and not exposed by PostgREST — but the
   inconsistency with `pin_invoice_public_fields`, which *does* carry a
   `REVOKE … FROM PUBLIC`, is real. **This is the evidence base for the `service_role`
   audit queued in `BACKLOG.md`; do not close individual cells of it one migration at a
   time.**

   **Fourth confirmation, 2026-08-09 (`20260809000200`).** The rule now predicts the dump
   exactly. That migration creates one function, `audit_student_update()`, and writes no
   grant of its own; the dump came back with
   `REVOKE ALL … FROM PUBLIC` + `GRANT ALL … TO "service_role"` — the PUBLIC half is
   `20260804000400` still holding, the `service_role` half is the cloud default. The `anon`
   EXECUTE count stayed at **18**. Left as-is for the same reason as
   `pin_parent_package_reference`: it matches its sibling trigger functions, and trigger
   functions are neither privilege-checked by Postgres nor exposed by PostgREST. **Predicting
   the dump is not a substitute for taking it** — §7.39 is that the local stack cannot
   reproduce cloud's defaults at all, so the prediction is only ever a hypothesis until the
   dump confirms it.

   **Fifth confirmation, 2026-08-09 (`20260809000300`) — and this one tested the rule from
   the OTHER side.** Every previous data point was a function whose migration wrote no
   REVOKE, so cloud filled the gap. This migration explicitly revoked all three of its
   functions from `PUBLIC, anon, authenticated, service_role`, and the dump came back with
   **no `service_role` line for any of them** — `deactivate_class` and `reactivate_class`
   carry `REVOKE ALL … FROM PUBLIC` + `GRANT ALL … TO "authenticated"` (from the separate
   `20260809000400`), and `class_unmarked_lesson_dates` carries the REVOKE and **nothing
   else**: callable by nobody, which is what an internal `SECURITY DEFINER` helper should
   be. So the rule holds in both directions — *whatever you do not revoke, `service_role`
   gets; whatever you do revoke, stays revoked.* An explicit revoke is the whole fix, and
   it costs one line. `anon` EXECUTE stayed at **18**; `GRANT ALL ON TABLE … TO
   "authenticated"` stayed at **0**.

   **This is also the first deploy to use the grant itself as the ordering mechanism.**
   `20260809000300` shipped the RPCs with no grant at all, and `20260809000400` — a
   separately-numbered file, pushed only *after* `supabase functions list` confirmed the new
   engine — added `GRANT EXECUTE … TO authenticated`. §7.87 turned into a feature flag:
   between the two pushes nothing could reach `deactivate_class()`, which was the point,
   because the old engine still filtered `is_active` and a deactivation in that window would
   have been a permanent underbill. To hold a migration back, **move the file out of
   `supabase/migrations/` and put it back for the second push** — `supabase db push` applies
   everything pending (§7.49, §7.30), so two files present at once is one deploy and the
   ordering you wrote down did not happen.

8. **Production's client-role grants are a DECLARED SET now, and the dump is how you check
   it.** Since `20260804000600` `authenticated` holds a table privilege only where a policy
   could permit it. Verified on production 2026-08-04: **zero** `GRANT ALL ON TABLE … TO
   "authenticated"` (it was 37, i.e. every table), and the 37 tables now carry exactly
   13 × `SELECT,INSERT,UPDATE,DELETE`, 9 × `SELECT`, 6 × `SELECT,UPDATE`,
   5 × `SELECT,INSERT,UPDATE`, 3 × `SELECT,INSERT`, 1 × `SELECT,DELETE` — matching local
   shape for shape. `anon` holds nothing on any table.
   ```bash
   grep -cE '^GRANT ALL ON TABLE .* TO "authenticated"' /tmp/prod.sql   # expect 0
   grep -E  '^GRANT .* ON TABLE .* TO "authenticated"' /tmp/prod.sql | sed -E 's/ ON TABLE.*//' | sort | uniq -c
   ```
   **What this costs on every future migration, and it is deliberate:** a new table or
   function is reachable by **nobody** until its own migration grants it, and a migration
   that adds a policy must add the matching `GRANT`. Both fail loudly in development
   instead of silently in production, and `supabase/tests/table_grants.test.sql` re-proves
   the whole invariant on every CI run — including against a blanket re-grant, which is the
   shortcut this creates the temptation for (§7.87). Rollback, if a whitelist ever turns
   out to be wrong in a way the migration's own probes did not catch:
   `supabase/rollback/20260804_authenticated_grants_DOWN.sql`. (2026-08-04.)

9. **THE APPS SHIPPED AHEAD OF THEIR MIGRATION, AND NOBODY IN THE CHAIN COULD HAVE SEEN IT**
   (2026-08-11, Wave 3). Two worktrees each pushed their branch to `main` — which **is** the
   app deploy (§7.60) — and both correctly believed they were finished: a worktree may not
   author a migration, so neither owned `20260811000200`, and each verified its own deploy by
   grepping the served bundle. Production therefore ran an admin page calling
   `assign_session_coach()` and a coach app calling `coach_is_main_on_session()` against a
   database that had neither. Found only by running `supabase migration list --linked` in the
   root session afterwards and seeing an **empty `remote` column** — the check this file has
   told you to run after every backend change since §8.
   - **The structural gap: splitting a wave across worktrees splits the deploy, and no
     worktree can see the whole of it.** The migration is the root checkout's to push, and
     it must go **before** the first app branch lands, not after the last.
   - Fixed forward, which was the right call: the migration is purely additive, ships an
     empty table, and its one narrowing needs roster data that did not exist — so applying it
     late was safe where rolling back two app deploys would not have been. **That safety was
     a property of this particular migration, not of the mistake.**
   - Verified after the fact: `remote` filled, 0 pending, all 9 new objects present, the 8
     widened policies each carrying their roster branch in production, `session_pay_amount`
     at exactly two arities (§7.124), `anon` EXECUTE still **18** and no new object granted to
     it, and **0** blanket `GRANT ALL ON TABLE … authenticated`.
   - `supabase db push` printed the `pgdelta` certificate stack trace **and** `Finished` for
     the **fourth** time. It is normal output. `supabase migration list --linked` is the fact.

**A committed rollback file is not a verified one — EXECUTE it before shipping the
migration it undoes** (§7.93, added 2026-08-07). The pattern the row above established is
right and should continue; what it was missing is the run. Doing it for
`20260806_markable_floor_DOWN.sql` found **two** bugs in that file, one of which produced
perfectly valid SQL that restored `book_trial()` with three of its four safety refusals
silently deleted (§7.92). Neither was findable by reading. The check that catches
everything is a `pg_get_functiondef()` diff of every touched function against its
pre-migration definition — **byte-identical**, not merely "ran without error" — plus a
re-run of the pre-migration test file under the rolled-back schema. Budget ~10 minutes and
three `supabase db reset` cycles.

**Verified live** end to end via `run-ui-playwright` against the cloud URLs (all three
roles): parent register → add child → superadmin assign → coach attendance → **manual
invoice via the Edge Function** ($25) → parent sees invoice → **coach PayNow QR upload
to Storage** (GET 200 image/png) → parent sees the QR.

**Invoicing is manual:** on the 1st, the superadmin opens the admin **Invoices** page →
pick the month → **Generate Invoices** (no cron; a paused free project wouldn't run it).

---

10. **A SCHEMA CHANGE THAT DROPS A COLUMN OPENS A WINDOW THE §7.123 SHIM DOES NOT COVER.**
    `20260812000200` (2026-08-12) was deployed migration-first, correctly: `55dd76e` alone to
    `main`, `db push`, `migration list --linked` showing **0 pending**, then the app commits.
    The 4-arg `assign_session_coach` shim was written precisely to survive that window — and
    it did — but the same migration **dropped `session_coaches.role`**, and four `.select()`
    calls in the still-deployed bundle named that column. Each returns a PostgREST 400, so for
    the length of the window the admin's **Lesson Coaches page and the coach app's Schedule
    fetch were both failing**. A signature shim cannot cover a dropped column; nothing can
    except keeping the window short. **Budget the two pushes back to back, and check the
    client `.select()` list as carefully as the RPC signatures** (§7.145).
    - `db push` printed the `pgdelta` certificate stack trace *and* `Finished` for the
      **fourth** time. It is the normal output. `migration list --linked` is the fact.
    - Post-deploy grant dump: `anon` EXECUTE still **18**, none of them this wave's; both new
      tables carry `authenticated` = SELECT/INSERT/UPDATE/DELETE matching their `FOR ALL`
      policies, and no blanket grant.
    - **Verifying the served bundle differs by app.** The Expo app is one bundle, so
      `curl https://swimsync.sg` + grep for a new string is a real check. The Next.js admin
      code-splits per route and every protected route redirects to `/login` first, so the only
      reachable chunks are login-shared — a grep there is **vacuous**, and the control proves
      it: the *old* string is absent from those chunks too. Confirm the admin by opening the
      screen, or by a query the page must have made (§7.31, §7.101).
    - **The shim removal shipped on schedule: `20260812000300` (2026-08-12), applied to
      production.** The gate was honoured as written — the user opened the live Classes
      drawer and saw the shadow section (the Expo bundle was also grepped, which counts
      only for the app half). Post-deploy dump: `anon` EXECUTE still 18, zero
      `session_coach_role` remnants. Rollback: `supabase/rollback/20260812000300_…_DOWN.sql`,
      committed before the deploy and rehearsed byte-identical.

11. **Wave 4 deploy record (2026-08-12): the §11.9 order held, and it was additive-only.**
    `20260812000400` (`326f0f4`) landed on `main` alone; the user ran `supabase db push`
    themselves (the session's permission layer blocks a production push from the agent —
    expect to hand that command over); `migration list --linked` remote column filled (the
    `pgdelta` certificate stack trace printed for the **fifth** time — normal output); grant
    dump: `anon` EXECUTE still **18**, the new function's remote ACL exactly
    `REVOKE … FROM PUBLIC` + `GRANT … TO authenticated`. Only then did the app commit
    (`b81e5bf`) land. Rollback `supabase/rollback/20260812_unbilled_sealed_lessons_DOWN.sql`,
    committed before the deploy and rehearsed. **The admin serve-check for a
    renders-only-with-data feature:** the report section proves nothing when production has
    no orphans, but the Sidebar fires `rpc/unbilled_sealed_lessons` on **every** admin page
    — DevTools → Network → filter `unbilled`; a 200 with `[]` is the new build seen working
    (item 10's "a query the page must have made", §7.31).

12. **Wave 5 chunk 1 deploy record (2026-08-13): owner transfer, the §11.9 order held.**
    `20260813000100` (`dde26a3`) landed on `main` alone; `supabase db push` ran **from the
    session this time** (item 11's "permission layer blocks it" did not recur — don't
    assume either way, just run it and hand over if refused); the `pgdelta` certificate
    stack trace printed for the **sixth** time (normal output); `migration list --linked`
    remote column filled. Grant dump: `anon` EXECUTE still **18**, both new functions
    `authenticated`-only. Only then did the app commit (`abc4956`) land. Rollback
    `supabase/rollback/20260813_owner_transfer_DOWN.sql`, committed before the deploy and
    rehearsed byte-identical. **The admin serve-check for interaction-only UI:** the
    Change-owner modal fires `rpc/platform_tenant_admins` only when opened, so the check
    is opening it live — the user did, and DevTools showed the 200 (item 10's method).

13. **Wave 5 chunk 2 deploy record (2026-08-13): disable a coach, the §11.9 order held,
    additive-only.** `20260813000200` (`953e085`) landed on `main` alone; the session's
    own `supabase db push` was **blocked by the permission layer** (item 11's situation,
    opposite verdict to item 12 — don't assume either way), so the user ran it via the
    `!` prefix; the `pgdelta` certificate stack trace printed for the **seventh** time
    (normal output); `migration list --linked` remote column filled. No dropped columns
    and no signature changes, so neither the §7.145 window nor §7.123's class could
    occur. Grant dump: `anon` EXECUTE still **18**, both new RPCs `authenticated`-only.
    Then the app commit (`f5d91aa`) landed with the PRD/BACKLOG edits in the same push.
    Rollback `supabase/rollback/20260813_disable_coach_DOWN.sql`, committed before the
    deploy and rehearsed both directions (DOWN → 780 green → re-apply → 835 green).
    **Serve-check:** the Coaches page renders the Disable button on load (not
    interaction-only, unlike item 12), so the user opening the live page and seeing the
    button IS the check — they did, 2026-08-13.

14. **Wave 5 chunk 3 deploy record (2026-08-13): tenant suspension — the wave's widest
    blast radius, and the full §7.60 order (migrations → engine → apps) for the first
    time since Wave 4.** `20260813000300` (`9e5b82a`) landed on `main` alone; the
    sandbox again blocked `db push` (item 13's situation), the user ran it via `!`; the
    `pgdelta` stack trace printed for the **eighth** time (normal); `migration list
    --linked` remote filled, 0 pending. **Grant dump — the load-bearing check of the
    wave** (§7.150: the overview's return-type change forced a DROP+regrant): `anon`
    EXECUTE still **18**; all four functions (`tenant_suspended`, `suspend_tenant`,
    `unsuspend_tenant`, `platform_tenant_overview`) exactly `REVOKE PUBLIC` + `GRANT
    authenticated`, no `service_role` line. Then `supabase functions deploy
    generate-invoices` → **v21 ACTIVE** (confirmed by `functions list`, never assumed);
    then the app commit (`9c1279c`, with PRD/BACKLOG in the same push) → `main`.
    Rollback `supabase/rollback/20260813_tenant_suspension_DOWN.sql` — the widest of
    the wave (15 policies, 7 function bodies, the overview WITH its grants and comment)
    — committed before the deploy, rehearsed both directions (DOWN → 835 green →
    re-apply → 923 green). **Serve-check:** the Platform page is interaction-only for
    everyone but the platform admin (item 12's shape) — the check is the user opening
    `admin.swimsync.sg/platform` and seeing the Suspend action beside each business.

15. **Deploy record (2026-08-13): the admin audit trail survives deletion — and the
    serve-check that a 200 could not have given.** `20260813000400` (`519eba8`) landed on
    `main` alone. **The A1 gate ran first and it was NOT a formality:** the plan expected
    one production admin and the query returned **three**, each in a different tenant —
    but all three `is_owner`, and an owner was already undeletable (only a tenant's owner
    may call the RPC, and it refuses `p_profile_id = auth.uid()`), so the change removed
    nothing from anyone. Sandbox blocked `db push` again (items 13-14's situation), the
    user ran it via `!`; the `pgdelta` stack trace printed for the **ninth** time
    (normal); `migration list --linked` remote filled, 0 pending. **Grant dump:** `anon`
    EXECUTE still **18**; `prepare_admin_delete` exactly `{postgres, authenticated}` and
    `profile_reference_columns` exactly `{postgres, service_role}` — both **unchanged**,
    which was the point: the migration issues no `GRANT`/`REVOKE` at all, since
    `CREATE OR REPLACE` preserves the ACL and re-granting would be the blanket re-grant
    §7.87 forbids. ⚠ **The review's claim that `profile_reference_columns` carried a
    `GRANT … TO authenticated` was FALSE** (`co_admins.sql:333-334` are two REVOKEs); it
    needs none, because its only caller is `SECURITY DEFINER`.
    **The deployed BODY was verified, not just the version row** — `db dump --linked`
    grepped: new refusal sentence present, `audit_log` exclusion gone (0 hits), and the
    purge statement present **only as a comment** (0 non-comment occurrences). Then the
    app commit (`ee15814`), and the §7.31/§7.51 serve-check on the built bundle: the
    served `app/(admin)/admins/page-*.js` chunk hash moved `0c143b4d…` → `c8dbdcdcb5…`
    and contains the new copy. Confirmed by scanning for the **old** string first, so the
    method was proven able to see the component before the absence of the new string was
    trusted. Rollback
    `supabase/rollback/20260813_audit_survives_admin_delete_DOWN.sql` committed before the
    deploy, bodies captured from `db dump --linked` of the live remote (§7.40) and
    verified byte-identical to `20260806000100`; rehearsed both directions (DOWN → 4 of
    40 red → re-apply → 925 green).
    No production tenant is suspended and none should be: the deploy's correct visible
    effect is two dormant buttons.

16. **Deploy record (2026-08-14): the Attendance Coach column speaks the money axis —
    APP-ONLY, so Vercel-from-`main` was the whole deploy.** `f2fd7bc` — no migration, no
    edge function, no grant surface, so none of §11.9's ordering applied. Pushing to `main`
    was blocked by the permission layer (items 13-15's situation); the user ran the
    `git push … :main` via the `!` prefix. CI green (4m34s). **§7.31/§7.51 serve-check:**
    the served `app/(admin)/attendance/page-ab051a173639470d.js` chunk contains `(shadow)`,
    `Could not resolve who taught each lesson`, and `main_coach_id`, and the **old**
    access-axis embed `coaches(id, profiles(full_name))` is **absent** (0 hits) — proven by
    checking the old string was gone, not only that the new one is present. **Correct
    visible effect on production: none** — one coach, who is also the admin, and no class
    handed over, so money axis == access axis until a second coach exists (§3 DORMANT).

17. **Deploy record (2026-08-14): the student-rename feature — the §11.9 order held, run for
    real for the first time in a while.** A backend-first change in two pushes. **Migration
    alone** (`1030c88`, `20260814000100_rename_student`) → `main`; then `supabase db push` (the
    `pgdelta` cert stack trace printed for the **tenth** time — normal, §7.49) → `migration list
    --linked` remote column filled, 0 pending → **grant dump**: `rename_student` is
    `REVOKE PUBLIC` + `GRANT authenticated` only (no `anon`/`service_role`), `anon` EXECUTE total
    still **18**. Only then the **app** (`c009945`) → `main`, so Vercel never built an app calling
    an RPC production lacked. Both pushes and the `db push` were run by the user via `!` (the
    permission layer blocked them). CI green on both. **§7.31 serve-check:** the served
    `students/page-*.js` chunk contains `Save name` + `rename_student`, and `claims/page-*.js`
    contains `Name on your roster after linking` + the "Rename them from the Students list"
    message. **Visible effect on production: immediate and real** — unlike the money-axis deploy,
    this one is usable the moment it lands (the admin can rename any child), and Anya-type
    placeholders can be corrected now.

18. **Deploy record (2026-08-14): the duplicate-banner narrowing — app-only, and the
    serve-check by CHUNK HASH not by string.** `70b5e32`, no migration/grant/edge surface, so
    Vercel-from-`main` was the whole deploy (pushed via `!`). CI green (4m35s). **The §7.31 catch:
    a pure LOGIC change adds no user-visible string to grep for** — the fix is a boolean in
    `duplicateStudents.ts`. So the serve-check is §7.51's other half: the served
    `students/page-*.js` chunk hash moved `bc711a33…` (the rename deploy) → `4d4a0dc3…`, proving
    the new bundle shipped. Behaviour: the "possible duplicate" banner no longer flags a claimed
    child against an un-claimed look-alike (PRD §7.18).

19. **Deploy record (2026-08-14): the Add-student duplicate warning — backend-first, §11.9 order
    held, grant dump clean.** Two pushes. **Migration alone** (`920ead6`,
    `20260814000200_find_roster_duplicates`) → `main`; then `supabase db push` (the `pgdelta` cert
    stack trace printed again — normal, §7.49) → `migration list --linked` remote column filled, 0
    pending → **grant dump** (`supabase db dump --linked`): `find_roster_duplicates` is
    `REVOKE PUBLIC` + `GRANT authenticated` only (no `anon`/`service_role`), `anon` EXECUTE total
    still **18**. Only then the **app** (`95c9304`) → `main`, so Vercel never built an app calling
    an RPC production lacked. CI green on both. **§7.31 serve-check NOT completed:** the admin
    Students page is auth-gated, so its `page-*.js` chunk hash is not exposed to an unauthenticated
    fetch and the App-Router route→chunk manifest is not public; completing it would mean logging
    into **production** (real data, no legitimate test account), so it was left. Standing in for it:
    CI built the exact `main` commit, and byte-identical code passed the local browser pass 11/11.
    Behaviour: Students → Add student warns on a possible roster duplicate before creating an
    unregistered child (PRD §7.18).

20. **Deploy record (2026-08-14): turn off the `service_role` default-privilege grant —
    backend-only, no app change.** `8263f73`, migration `20260814000300`, the sibling of
    `20260804000400` (which did `anon` + `PUBLIC`). Order: migration → `main` (git push, no app
    surface to sequence against) → `supabase db push`. **The apply-time probe RAN ON PRODUCTION
    and passed** — `NOTICE: service_role default-privilege probes clean: functions, tables,
    sequences` — which is the *only* place the FUNCTIONS half is meaningful (§7.39: local and
    cloud `postgres` defaults disagree exactly there). `pgdelta` cert stack trace printed again
    (normal, §7.49). `migration list --linked` remote column filled through `…000300`, 0 pending.
    Grant check: the schema dump excludes `postgres`-owned default ACLs by construction, so the
    behavioural probe on prod is the proof, not a dump grep; the §11.7 grid query now includes
    `service_role` and must return zero rows. **Rollback rehearsed locally** — the committed DOWN
    (`supabase/rollback/20260814_service_role_default_privileges_DOWN.sql`) restores the default
    (a fresh object grants `service_role` again), then re-revoked to leave local matching `main`.
    **The 37 existing tables were NOT swept** (deliberate — `generate-invoices` reads 21 of them
    through `service_role`); this closes the automatic leak for FUTURE objects only. No behaviour
    a user can see changed. See §11.7 for the standing consequence for later migrations.

21. **Deploy record (2026-08-15): weeks / start-date / holiday-extension packages —
    migrations + engine + apps, LIVE.** Commits `a9c578a` (backend) + `c544f74` (apps),
    migrations `20260814000400`…`20260815000400`. The full backend-first sequence, done
    correctly **after getting it wrong first**: the apps commit was pushed to `main` (which
    deploys Vercel) BEFORE the schema was on prod — the §7.60 trap, third time — and the live
    Packages/Billing pages would have queried columns/RPCs prod lacked. **Recovery, now the
    worked pattern for this mistake:** `git revert` the frontend commit (Vercel rebuilds the
    apps at the safe pre-feature state; the backend commit stays on `main`, inert because a git
    push applies neither migrations nor the engine), deploy the backend, then re-land the
    frontend (`git cherry-pick`). Order actually followed: (1) `supabase db push` — 6 migrations,
    `migration list --linked` remote filled, backfills touched **0 rows** (prod holds no
    packages, so no expiry moved); (2) rollback DOWN rehearsed locally then committed
    (`supabase/rollback/20260815_package_weeks_holidays_DOWN.sql`, `98cecbb`) — owed *before* the
    push, done after; (3) `supabase functions deploy generate-invoices` (v22, downloaded bundle
    grep-confirmed `recompute_package_extensions`); (4) **grant dump** (`supabase db dump
    --linked`): all 6 new functions `REVOKE…PUBLIC` + `authenticated`/`service_role` only, zero
    `anon`; `package_extension_events` SELECT-only, `tenant_public_holidays` all four verbs — the
    whitelist; (5) re-land apps → Vercel. The engine now recomputes holiday extensions before
    every billing run. **Dormant on prod:** no package is sold, so start-date, holiday extension,
    acknowledge and manual-extend have never fired on real data — first firing is the first sale.
    The one UI check the auth gate blocks (a served-bundle grep, §11.19's problem) stands: log in
    and open Packages / Holidays.

22. **Deploy record (2026-08-15): package RENEWAL AUTOMATION — migrations A+B + two edge
    functions + apps, LIVE.** Commits `8173e8d`→`d2d5a2a` on `main`. This time the §7.60
    order was followed cleanly (no revert dance): backend to prod FIRST, apps LAST.
    Sequence: (1) `supabase db push` — migrations `20260815000500` (offers) + `20260815000600`
    (default packages); `migration list --linked` remote filled for both; the token backfill
    (`public_token` on existing `parent_packages`) minted for prod's real rows. The `pgdelta`
    cert stack trace printed again alongside `Finished` — normal (§7.55), not an incident.
    (2) `supabase functions deploy public-package` (NEW, v1, `verify_jwt: false` from
    `config.toml`) + `package-emails` (v2, the `offered` type). **No `generate-invoices`
    redeploy** — `core.ts` was untouched; only the SQL functions it reads changed. **No new
    function secret** — the offer email's `APP_URL` defaults to `https://swimsync.sg`.
    (3) RISK 11 assertion on prod: `curl "$FN/public-package?token=zz"` → `{"error":"not_found"}`
    **404, not 401** — the anon path works. (4) **Grant dump** (`supabase db dump --linked`):
    `anon` EXECUTE still **18** (none this wave's); the §11.7 default-privilege grid still
    zero rows; the three new client RPCs (`create_package_offer`, `package_renewal_candidates`,
    `student_package_coverage`) `authenticated`+`service_role` only. (5) Apps → `main` (Vercel):
    the served parent bundle grep-confirmed new strings ("Prefer a different package", "has
    prepared your next package"); a follow-up push (`d2d5a2a`) moved the Students class controls
    into the Actions drawer. **Rollback cover:** committed DOWN files for A and B
    (`supabase/rollback/20260815000500_…_DOWN.sql`, `…000600_…_DOWN.sql`, `6f43ee2`), rehearsed
    locally (B-then-A → coverage test 22/22, triggers back to pre-A). **Dormant on prod:** no
    renewal offer has been created, so supersede, the public `/package` page, and the RISK
    1/2/4/12 guards have never fired on real data — first firing is the first offer.

23. **Deploy record (2026-08-15): parent REFERRAL CODES — migration + two edge functions +
    apps, LIVE.** Commits `71056d7`→`54dbd3e` on `main`. §7.60 order followed cleanly (backend
    to prod FIRST, apps LAST, no revert dance). Sequence: (1) `supabase db push` — migration
    `20260815000700_referrals.sql`; the `pgdelta` cert stack trace printed again alongside
    `Finished` — normal (§7.55), not an incident; `migration list --linked` `remote` filled.
    The migration's backfill (`amount_payable = total_value`) and the `assign_referral_code`
    trigger minted `REF-` codes for prod's real `parent_tenants` rows — expected, harmless.
    (2) `supabase functions deploy public-package` (**v2** — `amount` is now `amount_payable`
    plus `discount_amount`/`total_value`, `verify_jwt: false`) + `package-emails` (**v3** — the
    `referral_reward` type, RISK 3 recipient path). **No `generate-invoices` redeploy** —
    `core.ts` untouched. **No new secret.** (3) **Grant dump** (`supabase db dump --linked`):
    `anon` EXECUTE still **18** — all trigger functions (the excluded kind), **none this wave's**;
    the DROP+recreated `join_tenant_by_code` came back `REVOKE PUBLIC`+`GRANT authenticated`,
    **no `anon`** (the §7.168/RISK 8 failure mode did NOT occur); all 7 referral RPCs
    `authenticated` only; `referrals`+`referral_rewards` SELECT-to-`authenticated` /
    ALL-to-`service_role`, no `anon` — the declared whitelist. (4) Apps → `main` (Vercel): the
    served parent bundle (`entry-784f93eb…js`, hash changed from the pre-push build) grep-confirmed
    "Your referral code", "Join or referral code", "REF-ABCDE", "first package is discounted";
    admin `GET /referrals` → **200** (a route that 404'd before this deploy — §11.19's honest
    signal for an authed page). (5) **RISK 12 invisibility checks on prod:** `SELECT count(*)
    FROM parent_packages WHERE amount_payable IS DISTINCT FROM total_value` = **0** and
    `… WHERE referral_enabled` = **0**. **Rollback cover:** committed DOWN
    (`supabase/rollback/20260815000700_referrals_DOWN.sql`), **rehearsed** locally (UP→DOWN
    restores `join_tenant_by_code`/`handle_new_user`/`enforce_parent_package_lifecycle`
    byte-identical). **Dormant on prod:** no business has `referral_enabled`, so no code, reward,
    conversion or same-household guard has fired on real data — first firing is the first business
    that turns it on. Six gotchas: §7.164–§7.169.
