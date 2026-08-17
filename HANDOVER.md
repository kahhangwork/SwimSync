# SwimSync — Session Handover

_Last updated: 2026-08-17 (Wave C) — **All FIVE Wave C items SHIPPED LIVE in one app-only push**
(§8.66): CSV export, convert-a-trial, parent upcoming-lessons, book-a-make-up-from-Attendance, and
the **Change History** page. No migration, no edge function — `c4d78f5..4891744` on `main`, Vercel
builds both sites. Built `/plan-with-confidence` → `/plan-review` (Fable) → per-item
`/commit-review`; six risk mitigations, each proven red. §7.179–180 · `§11.26`. **Wave C is EMPTY.**_

_Previously, 2026-08-17 — CI and the nightly were BOTH red and nobody had looked (§8.65): CI red
every push for 20 commits on an expired fixture date, and under the nightly noise a LATENT PGRST201
regression emptied the package catalogue (prod has 0 `package_products`, so no loss). §7.176–178._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.178** |
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
| Prepaid packages — weeks/start-date/holiday-extension, AND renewal OFFERS (tokenised `/package` pay page + WhatsApp queue + default packages + Students columns/drawer) | pgTAP + Deno + vitest + jest + driver, LIVE 2026-08-15 | PRD §7.16 · §8.59, §8.60 |
| **Parent referral codes — double-sided package discount** (`REF-` join code, friend's-first + referrer's-later reward, FIFO, tenant %/$ + per-product override, same-household guard, admin Referrals page) — moves `amount_payable`, never `total_value` | pgTAP 57 + Deno + vitest + jest + `verify-referrals` 13, **LIVE 2026-08-15** | PRD §7.16 · §8.61 |
| Package purchases numbered + QR-payable (`PKG-YYYY-NNNN`) | pgTAP 12 + 2 drivers, LIVE 2026-08-09 | PRD §7.16 · §8.37 |
| Every child's name carries their payment method (per-child, category-aware) | pgTAP + vitest, LIVE | PRD §7.16 · §8.23 |
| Fee-free payment collection — `INV-YYYY-NNNN`, dynamic QR, tokenized page, WhatsApp queue | pgTAP + Deno ×2 + vitest + jest + driver, LIVE | PRD §7.21 · §8.26 |
| Make-up classes — the guest-pass model | pgTAP + Deno ×2 + vitest + jest + 14-check driver, LIVE | PRD §7.20 · §8.25 |
| Creating a business in-app | UI + backend, LIVE 2026-07-21 | PRD §4.4 · §8.9 |
| A child can exist before their parent | pgTAP + Deno + driver, LIVE | PRD §7.17 · §8.10 |
| A parent can claim the child their coach already added | pgTAP + vitest + driver, LIVE | PRD §7.18 · §8.12 |
| A booked trial is visible to everyone who needs it | driver, LIVE | PRD §7.17 · §8.11 |
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
| Automated tests — pgTAP + Deno backend, vitest + jest-expo apps, all in CI on push | CI | `docs/TESTING.md` §5 |

**Counts are deliberately not written here.** The runner is the fact; a number in prose is
a hint that has already drifted. `docs/TESTING.md` §5 says what each suite covers.

### DORMANT — shipped and verified, never exercised on real data

This is the half of "verified" that a PRD cannot tell you, so it is the part of §3 that
earns its place. **Shipped ≠ exercised**, and a guard that has never fired in production
is a guard whose first real firing is still ahead of you.

- **Packages** — no package has been sold on production, so the whole 2026-08-15 weeks/start-date
  layer is dormant too: **no start date, holiday extension, acknowledge or manual-extend has ever
  fired on real data.** First firing is the first sale. Its guards (the §7.156/§7.157 pins, the
  no-cascade recompute, the sealed-month safety) are all verified locally only. **Renewal offers
  (§8.60) are dormant on the same premise** — no offer created on prod, so supersede, the public
  `/package` page, and the RISK 1/2/4/12 guards (§7.158–§7.162) have never fired on real data;
  first firing is the first offer.
- **Billing a month LATE** — no production month has been billed late, so `markable_floor`'s
  reopened window has never been used. That is the point: it is insurance, shipped ahead of
  the trigger its own backlog item named.
