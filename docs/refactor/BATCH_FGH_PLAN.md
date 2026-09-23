# App L-F + L-G + L-H + the app fence commit — one branch, one ship

_The three coach/parent-app lite batches **plus** the app's fence track, taken as ONE unit on one
branch (`refactor/app-lite-fgh`), shipped once, proven by one nightly. Written 2026-09-23 from
`/plan-with-confidence` (6 decisions, §0), hardened the same day by `/plan-review` (Opus 5.5,
high): every c3/c4 row CONFIRMED by a replica of the fence; **7 factual errors found, 5
spot-checked by hand and all held** (4 sgDisplay path pins missed, 16 not 6 store readers, the
QR `try` boundary, ReferralSection is read-only, three unreached writes). Mitigations are inline,
marked `⚠ R<n>`, under the step they govern. Method: the refactor playbook §7.1 (lite) and §7.2
(fence) — this is the batch's L0 plan doc; the playbook is the method and is not restated here.
When this lands, **the app half of the programme (§7.5) is done**: every route file in both
apps is fenced._

**Rule 0 applies in full: nothing here changes behaviour.** Markup moves verbatim, cuts are
scripted, every commit is gated. A change that would need behaviour to move is a `BACKLOG.md`
item, not a commit. **The cancelled-lesson spinner (BACKLOG *Coach workflow*) is NOT fixed here**
— it is a behaviour change and is not on any screen in scope anyway.

---

## 0. The decisions (user, 2026-09-23) — and the playbook rules they bend

| # | Decision | Playbook rule it bends | Why it is still safe enough |
|---|---|---|---|
| D1 | **One branch, four sub-batches** (F → G → H → fence), **a full L4 driver run after EACH sub-batch**, one merge, one nightly | §7.1 *≤ ~2,500 lines per batch* (this is 5,515 lite + 1,828 fence) and *one nightly per batch* | The per-sub-batch L4 keeps the property the cap buys: a driver red bisects to ≤ 5 commits. What is lost is only the *nightly's* independent resolution — one nightly now covers four units' worth of change — hence R3's full local sweep before `/deploy` |
| D2 | **Fence commit included** | §7.4 lists it as its own unit | It is ~1 hour and every fence screen is small; but it touches **login**, on every app driver's path (R1) |
| D3 | **All the way to deploy** — implement, L4 ×4, review, `/deploy`, dispatch the nightly | — | App-only: **0 migrations, 0 edge functions** — `git push :main` is the whole deploy |
| D4 | **Root checkout**, branch `refactor/app-lite-fgh` | — | No sibling session; drivers reset the DB, so no worktree may run beside it |
| D5 | **Pause after `/plan-review`** for the user's go | — | The one checkpoint in a long run |
| D6 | **One senior review of the whole branch diff** before `/deploy` (not `/commit-review` ×17) | CLAUDE.md "`/commit-review` to ship each change" | Each commit is gated by typecheck + tests + the fence; the review targets behaviour drift in moved code, which is the only failure a gate cannot see |

---

## 1. What is in scope, measured

`wc -l` / `grep -c useState` / a replica of the fence's own `dataAccess()` + check-4 regex, run
2026-09-23 on `f87405e` (§7.236 — re-derive at L0, never trust a count in a document).

**"c3" = lines check 3 will flag** (every `\bsupabase\b`, `fetch(`, or client-holding-helper
import after `stripComments()`, the `import { supabase }` line included). **"c4" = route imports
check 4 will flag** — note it flags **third-party packages too** (`qrcode`, `expo-image-picker`,
`expo-linking`): those must end up in `ui/` or `domain/`, not on the route.

### Sub-batch F — parent home (1,886 lines)

| Route | Feature dir | Lines | `useState` | c3 | c4 | Drivers that OPEN it (render / **write**) |
|---|---|---|---|---|---|---|
| `(parent)/home/index.tsx` | `parent-home` | 608 | 7 | 11 | 5 | landing of every parent login; asserted by packages, multi-class, makeups, trial-visibility, tenant-suspension, tenant-branding, parent-claim, parent-address — **read-only everywhere** |
| `(parent)/home/add-child.tsx` | `add-child` | 515 | 11 | 3 | 3 | **join-code** (save), **parent-claim** (save + claim ×3), **student-identity** (duplicate refused, then save) |
| `(parent)/home/child/[id].tsx` | `child-profile` | 508 | 4 | 8 | 4 | student-identity, level-skills, levels, packages, edit-child (pass-through) |
| `(parent)/home/edit-child.tsx` | `edit-child` | 255 | 8 | 3 | 2 | **edit-child** only (save; rename-collision refused) |

