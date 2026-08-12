# SwimSync — Session Handover

_Last updated: 2026-08-12 — **The Wave 3 follow-up shipped** (§8.45): the guard
`assign_session_coach` owed, `sessions_i_am_main_on`, and `verify-coach-roster.mjs` (25 checks).
`20260812000100` + both apps. Six gotchas, **§7.137–§7.142**._

_Previously, 2026-08-11 — **Wave 3: a lesson has its own coaches** (§8.44), `20260811000200`._

_**One `_Previously,_` line, maximum, and this block is 3 lines + 1** — the rule as of
2026-08-10, when it had stacked five sessions deep and 138 lines. A dateline is a *third*
copy of a session that §8 already holds in full and `docs/SESSIONS.md` holds as a row; three
copies are not read three times, they just disagree. Older state: §8, then `docs/SESSIONS.md`._


> **If you are the human driving this, read `01_SESSION_WORKFLOW.md` first.**

---

## Where everything lives

**Read this file, then fetch only what the task needs.** Everything below is one hop away —
there is no second index to go through.

| Need to know | Read | Section numbers |
|---|---|---|
| **The state I'm inheriting, and what's next** | **this file** | §1–3, §8, §9 |
| What the product does today | `PRD.md` | — |
| What's queued but unbuilt, and why | `BACKLOG.md` | — |
| How to run and test it; seed logins | `LOCAL_DEV_GUIDE.md` | *(was §4)* |
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.142** |
| What shipped in every older session | `docs/SESSIONS.md` | §8 ledger |
| Why the system is shaped this way | `docs/ARCHITECTURE.md` | §6, §10, §12 |
| What each test suite and UI driver covers | `docs/TESTING.md` | §5 |
| What is live in the cloud, and its config traps | `docs/DEPLOYMENT.md` | §11 |
| **Running two sessions at once without clashing** | **`docs/WORKTREES.md`** | — |
| How to bill a month | `INVOICE_RUNBOOK.md` | — |
| The design/plan behind a shipped feature | `docs/design/`, `docs/plans/` | — |

> **Section numbers did not change when the files did.** `§7.41` still means gotcha 41 —
> it now lives in `docs/GOTCHAS.md`. This matters because **781 references** cite them by
> bare number, including from **applied migrations** and Playwright drivers, where they can
> never be corrected. Same trick as the §8.16 move: change the container, never the
> identifier.

---

## 1. What SwimSync is

Swim-coach attendance & billing app for Singapore. Three roles:
- **Parent** — self-registers (mobile), adds children, views attendance, invoices,
  credit notes, and the coach's PayNow QR to pay.
- **Coach** — marks/edits attendance (mobile), sees **their own pay**, and uploads the
  business's PayNow QR if they are also its admin. They see **no invoices** — that moved
  to the admin panel with payment collection (§8.27).
- **Superadmin** — web admin panel: assigns children to classes, manages
  classes/coaches, oversees invoices/credit notes.

**Stack:** Expo (React Native) mobile app `SwimSyncApp/`, Next.js admin
`SwimSyncAdmin/`, Supabase backend (Postgres + Auth + Storage + Edge Functions).

---

---

## 2. Where the code lives (GitHub)

- **Repo:** https://github.com/kahhangwork/SwimSync — **public**, owned by
  `kahhangwork`. `gh` CLI is installed and authenticated as that account.
- **Single `main` branch** — all work is merged there and pushed; `main` local
  and remote are in sync.
- **Workflow used this session (no PRs):** create a feature branch off `main`
  → implement → verify → `git checkout main && git merge <branch>` → push
  → delete the merged branch (local + remote). Keep using this unless the user
  asks for PRs.

---

---

## 3. Current state — what works (verified end to end, local stack)

> **§3 does TWO jobs and nothing else: the VERIFIED-vs-SPECIFIED distinction, and the
> PROHIBITIONS that live nowhere else.** `PRD.md` is the spec — if it describes the
> behaviour in full and there is no prohibition attached, the PRD is the home and this
> section carries a pointer, not a copy.
>
> *Graduated 2026-08-10: 469 lines → ~150, 38 KB → ~13 KB.* Restating the PRD is what
> made this section 42% of the file. It had carried a note at its own top naming it the
> next thing to cut since 2026-08-08, and grew from 410 to 469 lines anyway — which is
> the evidence that **a bullet must pay for itself**. Adding one is fine. Adding one
> without deleting one needs a reason you can say out loud.

The **entire MVP core loop works and is verified across the UI + backend**:
parent register → add child → superadmin assign → coach attendance →
invoice generation → credit-note corrections → PayNow QR payment display.

### What is verified, and against which spec

`Verified` is what actually ran, not what is specified. Where a row says **LIVE** the
behaviour is deployed to production; the rest is verified on the local stack only.

