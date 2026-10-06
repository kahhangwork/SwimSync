# Worktree — Wave 8 lane2: admin panel cast removal

**Branch:** wave8/admin · **Base:** main @ f937c65 · **Started:** 2026-10-06
**Plan:** docs/plans/WAVE8_GENERATED_TYPES_PLAN.md (lane2, RISK 9) · **Backlog:** Build order → Generate real Supabase `Database` types
**Sibling:** root checkout = lane1 (coach/parent app, `SwimSyncApp/**`).

## I own
- `supabase/` — **NO** (no migration in flight; a fix that needs one goes to ROOT by message)
- `SwimSyncAdmin/**` — EXCEPT `SwimSyncAdmin/lib/database.types.ts` (root regenerates it)
- `SwimSyncAdmin/lib/database.overrides.ts` and `SwimSyncAdmin/.db-any-allowance` (RISK 9)

## Order (largest first)
assessment, lessons, packages, wages, makeups, students, unassigned, trials, referrals,
coaches, classes, platform → parents, levels, invoices, attendance, locations, substitutes,
dashboard, admins, history, credit-notes, accounting, lib/calendarData.ts, lib/billingMonths.ts
→ LAST: `app/api/*` + `lib/adminManagementGate.ts` + `lib/staffInvitation.ts` (§7.289 boundary:
runtime change there runs `supabase/tests/http/signup_trust.sh` + `--only tenant-provisioning`,
and NEVER changes who can mint a `staff_invitations` row).

Also (user decision, option A): replace each of the 11 `// … NOT A GUARD (Wave 8, option A …)`
`!` sites with an explicit guard + message — each a `fix(wave8)` with a Bug-ledger row,
failing-first test and its `--only` driver.

## Rules (from the plan — read it whole first)
- `types(wave8)` only if `scripts/check-runtime-identical.sh <base>` exits 0; anything else is
  `fix(wave8)`. Never mix the two in one commit.
- Never delete a `?.`/`??`/normaliser on an embed; embed access changes need a real-PostgREST
  probe (row present AND RLS-hidden) in the commit message (§7.344).
- Keep hand-written required-key `*Args` types + `_Check` assert (§7.345). `fromJson` is the only
  Json narrowing; other narrowing casts get `// census: ui-cast (Wave 8) — <why>`.
- Money folders (invoices, credit-notes, accounting, wages, packages): chain-recorder repo test
  (§7.314) + PostgREST probe, and a second read of every changed line.
- Lower the allowance in the same commit (`scripts/check-db-any.sh --update`).
- Before every merge: `git diff --name-only main...HEAD` lists only `SwimSyncAdmin/**`, not
  `SwimSyncAdmin/lib/database.types.ts`. BOTH apps' typecheck + tests green; G5 (from root —
  ask), G6, runtime-identity green; latest main CI green. WIP-commit before any `git reset`.
