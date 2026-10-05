# Wave 3 — the rest of the component-render tests (two lanes)

_Planned 2026-10-05 with `/plan-with-confidence`; hardened by `/plan-review` the same day (risks R1–R11 inlined as
`⚠ RISK n MITIGATION`). Source: `BACKLOG.md` → *Current build order* → Wave 3 item 5, *Deeper component-render tests*
("What remains"). Prior art: `docs/plans/ATTENDANCE_SAVE_TESTS_PLAN.md` (Wave 2 lane 2 — its `mutate.sh` /
`scope-check.sh` are reused here)._

## What this builds, and why

Fast tests (seconds, every push) that **draw three money screens with fake data and check what they show**. Today
those screens are covered only by the nightly Playwright sweep (≈1.5 h, once a day, happy paths), so a change that
breaks what a screen *shows* passes every per-commit test.

| Surface | App | Lane |
|---|---|---|
| Admin Invoices table (`SwimSyncAdmin/app/(admin)/invoices/ui/InvoiceTable.tsx`) | admin · vitest | 1 |
| Pending charges two-tenant test (`PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md` RISK 6) | admin · vitest | 1 |
| Parent balances: home `MoneySummary` + child profile `BalancesCard` | app · jest-expo | 2 |

No new feature. **One bug fix** (below, lane 2), filed and decided with the user before planning.

## Decisions settled with the user (2026-10-05)

| # | Decision | Answer |
|---|---|---|
| D1 | What "parent balances" covers | **Both** parent-app cards: home `MoneySummary` (Outstanding + Credit) and child-profile `BalancesCard` (Outstanding, Credit, package coverage line) |
| D2 | Lane split | **By app.** Lane 1 = **this (orchestrator) session, root checkout** = admin. Lane 2 = **side session, in a worktree** = app |
| D3 | Depth | **Screen + fake data**: props-only render tests per component, PLUS dao-seam mocked hook tests where the risk is in how data is fetched (the two-tenant test needs this) |
| D4 | A test exposes a real bug | **Stop, fix first**: the lane pauses and tells the user; a separate `fix/…` branch lands on `main` first (own `/commit-review`, deploy); the test lane continues green. Test lanes never edit app source |
| D5 | Child `BalancesCard` sums Outstanding + Credit across EVERY business | **A bug — fix first.** The card shows one child, who belongs to one business; it must show only that business's figures. The HOME card's family-wide total is intended (`homeRows.ts` `totalCredit` comment) and is pinned as-is |

## Rules both lanes obey

- **Test-only** except lane 2's `fix/child-balances-per-business` branch (D5). If a test needs a seam that does not
  exist, stop and raise it — do not add one.
- **Every test is proven red without the thing it pins** (§7.25), the mutation recorded in the file's header the way
  the first and second passes did. ⚠ RISK 3 MITIGATION — **every mutation proof goes through the lane's `mutate.sh`**
  (scratchpad, never committed; written in step 1.0 / 2.0): it refuses a dirty file, restores from `HEAD` on EXIT, and
  requires the red output to contain the expected test's name. **Do NOT hand-edit source for a proof; do NOT use
  `git checkout <rev> -- <path>`** (§7.311) — restore is `git checkout HEAD -- <path>`, check is
  `git diff HEAD --exit-code`. **Run every proof BEFORE the final green run, never after** (§7.276).
- Assert exact values (`toEqual`, exact strings, exact counts) — **never `not.toBe(x)`, never `toBeTruthy()` on an
  amount** (§7.312). ⚠ RISK 8 MITIGATION — **every fixture uses DISTINCT money values per column/card** (e.g. Package
  S$15.00, Credit S$20.00, Net S$85.00, Outstanding S$120.00, Credit balance S$35.50) so a text match cannot hit the
  wrong cell; row-level assertions are scoped `within(<row>)`; column assertions read the cell by index
  (`getAllByRole("cell")[k]`). Prohibition: no unscoped `getByText("Mark Paid")` / `getByText(/S\$/)` when more than
  one row or card is rendered.
- Neither lane needs the database for its tests. **No `supabase db reset`, no UI driver runs in this plan.**
  ⚠ RISK 6 MITIGATION — the optional `verify-edit-child` driver run is **removed** (it resets the shared DB, §7.44,
  and asserts no balance). The only DB contact is lane 2's **probe in 2.2 step 6**: one idempotent fixture applied and
  torn down, no reset, announced first.