- **Retired classes** — production had **zero** inactive classes on deploy day (audited,
  re-confirmed 2026-08-10), so no class has been retired on real data.
- **Guest bookings** — production holds **zero** live trial or make-up bookings, so §8.40's
  new block has never fired there. Which is exactly why it was safe to ship.
- **Substitutes and shadows** — production holds **zero** `session_coaches` and zero
  `class_shadow_coaches` rows, and **it cannot usefully hold any yet**: there is one coach,
  they are also the tenant admin, and every policy is `coach_branch OR can_admin_tenant(…)`,
  so no narrowing is observable on that account at all (§7.131). The Classes drawer's *Add a
  shadow* dropdown is therefore **correctly empty** — the class's own coach is excluded, and
  there is nobody else. **Don't rediscover that as a bug.** It becomes real the day a second
  coach is hired; `generate_coach_payouts` also skips a coach with no rate, so **no payout has
  ever been generated on production.** The whole model is verified locally against non-admin
  coaches in a browser (`verify-coach-roster`, 30 checks) — that is the only place it can be.
- **Credit-note emails (§8.64)** — production holds **0 credit notes**, so nothing has been
  emailed and the admin's Resend button has no row to act on. Dormant on BOTH halves, and the
  0-rows fact is also what made the migration's backfill a no-op. First firing is the first
  post-billing attendance edit that leaves `present`/`trial_paid`.
- **The orphan-lesson report** — production shows zero lines and the badge has never lit
  on real data (every July invoice is Paid; nothing has been recorded into July since it
  was billed). That is the expected state: its first real firing is a backdated
  enrolment, a backdated make-up/trial, or an absent→present edit after billing.
- **The Wave 5 controls — none has ever run on real data, and each is dormant for its
  own CORRECT reason** (§7.131's shape throughout — don't rediscover any as a bug):
  owner transfer's dropdown offers no target (one admin, the owner); coach disable is
  refused by its own sole-owner guard (the only coach IS the owner, replacement dropdown
  correctly empty); tenant suspension has suspended nothing and **should stay that way**
  — its correct production state is two dormant buttons on the Platform page. Real the
  day a co-admin or second coach exists. **The admin-delete refusal (§8.52) joins them for
  the same reason:** all three tenant admins are their own tenant's OWNER, and an owner was
  already undeletable — so the new refusal has never fired and cannot, until a business has a
  second admin. Its correct production state is "no observable change". **The Attendance
  money-axis column (§8.53) joins them too:** with one coach and no class handed over, the
  money axis equals the access axis, so the Coach column shows exactly the name it showed
  before. It diverges the day a class changes hands — don't rediscover "same as before" as a
  regression.
- **Multiple classes per child** — no production child holds two enrolments yet, so neither
  schedule guard has ever refused anything real and no admin has pressed *+ Add class*. The
  first real one is worth watching: it is also the first time `'mixed'` package coverage
  becomes reachable on real data (PRD §7.16), a code path that was unreachable-by-construction
  for its whole life until 2026-08-11.
- **Wave C (§8.66)** — four of the five are dormant for a data reason, not a bug: convert-a-trial and
  make-up-from-Attendance need data states the single private-coach account rarely produces; CSV export
  and parent upcoming-lessons do nothing until there is data. **Change History is the exception — LIVE,
  showing the real `audit_log` trail immediately.** Don't rediscover the four quiet ones as bugs.

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
> **Production was fully caught up as of 2026-08-17**, through `20260817000100`. **FIVE** edge functions
> exist: `generate-invoices`, `package-emails` and **`credit-note-emails`** (verify_jwt ON), plus
> **`public-invoice`** and **`public-package`** (both verify_jwt false, deliberately — the token is
> the access control). *(Version numbers used to be written here and went stale twice, and this
> COUNT went stale once — it read FOUR the day a fifth was deployed. `supabase functions list` and
> `supabase migration list --linked` are the honest answers; this sentence is a hint.)*

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

## 8.66 (2026-08-17, Wave C) — ALL FIVE WAVE C ITEMS SHIPPED LIVE, ONE APP-ONLY PUSH

