# The feature-tier refactor playbook

_How every oversized page or screen in SwimSync gets decomposed, in both apps. Written
2026-09-12 from the Students pilot (`STUDENTS_PAGE_REFACTOR_PLAN.md`), which took
`SwimSyncAdmin/app/(admin)/students/page.tsx` from 2,284 lines and 68 `useState` calls to
165 lines and none, in twelve commits, with every UI driver green at every step. **This is
the method. The Students plan is the worked example.** Read that plan for the reasoning
behind each decision; read this for what to do._

**Who this is for:** every session that opens a page or screen in either app. **The end
state, decided 2026-09-12, is that EVERY page follows the shape in §1** — not just the
giants. What varies with size is the *ceremony*, not the shape: §7 defines three tracks.
The seven giants (`packages/page.tsx` 2,014 lines, `invoices/page.tsx` 1,748,
`classes/page.tsx` 1,714, `platform/page.tsx` 1,395, `lessons/[classId]/[date]/page.tsx`
912, and in the coach app `(coach)/schedule/index.tsx` 1,255,
`(coach)/classes/[id]/attendance.tsx` 1,183, `(coach)/classes/[id]/roster.tsx` 905) take
the full twelve stages of §2, **one at a time, and never start the next until the last has
survived a nightly sweep** (plan §11). Everything smaller takes the lite or fence track
(§7), **in batches**, one nightly per batch.

---

## 0. The rule that makes the rest safe

**Nothing here changes behaviour.** Every stage is a Fowler refactor: the code moves, the
suite stays green, the UI drivers stay green. If a stage would need a behaviour change to
work, stop — that change is a `BACKLOG.md` item, not a stage. (The Students page carries
tenant *package* settings that belong on the Packages page. They were extracted **in place**
into `domain/usePackageSettings.ts` and left there. That is the shape of the rule.)

Consequences you accept up front:

- **No served-bundle grep is possible** (§7.31). There is no user-visible string only the
  new build has. CI plus the drivers are the deploy check, exactly as §8.98.
- Any test you write during the refactor is a **characterisation test**: it pins behaviour
  that already exists, so §7.25's prove-it-red rule cannot apply. Say so in the test's
  header comment. The boundary test (Stage 0b) is the one exception — it is a new rule, so
  §7.25 applies in full.
- `git blame` on moved lines points at the refactor commit. One slice per commit keeps
  `--follow` useful.

---

## 1. The shape

```
<feature>/
  page.tsx | index.tsx   # composition only — hooks composed, one mount effect, JSX. ~150 lines
  constants.ts           # the module-level consts the page had
  types.ts               # the feature's entity types (see §4 of the Students plan)
  ui/                    # one file per surface: toolbar, table, each modal, the drawer
  domain/                # one hook per slice (useX.ts), pure helpers beside them, + tests
  dao/
    <feature>.repo.ts    # every .from()   → PostgREST tables
    <feature>.rpc.ts     # every .rpc()    → Postgres functions   ⚠ see §3 below
    <feature>.api.ts     # every fetch()   → app/api/* routes (admin only)
```

The only permitted dependency direction:

```
page  →  ui  →  domain  →  dao  →  (PostgREST | rpc | /api)
```

- `ui/` may import `domain/` (for state types and pure helpers), `@/components/*`, and
  `@/lib/*` pure helpers. It may **never** import `dao/`.
- `domain/` may import `dao/`, `@/lib/*`, React, and a shared hook from `@/components`
  (`useDebouncedValue`). It owns all `useState`.
- `dao/` may import the supabase client and `@/lib/*` pure helpers. **Never React, never
  `ui/`, never `@/components`.**
- `page.tsx` imports **only** `./ui/*`, `./domain/*`, `./constants`, `./types`, React,
  Next, and `@/components/*`. **Never `@/lib/*`, never `./dao/*`.** Anything the page
  seems to need from `lib/` belongs in a `domain/` hook or a `ui/` component instead.

`constants.ts` and `types.ts` are the **feature root**, not `lib/`. `lib/` is for code
shared across features or across apps (Students plan §6 has the criterion and the list of
`lib/` modules that must not move).

### Where the folders go — this differs between the apps

