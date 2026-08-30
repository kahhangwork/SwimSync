# SwimSync — Session Handover

_Last updated: 2026-08-30 — **First full local driver sweep since §8.93: 50/50 green after five fixes**
(§8.95). Three reds found by the sweep, two more defused before firing on 1 Sep. **The NIGHTLY is still red
on `verify-assessment` for an unrelated UTC/SGT reason that local runs do not reproduce — §9 has the evidence.**_

_Previously, 2026-08-29 (§8.94) — the Assessment tab was exercised on prod; grading stopped being dormant._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.209** |
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
>
> *Graduated again 2026-08-22 (the Wave D docs-tax item):* DORMANT trimmed to one line per area,
> and the *Production reality* deploy/rollback narrative dropped in favour of a pointer to
> `docs/DEPLOYMENT.md` §11, which already held it — restated here it was a fourth copy that drifts.
> Verified table + prohibitions kept intact.

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
| Prepaid packages — weeks/start-date/holiday-extension, renewal OFFERS (tokenised `/package` pay page + WhatsApp queue + default packages + Students columns/drawer), purchases numbered + QR-payable (`PKG-YYYY-NNNN`, §8.37) | pgTAP + Deno + vitest + jest + driver, LIVE 2026-08-15 | PRD §7.16 · §8.59, §8.60 |
| **Parent referral codes — double-sided package discount** (`REF-` join code, friend's-first + referrer's-later reward, FIFO, tenant %/$ + per-product override, same-household guard, admin Referrals page) — moves `amount_payable`, never `total_value` | pgTAP 57 + Deno + vitest + jest + `verify-referrals` 13, **LIVE 2026-08-15** | PRD §7.16 · §8.61 |
| **Advance-cancel a lesson — admin cancels a FUTURE lesson with a reason; the SESSION carries it; parent struck, coach nothing to mark (DB trigger), engine neither blocks nor bills; a live guest on the date still BLOCKS** | pgTAP 37 + Deno + vitest + jest + 17-check driver, LIVE 2026-08-21 **DORMANT** | PRD §7.6 · §7.203, §7.204 · §8.81 |
| Every child's name carries their payment method (per-child, category-aware) | pgTAP + vitest, LIVE | PRD §7.16 · §8.23 |
| Fee-free payment collection — `INV-YYYY-NNNN`, dynamic QR, tokenized page, WhatsApp queue | pgTAP + Deno ×2 + vitest + jest + driver, LIVE | PRD §7.21 · §8.26 |
| Make-up classes — the guest-pass model | pgTAP + Deno ×2 + vitest + jest + 14-check driver, LIVE | PRD §7.20 · §8.25 |
| Creating a business in-app | UI + backend, LIVE 2026-07-21 | PRD §4.4 · §8.9 |
| A child can exist before their parent | pgTAP + Deno + driver, LIVE | PRD §7.17 · §8.10 |
| A parent can claim the child their coach already added | pgTAP + vitest + driver, LIVE | PRD §7.18 · §8.12 |
| A parent's contact details can be corrected | vitest + driver, LIVE | PRD §7.19 · §8.14 |
| The attendance window is a DB rule; a mid-month joiner no longer blocks a month | pgTAP, LIVE | PRD §7.5 · §8.15 |
| A month billed LATE can no longer be permanently unbillable (`markable_floor`) | pgTAP 18, LIVE | PRD §7.6 · §8.32 |
| The coach's landing tab is a WEEK, not a day | jest 308 + 19-check driver, LIVE | PRD §14.2, §7.5 · §8.34 |
| **A lesson recorded into an already-BILLED month is reported, and settled** | pgTAP 18 + vitest + 13-check driver, LIVE 2026-08-12 | PRD §7.17 · §8.48 |
| Every audit row knows which business it is about | pgTAP, LIVE | `docs/ARCHITECTURE.md` §6 · §8.28 |
| Every EDIT to a child is recorded (`SECURITY DEFINER` trigger) | pgTAP 11 + 4 drivers, LIVE 2026-08-09 | §7.104 · §8.38 |
| `anon` holds EXECUTE on no callable function, and gets none for free | grant dump, LIVE | §7.82, §7.85 · §8.28 |
| A signed-in stranger cannot forge into a business or onto a child | pgTAP, LIVE | §7.86–§7.89 · §8.29 |
| `authenticated`'s table grants are a DECLARED WHITELIST, re-proven by CI | `table_grants.test.sql` | §7.87 · §8.29 |
| Co-admins, managed by the business's OWNER | pgTAP 38 + vitest + driver, LIVE | PRD §4.3 · §8.31 |
| A class can be RETIRED without losing money | pgTAP 23, LIVE | PRD §7.3 · §8.39 |
| An unmarked GUEST holds the month open; nothing new enters a retired class | pgTAP + Deno, LIVE 2026-08-10 | PRD §7.3 · §8.40 |
| **A child can attend MORE THAN ONE class a week** | pgTAP + vitest + jest + 17-check driver, LIVE 2026-08-11 | PRD §7.4, §7.20 · §8.43 |
| **A substitute is per-LESSON; a SHADOW is per-CLASS — dated, paid its own shadow rate** | pgTAP 49 + 9 + vitest + jest + **30-check driver**, LIVE 2026-08-12 | PRD §7.13, §7.6 · `docs/ARCHITECTURE.md` §6z · §8.46 |
| **An admin's audit trail REFUSES their deletion — it is never destroyed to permit one; most admins are therefore undeletable and Deactivate is the route** | pgTAP 925 + driver 24/24, LIVE 2026-08-13 | PRD §4.3 · §7.153 · §8.52 |
| **Wave 5, admin authority — owner REASSIGNED (platform-only) · coach DISABLED (atomic handover, pure-coach ban) · tenant SUSPENDED (staff+parents dark, staff banned, engine skips; already-sent invoice links deliberately keep working)** | pgTAP 27+55+88 + vitest + 3 drivers, LIVE 2026-08-13 | PRD §4.3, §4.4 · §8.49–8.51 |
| **A parent is emailed when a credit note is issued** — one per note, lesson details from the invoice's snapshot, two labelled amounts; an applied note is refused; admin **Resend** for a miss | Deno + vitest + jest, LIVE 2026-08-17 **DORMANT** | PRD §7.8 · §8.64 |
| **The ADMIN marks attendance (lesson page) + sees every coach's lessons (Calendar) — the coach app's SAVE PATH, every DB guard unchanged, NO override; the calendar NEVER writes; capacity is ADVISORY (Book anyway), not a guard** | pgTAP 34 + vitest + 2 drivers (21 + 25), LIVE 2026-08-19 | PRD §7.6, §7.22 · §8.71 |
| Automated tests — pgTAP + Deno backend, vitest + jest-expo apps, all in CI on push | CI | `docs/TESTING.md` §5 |