**Wave C is now EMPTY.** Five features, **no migration and no edge function**, deployed by a single
push to `main` (`3a72947`, `85b880b`, `02c75e8`, `7a3ff8e`, `4891744` → `c4d78f5..4891744`):
- **CSV export** (Invoices/Credit Notes/Attendance) — `lib/csv.ts`, §7.179.
- **Convert a trial → enrolled** from the Trials past-needs-marking list — §7.180.
- **Upcoming lessons** on the parent Attendance screen — `lib/upcomingLessons.ts`, holidays subtracted.
- **Book a make-up from Attendance** — an absent/cancelled row seeds `book_makeup()`.
- **Change History** page (`/history`) — an `audit_log` viewer, diffs the `to_jsonb` snapshots.

Built `/plan-with-confidence` → `/plan-review` (**Fable agent**; all 6 risks verified in code, two
contradicting the draft) → per-item `/commit-review`. **Every risk mitigation proven red first**; the
durable ones graduated to **§7.179** (CSV export safety — injection + source-count truncation) and
**§7.180** (the convert guard queries *future* trials, so skipping it re-opens the blocked-month hole).
Verified admin vitest **427**, app jest **389**, both typechecks; the `/history` PostgREST embed
checked against the live DB per §7.176; the parent upcoming section **eyeballed live** (holiday
exclusion confirmed — the first apparent failure was an incomplete manual seed missing
`parent_tenants`, not the code).

**Deliberately not done:** off-schedule extra dates in the make-up-from-Attendance modal (the Makeups
page stays the full-featured home); `lesson_session`-level cancellations in upcoming lessons (holidays
were the free 90% — the join is a `BACKLOG.md` follow-up). Nav gained `/history`, so
`verify-platform-admin-scope.mjs`'s page-count pin was bumped **19→20 in the same push** (§7.178
applied). PRD §7.5/§7.17/§7.20/§14 · `docs/DEPLOYMENT.md` §11.26 · plan `docs/plans/WAVE_C_PLAN.md`.

## 8.65 (2026-08-17, second session) — BOTH CI AND THE NIGHTLY WERE RED, AND ONE HID A LIVE BUG

**Nothing was built. Two red pipelines were read, and one hid a production regression**
(`2c16be9`, `2c83573`). No migration, no function deploy — the app fix rides Vercel off `main`.

**CI: red on EVERY push for 20 commits** (2026-08-14 → 08-17), same two tests, and the Deno suite
never ran once in three days because pgTAP gates it. One fixture date in `coach_disable.test.sql`
called a lesson "FUTURE" and typed `'2026-08-15'`; product code correct throughout. Now derived
from `today_sg()` — §7.177 has the boundary trap that makes the obvious spelling wrong 1 day in 7.

**The nightly: 3 of 45 red for 3 nights, and the noisy one hid the real one.** A deliberate
page-count pin nobody bumped (§7.178) sat on top of **`PGRST201`**:
`20260815000600_default_packages` added FKs back to `package_products`, making two embeds
ambiguous, and PostgREST refuses the *whole* query — so since 2026-08-15 the parent's "Buy a
package" list and the admin's catalogue both rendered EMPTY, silently, because both sites did
`?? []` (§7.176). **Latent, not costly** — a signed-in check on 2026-08-17 showed prod holds **0
`package_products`**, so both lists were correctly empty anyway and no sale was lost; it also
confirmed the fix (HTTP 200, was 300). Fixing it exposed 3 more stale assertions, all from
start-date sequencing (⚠ RISK 2: a family that already topped up is deliberately not "low").
Third was `parent-claim` — c009945 renames a confirmed claim to the parent's own words.

**Coverage went UP.** `student_package_coverage.test.sql` **+2**: nothing anywhere asserted `low`
could be TRUE. Verified pgTAP **1097** on a clean reset, vitest 395, jest 384, both typechecks,
packages 21/21, parent-claim 21/21, 4 neighbour drivers green; every fix proven red first.