| Capability | Verified by | Spec |
|---|---|---|
| Auth & onboarding — self-registration, add child, superadmin assignment | UI + backend, LIVE | PRD §7.1 |
| Password reset · attendance marking + "Set all" · parent Attendance empty states | UI + backend, LIVE | PRD §7.1, §7.6, §5.1 |
| A billing month must have ENDED before it can be billed | UI + backend, LIVE | PRD §7.7 · §8.6 |
| Invoice generation — automatic + manual, one invoice per parent, month sealing | Deno ×2, LIVE | PRD §7.7 · §8a, §8a.1 |
| Closing an enrolment — "Remove from class" / "Set inactive" via `close_student_enrolment()` | UI + DB, LIVE | PRD §7.14 · §8a |
| Credit-note flow — billable→non-billable auto-issues, FIFO drawdown | UI + backend, LIVE | PRD §5.6 · §8m |
| PayNow QR — belongs to the BUSINESS, not the coach | UI + backend, LIVE | PRD §7.10 |
| The coach app shows NO invoices — Billing became My Pay, hidden when empty | UI, LIVE 2026-08-03 | PRD §7.9, §7.13, §7.21 · §8.27 |
| Unmarked-lesson safety net — NEEDS MARKING + `N of M lessons marked` | UI + backend, LIVE | PRD §7.6 |
| Full RLS — parents see only their data, coaches only their classes | pgTAP, LIVE | `docs/ARCHITECTURE.md` §6 |
| Multi-tenancy — cross-tenant isolation, 24 pgTAP checks | UI + backend, LIVE | PRD §4.3 · §8.1 |
| Coach wages — effective-dated rates, the pay-decision surface | UI + backend, LIVE | PRD §7.13 · §8.3 |
| Active/inactive families and children, per business | UI + backend, LIVE | PRD §7.14 · §8.4 |
| Effective-dated class terms — a lesson is priced by its OWN date | UI + backend, LIVE | PRD §7.3 · §8.3 |
| Prepaid lesson packages | pgTAP + Deno + driver, LIVE | PRD §7.16 · §8.8 |
| Package purchases numbered + QR-payable (`PKG-YYYY-NNNN`) | pgTAP 12 + 2 drivers, LIVE 2026-08-09 | PRD §7.16 · §8.37 |
| Every child's name carries their payment method (per-child, category-aware) | pgTAP + vitest, LIVE | PRD §7.16 · §8.23 |
| Fee-free payment collection — `INV-YYYY-NNNN`, dynamic QR, tokenized page, WhatsApp queue | pgTAP + Deno ×2 + vitest + jest + driver, LIVE | PRD §7.21 · §8.26 |
| Make-up classes — the guest-pass model | pgTAP + Deno ×2 + vitest + jest + 14-check driver, LIVE | PRD §7.20 · §8.25 |
| Creating a business in-app | UI + backend, LIVE 2026-07-21 | PRD §4.4 · §8.9 |
| A child can exist before their parent | pgTAP + Deno + driver, LIVE | PRD §7.17 · §8.10 |
| A parent can claim the child their coach already added | pgTAP + vitest + driver, LIVE | PRD §7.18 · §8.12 |
| A booked trial is visible to everyone who needs it | driver, LIVE | PRD §7.17 · §8.11 |
| Who is in a class, at a glance | driver, LIVE 2026-07-26 | PRD §7.3, §7.17 |
| A parent's contact details can be corrected | vitest + driver, LIVE | PRD §7.19 · §8.14 |
| The attendance window is a DB rule; a mid-month joiner no longer blocks a month | pgTAP, LIVE | PRD §7.5 · §8.15 |
| A month billed LATE can no longer be permanently unbillable (`markable_floor`) | pgTAP 18, LIVE | PRD §7.6 · §8.32 |
| The coach's landing tab is a WEEK, not a day | jest 308 + 19-check driver, LIVE | PRD §14.2, §7.5 · §8.34 |
| Every lesson list says whether it has been marked | driver, LIVE 2026-07-26 | PRD §7.6 · §8.19 |
| The admin's tables sort; student counts mean ACTIVE | LIVE 2026-07-26 | PRD §14.3 · §8.19 |
| Every audit row knows which business it is about | pgTAP, LIVE | `docs/ARCHITECTURE.md` §6 · §8.28 |
| Every EDIT to a child is recorded (`SECURITY DEFINER` trigger) | pgTAP 11 + 4 drivers, LIVE 2026-08-09 | §7.104 · §8.38 |
| `anon` holds EXECUTE on no callable function, and gets none for free | grant dump, LIVE | §7.82, §7.85 · §8.28 |
| A signed-in stranger cannot forge into a business or onto a child | pgTAP, LIVE | §7.86–§7.89 · §8.29 |
| `authenticated`'s table grants are a DECLARED WHITELIST, re-proven by CI | `table_grants.test.sql` | §7.87 · §8.29 |
| Co-admins, managed by the business's OWNER | pgTAP 38 + vitest + driver, LIVE | PRD §4.3 · §8.31 |
| A class can be RETIRED without losing money | pgTAP 23, LIVE | PRD §7.3 · §8.39 |
| An unmarked GUEST holds the month open; nothing new enters a retired class | pgTAP + Deno, LIVE 2026-08-10 | PRD §7.3 · §8.40 |
| **A child can attend MORE THAN ONE class a week** | pgTAP + vitest + jest + 17-check driver, LIVE 2026-08-11 | PRD §7.4, §7.20 · §8.43 |
| **A LESSON has its own coaches — a substitute, and shadows paid their own rate** | pgTAP 56 + vitest + jest + **25-check driver** | PRD §7.13, §7.6 · §8.44, §8.45 |
| **…and its main coach cannot be demoted by being shadowed** — row main *and* absence main | pgTAP 16, `20260812000100` | PRD §7.13 · §8.45 |
| Automated tests — pgTAP + Deno backend, vitest + jest-expo apps, all in CI on push | CI | `docs/TESTING.md` §5 |

