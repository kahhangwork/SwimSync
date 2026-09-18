# Platform page — full-track refactor plan

_Stage 0 of the feature-tier refactor (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`).
`platform/page.tsx` is the **fifth full-track giant** — after Students (pilot), `packages`
(§8.104), `invoices` (§8.106) and `classes` (§8.108). Those four are the worked examples;
this is the plan. Written 2026-09-18._

**The gate that governs this whole page:** the Admin L-C unit must have survived a nightly on
`main` before **`platform` lands on `main`** (playbook §7.1 — one unit validated at a time).
That gate is **CLEARED**: nightly `35209608957` on `94242f5` (= L-C tip) completed **success**,
and the scheduled `35283558572` on `main` went green after it. So `platform` is cleared to
start. Build every stage locally, gate on `cd SwimSyncAdmin && npm run typecheck && npm test`.
The coach-app twin is **not** needed here: the one `lib/` module this page moves
(`moveStudentWarning.ts`) is admin-only and has no `SwimSyncApp` importer.

---

## 1. The measure (from `wc -l` / grep, 2026-09-18 — re-measure before each stage)

| Fact | Value |
|---|---|
| `app/(admin)/platform/page.tsx` | **1,395 lines** |
| `useState` | **29** calls (`grep -c useState` says 30 because it counts the `import` line — corrected at plan-review; §3's table lists all 29, each exactly once) |
| vitest baseline (`npx vitest run`, 2026-09-18) | **76 files / 757 tests** — the "before" half of every stage's assertion |
| `useEffect` | **1** (mount → auth gate → `loadTenants()`) |
| `useMemo` | 0 |
| `useRef` | **1** (`ownerModalTenantRef` — the stale-response guard, §5 RISK 5) |
| `useTableSort` | **4** (tenants, stranded, students, families) |
| `.from()` tables | `profiles`, `parent_tenants`, `parent_students` (×2), `students`, `parent_tenant_balances` |
| `.rpc()` | `platform_tenant_overview`, `platform_stranded_parents`, `platform_tenant_admins`, `platform_reassign_owner`, `student_package_coverage`, `reassign_student_tenant` |
| `fetch()` | **1** (`postAs` → `/api/provision-tenant`, `/api/resend-invite`, `/api/suspend-tenant`, `/api/unsuspend-tenant`) |
| auth | `supabase.auth.getUser()` (the gate), `supabase.auth.getSession()` (the bearer token in `postAs`) |
| Local components | none — `ROW_LIMIT` is the only module const |

**This page has a `.api.ts`.** It is the second admin page (after `invoices`) whose `dao/` is
a three-way split: `.repo` / `.rpc` / `.api`. `postAs()` is the whole of `.api.ts`.

**Definition of done (playbook §6):** `page.tsx` under ~200 lines, **zero `useState`** (meter: 29 → 0, one number per commit message), both
boundary ledgers empty, `domain/` pure mapping under characterisation tests, every driver in
the net run after its slice AND after the last stage, uncovered actions hand-checked + a
BACKLOG driver filed, this doc's §6/§12 completed, then survives a nightly before the next unit.

---

## 2. The target shape

```
app/(admin)/platform/
  page.tsx                      # composition: 8 hooks, 1 mount effect (lives HERE, not in a hook — §5 RISK 4), JSX shell. ~170 lines
  constants.ts                  # ROW_LIMIT
  types.ts                      # TenantRow, TenantAdminOption, StrandedParent, StudentRow, FamilyStatusRow
  dao/
    platform.repo.ts            # profiles, parent_tenants, parent_students, students, parent_tenant_balances
    platform.rpc.ts             # the 6 RPCs
    platform.api.ts             # postAs() + the four /api/* routes
  domain/
    useNotice.ts                # the shared `message` banner — created FIRST (§5 RISK 8)
    usePlatformAccess.ts        # `allowed` + `check(): Promise<boolean>` — NO useEffect inside (§5 RISK 4)
    useTenants.ts               # tenants + stranded + loadError + load()
    useProvisioning.ts          # showNew / creating / newBiz / newBizError / provisioned / resending
    useOwnerTransfer.ts         # ownerModal + admins list + choice + the ref guard
    useSuspend.ts               # suspendModal / busy / error
    useStudentMove.ts           # search / students / covMap / moving / pendingMove / moveNonce
    useFamilyStatus.ts          # famSearch / families / famMessage
    familyRows.ts               # PURE: the parent_tenants + parent_students → FamilyStatusRow join
    familyRows.test.ts          # characterisation
    moveStudentWarning.ts       # git mv from lib/ (sole importer)
    moveStudentWarning.test.ts  # git mv with it
  ui/
    NotPlatformAdmin.tsx        # the refusal card
    ProvisionedBanner.tsx       # the green "is set up" panel + the no-email amber fallback
    NewBusinessForm.tsx         # the create form
    TenantsTable.tsx            # the Businesses table + its useTableSort
    OwnerModal.tsx
    SuspendModal.tsx
    StrandedPanel.tsx           # "Signed up but not in any business" + its useTableSort
    StudentMoveSection.tsx      # search box + results table + its useTableSort
    CreditWarningModal.tsx      # "Credit stays with the old business"
    FamilyStatusSection.tsx     # search box + results table + its useTableSort
```

Dependency direction is the playbook §1 rule, unchanged:
`page → ui → domain → dao → (PostgREST | rpc | /api)`.

---

## 3. The slices, by state-prefix cluster

| # | Slice | State it owns | Data it touches | Stage |
|---|---|---|---|---|
| 0 | **Notice** | `message` | — | 4 |
| 1 | **Access gate** | `allowed` | `auth.getUser`, `profiles.role` | 4 |
| 2 | **Tenant overview** | `tenants`, `stranded`, `loadError` | `platform_tenant_overview`, `platform_stranded_parents` | 5 |
| 3 | **Provisioning** | `showNew`, `creating`, `newBiz`, `newBizError`, `provisioned`, `resending` | `/api/provision-tenant`, `/api/resend-invite` | 6 |
| 4 | **Owner transfer** | `ownerModal`, `ownerAdmins`, `ownerLoading`, `ownerChoice`, `ownerSaving`, `ownerError`, `ownerModalTenantRef` | `platform_tenant_admins`, `platform_reassign_owner` | 7 |
| 5 | **Suspend** | `suspendModal`, `suspendBusy`, `suspendError` | `/api/suspend-tenant`, `/api/unsuspend-tenant` | 8 |
| 6 | **Student move** | `search`, `students`, `covMap`, `moving`, `pendingMove`, `moveNonce` | `students`, `student_package_coverage`, `parent_students`, `parent_tenant_balances`, `reassign_student_tenant` | 9 |
| 7 | **Family status** | `famSearch`, `families`, `famMessage` | `parent_tenants`, `parent_students` | 10 |

**Order inside 4–10 is smallest-and-most-similar first**, per the playbook: notice + gate
(tiny, and every later hook depends on the notice) → tenants (the spine every write reloads)
→ provisioning → owner → suspend (three modal slices of the same shape) → student move
(the largest) → family status (the only one with a pure mapping worth testing).

**Cross-slice reads, enumerated at plan-review (the table above hides them).** Every arrow
points at an EARLIER slice, so the hook graph is a DAG and no call-time-argument trick
(invoices §8.106) is needed:

| Reader (slice) | Reads | Owner (slice) | How it crosses |
|---|---|---|---|
| `provisionTenant`, `reassignOwner`, `toggleSuspend` (3, 4, 5) | `loadTenants()` | 2 | creation dep `load` |
| `resendInvite`, `reassignOwner`, `toggleSuspend`, `doMove`, `handleSearch` (3, 4, 5, 6) | `setMessage` | 0 | creation dep |
| `handleMove` (6) — `oldTenantName` | `tenants` | 2 | creation dep |
| `studentSort.accessors.tenant`, the "Currently with" cell, the picker's `<option>` filter (6, all in `ui/StudentMoveSection`) | `tenants` | 2 | **prop** — `useTableSort.apply` re-reads `accessors` on every render (verified in `components/Table.tsx`: no memo), so a prop stays live |
| `ui/TenantsTable` (5) | `resendInvite`/`resending` (3), `openOwnerModal` (4), `setSuspendModal` (5), `showNew`/`setShowNew`/`setNewBizError` (3) | 3, 4, 5 | props — at Stage 5 those are still page functions; the prop NAMES are fixed at Stage 5 and never renamed at 6–8 |
| the `message` banner (`ui/StudentMoveSection`) | `message` | 0 | prop |

**Assertion (Stage 11):** the page's hook block reads, top to bottom, `useNotice → usePlatformAccess
→ useTenants → useProvisioning → useOwnerTransfer → useSuspend → useStudentMove → useFamilyStatus`,
and no hook is passed a value returned by a hook BELOW it. One glance; if it takes longer, the DAG
is broken.

---

## 4. `lib/` verdicts — move or stay

Grepped 2026-09-18 with **both** patterns the playbook §2 note requires (`@/lib/<mod>` across
the app, **and** `./\<mod>` from inside `lib/`), plus the path-pin grep over `*.test.ts`.

| Module | Symbols used here | Other code importers | Verdict |
|---|---|---|---|
| `@/lib/supabase` | the client | — | → `dao/` at Stage 2/3 |
| `@/lib/lessonDates` | `formatSgDate`, `toSgDate` | **52** app files + 6 `lib/` siblings by `./` | **STAY** — reached from `ui/TenantsTable` + `ui/StrandedPanel` |
| `@/lib/packageCoverage` | `coverageByStudent`, `StudentCoverage` | **18** | **STAY** — reached from `domain/useStudentMove` |
| `@/lib/tableSearch` | `ilikeContains`, `orIlike` | **6** (4 other `dao/` files + `packages/domain/packageRows.ts` — "5 dao files" was wrong; verdict unchanged) | **STAY** — reached from `dao/platform.repo`. Both symbols sit INSIDE query builders, so they leave the page at **Stage 2/3**, not at 9/10 |
| `@/lib/moveStudentWarning` | `totalFamilyCredit` | **0 — sole importer is this page** | **MOVE** → `platform/domain/` at Stage 9 |

**`moveStudentWarning.ts` move checklist** (all in the Stage 9 commit, playbook §2 note):

1. `git mv` the module **and** `moveStudentWarning.test.ts` into `platform/domain/`.
2. The test's specifier is `./moveStudentWarning` — unchanged by the move (same dir). The
   module imports nothing (re-verified at plan-review: `grep -n "^import" lib/moveStudentWarning.ts`
   returns 0 lines), so it has no `./` siblings to repoint (§5 pitfall: clean move).
3. **No drift test pins it by path** — `git grep "lib/moveStudentWarning" -- '*.test.ts'`
   returns nothing (unlike L-C's `lib/accounting.ts`, which cost 4 red suites). Confirmed.
4. Repoint the two prose references in the same commit:
   `docs/ARCHITECTURE.md:591` (the §10 file-map row) and `docs/TESTING.md:1081`
   (the vitest coverage line pairing it with `tableSearch.test.ts`).

`@/components/*` (`PageHeader`, `Table`/`Thead`/`Th`/`Tbody`/`Tr`/`Td`/`useTableSort`,
`Modal`, `PackageChip`) are shared primitives the page and `ui/` may both import — check 4
allows them explicitly.

---

## 5. The risks, ranked by blast radius (most → least), and the structural pin for each

_Re-ranked at plan-review 2026-09-18 against the source, not the plan. Old numbering →
new: old 1 → 8, old 2 → 5, old 3/4/5 → 1, old 6 → 4, old 7/8 → 7, old 9 → 3. Every mitigation
is inlined under its stage in §6 as `⚠ RISK n MITIGATION`; this section says WHY, §6 says WHAT._

### RISK 1 — Student move (Stage 9): the only cross-business WRITE, and it has four traps in one slice.

`reassign_student_tenant` closes a child's live enrolment and moves them between businesses.
A wrong outcome here is a child in the wrong business, a family's credit silently stranded, or a
warning that never fires. Four things must survive the move verbatim:

- **Fail-toward-prompting.** `if (linkErr) checkFailed = true` and `if (balErr) checkFailed = true`
  — a failed check WARNS rather than moves. A dao that merges the two reads into one query, or a
  hook that drops one `checkFailed`, silently skips the advisory in exactly the case it cannot verify.
- **`moveNonce` has THREE bump sites, not two** (the plan said "cancel and doMove"): the Modal
  `onClose` (backdrop + X), the **Cancel** button, and `doMove`. It is the remount key of an
  UNCONTROLLED `<select>` (`key={`move-${s.id}-${moveNonce}`}`, `defaultValue=""`). Drop one and
  the picker keeps showing the target business after a cancel — the user reads it as "moved".
- **`doMove` refreshes BEFORE it sets the message** — `handleSearch()` clears `message` on
  entry, so the other order wipes the confirmation and the move looks like a no-op.
- **The coverage fetch is fire-and-forget** (`.rpc("student_package_coverage").then(…)`, not
  awaited). Awaiting it inside the dao delays the results table and `verify-platform-admin`'s
  2.5 s window.

Plus two DRIVER contracts nobody wrote down: `verify-platform-admin` does
`page.selectOption("select", …)` — a bare, strict-mode locator that needs **exactly one `<select>`
in the DOM** (true today only because `Modal` returns `null` when closed) — and
`getByRole("button", { name: "Search" }).first()` — the student-move Search must stay **before**
the Family-status Search in DOM order.

### RISK 2 — Suspend / unsuspend (Stage 8): kills a business's app and bans its staff.

The error path is the retry path: on `!res.ok` the modal **stays open** with `suspendError`, because
a 500 means the RPC half landed but a ban/unban miss remains — pressing again is the fix. A hook
that closes the modal on error, or clears `suspendModal` before the response, turns a recoverable
half-state into one the operator cannot see. The `suspended: t.suspended_at !== null` mapping
chooses the route (`/api/suspend-tenant` vs `/api/unsuspend-tenant`) AND the copy — it must be
computed once, where it is today. `verify-tenant-suspension` reads `Suspend` / `Unsuspend` as
**exact text nodes inside the `<tr>`** and `Suspend this business` as an exact button name.

### RISK 3 — Provisioning + resend (Stage 6): mints an invite that grants `tenant_admin`.

The email-confirm guard (`adminEmail !== adminEmailConfirm`, lower-cased, trimmed) is the only
thing between a typo and a cross-tenant exposure. The amber "No invite email was sent" fallback
carries the ONLY way into the business when Resend is unset. `postAs` has **no `try`** (unlike the
Students pilot — do not pattern-match that pitfall here); `res.json().catch(() => ({}))` is the
whole of its error handling and `json` is `any` — typing it `unknown` in `.api.ts` forces rewrites
at the three `json.error ?? "…"` sites, which is where a default message changes shape.
`verify-tenant-provisioning` scopes every assertion to
`xpath=//h3[contains(., "<biz> is set up")]/..` — the `<h3>` must stay a **direct child** of the
panel that also holds the join code and the delivery sentence — and fills `input[type="email"]`
`.nth(0)` / `.nth(1)` by DOM order.

### RISK 4 — The gate, the two returns, and WHERE the mount effect lives (Stage 4).

`allowed === null` → "Loading…"; `allowed === false` → the refusal card; both above the content.
Collapsing them to `if (!allowed)` flashes "This page is for the SwimSync platform admin" at the
platform admin on every load, and no driver would catch it (`verify-platform-admin-scope` reads the
body 1.8 s after `networkidle`). Separately: §2 says the page keeps "1 mount effect" while
`usePlatformAccess` owns "the auth gate" — if the effect goes INTO the hook with `loadTenants` as a
creation dep, `useTenants` must be created before `usePlatformAccess`, contradicting §3's order.
Resolved: the effect stays on the page; the hook exposes `check()`; see the Stage 4 mitigation.
Note the smoke driver cannot help here: BOTH branches render `PageHeader title="Platform"`, so
`verify-smoke-admin`'s `h1 === "Platform"` passes on the refusal card too.

### RISK 5 — Owner transfer (Stage 7): a security-relevant write with NO driver.

`ownerModalTenantRef` is a correctness guard (close A, open B fast → A's admin list lands in B's
modal). The `useRef` and its `if (ownerModalTenantRef.current !== t.tenant_id) return` move
**verbatim**, and `closeOwnerModal` must still null the ref. Dormant on prod (§3 Wave 5), so a
regression would surface on the day it is first needed — hand-check is the only net.

### RISK 6 — Tenant overview (Stage 5): the spine, and one error is swallowed ON PURPOSE.

`loadTenants` checks `overview.error` only; `strandedRes.error` is deliberately ignored (a
stranded-RPC failure must not blank the businesses table). A dao `loadOverview()` that "tidies" this
into checking both errors changes behaviour on the one page that exists to show trouble. On
`overview.error` the function sets `loadError` and RETURNS without touching `tenants` — stale rows
stay visible under the red banner. `load()` is awaited by three writers, so it is returned from the
hook, never re-created per caller.

### RISK 7 — Family status (Stage 10): a wrong answer that looks like data — and NO driver opens it.

Both embeds are `!inner` (over a left embed `.or()` returns every row with a null embed); `orIlike`
keeps a comma or bracket in a name data, not grammar; the `.in()` sentinel stops `[]` matching
everything; the `k.students?.tenant_id === r.tenant_id` narrowing keeps one business's children off
another's row. The plan credited `verify-platform-admin` with "Family status section present" —
**false**: that driver never asserts on this section (it only `.first()`s past its Search button). The
characterisation tests in §7 are the ONLY net, so they are not optional.

### RISK 8 — `message` is written by four slices; it is a cycle if it lives in any of them.

`setMessage` is called from `resendInvite` (3), `reassignOwner` (4), `toggleSuspend` (5), `doMove`
and `handleSearch` (6); the banner RENDERS inside the student-move card, above the results table.
Typecheck catches the cycle, so this is a build risk, not a product one — but the banner's location
is a §0 behaviour and moves nowhere.

### RISK 9 — Fence mechanics (0b, 2/3): transitional pins are sanctioned, but the counts must be pre-agreed.

Check 4's allow-regex has no `./dao/` branch, and the shrink test flags any entry that no longer
matches — so the three `./dao/platform.{repo,rpc,api}` page pins cannot exist at 0b and must be
added at 2/3 (playbook §7.1's exception; packages §5 and invoices did the same). The risk is a
ledger that grows by one "just for now" mid-stage. Pin the count schedule (Stage 2/3 mitigation).

### RISK 10 — `lib/moveStudentWarning` move (Stage 9): verified clean; only prose can drift.

Sole importer confirmed both ways; zero own imports; no drift-test path pin. Two docs lines repoint.

## 6. Stage-by-stage, one commit each

Gate every stage: `cd SwimSyncAdmin && npm run typecheck && npm test`.

| Stage | What | Commit |
|---|---|---|
| **0** | This plan | |
| **0b** | Widen `tierBoundaries.drift.test.ts` to `app/(admin)/platform`; pin every current violation in both ledgers; prove all four checks RED, revert the breakers | |
| **1** | `constants.ts` (`ROW_LIMIT`) + `types.ts` (5 entity types), verbatim with their comments | |
| **2/3** | `dao/platform.repo.ts` + `.rpc.ts` + `.api.ts`, **folded** — the page holds zero `supabase` and zero `fetch(` after this. Check-3 ledger to empty | |
| **4** | `domain/useNotice.ts` + `domain/usePlatformAccess.ts` + `ui/NotPlatformAdmin.tsx` | |
| **5** | `domain/useTenants.ts` + `ui/TenantsTable.tsx` + `ui/StrandedPanel.tsx` | |
| **6** | `domain/useProvisioning.ts` + `ui/NewBusinessForm.tsx` + `ui/ProvisionedBanner.tsx` | |
| **7** | `domain/useOwnerTransfer.ts` + `ui/OwnerModal.tsx` | |
| **8** | `domain/useSuspend.ts` + `ui/SuspendModal.tsx` | |
| **9** | `domain/useStudentMove.ts` + `git mv` `moveStudentWarning{,.test}.ts` + `ui/StudentMoveSection.tsx` + `ui/CreditWarningModal.tsx` | |
| **10** | `domain/familyRows.ts` + its characterisation test + `domain/useFamilyStatus.ts` + `ui/FamilyStatusSection.tsx` | |
| **11** | The page reduced to composition; dead imports cut (`npx tsc --noEmit --noUnusedLocals \| grep '(admin)/platform/'`). **Both ledgers empty**, header dates updated | |

**Stages 2 and 3 fold** (playbook §7.1): a standalone dao stage leaves the page importing
`./dao/*` directly, which check 4 forbids and which would need transitional pins predicted at
0b. Folding the dao creation with the hooks is not what this plan does (the dao is one commit, the
hooks are seven — the L-A per-slice fold is possible but trades one ledger growth for seven dao
commits), so the **transitional `./dao/platform.{repo,rpc,api}` page pins ARE required** and are
added at Stage 2/3 when the imports first appear — the sanctioned exception the `packages` plan §5
and `invoices` plan record. They are deleted at Stages 8, 9 and 10 respectively (schedule below).

### Per-stage mitigations — walk the block for the stage you are on

#### Stage 0b

> **⚠ RISK 9 MITIGATION (the ledger counts are pre-agreed, not discovered).** Re-derived at
> plan-review by running the drift test's own `stripComments` + `dataAccess` + `imports` logic
> over the page:
> - **Assertion:** `ALLOWED_DATA_ACCESS` gains **exactly 16** platform entries (lines 4, 160, 165,
>   193, 194, 209, 210, 329, 349, 433, 453, 490, 501, 524, 533, 566 of today's file — the two
>   `Promise.all` RPC lines are separate entries; the four `await supabase\n.from(…)` builders are
>   pinned by their joined `supabase .from("<table>")` text, and `parent_students` appears TWICE
>   (lines 453 and 524) so its two snippets must differ — include the next token).
> - **Assertion:** `ALLOWED_PAGE_IMPORTS` gains **exactly 5**: `@/lib/supabase`, `@/lib/lessonDates`,
>   `@/lib/packageCoverage`, `@/lib/tableSearch`, `@/lib/moveStudentWarning`.
> - **Assertion:** the 6/6 fence tests pass with those 21 entries and 5/6 fail with any one of them
>   removed (that is the shrink test proving the pin is live). Vitest: 757 → 757 (no new tests at 0b).
> - **Do NOT** pin `./dao/*` at 0b — the shrink test flags them stale (the page imports no dao yet).

#### Stage 1

> No product risk. **Assertion:** `git diff --stat` shows `page.tsx` shrinks by exactly the lines
> `constants.ts` + `types.ts` gain, minus the two `import` lines. 757 → 757.

#### Stage 2/3

> **⚠ RISK 6 MITIGATION (`loadTenants` swallows the stranded error ON PURPOSE).**
> - **Step:** `dao/platform.rpc.ts` exports `loadOverview()` as ONE function that does the
>   `Promise.all` and returns the two raw results `[overview, strandedRes]` — the error handling
>   stays in the caller, byte-identical (`if (overview.error) { setLoadError(…); return; }`).
> - **Do NOT** check `strandedRes.error` anywhere. **Do NOT** clear `tenants` on `overview.error`.
> - **Assertion (grep):** `grep -c "strandedRes.error\|stranded.error" app/\(admin\)/platform/` = **0**
>   at every stage — **in CODE**. Corrected at Stage 2/3: the raw grep returns **1**, and that hit
>   is `dao/platform.rpc.ts`'s own prohibition comment ("Do NOT check strandedRes.error…"). A
>   prohibition that names the thing it forbids will always match the grep that forbids it. Read
>   the hit before believing the count.
>
> **⚠ RISK 3 MITIGATION (`postAs` — no `try`, `json` is `any`).**
> - **Step:** `dao/platform.api.ts` is `postAs` verbatim, return type `Promise<{ res: Response;
>   json: any }>` (write the `any` out; the ESLint-less repo will not object). It imports
>   `@/lib/supabase` itself for `getSession()` — a dao that takes the token as an argument pushes
>   `getSession` back into `domain/` and check 3 goes red.
> - **Do NOT** add a `try` around the fetch (that IS the Students-pilot pitfall, and it does not
>   apply here). **Do NOT** type `json` as `unknown`.
> - **Assertion:** the three default strings `"Could not create the business."`,
>   `"Could not resend the invite."`, `"Something went wrong — press again."` each appear exactly
>   once in `platform/` after the stage (`grep -rc`).
>
> **⚠ RISK 1 MITIGATION (part a — the credit check stays TWO reads; coverage stays a builder).**
> - **Step:** `dao/platform.repo.ts` exports `parentLinksForStudent(studentId)` and
>   `familyCreditAt(tenantId, parentIds)` as two functions returning raw `{ data, error }`.
>   `dao/platform.rpc.ts` exports `studentPackageCoverage()` returning the builder (or its promise)
>   **un-awaited**; the caller keeps `.then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])))`.
> - **Do NOT** join the two credit reads into one query. **Do NOT** `await` the coverage call in
>   the dao or the hook.
> - **Assertion (grep):** `grep -c "checkFailed = true" page.tsx` = **2** (moves to
>   `domain/useStudentMove.ts` at Stage 9, still 2); `grep -c "await.*studentPackageCoverage\|await.*student_package_coverage"` over `platform/` = **0**.
>
> **⚠ RISK 7 MITIGATION (part a — the select string and the sentinel move verbatim).**
> - **Step:** `searchFamilyMemberships(term)` in `.repo.ts` carries the exact select string with
>   both `!inner`, the `.or(orIlike([...]), { referencedTable: "parents.profiles" })`, and
>   `.limit(ROW_LIMIT)` (import `ROW_LIMIT` from `../constants`); `childrenOfParents(ids)` carries
>   the `.in()` with the `"00000000-0000-0000-0000-000000000000"` sentinel INSIDE the dao.
> - **Assertion (grep):** `grep -c '!inner' dao/platform.repo.ts` = **2** in the SELECT STRING —
>   the raw grep returns **3** (corrected at Stage 2/3; the third is the comment explaining why both
>   embeds are `!inner`). Assert on line 61's select string, not on the file-wide count;
>   `grep -c '00000000-0000-0000-0000-000000000000' dao/platform.repo.ts` = **1** and `domain/` = **0**.
>
> **⚠ RISK 9 MITIGATION (the transitional pins, and their removal schedule).**
> - **Step:** add exactly three `ALLOWED_PAGE_IMPORTS` entries, `contains: "./dao/platform.repo"`,
>   `"./dao/platform.rpc"`, `"./dao/platform.api"`, each `why` naming its removal stage:
>   **`.api` → Stage 8** (last direct caller `toggleSuspend`), **`.rpc` → Stage 9** (last:
>   `doMove`/`handleSearch`), **`.repo` → Stage 10** (last: `handleFamilySearch`).
> - **Assertion — the ledger schedule (check-3 count / check-4 count):** 0b **16 / 5** → 2/3
>   **0 / 6** (`@/lib/supabase` and `@/lib/tableSearch` leave with the dao; +3 dao pins) → 4 **0 / 6**
>   → 5 **0 / 5** (`lessonDates` leaves) → 6 **0 / 5** → 7 **0 / 5** → 8 **0 / 4** (`.api` pin) → 9
>   **0 / 1** (`packageCoverage`, `moveStudentWarning`, `.rpc` pin) → 10 **0 / 0** → 11 **0 / 0**.
>   Write the pair in every commit message. A number that goes UP is a new violation, full stop.
> - **Do NOT** add a fourth pin at any later stage.

#### Stage 4

> **⚠ RISK 4 MITIGATION (the effect stays on the page; the two returns stay two).**
> - **Step:** `usePlatformAccess()` returns `{ allowed, check }` where `check()` does
>   `getUser` → `profiles.role` → `setAllowed(ok)` → `return ok`, and contains **no `useEffect`**.
>   The page's single mount effect is `useEffect(() => { (async () => { if (await check()) await
>   load(); })(); }, [])` — `setAllowed(ok)` still happens BEFORE `load()` is awaited, exactly as
>   today (line 172–173). This is the playbook §5 "load() RETURNS the value" pattern, and it is what
>   lets `usePlatformAccess` be created before `useTenants` (§3's order) with no creation dep.
> - **Step:** `ui/NotPlatformAdmin` renders ONLY the `allowed === false` branch. The page keeps
>   `if (allowed === null) return <div …>Loading…</div>;` as its own line.
> - **Do NOT** write `if (!allowed)` as the first return. **Do NOT** move the effect into the hook.
> - **Assertion (grep):** `grep -c "allowed === null" page.tsx` = **1** and
>   `grep -c "useEffect" domain/usePlatformAccess.ts` = **0** at Stages 4–11.
> - **Assertion (driver):** `verify-platform-admin-scope` **and** `verify-platform-admin` both
>   green — the refusal is asserted by text in both (`/platform admin/i`, `"for the SwimSync platform
>   admin"`). Vigilance only for the flash: load `/platform` as `superadmin@swimsync.test` with the
>   Network tab throttled to Slow 3G and confirm "Loading…" is the only thing shown before the table.
>   `verify-smoke-admin` is NOT evidence here (both branches render `<h1>Platform</h1>`).
>
> **⚠ RISK 8 MITIGATION (`useNotice` first; banner stays put).**
> - **Step:** `domain/useNotice.ts` returns `{ message, setMessage }`; every later hook takes
>   `setMessage` as a creation arg.
> - **Assertion:** `grep -c "useNotice\|setMessage" page.tsx` shows exactly one `useNotice(` call and
>   the `message` banner JSX is still inside the "Move a student" card (Stage 9 moves that card whole).

#### Stage 5

> **⚠ RISK 6 MITIGATION (the spine).** `useTenants()` returns `{ tenants, stranded, loadError, load }`;
> `load` is the SAME function the three writers await (they receive it as a creation dep at 6–8).
> - **Do NOT** re-implement `load` inside any writer hook.
> - **Assertion:** `grep -c "loadOverview(" domain/` = **1** at Stage 11.
> - **Assertion (drivers):** `verify-tenant-suspension` and `verify-tenant-provisioning` both read
>   rows via `page.locator("tr", { hasText })` — `ui/TenantsTable` keeps one `<Tr>` per business with
>   the name, the admin email, the `invited`/`active` badge, `Resend`, `Suspend`/`Unsuspend`
>   **all inside that row**. `verify-platform-admin` asserts both business names in `body`.
> - **Hand-check (uncovered):** the stranded panel and the `N unpaid` chip — seed one parent with no
>   `parent_tenants` row and one rate-less staff coach; screenshot both; name the file in the commit.

#### Stage 6

> **⚠ RISK 3 MITIGATION (provisioning — the guard, the fallback, the panel's DOM).**
> - **Step:** the email-confirm comparison moves verbatim (`.trim().toLowerCase()` on BOTH sides).
>   After success the hook does, in this order: `setProvisioned(…)`, `setShowNew(false)`, `setNewBiz(blank)`,
>   `await load()`.
> - **Step:** `ui/ProvisionedBanner` is the `{provisioned && (<div …><h3>…</h3>…</div>)}` block
>   verbatim — the `<h3>` a **direct child** of the panel `<div>`, the join code and the delivery
>   sentence its siblings (the driver's xpath is `//h3[…]/..`).
> - **Step:** `ui/NewBusinessForm` keeps the two `input[type="email"]` in the same DOM order
>   (admin email, then confirm) and the placeholders `Dolphin Swim Academy` / `Marcus Tan`.
> - **Do NOT** wrap the `<h3>` in a flex row or a header element.
> - **Assertion (driver):** `verify-tenant-provisioning` green **with `RESEND_API_KEY` unset** (it
>   asserts the amber fallback and follows the printed link). Run on :3000 — it hardcodes the port.
> - **Assertion (grep):** `"don't match"` appears once in `domain/useProvisioning.ts`.

#### Stage 7

> **⚠ RISK 5 MITIGATION (the ref guard, verbatim, and the only net is by hand).**
> - **Step:** `useOwnerTransfer(setMessage, load)` owns the `useRef`, `openOwnerModal`,
>   `closeOwnerModal` (which nulls the ref) and `reassignOwner`. The four-line stale-response comment
>   travels with the `if (ownerModalTenantRef.current !== t.tenant_id) return;` line.
> - **Do NOT** replace the ref with state or a closure flag. **Do NOT** drop
>   `disabled={a.is_owner || a.is_disabled}` on the `<option>`.
> - **Assertion (grep):** `grep -c "ownerModalTenantRef.current" domain/useOwnerTransfer.ts` = **3**
>   (set in open, null in close, compared after the await).
> - **Hand-check (uncovered — no driver):** open Change owner on tenant A, close it, immediately open
>   it on tenant B (seed two tenants with different admins); the list shown is B's. Then complete one
>   transfer and confirm the Businesses row updates. Screenshot both; say "by hand" in the commit.

#### Stage 8

> **⚠ RISK 2 MITIGATION (suspend — the error path keeps the modal open).**
> - **Step:** `useSuspend(setMessage, load)` returns `{ suspendModal, setSuspendModal, suspendBusy,
>   suspendError, toggleSuspend }`; `toggleSuspend` is verbatim — on `!res.ok` it sets
>   `suspendError` and RETURNS with `suspendModal` untouched. `ui/TenantsTable`'s row button still
>   builds `{ …, suspended: t.suspended_at !== null }` at the click.
> - **Do NOT** close the modal on error. **Do NOT** compute `suspended` anywhere but that click.
> - **Assertion (grep):** in `domain/useSuspend.ts`, `setSuspendModal(null)` appears exactly **once**
>   and it is AFTER `setMessage(` in source order; `suspended_at !== null` appears once in `ui/TenantsTable.tsx`.
> - **Assertion (driver):** `verify-tenant-suspension` green — it needs `Suspend` and `Unsuspend` as
>   exact text nodes inside the `<tr>`, `goes dark` + `Already-sent invoice links keep working` in the
>   dialog, `Suspend this business` as the exact button name, and the `suspended` badge in the row.
> - **Step:** the `./dao/platform.api` transitional pin is deleted in this commit (check-4 ledger 5 → 4).

#### Stage 9

> **⚠ RISK 1 MITIGATION (student move — four traps, two driver contracts).**
> - **Step:** `useStudentMove(tenants, setMessage)` owns the six states and `handleSearch`,
>   `handleMove`, `doMove`, plus a `cancelMove()` = `setPendingMove(null); setMoveNonce(n => n + 1)`
>   that BOTH the Modal `onClose` and the Cancel button call. `doMove` keeps its order:
>   `setMoveNonce` → error check → `await handleSearch()` → `setMessage("Moved. …")`, with the
>   three-line comment above the `await`.
> - **Step:** `ui/StudentMoveSection` takes `tenants` as a prop and keeps the picker's
>   `key={`move-${s.id}-${moveNonce}`}` **byte-identical**, `defaultValue=""`, `disabled={moving === s.id}`.
>   `ui/CreditWarningModal` takes `pendingMove`, `onConfirm`, `onCancel`.
> - **Do NOT** make the picker controlled. **Do NOT** await the coverage RPC. **Do NOT** add a
>   second `<select>` anywhere that renders while no modal is open.
> - **Assertion (grep):** `setMoveNonce((n) => n + 1)` appears **2×** in `domain/useStudentMove.ts`
>   (`doMove` + `cancelMove`) and **0×** in `ui/`; `onClose={` and the Cancel `onClick={` in
>   `ui/CreditWarningModal.tsx` both reference the same `onCancel` prop. `grep -c "checkFailed = true"
>   domain/useStudentMove.ts` = **2**. `grep -c "await handleSearch()" domain/useStudentMove.ts` = **1**
>   and it precedes `"Moved."` in the file.
> - **Assertion (DOM, one-liner in the browser console on the finished page with one search result and
>   no modal open):** `document.querySelectorAll("select").length === 1` and
>   `[...document.querySelectorAll("button")].filter(b => b.textContent.trim() === "Search")[0]` is
>   the one inside the "Move a student" card. `verify-platform-admin` depends on both.
> - **Assertion (driver):** `verify-platform-admin` green, including the DB assertion
>   (`students.tenant_id` = the rescue tenant).
> - **Hand-check (uncovered — dormant on prod):** seed a `parent_tenant_balances` row with
>   `credit_balance > 0` for the child's parent at the OLD tenant, search, pick a target: the "Credit
>   stays with the old business" modal shows `S$<amount>`; press **Cancel** → picker reads "Choose…";
>   pick again → **Move anyway** → "Moved." and the picker reads "Choose…". Then break the balance read
>   (rename the table in the dao for one local run) and confirm the `checkFailed` copy appears. Two
>   screenshots; "by hand" in the commit.
>
> **⚠ RISK 10 MITIGATION (`git mv moveStudentWarning`).**
> - **Assertion:** vitest file count stays **76** and test count stays **757 + (familyRows tests, Stage 10)**
>   — a `git mv` that dropped the `.test.ts` shows as 75 files. `git grep -n "lib/moveStudentWarning"`
>   returns only `docs/` lines before the commit and **0** lines after it.
> - **Step:** this commit deletes the `@/lib/packageCoverage`, `@/lib/moveStudentWarning` and
>   `./dao/platform.rpc` ledger entries (check-4 ledger 4 → 1).

#### Stage 10

> **⚠ RISK 7 MITIGATION (family status — the tests are the ONLY net; then hand-check).**
> - **Step:** `domain/familyRows.ts` exports `buildFamilyRows(memberships, kids)` and
>   `familyMessage(count, kidsFailed)`; `familyRows.test.ts` pins the five cases in §7 plus the four
>   message cases (0 → "No families matched."; 1 with `kidsFailed` → "…1 family…"; 2 with `kidsFailed`
>   → "…2 families…"; ≥ `ROW_LIMIT` → "Showing the first 1000 matches…"). Header says "characterisation".
> - **Do NOT** touch `k.students?.tenant_id === r.tenant_id`; case 5 of §7 is what proves it survived.
> - **Assertion:** vitest **76 → 77 files**, tests **757 → 757 + 9** (the exact number is the runner's;
>   write it in the commit). The `./dao/platform.repo` pin is deleted here (check-4 ledger 1 → 0).
> - **Assertion (driver):** none exists — the plan's earlier credit to `verify-platform-admin` was
>   wrong. **Hand-check:** search a seed parent by name AND by email; each business they belong to is one
>   row; a two-business parent's children appear only under the business that holds them; a nonsense
>   term shows "No families matched.". Screenshot; "by hand" in the commit; the BACKLOG driver in §8
>   covers it.

#### Stage 11

> **Assertion:** `grep -c useState page.tsx` = **0** (the `import` line no longer names it either);
> both ledgers **0 / 0**; `npx tsc --noEmit --noUnusedLocals | grep '(admin)/platform/'` empty;
> `wc -l page.tsx` ≤ ~200. Then the full net (§8): all five drivers, and the four hand-checks above
> repeated on the finished page — all five sections still in the same top-to-bottom order
> (banner → Businesses card [form, table, two modals] → Stranded → Move a student → Credit modal →
> Family status).

## 7. The pure mapping, and its characterisation test

`domain/familyRows.ts` takes the two raw PostgREST result sets and produces `FamilyStatusRow[]`.
It is the only genuinely pure, genuinely non-trivial transform on the page, so it is where the
page's first unit tests go (playbook §2 Stage 4).

```ts
buildFamilyRows(memberships, kids): FamilyStatusRow[]
```

Cases to pin (all **characterisation** — they describe behaviour that exists today, so §7.25's
prove-it-red rule does not apply; the test header says so):

1. A membership with no matching kids → `children: []`.
2. A child is attributed to the row **only when both** `parent_id` and `students.tenant_id`
   match — the narrowing that stops a two-business family's children crossing rows (RISK 7).
3. Missing embeds degrade to `"—"` (`parents?.profiles?.full_name ?? "—"`, email, tenant name).
4. `family_active` passes through `is_active` unchanged.
5. A parent at two businesses produces two rows, each with only that business's children.

The message-building half (`No families matched.` / `Showing the first 1000 matches…` /
the children-failed sentence with its singular/plural `famil(y|ies)`) is a second pure
function, `familyMessage(count, kidsFailed)`, tested alongside — the plural switch is exactly
the kind of thing a move silently inverts.

---

## 8. The driver net — re-derived by grep, not by name (§7.236)

```
grep -c 'ADMIN}/platform\|3000/platform\|"/platform"' verify-*.mjs
```

**Five drivers actually open this page.** Thirteen others mention "platform" only as a role
they log in as and never navigate here — `active-inactive`, `admin-table-geometry`,
`assessment`, `attendance-guard`, `class-terms`, `class-edit`, `contact-details`,
`invoice-controls`, `multi-class`, `parent-claim`, `tenant-admin`, `trial-onboarding`,
`unmarked-lessons` all scored **0**. A name is not evidence.

| Driver | What it ACTUALLY asserts about this page (re-read at plan-review) | Run after stage |
|---|---|---|
| `verify-platform-admin` | tenant admin refused (`"for the SwimSync platform admin"` in body); platform admin sees both business names; `getByPlaceholder(/Search a child/)` + `getByRole("button",{name:"Search"}).first()` finds the child; `page.selectOption("select", {label})` — **bare strict locator, needs exactly one `<select>` in the DOM**; body includes **"Moved."** within 2.5 s; DB `students.tenant_id` changed. **Does NOT assert anything about Family status** (the plan said it did — wrong) | 9, 11 |
| `verify-tenant-provisioning` | `/New business/i` button; placeholders `Dolphin Swim Academy` / `Marcus Tan`; `input[type="email"]` `.nth(0)`/`.nth(1)` by DOM order; `/Create & invite/i`; `/don't match/i`; waits for `"<biz> is set up"`; reads the panel via `xpath=//h3[contains(., "<biz> is set up")]/..` (the `<h3>`'s PARENT holds the join code + delivery sentence); `tr hasText <biz>` contains admin email + `invited` + `Resend`; invite accepted → row reads `active` | 6, 11 |
| `verify-tenant-suspension` | `tr hasText "SuspendCov School"` contains `Suspend` (exact text node); dialog body has `goes dark` + `Already-sent invoice links keep working`; button `Suspend this business` (exact); after reload the row has `suspended` badge + `Unsuspend`; `Unsuspend` path symmetric (4 × `goto /platform`) | 8, 11 |
| `verify-platform-admin-scope` | login lands on `/platform`; `/dashboard` redirects here; sidebar has one link (nav, not this page); **`/platform` refuses a tenant admin** by `/platform admin/i` in body | 4, 11 |
| `verify-smoke-admin` | `/platform` as superadmin: `h1` **exactly** "Platform", no `pageerror` / `console.error`. **Cannot tell the refusal card from the real page** — both render `<PageHeader title="Platform">` | 11 (and after any stage that touches `page.tsx`'s returns) |

**Re-derived with the wider grep the classes review used**
(`grep -c 'ADMIN}/platform\|3000/platform\|"/platform"\|/platform`' verify-*.mjs`): the same five, and
only those five, score > 0. Two near-misses checked by hand: `verify-tenant-admin` logs in as
`platform_admin` but drives `/invoices` (it asserts the TENANT page's refusal, not this one); `verify-admins`
matches the string "Resend invite" on `/admins`, not "Resend" here. Neither is in the net.

> **⚠ RISK 1/2/3 MITIGATION (driver DOM contracts — the assertions above are the spec for `ui/`).**
> Every `ui/` file is a verbatim JSX cut, so these hold by construction — but they are the FIRST
> things to re-check on a driver red, before reading it as a product regression:
> - exactly one `<select>` while no modal is open (`Modal` returns `null` when closed — keep using it);
> - the student-move "Search" button precedes the family-status "Search" in DOM order;
> - `<h3>{biz} is set up</h3>` is a direct child of the green panel;
> - `Suspend` / `Unsuspend` / `Resend` are the whole text of their `<button>`, inside the business's `<tr>`;
> - the two `input[type="email"]` keep their order.
> **Assertion (Stage 11):** the commit message lists all **5** drivers by name with their pass counts;
> the number is the meter, this table is the hint.

**`verify-tenant-provisioning.mjs` hardcodes `http://localhost:3000`** (line 34). Against the
root checkout on :3000 that is fine — this refactor is **not** in a worktree, so the port
substitution dance of playbook §4 is not needed. Noted so it is not rediscovered.

### Uncovered actions → hand-check with a screenshot, and file the driver

No driver anywhere in the repo contains these strings (grepped 2026-09-18):

| Surface | Why uncovered | Hand-check at Stage |
|---|---|---|
| **Change owner / Set owner** modal (`platform_tenant_admins`, `platform_reassign_owner`) | Dormant on prod too (§3 Wave 5 — owner-transfer has no target) | 7 |
| **"Credit stays with the old business"** advisory (`pendingMove` → *Move anyway* / *Cancel*) | Dormant (§8.91 — no cross-business move on prod since) | 9 |
| **"Signed up but not in any business"** stranded panel | Needs a parent with no `parent_tenants` row | 5 |
| **`N unpaid`** staff-without-rate chip | Needs a rate-less staff coach (§7.131) | 5 |
| **Family status** search + rows (added at plan-review — no driver asserts on it) | `verify-platform-admin` only `.first()`s past its Search button | 10 |

→ **One BACKLOG item: `verify-platform-controls`** covering all five. Filed at close, from
`main` (not from this branch — the convention).

---

## 9. What this refactor does NOT change

- **No behaviour change of any kind** (playbook §0). Every guard, every refusal, every
  message string, every `disabled` condition is byte-identical after the move.
- **The page's gate stays a UX affordance.** The file header says it out loud: every write
  goes through an RPC that enforces platform-admin itself. Moving the gate into
  `usePlatformAccess` does not make it a security boundary and the comment moves with it.
- **No "view as tenant" mode**, no new controls, no lifting `Field`-style atoms to
  `@/components` (§7.233).
- **`ROW_LIMIT` stays 1000** and stays commented with the page's own historical "⚠ RISK 3" note (that is the Wave-plan number, not this plan's RISK 3).

---

## 10. Accepted consequences

1. **No served-bundle grep is possible** (playbook §0, §7.31) — no user-visible string is
   new. The drivers are the whole proof.
2. `git blame` on ~1,200 moved lines points at these commits. One slice per commit keeps
   `git log --follow` useful.
3. Two prose references to `lib/moveStudentWarning.ts` are repointed in the Stage 9 commit;
   any *other* document that names the path and was not found by `git grep` will drift. The
   grep was run over the whole repo, so the risk is a file outside version control only.

---

## 11. The gate before `main`

Admin L-C's nightly `35209608957` is **green** on `94242f5`, and the scheduled
`35283558572` is green on `main` — the §7.1 gate is cleared, so this unit may merge once its
own net is green. **The unit AFTER this one waits on `platform`'s nightly.**

---

## 12. Findings for `/update-docs` (filled in as they appear)

_(empty at Stage 0)_

---

## 13. PRE-COMMIT GATE — walk before EVERY stage commit; the starred ones before Stages 9, 8, 6 and 11

**Highest value (★) — these are the writes users depend on:**

- [ ] ★ **RISK 1** (Stage 9) `setMoveNonce((n) => n + 1)` ×2 in `useStudentMove.ts`, ×0 in `ui/`;
      `onClose` and Cancel share `onCancel`; `checkFailed = true` ×2; `await handleSearch()` precedes
      `"Moved."`; `document.querySelectorAll("select").length === 1` with one result and no modal;
      `verify-platform-admin` green incl. the DB check; credit-warning hand-check screenshot named.
- [ ] ★ **RISK 2** (Stage 8) `setSuspendModal(null)` ×1 in `useSuspend.ts`, after `setMessage(`;
      `suspended_at !== null` ×1 in `ui/TenantsTable.tsx`; `verify-tenant-suspension` green.
- [ ] ★ **RISK 3** (Stage 6) `.trim().toLowerCase()` on both emails; `<h3>` direct child of the panel;
      `json: any` in `.api.ts`; the three default error strings ×1 each; `verify-tenant-provisioning`
      green with `RESEND_API_KEY` unset on :3000.
- [ ] ★ **RISK 4** (Stage 4) `allowed === null` ×1 on the page; `useEffect` ×0 in
      `usePlatformAccess.ts`; `setAllowed` before `await load()`; `verify-platform-admin-scope` green.

**The rest:**

- [ ] **RISK 5** (Stage 7) `ownerModalTenantRef.current` ×3 in `useOwnerTransfer.ts`; A-then-B hand-check screenshot.
- [ ] **RISK 6** (Stage 5) `strandedRes.error` ×0 anywhere under `platform/`; `loadOverview(` ×1 in `domain/`.
- [ ] **RISK 7** (Stage 10) `!inner` ×2 and the sentinel ×1 in `.repo.ts`; `familyRows.test.ts` green
      (76 → 77 files); family-status hand-check screenshot (no driver).
- [ ] **RISK 8** (Stage 4) one `useNotice(` on the page; banner still inside the "Move a student" card.
- [ ] **RISK 9** (every stage) ledger pair in the commit message matches the schedule
      `16/5 → 0/6 → 0/6 → 0/5 → 0/5 → 0/5 → 0/4 → 0/1 → 0/0 → 0/0`; never up.
- [ ] **RISK 10** (Stage 9) `git grep "lib/moveStudentWarning"` = 0 after; vitest still 76 files.
- [ ] **Meter** `useState` count in the commit message (29 → … → 0); `npm run typecheck && npm test`
      green; test count ≥ the previous commit's.
- [ ] **Nothing tidied.** Every `ui/` file is the JSX block with `x` → `p.x`; every string a driver
      reads is byte-identical (`grep` it in the new file before committing).

**Graduate to `docs/GOTCHAS.md` §7 at close (append the next free number — ≥ §7.243 as of
2026-09-18; never renumber):** (1) *a bare `page.selectOption("select", …)` in a driver is a
one-`<select>` DOM contract on the page — any refactor that renders a second `<select>` outside a
closed `Modal` breaks it silently*; (2) *`verify-smoke-admin`'s exact-`h1` check cannot distinguish a
page's refusal branch from its content when both use `PageHeader` with the same title — an access
gate needs its own driver assertion*.