- **No lane edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`, and only lane 1 edits this plan file.** Lane 2 collects
  findings in its `WORKTREE.md`; lane 1 writes all docs from `main` at the end.
- Push per change, fast-forward only: `git fetch origin && git rebase origin/main`, re-run your suite, then
  `git push origin HEAD:main`. ⚠ RISK 3 MITIGATION — a "test-only" push **does** rebuild both production apps; it is
  user-invisible ONLY if `scope-check.sh origin/main` exits 0 immediately before the push. **A push without a green
  scope-check is prohibited.**
- **The nightly is never dispatched or re-run** (CLAUDE.md) — not even to clear the D5 gate. Reading it is fine.

---

## Lane 1 — admin (THIS session, root checkout)

Branch: `test/wave3-admin` off `main` (created AFTER step 0 of the operating sequence has pushed this plan).
Runner: `cd SwimSyncAdmin && npm test` + `npm run typecheck`.

### 1.0 Baseline and tooling
1. ⚠ RISK 4 MITIGATION — `git branch --show-current` prints `main` and `git status --porcelain` shows only
   `docs/plans/WAVE3_RENDER_TESTS_PLAN.md`; commit + push the plan (operating sequence step 0); only then
   `git checkout -b test/wave3-admin`.
2. `npm test` and `npm run typecheck` green on `main`; **record the vitest file count and test count** (the runner is
   the fact). Also run `TZ=UTC npm test` once and record it green too (CI runs in UTC).
3. Read the wiring to copy: `accounting/page.test.tsx` (`vi.mock("@/lib/supabase")`, hoisted state),
   `packages/ui/RefundModal.test.tsx` (dao-module mock), `lessons/[classId]/[date]/domain/useLessonNav.test.ts`
   (`renderHook` + mocked repo — the closest to 1.2.2), `lessons/[classId]/[date]/page.test.tsx` (page with every
   domain hook mocked — the closest to 1.2.4). Note: **no existing admin test records a supabase query chain** —
   1.2.1's recorder is new test code.
4. ⚠ RISK 3 / RISK 7 MITIGATION — write `mutate.sh` in the session scratchpad: `ATTENDANCE_SAVE_TESTS_PLAN.md` Step 0's
   script with `cd SwimSyncAdmin`, the runner `TZ=UTC npx vitest run "$test"` (not `npx jest`), and the failing output
   required to contain `$want` (the test's name). Self-test: one known-killing mutation on an existing file (e.g.
   `components/StatusBadge.tsx`, a one-character change pinned by `components/StatusBadge.test.tsx`) prints
   `RED as required`; then `git status --porcelain -- SwimSyncAdmin` is empty.
5. ⚠ RISK 3 MITIGATION — write `scope-check.sh` in the scratchpad (the Wave 2 script) with
   `ALLOW='^(SwimSyncAdmin/app/\(admin\)/invoices/(ui/InvoiceTable\.test\.tsx|ui/PendingDebits\.test\.tsx|dao/invoices\.repo\.test\.ts|domain/usePendingDebits\.test\.ts|page\.test\.tsx)|docs/plans/WAVE3_RENDER_TESTS_PLAN\.md)$'`.
   Self-test: `touch SwimSyncAdmin/lib/zz.ts && scope-check.sh` exits 1 naming it; `rm` it. **Prohibition:** never
   widen `ALLOW` to clear a red — a red here means source changed: stop.

### 1.1 `InvoiceTable` — props-only render tests (`ui/InvoiceTable.test.tsx`)
Import the test API explicitly (`import { describe, it, expect, vi } from "vitest"` — `next build` type-checks
`**/*.tsx`, `vitest.config.ts` comment). Build a `sort` prop satisfying `TableSort<InvoiceRow>` (read
`components/Table.test.tsx` for the shape). Pin, each with a mutation proof:
1. **Credit column (cell index 5):** `credit_applied: 20` renders exactly `−S$20.00` (U+2212 minus — write the literal
   character in the test); `0` renders exactly `—` (U+2014). ⚠ RISK 8 MITIGATION: the same row has
   `package_applied: 15`, and the test asserts cell 4 = `−S$15.00` and cell 5 = `−S$20.00` — a swapped column goes red.
2. Status chip: `outstanding` → "Outstanding", `paid` → "Paid" (the `invoice_status` enum is exactly
   `{outstanding, paid}`).
3. **Mark Paid only on outstanding rows**: a paid row has no "Mark Paid" button (`within(row).queryByRole("button",
   {name: /Mark Paid/})` is `null`); pressing it on row 2 of 3 outstanding rows calls `onMarkPaid` exactly once with
   row 2's id (`toHaveBeenCalledWith("inv-2")` and `toHaveBeenCalledTimes(1)`).
4. While `markingPaid === "inv-2"`, that row's button text is exactly `Saving…` (U+2026) and `disabled === true`; the
   other outstanding rows read `Mark Paid` with `disabled === false`.
5. The parent-claimed stamp shows only on an outstanding row with `paid_claimed_at` — absent on a paid row with
   `paid_claimed_at` set. ⚠ RISK 7 MITIGATION — the fixture stamp is `2026-09-30T17:30:00Z` (01/10/2026 SGT,
   30/09/2026 UTC); the assertion is the exact text `parent says paid 01/10/2026`; the mutation
   `formatSgStamp(x, DMY)` → `new Date(x).toLocaleDateString("en-SG", DMY)` must go RED through `mutate.sh` (which
   forces `TZ=UTC`). **Prohibition: do not record this proof from a plain `npx vitest` on the +08 Mac — it cannot go
   red there.**
6. The reminded stamp `chat opened 01/10/2026` (same SGT-boundary stamp) shows only on an outstanding row with
   `reminded_at`; absent on a paid row with `reminded_at` set.
7. WhatsApp and Link each call their handler exactly once with THAT row's object (`toHaveBeenCalledWith(rowObj)`
   using the fixture object itself); `copiedLink === id` turns only that row's button text to `Copied`.
8. ⚠ RISK 10 MITIGATION (states the plan omitted, cheap and money-relevant): `wa_number: null` renders `no number`
   and no WhatsApp button; `loadError: "boom"` renders the banner containing `Could not load the invoices: boom.` and
   `do not read it as the full set`; `capped` with an empty search renders `Showing the first 1000 invoices.` and the
   "Search by parent…" line, and `capped` while `loadError` is set renders no capped line; `loading` renders
   `Loading…`; an empty `visible` renders `No invoices found.`

### 1.2 Pending charges — the two-tenant test (RISK 6)
The cross-tenant scope is enforced in TWO places: `fetchPendingDebits`'s `.eq("tenant_id", tenantId)`
(`dao/invoices.repo.ts:119`) and the `parent_tenant_balances_select` policy's `tenant_id = current_tenant_id()` arm
(verified live 2026-10-05). These tests pin the client half. ⚠ RISK 10 MITIGATION — the test header says exactly that
and does NOT claim the leak is "closed by one line". Pin:
1. **Repo test** (`dao/invoices.repo.test.ts`): `vi.mock("@/lib/supabase")` with a **chain recorder** (every method
   appends `[name, ...args]` to one array and returns the same proxy). `fetchPendingDebits("tenant-A")` → assert
   **`toEqual` on the WHOLE recorded list**:
   `[["from","parent_tenant_balances"],["select","parent_id, tenant_id, debit_balance, parents(profiles(full_name))"],["eq","tenant_id","tenant-A"],["gt","debit_balance",0]]`.
   **Mutations:** delete the `.eq` → red; `"tenant_id", tenantId` → `"tenant_id", "x"` → red; `.gt(…)` → `.gte(…)` →
   red. Prohibition: no `toContainEqual` / `arrayContaining` — a partial match survives an added or reordered filter.
2. **Hook test** (`domain/usePendingDebits.test.ts`, `renderHook`, `../dao/invoices.repo` + `../dao/invoices.rpc`
   mocked): `loadPendingDebits("tenant-A")` calls `fetchPendingDebits` with exactly `"tenant-A"`; a returned row
   `{parent_id:"p1", tenant_id:"tB", debit_balance:"12.50", parents:{profiles:{full_name:"Dan"}}}` maps to exactly
   `{parent_id:"p1", tenant_id:"tB", parent_name:"Dan", debit_balance:12.5}`, and a row with no profile maps
   `parent_name` to `—`; an error clears the list (`toEqual([])`) and sets the message exactly. Write-off: the RPC
   receives `("p1","tB","reason")` (the ROW's tenant, trimmed reason); the reload calls `fetchPendingDebits` with the
   HOOK's tenant id. **Mutation:** reload with `row.tenant_id` → red — real only because the fixture row's tenant
   (`tB`) differs from the hook's (`tenant-A`); assert that inequality in the test so a future fixture edit cannot
   silently make the proof vacuous.
   ⚠ RISK 9 MITIGATION — `beforeEach` installs `vi.spyOn(window, "prompt")` with a default implementation that
   **throws "unstubbed prompt"**; each test sets its return; `afterEach` restores. Pin: prompt `null` → RPC not called,
   error unchanged; prompt `"   "` → RPC not called and error exactly `A reason is required to write off a balance.`;
   while the RPC promise is pending `writingOff` equals exactly `"p1:tB"` (the key format the panel disables on), then
   `null`. Mutation: drop the `reason.trim() === ""` guard → red.
3. **Panel test** (`ui/PendingDebits.test.tsx`, props-only): two rows `p1:tA` and `p1:tB` (same parent, two tenants)
   render two `<li>` and React logs no duplicate-key warning (spy `console.error`, assert `toHaveBeenCalledTimes(0)`);
   Write off on row 2 calls `onWriteOff` with row 2's object; `writingOff="p1:tB"` disables only row 2 (**mutation:**
   panel key `${row.parent_id}` — drop the tenant → red); error text shown via `data-testid="pending-debit-error"`;
   empty list renders no `pending-debits` element.
4. **Page wiring**: `page.tsx:34` (`usePendingDebits(tenantId)`), `:41` (afterGenerate reload), `:55` (initial load)
   pass the page's own tenant id. Pin it the way `lessons/.../page.test.tsx` does — mock every `./domain/use*` hook:
   `useTenantBilling().loadTenant` resolves `"tenant-A"` → `loadPendingDebits` called with exactly `"tenant-A"`;
   capture the `afterGenerate` passed to the mocked `useGenerate`, invoke it, assert a second call with `"tenant-A"`;
   `loadTenant` resolving `null` → `loadPendingDebits` never called. Mock `@/lib/supabase` as a throwing tripwire and
   `@/components/PermissionsProvider` if any child needs it. If this needs anything beyond `vi.mock` of existing
   modules, stop and raise it (D4) — do not add a seam.

### 1.3 Ship lane 1
1. All mutation proofs of 1.1/1.2 run through `mutate.sh`, each printed `RED as required`, recorded in the file's
   header.
2. Then the final green runs: `npm test`, `TZ=UTC npm test`, `npm run typecheck`. **Assertion:** vitest test count =
   baseline + exactly the number of new `it(` blocks in the five new files (`grep -c "^\s*it(" <files>` summed) —
   any other delta means a test was lost or skipped.
3. ⚠ RISK 3 MITIGATION — `git diff HEAD --exit-code -- SwimSyncAdmin/app SwimSyncAdmin/lib SwimSyncAdmin/components`
   (excluding the new test files) exits 0, and `scope-check.sh origin/main` exits 0.
4. ⚠ RISK 4 MITIGATION — `git branch --show-current` prints `test/wave3-admin`; `git status` read BEFORE `git add`;
   stage explicit paths only (**never `git add -A`**).
5. `/commit-review` → push to `main` (test-only: **no nightly gate**). One commit per step is fine.

### 1.4 Orchestrator duties (lane 1 only)
- **Read the next nightly** (`gh run list --workflow=ui-drivers.yml -L 3`) — the first over deploy #61. It gates lane
  2's fix push (2.3), not lane 1's tests. ⚠ RISK 5 MITIGATION — the run counts only if
  `git merge-base --is-ancestor 6da66e6 $(gh run view <id> --json headSha -q .headSha)` exits 0 and its conclusion is
  `success`. Pass lane 2 the **run id** as well as the verdict (lane 2 re-reads it itself, 2.3 step 1). Red → triage
  per `docs/TESTING.md` §5 before anything app-side lands. **Prohibition: never `gh workflow run` / `gh run rerun`** —
  not even to unblock D5; only the user can ask for it.
- After lane 2 closes: `git checkout main && git merge --ff-only origin/main`, delete `test/wave3-admin`
  (`git merge-base --is-ancestor test/wave3-admin origin/main` first), then `/update-docs` from `main` (consumes
  `docs/handoff/wave3-app.md`). ⚠ RISK 11 MITIGATION — the docs pass includes the D5 wording and graduate items in
  *Definition of done*.

---

## Lane 2 — parent app (SIDE session, worktree)

Started with **`/worktree-start`** from the root checkout AFTER this plan is on `origin/main` (`EnterWorktree`
branches from `origin/main`, so the worktree has the plan). No migration → Phase 0 is quick. Runner:
`cd SwimSyncApp && npm test` + `npm run typecheck`. No ports needed (the probe in 2.2 uses curl, not Expo).

⚠ RISK 4 MITIGATION — **the root checkout belongs to lane 1** (on `test/wave3-admin`, with uncommitted files).
Lane 2's only actions in the root are `/worktree-start`'s read-only checks (`git worktree list`,
`cat .claude/worktrees/*/WORKTREE.md`), `EnterWorktree`, and the env `cp`s. Before ANY git write:
`git rev-parse --show-toplevel` must print the worktree path. **Prohibition: no `git -C <root> …` while lane 1 is
live** — including WORKTREES Phase 5's `git -C <root> merge --ff-only origin/main` (the root is on lane 1's branch; it
would advance lane 1's branch, not `main`). Lane 1 fast-forwards its own `main` in 1.4. Lane 2 never edits this plan
file.

`WORKTREE.md` — **I own:** `SwimSyncApp/features/child-profile/**`, `SwimSyncApp/features/parent-home/**` (tests +
the D5 fix only). **I must NOT touch:** `SwimSyncAdmin/**`, `supabase/**`, the three living docs,
`docs/plans/WAVE3_RENDER_TESTS_PLAN.md`. **Fixture:** `fixtures-app-money.sql` (2.2 step 6 only; applied and torn down,
never `db reset`). **To graduate:** gotchas found, the D5 behaviour change for PRD, BACKLOG strike-through text.

Read first: §7.285 (NativeWind `className` is not styles under jest-expo — assert text/props, not colours), §7.286
(pressing nested text proves nothing about the drivers), §7.313 (a load that reads the real clock — pin it), §7.110
(a test made vacuous by its fix), `features/mark-attendance/testing/saveHarness.ts` (the dao-mock pattern: type-only
dao imports, a Supabase tripwire, one ordered call log).

### 2.0 Tooling (before any test)
1. Worktree setup per `/worktree-start` §4; `grep -c '127.0.0.1:54321' SwimSyncApp/.env` ≥1 (a cloud-pointed env would
   aim the probe at production). `npm install` in `SwimSyncApp`.
2. Baseline: `npm test` + `npm run typecheck` green on `origin/main`; record the jest suite and test counts.
3. ⚠ RISK 3 MITIGATION — `mutate.sh` (the Wave 2 script verbatim — jest, `cd` into the WORKTREE's `SwimSyncApp`);
   self-test on `features/mark-attendance/ui/SetAllMenu.tsx` as Wave 2 did → `RED as required`, then
   `git status --porcelain` empty.
4. Two `scope-check.sh` variants, each self-tested to fail on a stray `SwimSyncApp/lib/zz.ts`:
   **test-only** `ALLOW` = `SwimSyncApp/features/(child-profile|parent-home)/.*\.test\.tsx?` and
   `SwimSyncApp/features/child-profile/testing/.*`; **fix** `ALLOW` = the above plus exactly
   `SwimSyncApp/features/child-profile/(dao/childProfile\.repo\.ts|domain/useChildProfile\.ts|domain/childFormat\.ts)`.
   **Prohibition:** no `parent-home` source path in either `ALLOW` — the home card stays family-wide (D5).

### 2.1 Props-only render tests — branch `test/wave3-app` (no fix needed, start immediately)
⚠ RISK 4 MITIGATION — in the worktree: `git fetch origin && git checkout -b test/wave3-app origin/main`. These commits
ship on their own (test-only push, no gate) — **they never ride on the fix branch.**
- `parent-home/ui/MoneySummary.test.tsx`: `totalOutstanding: 120` → exactly `S$120.00` and `Outstanding Payment`;
  `creditBalance: 35.5` → exactly `S$35.50` and `Credit Balance`; `0`/`0` renders neither title (`queryByText` →
  `null`); outstanding > 0 with credit 0 renders only the outstanding card, and the reverse; the outstanding card's
  subline is exactly `Across all children — tap an invoice to pay` (pins that home is family-wide).
- `child-profile/ui/BalancesCard.test.tsx`: Outstanding and Credit amounts as given with distinct values (120 / 35.5),
  read from their labelled box; S$0.00 Outstanding still renders (the card always shows both). ⚠ RISK 10 MITIGATION —
  the coverage line uses `describeCoverage`'s exact copy for all four inputs: `package` with 1 left →
  `Package — 1 lesson left · shared across the family`; `mixed` with 3 → `Mixed — 3 lessons left · some classes bill
  per lesson`; `ad_hoc` → `Ad-hoc — billed per lesson`; `undefined` → no coverage line. (Not "monthly" — there is no
  such verdict.)
- Mutation proofs via `mutate.sh` → test-only `scope-check.sh origin/main` green → `/commit-review` → push.

### 2.2 The D5 fix — branch `fix/child-balances-per-business` off `origin/main`
`git fetch origin && git checkout -b fix/child-balances-per-business origin/main` (after 2.1 is pushed, so the fix
branch carries nothing of 2.1 not already on `main`).
1. **Red first — harness:** `features/child-profile/testing/profileHarness.ts`, saveHarness's shape (type-only imports
   of `../dao/childProfile.repo` and `../dao/childProfile.rpc`, defaults typed over `keyof typeof Repo`, a
   `@/lib/supabase` tripwire, one ordered call log; `expo-router` `useLocalSearchParams` → `{ id: "kid-A" }`;
   `fetchPackageCoverage` mocked). ⚠ RISK 2 MITIGATION — the default fakes for `fetchOutstandingInvoices` and the
   credit read **filter by the `tenantId` argument when one is passed and return every business's rows when it is
   not** (mirroring PostgREST); assert in the harness test that the fake returns A+B rows for `(parentId)` and A-only
   for `(parentId, "tA")` — so the red is caused by the missing argument, not by the fake.
2. **Red first — hook test** `domain/useChildProfile.test.ts` under `renderHook`: student `kid-A` at `tenant_id: "tA"`;
   the parent has outstanding invoices S$40.00 at A and S$75.00 at B, credit S$12.50 at A and S$30.00 at B → assert
   `child.outstanding_amount` `toEqual(40)` and `child.credit_balance` `toEqual(12.5)`. **Red against today's code**
   (reads 115 / 42.5) — record the red output. Also assert the call log: the invoice and credit reads were called with
   `("parent-1", "tA")` exactly. Await `loading === false` AND the coverage `setState` (`waitFor`) so the
   fire-and-forget `fetchPackageCoverage` does not land after the test. ⚠ RISK 10 (§7.313) — do not assert `age`
   (`ageFromDob` reads the real clock); if a test must, pin `todayInSg` via `jest.mock("@/lib/lessonDates", …)`.
3. ⚠ RISK 2 MITIGATION — **red first — dao chain test** `dao/childProfile.repo.test.ts`: mock `@/lib/supabase` with a
   **chain recorder** (each method appends `[name, ...args]`, returns the proxy; a test-side mock, not app source).
   `fetchOutstandingInvoices("parent-1","tA")` must record exactly (`toEqual` on the whole list)
   `[["from","invoices"],["select","net_amount"],["eq","parent_id","parent-1"],["eq","status","outstanding"],["eq","tenant_id","tA"]]`
   (order as implemented); the credit read records its exact chain including the `tenant_id` filter. Red against
   today's code. **Mutation after the fix:** delete the dao's `.eq("tenant_id", …)` → this test red (the hook test
   alone would stay green — that gap is why this file exists).
4. **Fix (transport + one call site):** `fetchOutstandingInvoices(parentId, tenantId)` adds
   `.eq("tenant_id", tenantId)`; the credit read is scoped to the child's tenant — either a direct read of
   `parent_tenant_balances` filtered on `parent_id` AND `tenant_id` with **`.maybeSingle()`** (never `.single()` — no
   balance row at A is a normal state and `.single()` errors on zero rows), or the existing `parents` embed narrowed
   with `.eq("parent_tenant_balances.tenant_id", tenantId)`; adjust `creditOf` only if its input shape changes (keep
   `childFormat.test.ts`'s cases green). `useChildProfile` passes `(student as any).tenant_id`. Update both "Summed
   across businesses" comments (`useChildProfile.ts:69`, `childFormat.ts:57`). Leave the home screen's family-wide
   total — and `homeRows.ts`'s comment — alone (D5). Add one hook case: no balance row at A, one at B → Credit exactly
   `0` (the clearest D5 pin). Add one hook case pinned as-is: a sibling's outstanding invoice at the same business A
   counts (the card shows what the family owes THIS business, not this child alone — record it for the PRD wording,
   RISK 11).
5. Green; `npm run typecheck` (the changed signature flags every caller — exactly one). Mutation proofs via
   `mutate.sh`, then final green run. Fix-variant `scope-check.sh origin/main` green.
6. ⚠ RISK 1 MITIGATION — **real-PostgREST probe, before `/commit-review`.** Mocked tests cannot see a malformed query,
   and the hook swallows errors into S$0.00. (a) Tell the user and lane 1: "applying `fixtures-app-money.sql` to the
   shared DB (no reset)"; `cat .claude/worktrees/*/WORKTREE.md` confirms no sibling claims that fixture. (b) Apply it
   (`docker exec -i supabase_db_SwimSync psql … -v ON_ERROR_STOP=1 < …/fixtures-app-money.sql`), then via psql set
   that parent's `parent_tenant_balances.credit_balance` at tenant `ac300000-…-000000000001` to `7.25`. (c) Ground
   truth by SQL: that parent's outstanding `net_amount` sum at that tenant — **must be > 0**, else the probe is vacuous:
   stop. (d) Get a parent JWT from local GoTrue (`app-money-parent@swimsync.test` / `password123`); for each read the
   new dao builds (the URL derived from the chain the step-3 test recorded) `curl` local PostgREST with that JWT.
   **Assertions:** HTTP 200 each; outstanding sum = the SQL ground truth; credit = exactly `7.25`; passing a different
   tenant uuid returns 0 rows (not an error). (e) Teardown with `fixtures-app-money-teardown.sql`; the fixture's parent
   and tenant count is `0` afterwards. Paste the probe output into the commit message body. **Prohibition: do not mark
   2.2 done on mocked tests alone.**
7. `/commit-review`. **Park the branch** (not pushed).
8. Do **not** touch RLS, grants or migrations. Verified live 2026-10-05: `authenticated` holds table-level SELECT on
   `invoices` and `parent_tenant_balances`; `invoices_select` and `parent_tenant_balances_select` both admit
   `parent_id = current_parent_id()`; `invoices.tenant_id`, `parent_tenant_balances.tenant_id` and
   `students.tenant_id` are all NOT NULL. A narrowing filter needs no new privilege.

### 2.3 Land the fix — this IS an app deploy
1. **Gate (HANDOVER §9 *GATE*):** lane 1 relays "gate open" + the nightly **run id**. ⚠ RISK 5 MITIGATION — lane 2
   verifies itself, not on the relayed word: `gh run view <id> --json conclusion,headSha` → `conclusion == "success"`
   and `git merge-base --is-ancestor 6da66e6 <headSha>` exits 0. Either fails → hold. Until then park the branch and
   carry on with 2.4-prep on `test/wave3-app`. **Prohibition: never dispatch or re-run the nightly to open this gate.**
2. ⚠ RISK 11 MITIGATION — **with the user's explicit permission** (the read-only prod wrapper prompts),
   `scripts/prod-query-ro.sh` counts parents with `parent_tenant_balances` rows at >1 tenant, and parents with
   outstanding invoices at >1 tenant. **Expected 0 / 0.** Non-zero → the commit message names how many families' child
   cards change, and the user is told before pushing.
3. `/deploy` (app-only: no backend dependency — the columns read have been on prod for months). Then
   `git fetch origin && git rebase origin/main`, re-run `npm test` + `npm run typecheck`, fix-variant
   `scope-check.sh origin/main` green, `git push origin HEAD:main`.
4. **Verify the deploy** (§7.31, §7.51 — a 200 proves nothing): BEFORE pushing, pick a literal only the new build has
   (e.g. `parent_tenant_balances.tenant_id` for the embed form, or the quoted `"parent_tenant_balances"` from the new
   `.from(...)` for the direct form) and confirm the CURRENT served swimsync.sg `entry-*.js` has **0** hits, so the
   grep discriminates; after the deploy it must have **≥1**. If no discriminating literal exists, the Vercel
   deployment's commit SHA must equal the pushed SHA (`gh api repos/{owner}/{repo}/deployments`).
5. Production today is expected to hold one business per family (confirmed by step 2), so no visible change is
   expected — say so in the commit message with the step-2 counts. ⚠ RISK 1 MITIGATION — after the deploy, ask the
   user to open one child profile on swimsync.sg: its Outstanding must equal the home card's Outstanding (one business
   ⇒ equal). A S$0.00 child card beside a non-zero home card → revert immediately (`git revert <sha>` → push).

### 2.4 Rest of the lane 2 tests (on `test/wave3-app`, after 2.3 is on `main`)
`git checkout test/wave3-app && git fetch origin && git rebase origin/main` (now contains the fix).
- `useChildProfile.test.ts` grows: no parent link → `0` / `0` and NO invoice/credit read in the call log; invoices
  summed exactly (string `net_amount` inputs → exact number); student not found → `child === null`,
  `loading === false`.
- `parent-home/domain/useParentHome` balance path, if cheap with the same harness pattern (mock `@/store/useAppStore`
  as saveHarness does; the dao's `todayInSg` read is mocked away with the dao): Credit = the family total across
  businesses (12.50 + 30.00 → `42.5`), Outstanding = sum of all the parent's outstanding invoices (40 + 75 → `115`).
  **Mutation:** filter `totalCredit` to the first balance row → red (pins D5's "home stays family-wide").
- **No driver run** (RISK 6: removed).
- Mutation proofs via `mutate.sh` → test-only `scope-check.sh origin/main` → `/commit-review` → push (test-only).

### 2.5 Close lane 2
`/worktree-close` in the worktree: confirms everything landed on `main` (`git merge-base --is-ancestor` for both
branches), pushes `WORKTREE.md` to `docs/handoff/wave3-app.md`. ⚠ RISK 11 MITIGATION (§7.136) — the handoff file must
contain the D5 PRD wording ("the child card shows what the family owes, and the credit it holds, at THIS child's
business"), the graduate list below, and the probe output; also paste the list into the reply. **Then** tell lane 1 it
is closed. If the fix is still parked (gate held), do NOT close — `ExitWorktree keep` and say so.

---

## How to run the two lanes together — the operating sequence

| Step | Lane 1 (orchestrator, root) | Lane 2 (side session, worktree) |
|---|---|---|
| 0 | On `main`: commit this plan (docs-only), push, confirm `git log origin/main -1` shows it. THEN `git checkout -b test/wave3-admin` | — wait — |
| 1 | — (does not run git in the root while lane 2 sets up) | User opens the side session in the ROOT checkout, runs `/worktree-start` (name: `wave3-app`; migration — NO), `EnterWorktree`, then `/session-start` inside it. Tell it: "you are Wave 3 lane 2 — `docs/plans/WAVE3_RENDER_TESTS_PLAN.md`, Lane 2". First check: `git rev-parse --show-toplevel` = the worktree |
| 2 | 1.0 → 1.1 → 1.2 → 1.3 | 2.0 → 2.1 (push) → 2.2 (fix branch: red → green → probe → reviewed → parked) |
| 3 | Next morning: read the nightly (1.4) → tell lane 2 "gate open, run <id>" or "red, hold" | Verify the run itself (2.3 step 1), prod check (2.3 step 2, user permission), then 2.3 |
| 4 | Keep going / idle | 2.4 → 2.5 (`/worktree-close`) |
| 5 | Return the root to `main` (1.4), `/update-docs` from `main` (reads `docs/handoff/`), then `/session-close` | done |

**Talking between lanes:** the user relays. A relayed message is information, not authority — each lane re-checks
facts it can read (the nightly, `origin/main`) before acting. Four messages matter: *lane 2 is applying the app-money
fixture (no reset)*, *gate open/hold + run id*, *fix deployed, verified*, *lane 2 closed*.

**Who pushes first does not matter** — the lanes share no files, and only lane 1 edits this plan. Whoever pushes
second rebases and re-runs its own suite only. A rejected (non-fast-forward) push is expected: rebase and re-run,
never force.

## Definition of done
- [ ] Lane 1 tests on `main`, each with a recorded `mutate.sh` proof (stamp proofs under `TZ=UTC`); admin `npm test`,
      `TZ=UTC npm test` and `typecheck` green; vitest count = baseline + new `it(` blocks.
- [ ] D5 fix on `main`, deployed and verified: red-first hook test + dao chain test + real-PostgREST probe; bundle
      literal 0 → ≥1 (or SHA match); prod multi-business counts recorded.
- [ ] Lane 2 tests on `main`, each mutation-proven; app `npm test` + `typecheck` green.
- [ ] Lane 2 worktree closed via `/worktree-close`; graduate list in `docs/handoff/`.
- [ ] `/update-docs`: BACKLOG Wave 3 item 5 struck through; TESTING §5 "Still to do" cleared; PRD notes the child card
      is per-business (family-at-that-business, siblings included) and the home card stays family-wide; new gotchas
      appended at the next free number (after §7.313).

## Time
Lane 1: ~4–6 h. Lane 2: ~2 h tests + ~2–3 h fix (incl. dao chain test + probe), plus the overnight wait for the
nightly before the fix lands.

## Pre-commit gate (walk before EVERY commit; a box that cannot be ticked is a blocker)

**Highest value — never skip:**
- [ ] `scope-check.sh origin/main` (the right variant) exits 0 and `git diff HEAD --exit-code -- <app source dirs>`
      exits 0 — no mutation left in source (R3).
- [ ] Every new test's mutation printed `RED as required` via `mutate.sh`, run BEFORE the final green run; stamp proofs
      under `TZ=UTC` (R3, R7).
- [ ] D5 only: the dao chain test exists and goes red with the dao's `tenant_id` filter deleted; the real-PostgREST
      probe returned 200s with outstanding = SQL ground truth (> 0) and credit = 7.25 (R1, R2).
- [ ] D5 push only: lane 2 itself verified the nightly run (`success`, head contains `6da66e6`); nothing was
      dispatched (R5).

**Also:**
- [ ] `git rev-parse --show-toplevel` / `git branch --show-current` are this lane's; `git status` read before
      `git add`; explicit paths only (R4).
- [ ] Assertions are exact (`toEqual` / exact strings / exact call counts); fixtures use distinct money values;
      multi-row queries `within(row)`-scoped (R8).
- [ ] `window.prompt` stubbed with a throwing default in every write-off test (R9).
- [ ] No `supabase db reset`, no driver run; the probe's fixture torn down (count 0) (R6).
- [ ] Test count delta = number of new `it(` blocks (runner is the fact).
- [ ] D5 push only: prod multi-business counts recorded; bundle literal checked 0 before → ≥1 after (R11, R1).

## Candidates to graduate to GOTCHAS §7 (offered to the user — not yet applied)

1. **A parent-app money read that fails shows S$0.00, not an error.** `useChildProfile` / `useParentHome` destructure
   only `data`, and `outstandingOf(null)` / `creditOf(null)` / `totalOutstandingOf(null)` are 0. A query change there
   must be proven against real PostgREST (a JWT `curl` probe) — mocked tests cannot see a malformed query, and no driver
   asserts the amounts.
2. **A dao-seam mocked hook test cannot pin a filter added INSIDE the dao.** Pair it with a chain-recorder test of the
   repo function (`toEqual` on the whole recorded chain), and make the fake filter by its arguments so the red comes
   from the missing argument (the §7.110 family).
3. **The dev Mac runs at +08 and CI at UTC, so a mutation proof against an SG-pinned formatter can only go red under
   `TZ=UTC`.** Use a fixture stamp straddling SGT midnight (e.g. `…T17:30:00Z`) and run the proof with
   `TZ=UTC npx vitest`.
4. **When the root checkout is on a feature branch, WORKTREES Phase 5's `git -C <root> merge --ff-only origin/main`
   advances THAT branch, not `main`.** A worktree must not touch the root's git state while the root session is live.
5. *(Minor)* **jsdom's `window.prompt` is unimplemented** — stub it with a default that throws, so an unstubbed
   write-off path fails loudly.
