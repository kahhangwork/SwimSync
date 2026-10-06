# Wave 8 — Generated Supabase `Database` types

_Status: NOT STARTED · planned 2026-10-06 (`/plan-with-confidence`) · hardened by `/plan-review` 2026-10-06 · BACKLOG → *Generate real Supabase `Database` types*_

## What this builds, and why

Both apps call `createClient(...)` with no `Database` generic, so supabase-js cannot know what a query returns. Every
result is `any`, and the code says so ~380 times (`as any` / `: any`, non-test, tracked files). The compiler checks
none of it.

Example, live today: `attendance.repo.ts:33` selects `profiles(full_name)` and `attendanceRows.ts:9` reads
`c.profiles?.full_name ?? "Unknown"` through `as any[]`. Rename the column and typecheck stays green, CI stays green,
and every coach in the Attendance filter renders as "Unknown". With generated types that rename is a compile error.

The same applies to RPC arguments: a misspelled `p_class_id` compiles today and fails only when a user presses the
button (§7.123 was that kind of live break).

**No user-visible change is intended.** Bugs the wave uncovers ARE fixed (D4), and each such fix is user-visible and
recorded.

## Decisions settled with the user (2026-10-06) — do not reopen

| # | Decision | Answer |
|---|---|---|
| D1 | Depth | **Foundation + remove every `any` that carries database data**, both apps |
| D2 | Edge functions | **Out.** Apps only — the engine keeps its hand-written types and its Deno ×2 suite |
| D3 | Staleness check | **Fails the build** (G5), like G1–G4 |
| D4 | Bugs the types expose | **Fix every one in-wave** (failing test first, §7.25) |
| D5 | Shipping | **Feature folder by feature folder** to `main`; first app merge waits on the nightly read (§7.1 gate) |
| D6 | Lanes | **Two** — root (foundation + coach app), worktree `wave8-admin` (admin panel) |

Made by the planner (reversible, stated so they are not re-litigated by accident):
- Types are generated from the **local** DB (`--local --schema public`). Migrations are the schema's source of truth;
  prod is migration-identical (0 pending).
- **One generated file per app**, `lib/database.types.ts` — the apps share no package (BACKLOG *Deliberately not
  doing*: shared `lessonDates.ts`, no workspaces). Both are byte-identical; G5 checks both.
- **Out of scope:** casts in test files (mocks use `any` deliberately); non-database `any` (Ionicons names, router
  hrefs, `onAuthStateChange` callback). These are listed in the closing census with a one-word reason, not removed.

## Baseline (measured 2026-10-06, `git ls-files`, non-test)

| | App | Admin |
|---|---|---|
| `as any` | 52 | 70 |
| `: any` | 122 | 135 |
| `as unknown as` | 1 (both apps) | |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0 |
| files with `.from("`/`.rpc(` | 32 | 71 |
| **tsc errors from wiring the generic alone (spike)** | **13 in 8 files** | **35 in ~20 files** |
| supabase-js / postgrest-js / typescript (lockfile) | 2.98.0 / 2.98.0 / 5.9.3 | 2.98.0 / 2.98.0 / 5.9.3 |
| local Supabase CLI | 2.109.1 | |
| `user_role` enum (live DB) | `parent, coach, superadmin, platform_admin, tenant_admin` | |
| STRICT public functions | 0 of 229 | |