**Counts are deliberately not written here.** The runner is the fact; a number in prose is
a hint that has already drifted. `docs/TESTING.md` §5 says what each suite covers.

### DORMANT — shipped and verified, never exercised on real data

This is the half of "verified" that a PRD cannot tell you, so it is the part of §3 that
earns its place. **Shipped ≠ exercised**, and a guard that has never fired in production
is a guard whose first real firing is still ahead of you. **Each of these is dormant for a
DATA reason, not a bug — don't rediscover any as broken** (the §7.131 shape throughout: with
one coach who is also the admin, most narrowing is unobservable). One line per area; the
first-firing trigger is what to watch for.

- **Packages** (§8.70, §8.60) — **0 packages AND 0 holidays voided on prod**, so the
  weeks/start-date layer, holiday void-extension, renewal offers/supersede, the `/package` page and the
  RISK 1/2/4/12 guards (§7.156–§7.162) have never fired. First firing: the first `Void lessons` / first offer.
- **Billing a month LATE** — no late month billed, so `markable_floor`'s reopened window is unused
  insurance, shipped ahead of its own trigger.
- **Retired classes** — **0** inactive classes on prod (re-confirmed 2026-08-10); none retired on real data.
- **Guest bookings** — **0** live trial/make-up bookings, so §8.40's block has never fired (which made it safe to ship).
- **Substitutes & shadows** — **0** `session_coaches`, **0** `class_shadow_coaches`; the *Add a shadow*
  dropdown is **correctly empty** (§7.131). No payout ever generated on prod (rate-less coach skipped). Real
  the day a second coach is hired; verified locally by `verify-coach-roster` (30 checks) — the only place it can be.
