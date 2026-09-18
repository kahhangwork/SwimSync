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
| `useState` | **30** |
| `useEffect` | **1** (mount → auth gate → `loadTenants()`) |
| `useMemo` | 0 |
| `useRef` | **1** (`ownerModalTenantRef` — the stale-response guard, §5 RISK 2) |
| `useTableSort` | **4** (tenants, stranded, students, families) |
| `.from()` tables | `profiles`, `parent_tenants`, `parent_students` (×2), `students`, `parent_tenant_balances` |
| `.rpc()` | `platform_tenant_overview`, `platform_stranded_parents`, `platform_tenant_admins`, `platform_reassign_owner`, `student_package_coverage`, `reassign_student_tenant` |
| `fetch()` | **1** (`postAs` → `/api/provision-tenant`, `/api/resend-invite`, `/api/suspend-tenant`, `/api/unsuspend-tenant`) |
| auth | `supabase.auth.getUser()` (the gate), `supabase.auth.getSession()` (the bearer token in `postAs`) |
| Local components | none — `ROW_LIMIT` is the only module const |

**This page has a `.api.ts`.** It is the second admin page (after `invoices`) whose `dao/` is
a three-way split: `.repo` / `.rpc` / `.api`. `postAs()` is the whole of `.api.ts`.

**Definition of done (playbook §6):** `page.tsx` under ~200 lines, **zero `useState`**, both
boundary ledgers empty, `domain/` pure mapping under characterisation tests, every driver in
the net run after its slice AND after the last stage, uncovered actions hand-checked + a
BACKLOG driver filed, this doc's §6/§12 completed, then survives a nightly before the next unit.

---

## 2. The target shape

