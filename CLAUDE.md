# SwimSync

Swim-coach attendance & billing app for Singapore. **Multi-tenant** — a tenant is a
business; a private coach is a tenant of one. Three roles: **parent** (mobile),
**coach** (mobile), **tenant admin** (web), plus a cross-tenant **platform admin**.

Live: app **https://swimsync.sg** · admin **https://admin.swimsync.sg** (Vercel),
backend on Supabase, email via Resend.

## Where the code is

| Path | What |
|---|---|
| `SwimSyncApp/` | Expo / React Native — parent + coach. Runs on web too (RN-web). |
| `SwimSyncAdmin/` | Next.js admin panel — tenant admin + platform admin |
| `supabase/migrations/` | **The schema's source of truth.** Never edit an applied migration. |
| `supabase/functions/generate-invoices/` | The billing engine. `core.ts` is pure; `index.ts` is the handler. |
| `.claude/skills/run-ui-playwright/drivers/` | End-to-end UI drivers |

## Commands

```bash
supabase start                    # Docker must be running
supabase db reset                 # migrations + seed — WIPES test data
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt

cd SwimSyncAdmin && npm run dev    # :3000
cd SwimSyncApp   && npx expo start # press w for web

supabase test db                                    # pgTAP
supabase/functions/generate-invoices/test.sh        # Deno — RUN IT TWICE (see below)
cd SwimSyncAdmin && npm test                        # vitest
cd SwimSyncApp   && npm test                        # jest-expo
cd <app> && npm run typecheck                       # tsc --noEmit, enforced in CI
.claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh  # UI fixtures, in CI
.claude/skills/run-ui-playwright/drivers/run-all-drivers.sh  # ALL UI drivers (nightly CI) — resets the DB per driver; never beside a worktree
```

Full setup, seed logins and test flows: **`LOCAL_DEV_GUIDE.md`**.

## Documentation map

Read `HANDOVER.md` first — it is the index, and it points at everything else. Fetch a
document when the task touches it; don't read them all up front.

| Question | File |
|---|---|
| What state am I inheriting? What's next? | `HANDOVER.md` |
| What does the product do today? | `PRD.md` |
| What's queued but unbuilt, and why? | `BACKLOG.md` |
| **What trap is waiting for me here?** | **`docs/GOTCHAS.md` (§7)** |
| Why is it built this way? | `docs/ARCHITECTURE.md` (§6, §10, §12) |
| What do the tests cover? | `docs/TESTING.md` (§5) |
| What's live, and how? | `docs/DEPLOYMENT.md` (§11) |
| **Working in a worktree / two sessions at once** | **`docs/WORKTREES.md`** |
| How do I bill a month? | `INVOICE_RUNBOOK.md` |

**Section numbers are permanent identifiers.** `§7.41` means gotcha 41 wherever it lives —
781 references cite them by bare number, including from applied migrations. Never renumber.

## Rules that bite

These are the few worth carrying always. The rest are in `docs/GOTCHAS.md`; read it before
touching an unfamiliar subsystem.

**Deploying**
- **`git push … :main` IS the app deploy** — Vercel builds both web apps from `main`. For a
  backend-first change the order is **migrations → engine → apps**, so land on `main`
  *last*. (§7.60 — got wrong twice.)
- **A git push does NOT deploy Edge Functions.** `supabase functions deploy <name>`, one at
  a time. Confirm with `supabase functions list`, never assume.
- **A 200 proves nothing.** Grep the served bundle for a user-visible string only the new
  build has. (§7.31, §7.51)

**Dates — this shipped a real double-billing bug**
- **`new Date().toISOString().split("T")[0]` is wrong in SGT** — that's the UTC date, a day
  behind before 08:00. Pairing it with a local `getDay()` lets weekday and date disagree.
  Use `todayInSg()` + `dayOfWeekOf()`. (§7.7)
- **`getHours()` is the same bug on a different axis**, and it was live until 2026-07-26.
  Time of day comes from `nowMinutesInSg()` (`SwimSyncApp/lib/timeOfDay.ts`); functions that
  compare times take a plain number so they cannot read a clock at all. (§7.7)

**Billing — the guards are load-bearing, not friction**
- **Never add an override** to the unmarked-attendance block or the completed-month guard.
  Both were considered and refused; an override can only ever produce a permanent underbill.
  A lesson that didn't run is marked *cancelled*, not skipped.
- **Run the Deno suite twice.** A completing run *seals* its billing month, so leaked state
  makes the second run short-circuit — passing once proves nothing. (§7.15)

**Database**
- Expand/contract, **one schema change in flight at a time**. Write migrations on a short
  `db/…` branch, apply, `supabase test db`, merge before anything depends on them.
- **A new function or table is callable by NOBODY until its own migration grants it**, and
  a migration that adds a **policy** must add the matching `GRANT` or the app throws
  `permission denied` in dev. Deliberate, since 2026-08-04: `authenticated` holds a table
  privilege only where a policy could permit it. **Never "fix" that with a blanket
  re-grant** — `supabase/tests/table_grants.test.sql` goes red on any privilege no policy
  permits. (§7.87)
- **Still take a remote grant dump after touching privileges.** Local and cloud disagree by
  construction, and three migrations in one day each closed a different cell of the
  role × object-type grid while every probe passed. (§7.39, §7.89, `docs/DEPLOYMENT.md` §11.7)
- A `BEFORE INSERT` trigger **also fires for rows that resolve to an UPDATE** via
  `.upsert()`. Detect the update inside the trigger. (§7.57)

**React Native web**
- **`Alert.alert` is a no-op on RN-web** — it silently does nothing on the deployed app.
  Use `confirmAction` / the global Toast / inline errors.
- A previous screen stays mounted and can physically overlay the current one, so
  `click({force:true})` presses the wrong element. (§7.10, §7.58)

## Conventions

- **Single `main` branch.** Feature branch → implement → verify → merge → push → delete the
  branch. No PRs unless asked.
- **Worktrees share one database and one set of documents.** A worktree **never authors a
  migration** — write it in the root checkout on a `db/…` branch, land it on `main`, then
  merge to consume it. No worktree edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`; findings
  are collected and written from `main` at close. Never `supabase db reset` while a sibling
  is running. Full sequence and two worked examples: `docs/WORKTREES.md`.
- **Tests must be proven to fail without the fix** before they count as coverage. (§7.25)
- The **test runner is the fact**; any count written in prose is a hint that has drifted.
- Documentation lanes: `PRD.md` = what exists · `BACKLOG.md` = what doesn't yet ·
  `HANDOVER.md` = the state you're inheriting. A feature idea goes in `BACKLOG.md`, never
  in the PRD or in HANDOVER §9.
- Run `/session-start` to orient, `/commit-review` to ship each change, `/update-docs` near
  the end. Running two sessions in parallel: `/worktree-start` (after planning) and
  `/worktree-close` (**before** `/update-docs`). See `01_SESSION_WORKFLOW.md`.