### Sub-batch G — parent money (2,023 lines + `ReferralSection` 1 component)

| Route | Feature dir | Lines | `useState` | c3 | c4 | Drivers |
|---|---|---|---|---|---|---|
| `(parent)/billing/index.tsx` | `billing` | 760 | 11 | 11 | 5 | **parent-pay-claim** (list-card *I've paid*), **packages** (*Request & pay*), paynow-fallback, tenant-branding |
| `components/ReferralSection.tsx` → `features/billing/ui/` | `billing` | — | — | 4 | — | mounted by packages/paynow-fallback, **never asserted**; Copy/Share never pressed → **HAND-CHECK** |
| `(parent)/billing/invoice/[id].tsx` | `invoice-detail` | 430 | 4 | 6 | 6 | tenant-branding (render only). **Its own *I've paid* (`claim_invoice_paid`) is pressed by NO driver → HAND-CHECK** |
| `(parent)/billing/paynow.tsx` | `paynow` | 303 | 9 | 3 | 3 (`qrcode`) | parent-pay-claim, packages, **paynow-fallback** (states A/B/C), tenant-branding |
| `invoice/[token].tsx` (public) | `public-invoice` | 250 | 5 | 2 | 3 (`qrcode`) | **payment-collection** (logged-out render + *I've paid*; signed-in not bounced) |
| `package/[token].tsx` (public) | `public-package` | 280 | 5 | 2 | 3 (`qrcode`) | **smoke-app only, not-found state** → HAND-CHECK the valid token path |

### Sub-batch H — the rest (1,606 lines)

| Route | Feature dir | Lines | `useState` | c3 | c4 | Drivers |
|---|---|---|---|---|---|---|
| `(parent)/attendance/index.tsx` | `parent-attendance` | 645 | 9 | 9 | 5 | parent-attendance, attendance-guard (parent part) |
| `(coach)/settings/index.tsx` | `coach-settings` | 389 | 8 | 9 | 4 (`expo-image-picker`) | paynow-fallback (render, admin vs plain coach), coach-roster (who-am-I ×5). **QR upload never pressed → HAND-CHECK** |
| `(coach)/classes/index.tsx` | `coach-classes` | 267 | 4 | 3 | 5 | stale-screen; pass-through for student-identity, level-skills, levels, trial-visibility, trials |
| `(auth)/register.tsx` | `register` | 305 | 12 | 4 | 3 | **join-code**, **parent-address** (5-digit postal refused), **tenant-branding** — all submit |

### Sub-batch Fence (1,828 lines, 12 route files + `ChangePasswordScreen`)

| Route | Feature dir | Lines | c3 | c4 | Drivers |
|---|---|---|---|---|---|
| `(auth)/login.tsx` | `login` | 150 | 4 | 4 | **every `loginExpo` driver** + coach-disable, tenant-suspension, payment-collection (logged-out) |
| `(auth)/accept-invite.tsx` | `accept-invite` | 225 | 7 | 3 | smoke only (`#type=invite`) → HAND-CHECK the full flow via Mailpit (R5) |
| `(auth)/reset-password.tsx` | `reset-password` | 149 | 4 | 3 | smoke only (`#type=recovery`) |
| `(auth)/forgot-password.tsx` | `forgot-password` | 124 | 2 | 4 (`expo-linking`) | smoke only → HAND-CHECK submit |
| `(coach)/classes/[id]/grade.tsx` | `grade` | 236 | 4 | 2 | smoke only (error state) → HAND-CHECK a real grade save |
| `(coach)/pay/index.tsx` | `coach-pay` | 230 | 3 | 2 | **coach-wages** (`Your pay`, 40.00) |
| `(parent)/profile/index.tsx` | `profile` | 143 | 2 | 3 | parent-address (pass-through) |
| `(parent)/profile/contact.tsx` | `contact` | 224 | 5 | 2 | **parent-address** (postal save, leading zero) |
| `(parent)/home/join-tenant.tsx` | `join-tenant` | 126 | 2 | 2 | **join-code** (redeem) |
| `(parent)/profile/change-password.tsx` + `(coach)/settings/change-password.tsx` | `change-password` (**shared by both**) | 3 + 3 | 0 | 0 | smoke only; submit pressed by nobody → HAND-CHECK |
| `components/ChangePasswordScreen.tsx` → `features/change-password/ui/` | `change-password` | — | 2 | — | as above |
| `welcome.tsx` | **none** (no state, no client) | 80 | 0 | 0 | smoke only |

`app/index.tsx` (6 lines, a redirect) is **out of scope**, as the admin's `app/page.tsx` was.
Layouts are out of scope (playbook §7).

**Totals: 24 route files (13 lite + 11 fence, 1,828 fence lines incl. ChangePasswordScreen) ·
check-3 = 107 lines · check-4 = 76 imports** — the review re-ran the fence's own logic and got
exactly these. ⚠ The rows sum to **113** c3: the extra 6 are `ReferralSection` (4) and
`ChangePasswordScreen` (2), which live in `components/` — **not scanned at L0, so NOT pinned**
(a pin there fails the shrink test at once). They must arrive in `features/` already clean.

### The `lib/` verdicts

Criterion (Students plan §6, playbook §6): `lib/` = shared across features or apps, or pinned by
path; `features/<x>/domain/` = one code importer only, and its test moves with it.

| Module | Non-test importers | Pinned by path? | Verdict |
|---|---|---|---|
| `invoiceFunding` | **1** — `invoice/[id]` | no | **MOVES** → `features/invoice-detail/domain/` (+ its test). No relative imports |
| `upcomingLessons` | **1** — parent `attendance` | no | **MOVES** → `features/parent-attendance/domain/` (+ test). ⚠ imports `./lessonDates`, `./scheduleWeek` → repoint to `@/lib/` (playbook §5) |
| `weekOrder` | **1** — coach `classes/index` | no (2 comment mentions in `lib/scheduleWeek.ts` — update the path in the comment) | **MOVES** → `features/coach-classes/domain/` (+ test). ⚠ `weekOrder.ts` AND `weekOrder.test.ts:7` import `./lessonDates` → repoint both |
| `referralShare` | **1** — `ReferralSection` (itself moving into `features/billing/ui/`) | no | **MOVES** → `features/billing/domain/` (+ test) |
| `payoutBreakdown` | 1 — coach `pay` | **YES — both `sgDisplay.drift.test.ts` twins name `SwimSyncApp/lib/payoutBreakdown.ts`** | **STAYS** |
| `claimCandidates` | 2 (home, add-child) | — | STAYS (two features) |
| `packageCoverage` (3, incl. `PackageBadge`), `skillProgress`, `invoiceLabel`, `landing`, `locationFilter` | 2–3 | `skillProgress` path-pinned (admin `skillProgress.drift.test.ts:34`) | STAY |
| `lessonDates` (25), `confirm` (8), `scheduleWeek` (7), `authErrors` (6), `paynow` (3) | many | `lessonDates` path-pinned | STAY |

### ⚠ R6 — the sgDisplay PATH pins: four routes in scope are named by file in BOTH twins

`SwimSyncApp/lib/sgDisplay.drift.test.ts:72-91` and its `SwimSyncAdmin` twin pin
`billing/index.tsx`, `billing/invoice/[id].tsx`, `billing/paynow.tsx`, `invoice/[token].tsx` by
path + snippet. Commits 6–9 turn both suites red unless:

- **STEP (commits 6–9):** repoint that route's pin(s) in **both twins in the same commit** as the
  move (§7.241), to the new `features/…` file; keep the snippet inside the same blank-line block as
  the call (`blockStart` bounds the match).
- **PROHIBITION:** do NOT "fix" the red by adding `timeZone` or switching to `formatSgStamp` — that
  is a behaviour change.
- **ASSERTION:** the two twins' `ALLOWED` arrays stay identical — a diff of the two lists is empty.

`grep` any `.md` naming a moved path (7 hits today, outside `docs/SESSIONS.md`) and fix live
references; ledger/session history is left as written.

### The two components with client access

- **`ReferralSection`** — one importer (`billing/index.tsx:19`); **read-only** (two `.from()` + the
  `my_referrals` rpc, `:44-49`). It is not shared, so it **moves into `features/billing/ui/`** with
  its reads in `billing/dao/` + a `useReferral` hook, rather than the `AssessmentGrid` injection
  (that exists for ≥ 2 callers in different features).
  **⚠ R4 PROHIBITION: `useReferral` is called INSIDE `ReferralSection`, never hoisted into the
  route.** The section mounts only on the Packages tab (`billing/index.tsx:717`), so its mount-only
  fetch runs on each switch to that tab; hoisting changes when it fetches.
- **`ChangePasswordScreen`** — two importers, both 3-line route files. It **moves into
  `features/change-password/ui/`** with `domain/useChangePassword.ts` + `dao/`; both routes then
  import `@/features/change-password/ui/ChangePasswordScreen`. This needs the fence's PAGES shape
  to allow **two routes sharing one feature** (§2 L0).

---

## 2. The commits

**Seventeen**, plus review fixes and a ship step. One commit per lite screen (L1–L3 **folded**,
playbook §7.1 — no route ever imports `dao/` in a committed state, so no transitional pins); one
commit for the whole fence sub-batch (§7.2).

| # | Commit | Sub-batch |
|---|---|---|
| 1 | **L0** — widen the fence to all 24 routes, pin, prove red; this plan | — |
| 2–5 | `parent-home`, `add-child`, `child-profile`, `edit-child` | F → **L4-F** |
| 6–10 | `billing` (+ `ReferralSection`, `referralShare`), `invoice-detail` (+ `invoiceFunding`), `paynow`, `public-invoice`, `public-package` | G → **L4-G** |
| 11–14 | `parent-attendance` (+ `upcomingLessons`), `coach-settings`, `coach-classes` (+ `weekOrder`), `register` | H → **L4-H** |
| 15 | **Fence** — all 11 fence routes + `ChangePasswordScreen` in one commit | Fence → **L4-Fence** |
| 16 | Review fixes (D6), if any | — |
| 17 | Plan stage log + §12 findings | — |

### ⚠ THE GATE — both apps, every commit, no exceptions

```bash
cd SwimSyncApp   && npm run typecheck && npm test
cd SwimSyncAdmin && npm run typecheck && npm test      # the sgDisplay twin scans SwimSyncApp/features
npx tsc --noEmit --noUnusedLocals -p SwimSyncApp | grep -E 'features/<this-screen>/|app/.*<this-route>'   # must print NOTHING
git grep -nE "from ['\"]@/features/" -- SwimSyncApp/lib SwimSyncApp/components SwimSyncApp/store   # must print NOTHING (R7)
git grep -nE "^[^/]*Alert\.alert\(" -- SwimSyncApp/app SwimSyncApp/components SwimSyncApp/features | wc -l   # must be 1 — coach settings' native-permission branch (R8)
```

Green, or `git checkout -- .` and take a smaller step. **ASSERTION: jest 505 / 38 suites before**
(measured 2026-09-23) **→ 505 + N after**, N = characterisation tests added; moved tests keep their
count. A count that *drops* means a test was lost. Re-measure the vitest baseline at L0.

### L0 — the fence, widened

1. **Restructure `PAGES`** from an index-paired string list into entries
   `{ page, feature: string | null }`:
   - two routes may name the same `feature` (`change-password`);
   - `feature: null` (only `welcome.tsx`) means check 4 allows only React / RN / expo-router /
     icons / `@/components/*`;
   - `SCOPE_DIRS` becomes the **set** of non-null features, so no directory is walked twice;
   - the scan test keeps asserting every route exists and every feature dir exists.
   - **⚠ R7 — the null branch must BRANCH the regex**, not interpolate: a template of
     `@\/features\/${feature}\/` with `null` would allow a folder called `features/null`.
     ASSERTION: no entry's feature is the string `"null"`; a `feature: null` route importing
     `@/features/x/ui/y` goes red.
   - **⚠ R7 — the scan set is now DERIVED from PAGES, so a `features/<x>` folder no route names
     would never be scanned** (§7.233's shape). NEW ASSERTION in the scan test:
     `readdirSync("features")` minus the PAGES feature set = ∅ — red on an orphan folder.
   - **⚠ R7 — the old "SCOPE_DIRS/PAGES length mismatch" red-proof cannot exist any more.** Replace
     it with: a PAGES entry whose feature folder is missing → scan test red.
   Prove the restructure preserves the old behaviour first: with the three existing giants only,
   the 7/7 suite and each old red-proof still behave identically (§7.25 on the test itself).
2. Add all 24 routes. Hold each new feature dir open with a `.gitkeep` (deleted by that screen's
   commit — playbook §3).
3. **Empty-ledger red run — ASSERTION: checks 3 and 4 go red on exactly 107 + 76.**
   **⚠ R7 PROHIBITION: do NOT pin `components/ReferralSection.tsx` or `ChangePasswordScreen.tsx`.**
   Any difference is a finding — reconcile before pinning, don't pin the surprise silently.
4. Pin every site by file **and** content snippet, one pin per site; each `why` names the commit
   that removes it. **Prove each pin covers ONE site** (remove it alone → exactly one offender;
   the schedule 0b procedure). Where two lines join identically, say so in the `why`, as
   attendance did.
5. The six red-proofs from the header (ui→dao, dao→react-native, domain→helper + `fetch(`, an
   unpinned `@/lib` on a route, a failing `features/*/zz.test.ts`, a `toLocaleDateString()` in
   `domain/` red in **both** sgDisplay twins), plus: a `feature: null` route importing `@/lib/x`
   goes red; a shared-feature route importing the OTHER feature's `ui/` goes red. Breakers
   removed, suite green. Record it in the header like the three earlier 0b entries.
6. **⚠ R7 ASSERTION (every later commit, added to THE GATE):**
   `git grep -nE "from ['\"]@/features/" -- SwimSyncApp/lib SwimSyncApp/components SwimSyncApp/store`
   prints nothing (§7.250 — shared code never imports a feature).
7. **⚠ R1/R9 baselines, recorded in §11 before commit 2:** from one pre-branch run of the L4-F net,
   (a) `grep -c "still on /login after attempt\|form not ready"` across the driver logs, and
   (b) the idle network-request count (10 s after load) on Home, Billing, parent Attendance and
   coach Classes. Each L4 compares against these.

### Each lite screen commit (2–14)

Per screen, in this order, scripted (playbook §2 mechanics — assert-once replaces, destructure the
hook on each component's first line so JSX stays byte-identical, rebuild the route's import block
from symbol usage):

1. `features/<x>/{constants,types}.ts` if the route has module-level consts / local types.
2. `dao/<x>.repo.ts` / `.rpc.ts` / `.api.ts` — every `.from()`, `.rpc()`, `fetch(`, and
   client-taking `lib/` helper **bound** (`export const loadX = (id) => helper(supabase, id)`).
3. `domain/` — one hook per slice, returning exactly the names the route used; the store read
   here only; pure mapping extracted **with a characterisation test** (header comment says so,
   §7.25 exemption). Third-party side-effect packages (`expo-image-picker`, `expo-linking`) live
   here — **and so does `qrcode`**:
   - **⚠ R2 PROHIBITION (commits 8–10): the QR build stays inside the SAME `try` as today, in
     `domain/`, never in `ui/`.** On the public pages a throwing QR payload renders *"Invoice not
     found"* (`invoice/[token].tsx:62-98`, `package/[token].tsx:76-105`); paynow's has its own catch
     inside the load effect (`paynow.tsx:135-153`). Moving it to `ui/` moves the `try` boundary.
   - **⚠ R4 PROHIBITION: every `useCallback` / `useEffect` / `useFocusEffect` dependency array is
     copied byte-for-byte**; a hook never returns a freshly built object or function that becomes a
     dependency. Home's join-code effect (`home/index.tsx:287`, deps `[session, showToast, loadData]`)
     double-fires `join_tenant_by_code` if `loadData`'s identity churns; parent attendance chains two
     focus effects through `loadIdRef`.
   - **⚠ R4 PROHIBITION: load effects are called from the route's composition, never from a
     conditionally mounted `ui/` child** — the single inverse exception is `ReferralSection` (above).
   - **⚠ R4 — the store has 16 route readers + `ReferralSection`, not six.** Each selector is moved
     exactly as written: never `useAppStore()` whole, never a value captured at hook creation.
4. `ui/` — one file per surface, markup verbatim.
5. The route reduced to composition: < ~200 lines, **0 `useState`**, both ledgers' pins for this
   route deleted (the shrink test names them).
6. **Verbatim check by script** (ui blocks vs `git show HEAD:<route>`) and the **ordered-JSX check**
   (text + `className` + `testID` sequence equal) — prove the ordered check red on a swap once, at
   the first screen.
7. **⚠ R4 STEP:** `diff` every dependency array in the new files against `git show main:<route>` —
   the list of arrays must match one for one.
8. Gate. Commit message names the gate result and the pins removed.

**⚠ R8 — the money screens (commits 6–8), named prohibitions:**
- Do NOT deduplicate the two `claim_invoice_paid` paths (list card + invoice detail) or share code
  across features — the fence does not check `domain/` → other-feature imports, so nothing would stop it.
- Keep `setClaimingId(null)` BEFORE the error check; add no `try/finally`.
- Keep paynow's dependency array `[invoiceId, packageId]`, `packageId` taking precedence, and no
  cancel guard added.
- Keep `package-emails` fire-and-forget: not awaited, `.catch(() => {})` retained.

**⚠ R2 — the public token pages (commits 9–10), named prohibitions + assertions:**
- Do NOT use `supabase.functions.invoke` or any wrapper that adds `apikey` / `Authorization`. The
  functions allow only `Access-Control-Allow-Headers: content-type` (`public-invoice/index.ts:27`,
  `public-package/index.ts:27`), so the preflight would fail — and a failed fetch renders the same
  "not found" copy smoke-app expects, so **no driver could tell**.
- ASSERTION: `grep -rcE "functions\.invoke|Authorization|apikey" SwimSyncApp/features/public-*/` = 0.
- `FUNCTIONS_URL` keeps the literal `process.env.EXPO_PUBLIC_SUPABASE_URL` (Expo inlines only that
  exact form). ASSERTION: `grep -rn "process.env" SwimSyncApp/features/public-*` = exactly 2 hits, both
  in that form.

**⚠ R10 — register (commit 14):** keep the order signUp → best-effort `profiles` / `parents` updates →
`!data.session` check. Prod runs `mailer_autoconfirm: true` (§7.232), which is the branch drivers hit.

**Pure mappings to pin with characterisation tests** (the minimum; add where a hook holds a
decision): home — the per-child card derivation (package badge / trial / make-up lines);
child-profile — the balances + level lines; billing — the pending/paid/packages grouping and the
claimed-line state; invoice-detail — funding lines (already tested; test moves); parent-attendance —
the chip filter + empty-state selection (attendance-guard pins its distinct empty states);
coach-classes — Today grouping + week order. **For any `setX` sequence being extracted into a pure
function, write down which assignment wins first, and pin every pair** (playbook §5, Platform Stage 10).

### Commit 15 — the fence sub-batch

Per §7.2: each route passes checks 3 and 4. Any route that touches the client gets
`dao/<x>.{repo,rpc}.ts`; any route with state gets `domain/use<X>.ts`. `ui/` only where the
route would otherwise stay over ~200 lines. `welcome.tsx` moves nothing. **Login is on every app
driver's path — re-run `verify-smoke-app` first, alone, before the rest of L4-Fence.**

**⚠ R1 — a broken login PASSES ~25 drivers.** `loginExpo` retries 3× (`lib.mjs:40-72`): once
`signInWithPassword` has stored a session, attempt 2's `goto /login` is restored by `_layout.tsx`'s
`routeForSession` and redirected to landing — so a broken `setSession` / `router.replace` in the new
login hook is invisible. Only the one-shot `appLoginDies` helpers (coach-disable `:40-55`,
tenant-suspension `:58-73`) would see it.
- **STEP (fence commit):** login's sequence stays byte-identical — `setLoading(false)` → profile
  error check → `setSession` → `landingFor` → `router.replace`.
- **ASSERTION (L4-Fence):** the count of `still on /login after attempt|form not ready` across every
  driver log equals the L0 baseline (§2 L0 step 7) — a rise is a login regression, not noise.
- **STEP (L4-Fence hand-check):** a fresh browser context, parent then coach: fill, press Sign In
  ONCE, no reload → URL leaves `/login` within 10 s and lands on `/home` / `/schedule`. A wrong
  password shows the `friendlyAuthError` message.

### L4 — after each sub-batch

**Never edit a route while a driver is running against it.** Before the FIRST driver of each L4:
start Expo **without** `CI=1` (§7.253), `curl` the entry bundle and grep for a symbol only the
newest commit has (e.g. the newest hook's name). Reach anything visual by TAP, not deep link (§7.254).
`run-all-drivers.sh --only` takes ONE name — loop.

| L4 | Driver net (each run to completion; RUNTIME check counts recorded in §11) | Hand-checks (screenshot named in the commit / §11) |
|---|---|---|
| **F** | smoke-app, packages, multi-class, makeups, trial-visibility, tenant-suspension, tenant-branding, parent-claim, parent-address, join-code, student-identity, level-skills, levels, edit-child | **⚠ R5** — two Home writes NO driver reaches: (1) **register WITH a join code → first Home load**: the "Joined …" Toast shows, `parents.signup_join_code` is NULL, the `parent_tenants` row exists (`home/index.tsx:287-311`); (2) **dismiss a declined claim** (`dismiss_student_claim`, `:104-106`) and it stays dismissed after reload |
| **G** | smoke-app, parent-pay-claim, packages, paynow-fallback, tenant-branding, payment-collection | invoice-detail *I've paid* (one dialog, claimed state, survives reload); ReferralSection renders the code + Copy on a seeded referral code; **⚠ R2** `/package/<valid token>` logged OUT **and** logged IN: price, a `data:image` QR, *I've paid* — and the request headers are content-type only; **⚠ R5** billing `cancelRequest` (`billing/index.tsx:338-350`): row `cancelled`, list refreshes |
| **H** | smoke-app, parent-attendance, attendance-guard, paynow-fallback, coach-roster, stale-screen, join-code, parent-address, tenant-branding, student-identity, level-skills, levels, trial-visibility, trials | coach settings QR upload (pick + upload, the image shows); **⚠ R5** coach **Sign Out** (`settings/index.tsx:171-184`): confirm → `/login`, reload stays out — drivers' `signOut` only clears localStorage |
| **Fence** | smoke-app **first, alone**; then coach-wages, parent-address, join-code, coach-disable, tenant-suspension, payment-collection, **+ one parent and one coach `loginExpo` driver end to end** (edit-child, schedule-week) | **⚠ R1** the one-shot login check (above); change-password submit (both roles); forgot-password submit (message shown; Mailpit receives the mail); reset-password via a real recovery link; grade save on a real student; **⚠ R5** the FULL accept-invite flow — `[local_smtp]` is configured and `SwimSyncAdmin/app/api/invite-parent/route.ts:133` links to `localhost:8081/accept-invite`: open from Mailpit, set password, sign in with it; parent **Sign Out** (`profile/index.tsx:20-32`) |

**⚠ R5 STEP: every hand-check script's fixture write THROWS on error** (§7.251) — a silently failed
seed makes a hand-check vacuously green.

**⚠ R9 — stale bundle / port, before the first driver of EVERY L4:**
- ASSERTION: the process on `:8081` is the Metro started this session without `CI=1`
  (`lsof -iTCP:8081 -sTCP:LISTEN` PID = the one this session launched). level-skills, levels and others
  hardcode `localhost:8081`, so a stale server there passes them.
- STEP: grep the bundle the page ACTUALLY loads (the `<script src>` in the served HTML, §7.238) — not
  just the entry — for the newest hook's name.
- ⚠ R4 ASSERTION: the idle request count on each of this sub-batch's screens equals the L0 baseline.

**A red at L4 is bisected by screen** — `git bisect` across that sub-batch's commits with the
failing driver as the test. A cold-compile red is §7.108 first: re-run once before reading it as
a regression. The known flake `verify-tenant-suspension` (10/12 on `35753594101`, 12/12 six hours
later on the same code) sits in L4-F and L4-Fence: **one red is a re-run; two reds are a bisect.**
**⚠ R1 PROHIBITION: that flake rule covers ONLY its admin `/platform`-vs-`/dashboard` checks.** A red
"control: the parent logs in" / "parent still logs in" check is never a flake — it is R1.

### Ship (after L4-Fence + the D6 review)

0. **⚠ R3 STEP — the full sweep, locally, at the branch head, BEFORE `/deploy`.** Several coach
   drivers log in and pass through changed code but sit in no L4 net (trial-onboarding, tz-saturday,
   unmarked-lessons, bulk-setall, cancel-lesson, admin-lesson-detail, schedule-week, makeups, trials),
   and the nightly otherwise runs only AFTER the app is live. `run-all-drivers.sh` (~80 min).
   **ASSERTION: 52/52**, the only tolerated exception being tenant-suspension's admin-side checks,
   re-run once. This adds to D1's one nightly; it does not replace it.
1. The D6 review: `git diff main...refactor/app-lite-fgh` read as a senior engineer for behaviour
   drift in moved code — a `try` boundary that moved (playbook §5), an effect's deps changed, a
   `setX` order inverted, a comment left behind, an `Alert.alert` introduced (RN-web no-op), **a
   dependency array that differs from `git show main:<route>` (R4), a QR build outside its `try` (R2)**. Fix in
   commit 16, re-gate, re-run the drivers the fix touches.
2. `/deploy`: it classifies this as **app-only** (0 migrations, 0 edge functions), so the only
   gate is CI + both Vercel builds green. `git merge --ff-only`, `git push origin main`.
3. **No served-bundle grep for a user-visible string is possible** (rule 0). **⚠ R9 ASSERTION:** the
   `_expo/static/js/web/entry-<hash>.js` swimsync.sg serves DIFFERS from the pre-deploy hash (record it
   before the push), and it contains a hook name only this branch has. Plus CI + Vercel green, and
   the live login screen + one parent screen load by hand.
4. Dispatch the nightly on the new `main` SHA; **it is the gate for the next unit** — read it from
   the log, not the badge.

---

## 3. The risks — ranked by /plan-review; each mitigation lives INLINE under its step (`⚠ R<n>`)

1. **R1 login regression hidden by `loginExpo`'s retry** → Fence commit + L4-Fence.
2. **R2 public payment pages** (CORS headers, QR `try` boundary, env inlining) → commits 8–10, L4-G.
3. **R3 the app ships before any full sweep** → Ship step 0.
4. **R4 hook extraction: effect loops / double fires / store selectors** → every lite commit, L4.
5. **R5 writes no driver reaches** → hand-checks in each L4 row.
6. **R6 sgDisplay path pins** → §1 lib verdicts, commits 6–9.
7. **R7 a weakened fence** → L0 steps 1, 3, 6; THE GATE.
8. **R8 money-screen sequencing** → commits 6–8.
9. **R9 stale bundle / port** → every L4 + Ship.
10. **R10 register ordering** → commit 14.
- (plan's own) **one nightly for ~7,300 moved lines** — mitigated by per-sub-batch L4 + R3's full local sweep.
- (plan's own) **scale / stopping mid-run** — stop only at a sub-batch boundary with its L4 green; nothing
  lands on `main` early; the branch is resumable.

---

## Pre-commit gate — walk before EVERY commit

- [ ] THE GATE block green (both apps' typecheck + tests, `--noUnusedLocals` filter empty, R7 + R8 greps)
- [ ] jest count = previous + characterisation tests added (never lower)
- [ ] this screen's pins deleted; the shrink test is green
- [ ] dependency arrays diffed against `git show main:<route>` (R4)
- [ ] verbatim + ordered-JSX scripts pass
- [ ] commits 6–9: sgDisplay pins repointed in BOTH twins, twin lists identical (R6)
- [ ] commits 8–10: QR inside the original `try`; no `functions.invoke`/`Authorization`/`apikey`; `process.env` literal ×2 (R2)

**The highest-value three, a blocker if they cannot be ticked:** R3's full local sweep 52/52 before
`/deploy`; R1's one-shot login hand-check; R7's orphan-folder assertion in the fence.

---

## 11. Stage log

| # | Commit | Gate | Notes |
|---|---|---|---|
| L0 | `4852b31` | jest 506/38 · vitest 855/87 · both typechecks | red on exactly 107 + 76; 99 + 76 entries; all 175 proven single-owner (7 multi-site entries named) |

**Baseline (pre-branch code, 2026-09-23, L4-F net):** smoke-app 73/73, packages 21, multi-class 17/17,
makeups 15/15, tenant-branding 6/6, parent-claim 21/21, parent-address 6/6, join-code 7/7,
student-identity 13/13, level-skills 14/14, levels 9/9. **trial-visibility ✗ and tenant-suspension 10/12
were caused by THIS SESSION**, not the product — see §12 F1 — and are re-run clean below.

## 12. Findings for `/update-docs`

- **F1 — On RN-web, ANY imported file going missing breaks the WHOLE app bundle, not the screen.** A
  `git mv lib/referralShare.ts` made while the baseline drivers ran put Expo's error overlay over every
  route (Metro serves one web bundle); `trial-visibility` died on "error-overlay intercepts pointer
  events" at its login click, and `tenant-suspension`'s first app login returned `null`. The playbook's
  "never edit the page while a driver runs" is too narrow: **never move, delete or break-import ANY
  imported module (lib/, components/, a route) while a driver runs.** Creating NEW, not-yet-imported
  files is safe. → GOTCHAS candidate + playbook §4.
- **F2 — The nightly "tenant-suspension flake" is its parent-login CONTROL, not the admin checks.**
  `35753594101`'s two FAILs were `control: the parent logs in before the suspend` and `…sees children of
  BOTH businesses` — the driver's FIRST app page load, a one-shot `appLoginDies()` with a fixed 7 s
  hydrate wait that returns `null` (read as FAIL) when the form never appeared. That is the cold-compile
  shape (§7.108), not a product fault. HANDOVER §9's 2026-09-23 note named the wrong checks; corrected at
  close. The plan's R1 prohibition stands for the post-suspend parent checks, not this control.