| | Admin (Next.js) | Coach / parent app (Expo Router) |
|---|---|---|
| Route file | `app/(admin)/<page>/page.tsx` | `app/(coach)/<screen>/index.tsx` or `[id]/x.tsx` |
| Tier folders | **Beside the route:** `app/(admin)/<page>/{ui,domain,dao}/`. Next only routes `page.tsx` / `route.ts`, so a sibling folder is never a URL | **Outside `app/`:** `SwimSyncApp/features/<screen>/{ui,domain,dao}/`. Expo Router treats **every** file under `app/` as a route and warns about missing default exports — a `domain/useX.ts` beside the screen would become `/coach/schedule/domain/useX` |
| Import path | `./domain/useX` | `@/features/<screen>/domain/useX` |
| Unit tests | `domain/*.test.ts`, picked up by vitest automatically | `jest.config.js` `testMatch` is `**/lib/**/*.test.ts` — **widen it to `**/features/**/*.test.ts` in the same commit as the first test**, or the tests silently never run |
| Source-scan guards | `sgDisplay.drift.test.ts` scans `SwimSyncAdmin/app` — covered for free | `SCAN_DIRS` in **both twins** of `sgDisplay.drift.test.ts` must gain `SwimSyncApp/features` in the same commit as the folder. A scan that misses a folder stays green while checking less (Students plan §12) |
| The client | `@/lib/supabase` | `@/lib/supabase` (same name, different file) |
| RN-web | — | `Alert.alert` is a no-op on web; anything you move keeps using `confirmAction` / Toast. A previous screen stays mounted under the current one (§7.10, §7.58) — keep that in mind when a `ui/` component asserts on text |

**A coach screen's `dao/` will be small.** Most coach reads already go through `lib/`
helpers that take the client as an argument (`attendanceRoster`, `coachRoster`, …). Those
helpers do not move — they are drift-pinned or shared. **Bind them in `dao/<screen>.rpc.ts`
or `.repo.ts`** (`export const loadRoster = (id) => coachRoster.load(supabase, id)`) so the
screen and its hooks never touch the client. That one move is what took the Students page's
check-3 ledger to zero at Stage 3.

---

## 2. The stages — one commit each, gate green at each

**The gate, every stage, no exceptions:**

```bash
cd SwimSyncAdmin && npm run typecheck && npm test     # admin
cd SwimSyncApp   && npm run typecheck && npm test     # coach app
```

Green or `git checkout -- .` and try a smaller step. Never "fix it in the next commit".

