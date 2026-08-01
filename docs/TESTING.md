# SwimSync — Test catalog and UI drivers (§5)

_Split out of `HANDOVER.md` on 2026-07-26. This is the **catalog**: what each suite covers
and which UI driver proves what. The **commands** for running them live in
`LOCAL_DEV_GUIDE.md`._

> **The test runner is the fact; the counts below are the hint.** Any number here is true
> as of the date beside it and drifts the moment a suite is added. `supabase test db`,
> `supabase/functions/generate-invoices/test.sh`, and `npm test` in each app are the
> authority.

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

## 5. Running the tests

Backend integration tests run against the **local** stack (prereq:
`supabase start`) and are hermetic (self-seed + roll back / tear down). Frontend
tests are plain unit/component tests (no stack needed). All four suites — plus a
`tsc --noEmit` typecheck of **both** apps — run in CI on push/PR to `main`
(`.github/workflows/ci.yml`).

```bash
# Backend — Database tests (pgTAP): triggers, RLS, constraints, §11 edge cases
supabase test db                                  # 397 tests across 22 files

# Backend — Function tests (Deno): billing math, credit + package ledgers, emails
supabase/functions/generate-invoices/test.sh      # 108 tests; needs deno (brew install deno)

# Frontend — Admin (Next/React) component + logic tests (vitest)
cd SwimSyncAdmin && npm test                       # 151 tests

# Frontend — Mobile (Expo/RN) unit tests (jest-expo)
cd SwimSyncApp && npm test                         # 91 tests
```

**Full test catalog** (all suites are hermetic — self-seed + roll back / tear down):

_pgTAP DB tests — `supabase/tests/*.test.sql` (run by `supabase test db`):_