*(§8.64 — credit-note email notifications, SHIPPED LIVE, Wave B exhausted — moved to the ledger,
`docs/SESSIONS.md`, when §8.66 landed; along with §8.63 invoice-email retry, §8.62 the backlog
re-rank, §8.61 referral codes and §8.60 package renewal automation before it. Its four gotchas
§7.172–175 and deploy record §11.25 carry the reasoning.)*

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

### The nightly sweep — cleared 2026-08-17 after THREE red nights nobody read

**A sweep left red stops being an alarm.** A deliberate page-count pin nobody bumped (§7.178) sat
on top of a LIVE regression (§7.176) in the same rot issue, unread, while CI was also red on every
push. **Triage the day it reddens even when you are sure which check it is** — you are sure about
one driver; it reports several. §8.65.

### The nightly sweep — the Wave 5 first-sweep landed, and nothing new was added

The 2026-08-13 nightly (`ui-drivers.yml`) was the first to exercise all three Wave 5 chunks and
the modified `verify-admins` (24 checks, the `adminhistory@` persona). Suspect→commit map if a
Wave-5 area reddens later: `verify-admins`→`ee15814`; `platform-admin-scope`/Platform
page→`9c1279c`; Coaches page→`f5d91aa`. **The Attendance money-axis change (§8.53) added NO
registered driver** — its browser pass was a one-off (seeded, then torn down), so it is covered
by vitest + that manual 8/8 run and nothing new enters the nightly.

> **Re-read the run, not this paragraph.** `gh run list --workflow=ui-drivers.yml` and the
> rot issue's own state are the fact. This section once read *"✅ NO RED SIGNALS"* for a
> full day after the sweep had gone red beneath it.

**Hand-run caveats (which drivers are not re-runnable, which mutate shared seed state) are
collected in `docs/TESTING.md` §5** — graduated there 2026-08-12; don't restate them here.

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

### THE NEXT BUILD — Wave C SHIPPED LIVE 2026-08-17 (§8.66). **Both Wave B and Wave C are empty.**

All five Wave C items are live (app-only, `c4d78f5..4891744`). Their prod exposure is small and
each is dormant for its own reason: the make-up and convert actions need data states the single
private-coach account rarely produces; **Change History shows the real trail immediately** (the one
Wave C feature that is NOT dormant — verified live). CSV export and upcoming-lessons work the moment
there is data.

**Next is Wave D** (latent traps — the batch below), then *Later* (the owner-only accounting page
absorbs Revenue reporting; accrual chosen). Full ranking and the settled decisions (revenue
**ACCRUAL** · reminders **MANUAL** · multi-language **REFUSED**): `BACKLOG.md`.

> **Two items worth doing together as a small Wave D batch**, because they share one migration:
> the **duplicate credit note on a re-toggled correction** (no unique index on
> `credit_notes(invoice_item_id)` — a re-correction really does double the credit, proven by test
> 2026-08-17) and the **partial unique index** that would make "one credit-note email per invoice
> line" airtight rather than best-effort. Add `credit_notes(lesson_session_id)` in the same file.
> Also parked there: `tenants.suspend` is vestigial and should be dropped.
> *(**`coach_disable.test.sql`'s expired fixture date is DONE** — fixed 2026-08-17, §8.65/§7.177.
> It was red from 2026-08-15 SGT, not the 16th as the backlog had it, and it was blocking **every**
> push rather than being a standalone flake.)*

> **Cron-gated follow-ups stay parked** (reminders remain manual): reward-expiry nudge, unprompted
> low-balance email, automated reminders. Plus the **crash-safe email claim** item, which now covers
> `credit_notes.email_sent_at` as well as the invoice column — and is *sharper* for credit notes,
> since they have no automatic retry pass.

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

**The migration queue is EMPTY.** The latest applied is `20260817000100` (credit-note email
tracking, §8.64); production confirmed caught up 2026-08-17 via `supabase migration list --linked`,
**0 pending**. **§8.64 is the freshest worked example, and the first where the APPS had to wait on a
NEW edge function** — pushing `main` first would have shipped two callers of a function that did not
exist (prod count → migration → gate → function v1 → grant dump → apps last;
`docs/DEPLOYMENT.md` §11.25). The rule stands:
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