**Counts are deliberately not written here.** The runner is the fact; a number in prose is
a hint that has already drifted. `docs/TESTING.md` §5 says what each suite covers.

### DORMANT — shipped and verified, never exercised on real data

This is the half of "verified" that a PRD cannot tell you, so it is the part of §3 that
earns its place. **Shipped ≠ exercised**, and a guard that has never fired in production
is a guard whose first real firing is still ahead of you.

- **Packages** — no package has been sold on production.
- **Billing a month LATE** — no production month has been billed late, so `markable_floor`'s
  reopened window has never been used. That is the point: it is insurance, shipped ahead of
  the trigger its own backlog item named.
- **Retired classes** — production had **zero** inactive classes on deploy day (audited,
  re-confirmed 2026-08-10), so no class has been retired on real data.
- **Guest bookings** — production holds **zero** live trial or make-up bookings, so §8.40's
  new block has never fired there. Which is exactly why it was safe to ship.
- **The lesson coach roster** — production holds **zero** `session_coaches` rows, so no cover
  or shadow has ever been recorded on real data and the clawback path has never fired. Two
  consequences worth knowing before the first one: production's coach is **also its tenant
  admin**, so the attendance-write narrowing can never lock them out (§7.131); and a second
  coach on payroll is what makes any of this reachable at all, since `generate_coach_payouts`
  skips a coach with no `coach_rates` row — production has none, so **no payout has ever been
  generated there.**
- **Multiple classes per child** — no production child holds two enrolments yet, so neither
  schedule guard has ever refused anything real and no admin has pressed *+ Add class*. The
  first real one is worth watching: it is also the first time `'mixed'` package coverage
  becomes reachable on real data (PRD §7.16), a code path that was unreachable-by-construction
  for its whole life until 2026-08-11.

*(Corrected 2026-08-10: this list also carried "production has 0 attendance rows", which
had been false since 2026-07-26 and directly contradicted the REAL BILLING note below.
Two claims in one section disagreeing is the cost of restating a fact instead of pointing
at it — the fact is `SELECT COUNT(*) FROM attendance;`.)*

### Prohibitions — these live nowhere else

- **Don't re-add an invoice count to the coach app.** Everything that makes an invoice
  actionable is on the admin panel, so a second poorer copy on the coach's phone could only
  prompt a decision they cannot act on well. Recorded in `BACKLOG.md` → *Deliberately not
  doing*. §8.27.
- **"No rate" is the finished state, not missing setup.** The distinction is data, not a
  rule — don't file it as a gap.
- **Coaches deliberately see no payment-method chip.** §8.23.
- **`public-invoice` is deliberately not an anon RPC** — the invoice token is the access
  control. §8.26.
- **A booking is never an enrolment.** §8.25.
- **The package-reference trigger's NAME is part of the contract** — it must sort after
  `trg_parent_package_lifecycle`, which fills `tenant_id`. Renaming it breaks **every**
  package request. `docs/ARCHITECTURE.md` §6.
- **Before changing an RPC signature, GREP for the coach app's callers — do not trust a list,
  including this one.** `grep -rn 'supabase.rpc(' SwimSyncApp` is the fact. This bullet said
  "no RPCs at all" until 2026-08-11 (false — that is why §7.123's live breakage was not
  anticipated), was corrected to an enumeration, and **the enumeration was stale within one
  day**: 2026-08-12 added two more callers. A list of call sites drifts; the command that
  produces it does not. **⚠ The pattern is `\.rpc(`, NOT `supabase.rpc(`** — four call sites
  including `close_student_enrolment()` go through an injected client (`db.rpc`,
  `SwimSyncApp/lib/studentStatus.ts`), so the narrower pattern misses the very call whose
  signature change caused §7.123. Found while writing this bullet, which is the third time
  this fact has been wrong. A private coach arranges trials through their tenant-admin
  account; `add_unclaimed_student()` still accepts a coach caller server-side (pgTAP pins it),
  but no UI reaches it. §8.10/§8.11.
- **NEEDS MARKING is FLOOR-scoped and deliberately ignores the week selector** — week-scoping
  hides a straggler the coach has no reason to look for, and unmarked attendance blocks
  billing with no override (§8i). `verify-schedule-week.mjs` pins it, proven red by scoping
  the query to the week.
