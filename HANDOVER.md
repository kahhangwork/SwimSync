# SwimSync — Session Handover

_Last updated: 2026-10-06 (later) — **§8.139: Wave 6 SHIPPED in two lanes — package lessons draw at MARKING; the
monthly run bills only ad-hoc lessons; Generate is optional for a package-only month. Deploys #69–#73; Little Orcas's
package backfilled (8 lessons, S$420 left) after the user had Brayden Ong unlinked from the Ang family.**_

_Previously (§8.138, 2026-10-05 → 06) — Wave 4: *Starts on* on every add-to-class; the Front-desk hire's blind spot fixed._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.332** |
| What shipped in every older session | `docs/SESSIONS.md` | §8 ledger |
| Why the system is shaped this way | `docs/ARCHITECTURE.md` | §6, §10, §12 |
| What each test suite and UI driver covers | `docs/TESTING.md` | §5 |
| What is live in the cloud, and its config traps | `docs/DEPLOYMENT.md` | §11 |
| **Running two sessions at once without clashing** | **`docs/WORKTREES.md`** | — |
| How to bill a month | `INVOICE_RUNBOOK.md` | — |
| **Plans — which are open, which are done** | **`docs/plans/README.md`** (index; plans never move) | — |
| The design/plan behind a shipped feature | `docs/design/`, `docs/plans/` | — |
| **How to decompose an oversized page or screen** | **`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`** | worked example: `docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md` |

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
| Prepaid packages (+ in-app refunds and cash-basis revenue on Accounting, §8.132) — weeks/start-date/holiday-extension, renewal OFFERS (tokenised `/package` pay page + WhatsApp queue + default packages + Students columns/drawer), purchases numbered + QR-payable (`PKG-YYYY-NNNN`, §8.37) | pgTAP + Deno + vitest + jest + driver, LIVE 2026-08-15 | PRD §7.16 · §8.59, §8.60 |
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

- **Packages** (§8.70, §8.60, §8.139) — **1 active package and 0 holidays voided on prod**; the marking-time draw has
  fired only through B's backfill (8 draws), so the D6 guard (PK001), the backdated dialog and holiday-void returns
  have never fired live, nor have renewal offers/supersede or the `/package` page. First firing: the next package
  family's marked lesson / first `Void lessons` / first offer.
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
- **Swim-skill grading (§8.92/§8.93, PRD §7.15)** — **no longer dormant**, exercised on prod 2026-08-29 (§8.94).
  Still unexercised: the cross-tenant + keep-records `RESTRICT` guards, `merge_students`' skill-progress move, and
  **re-confirmation advancing `graded_at`** — that last needs a grade OLDER than the round start, so it cannot be
  seen until the first genuine round (~3 months). pgTAP holds it (§7.220).
- **The branded signup-confirmation email (§8.99, `supabase/templates/confirmation.html`)** — dormant **by design,
  not by data**, and the only entry here that is meant to stay that way: `enable_confirmations` is false because
  turning it on stranded web parents. It has never been sent and **cannot be** without the flag (§7.232), so the
  usual "first firing" line does not apply — there is no trigger to wait for, only a decision nobody should make
  casually. `authEmailConfig.drift.test.ts` holds the local flag down; the hosted one is confirmed off by
  `GET /auth/v1/settings` (`mailer_autoconfirm: true` — inverted, see §7.232).

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

## 8.139 (2026-10-06) — Wave 6: package lessons draw at marking (two lanes, root orchestrating)

**`/plan-with-confidence` (D1–D7, D2 refined: Generate optional) → `/plan-review` (12 risks) → shipped in plan order
A → engine v33 → Apps-1 → B → Apps-2, the root writing every migration and the engine, lane 2 (worktree
`wave6-apps`, closed) the apps and the driver.** Commits `ad51148` (plan) · `d3c64c2` (A) · `ddb7fec` (engine) ·
`d60e89e` (Apps-1) · `a714180` (B) · `0ef1e89` (Apps-2 + driver) · `c14830d` (handoff).

- **Shipped:** PRD §7.16 (money moves at marking; the D6 guard; the backdated dialog; the usage list); ARCHITECTURE
  §6ae; DEPLOYMENT #69–#73; TESTING §5 *Wave 6*. pgTAP 1789 → 1858, Deno 284 → 292 (twice), vitest 1062 → 1093,
  jest 666 → 680, driver 33/33.