| File | Covers |
|------|--------|
| `constraints.test.sql` (4) | one-invoice-per-parent-per-month, one active enrolment per student, positive-only credit applications, credit notes immutable to app roles |
| `credit_note_trigger.test.sql` (11) | the `handle_attendance_update` auto credit-note trigger (billable→non-billable on an invoiced lesson); **11.6** the correction leaves the original invoice intact (not modified/deleted) and the note links back to it |
| `rls_isolation.test.sql` (10) | RLS parent/parent isolation + superadmin sees all; **11.3** a parent sees all their children across coaches while each coach sees only students in their own classes |
| `edge_cases.test.sql` (9) | PRD §11: **11.2** a child created before assignment defaults to unassigned with an empty (not error) class view, **11.4** no bare `trial` status, **11.5** re-enrol after unenrol keeps history, **11.8** unenrol leaves `credit_balance` untouched |
| `tenant_isolation.test.sql` (24) | cross-tenant isolation across **two full tenants** — neither can see the other's families, classes, coaches, invoices, credit notes or attendance (§8.1) |
| `coach_wages.test.sql` (36) | effective-dated wage rates, the pay-decision table (§7.13), pro-rata duration maths, flat rates, draft→frozen payouts, and next-period adjustments carried **once** (see (c)) |
| `class_terms.test.sql` (14) | effective-dated class terms — a lesson priced and attributed by **its own date**, correct-vs-change, and the settled-money guard. Runs on **its own tenant** (see §7.26) |
| `active_inactive.test.sql` (20) | per-business active/inactive for families and children (§7.14), incl. the load-bearing one: **reactivating is not undone by the family having no active children** (§8) |
| `student_identity.test.sql` (9) | name + DOB identifies a child within a business; whitespace/case cannot defeat the expression index; NULL DOB is exempt (what made it safe on live data); `age` is gone |
| `student_tenant_pin.test.sql` (6) | a parent or admin **cannot move a child to another business** (§8a), while ordinary edits and the platform admin's RPC still work |
| `document_name_snapshot.test.sql` (7) | renaming a child does not rewrite an issued invoice or an immutable credit note; the note carries the name from the item it credits |
| `tenant_levels.test.sql` (9) | per-business level ladders: RLS is **enabled** (not merely written), cross-tenant writes refused, a student cannot take another business's level, deleting a level unlevels rather than deletes |
| `level_skills.test.sql` (11) | the skills taught at a level: order preserved, no duplicate skill within one level (ignoring case/whitespace), the tenant boundary, `CASCADE` on the level but `SET NULL` on the student, and the fix to the level-name constraint |
| `platform_overview.test.sql` (24) | the platform admin's overview RPCs: FOUR caller shapes get zero rows (anon-equivalent, parent, coach, **and a tenant admin — even for their own tenant**), counts never leak across the tenant boundary, and `last_attendance_date` is **NULL, not a date and not 0**, for a business that has never marked anything |
| `parent_address.test.sql` (8) | a family maintains their own address only; `postal_code` is TEXT so leading zeros survive; `profile_id` cannot be reassigned |
| `lesson_packages.test.sql` (30) | prepaid packages: RLS on all four tables, $0-rate/0-lesson products refused, product money terms immutable, request snapshots come from the PRODUCT (a parent cannot claim a price or an active status), only non-client roles move a balance, `package_live_balances()` draws locked-rate/in-scope/FIFO and leaves the stored balance alone |
| `tenant_provisioning.test.sql` (21) | creating a business: parent, coach, **tenant admin** and anon all REFUSED (each in an explicit transaction, 7.16) and `tenants` does not grow after any of them; slug derivation incl. a **non-ASCII name** that would otherwise violate NOT NULL; join-code shape + uniqueness; a fresh tenant reports `admin_status = none`. The two ACL assertions are near-vacuous locally by construction (7.39) |
| `package_corrections.test.sql` (12) | a correction on a package-funded line restores the package (even expired) and mints NO cash credit note; flip-flops refund at most once; ad-hoc lines keep the credit-note path byte-identical |
| `student_claims.test.sql` (47) | parents claiming their own child: the disclosure surface (a surname-only overlap returns **nothing**; an unjoined tenant is **refused**, not handed an empty set; a claimed child is never a candidate; masking happens in SQL), the phone signal matching across `+65` vs 8 digits, the **tripwire** that a non-matching child is created exactly as before, Confirm **not** linking, the pending block **with a NULL dob on both sides** (fails on `=`), claim RLS both ways, approve auto-declining competing claims, the dob enrichment, **undo**, `list_student_claims()` seeing a parent `profiles_select` hides (§7.48), and the contract: a parent can no longer INSERT a student directly while the admin still can |
| `student_merge.test.sql` (20) | folding a duplicate into the row with the history: five refusals (cross-tenant, both-marked, **wrong direction**, invoiced duplicate, same row) each asserting `students` did not shrink; the move of parent links, trial bookings and settlements with **global counts unchanged** — a merge moves rows, never destroys them; and §7.46's guard, proved by **creating a cascading FK at runtime** and asserting the merge refuses |
| `trial_onboarding.test.sql` (32) | a child before their parent: THREE refusal shapes for `add_unclaimed_student()` (parent, cross-tenant coach, anon) each asserting `students` did not grow, the **tenant derived from the class** (nothing downstream would catch a wrong one — §7.42), `created_by` = the calling coach, a trial enrolment closed on its own date, **session idempotency** (two walk-ins on one date share ONE session — §7.43), the plain-English duplicate name+DOB error, settlement RLS, and `link_invited_parent()` incl. same-parent idempotency vs a different parent refused |

| `attendance_window.test.sql` (31) | the marking window as a RULE: a coach refused off-weekday, below the floor and in the future (each asserting `lesson_sessions` did not grow), `off_schedule_reason` unwritable by a client, the **seam** (`service_role` and `postgres` exempt — they build the past the rule is about), the FOUR upsert assertions of §7.57 incl. a mixed multi-row statement proving the existing row is **unchanged**, and `schedule_extra_lesson()` refused for parent / coach / cross-tenant admin, idempotent on a second call, and markable by the coach afterwards |
**Total: 397 across 22 files** — verified by `supabase test db` 2026-07-27 (the previous
"total" line here had been stale for several sessions while §3 was right; per §7.37,
the command is the fact and this sentence is the hint). If you add a suite, add a row.

_Deno tests — `core.test.ts` + `email.test.ts` + `dates.test.ts` (run by `test.sh`):_
**The clock is part of every fixture** — `monthEnded()` in `test-helpers.ts` supplies the
billing month, an instant at which it is billable, and an early-enough enrolment as ONE fact,
and `newScenario()` **throws** on a scenario expecting zero lessons (§7.33). The
completed-month guard is pinned by five tests including the SGT boundary (23:59 on 31 Jul
refuses July; 00:00 on 1 Aug allows it) and the year rollover. **Engine**
(`core.test.ts`): billable-only summing, paid vs free trial, no double-billing, the
auto/manual completeness gate, the `auto_invoice_enabled` switch, FIFO credit application,
**11.1** leap-year last-day / month-boundary billing, **11.7** credit-exceeds-invoice
carry-forward (+ ledger invariants via `checkInvariants`), plus `result.created` shape and
two **stack-backed invoice-email orchestration** tests (recipients resolved from the DB;
no-op without a key). **Email** (`email.test.ts`): pure HTML builder + `sendInvoiceEmail`
(no-op without key, mocked-fetch success/failure, HTML escaping). **Dates**
(`dates.test.ts`, 5): `previousBillingMonth`/`dateInTimeZone` — the SGT day-boundary
regression (1 Aug 00:30 SGT bills July, **fails on the old UTC path**), year rollover, and
the `APP_TIMEZONE` seam (UTC vs SGT diverge at the boundary).