- **All credit work** (§8.64/§8.68/§8.69, **+ partial-payment §8.83/§8.84**) — **0 credit notes** on prod, so
  emails, Resend/Void, `CN001`, the engine credit lock, the `reversed_at` filter — **the whole `debit_balance`
  path** (void-on-paid → debit, the engine fold, `CN002`), **and now the follow-ups** (the pending-debit
  auto-unwind, the pending-charges panel, the offboard guard, `write_off_parent_balance`) — are all dormant
  (0-rows made every backfill a no-op). **The ordering-guard (§8.69) is a PROVABLE no-op** — prod bills in order
  (only 2026-07 sealed). First firing of the debit path: the first void of a credit drawn against a PAID invoice.
- **Orphan-lesson report** — 0 lines, badge never lit (every July invoice Paid). First firing: a backdated
  enrolment/make-up/trial, or an absent→present edit after billing.
- **Wave 5 controls + admin-delete refusal (§8.52) + Attendance money-axis (§8.53)** — all dormant for the
  §7.131 reason: owner-transfer has no target, coach-disable is sole-owner-refused, suspension has suspended
  nothing (correct state: two dormant Platform buttons), admin-delete cannot fire (every admin is their own
  owner), money-axis == access-axis (one coach, nothing handed over). Real the day a co-admin/second coach
  exists or a class changes hands.
- **Multiple classes per child** — no child holds two enrolments yet; neither schedule guard has refused
  anything real. First real one also first makes `'mixed'` package coverage reachable (PRD §7.16).
- **Wave C (§8.66)** — 4 of 5 dormant on data (convert-trial, make-up-from-Attendance, CSV, parent upcoming);
  **Change History is LIVE** (real `audit_log` trail).
- **Capacity hard limit + holiday SGT boundary + retire-race locks (§8.73/§8.75/§8.77/§8.78)** — no class
  carries a `capacity`, no same-day holiday retirement, one admin can't race a seat or a retire, so §7.198–§7.201
  refuse nothing yet; **the Lessons sidebar badge is the exception — LIVE** (PRD §7.3/§7.6/§7.22). First firing needs a second admin.
- **Owner-only accounting page (§8.87, PRD §7.23)** — LIVE on prod but **no owner has opened it**; the
  "never a partial figure" guard (wages WITHHELD when payouts unrun) and the `draft`/`run_payouts` states have
  never fired on real data. Prod is a rate-less solo coach, so Wages=0/Net=Revenue is the only branch reachable
  today; the wages-coverage branches go live the day a second, rated coach exists. First real figures: the first
  time the owner views a billed month.
- **Location entity (§8.88/§8.89, PRD §7.24)** — LIVE on prod, now **contract-complete** (free-text columns
  dropped, §8.89). Still **one backfilled location, no admin has opened the page**: the archive guard,
  cross-tenant guard, and the coach/admin filters (shown only at >1 location) have never fired on real data.
  First firing: the admin adds a second location.
- **Move-student new arms (§8.91, `20260827000100`)** — the RPC's level-clear, the parent-membership write, and
  the credit-warning dialog have **never fired on prod** (no cross-business move since). Don't rediscover as
  broken; exercise one real move before the first real one. First firing: a family entered the wrong join code.
- **Scoped search past the 1000-row cap (§8.91)** — every table is under the cap on prod, so the DB pushdown,
  the `!inner` narrowing (§7.216) and the cap banners are all unexercised at scale; correct today by coincidence
  of size. First firing: any admin table crosses ~1000 rows.