```
app/(admin)/platform/
  page.tsx                      # composition: 8 hooks, 1 mount effect, JSX shell. ~170 lines
  constants.ts                  # ROW_LIMIT
  types.ts                      # TenantRow, TenantAdminOption, StrandedParent, StudentRow, FamilyStatusRow
  dao/
    platform.repo.ts            # profiles, parent_tenants, parent_students, students, parent_tenant_balances
    platform.rpc.ts             # the 6 RPCs
    platform.api.ts             # postAs() + the four /api/* routes
  domain/
    useNotice.ts                # the shared `message` banner — created FIRST (§5 RISK 1)
    usePlatformAccess.ts        # `allowed` + the auth gate
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

---

## 4. `lib/` verdicts — move or stay

Grepped 2026-09-18 with **both** patterns the playbook §2 note requires (`@/lib/<mod>` across
the app, **and** `./\<mod>` from inside `lib/`), plus the path-pin grep over `*.test.ts`.

| Module | Symbols used here | Other code importers | Verdict |
|---|---|---|---|
| `@/lib/supabase` | the client | — | → `dao/` at Stage 2/3 |
| `@/lib/lessonDates` | `formatSgDate`, `toSgDate` | **52** app files + 6 `lib/` siblings by `./` | **STAY** — reached from `ui/TenantsTable` + `ui/StrandedPanel` |
| `@/lib/packageCoverage` | `coverageByStudent`, `StudentCoverage` | **18** | **STAY** — reached from `domain/useStudentMove` |
| `@/lib/tableSearch` | `ilikeContains`, `orIlike` | **6** (5 other `dao/` files) | **STAY** — reached from `dao/platform.repo` |
| `@/lib/moveStudentWarning` | `totalFamilyCredit` | **0 — sole importer is this page** | **MOVE** → `platform/domain/` at Stage 9 |

**`moveStudentWarning.ts` move checklist** (all in the Stage 9 commit, playbook §2 note):

1. `git mv` the module **and** `moveStudentWarning.test.ts` into `platform/domain/`.
2. The test's specifier is `./moveStudentWarning` — unchanged by the move (same dir). The
   module imports nothing, so it has no `./` siblings to repoint (§5 pitfall: clean move).
3. **No drift test pins it by path** — `git grep "lib/moveStudentWarning" -- '*.test.ts'`
   returns nothing (unlike L-C's `lib/accounting.ts`, which cost 4 red suites). Confirmed.
4. Repoint the two prose references in the same commit:
   `docs/ARCHITECTURE.md:591` (the §10 file-map row) and `docs/TESTING.md:1081`
   (the vitest coverage line pairing it with `tableSearch.test.ts`).

`@/components/*` (`PageHeader`, `Table`/`Thead`/`Th`/`Tbody`/`Tr`/`Td`/`useTableSort`,
`Modal`, `PackageChip`) are shared primitives the page and `ui/` may both import — check 4
allows them explicitly.

---

## 5. The risks, and the structural pin for each

### RISK 1 — `message` is written by FOUR slices. It is a cycle if it lives in any of them.

`setMessage` is called from `resendInvite` (slice 3), `reassignOwner` (slice 4),
`toggleSuspend` (slice 5) and `doMove` (slice 6); the banner is **rendered** inside the
student-move section. Put it in any one hook and the other three import a sibling.

**Pin:** a dedicated `domain/useNotice.ts` created **first**, returning
`{ message, setMessage }`. Every later hook takes `setMessage` as a creation dep. This is
exactly the playbook §5 rule — *the later-created hook may depend on the earlier; never the
reverse* — and it keeps the page's compose layer the only place the wiring is visible.

> Where the banner **renders** does not move: it stays inside the student-move section's
> markup, above the results table. Moving it would be a behaviour change (§0).

### RISK 2 — `ownerModalTenantRef` is a correctness guard, not a style choice.

`openOwnerModal` awaits `platform_tenant_admins`, then checks the ref before writing state:
close A, open B fast enough and A's list lands in B's modal. **The `useRef` and its check
move into `useOwnerTransfer` verbatim, comment and all.** Rewriting it as state, or dropping
it because "the RPC refuses it anyway", re-opens a reachable wrong-list bug.

### RISK 3 — `moveNonce` is a remount key for an UNCONTROLLED `<select>`.

The per-row picker is `defaultValue=""` with `key={`move-${s.id}-${moveNonce}`}`. Both the
cancel button and `doMove` bump the nonce to reset it. **The key template is contract.** A
`ui/StudentMoveSection` that renames the prop must keep the key string byte-identical, and
the nonce bumps must stay on both paths (cancel **and** move) — one of them is easy to drop
when the modal moves to `ui/CreditWarningModal`.

### RISK 4 — `doMove` refreshes BEFORE it sets the message, and the comment says why.

`handleSearch()` clears `message` on entry, so setting the confirmation first meant the
refresh wiped it and the move looked like a no-op. **Order is load-bearing**; the comment
travels with the code into `useStudentMove`.

### RISK 5 — the coverage fetch is deliberately fire-and-forget.

`supabase.rpc("student_package_coverage").then(…)` in `handleSearch` is **not awaited**.
Wrapping it in `await` inside the dao binding would change when the results table paints.
`dao/platform.rpc.ts` exposes it as a promise-returning function; the hook keeps the
un-awaited `.then()`.

### RISK 6 — the four `useTableSort` calls sit ABOVE two conditional returns, on purpose.

The page's own comment: *"All four declared above the two conditional returns below — a hook
after a conditional return is a hook that sometimes does not run."* As each table moves into
a `ui/` component its sort goes with it (the component only mounts when `allowed`), which
dissolves the constraint — but **every `domain/` hook the page calls must stay above
`if (allowed === null) return`**. The page keeps that ordering and the comment moves to the
hook block.

### RISK 7 — `handleFamilySearch`'s query shape is a §7.216 landmine.

Both embeds are `!inner`; over a plain (left) embed the `.or()` would not restrict the
memberships and would return **every** row with a null embed — the silent wrong answer. The
`orIlike` sanitisation is what keeps a comma or bracket in a name data rather than structure.
**Pin:** the select string moves into `dao/platform.repo.ts` verbatim, and its comment with
it; the pure join half goes to `domain/familyRows.ts` under characterisation tests (§7 below)
so the `k.students?.tenant_id === r.tenant_id` narrowing — the thing that keeps one parent's
children from appearing under another business's row — is asserted, not assumed.

### RISK 8 — the `.in()` sentinel.

`parent_students.in("parent_id", matching.length ? … : ["00000000-…"])` — the sentinel stops
`.in([])` matching everything. It moves into `dao/` with the call, not into the hook.

### RISK 9 — `postAs` moves a `getSession()` across a `try` boundary? No — there is no `try`.

Unlike the Students pilot (§5), `postAs` has no `try`; `res.json().catch(() => ({}))` is the
only error handling and it moves verbatim. Noted so the pilot's pitfall is not pattern-matched
onto a case that does not have it.

---

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
0b. Folding the dao creation with the hooks is not possible here (the dao is one commit, the
hooks are seven), so the **transitional `./dao/platform.{repo,rpc,api}` page pins ARE required**
and are added at Stage 2/3 when the imports first appear — the sanctioned exception the
`packages` plan §5 and `invoices` plan record. They are deleted at Stages 4–10 as each hook
wraps its calls, and the last one goes at Stage 10.

---

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

| Driver | What it asserts about this page | Run after stage |
|---|---|---|
| `verify-platform-admin` | tenant admin refused; platform admin sees both businesses; student search finds the child; **move reports "Moved."**; Family status section present | 9, 10, 11 |
| `verify-tenant-provisioning` | New business → created, join code shown, row names the admin, status `invited`, **Resend offered**, invite accepted → row reads `active` | 6, 11 |
| `verify-tenant-suspension` | Suspend / Unsuspend from the businesses table (4 × `goto /platform`) | 8, 11 |
| `verify-platform-admin-scope` | platform admin **lands** on `/platform`; `/dashboard` redirects here; sidebar has exactly one link; `/platform` refuses a tenant admin | 4, 11 |
| `verify-smoke-admin` | `/platform` renders with `h1` "Platform", no console error | 11 |

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

→ **One BACKLOG item: `verify-platform-controls`** covering all four. Filed at close, from
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
- **`ROW_LIMIT` stays 1000** and stays commented with its ⚠ RISK 3 note.

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