| Stage | What | Notes from the pilot |
|---|---|---|
| **0** | **Write the plan** (`docs/refactor/<FEATURE>_REFACTOR_PLAN.md`): measure the file, list the slices by state-prefix cluster, list every `lib/` import with a move/stay verdict, list the drivers that open this page (§4 below). Settle the folder question for this app | Half a day. It is what makes the rest mechanical |
| **0b** | **Widen `tierBoundaries.drift.test.ts`** to this feature (§3). Pin every current violation in the ledgers. Prove each check RED by breaking it on purpose, revert | The check-3 ledger (data access outside `dao/`) and check-4 ledger (page imports) are the progress meter |
| **1** | `constants.ts` + `types.ts`, verbatim, with their comments | Trivial by design; it settles the folder convention on zero-risk lines |
| **2** | `dao/<feature>.repo.ts` — every `.from()`, as a thin function returning the raw `{ data, error }`. **No logic, no mapping.** The page's error handling must not change by one character | Comments on a query travel with it. A multi-line builder that opens `supabase\n.from(` needs a snippet pinned by table (the drift test joins the two lines for you) |
| **3** | `dao/<feature>.rpc.ts` + `.api.ts`, and **bind the client-taking `lib/` helpers** | After this the page imports no client at all. The rpc file's header carries the *orchestrate, never replace* prohibition — copy it |
| **4** | The list slice: the pure half (`domain/<feature>Rows.ts` — row → entity mapping, filters, labels) **with characterisation tests**, then the stateful half (`domain/useXList.ts` — state, `load()`, the search effect), then the toolbar/notices `ui/` | `load()` is returned from the hook because every write handler awaits it. Keep the mapping pure so it gets the page's first unit tests |
| **5–10** | One slice per commit, smallest and most similar first: `domain/useX.ts` (state + handlers, taking `reload`) + `ui/XModal.tsx` (markup verbatim, taking the hook's state as one prop). Move a `lib/` module into `domain/` **only** when this page is its sole code importer — `grep -rln` first, and check the hit is not a comment | The page's drawer/actions buttons follow the *close first, then open* order (§7.10); keep it in one helper in the drawer component, not seven copies |
| **11** | Table → `ui/XTable.tsx` (with its `useTableSort`), header → `ui/XHeader.tsx`. Delete the dead imports. **Both ledgers to zero.** | `tsc` does not flag unused imports — grep for each symbol after every cut |

**Order inside 5–10** for the Students page was: rename + add-to-class + status (3 small
ones in one commit) → merge → add-student → contact + invite → grading → drawer + package
settings. Small and similar first, because the third one is fast and the pattern is proven
before the medium-risk slices.

### The mechanics that kept each move exact

- **Script the cut, assert the count.** Every page edit was a Python script of
  `replace(old, new)` calls that **assert the old text occurs exactly once**, plus
  marker-to-marker cuts. An assertion failure means the file drifted (a nested indent, a
  comment moved) and nothing was written. Keep the scripts in the scratchpad, not the repo.
- **Markup moves verbatim.** A `ui/` component is the JSX block with `foo` → `p.foo` and
  handlers → the hook. Nothing else. Reflowing, renaming or "tidying" is a second change
  hiding inside the first.
- **Comments travel with the code they explain.** Load-bearing ones (`⚠ READ OFF THE JOINED
  ROW`, `FAILS CLOSED, AND MUST`) especially. A comment left on the page pointing at code
  that is now three folders away is worse than none.
- **The hook returns exactly the names the page used**, so the destructure at the top of the
  page is the only line that changes for the callers. Add `open()` / `close()` to a hook only
  when the page had the same two or three `setX` calls repeated at every trigger.
- **Grep after every stage for the symbols that should be gone.** `typecheck` passes with
  a dead `import { Modal }` and a dead `useRef`. The scripts print a count per symbol at the
  end; zero is the target.

---

## 3. The boundary test

`SwimSyncAdmin/lib/tierBoundaries.drift.test.ts` is the fence. It is a source-scanning
vitest file (the repo's idiom — there is no ESLint, and adopting one mid-refactor is a
second project). Four checks over `SCOPE_DIRS`:

1. no `ui/` file imports `dao/`
2. no `dao/` file imports React, `ui/`, or `@/components`
3. no file outside `dao/` uses the supabase client or calls `fetch(`
4. the page imports only its own tiers, React, Next and `@/components/*` — never `@/lib/*`

**To add a second page:** append its folder to `SCOPE_DIRS`, and generalise `PAGE` into a
list of page files (one per scoped dir). Checks 3 and 4 will be red on day one — that is
correct. Pin every current violation in `ALLOWED_DATA_ACCESS` / `ALLOWED_PAGE_IMPORTS`
**by file AND content snippet, never file-level**, each with a `why` naming the stage that
removes it. The sixth test fails on any entry that no longer matches, so the ledger can only
shrink. **Never add an entry after Stage 0b.** A new violation is a new violation.

**For the coach app**, write the jest twin (`SwimSyncApp/lib/tierBoundaries.drift.test.ts`,
same body, jest globals — the `sgDisplay.drift.test.ts` pair is the template) scoped to
`features/<screen>`, and make check 3's client pattern match `@/lib/supabase` there too.
Add the file to `testMatch` if it lives outside `lib/`.

Prove every check red before trusting it: drop a `ui/Break.tsx` that imports `../dao/x`,
a `dao/break.ts` that imports React, a `domain/break.ts` that calls `fetch(`, and swap one
lib import on the page. Watch each fail, delete them, confirm green. Say so in the header.

---

## 4. Verification — the drivers are the net, and the plan's list can be wrong

**Find the drivers that actually open this page. Do not trust a name.**

```bash
cd .claude/skills/run-ui-playwright/drivers
grep -lE '/<route>"|/<route>`' verify-*.mjs        # e.g. /students, /packages
grep -n 'localhost:3000\|localhost:8081' <each>    # hardcoded ports?
```

The Students plan credited `verify-student-identity` with rename, merge and add-unclaimed.
It is a **coach-app** driver and never opens the admin Students page. The real net was
`contact-details`, `active-inactive`, `multi-class`, `parent-claim`, `levels`,
`level-skills` and `class-students`. Two of those hardcode `localhost:3000` / `8081` and can
only run against a worktree through a port-substituted copy:

```bash
sed 's|localhost:3000|localhost:3100|g; s|localhost:8081|localhost:8082|g' verify-X.mjs > verify-zz-X-3100.mjs
cp fixtures-X.sql fixtures-zz-X-3100.sql       # run-all-drivers.sh maps fixtures by driver name
ADMIN_URL=http://localhost:3100 EXPO_URL=http://localhost:8082 ./run-all-drivers.sh --only zz-X-3100
rm verify-zz-* fixtures-zz-*                    # before committing anything
```

**Then:**

- **Run the relevant drivers at the end of the slice that touches them, not once at the
  end.** Batching destroys the one property small commits buy — knowing which step broke it.
- **Run all of them again after the last stage.** Eight drivers, twenty minutes, on the
  finished page.
- **An action no driver covers gets a hand check with a screenshot** (Merge and Rename on
  the Students page: `Review & merge` → modal → `Merge them`, pair count drops). Say in the
  commit message that it was by hand, and file a BACKLOG item for the missing driver.
- **A red on a cold dev server is §7.108 first.** `verify-assessment` went 23/27 on the
  first hit of an uncompiled route and 27/27 warm, with zero lines of the assessment page
  changed. Re-run before reading it as a regression.
- The drivers **reset the shared database** per run (`run-all-drivers.sh`). Own the DB, or
  announce to the session that does, before starting one. **Never edit the page while a
  driver is running against it** — the dev server hot-reloads your half-finished cut into
  the test. Prepare the next stage's `domain/` and `ui/` files (nothing imports them yet)
  while you wait; apply the page script after.

---

## 5. Pitfalls met on the pilot, so you do not meet them again

- **A `lib/` helper that takes the client as an argument is still a network reach.** Three of
  them kept `@/lib/supabase` on the page after every `.from()` and `.rpc()` had moved. Bind
  them in `dao/`.
- **Shared state across slices.** `classOptions` (add-to-class) is also read by the
  Add-student picker; `tenantId` (package settings) is needed by grading and the duplicate
  check. Keep it in the hook that loads it and pass it down; do not duplicate the fetch.
- **Hook order changes across a refactor are fine**; only within a render must it be stable.
  `useAddStudent(tenantId, load)` moved below `usePackageSettings()` because it needs the
  value — that is allowed.
- **A `try` boundary can move when a call moves.** `getSession()` sat outside the invite
  handler's `try`; inside `dao/<feature>.api.ts` it is inside. Strictly a change, and a safer
  one — but note it in the commit rather than pretend it is not one.
- **`innerText` uppercases CSS-uppercased headings.** A hand-check regex for `Kept` failed
  on `KEPT`. Assert case-insensitively.
- **The plan's line-count estimate was 2–3 days.** It took one session, because the stages
  were small enough that none needed debugging. Keep them that small.

---

## 6. Definition of done, per page

- [ ] `page.tsx` / `index.tsx` under ~200 lines, **zero `useState`**, imports only its tiers
- [ ] both boundary ledgers **empty**, header comment updated with the dates
- [ ] `domain/` has at least the pure mapping under characterisation tests
- [ ] every `lib/` module moved into `domain/` had exactly one code importer, and its test moved with it
- [ ] each stage is one commit, message names the gate result and the drivers run
- [ ] every driver that opens the page was run after its slice **and** after the last stage
- [ ] uncovered actions hand-checked, and a BACKLOG item filed for the missing driver
- [ ] the page's plan doc marks every stage with its commit, corrects its coverage table,
      and lists findings for `/update-docs` in its §12
- [ ] nothing in `HANDOVER.md` / `PRD.md` / `BACKLOG.md` touched from a worktree — those are
      written from `main` at close
- [ ] **the next page does not start until this one has survived a nightly sweep**

---

## 7. The three tracks — same shape everywhere, ceremony scaled to size

_Added 2026-09-12, when the queue was set to "every page", not "the seven giants". The
twelve stages of §2 are the right cost for a 2,000-line page and the wrong cost for a
400-line one: on the pilot the expensive parts were the plan doc (half a day), the twelve
gated commits, and the driver run per slice. A page that fits in one head does not need
them. What every page DOES need is the fence (§3) — that is the part that makes "the same
code architecture" a fact the test runner can check rather than a sentence in a document._

**The counts (from `wc -l` on 2026-09-12, not prose — re-measure before planning a batch):**

| Track | Size | Admin | Coach/parent app | Lines |
|---|---|---|---|---|
| **Full** (§2, twelve stages, own plan doc) | > ~900 | 5 remaining | 3 | ~11,100 |
| **Lite** (below) | ~250 – ~900 | 21 pages | 13 screens | ~16,200 |
| **Fence** (below) | < ~250 | 5 pages | 10 screens | ~2,600 |

Layouts (`_layout.tsx`) and `app/page.tsx` (5 lines) are not pages and are out of scope.

### 7.1 The lite track — three commits per page, batched

Same §1 shape, same §3 fence, same rule 0 (zero behaviour change, markup verbatim,
scripted cuts). What is dropped: the per-page plan doc, the twelve-way split, and the driver
run per slice.

| Commit | What | Gate |
|---|---|---|
| **L0** (once per batch) | Widen `tierBoundaries.drift.test.ts` to every page in the batch; pin the ledgers; prove red; one batch plan doc (`docs/refactor/BATCH_<n>_PLAN.md`, one table: page, lines, `useState` count, `lib/` verdicts, drivers) | typecheck + unit tests |
| **L1** | `constants.ts` + `types.ts` + the whole `dao/` (`.repo`/`.rpc`/`.api`, client-taking `lib/` helpers bound) — §2 stages 1–3 in one cut | typecheck + unit tests |
| **L2** | `domain/` — every hook, the pure mapping with its characterisation test — §2 stages 4–10's hook halves in one cut. The page still renders its own JSX | typecheck + unit tests |
| **L3** | `ui/` + the page reduced to composition — §2 stages 4–11's markup halves. Both ledgers to zero for this page | typecheck + unit tests |
| **L4** (once per batch) | **Run every driver in the batch's net** (§4), plus the smoke driver (§7.3). Hand-check anything no driver opens, with a screenshot named in the commit | drivers green |

A page under ~400 lines with ≤ 5 `useState` may take L1–L3 as **one commit** — the
split exists so a driver red at L4 bisects to a page, not to a tier; one commit per page
is enough for that.

**Batch rules:**

- **3–5 pages, ≤ ~2,500 lines per batch** — about one giant's worth of risk, so one
  nightly proves the same amount either way.
- **Group by driver net, not by alphabet.** Pages the same drivers open go together, so L4
  is one run, not five. The route → driver map is `grep -lE '\$\{ADMIN\}/<route>'` over
  `verify-*.mjs` (§4) — a name is not evidence.
- **Typecheck + unit tests per commit still, no exceptions.** They take seconds. What is
  batched is only the *driver* run and the nightly, because those take twenty minutes and a
  night.
- **A red at L4 is bisected by page, not debugged in place:** `git bisect` across the
  batch's commits with the failing driver as the test. That is the property the one-commit-
  per-page floor buys.
- **One nightly per batch**, then the next batch. Never two batches in flight.
- **Never widen the ledger mid-batch.** L0 pins every violation; after that a new entry is
  a new violation (§3).

**Suggested batches** (by driver net; re-derive from the map before starting one — drivers
move):

| Batch | Pages | Lines | Driver net |
|---|---|---|---|
| **Admin L-A** people | `coaches` `admins` `parents` `unassigned` `claims` | 2,447 | coach-disable, admins, active-inactive, trial-visibility, parent-claim |
| **Admin L-B** calendar | `attendance` `substitutes` `holidays` `calendar` `lessons` (list) | 2,387 | admin-lesson-detail, coach-roster, admin-calendar, cancel-lesson; **holidays: none → smoke** |
| **Admin L-C** money | `wages` `credit-notes` `referrals` `accounting` | 2,309 | coach-wages, referrals; **credit-notes, accounting: none → smoke** |
| **Admin L-D** grading | `levels` `trials` `makeups` `assessment` (+ `assessment/[classId]`, fence) | 2,667 | levels, levels-table, level-skills, assessment, trials, contact-details, makeups |
| **Admin L-E** rest | `dashboard` `locations` `history` | 1,161 | join-code, orphan-report, platform-admin, locations; **history: none → smoke** |
| **App L-F** parent home | `home` `add-child` `child/[id]` `edit-child` | 1,886 | parent-claim + every parent-role driver that lands on Home |
| **App L-G** parent money | `billing` `invoice/[id]` `paynow` `invoice/[token]` `package/[token]` | 2,023 | payment-collection, parent-pay-claim, paynow-fallback, package-renewal |
| **App L-H** rest | `attendance` (parent) `settings` (coach) `classes/index` (coach) `register` | 1,606 | coach-roster; **register, parent attendance: goto-less — see the caveat** |

**Caveat for the app map:** coach/parent drivers mostly navigate by *tapping tabs* after
login, not by `goto`, so the route → driver grep under-reports them. For an app batch, read
the drivers for the **role** they log in as, not for the route string.

### 7.2 The fence track — the page must pass the fence, nothing more

For pages under ~250 lines (auth pages, `welcome`, `profile`, `pay`, `grade`, `contact`,
`join-tenant`, `assessment/[classId]`). The §1 folders are **not required**: a 130-line
login page does not need `ui/`. What it needs:

1. Added to `SCOPE_DIRS`; the page passes **checks 3 and 4** (no client, no `@/lib/*`).
2. If it touches the client: a `dao/<page>.repo.ts` / `.rpc.ts` with the calls, and a
   `domain/use<Page>.ts` if it has any state at all. Otherwise nothing moves.
3. **All fence pages of one app in one commit**, gated by typecheck + unit tests + the smoke
   driver. That is the whole track: about an hour per app.

### 7.3 The smoke driver — the net for pages no driver opens

Seven admin pages (`credit-notes`, `holidays`, `accounting`, `history`, `accept-invite`,
`reset-password`, `forgot-password`) and most small app screens are opened by **no driver
at all** (map of 2026-09-12). Before the first lite batch, write **one** driver,
`verify-smoke-admin.mjs` (and a twin for the app, by role): log in, `goto` every route once,
assert the page's `h1`/title is present and the console logged no error. Cheap (S), and it
becomes the L4/fence net for every page the specialised drivers skip. File it in
`BACKLOG.md` if it is not written yet; do not start a batch whose net is "none" without it.

### 7.4 The order, and what it costs

**One unit = one page (full) or one batch (lite/fence), each followed by one nightly.**
Seven full + eight lite + two fence = **seventeen units**. The pilot took one session per
full page; a lite batch is about one session; a fence commit an hour. So the whole
programme is **~15 working sessions and at least 17 nightlies — three to four weeks of
calendar time if a unit lands every day, longer interleaved with features.** It is meant to
be interleaved: nothing here blocks a feature, and a feature landing on a not-yet-refactored
page just does that page's lite treatment in the same branch.

Recommended order:

1. **The smoke driver first** (§7.3) — an hour, and every later unit is safer for it.
2. **One lite batch** (Admin L-A) — proves the fence generalises to N pages and that L1–L3
   holds, on the cheapest pages. If the lite track needs changing, better to learn it here.
3. **`packages` (full)** — the second giant confirms the §2 pattern; then the dao split
   graduates to `docs/ARCHITECTURE.md` (BACKLOG).
4. Alternate: giant, batch, giant, batch. Fence commits whenever a nightly is spare.

### 7.5 Definition of done — the programme

- [ ] every route file in both apps is in `SCOPE_DIRS` of its app's boundary test
- [ ] both ledgers empty in both apps — the fence holds with no exceptions listed
- [ ] every full-track page meets §6; every lite page has `page.tsx`/`index.tsx` under
      ~200 lines and zero `useState`; every fence page passes checks 3 and 4
- [ ] `jest.config.js` `testMatch` covers `features/`, and `SCAN_DIRS` in both twins of
      `sgDisplay.drift.test.ts` covers it too (§1's table)
- [ ] the smoke drivers are in `run-all-drivers.sh`'s nightly set
- [ ] the dao three-way split and the "orchestrate, never replace" rule are in
      `docs/ARCHITECTURE.md` §6, and this playbook points at them