_Also in `core.test.ts` (added §8a):_ **multi-class** (one parent, two children, two
classes → ONE invoice with both classes' items; the credit case proving credit draws
against the *combined* gross), **auto-mode deferral** and its recovery, the **hard block**
(unmarked attendance stops both auto and manual; marking it *cancelled* clears it), the
**run day** (before/on/after, manual ignores it, SGT decides the day), **sealing** (a
manual run that finishes the month seals it; a forced run on an incomplete month seals
nothing; sealing twice is a no-op), and **billing-vs-enrolment** (a child unenrolled
mid-month is still billed for what they attended; unenrolling clears the block they caused).

_Also in the Deno suite (added 2026-07-20):_ **`packages.test.ts`** (10) — the
no-package TRIPWIRE (a parent with no package produces the pre-package invoice,
byte-for-byte), locked-rate coverage both ways, chronological exhaustion cutover,
FIFO-by-expiry, the expiry boundary ON `expires_on`, coverage starting at confirmation,
category scope, package-then-credit precedence, and the ⚠RISK-4 pin:
`package_live_balances()`'s prediction equals the engine's settled result, and the
fault-injection test (a failed ledger write holds the month open). All verified
failing on the pre-package engine or a mutated flag. Plus **`../package-emails/email.test.ts`**
(7) — purchase-email builders (escaping, no-key no-op), run by the same `test.sh`.

_PRD §11 edge cases are now all individually tested_ — 11.1 & 11.7 (Deno),
11.2/11.4/11.5/11.8 (`edge_cases`), 11.3 (`rls_isolation`), 11.6 (`credit_note_trigger`).

_Frontend tests:_
`SwimSyncAdmin` uses **vitest** + Testing Library (`vitest.config.ts`) — **14 files, 198
tests** (2026-07-26): the eleven above plus `lib/tableSort.test.ts`,
`lib/studentCounts.test.ts`, and `components/Table.test.tsx` extended for sorting.
`tableSort.test.ts` includes a case that runs in **four timezones**, pinning that sorting
never constructs a `Date` (§7.7 by construction). `studentCounts.test.ts` has one named for
the bug it prevents — *"NEVER says nobody when only inactive children hold the level"*
(§7.69). `Table.test.tsx` gained sortable-header render tests (click, reverse, `firstDir`,
`aria-sort`, non-sortable columns) plus width assertions, and keeps its `<Thead>`-owns-its-
`<tr>` call-site scan.
`SwimSyncApp` uses **jest-expo** (`jest.config.js`) — **12 files, 174 tests**, scoped to
`lib/**` unit tests: `attendanceBulk`, `attendanceCompleteness`, `attendancePayload`,
`attendanceRoster`, `attendanceSession`, `attendanceSummary`, `attendanceWindow`,
`authErrors`, `claimCandidates`, `landing`, `lessonDates`, `timeOfDay`. Deeper
component-render tests (RN screens with mocked Supabase, admin tables) are the natural next
additions.

Four of the app's suites exist because of bugs that reached production on 2026-07-26, and
what each one *pins* is the point:
- **`timeOfDay`** — `nowMinutesInSg()` returns the same number under four process
  timezones. 12 of its 21 assertions fail against the `getHours()` expression it replaced
  (§7.7).
- **`attendanceSession`** — a session id is inseparable from the date it was resolved for;
  anything else is `stale` and must be re-resolved (§7.64).
- **`attendancePayload`** — every row of an upsert carries an identical key set, and
  `hasUniformKeys()` catches the exact body shape that broke (§7.67).
- **`attendanceSummary`** — an empty roster is `no-students`, never `complete`, and only
  `complete` may quieten the Mark Attendance button. One test enumerates the whole state
  union, so **adding a state fails it** until someone decides where it belongs (§7.68).