- **Swim-skill grading (§8.92/§8.93, PRD §7.15)** — **no longer dormant.** Exercised on prod 2026-08-29 (§8.94,
  the plan's §11): the round mechanism, the vacuity guard and the promotion gate have all fired on real data.
  Still unexercised: the cross-tenant + keep-records `RESTRICT` guards, the `merge_students` skill-progress move,
  and **re-confirmation advancing `graded_at`** — that last needs a grade OLDER than the round start, so it
  cannot be seen until the first genuine round (~3 months). pgTAP holds it (§7.220).

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
  account; `add_unclaimed_student()` is **admin-only on both arms** as of §7.202 (2026-08-21) —
  the coach caller it once accepted server-side is refused, and no UI ever reached it. §8.10/§8.11.
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

*(Graduated 2026-08-22: the deploy-mechanics and rollback narrative dropped in favour of a pointer to
`docs/DEPLOYMENT.md` §11, which already held it — restated here it was a fourth copy that drifted. What
stays below is the small set of production FACTS that live nowhere else, plus the standing prohibitions.)*

- **"CLEAN SLATE" IS A BANNED PHRASE — it has been wrong twice** (2026-07-25, 2026-07-26). Production
  holds **real families**: the July cleanup deleted named test records only (21→9 students, 12→7 parents),
  and zeroed `attendance`/`lesson_sessions`/`invoices` — not the families. Say *"no attendance recorded"*
  if you must, never *"clean slate"*, and read the count, never the sentence: `SELECT COUNT(*) FROM students;`.
- **REAL BILLING EXISTS since 2026-08-02** — July was billed for real (`INV-YYYY-NNNN`, month sealed,
  real PayNow money collected, `confirm_invoice_paid()` audit rows). §8.19/§8.26. **Don't read a count from
  prose** — `SELECT status, count(*) FROM invoices GROUP BY 1;` is the scoreboard.
- **One non-repeatable production data change:** all active enrolments were **backdated to 2026-07-08**
  so July's lessons fell inside the marking window — which is why children are billable from the 8th, and
  it cannot be redone from the UI.
- **Deploy mechanics + rollback cover → `docs/DEPLOYMENT.md` §11** (also the CLAUDE.md "Deploying" rules):
  `main` deploys the WEB APPS ONLY; edge functions and migrations are separate manual steps; `supabase
  migration list --linked` and `supabase functions list` are the honest "what's in prod", never a SHA or
  a count in prose. Five edge functions today (`public-invoice`/`public-package` are `verify_jwt false` by design).

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`).

**Not done yet** (see §9): native **App Store / Play Store** builds remain deferred (web
app on iPhone for now). Parent onboarding is routine, not a gate: a family enters the join
code at `swimsync.sg/welcome` and the admin assigns each child to a class.
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

## 8.95 (2026-08-30) — A reset-first driver sweep: 50/50 green, and a fuse defused two days early

**Five driver/fixture fixes, no product change.** `ccb60be`, `1526efe`, `4cd226a`. Every fix re-run on a
**freshly reset** database; `check-fixture-roundtrip` 26/26. **All five are one shape — a fact written down
twice, drifting — and all five are graduated: §7.223, §7.224, §7.225, §7.226.**

- **Three reds the sweep found** — `verify-assessment`'s fixture hardcoded a seed uuid the reset regenerates
  (§7.224); `verify-platform-admin-scope`'s page pin said 24 and `/assessment` made it 25; `verify-trial-visibility`
  asserted a hardcoded `Aug` against a date computed from `now()` (§7.225).
- **Two more were found by AUDIT, not by failure, and were two days from firing.** `verify-bulk-setall` and
  `verify-unmarked-lessons` froze their browser clock at 15 Jul against a July fixture; `markable_floor` moves to
  1 Aug on 2026-09-01 and both would have gone red on a day nobody touched them. Proven by pinning
  `session_window_start()`, then fixed by deriving the dates. **§7.226 carries the two non-obvious constraints**
  (why "last month" and not "the last few days"; why the enrolment date is load-bearing).
- **`check-fixture-roundtrip.sh` cannot catch a reset-fragile fixture** — it never resets, and passed 26/26
  twice on the day one was broken. The load-bearing half of §7.224.
- **Deliberately NOT built:** the future-date simulator, deferred by the user after its two real limits were
  spelled out. Now a `BACKLOG.md` item with the mechanism and both limits, so it is not re-derived.
- **Scanned for siblings of each fix; none systemic** — one fixture had a non-convention uuid, one driver pinned
  the sidebar count, one fixture had an absolute session date. The other hardcoded dates are safe, and §7.226
  records why the audit question is *"is the FIXTURE's date relative?"*, not *"does the assertion look hardcoded?"*

## 8.94 (2026-08-29) — The Assessment tab is exercised on prod; a copy bug found and shipped

**No feature shipped — one fix, and a dormant guard made real.** §8.93 deployed grading DORMANT hours earlier
on the same day; this session graded two children in *Tanglin View Sun 845am*. **What each arm proved, and the
reusable technique for observing a round mechanism on the day you grade, are in the plan's §11.** Commit
`ccb60be`; admin vitest 620, typecheck + `next build` clean, fixtures 26/26.

- **Four of five arms confirmed on real data** — admin-only writes (the coach app's *Skills* screen refuses),
  the vacuity guard (§7.219), the round mechanism, the promotion gate. The fifth, **re-confirmation advancing
  `graded_at`** — the thing `20260829000100` exists to fix — **cannot be seen on prod yet, and that is not a
  gap**: it needs a grade older than the round start. pgTAP holds it (§7.220); first real round in ~3 months.
- **`ccb60be`** — both Assessment surfaces rendered *"1 need a level"*, a count interpolated into a fixed
  plural. The driver's regex had to move with the copy or the nightly sweep would have reddened on a check
  about something else. **§7.223** is the durable half, and it generalises past this one string.
- **The plan's pre-commit gate had two boxes unticked that had in fact been done** at the §8.93 deploy
  (the prod-half `count(*)`, and `/deploy` itself). Ticked, pointing at §11.46. A gate left half-ticked
  reads as work outstanding to the next session.

_(§8.93 demoted to a ledger row in `docs/SESSIONS.md` — grading admin-only + the Assessment tab.)_

## 9. Next steps (pick with the user)

> **This is the current shift, not the queue.** The full list of unbuilt ideas — with
> the reasoning for each — lives in **`BACKLOG.md`**. Don't restate it here; the two
> will drift.

### The July mission is COMPLETE — this is now an operating rhythm, not a blocker

**2026-08-02: July was billed for real, and real money was collected** (§8.26, §3).
Everything below is the monthly loop from here on:

1. **July is fully collected** — the live Invoices page showed every invoice Paid,
   S$0 outstanding, on 2026-08-12. That is a hint, not a count:
   `SELECT status, count(*) FROM invoices GROUP BY 1;` is the honest scoreboard. The
   WhatsApp queue (Invoices → *WhatsApp reminders*, with the **Claimed** filter) is the
   chasing tool when a future month needs it.
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

### The nightly sweep

> **Re-read the run, not this paragraph.** `gh run list --workflow=ui-drivers.yml` and the
> rot issue's own state are the fact. This section once read *"✅ NO RED SIGNALS"* for a
> full day after the sweep had gone red beneath it.

**State on 2026-08-30 — the LOCAL sweep is 50/50 green (§8.95). The NIGHTLY is still RED, and the two are
not measuring the same thing.** Run `33278795124` (2026-08-29 22:31 UTC) failed **2 of 50**:
`tenant-provisioning` 5/8 (the known one-night `waitForTimeout` flake) and **`verify-assessment` 21/27**, which
is a genuine open bug and **the first thing to pick up**.

> **⚠ I could not reproduce the assessment red locally, and the reason is the whole clue.** It fails on checks
> like *"a child graded today counts toward this round"*, with today's grades rendering **stale** (`Developing·
> 29 Aug`, `0/2`). The run's wall clock was **06:31 SGT on 30 Aug** — inside the UTC-16:00–24:00 window where
> the UTC and SGT dates disagree. Two facts consistent with that, both checked: `verify-assessment.mjs` is the
> **only** driver that does not pin `timezoneId: "Asia/Singapore"`, and `isFreshGrade` parses
> `` `${since}T00:00:00` `` with **no zone suffix**, so the round boundary is the *viewer's device* midnight.
> **This is a HYPOTHESIS, not a root cause** — `TZ=UTC` alone still passes 27/27, because at 16:00 SGT the two
> dates agree; the failure needs the disagreement window as well. **Reproduce by running inside UTC 16:00–24:00,
> or by faking the clock into it, BEFORE changing anything.** If it holds, the driver fix (pin the timezone) and
> the product question (should a round boundary depend on the device's zone at all? §7.7's axis) are separate
> decisions — the second one matters beyond the test.

**Hand-run caveats (which drivers are not re-runnable, which mutate shared seed state) are
collected in `docs/TESTING.md` §5** — graduated there 2026-08-12; don't restate them here.
**One more, learned 2026-08-30:** `check-fixture-roundtrip.sh` run straight after a UI driver reports
failures that are just the driver's own UI writes — reset before believing it.

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

### THE NEXT BUILD — pick-now list is in `BACKLOG.md`

**First: triage the nightly's `verify-assessment` red** — the evidence and the reproduction condition are in
*The nightly sweep* above. It is a real bug, it is one day old, and §8.65's rule applies: a sweep left red stops
being an alarm. Do it before starting a feature.

**Then, top pick: Piece 5 — email-confirmation copy** (S) — a branded template following
`supabase/templates/recovery.html`; **do NOT switch email confirmation ON** (it stranded web parents once —
assert `enable_confirmations = false` stays, in `config.toml` AND the hosted project). Apps/config only, no
migration. After it the S-pool is exhausted; other parked items live in `BACKLOG.md`.

**No migration is HELD or in flight.** Latest applied is `20260829000100` (grading admin-only, §8.93), on prod,
0 pending, with a rehearsed DOWN in `supabase/rollback/`. Piece 5 authors none.

> **Cron-gated follow-ups stay parked** (reminders remain manual): reward-expiry nudge, unprompted
> low-balance email, automated reminders, and the **crash-safe email claim** (covers
> `credit_notes.email_sent_at` too).

### Triage rules, when the sweep does redden

**Four triage rules worth keeping, all bought with real time:**

- **A sweep left red stops being an alarm.** A deliberate page-count pin nobody bumped (§7.178)
  once sat on top of a LIVE regression (§7.176) in the same rot issue, unread, while CI was red on
  every push. **Triage the day it reddens even when you are sure which check it is** — you are sure
  about one driver; it reports several. §8.65. *(Wave-5 suspect→commit map if one of those areas
  reddens: `verify-admins`→`ee15814`; `platform-admin-scope`/Platform page→`9c1279c`; Coaches
  page→`f5d91aa`. The Attendance money-axis change, §8.53, registered NO driver — vitest + a one-off
  8/8 browser run cover it.)*
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

**Run `/deploy` before the next backend push** — it hard-gates the app deploy behind 0-pending. (Migration state
is stated once above under *THE NEXT BUILD*.) **§11.44 is the freshest worked
example** — a same-signature `CREATE OR REPLACE` (no grant dump, §11.32) FIRST, apps to `main` LAST, verified by
grepping the served bundle (§7.31). **§11.43 is the freshest CONTRACT half** — a one-way column DROP with no grant
dump and no app deploy. **§11.42 is the freshest FULL sequence done IN ORDER** — a new table
+ a DROP+CREATE function signature needing a remote grant dump → GATE → apps to `main` LAST, proving the new
auth-gated route by 200-vs-404 (§8.64's technique for §11.25's gap), with a committed rehearsed DOWN.
§11.40/§11.39/§11.37 are earlier full-sequence examples; **§11.38 records the §11.9 ordering mistake recurring**
(recovered by reverting the app files only, landing the backend, re-applying apps last). §11.36 is the
same-signature contrast (no grant dump needed, §11.32 pattern).
**§8.70 (DEPLOYMENT §11.29) is the freshest worked example of the full sequence** — and the first
**expand/contract** one: 7 migrations → engine v25 → apps → served-bundle grep GATE → the contract
migration LAST (held back by a `.hold` rename until the apps stopped reading the dropped columns);
a git push deploys neither migrations nor edge functions. §8.64 (§11.25) is the earlier example where the APPS had to wait on a
NEW edge function. The rule stands:
migrations to prod (engine too when `core.ts` changes — it did NOT for either email feature) FIRST,
apps to `main` LAST.
§7.123 still applies to signatures. Whatever comes next: still one at
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

**Measure BEFORE writing, not after** — that is the whole of it, and §7.119 is why (two
previous attempts to hold a limit by writing it down reached 290 KB and then 91 KB). The
mechanism that works: graduate everything to `docs/` first, demote the third-newest §8 entry
to a ledger row, and pay for a new §3 row by deleting one. A session can add a feature and
leave the file smaller. Three commands, ten seconds:

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

**Whether to enable cron. Revisited 2026-08-16 → STAY MANUAL for now** (the user's call). Both
original blockers are long gone (timezone-correct billing month, configurable run day) and the
engine is per-tenant, but manual billing + the WhatsApp click-through queue are working, so cron
stays off. This is a "not yet", not a refusal — it parks the three scheduled-reminder items
(unprompted low-balance nudge, automated reminders, referral reward-expiry nudge). Before switching
it on later: a blocked month becomes a *silent stall* rather than a button that refuses, and the
block-notification email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