- **Found by the new tests, fixed before prod:** `package_usage`'s gate let a coach / another business / Front desk
  read a package (§7.328); the guard's message named a lesson its own filters excluded; three vacuous checks (§7.330).
- **Prod data, the user's call:** Brayden Ong unlinked from the Ang parent before B (DEPLOYMENT #72) — his 2 Sep
  lessons are now unclaimed; the Little Orcas owner must invite his parent or record them settled.
- **Nightly `37398088721`:** 71/72; `app-coach-settings` (CI file-chooser timeout) re-ran 6/6 locally → gate cleared.
- **Gotchas:** §7.323–§7.332; §7.302 *Hit again*. **Not done:** BACKLOG's three Wave 6 follow-ups; Wave 7 unplanned.

## 8.138 (2026-10-05 → 06) — Wave 4: a start date on add-to-class; the Front-desk hire's blind spot fixed

**Re-ranked the backlog with the user into Waves 4–8, billed September (Coach Kah Hang only — Little Orcas is the
owner's, §9), then `/plan-with-confidence` → `/plan-review` → two lanes: this session (root) shipped the start-date
feature end to end; a side session (worktree `wave4-frontdesk`, now removed) drove the Front-desk role and found that an
operations-only co-admin saw NO teaching coach anywhere — fixed and live before its driver merged.**
Commits `8d73d3b` `06d4811` (backlog) · `48b61ce` (plan) · `1069aa4` `0984b0c` (migrations) · `ccc0e4a` `91627f0`
`0b3cb65` (apps) · `41d9676` `aec2076` (functions) · `993bc87`…`d9f5f42` (lane 2).

- **Shipped:** PRD §7.4 (*Starts on*, *Change start date*), PRD §4.3 (who taught is readable to operations roles);
  ARCHITECTURE §6ad; DEPLOYMENT #64–#68. pgTAP +52, vitest 1028 → 1062, Deno +3, two drivers (TESTING §5).
- **Decided with the user:** backlog Waves 4–8 (hire = Front desk; refund display and hide-edit-controls → *Deliberately
  not doing*); NEW *Package-funded lessons need no monthly run* ranked ahead of the DB clock; all four add paths; edit
  after the add; both nightly gates WAIVED.
- **Found by asking "is this on purpose?":** the user challenged a quirk I had filed as intended — it was a §7.7 bug
  (engine's UTC date slice), and a second one turned up in `package-emails`. Both fixed; the check is BACKLOG S.
- **Gotchas:** §7.318–§7.322; §7.7 and §7.272 *Hit again* (#19 now scoped — promoted to a fix).
- **Not done:** Little Orcas September (owner, WhatsApp sent); Wave 6 unplanned. Nightly not dispatched.

_(§8.137 and older are ledger rows in `docs/SESSIONS.md`.)_

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
2. **August 2026 is BILLED AND CLOSED** (2026-09-22, §8.117) — 9 invoices, the unclaimed child settled. The
   owner confirmed it on the live card on 2026-09-23: *Aug 2026 · Closed on 22 Sep*. Keep
   September marked as it happens (the coach's **NEEDS MARKING** list is the tracker) and bill it in early
   October. **Invoices → Billing months is now the scoreboard**: every open month, why, and its last runs.
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

**State on 2026-10-06: nightly `37398088721` (on `cb2025f`) was 71/72** — the first over #61/#63/#65/#67 and both
Wave 4 drivers, all green; the one red, `app-coach-settings` (CI file-chooser timeout, code untouched for weeks), re-ran
6/6 locally (§8.139). **The NEXT nightly is the first over all of Wave 6** (#69–#73) and the first run of
`verify-package-draw-at-marking` (33), so expect 73 drivers. Read first: that one, then `packages-admin`, `packages`,
`package-renewal`, `accounting-packages`, `attendance-guard`, `cancel-lesson`, the invoice/billing-months drivers
(*Nothing to bill*), and `app-coach-settings` again (a second red there is a real driver problem, not a flake).
`CANNOT SAY` in tenant-suspension / coach-disable is a page that never loaded, not a verdict (TESTING §5).
**The nightly is dispatched or re-run ONLY on the user's word** (CLAUDE.md).

**How to read a red one → `docs/TESTING.md` §5, "Reading a RED nightly sweep"** (screenshots FIRST, then
§7.108's cold compile, then the four triage rules). Hand-run caveats — which drivers are not re-runnable,
which mutate shared seed state — are in the same section.

### THE NEXT BUILD — pick from BACKLOG

1. **Read the next nightly** (never dispatch it unasked) — the first over all of Wave 6. Red → fix first.
2. **Little Orcas September is the OWNER's** (WhatsApp sent 2026-10-05): *Generate Sep 2026*, then *Record it as
   settled* for the 15 pilot children (PRD §7.17) — **and now Brayden Ong** (unlinked from the Ang family 2026-10-06,
   his 6 + 13 Sep lessons unclaimed: invite his parent or settle). The Ang family's package lessons are already paid
   (drawn at B), so they need no Generate. Coach Kah Hang's September is billed and sealed.
3. **Next build — Wave 7, *Inject the database clock* (L) — `/plan-with-confidence` first** (`BACKLOG.md` → *Build
   order*; Wave 6's new functions are on its conversion list). Not mid-billing. The three Wave 6 follow-ups are S-items
   in BACKLOG (*Re-offer the backdated draw*, the coach P0001 mapping, "Sep"/"Sept").

- **Reading prod:** `scripts/prod-query-ro.sh "<one statement>"` — read-only by Postgres, allowed without a prompt.
  Raw `supabase db query --linked` can WRITE and asks first (DEPLOYMENT #47, #62).
- **Before picking any BACKLOG item, check it has not already shipped** (`git log -S'<key symbol>'`, §8.127).
- **A new test/fixture date:** derive it from `session_window_start()` or CI refuses it (§7.305).
- **Before any local driver run:** start Expo WITHOUT `CI=1` and grep the served bundle for a symbol only the
  current change has (§7.253); **`verify-app-auth` needs :8081** (§7.268); a `--only` run RESETS the DB.
- **A new staff-creating route must mint a `staff_invitations` row** (§7.289); **a new admin surface must name its
  area** in `lib/adminNav.ts` and gate its RPCs with `has_admin_area` (§6ab).

**GATE (§7.1): read the next nightly before the next APP unit merges.** Driver-only units need no gate.

**No migration is HELD or in flight.** Latest applied is `20261006000200` (Wave 6 B: switch on + backfill), on prod,
0 pending (2026-10-06). **B's rollback is valid only until the first seal of a month containing draws** (its header).
**`supabase migration list --linked` is the fact; a prose status is a hint.**

> **Cron-gated follow-ups stay parked** (reminders remain manual): reward-expiry nudge, unprompted
> low-balance email, automated reminders.

### When the sweep reddens, and when you deploy — both graduated

**Reading a red sweep → `docs/TESTING.md` §5, "Reading a RED nightly sweep".** The four triage
rules, the screenshots-first instruction and the cold-compile check moved there on 2026-09-18.
They were 5 KB of reference sitting inside *Next steps*, which is where reference goes to be
re-written every session and read by nobody.

**Deploying → `docs/DEPLOYMENT.md` §11 and CLAUDE.md's "Deploying" rules.** The narrative that
used to sit here cited ten §11.x entries that already held every word of it — §11.44 (freshest
same-signature `CREATE OR REPLACE`), §11.43 (freshest CONTRACT half), §11.42 (freshest full
sequence in order), §11.29 (the expand/contract worked example). Read those, not a fourth copy.
**Run `/deploy` before the next backend push** — it hard-gates the app deploy behind 0-pending.

### The documents are on a THIRD attempt at discipline-by-instruction — watch it

**Measure BEFORE writing, not after** — that is the whole of it, and §7.119 is why (two
previous attempts to hold a limit by writing it down reached 290 KB and then 91 KB). The
mechanism that works: graduate everything to `docs/` first, demote the third-newest §8 entry
to a ledger row, and pay for a new §3 row by deleting one. A session can add a feature and
leave the file smaller. Three commands, ten seconds:

```bash
wc -c HANDOVER.md                                              # budget 45000
grep -c '^_Previously,' HANDOVER.md                            # must be ≤ 1
perl -CSD -nle 'print length if /^\| \*\*8/ && length>200' HANDOVER.md   # must print NOTHING
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

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages — first real sale:
Little Orcas, PKG-2026-0002),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