- **The coach's week is an offset integer, not a stored Monday** (§7.95) — an absolute Monday
  captured at mount goes stale on a PWA surviving a Sunday→Monday boundary, and the symptom
  is indistinguishable from a quiet day.
- **The student-audit trigger is `SECURITY DEFINER`, and that is not style** — invoker-rights
  breaks every student edit in the product. Two holes are disclosed, not silent: backend
  writes are unattributed (render "system"), and `prepare_admin_delete()` purges a deleted
  admin's rows. Full reasoning: **§7.104** · `BACKLOG.md` · §8.38.
- **`classes.deactivated_at` is a DATE and a boolean cannot replace it.** The same scan feeds
  the completeness gate, so widening it naively makes an inactive class expect a weekly lesson
  for ever and block the month with no override and **no screen able to clear it** (§7.109).
  The date answers *"was this class running on the 13th?"*. **`reactivate_class()` takes no
  refusals and must never grow one** — it is the only exit.
- **`bookingsByDate` is NEVER clamped — a prohibition, not a preference.** `expectedDates` is
  a guess and is clamped; a booking is evidence. A clamp was drafted and would have re-created
  the underbill. `docs/ARCHITECTURE.md` §6 · §8.40.
- **The enrolment overlap trigger must NOT consult the counterparty class's `is_active`, and
  `reactivate_class()` must never grow a refusal.** The obvious form ("skip the check if
  either class is retired") is escapable: an enrolment can be added to a retired class after
  it is retired, and reactivating it then takes no refusals by standing prohibition. The rule
  is inverted instead — refuse *entry* to a retired class — so an inactive class provably
  holds none. It is also `SECURITY DEFINER`, because RLS can hide the sibling row that would
  have failed the check (§7.125). §8.43.
- **`close_student_enrolment()`'s `p_class_id` has NO default and NULL is refused.** There is
  deliberately no spelling that means "every class": the dangerous value must not be the one
  a forgotten argument produces. Its per-class authorization is `coach_owns_class()`, **never
  `coach_serves_student()`** — the latter is true for any class the child is in and would let
  one coach close a row on another's roster. §8.43.
- **`book_makeup()` refuses EVERY class the child attends, not just the named home.** Booking
  into their other class bills correctly and silently voids the make-up. PRD §7.20 · §8.43.
- **`billableStudentIds` is not widened** — four consumers read it, and widening is safe only
  by coincidence of the item loop's shape. §8.40.

### Production reality

> **"CLEAN SLATE" IS A BANNED PHRASE FOR THIS DATABASE — it has now been wrong twice.**
> The first time (corrected 2026-07-25) it claimed production held "only the superadmin +
> the real coach/classes" while the dump showed **2 tenants, 9 parents, 11 students,
> 7 enrolments, 5 classes** — real families who had registered. The second time was
> 2026-07-26, when the cleanup script ran and "clean slate" was reached for again.
> **The cleanup deletes named test records, not everything**: it took production from
> 21 → **9 students** and 12 → **7 parents**, and those survivors are real families.
> What the cleanup DID zero is **`attendance`, `lesson_sessions` and `invoices`**.
> Say *"no attendance recorded"* — never *"clean slate"*. The fact is
> `SELECT COUNT(*) FROM students;`, not this sentence.
>
> **And as of 2026-07-26, "no attendance recorded" is ALSO out of date** — see below.
> The rule survives the change: the count is the fact, the sentence is a hint.

> **REAL BILLING EXISTS NOW (2026-08-02).** Real attendance has existed since 2026-07-26
> (four bugs on the marking path to get there — §8.19); on 2026-08-02 the user **billed
> July for real** — invoices with `INV-YYYY-NNNN` references generated by the engine,
> the month sealed in `billing_periods`, **real PayNow money collected against the
> dynamic QR**, and confirmations written through `confirm_invoice_paid()` with their
> `payment_records` audit rows.
> **Do not read a count out of this paragraph.** How many invoices, and how many are
> paid, is `SELECT status, count(*) FROM invoices GROUP BY 1;` — not this sentence.
> Two prose counts have already gone stale in this file.
> One production data change to know about: **all active enrolments were backdated to
> 2026-07-08** so July's lessons fell inside the marking window. That is why children are
> billable from the 8th, and it is not repeatable from the UI.

> **`main` = what's live for the WEB APPS ONLY.** Vercel builds both sites from `main`, so a
> push deploys them — but a push deploys **neither the Edge Function** (`supabase functions
> deploy`) **nor migrations** (`supabase db push`). Both are separate, manual steps.
> **This bit us:** migration `20260712000100_coach_read_parent_profile` sat merged-but-
> undeployed for **six days** — the coach Billing screen could not show parent names in
> production that whole time, and nothing surfaced it. Applied 2026-07-18 alongside §8a's
> three. **After any backend change, run `supabase migration list` and check nothing has an
> empty `remote` column.** `git log origin/main` is the honest answer to
> "what's in production"; don't trust a SHA written into prose here, including this one.
> **Production was fully caught up as of 2026-08-12**, through `20260812000100`. THREE edge functions exist: `generate-invoices`,
> `package-emails` (verify_jwt ON) and **`public-invoice` (verify_jwt false, deliberately —
> the invoice token is the access control)**. *(Version numbers used to be written here and
> went stale twice. `supabase functions list` and `supabase migration list --linked` are the
> honest answers; this sentence is a hint.)*

> **Rollback cover is uneven, so know which kind you are shipping.** Backups were taken
> before each production migration through 2026-08-01 (scratchpad, uncommitted — so not
> findable later); the 2026-08-02 make-ups batch went out with **no fresh backup**, covered
> only by `supabase/rollback/20260802_makeup_bookings_DOWN.sql`; the 2026-08-04 grant work
> is covered by a **committed** rollback file
> (`supabase/rollback/20260804_authenticated_grants_DOWN.sql`), which is the pattern to
> copy — a scratchpad backup nobody can find is not a rollback plan. The 2026-08-06
> co-admins migration followed it: `supabase/rollback/20260806_co_admins_DOWN.sql`,
> committed **before** the deploy.
>
> The **tenancy** deploys (§8.1) had **opposite orderings** and both were deliberate — phase 4
> *dropped* columns so the app deployed first; phase 5 only *added*, so migrations went
> first. **§8's deploy got that wrong**: the push to `main` went out before
> `supabase db push`, so Vercel shipped an admin calling an RPC that did not exist yet.
> The rule governs the **push**, not just the migration command — see §7.27.

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`).

**Not done yet** (see §9): native **App Store / Play Store** builds remain deferred (web
app on iPhone for now). *Parent onboarding is no longer a gate — it happened, and July
was billed on the back of it. Onboarding a new family is routine: they enter the join
code at `swimsync.sg/welcome`, and the admin assigns each child to a class.*
---

---

## 4–7, 10–12 — moved, numbers intact

| Was | Now |
|---|---|
| §4 How to run locally | `LOCAL_DEV_GUIDE.md` §1–3 *(it was already the fuller copy)* |
| §5 Running the tests | `docs/TESTING.md` |
| §6 Architecture & key decisions | `docs/ARCHITECTURE.md` |
| §7 Gotchas already hit | `docs/GOTCHAS.md` |
| §10 File map | `docs/ARCHITECTURE.md` |
| §11 Cloud deployment | `docs/DEPLOYMENT.md` |
| §12 Removed / hidden UI stubs | `docs/ARCHITECTURE.md` |

---

## 8. Session log

**The two most recent sessions are here in full. Everything older is one row in
`docs/SESSIONS.md`.**

That is not a filing convention, it is the rule the log is written under: **a session entry
may not be written until every durable thing in it has a home elsewhere** — a gotcha in
§7, an accepted consequence in its plan's §10, an unbuilt follow-up in `BACKLOG.md`, a
behaviour change in `PRD.md`. Once that is true the narrative is a third copy, and the
ledger row plus its pointers is the whole of what is left.

**A ledger row is a POINTER: 200 characters, hard cap** — and it is never deleted, because
rows are cited by number from applied migrations (`core.ts` and `20260727000100_…sql` both
say `§8a`) which can never be corrected. The ~25-token figure this paragraph used to quote
was true of July's rows and ten times wrong for August's; the cap now says the number
instead of describing the shape. The table moved out on 2026-08-10 at 21.5 KB — the old
trigger was "~100 rows", which at August's row sizes would have meant a **100 KB** ledger
inside a file read at the start of every session.

## 8.45 (2026-08-12) — THE WAVE 3 FOLLOW-UP: THE OWED GUARD, AND THE DRIVER

**Shipped** — `20260812000100` + both apps + `verify-coach-roster.mjs`. Closes all three
Wave-3-descended `BACKLOG.md` items except the Attendance page's Coach column, which carries an
unmade product choice. Plan and its ranked risk review: `docs/plans/WAVE_3_FOLLOWUP_PLAN.md`.

**The guard is WIDER than the backlog item described, and that is the finding.** A lesson has
two ways to have a main — a `session_coaches` row, and the **absence rule** (no row, so the
class's own coach teaches it) — and the shadow branch could demote either. A row-only guard
misses the second entirely. `assignableShadows()` already filtered by the *effective* main, so
the client refused both and only the server half was missing.

**Four things were found by RUNNING, and none was visible by reading** — the same lesson Wave 3
recorded, at a higher rate. §7.137 (the obvious pre-check form is TOCTOU, and the race is the
exact bug being fixed — the correct form is one statement, measured). §7.138 (the fail-loud
direction INVERTS when a per-item probe becomes a batch: "absent from the answer" silently
becomes the unsafe verdict). §7.140 (**two driver checks were decorative**: one scored 25/25
with the client sabotaged to hide every lesson, the other scored 25/25 with the RPC dropped —
found only by measuring the sabotage signature, fixed by a fixture row and by reordering).
§7.141 (a deep-linked RN-web screen renders perfectly and cannot be operated).

**The plan was wrong about the fixture, and being wrong loudly is why it was cheap.** It
specified times derived from `now()` so the lesson had "already ended". At 01:19 SGT that puts
the lesson on *yesterday's* weekday, which the Schedule tab renders as **Upcoming** — a green
fixture with an empty NEEDS MARKING list. Last week's same-weekday lesson is both weekday- and
time-of-day-agnostic; `end_time` went back to a literal.

**Verified:** pgTAP **693** (was 677; +16, each proven red by a *targeted* sabotage — guard
removed → 1,2,6,7; absence branch only → 6,7; function dropped → 8–16); Deno 139 ×2 (§7.15);
jest **357** (+9, the four hardening cases proven red against the naive implementation);
vitest 299 unchanged; typecheck both; `verify-coach-roster` **25/25** with its signature
measured; `verify-schedule-week` 21/21 **before and after** Step 3; fixture round-trip all 21
clean; rollback rehearsed (677/677 under the DOWN, and the DOWN's body proven byte-identical to
`pg_get_functiondef` by diff); `anon` EXECUTE 13 → 13 local.

---

## 8.44 (2026-08-11, 2nd session) — WAVE 3: A LESSON HAS ITS OWN COACHES

**Shipped and LIVE** — `20260811000200` + both apps. Plan and its ranked risk review:
`docs/plans/WAVE_3_PLAN.md`. Behaviour: PRD §7.13 (pay, Lesson Coaches, Wages) and §7.6
(who may mark). Built as **Phase A in the root checkout, then two parallel worktrees**
(`wt-admin`, `wt-coach`), which is the shape to copy — and the shape that produced the
deploy failure below.

**Three defects were found by RUNNING, and each was invisible to reading.** §7.129 (a pay
function that answers "what would this rate produce" cannot drive a clawback — the business
paid twice), §7.130 (a rewrite deleted the guard whose whole job is to refuse), §7.133 (a
refetch outside its staleness guard routed a *write* to the wrong class). The first two were
caught before any pgTAP existed, by smoke-testing the migration's cases by hand.

**The apps deployed AHEAD of their migration — read `docs/DEPLOYMENT.md` §11.9.** No
worktree could have prevented it: a worktree may not author a migration, so neither owned
the one their code needed, and each verified its own bundle correctly. **Splitting a wave
across worktrees splits the deploy, and nobody sees the whole of it.** Push the migration
before the first app branch lands.

**Both graduate lists were nearly lost and were recovered from the session transcripts** —
§7.136 has the method. `WORKTREE.md` is gitignored, so it is in no commit and no reflog.

**Deliberately not done:** the `assign_session_coach` shadow-branch guard, the Attendance
page's Coach column, and a set-returning roster gate — all three in `BACKLOG.md`, all three
needing a migration a worktree may not write.

**Verified:** pgTAP **677** (was 637; +40, proven red by the DOWN file); Deno 139 ×2 (§7.15);
vitest **299**; jest **348**; typecheck both; fixture round-trip exit 0; rollback rehearsed
(all 637 pre-wave tests pass under it); `verify-schedule-week` 21/21 against the real app;
production grant dump re-checked — `anon` EXECUTE still 18, 0 blanket table grants.

---

### Older sessions — the ledger

**Moved to `docs/SESSIONS.md`** (2026-08-10) — 51 rows, one per session, every number
intact. It was 21.5 KB of a file that is read at the start of every session, and §8's job
here is the two most recent sessions; for the rest, one hop costs the same as scrolling
past them.

**Never delete a row there** — they are cited by number from applied migrations, which can
never be corrected. **A new row is a POINTER: 200 characters, hard cap** — see that file's
header for what happens when it isn't.

---

## 9. Next steps (pick with the user)

> **This is the current shift, not the queue.** The full list of unbuilt ideas — with
> the reasoning for each — lives in **`BACKLOG.md`**. Don't restate it here; the two
> will drift.

### The July mission is COMPLETE — this is now an operating rhythm, not a blocker

**2026-08-02: July was billed for real, and real money was collected** (§8.26, §3).
Everything below is the monthly loop from here on:

1. **Chase the remaining outstanding invoices** — this is what the WhatsApp queue was
   built for (Invoices → *WhatsApp reminders*; one press of Send per parent; the
   **Claimed** filter collects "parent says paid" rows to check against the bank).
   `SELECT status, count(*) FROM invoices GROUP BY 1;` is the honest scoreboard.
2. **Keep August marked as it happens** (the coach's **NEEDS MARKING** list on the
   Schedule tab is the tracker), then **bill August in early September** — same runbook, now routine. The
   marking window still floors at the 1st of last month (§8.15): August's lessons are
   markable through September, and no later.
   > Marking got two small helps on 2026-08-03 (§8.27): today's card now names **guests
   > apart from students**, so the head-count finally agrees with the number of marks the
   > lesson actually needs, and the **Classes tab lands on the class list** rather than
   > whatever lesson was last opened.

*(Whether to enable cron is a decision, not part of the loop — it lives under
**Worth deciding, not urgent** below, once only.)*

> **"Set a coach rate" is still NOT a to-do.** Production is a private coach; no rate is
> the finished state (PRD §7.13). It becomes real the day this business hires a second
> coach — not before.

The join code is **`SWIM-RVM9`** — the only route in for a new family, and the re-entry route
for one marked inactive.

### ⚠ THE NEXT SWEEP HAS NEVER SEEN WAVE 3 — but there IS a driver for it now

The last sweep, **`31430917020`, was GREEN**: all 39 drivers, against `160cb09` — i.e. Wave 2,
not Wave 3. It executed Tuesday 2026-08-11 SGT (GitHub labels it `2026-08-10`; the cron is
20:00 UTC — **§7.122**) and closed `ui-driver-rot` issue #3 itself.

- **Wave 3 shipped after it with no driver; `verify-coach-roster.mjs` closed that on
  2026-08-12** (§8.45, 25 checks). **The next sweep is its first**, so watch it: it is the
  newest driver and the only one that has never faced one. It is also **not re-runnable by
  hand** — check 14 marks the lesson and check 0 needs it unmarked; apply the teardown and the
  fixture between runs. The sweep resets per driver, so this only bites a hand-run.
- `gh run list --workflow=ui-drivers.yml` and issue #3's own state are the fact.
- The two-sweep red streak (`31277289374`, `31334766457`) is closed: `verify-trials` was
  already fixed, and `schedule-week` 17/19 → 21/21 landed as `287142b` (§8.42).
- Every OTHER driver has faced a sweep; `verify-coach-roster` is the one exception, above.

> **Re-read the run, not this paragraph.** `gh run list --workflow=ui-drivers.yml` and issue
> #3's own state are the fact. This section once read *"✅ NO RED SIGNALS"* for a full day
> after the sweep had gone red beneath it, which is exactly what a green heading invites.

**`verify-multi-class` is not re-runnable by hand** — it removes a class through the UI, and
its fixture's `NOT EXISTS` guard is keyed on `(student, class)` regardless of `is_active`, so
a second run finds the row present-but-closed and does not restore it. Apply the teardown
first. The sweep resets per driver, so this only bites a hand-run.

**Three others mutate SHARED state**, which is why a sweep is not a substitute for a reset:
`verify-paynow-fallback` writes the seed tenant's PayNow columns, `verify-class-deactivation`
retires a seed-adjacent class, and `verify-trials` **leaves a booking behind on every run**
because it has no fixture at all — hence its *Set all* marking step and a final assertion that
counts rather than tests presence (§7.118).

> **Before triaging any red, read §7.108** — a driver dying on `page.goto(admin/login)` with a
> 30s `networkidle` timeout is a cold Next.js compile, not rot and not a product bug; `curl`
> the route and re-run first. **Then ask which weekday the run actually saw** (§7.122), and
> whether the driver takes an ordinal over a list it does not own (§7.75, §7.101) or skips
> itself on a date condition and reports PASS (§7.100). *(**§7.73 is cited across the repo as
> the shorthand for "an assumption that held until the data changed"** — that family reading
> is fine and is how `ui-drivers.yml` and `docs/TESTING.md` use it. But its text is the
> unordered-`LIMIT 1` fixture bug and contains **no calendar content**, so for a
> weekday-dependent failure the pointers above are the ones that actually pay. Noted, not
> renumbered: eight files cite it and the number is permanent.)*

### THE NEXT BUILD — one thing is genuinely queued, and it is small

**Waves 1, 2 and 3 are all complete** (§8.36–§8.40, §8.43, §8.44). Their plans in
`docs/plans/` are history, not queues. **`BACKLOG.md` → `## Build order` governs what comes
next** — the decisions the ranking rests on are in a table at its top.

**THE MIGRATION THAT WAS OWED IS PAID** (§8.45, `20260812000100`): the shadow branch can no
longer demote a lesson's main — in **either** of the two ways a lesson has one, the roster row
*and* the absence rule, which is wider than the item described. `sessions_i_am_main_on` shipped
in the same migration and the coach app consumes it. **The migration queue is empty again.**

**Three small items remain filed rather than fixed**, all in `BACKLOG.md`:
- *The Attendance page's Coach column can name someone who did not teach* (**S**) — the page an
  admin checks when wages look odd. Left deliberately: the fix carries a product choice (show
  the roster main, or show both with the cover annotated as Coach Wages does).
- *The admin's invoice pre-flight misses an unmarked EXTRA lesson* (**S**) — over-reports
  readiness; **never under-bills**, which is why it is S.
- *Deleting an admin destroys the audit history* (**S**) — unchanged since 2026-08-09.

**Wave 4 is next in the ranking** — a lesson recorded into an already-BILLED month, reported
and settled. Wave 2 unblocked it; Wave 3 did not touch it.

**The `service_role` question is now ANSWERED, and the answer is "don't build the whitelist"**
(`BACKLOG.md` carries the 11-call-site audit). `generate-invoices` alone touches 21 of 37 tables
and writes 8; the excluded set is a dozen tables a future feature plausibly needs, and the
failure mode of getting it wrong is `permission denied` **inside the invoice engine**. It also
would not defend against the real worst case — a leaked key holding `auth.admin.deleteUser`,
which no `GRANT` restrains. **What IS worth doing is the one-liner**: turn off the
default-privilege grant to `service_role` the way `20260804000400` did for `anon` and `PUBLIC`.
A sixth data point arrived on 2026-08-10 — the dump shows no `service_role` line on either
function this session touched (`docs/DEPLOYMENT.md` §11.7).

### Triage rules, when the sweep does redden

**Three triage rules worth keeping, all bought with real time:**

- **A job that dies before checkout is not your code.** Three CI runs on 2026-08-06 failed
  in *"Set up job"* during a GitHub Actions major outage. Check `githubstatus.com` before
  reading a diff.
- **When the sweep reddens, ask which moved — the product or the driver's assumption.**
  §7.73 is the assumption case (its family, not its literal text — see the note above);
  §8.33 is the product case, and it was a live bug that four green *manual* runs had missed
  because they ran outside the broken window.
- **The change that shipped yesterday is the SUSPECT, never the verdict** (§8.35). The
  2026-08-08 red looked exactly like §7.98 — written the day before, about the same screen
  — and was in fact a driver that had been broken for two weeks and had been skipping
  itself into a green PASS. Check when the driver last actually asserted anything.
  **2026-08-10 made the same point twice over** (§8.42): `schedule-week`'s red looked exactly
  like the §8.40 deploy hours earlier, and was a locator that had never worked on a weekday.
  **The cheap way to settle it is to check the driver out at the suspect's parent and re-run**
  — byte-identical driver, identical failure, suspect exonerated in one run.

**The migration queue is empty but ONE IS OWED** — see the shadow-branch item above. The
latest applied is `20260812000100` (the roster guard + `sessions_i_am_main_on`, §8.45);
production confirmed caught up 2026-08-12, 0 pending — and the ordering gate below was
followed for the first time deliberately: the migration merged and pushed to `main` ALONE,
`migration list --linked` was checked, and only then did the app commit land. **The new rule this session bought is about ORDER, not
content (`docs/DEPLOYMENT.md` §11.9): if a wave is split across worktrees, its migration must
land BEFORE the first app branch does.** A worktree cannot author one, so no worktree can see
that the deploy is incomplete — and both here pushed correct code onto a database that did not
have the schema yet. §7.123 still applies to signatures. Whatever comes next: still one at
a time (§7.55), a worktree never authors one, and budget the post-deploy grant check (§7.39,
§7.89) **and** the rollback rehearsal (§7.93 — running the DOWN file is the half that finds the
bugs). **Don't take `supabase db push`'s own output as proof it applied:** it printed a
`pgdelta` certificate stack trace *and* `Finished supabase db push` on 2026-08-09 **and again
on 2026-08-10** — three times now, so treat it as the normal output, not an incident.
`supabase migration list --linked` is the fact — check the `remote` column is filled.
**And read the function body from `pg_get_functiondef()`, never from the migration that first
created it** (§7.115): `CREATE OR REPLACE` means the newest definition can be in any later
file, and grep finds the oldest first. That cost a wrong risk rating on 2026-08-10.

> **To hold one migration back from another, MOVE THE FILE out of `supabase/migrations/` and
> put it back for the second push.** `supabase db push` applies everything pending, so two
> files present at once is one deploy and the ordering you wrote down did not happen (§7.49,
> §7.30). §8.39 used this to keep an RPC ungranted until its engine was confirmed live —
> §7.87 turned into a feature flag, and it is the pattern to copy whenever a new client path
> is only safe *after* something else deploys.

### The documents are on a THIRD attempt at discipline-by-instruction — watch it

`HANDOVER.md` is **40 KB against a 45,000-byte budget**. §8.43 spent 3.8 KB of the 7.4 KB
that was left after 2026-08-10's cut (§8.41) — half the headroom in one session. §8.44 cost
**nothing net**: it graduated everything first, then demoted §8.42 to a ledger row and paid
for its §3 row by deleting one. **That is the mechanism working — a session can add a wave
and leave the file smaller.** The
two previous attempts to hold a limit by writing it down both failed, reaching 290 KB and
then 91 KB — **§7.119** is why, and it is worth reading before the next `/update-docs`, not
after. Three commands are the whole of the discipline and take ten seconds:

```bash
wc -c HANDOVER.md                                              # budget 45000
grep -c '^_Previously,' HANDOVER.md                            # must be ≤ 1
awk '/^\| \*\*8/ && length($0)>200 {print length($0)}' HANDOVER.md   # must print NOTHING
```

**Nothing in CI checks these** — the byte-ratchet was built, proven to fail correctly, and
reverted deliberately (`BACKLOG.md` → *Deliberately not doing*). **If the file passes 45 KB
again, restore `scripts/check-doc-budget.sh` from `cb70808` rather than re-wording the rule
a fourth time.**

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