- **`attendanceCompleteness`** also now pins the *opposite* rule deliberately: an empty
  expected set IS vacuously marked, because invoicing depends on it. The comment above that
  test explains why not to "fix" it.

> *This list had gone stale by six files before 2026-07-26 — it named five admin suites
> when eleven existed. Per §7.37 the runner is the fact and this paragraph is the hint:
> `find components lib -name "*.test.ts*"` in either app is the answer.*

_Note:_ both apps now **typecheck clean** and CI enforces it — a **Typecheck (tsc)**
step runs `tsc --noEmit` for `SwimSyncApp` and `SwimSyncAdmin` in the `frontend-tests`
matrix (§8d). The app's 5 long-standing `tsc` errors in
`app/(parent)/home/child/[id].tsx` (Supabase join typing) were cleared with an `any`
cast. Run `npm run typecheck` in either app locally — but see §7.11: a local pass can
still be a CI fail because the Next/Expo type stubs it leans on are git-ignored.

> **Every fixture has a `-teardown.sql`, and CI enforces it** (2026-07-26). `fixtures-*.sql`
> seed the **one** local database that every worktree shares, and `/session-close` forbids
> `supabase db reset` as the cleanup — so a fixture without a teardown leaves a session no
> safe way to clean up. `drivers/check-teardowns.sh` fails the build if a new fixture arrives
> without one; run it locally any time. Each teardown ends with a SELECT printing **0** for
> what it removed and **1** for each seed identity that had to survive — read that output.
>
> **Every fixture is now LOADED by CI too** (2026-08-01), by
> `drivers/check-fixture-roundtrip.sh` — a step in `backend-tests`, which already boots a
> Supabase stack. It runs **two passes**:
>
> - **Pass 1, isolated** — snapshot every base-table row count in `public`/`auth`/`storage`,
>   apply the fixture with **`ON_ERROR_STOP=1`**, apply its teardown, assert the counts came
>   back identical. This is the round-trip from `docs/WORKTREES.md` Phase 4, automated.
> - **Pass 2, stacked** — apply all 14 in sequence *without* tearing down between them, then
>   unwind in reverse. Each fixture's per-table footprint is compared against its isolated
>   one: a fixture that touches only its own rows behaves identically on top of thirteen
>   siblings, so **a divergence is §7.63's signature** and fails the build.
>
> **`ON_ERROR_STOP=1` is the load-bearing part.** Measured 2026-08-01 by re-introducing
> §7.62 (dropping `tenant_id` from a fixture's insert): plain `psql` **exits 0**, buries one
> `ERROR` line in its output, and creates **1 of 3** students. The fixture half-loads, the
> driver then scores low, and the low score reads as a *product* regression. With
> `ON_ERROR_STOP=1` it exits 1 and names the constraint. Re-introducing §7.63's unscoped
> `CROSS JOIN` reproduced its documented second-order failure — the
> `one_active_enrolment_per_student` violation that means the fixture's **own** children
> never enrol. Both detectors were proven to fail without the fix (§7.25) before shipping.
>
> Run it locally any time (the stack must be up); it restores what it found, so it is safe
> beside a sibling worktree. `--only <name>` checks one fixture, `--isolated-only` skips
> pass 2.
>
> **Two rules for writing a new fixture, both learned by this check refusing to run:**
> 1. **It must load against a bare seeded database.** `fixtures-phase4-billing.sql` used to
>    `RAISE` unless a human had registered its parent through a browser first, which made it
>    the one fixture nothing automated could ever check. A fixture that needs an account
>    seeds it itself (insert `auth.users`; `handle_new_user` fans out to profiles/parents),
>    guarded by an existence test **on the email**, since a UI registration mints a random id.
> 2. **Scope every write to rows you own** (§7.63), and never reach for an unordered
>    `LIMIT 1` (§7.73). If a fixture genuinely must write beyond its own rows, declare it with
>    `-- roundtrip-exempt: cross-fixture-writes — <why>` and make the teardown compensate; the
>    declaration is echoed on every run and exempts pass 2 only, never pass 1. **Nothing
>    declares it today.** The one fixture that did — `fixtures-trial-onboarding.sql`, which
>    marks every child enrolled in its class to build a *complete* month — stopped needing it
>    on 2026-08-01 by owning its class instead of borrowing one. Prefer that fix: an exemption
>    is a compensated hazard, and this one broke CI before it was removed (§7.73).

_UI drivers (`.claude/skills/run-ui-playwright/drivers/`, run by hand, not CI):_
`verify-unmarked-lessons.mjs` + `fixtures-unmarked-lessons.sql` drive the whole
unmarked-lesson loop (admin gap report → coach backlog → mark → both go green);
`verify-parent-attendance.mjs` covers the parent Attendance screen — chip geometry read
from the DOM, plus all three empty states (unassigned / nothing marked / filtered out);
`verify-tz-saturday.mjs` pins the SGT-vs-UTC regression using Playwright's clock
API — it **fails on the pre-fix code**, which is the point;
`smoke-admin-screens.mjs` drives the admin attendance/students/dashboard pages at
runtime (checks the deep joins resolve — no NaN, no empty tables);
`verify-bulk-setall.mjs` (+ reuses `fixtures-unmarked-lessons.sql`) drives the bulk
"Set all" menu — the RN-web dropdown renders, the confirm guard fires only when a student
is already marked, and a bulk save persists `cancelled_rain` to the DB;
`verify-class-edit.mjs` drives the admin Classes page — the create form no longer defaults
the day (required choice) and an existing class edits Saturday→Sunday and persists;
`verify-packages.mjs` (+ `fixtures-packages.sql`) drives prepaid packages across both
UIs — the parent card shows the LIVE count (9 of 10, the un-invoiced lesson already
subtracted), request → PayNow (the requested package's price, not the held one's) →
pending → admin confirm → Active, and the students "running low" filter obeys its
per-tenant threshold in both directions (16 checks);
`verify-tenant-provisioning.mjs` drives creating a business end to end across the platform
panel and a second browser context - mismatched confirmation email refused, join code shown,
the delivery outcome stated explicitly, `invited` -> accept -> **the new admin signs in** ->
`active` (15 checks; the sign-in is the load-bearing one, per 7.19);
`verify-invoice-controls.mjs` drives the admin invoice controls — it MEASURES the toggle's
track and knob rects from the DOM (§7.34) in both states and asserts the knob stays inside the
track, that a click round-trips through the DB, and that the billing month defaults to and is
capped at the last completed month;
`verify-trial-visibility.mjs` (+ `fixtures-trial-visibility.sql`) drives a booked trial from
all three sides — the parent is told WHEN, the coach's roster lists trials coming up, and
Unassigned Children **excludes** an upcoming trial while **keeping** a past one; its last
two checks book a trial *while the admin page is already open* and prove the enrolment
guard refuses the first press **and wrote nothing** (11 checks). **It found two RLS gaps
that would have shipped the parent card completely dead** — see §7.48;
`verify-parent-claim.mjs` (+ `fixtures-parent-claim.sql`) drives the whole claim + merge
loop across both real UIs — the popup OPENS (slice 1 shipped an invisible modal, §8.10),
the candidate is masked, Confirm is inert until one is chosen, the parent is **blocked**
from re-adding, the admin queue shows who is asking, approve is a two-step confirm, undo
is offered, and the "no, different child" branch produces a duplicate that the Students
page flags and merges (21 checks). **It found two bugs no unit test could reach** — both
read paths rather than RPCs (§7.48, and duplicate detection hiding same-parent pairs);
`verify-class-students.mjs` (+ `fixtures-class-students.sql` and its
`-teardown.sql`) drives the admin Classes page's **"See students" drawer** — the badge
reads `2+1` (and is asserted *not* to read 3 / 2+2 / 2+3 / 3+1, each a specific way the
rule could have been got wrong), the drawer lists the two enrolled children with level and
joined date plus the one upcoming trial, and the three negative controls — a **closed**
enrolment, a **past** trial and a **cancelled** future trial — appear nowhere. **Its first
six checks are database checks that those three rows EXIST**, because an absence assertion
against a row that was never created passes while proving nothing (32 checks). Admin-only:
no Expo server needed. Run it on **port 3100**, not 3000 — the stack and ports are shared
with other worktrees: `ADMIN_URL=http://localhost:3100 node drivers/verify-class-students.mjs`;
`verify-levels-table.mjs` (+ `fixtures-levels-table.sql` and its `-teardown.sql`) pins the
Swimming Levels table's **column geometry** — it MEASURES each `th`'s rect against its
column's `td` and fails if they diverge by more than 2px. Written because §7.54's bug was
invisible to every text assertion: the labels were all correct and merely in the wrong
place. **It fails on the pre-fix code with a worst offset of 488px, which is the point**
(12 checks; admin-only, port 3100);
`verify-contact-details.mjs` (+ `fixtures-contact-details.sql` and its `-teardown.sql`)
drives all four states of the admin's parent-contact modal — an unclaimed child edits and
persists (a cleared field lands as **NULL, not `''`**, matching the creation path); a
claimed child is read-only and shows **both** of its parents' details, asserted as the
**exact seeded strings** because the `any`-typed join renders blank when nested wrong
(§7.28); a claimed child with **no enrolment**, whose parent has no other children, still
resolves — the non-vacuous test that `tenant_serves_parent()` keys off `students.tenant_id`;
and a child with a **pending claim** offers no Save at all. It also proves the phone check
never blocks: `964` warns on *Add a student* and the child **is still created** (21 checks;
admin-only). The driver **resets the fields it edits**, so a second run cannot fail in a way
that looks like a regression (§7.53's lesson, applied at the driver rather than the fixture);
`verify-attendance-guard.mjs` (+ `fixtures-attendance-guard.sql`) drives the marking window
across both UIs — the admin schedules an extra lesson off the class's weekday (and a second
identical press leaves exactly ONE session, §7.7), the coach is told it is coming and cannot
mark it before the day, a past in-window lesson opens with **only the children enrolled on
that date** (the late joiner is absent — the whole point), an out-of-window date and a
non-lesson day are each refused **in English with no markable roster**, and a save followed
by a correction round-trips through the real upsert path that §7.57 governs.
**Scores 6/12 on the pre-fix screen**, which is what makes it worth having. Its fixture
derives every date from ONE clock anchor rather than hardcoding — deliberately the opposite
of §7.33's rule for unit suites, because the behaviour under test IS relative to now(). It
carries `pressByText()` for §7.58; needs both servers.

> **It absorbed `verify-attendance-window.mjs` on 2026-08-01 and now runs 19 checks.** That
> driver had rotted to **2/5** with the product correct in every case: its fixture pinned a
> child's enrolment to `2026-07-16` and needed "no Sunday since", true for three days in
> July 2026. Two drivers over one rule is why nobody noticed. The three behaviours nothing
> else guarded were rebuilt on this fixture's anchor:
> - the coach roster's **"No lessons to mark yet"** placeholder, on a class whose weekday is
>   *tomorrow's* so its first lesson is always still ahead;
> - the parent's **"No lessons marked yet"** (a lesson happened, the coach is behind), on a
>   second class whose weekday is *yesterday's* so a lesson is always overdue;
> - the parent's **"No lessons have taken place yet"** (nothing happened, nobody is behind).
>
> **Each parent check asserts its sibling sentence is ABSENT, not merely that its own is
> present.** A previous screen stays mounted under the current one (§7.10, §7.58), so a
> present-only assertion can pass on the *other* child's panel — and these two sentences are
> the entire behaviour: saying the first when the second is true accuses a coach of being
> late when they are not (PRD §5.1). Both weekdays are derived away from Saturday, and the
> driver **asserts the new class's `day_of_week` is not `saturday`** — a collision would make
> the "nothing has happened yet" premise false silently, and only on Fridays.
> All three were observed RED (by flipping the enrolment dates) before being accepted (§7.25).

`verify-stale-screen.mjs` (+ `fixtures-stale-screen.sql`) is the only driver that can reach
the three 2026-07-26 attendance bugs, **because all three live in the router or the wire
format rather than in any function**. It navigates **in-app** — Today's card, then the
backlog row — which is the whole reason it exists: a deep link mounts a fresh screen and
passes cleanly, which is exactly how `verify-attendance-guard.mjs` scored 14/14 against a
build that was silently writing attendance to the wrong day. **18 checks**: rows land on
the lesson the coach is looking at (§7.64), saving leaves the attendance screen instead of
popping into a different lesson (§7.65), a *partially* marked lesson can be completed at all
(§7.67 — a fully marked or fully unmarked one cannot reproduce it), and the status chips read
correctly with no empty roster ever labelled *Marked* (§7.68). Scores **4/8 → 18/18** across
the three fixes; the two-class fixture is required because one class cannot express "marked
two lessons in one sitting". Its fixture derives dates from one clock anchor, like the guard
driver's. **It selects buttons by the card for a named class, never by page index** — an
index broke the moment a finished class started saying *Edit attendance* — and its
`pressByText` filters on `aria-hidden` so a press cannot land on a screen React Navigation
has left mounted. Coach app only; no admin server needed.

See LOCAL_DEV_GUIDE §"Running the tests".

---