The spike count is a floor: most results flow into `any` and stay unchecked until the casts come out.
Spike error shapes: RPC args typed `T` where code passes `T | null` (TS2345); `.insert/.update` payloads with
nullable fields (TS2769); `profiles.role` union wider than the app's `Role` type (TS2322, `_layout.tsx:123`,
`useLogin.ts:62` — the extra member is `superadmin`); an injected `db` client param typed against the untyped client
(`roster.rpc.ts:26`); `contact.repo.ts:13/20/30/39` pass a possibly-`undefined` id into a filter (**candidate bug #1**).

⚠ RISK 10 MITIGATION — baseline step: before F0, record `npx tsc --noEmit --incremental false` wall time in each app
here: App **3.9** s · Admin **5.8** s, and that `cd SwimSyncAdmin && npm run build` passes on `main`. **Filled 2026-10-06
(`45b8bc8`): build passes.**

## The rules this wave obeys

- **The generated file is never hand-edited.** Narrowing/widening lives in `lib/database.overrides.ts` (below).
- **A type-only change is runtime-identical** (Babel/SWC strip types) → needs typecheck + unit suites, no driver.
  **Anything that changes a select string, a filter, or a value is a runtime change** → it is a bug-fix commit with
  its own test and the `--only` driver for that surface.
  - ⚠ RISK 1 MITIGATION (structural): **"type-only" is proven by a script, never judged by eye.**
    `scripts/check-runtime-identical.sh [<base>=HEAD~1]` transpiles every changed non-test `.ts/.tsx` under
    `SwimSyncApp/`, `SwimSyncAdmin/` at base and at HEAD with the app's own `node_modules/typescript` `transpileModule`
    (`removeComments: true`, `jsx: Preserve`, `target/module: ESNext`), compares whitespace-insensitively, and exits 1
    with a unified diff on any difference. (Verified 2026-10-06: `(data as any[])`, `(c: any)`, `(q as any).foo`, `id!`,
    `import`→`import type` all transpile identically; adding or removing a `?.` does not.)
  - **Commit labels are bound to it:** `types(wave8): …` = exit 0, required. Anything with a non-empty diff is
    `fix(wave8): …` and needs a Bug-ledger row, a failing-first test and an `--only` driver. **Prove the script red once**
    (add a `?.` in a scratch edit → exit 1 → revert) and record it in the F0 commit message.
  - **Prohibition: never mix a type-only change and a runtime change in one commit.**
  - **Prohibited as "type fixes"** (each is a runtime change wearing a type fix's clothes): `?? undefined`, `?? ""`,
    `|| ""`, `?? 0` on a DB value or RPC argument; deleting a key from an insert/update/upsert payload (§7.67 — a
    missing key in an upsert sends NULL); adding or removing `?.`; changing `.single()`↔`.maybeSingle()`; editing any
    select string; the `!` non-null assertion on a DB-derived value (stripped at runtime, but it hides exactly the bug
    the type exposed — candidate #1) unless it sits beside a comment naming the guard that makes it non-null.
- **Never "fix" a to-one embed that infers as an array by adding `!inner`** — `!inner` turns the LEFT join into an
  INNER join and silently drops rows (§7.216's shape). Use the FK hint `table!fk_name(...)`, which only disambiguates,
  and verify the row count is unchanged.
  - ⚠ RISK 2 MITIGATION: an FK hint IS a select-string edit, and a wrong hint nulls the WHOLE select (§7.52/§7.90) — it
    ships as `fix(wave8)` with: a real-PostgREST probe (below) showing the same row count and the same JSON shape
    before/after, the chain-recorder repo test (§7.314), and the surface's `--only` driver.
- **Generated types do not know about RLS or about the real JSON shape.**
  - ⚠ RISK 2 MITIGATION — **Prohibition:** never delete a `?.`, a `?? fallback`, or an array/object normaliser on an
    embedded relation because the type says it is unnecessary. RLS can null any to-one embed (§7.212); the type will
    still say non-null.
  - Where the inferred type disagrees with existing access code (type says object, code reads `[0]`, or vice versa):
    **do not change the code until a real-PostgREST probe has recorded the JSON** — a `curl` against local PostgREST with
    that role's JWT, over a fixture where the embedded row is present AND one where RLS hides it. Paste the observed
    JSON into the commit message. If the code already handles the observed shape, keep the code and type the row
    honestly (`T | null`, or `T | T[]` with the existing normaliser) — that is type-only.
  - **`GenericStringError` (§7.106):** never cast the row. Turn a concatenated select into ONE literal, proving the
    evaluated string byte-identical (`node -e` printing old and new). The runtime-identity script will flag the textual
    change; the commit carries that proof and is labelled `fix(wave8)`, no driver needed if byte-identical.
  - **Grants:** a typed call can still be `permission denied` (§7.87). Typing proves shape, not privilege.
- **RPCs returning `jsonb` type as `Json`.** Keep the hand-written result interface; narrow once, in the dao.
  - ⚠ RISK 8 MITIGATION (structural): the ONLY permitted cast is the named helper
    `fromJson<T>(value: Json, source: "<sql_fn_name>"): T` exported from `lib/database.overrides.ts`. The `source`
    argument is the SQL function name. G6 does not count this helper; it counts every other cast.
- No migration is expected. If a bug fix needs one: **root writes it** on a `db/wave8-…` branch, applies, `supabase
  test db`, lands on `main`, then regenerates types in the same commit (G5 enforces it). The worktree never authors one.
  - ⚠ RISK 4 MITIGATION: **one schema change in flight at a time.** The migration may only ADD (new column, nullable
    change, new param WITH a default). **Prohibition: no DROP or RENAME of a column or a function signature in this
    wave** (§7.123 — that is a later expand/contract). Order: migration → `supabase db push` → `supabase migration list
    --linked` shows 0 pending → only then does the app commit that consumes it land on `main` (§7.60). Run `/deploy`.

## Foundation — F0 (lane1, root, ONE commit series before the worktree opens)

1. **`scripts/gen-db-types.sh`** — `supabase gen types typescript --local --schema public`, writes both
   `SwimSyncApp/lib/database.types.ts` and `SwimSyncAdmin/lib/database.types.ts`; refuses if the stack is down.
   - ⚠ RISK 5 MITIGATION (structural): the script also **refuses (exit 1)** if (a) the set of
     `supabase_migrations.schema_migrations.version` in the local DB ≠ the set of numeric prefixes of
     `supabase/migrations/*.sql` in THIS checkout (the shared-DB case: a sibling's `db/…` migration applied but not in
     your tree — verified feasible 2026-10-06: 176 = 176, in sync), or (b) `supabase --version` ≠ the version pinned in
     `.github/workflows/ci.yml` (step 2). It prints both mismatches. **Prohibition: never regenerate from a worktree**
     (lane2) — root only.
   - ⚠ RISK 11 MITIGATION: run the script twice in a row; `git diff --exit-code` after the second run must be empty
     (regeneration is deterministic). Record it in the commit message.
2. **Pin the Supabase CLI in CI** — `ci.yml` and `ui-drivers.yml` `version: latest` → the local version
   (`2.109.1` today). Output format can change between CLI versions; an unpinned CLI makes G5 go red with no schema
   change. The pin is bumped deliberately, together with a regen.
   - ⚠ RISK 6 MITIGATION: **before pinning,** read the CLI version CI actually installed on its last green run
     (`gh run view <latest green ci.yml run> --log`, Install Supabase CLI step / `supabase --version`). Write it here:
     CI ran **v2.119.0** (filled 2026-10-06: run `37423287251`, 06:21Z; the log does not print the version, so it is
     the newest stable supabase/cli release at that moment — v2.119.0, published 2026-09-30T21:35Z. Newer than local
     2.109.1 → local upgraded to 2.119.0 via brew, pin = 2.119.0). If it is newer than local: upgrade local to it, regenerate, and pin THAT. **Prohibition: never pin CI
     below what it last ran green on.**
   - The pin is its **own commit**, pushed alone; assertion: the full `backend-tests` job is green on the pin (pgTAP,
     both HTTP checks, Deno ×2, fixture roundtrip) BEFORE G5 is added. Red there = a CLI-version regression, not a
     Wave 8 bug — stop and report.
   - The `ui-drivers.yml` pin first shows up in the next scheduled nightly — read that run; **do not dispatch it**
     (user's rule).
3. **G5 — `scripts/check-db-types.sh`**, in `backend-tests` **immediately after `supabase start`** (before pgTAP):
   regenerate to a temp dir, `diff` against both committed files, fail with *"run scripts/gen-db-types.sh and commit"*.
   **Prove it red** (edit a column in a scratch migration locally, run it, see it fail; revert) — §7.25.
   - ⚠ RISK 11 MITIGATION: three more proofs, recorded in the commit message: (a) hand-edit ONLY
     `SwimSyncAdmin/lib/database.types.ts` → G5 red; (b) G5 green on two consecutive CI runs; (c) on failure G5 prints
     the local and pinned CLI versions. Also add a **no-DB step to `repo-invariants`**:
     `cmp SwimSyncApp/lib/database.types.ts SwimSyncAdmin/lib/database.types.ts` (prove red with a one-byte edit).
   - ⚠ RISK 5 MITIGATION: G5 is also runnable locally (`scripts/check-db-types.sh`) and is in the pre-push list (gate,
     below) — CI's G5 runs AFTER Vercel has already deployed, so local is the real gate.
4. **Type every client** as `SupabaseClient<Database>`: `lib/supabase.ts` (both), `lib/supabase-admin.ts`, each
   `createClient` in `app/api/*/route.ts` (16 routes) and `lib/adminManagementGate.ts`, every `SupabaseClient`
   parameter (`adminManagementGate.ts`, `staffInvitation.ts`, the app's injected `db` clients).
   **Correction:** `creditNoteEmail.ts` (both apps) takes a structural `InvokerClient`, not `SupabaseClient` — leave it
   untouched; its comment explains the contravariance.
   - ⚠ RISK 11 MITIGATION (structural): every import from `database.types` is `import type` — the file exports a
     runtime `Constants` object, which a value import pulls into both bundles. G6 (step 7) fails on a non-type import.
   - ⚠ RISK 10 MITIGATION — assertions after this step: `tsc --noEmit --incremental false` ≤ 2× baseline wall time in
     each app; zero TS2589 ("excessively deep"); `cd SwimSyncAdmin && npm run build` passes (Next typechecks on Vercel).
     Any failure: stop and report. **Prohibition: never silence TS2589 with `@ts-ignore`/`@ts-expect-error`, and never
     restructure a select to appease it** — type that row through `fromJson`/an explicit row type with a comment.
5. **`lib/database.overrides.ts`** (both apps) — the *only* place generated types are narrowed or widened: RPC args
   the SQL accepts as NULL (each entry cites the function and the line of its NULL handling, read via
   `pg_get_functiondef`, never the migration file — §7.40), and the `Role` union. Exports helper aliases
   (`Tables<'x'>`, `TablesInsert<'x'>`, `TablesUpdate<'x'>`, `Rpc<'fn'>`) and `fromJson`.
   - ⚠ RISK 3 MITIGATION (structural): RPC NULL-widenings live in ONE machine-readable const —
     `export const NULLABLE_RPC_ARGS = { fn_name: ["p_arg", …] } as const` — and types are derived from it. G5 (which has
     a DB) also runs `scripts/check-db-overrides.sh`: fails if any listed function is missing, any listed param does not
     exist on it, or `proisstrict = true` (a STRICT function silently returns NULL for a NULL arg). Prove red with a
     misspelled param name.
   - ⚠ RISK 3 MITIGATION — **Prohibition:** do NOT replace the hand-written required-key Args types (`classes.rpc.ts`,
     `accounting.rpc.ts`, every `*.rpc.ts` wrapper) with `Rpc<'fn'>['Args']`. Generated Args make every defaulted param
     optional (`end_class_shadow.p_effective_to DEFAULT NULL` → `p_effective_to?: string`), reopening "dropping the key
     is a different call". Keep the hand-written type and add a compile-time assignability check beside it:
     `type _Check = Assert<Extends<EndClassShadowArgs, Rpc<'end_class_shadow'>['Args']>>` — a renamed or misspelled param
     becomes a compile error while every key stays required.
   - ⚠ RISK 4 MITIGATION — **overrides may WIDEN, never narrow away a value the DB can hold.** For `Role`: widen the
     app's `Role` / `LandingRole` to the generated `user_role` enum (which includes `superadmin`); do NOT narrow the
     generated type to the app's union. Before deciding, run bare
     `scripts/prod-query-ro.sh "select role, count(*) from profiles group by 1"` and record the counts here: **parent 12 · coach 3 · platform_admin 1 · tenant_admin 4 · superadmin 0** (prod,
     2026-10-06).
     Assertion: `landingFor` returns its existing "unrecognised role" result for `superadmin`, unchanged — a unit test
     pins that before the change and passes after.
6. **Fix the 48 spike errors.** Each one is classified in the plan's **Bug ledger** below as *type-only* or *bug*.
   - ⚠ RISK 1 MITIGATION: the classification is the runtime-identity script's verdict, not an opinion. Type-only →
     `types(wave8)` commits (exit 0); each bug → its own `fix(wave8)` commit.
   - ⚠ RISK 3 MITIGATION: for each TS2345/TS2769 on an RPC arg or payload field the fix is EITHER a
     `NULLABLE_RPC_ARGS` / overrides entry (proven by `check-db-overrides.sh`) OR a Bug-ledger row — never one of the
     prohibited coercions above.
   - ⚠ RISK 4 MITIGATION — Role (`_layout.tsx:123`, `useLogin.ts:62`): type-only if runtime-identical; any other fix
     runs the L4-Fence test and `run-all-drivers.sh --only app-auth` (needs :8081, §7.268; bundle grep, §7.253). Login
     gates every user.
7. **G6 ratchet — `scripts/check-db-any.sh`** (repo-invariants job): fails if a file gains an `any` beyond its
   committed allowance. Starts at the baseline; every folder merge lowers it; ends at 0 for database data. Without it
   the casts grow back.
   - ⚠ RISK 8 MITIGATION (structural): **scope is every non-test `.ts/.tsx`** under `SwimSyncApp/`, `SwimSyncAdmin/`
     (excluding `node_modules`, `.next`, `lib/database.types.ts`), not only `dao/`/`domain/` — D1's folders include
     screens and `lib/`. It counts `as any`, `: any`, `any[]`, `<any>`, `Record<string, any>`, `as unknown as`,
     `@ts-ignore`, `@ts-expect-error` (the single `fromJson` definition is exempt), and fails on a non-`import type`
     import of `database.types`.
   - Allowances per app: `SwimSyncApp/.db-any-allowance`, `SwimSyncAdmin/.db-any-allowance`, one `path count` line per
     file. **The check also fails if any count in the allowance file is HIGHER than in the parent commit's version**
     (`git show HEAD~1:<allowance>`) — the allowance can only go down. Non-database `any`s that survive (out of scope)
     carry an inline `// db-any-ok: <one-word reason>` and are listed in the closing census.
   - ⚠ RISK 11 MITIGATION: three red proofs, recorded in the commit message: add `as unknown as X` to a dao file → red;
     raise one allowance → red; change an `import type` from `database.types` to `import` → red.
8. **CLAUDE.md "Database" rule** + GOTCHAS entry: *a migration that changes the public schema regenerates types in the
   same commit* (G5 says it, the rule says why).

⚠ RISK 7 MITIGATION — F0 commit order (each its own commit): (i) CLI pin alone → see backend-tests green; (ii) scripts
(gen, G5, G6, runtime-identity, overrides check) + their red proofs; (iii) generated files + client typing + the 48
fixes (`types(wave8)` / separate `fix(wave8)`); (iv) CLAUDE.md rule. Revert path: every `types(wave8)` commit is
runtime-identical and reverts cleanly with `git revert <sha>` + push.

F0 merges to `main` only **after the next scheduled nightly has been read** (HANDOVER §9 gate — the first over all of
Wave 6). **Do not dispatch it** (user's rule). A red → triage per TESTING §5 first.

## Cast removal — per feature folder

Per folder: delete the `any`s → let inference flow → fix what tsc reports (type-only, or a Bug-ledger entry) →
lower G6's allowance → typecheck + vitest/jest → merge to `main` → push. Bug-fix commits additionally run the
surface's driver with `--only`.
- ⚠ RISK 1 MITIGATION: the folder's `types(wave8)` commit(s) exit 0 on
  `scripts/check-runtime-identical.sh <folder-branch-base>` before merge; every non-zero file goes into its own
  `fix(wave8)` commit with a Bug-ledger row.
- ⚠ RISK 2 MITIGATION: for every embed whose access code you touch, the probe-or-keep rule from *The rules*.
  **Prohibition: never delete a `?.` / `??` / normaliser on an embed.**
- ⚠ RISK 4 MITIGATION — money reads (parent home, child profile, invoice detail, billing, invoices, credit notes,
  accounting, wages, packages): a **chain-recorder repo test** whose `toEqual` covers the WHOLE call log (§7.314) plus a
  **real-PostgREST probe** with the role's JWT over a fixture whose SQL ground truth is > 0, recorded in the commit
  message. The hook test alone does not count.
- ⚠ RISK 7 MITIGATION — before EVERY push to `main` (either lane): the latest `ci.yml` run on `main` is green
  (`gh run list --workflow=ci.yml --limit 1`) — never push on top of red; BOTH apps' `npm run typecheck` + `npm test`
  green (the generated file is shared; one lane can break the other app); G5 local + G6 + runtime-identity green;
  `supabase migration list --linked` 0 pending (bare). Read each scheduled nightly as it lands; **a red attributable to
  a Wave 8 merge halts BOTH lanes** until fixed or reverted. For every `fix(wave8)` push, grep the served bundle for a
  string only the new build has (§7.31/§7.51); for a `types(wave8)` push a 200 suffices (runtime-identical by proof).

**lane1 — coach/parent app (root), after F0:** `schedule`, `invoice-detail`, `child-profile`, `parent-attendance`,
`grade`, `billing`, then the small ones (`parent-home`, `mark-attendance`, `coach-settings`, `roster`, `coach-pay`,
`lib/sessionMainCoach.ts`, `lib/coachRoster.ts`, `app/(parent)`, `app/(coach)`). ~174 sites.
- ⚠ RISK 4 MITIGATION: `contact` (candidate bug #1) is its own unit. Its Bug-ledger row is admitted only after a test on
  UNFIXED code shows what the parent sees when the id is `undefined` (`.eq("profile_id", undefined)` sends
  `eq.undefined` → PostgREST 400 — does the screen show an error, or silently save nothing?). Ships with
  `--only contact-details`.

**lane2 — admin panel (worktree `wave8-admin`, opened by `/worktree-start` after F0 is on `main`):** largest first —
`assessment`, `lessons`, `packages`, `wages`, `makeups`, `students`, `unassigned`, `trials`, `referrals`, `coaches`,
`classes`, `platform`, then the rest (`parents`, `levels`, `invoices`, `attendance`, `locations`, `substitutes`,
`dashboard`, `admins`, `history`, `credit-notes`, `accounting`, `lib/calendarData.ts`, `lib/billingMonths.ts`).
~205 sites. Money folders (`invoices`, `credit-notes`, `accounting`, `wages`, `packages`) get a second read of every
changed line before merge.
- ⚠ RISK 4 MITIGATION: **`app/api/*` routes + `lib/adminManagementGate.ts` + `lib/staffInvitation.ts`** are an explicit
  lane2 unit, last. They hold 0 `any` today, so F0's typing should leave them runtime-identical (check with the
  runtime-identity script). Any runtime change there is the staff-creation privilege boundary (§7.289): it runs
  `supabase/tests/http/signup_trust.sh` and `--only tenant-provisioning`, and **never changes who can mint a
  `staff_invitations` row**.
- ⚠ RISK 3 MITIGATION: `classes` and `accounting` keep their hand-written required-key Args types plus the
  assignability check (F0 step 5); second read for `classes` too — its wrappers drive pay.

Lanes touch disjoint folders. Shared files (both `database.types.ts`, `scripts/*`, `supabase/**`, `CLAUDE.md`) are
**root-only**; lane2 asks by message, root commits, lane2 merges `main`.
- ⚠ RISK 9 MITIGATION (structural) — ownership after F0: **`SwimSyncAdmin/lib/database.overrides.ts` and
  `SwimSyncAdmin/.db-any-allowance` belong to lane2** (it can lower its own ratchet and add admin overrides without
  waiting); `SwimSyncApp/lib/database.overrides.ts` and `SwimSyncApp/.db-any-allowance` belong to lane1. Before every
  lane2 merge to `main`: `git diff --name-only main...HEAD` lists only `SwimSyncAdmin/**` paths and excludes
  `SwimSyncAdmin/lib/database.types.ts` — any other path is a blocker. **Prohibition: lane2 never authors a migration
  and never regenerates types**; a bug needing either goes to root by message. **Prohibition: WIP-commit before any
  `git reset`** in either tree (§7.343). **Prohibition: no lane works around a blocked override with a cast** — it
  waits, or leaves the `any` (G6 keeps it counted).

## Bug ledger (filled during the wave)

⚠ RISK 4 MITIGATION — a row is admitted only with: a "what the user sees today" cell reproduced on UNFIXED code by a
runtime test (**a tsc error does not count as the failing test**, §7.25); for money reads, the chain-recorder test +
PostgREST probe; the `--only` driver named; for any fix needing a migration, the migration's commit and its
`supabase migration list --linked` = 0-pending check recorded before the app commit. If the "bug" turns out to be
intended behaviour, the row is reclassified type-only and the code is NOT changed.

| # | File:line | What the types revealed | What the user sees today (reproduced) | Type-only / bug (runtime-identity verdict) | Test that fails without fix | `--only` driver | Commit |
|---|---|---|---|---|---|---|---|
| 1 | `SwimSyncApp/features/contact/dao/contact.repo.ts:13` (+ :20, :30, :39) | id may be `undefined` in a filter | **Nothing wrong, reproduced on UNFIXED code:** without an id the load never runs, `ready` stays false and `contact.tsx` shows only its spinner, so the form and Save never render. A Save forced without an id gets PostgREST `400 22P02 invalid input syntax for type uuid: "undefined"` (real probe, GET + PATCH) → toast "Could not save your details." — never a silent save | **Type-only — RECLASSIFIED, code behaviour unchanged.** Runtime-identity exit 0 (`fe0547d → 13c2ff8`). Repo params → `string`; Save passes `session?.id!` beside a comment naming the guard | `features/contact/domain/useContactDetails.test.ts` (3 tests; pins the behaviour above, green on unfixed and typed code — a reclassified row has no failing test by definition) | `contact-details` (to run before F0 merges) | `13c2ff8` |
| 2 | `SwimSyncApp/features/mark-attendance/domain/attendanceRows.ts:28` (`enrolledOn`: `e.students.id`) | typing the enrolment's `students` embed honestly (`RlsNullable`) put a bare access on a null-able value; comparing pg_policies showed WHY it can be null: `enrolments_select` admits a coach via `coach_owns_class`/`coach_rostered_in_class` (any enrolment), `students_select` only via ACTIVE enrolments | **Coach marking screen hangs on an endless spinner** for any lesson dated inside a REMOVED child's closed enrolment (backlog lessons included) — `loadClass` returns that enrolment with `"students": null` (real PostgREST, coach JWT), `enrolledOn` throws TypeError, `load()` rejects unhandled. Billing still expects the lesson marked. Prod 2026-10-06: 4 closed enrolments hidden from their coach | **Bug** — fixed in the DB (user decision 2026-10-06: a coach sees a child they taught). Migration `20261006000600_coach_sees_past_pupils` — ADD-only: new `coach_taught_student()` + one OR arm on `students_select` (ALTER POLICY); `coach_serves_student` (write authority) untouched. App side runtime-identical (`types(wave8)` with a documented policy proof) | `supabase/tests/coach_past_pupils.test.sql` — RED before the migration (1, 2: have 0 want 1), 5/5 after; re-probe shows the removed child embedded with name. Rollback rehearsed (DOWN byte-identical policy). `db push` → `migration list --linked` 0 pending; remote grant dump: no `anon` | `coach-marking` 31/31 | `fffa342` (db, on prod) · mark-attendance types commit |

## Definition of done

- Both clients and every `SupabaseClient` parameter typed with `Database`; `npm run typecheck` green in both apps;
  admin `npm run build` passes; tsc wall time ≤ 2× baseline, zero TS2589.
- G5, G6, the `cmp` invariant, `check-db-overrides.sh` and `check-runtime-identical.sh` in CI, **required**, each proven
  red once (proofs in commit messages); G5 green on two consecutive runs; CLI pinned in both workflows at ≥ the version
  CI last ran green on.
- Zero `any` / `as unknown as` / `@ts-ignore` carrying database data in non-test files of either app; both
  `.db-any-allowance` files contain only `db-any-ok` entries; the remainder listed (file, reason).
- Every Bug-ledger row has a reproduced user-visible symptom, a failing-first runtime test and a commit; behaviour
  changes are written to `PRD.md` at `/update-docs`.
- vitest, jest, tsc, fixture roundtrip green; `--only` driver green for every bug-fix surface; nightly read after the
  last merge (not dispatched — user's rule).
- `docs/ARCHITECTURE.md` new §6 entry (generated types, overrides file + its widen-only rule, `fromJson`, G5/G6, *types
  encode shape, not RLS or grants*); `docs/TESTING.md` §5 G5/G6/runtime-identity notes; `docs/plans/README.md` row
  updated; BACKLOG item struck; GOTCHAS §7.76 gains a "Durable fix shipped" line.

## Time

F0 ≈ 1 day (+½ day for the CLI-pin verification and the five guard proofs). Lane1 ≈ 2–3 days, lane2 ≈ 3–4 days, in
parallel after F0. **≈ 1 week wall clock**, plus whatever the Bug ledger grows to (unknown until casts come out — the
spike found 1 candidate in 48 errors).

## Known consequences

- **Every schema migration now carries a regen step.** That is the point (stale types lie), and G5 enforces it;
  `gen-db-types.sh` refuses when the local DB's migration set ≠ the checkout's.
- **CLI upgrades become deliberate** — the pin is bumped with a regen, never left at `latest`, never below what CI last
  ran green on.
- **supabase-js upgrades become deliberate too** — the lockfiles pin 2.98.0 in both apps; a bump changes inference, so it
  goes in its own commit with both typechecks.
- Edge functions stay untyped by decision D2; the engine's own types remain the guard there.

## Pre-commit gate (walk before every commit; a box that cannot be ticked is a blocker)

**Highest value — never skip:**
- [ ] **R1** — `types(wave8)` commit exits 0 on `scripts/check-runtime-identical.sh`; any diff → separate `fix(wave8)`
      commit with a ledger row.
- [ ] **R2** — no `?.` / `??` / normaliser removed from an embed; any embed access change carries a recorded PostgREST
      JSON probe (present AND RLS-hidden).
- [ ] **R3** — no RPC arg satisfied by `?? undefined` / `?? ""` / dropped key; hand-written required-key Args kept, with
      an assignability check; `check-db-overrides.sh` green.
- [ ] **R5** — `gen-db-types.sh` ran from root with local migration set = checkout's; `supabase migration list --linked`
      0 pending before the push.
- [ ] **R7** — latest `main` CI green; BOTH apps' typecheck + tests green; no unread red nightly attributable to Wave 8.

**Also:**
- [ ] R4 — bug fix has a reproduced symptom, a failing-first runtime test (not a tsc error), `--only` driver green;
      money read has chain-recorder test + probe; Login/Role → `--only app-auth`; API routes → `signup_trust.sh`;
      money folders → second read done.
- [ ] R4 — no migration drops or renames anything; migration on prod before the consuming app commit lands.
- [ ] R6 — CLI pin ≥ CI's last-green version; backend-tests green on the pin alone.
- [ ] R8 — G6 green; every allowance only lowered; every DB import is `import type`.
- [ ] R9 — lane2 diff touches only `SwimSyncAdmin/**` (not `database.types.ts`); WIP-committed before any reset.
- [ ] R10 — no TS2589, no `@ts-ignore` / `@ts-expect-error`; tsc ≤ 2× baseline; admin `npm run build` passes (F0 and
      after any deep-embed change).
- [ ] R11 — guard commits: red proofs recorded; regen deterministic (second run empty diff); `cmp` invariant green.
- [ ] §7.1 — F0 does not merge before the next scheduled nightly is read (not dispatched).