- Never regenerate types, never author a migration, never work around a blocked override with
  a cast — leave the `any` (G6 keeps counting it) and message root.

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md`, `docs/**` (the plan's Bug ledger: send rows to root)
- `scripts/**`, `.github/**`, `supabase/**`, `CLAUDE.md` — root-only
- `SwimSyncApp/**` — lane1
- `drivers/lib.mjs`, `supabase/config.toml` — shared
- `lib/lessonDates.ts`, `attendanceCompleteness.ts` copies, and the twins drift-pinned with the
  app (`studentStatus.ts`, `attendancePayload.ts`, …) — an edit needs the app twin too → root

## Ports / database
- Admin dev **:3100**, Expo **:8082** (root holds 3000 / 8081). `verify-app-auth` cannot run here (§7.268).
- **The shared DB is owned by: ROOT (lane1)** until the user says otherwise. Ask before any
  `--only` driver run (each resets the DB).

## Fixture prefix
`wt-wave8-admin-`

## To graduate at session close (from the ROOT checkout, on main)
- **GOTCHA — a worktree's `origin/main` moves when root pushes (refs are shared).** Incident C,
  2026-10-06: `git checkout -b wave8/admin-wages origin/main` landed on root's freshly pushed 026e6a7, yet
  the WIP commit that followed staged the PRE-lessons versions of 5 lessons files plus 3 allowance lines,
  so it would have reverted root's merged lessons commit. Caught in `git status` before it left the
  worktree; rebuilt with `git checkout <wip> -- <own folder>`. Likely cause (lane1): the shared refs moved
  origin/main while the working tree still held the older files. Two more faces of it: `G6_BASE=origin/main
  scripts/check-db-any.sh` suddenly reports "raises" for folders root just merged, and a branch's base is
  silently stale. Rules: `git diff --cached --name-only` before EVERY commit (WIP too); never `git add` a
  folder you don't own; when G6 "raises" someone else's folder, `git fetch` + rebase (resolve the
  allowance with main's file + `scripts/check-db-any.sh --update`), never edit the allowance by hand.
- **GOTCHA — deleting `SwimSyncAdmin/.next` or running `npm run build` under a live `next dev` 500s every
  page.** 6 drivers failed "0/44" until lane1 restarted the dev server. CAUSE (lane1, verified): lane1 ran
  `rm -rf SwimSyncAdmin/.next` + `npm run build` in the ROOT checkout while root's `next dev` (the driver
  server) was live — the dev log showed ENOENT on `.next/server/vendor-chunks/…` and `/login` 500. Not
  lane2's worktree build (a different checkout). Rule: never build or delete `.next` under a live
  `next dev`; stop it first, or restart it after. A stale half-written `.next/types` also makes `tsc`
  report "routes.d.ts is not a module" — delete `.next/types` only, with no dev server running.
- **GOTCHA — check-runtime-identical.sh treats ANY new file under `app/` as a runtime change** (Next routes
  by file). A route's response type therefore lives IN its route.ts as an `export type` (erased; `next build`
  accepts it), not in a sibling types.ts (API-routes unit, 682a38d).
- **GOTCHA — `toSgDate()` edges (checked before the credit-notes fix):** `toSgDate(null)` silently returns
  "1970-01-01"; `undefined` / `""` THROW "Invalid time value". Guard with a truthy check before calling it
  on a nullable column (Bug ledger #3, §7.229).
- **Idiom (both apps):** the dao exports row types — `DataOf<typeof fn>[number]`, and `RlsNullable<Row,
  "embed">` on every LEFT to-one embed (never on `!inner`). A `Promise.all` dao uses
  `Awaited<ReturnType<…>>[i]["data"]` (lessons). An existing Array.isArray normaliser is typed
  `P | P[] | null` even though PostgREST returns object-or-null (wages/packages probes). Empty fallbacks
  `[] as XRow[]`. Test fixtures may use `as any`. A `${x}` select whose x is a union of literals still
  parses (no §7.106 GenericStringError: students, invoices, credit-notes). A generated RETURNS TABLE row is
  all-non-null; widen it when the function returns NULL (accounting_summary).
- **fromJson's first use:** lib/billingMonths.ts `fromJson<RunBlockingLesson[] | null>(r.blocking,
  "billing_runs.blocking")` (+ unclaimed_students). For a jsonb COLUMN the engine writes, `source` =
  "<table>.<column>" (for an RPC result it stays the SQL function name). check-runtime-identical.sh erases
  `fromJson(x, "lit")` → `x`, so it is types-only (48a16f0).
- **PRD (copy changes) — the 11 NOT-A-GUARD sites, Wave 8.** A write by an admin with no business
  (signed out, or a profile with no tenant_id) is no longer sent; the page shows instead
  `NO_TENANT_MESSAGE` (SwimSyncAdmin/lib/noTenant.ts) = "Your account isn't linked to a business, so
  nothing was saved. Sign out and back in, then try again." Old → new:
  - Holidays, add: "Could not add that holiday." → NO_TENANT_MESSAGE
  - Holidays, CSV import: "Could not import that file." → NO_TENANT_MESSAGE
  - Invoices, orphan-lesson settle: Postgres's own error text → NO_TENANT_MESSAGE
  - Invoices, unclaimed settle, signed out: Postgres's own error text → NO_TENANT_MESSAGE
  - Invoices, unclaimed settle, child row unreadable: Postgres's own error text → "That child's record
    couldn't be found, so nothing was saved. Refresh the page and try again."
  - Levels, create level: "Could not save. Please try again." → NO_TENANT_MESSAGE
  - Levels, add grade: "Could not add that grade." → NO_TENANT_MESSAGE
  - Locations, create: "Could not save. Please try again." → NO_TENANT_MESSAGE
  - Packages, add category: "Could not add that category." → NO_TENANT_MESSAGE
  - Packages, create package: "Could not create the package." → NO_TENANT_MESSAGE
  - Trials, save trial price: Postgres's own error text → NO_TENANT_MESSAGE
  - Students, package settings (a READ): no copy change — the doomed `id=eq.undefined` request is not sent.
  Merged 6f24eea; drivers green (smoke-admin 64/64, money-admin 44/44, levels 9/9, locations 6/6,
  packages-admin 56/56, student-identity 13/13, trials 16/16).
- **PRD (date fixes):** Credit Notes table + CSV and the admin Claims page now show the SINGAPORE date of a
  timestamptz (were the UTC date — a day early 00:00–07:59 SGT). Bug ledger #3 and #5.
- **Observation (lane1: not a ledger row — signed-out only, no write):** trials/useTrials.ts loadAll() sends
  `repo.profileTenant(auth.user?.id ?? "")`, an `id=eq.` read PostgREST rejects when signed out. Same
  class as NOT-A-GUARD site 10 but a `??`, not a `!`.

## Added by lane1 at close (root session) — items not in lane2's list
- **Bug ledger #2 → PRD + ARCHITECTURE §6:** a coach now sees a child they TAUGHT (any enrolment, active or
  closed, in a class they own or are rostered on) — migration 20261006000600_coach_sees_past_pupils (ADD:
  `coach_taught_student()` + one `students_select` arm). Read-only: `coach_serves_student` (write
  authority) untouched. Fixes the coach marking screen hanging on a removed child's past lesson. On prod
  (#77 in DEPLOYMENT's numbering — check), grants dumped clean.
- **Bug ledger #4 → PRD:** the parent Home "Waiting since" date on a pending claim is the SGT day.
- **GOTCHA — PostgREST returns every timestamptz in UTC (`…+00:00`)**, so `.split("T")[0]` / `.slice(0, 10)`
  is the UTC date (Bug ledger #3/#4/#5, all found by the Wave 8 probes). A test fixture written with
  `+08:00` passes for the wrong reason (§7.25) — write fixtures in the shape PostgREST sends. Candidate
  for a G-guard (grep both apps for the two patterns on a `*_at` field).
- **GOTCHA — RLS on an embedded table can be NARROWER than on its parent row** (Bug ledger #2): a visible
  enrolment embedded `students: null`. A bare embed access (`e.students.id`) is only safe with a POLICY
  proof that the embed is visible whenever the parent row is; compare both tables' pg_policies.
- **GOTCHA — `grep -c` exits 1 on a zero count**, so `… | grep -c "error TS" && git push` never pushes on a
  clean tsc (a merge silently didn't land, caught by checking origin/main). Use `; true` or compare text.
- **TESTING §5:** new suites — supabase/tests/coach_past_pupils.test.sql; chain-recorder repo tests for
  invoice-detail, billing, parent-home, coach-pay (app) and invoices/credit-notes/accounting/packages/wages
  (admin); the guards scripts (G5, G6, overrides, runtime-identity) with their proofs in commit messages.
- **F0 hardening (two independent Opus reviews)** is in commits 0f26dd0, 8ef1ad0, 8545551, f937c65 —
  ARCHITECTURE §6 should describe the four guards and their known blind spots (trigger-fill.sql header).
- **Census:** App allowance = 8 `db-any-ok` (icon ×6, href, catch); Admin = 3 (Table generic, auth-callback
  ×2). `census: ui-cast (Wave 8)` markers: 14 non-test sites (`git grep -n "census: ui-cast"`).
- **Not done:** the first scheduled nightly over Wave 8 is still unread (user skipped the merge gate);
  read it, never dispatch.
