# SwimSync — Session Handover

_Last updated: 2026-08-07 — **the attendance-marking floor now follows `billing_periods`
instead of the calendar — LIVE on production (§8.32).** `markable_floor(tenant)` is
`LEAST(1st of last month, the month after that business's latest sealed month, else its
`created_at`)`, replacing a calendar proxy that could make a month billed LATE
**permanently unbillable**: the gate named an unmarked lesson nobody could record any
more, with no override by design. `LEAST` is the safety argument — the floor can only move
EARLIER, so nothing markable before became unmarkable after, and all three production
tenants read `2026-07-01` unchanged on deploy day. `book_trial()` gained a floor it never
had. Two gotchas graduated from the ROLLBACK file, which was executed rather than merely
written: **§7.92** (Postgres takes regex greediness from the FIRST quantifier — a `.*?`
after a greedy `\s*` deleted three of `book_trial`'s four guards) and **§7.93** (execute
every rollback and diff `pg_get_functiondef()`). **Two things this session did not cause,
both in §9: the nightly UI drivers are RED (issue #2 OPEN — `class-edit` 4/5 and
`class-terms` crashed, since the 2026-08-06 sweep), and CI on `b5da2c5` is red purely
because GitHub Actions was in a MAJOR OUTAGE — re-run it, do not debug it.**_

_Previously, 2026-08-06 — **a business can have CO-ADMINS, and the owner manages them —
LIVE and verified on production (§8.31).** `tenants.owner_profile_id` marks the "main"
admin (ownership is data, not a new role — `docs/ARCHITECTURE.md` §6); the owner invites
co-admins (optionally also coaches) from a new **Admins** page, deactivates/reactivates
them (pure admins are also banned at the auth layer; a coach-admin keeps coaching), and
deletes — demotion for coach-admins, typed-DELETE hard delete for pure ones. Escalation
guards now pin `profiles.role`/`admin_disabled_at`/`tenants.owner_profile_id` against
client writes (`profiles_update` would otherwise have let any co-admin promote
themselves). Coach/parent accounts are refused at the admin panel's door — the one
deliberate exception to "never gate on role" (§7.91). The deploy surfaced §7.90: a second
FK between two tables breaks every bare PostgREST embed between them — caught by the
provisioning driver within the hour, both embeds hinted. **The standing headline is
unchanged: chase the outstanding invoices, keep marking August, bill it in early
September — §9.**_

_Previously, 2026-08-04 (second session) — **auditing whether `authenticated` deserved
the sweep `anon` got found three LIVE forgery paths instead, all closed and DEPLOYED
(§8.29)**: a self-registered stranger could join any business with no join code, attach
themselves to any child by UUID, and rename that child. The grant set became a declared
whitelist CI re-proves. Full account and pointers: the **§8.29** ledger row._


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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.93** |
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

The **entire MVP core loop works and is verified across the UI + backend**:
parent register → add child → superadmin assign → coach attendance →
invoice generation → credit-note corrections → PayNow QR payment display.

- **Auth & onboarding** — parent self-registration (auth trigger creates
  `profiles` + `parents`), add child, superadmin assignment.
- **Password reset (verified UI + backend)** — the "Forgot password?" link on the
  mobile login now drives a full recovery flow: `resetPasswordForEmail` → recovery
  email → in-app **Set New Password** screen → `updateUser`. Works on Expo web
  (`detectSessionInUrl`) and native (`swimsync://` deep link parsed in the root
  layout); a recovery session routes to the reset screen instead of the home tab.
  Login/register errors are mapped to friendly copy (`lib/authErrors.ts`).
- **Attendance** — coach marks/edits per session; audit-logged. A **"Set all ▾"** header
  menu bulk-sets every student to one status (Present/Absent/Cancelled-rain/coach) in one
  tap, with a confirm guard when some are already marked (§8e, PRD §7.6).
- **A billing month must have ENDED before it can be billed (verified local, live)** — the
  admin's picker defaults to and is capped at the last completed month, and the **engine
  refuses** anything later, with no `force` override. Without it a mid-month run looked
  *complete* to the attendance gate, billed the lessons so far and **sealed** the month,
  stranding the rest permanently (§7.32). **Confirmed on production 2026-07-19**: the picker
  reads June 2026 and refuses to offer July.
- **Invoice generation** — one `generate-invoices` engine, two modes: **automatic**
  (cron-style; respects the `app_settings.auto_invoice_enabled` switch and
  `invoice_run_day`, default the **7th**) and **manual on-demand** (admin button). **One
  invoice per parent covering every class their children are in** (§8a), and **unmarked
  attendance blocks generation entirely in both modes — there is no override** (§8a). A
  month that finishes is **sealed**, by either mode, so later runs no-op — but a month with
  **nothing recorded** is never sealed and reports `nothing_to_bill` instead (§8a.1; this
  one bit production).
- **Closing an enrolment (verified UI + DB)** — **"Remove from class"** and **"Set
  inactive"** on the admin Students page *and* the coach roster, via the
  `close_student_enrolment()` RPC. This is what unblocks billing when a child has stopped
  attending; their already-attended lessons still bill (§8a).
- **Credit-note flow (verified UI + backend)** — editing an invoiced attendance
  row billable→non-billable auto-issues a credit note and adds to the parent's
  pooled `credit_balance`; the next invoice draws it down FIFO. A partial-
  application ledger bug was found and fixed (see §6). Driven end to end through
  the coach edit screen → parent Billing → admin Credit Notes.
- **PayNow QR (verified UI + backend)** — the QR belongs to the **business, not the coach**
  (PRD §7.10): uploaded in `(coach)/settings` by a coach who is also their tenant's admin
  (→ `paynow-qr/<tenant_id>/paynow-qr` storage → **`tenants.paynow_qr_url`**); the parent
  sees the QR of the business that **issued the invoice** on the PayNow screen; the admin
  Coaches page shows it. A school with three coaches has one bank account — an individual
  coach's QR would send the payment to the wrong person.
- **The coach app shows NO invoices, and that is deliberate (verified UI, LIVE
  2026-08-03)** — the Billing tab became **My Pay**: the coach's own `coach_payouts` and
  nothing else. No invoice list, no Mark Paid, no outstanding count. Everything that makes
  an invoice actionable — reference, dynamic QR, WhatsApp queue, "parent says paid" badge,
  **Claimed** filter — is on the admin panel (PRD §7.9, §7.21), so a second poorer copy on
  the coach's phone could only prompt a decision they cannot act on well. **The tab is
  hidden entirely when the coach has no payouts**, so production's private coach sees
  **three** tabs (Today / Classes / Settings) — the finished state, not missing setup
  (PRD §7.13). Don't re-add a count here; the rejection is recorded in `BACKLOG.md` →
  *Deliberately not doing*. §8.27.
- **Unmarked-lesson safety net (verified UI + backend)** — expected lesson dates are
  derived from `classes.day_of_week` at read time (there is no session generator — §6):
  the coach's Today tab lists **Unmarked Lessons** and links straight to marking a past
  date, and the admin's invoice-generation dialog reports `N of M lessons marked` per
  class with the missing dates named. Closes the hole where a forgotten lesson was
  silently unbillable and invisible to everyone (§8i).
- **Parent Attendance states (verified UI)** — an unassigned child gets the
  "not assigned yet" state PRD §5.1 requires, distinct from "no lessons marked yet"
  (waiting on the coach) and an empty filter result (§8g).
- **Full RLS** — parents see only their data, coaches only their classes,
  superadmin everything. Covered by automated isolation tests.
- **Multi-tenancy (verified UI + backend, live)** — cross-tenant isolation proven by 24
  pgTAP assertions across two full tenants, plus UI drivers for join codes, the platform
  admin, tenant branding and wages. **Production has one tenant**, so isolation has never
  been exercised on real data.
- **Coach wages (verified UI + backend, live)** — effective-dated rates, the pay-decision
  table, draft→frozen payouts with next-period adjustments. A coach sees their own pay;
  rates are admin-only. **Payroll is correctly EMPTY for production**, which is a private
  coach: a coach is on payroll when they have a rate, and a private coach has none because
  their income is their parents' invoices (PRD §7.13). There is no private-vs-school branch
  in the code — *the distinction is data, not a rule* — so "no rate" is the finished state,
  not a missing setup step. Don't file it as one.
- **Active/inactive families and children (verified UI + backend, live)** — per business,
  with the date they left. Deactivating a child offers to take the siblings and states the
  family consequence; a departed family returns by re-entering the join code. New admin
  **Parents** page. `assignment_status` contracted to `unassigned | assigned` (PRD §7.14).
- **Effective-dated class terms (verified UI + backend, live)** — a lesson is priced, and its
  coach paid, from the terms in force on **its own date** (`class_rates`). Editing a class's
  price no longer reprices last month; a handover no longer moves the outgoing coach's pay.
  Admin class edits ask **correct-vs-change**. Closed three defects, two of them live (§8).
- **Child identity, levels and address (verified UI + backend, live)** — a child
  is identified by **name + date of birth** (age derived, never stored); each business
  defines its own **level ladder**, each rung carrying an ordered **skill list** (its
  curriculum); families have an **address**. A parent can now **edit a
  child**, which required closing two pre-existing defects first — see §8.
- **Prepaid lesson packages (verified local: pgTAP + Deno + UI driver — LIVE in
  production 2026-07-20, dormant until a product exists)** — a business sells N
  lessons at a locked rate, valid M months, scoped to
  its own class categories; a prepaid dollar balance per (parent, tenant) drawn down by
  the invoice engine at the package's rate, live-displayed via one RPC everywhere
  (parent card, admin tables, the students "running low" filter with a per-tenant
  threshold). Request → PayNow → admin confirm; corrections restore the package, never
  mint cash credit. Ad-hoc billing byte-identical (tripwire-tested). PRD §7.16,
  `PACKAGES_DESIGN.md`, §8.8.
- **Every child's name carries their payment method (verified local: pgTAP + vitest +
  jest + UI driver — LIVE 2026-08-01, reads "Ad-hoc" everywhere on prod until a package
  is sold)** — a **per-child, category-aware** chip ("Package · N left" / "Ad-hoc",
  explicit both ways, count family-shared) on ten admin surfaces and the parent app's
  home cards + child Balances card, from one SQL verdict `student_package_coverage()`.
  The old Students-page chip — summed by parent, category- and expiry-blind — is gone,
  and the "running low" filter follows the per-child rule. Family-grain surfaces
  (Parents, Claims) label the family instead. Coaches deliberately see nothing.
  The parent's **invoice detail marks each package-funded line** by the package's name
  (reversed draws read ad hoc — §8.24). PRD §7.16, §8.23.
- **Fee-free payment collection (verified local: pgTAP + Deno ×2 + vitest + jest + a
  19-check UI driver — LIVE 2026-08-02, dormant until July is billed)** — PRD §7.21,
  `docs/design/PAYMENT_COLLECTION_DESIGN.md`: SwimSync stays out of the money path
  (no gateway, no percentage). Every invoice gets `INV-YYYY-NNNN` (per-tenant counter,
  year from its own billing month) + a 128-bit public token via a BEFORE INSERT
  trigger (§7.78 — the engine is untouched); the admin enters a PayNow **UEN or
  mobile** once (Invoices page) and every outstanding invoice renders a locked-amount
  **dynamic QR** (`lib/paynow.ts`, pinned to an independent vector, throws on dubious
  input); the **tokenized public page** (`/invoice/<token>`, sessionless, edge
  function `public-invoice` — deliberately not an anon RPC) carries the QR +
  Save-QR-image; the admin's **WhatsApp button + click-through queue** opens
  pre-filled wa.me chats (the admin presses Send — stamps read **"chat opened"**,
  never "reminded"); the parent's **"I've paid"** claim (public page or in-app RPC)
  surfaces as a badge + **Claimed** filter; and **every** mark-paid goes through
  `confirm_invoice_paid()` (audit row included — the admin panel used to skip it).
  **The bank-app scan gate PASSED on 2026-08-02** — the user configured the production
  proxy, scanned a real invoice QR with a real bank app, and collected real payments
  against it. The feature is live and in real use, not dormant.
- **Make-up classes (verified local: pgTAP + Deno ×2 + vitest + jest + a 14-check UI
  driver — LIVE 2026-08-02, dormant until the first make-up is booked)** — the
  guest-pass model (PRD §7.20): the business's admin
  books an **enrolled** child into one lesson of **another same-category class** from the
  new admin Make-ups page; the booking (never an enrolment) makes the child expected at
  that one lesson, an unmarked one blocks the month like a trial, a package family's
  attended make-up **draws from the package** via the booking's snapshotted category, an
  ad-hoc guest pays their **home class's** effective-dated rate (snapshotted class id),
  and the invoice line reads "(make-up)". Private-category make-ups route to the existing
  Extra-lesson mechanism. The visibility widening also closed the latent trial-guest gap
  (host coach couldn't read a guest's name). §8.25.
- **Creating a business (verified UI + backend, live 2026-07-21)** — the platform admin
  provisions a tenant and invites its first admin from `/platform`: `provision_tenant()` is
  the **only** INSERT path into `tenants`, the invite link is minted with
  `generateLink({type:'invite'})` and mailed by us via Resend, and `/accept-invite` takes
  the new owner from email to signed-in. The overview shows each business's admin as
  `no admin` / `invited` / `active`. **Dormant in production** — nothing provisioned yet.
  PRD §4.4, `TENANT_PROVISIONING_PLAN.md`, §8.9.
- **A child before their parent (verified local: pgTAP + Deno + UI driver — LIVE in
  production 2026-07-25, dormant until the first trial is booked)** —
  the **business's admin** adds a child who is not yet in SwimSync, by either route:
  Trials → *Book a trial* (a booking for one lesson) or Students → *Add student* (an open
  enrolment). The admin then invites the parent, who **adopts the existing record**
  (nothing is transferred — same `student_id` throughout). A billable lesson with nobody to
  bill **holds the month open** instead of being silently dropped and sealed over, released
  by inviting the parent or recording a settlement. PRD §7.17,
  `TRIAL_ONBOARDING_PLAN.md`, §8.10.
  > **The COACH cannot do either, and this line used to say they could.** Slice 1
  > (§8.10) shipped an *"Add a walk-in"* form on the coach's attendance screen; §8.11
  > **removed it** when a trial became a booking arranged ahead of time. Confirmed by the
  > code (2026-07-26): `grep -rn "rpc(" SwimSyncApp/app/(coach)` returns **nothing** — the
  > coach app calls no RPCs at all. The coach's only write path is marking attendance.
  > `add_unclaimed_student()` still *accepts* a coach caller server-side (pgTAP pins it),
  > but no UI reaches it. A private coach arranges trials through their **tenant admin**
  > account, which they hold anyway (a private coach is a tenant of one — §6).
- **A parent can claim the child their coach already added (verified local: pgTAP + vitest +
  jest + UI driver — LIVE in production 2026-07-26, dormant until a parent adds a matching
  child)** — Add Child checks the roster
  before it creates anything: a matching child produces a masked candidate card and three
  answers (Confirm / Not Sure / No), both claim answers file a request for the **admin to
  decide**, and a pending request blocks that parent from re-adding that child. The admin
  gets a queue with a sidebar badge, a two-step confirm naming both parties, and — because
  nothing else in the product can unlink a parent from a child (§7.47) — an **undo**.
  Duplicates that already exist are detected on the Students page and folded together by
  `merge_students()`. Matching is **ranked email > phone > name+dob > name**, and the
  parent's contact number is **required** when a coach books a trial or adds a student —
  a name is written too many ways to be the primary signal. PRD §7.18,
  `PARENT_CLAIM_PLAN.md`, §8.12.
- **A booked trial is visible to everyone who needs it (verified local: UI driver — LIVE
  2026-07-26)** — the parent's card says *when* their trial is, the coach's roster lists
  trials coming up, and children with an **upcoming** trial are excluded from Unassigned
  Children, where Assign would have enrolled them permanently and blocked billing.
  PRD §7.17.
- **Who is in a class, at a glance (verified UI driver — LIVE 2026-07-26)** — the admin
  Classes page has a **See students** panel per class: enrolled children with level and
  joined date, and separately any child with a trial booked ahead. The Students column
  reads **`2+1`**, never `3` — a guest at one lesson is not a weekly student, and the
  admin acting on that confusion is what blocks a billing month (PRD §7.3, §7.17).
- **A parent's contact details can be corrected (verified local: vitest + UI driver — LIVE
  2026-07-26)** — every child on the admin Students page has a **Contact details** action,
  and what it offers depends on the child: **unclaimed** → the three
  `provisional_contact_*` columns are editable (and this is the *only* writer of
  `_name` anywhere — neither create form asks for it); **claimed** → read-only, showing
  **every** linked parent's own `profiles` row and saying the family maintains it in the
  app, because a second editable copy would be the stale duplicate `students.age` was
  removed for — and `is_tenant_admin(NULL)` refuses it anyway; **claim pending** → shown
  but **locked**, since `student_claims.match_reason` is a snapshot and editing under it
  makes the admin approve on a reason that stopped being true. `lib/sgPhone.ts` flags an
  implausible Singapore number (8 digits, leading 6/8/9/3, `+65` optional) on this screen
  **and both create forms** — always advisory, never blocking. No migration: `students_update`
  already grants the tenant admin. PRD §7.19, `CONTACT_DETAILS_PLAN.md`.
- **The attendance window is a database rule, and a mid-month joiner no longer blocks a
  month (verified local: pgTAP + Deno + a UI driver — **LIVE in production 2026-07-27**,
  dormant until the first real lesson is marked)** — attendance may only be recorded for a lesson on the class's own weekday
  between the business's marking floor and today, enforced by triggers rather than by the screen,
  so a phantom lesson can no longer be created *and billed* by reaching the screen with a
  hand-typed date. A genuine makeup lesson is scheduled by the business's admin instead
  (`schedule_extra_lesson()`), and the coach records it. Separately, "who was expected at
  this lesson" is now answered **per date** from enrolment spans — a child who joined on
  the 20th used to be expected on the 6th, which blocked the whole month from billing with
  no override. PRD §7.5/§7.6, `ATTENDANCE_WINDOW_PLAN.md`, §8.15.
  > **Dormant until a real lesson is marked.** Production has 0 attendance rows, so
  > neither the guard nor the joiner fix has been exercised on real data yet.
- **A month billed LATE can no longer be permanently unbillable (verified local: pgTAP 18 +
  vitest + jest + a 22-check UI driver, and against production data — LIVE 2026-08-07)** —
  the marking floor is `markable_floor(tenant)`, **per business**, and follows
  `billing_periods` rather than the calendar: the 1st of last month, or the month after
  that business's latest sealed month, or — if it has never billed — the day it joined.
  The calendar version let the engine name an unmarked lesson **nobody could record any
  more** whenever a month was billed late, with no override by design, and the database
  rule of 2026-07-27 had removed the manual escape. `LEAST` guarantees the floor only ever
  moves EARLIER, so nothing markable before this became unmarkable after it — **all three
  production tenants read `2026-07-01`, unchanged, on deploy day**. `book_trial()` gained
  the floor it never had. PRD §7.6, `docs/ARCHITECTURE.md` §6, §8.32.
  > **Dormant in the sense that matters:** no production month has been billed late yet, so
  > the reopened window has never actually been used. That is the point — it is insurance,
  > shipped ahead of the trigger its own backlog item named.
- **Every lesson list says whether it has been marked (verified UI driver — LIVE
  2026-07-26)** — Today's class cards, the Unmarked Lessons rows and the class roster each
  carry one of five states — **Upcoming** / **Not marked** / **N of M marked** / **Marked** /
  **No students** — plus a breakdown of what was recorded (*"2 students · 3 present ·
  1 cancelled (rain)"*), keeping *rain* and *coach* apart because they bill differently. A
  finished lesson's button becomes a quiet **Edit attendance**; **only that state quietens
  it**, so a lesson still needing marks never stops asking (§7.68 explains why the asymmetry
  is deliberate). *"No students" is not "Marked"* — the billing gate calls an empty roster
  complete and a card must not. PRD §7.6, `docs/plans/COACH_ATTENDANCE_STATUS_PLAN.md`.
- **The admin's tables sort, and its student counts mean ACTIVE (LIVE 2026-07-26)** — one
  comparison rule across all 22 tables (blanks last in both directions, numeric-aware,
  weekdays in week order, stable), Attendance gained class and date-range filters, and
  "Total Students" became **Active Students**. PRD §14.3/§14.4.
- **Every audit row knows which business it is about (verified local: pgTAP — LIVE
  2026-08-04)** — `audit_log.tenant_id` is stamped from the row's **entity** by a BEFORE
  INSERT trigger, so the seven writers that never set it are covered without being edited,
  and an unknown `entity_type` **raises** rather than writing a row invisible to everyone
  but the platform admin. Production's 81 unstamped rows (of 103) were backfilled. The
  INSERT policy, which had been `actor_id = auth.uid()` and nothing else — any signed-in
  user could fabricate any audit row — is now the one real client case: a coach, on a
  session they own. **Nothing in the product reads `audit_log` yet**; this exists so the
  first screen that does isn't authoritative-and-wrong. `docs/ARCHITECTURE.md` §6, §8.28.
- **`anon` holds EXECUTE on no callable function, and no longer gets one for free
  (verified by REMOTE dump + apply-time probes — LIVE 2026-08-04)** — 49 functions granted
  it before, 18 after, and all 18 are trigger/event-trigger functions that Postgres never
  privilege-checks and PostgREST does not expose. This closed a **live** hole:
  `next_credit_note_ref` sat on the bare `PUBLIC` default and let an unauthenticated caller
  increment a business's credit-note counter (§7.82). `20260804000400` then turned off the
  mechanism that kept regranting: default privileges no longer hand `anon` **or `PUBLIC`** a
  new function, table or sequence, and the migration carries probes that RAISE at apply time
  if that ever stops holding. **The statement everyone reaches for first
  (`… IN SCHEMA public REVOKE … FROM PUBLIC`) succeeds and does nothing** — the built-in
  PUBLIC grant is global, so the revoke must be too (§7.85). Consequence for new work: a
  function is callable by **nobody** until its own migration grants it, which fails loudly
  in development instead of silently in production.
- **A signed-in stranger can no longer forge their way into a business or onto a child
  (verified local: pgTAP ×3 files + a real anon-key session, REMOTE dump — LIVE
  2026-08-04)** — signup is open, so `authenticated` means anyone with an email address.
  Until this shipped they could **join any business with no join code** (then read its
  `join_code`, plus `paynow_uen`/`mobile` and the coach's contact details), **attach
  themselves to any child by UUID**, and rename or deactivate that child — bypassing the
  admin-approval claim flow entirely. Both policies checked *whose* row it was and never
  *what it pointed at*; both are dropped, and joining or adding a child now goes only
  through the SECURITY DEFINER RPCs that always did the real work (§7.86). Student UUIDs
  are **not enumerable**, so the second needed a UUID from outside — verified, not assumed.
- **`authenticated`'s table grants are a DECLARED WHITELIST, re-proven by CI every run
  (LIVE 2026-08-04)** — it holds a privilege **only** where a policy could permit it. It did
  **not** get `anon`'s sweep and should not: parent, coach and admin are one database role,
  so only RLS can separate them. But 50 of 148 grants had no policy behind them, and
  TRUNCATE/REFERENCES/TRIGGER on all 37 tables were surplus **RLS cannot see**. Production
  went from `GRANT ALL` on every table to the exact whitelist. **Consequence for new work,
  and it is the point:** a new table is reachable by nobody until granted, a migration that
  adds a policy must add the matching `GRANT`, and a blanket re-grant turns
  `table_grants.test.sql` red rather than quietly restoring the old state (§7.87, §7.88).
  `service_role` is deliberately untouched — grants really are its only gate, but the
  oracle used here does not transfer to a role that bypasses RLS (`BACKLOG.md`).
- **Co-admins, managed by the business's OWNER (verified local: pgTAP 38 + vitest + a
  21-check UI driver, and on production data — LIVE 2026-08-06)** — the first admin of a
  tenant is its **owner** (`tenants.owner_profile_id`, backfilled; all three production
  tenants verified), and only the owner manages admin accounts from the new **Admins**
  page: invite (optionally *also a coach*), resend, deactivate/reactivate, delete.
  Co-admins hold identical authority otherwise; the owner can never be a target.
  Deactivation suspends admin authority through one clause in `is_tenant_admin()` and
  additionally **bans** a pure admin's login; a coach-admin is never banned — coaching
  survives, and their "delete" is demotion to coach. A pure admin's hard delete purges
  their audit rows (typed-DELETE confirm says so) and is refused if they have recorded
  work. Coach/parent logins are refused at the panel door with "use the SwimSync app"
  (§7.91). Escalation guards pin the privilege columns client-side writes used to reach
  (PRD §4.3, `docs/ARCHITECTURE.md` §6, §8.31).
- **Automated tests** — pgTAP + Deno on the backend, vitest + jest-expo on the two apps, all
  in CI on push to `main`. **Counts are deliberately not written here**: the two frontend
  numbers that used to be (162 and 109) had drifted to 198 and 174 by 2026-08-01 while
  reading as current. `docs/TESTING.md` §5 says what each suite covers; **the runner is the
  fact**.
  Since 2026-08-01 CI also **loads every UI fixture** and asserts each one round-trips and
  writes only its own rows (`check-fixture-roundtrip.sh`); it found three broken fixtures on
  its first run (§8.20). **And since 2026-08-05 every driver RUNS nightly in CI** (§8.30):
  `run-all-drivers.sh` under `ui-drivers.yml`, failures collected in one rolling
  `ui-driver-rot` issue that a green run closes. Protocol and triage rule:
  `docs/TESTING.md` §5. **⚠ That issue is OPEN as of 2026-08-07 — the sweep is RED, two
  drivers, neither related to the most recent work. §9 has the triage.**

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
> **And as of 2026-07-26, "no attendance recorded" is ALSO out of date** — see the entry
> below. The rule survives the change: the count is the fact, the sentence is a hint.

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`). The full loop is verified end to end on cloud
(incl. a live password-reset round-trip on `swimsync.sg`). A **real coach + 4 real
classes** are onboarded, alongside **7 real families and 9 real children** who
self-registered.

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
See §11.

> **`main` = what's live for the WEB APPS ONLY.** Vercel builds both sites from `main`, so a
> push deploys them — but a push deploys **neither the Edge Function** (`supabase functions
> deploy`) **nor migrations** (`supabase db push`). Both are separate, manual steps.
> **This bit us:** migration `20260712000100_coach_read_parent_profile` sat merged-but-
> undeployed for **six days** — the coach Billing screen could not show parent names in
> production that whole time, and nothing surfaced it. Applied 2026-07-18 alongside §8a's
> three. **After any backend change, run `supabase migration list` and check nothing has an
> empty `remote` column.** `git log origin/main` is the honest answer to
> "what's in production"; don't trust a SHA written into prose here, including this one.
> **Production was fully caught up as of 2026-08-06** — every migration through
> `20260806000100` applied. THREE edge functions exist: `generate-invoices`,
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
>
**Not done yet** (see §9): native **App Store / Play Store** builds remain deferred (web
app on iPhone for now). *Parent onboarding is no longer a gate — it happened, and July
was billed on the back of it. Onboarding a new family is now routine: they enter the join
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

**The two most recent sessions are here in full. Everything older is a ledger line.**

That is not a filing convention, it is the rule the log is written under: **a session entry
may not be written until every durable thing in it has a home elsewhere** — a gotcha in
§7, an accepted consequence in its plan's §10, an unbuilt follow-up in `BACKLOG.md`, a
behaviour change in `PRD.md`. Once that is true the narrative is a third copy, and the
ledger line plus its pointers is the whole of what is left. `/update-docs` enforces this.

**Do not delete a ledger line.** They are cited by number from source files and applied
migrations (`core.ts` and `20260727000100_…sql` both say `§8a`), so a missing line is a
dangling reference. They cost ~25 tokens each; if the table ever passes ~100 rows, move the
table to `docs/SESSIONS.md` and point at it from here — still one hop.

## 8.32 (2026-08-07) — THE MARKING FLOOR FOLLOWS `billing_periods`, NOT THE CALENDAR — LIVE, AND A NO-OP ON PRODUCTION THE DAY IT SHIPPED

**Built as insurance, ahead of its own stated trigger.** The backlog item said "revisit the
first time a month is billed late"; the user chose to build it one month into a live
monthly billing rhythm instead. What it removes has no remedy: the engine bills **any**
completed month while the floor reached back one, so billing August on 5 October with a
single unmarked lesson made the gate name a lesson **nobody could record any more** — not
the coach, not the admin, no override by design — and the month could then never be billed.
`20260727000100` had turned the window from a UI convention into a database rule, which is
what removed the escape hatch. Its own plan §10.1 predicted this exactly.

**The rule, and the one line that carries the safety argument:**
`LEAST(1st of last month, month after the latest seal, else `created_at`)`. `LEAST` means
the floor can only move **EARLIER**, so no date markable before the change is unmarkable
after it — asserted as a **property over a matrix of tenant states**, not case by case, so
a `GREATEST` typo fails even when all seven named examples pass. Deploy day bore it out:
all three production tenants read `2026-07-01`, unchanged.

**The filed fix was wrong in one detail, and the reason is worth carrying:** "the earliest
UNSEALED billing month" leaves *no floor at all*, because a month with nothing recorded is
never sealed (§8a.1) so gaps reach back past the business's first day. Anchored on the
**latest** seal instead. Reasoning in `docs/ARCHITECTURE.md` §6 so it is not re-derived
wrongly.

**Found by EXECUTING the rollback file rather than writing it** — two bugs, neither
readable: **§7.92**, a `regexp_replace` whose greediness Postgres takes from the *first*
quantifier, which produced valid SQL restoring `book_trial()` with three of its four
guards silently deleted; and a hand-typed Unicode literal that never matched (it failed
loudly, which is why it did not ship). **§7.93** is the general lesson: committed ≠
verified, and the check that catches everything is a byte-identical `pg_get_functiondef()`
diff plus a re-run of the pre-migration test file under the rolled-back schema.

**Deliberately not done:** no `force`, no admin "reopen this month" button — this widens
what can be *recorded* and adds no bypass to the attendance block or the completed-month
guard, both refused an override on the record. `20260727000100`'s header still describes
the old floor: **an applied migration is never edited**, so the correction lives in the new
migration and in the `session_window_start()` `COMMENT`, which is what a catalog dump shows.

**Verified:** pgTAP **554** in 32 files (new file 18, proven red two ways — 18/18 with no
migration, 12/18 against an inverted `GREATEST`), Deno 130 ×2, jest-expo 256, vitest 255,
both typechecks, fixture round-trip 16/16, `verify-attendance-guard` **22/22** (was 20/20;
both new checks proven red by stubbing the fetch to null — they fail, the other 20 pass,
which demonstrates the degradation guarantee in the real UI). Production: migration applied,
all three floors unchanged, 0 trial bookings below the new floor, remote grant grid 9/9
matching local, and the live `swimsync.sg` bundle greps for `markable_window_start` (§7.31).

---

## 8.31 (2026-08-06) — CO-ADMINS: THE OWNER MANAGES A BUSINESS'S ADMIN ACCOUNTS, LIVE AND VERIFIED ON PRODUCTION

**A business is no longer one login.** The user's ask: the main tenant admin creates and
manages additional admin accounts with identical authority (feature-splitting later), on
the hierarchy platform admin → tenant superadmin → tenant admin → coaches/parents.
Shipped as `20260806000100` + the Admins page, both deployed the same day, the migration
verified against production data (all three tenants' `owner_profile_id` correct) before
the apps went out — the §7.60 order, done right.

**The design calls that will matter later** (full reasoning `docs/ARCHITECTURE.md` §6):
ownership is a **column**, not a role — `tenant_superadmin` as an enum value was
considered and rejected (permanent, string-audited in ~25 files, can't enforce
one-owner-per-tenant), as was the BACKLOG `tenant_members` join table (buys nothing while
all admins are equal; still available additively). Deactivation is one clause in
`is_tenant_admin()`; coach access survives because it rides the `coaches` row. Guard
triggers (invoker, NOT definer — §7.38) closed a hole that predates the feature:
`profiles_update` let ANY tenant admin rewrite any tenant profile's **role**, harmless
with one admin and an escalation path with two — the pgTAP mutation run proved it, the
self-promotion landing and corrupting 13 downstream assertions.

**Found and fixed on the way:** §7.90 — the new FK made every bare `profiles`↔`tenants`
PostgREST embed ambiguous; `verify-tenant-provisioning` went red within the hour
(accept-invite lost the business name) and both affected embeds now carry `!tenant_id`
hints. The admin login page already refused non-admin roles, so the user-requested coach
gate became better copy ("use the SwimSync app") plus a defense-in-depth screen in
`RequiresTenant` — the one deliberate exception to "never gate on role" (§7.91).

**Deliberately not done:** owner transfer (guard-refused; BACKLOG), per-admin permission
splits (BACKLOG, with the seam named), widening deactivation to cut
`current_tenant_id()`-keyed membership reads (the coach app needs them; the auth ban
bounds the residue at one token lifetime — pinned as chosen in pgTAP).

**Verified:** pgTAP **536** in 31 files (was 498/30; the new 38 proven red three ways),
vitest 250 (was 237), typecheck clean, drivers `verify-admins` 21/21 (new — bans are
auth-layer, only a driver can see them), scope 32/32 (sidebar pinned at 16),
tenant-admin 10/10, platform-admin 6/6, tenant-provisioning 15/15, fixture round-trip
16/16. Production: remote dump post-deploy — RPCs grant only `authenticated`, anon still
exactly its 18 trigger functions, zero blanket grants; committed rollback file. The
deploy was confirmed by the user driving the live Admins page, not by a 200 (§7.31).

---

### Older sessions — the ledger

| # | Date | What shipped | Where its reasoning lives now |
|---|---|---|---|
| **8.30** | 2026-08-05 | All 32 UI drivers run **nightly** (`ui-drivers.yml` → `run-all-drivers.sh`, one rolling `ui-driver-rot` issue: open = red right now). The first sweep scored 24/32 and **every red was the tests' or the harness's fault, none a product bug** — the item's whole thesis. Four cloud runs to green, each failing differently | `docs/TESTING.md` §5 *(protocol + §7.73 triage)* · run-ui-playwright `SKILL.md` *(the `superadmin@` seed-login trap)* · `run-all-drivers.sh` header *(fixture-map exception)* |
| **8.29** | 2026-08-04 (2nd) | The `authenticated` audit found **three LIVE forgery paths** instead of the one it went looking for — a self-registered stranger could join any business with no join code (then read it), attach to any child by UUID, and rename/deactivate that child; both policies checked *whose* row, never *what it pointed at*. All closed (`000500`–`000800`), the grant set became a **declared whitelist CI re-proves**, and the answer to the original question was NO — one database role carries parent/coach/admin, only RLS has the resolution. Two migrations exist only because production was **dumped after deploying** (§7.89). Separately `verify-parent-claim.mjs` had been red since 58 minutes after it was written, product correct throughout — the evidence that became §8.30's nightly sweep | **§7.86–§7.89** · §7.47 · `docs/TESTING.md` §5 · `docs/DEPLOYMENT.md` §11.7–11.8 · BACKLOG *(service_role audit)* |
| **8.28** | 2026-08-04 | The three queued migrations shipped and DEPLOYED the same day (`20260804000100/200/300` + follow-up `000400`), and the headline was the one nobody filed: `next_credit_note_ref` had **no ACL at all** — an unauthenticated POST incremented a business's credit-note counter (§7.82); production went 49 → 18 functions granting `anon` EXECUTE, then `000400` turned off default-privilege grants to `anon`/`PUBLIC` entirely (the obvious per-schema revoke does nothing — §7.85). *Narrow `coaches_without_rate`* turned out filed **backwards** (§7.83 — the three oracles); `audit_log.tenant_id` stamped from its entity by trigger, fabrication-friendly INSERT policy narrowed, 81 rows backfilled after checking the dump. §7.84 (edge runtime stopped after `supabase start`) cost a diagnostic round | **§7.82–§7.85** · `docs/ARCHITECTURE.md` §6 · `docs/DEPLOYMENT.md` §11.7 · BACKLOG *(service_role audit)* |
| **8.27** | 2026-08-03 | **The mobile app caught up with the billing that shipped without it** — four complaints from a day of real use, all correct: the coach's Classes tab lands on the class list (the other half of §7.65), the Billing tab became **My Pay** and hides entirely when there are no payouts, the parent app prints `INV-2026-0001` instead of a UUID fragment, and Today's card counts **guests apart from students**. On the test side, a driver with **zero assertions** deleted, a worse variant found printing "18/18 passed" while four checks crashed — and then the detector written to find them was itself **wrong**, having libelled a driver that asserts perfectly well | PRD §7.9, §14.2/§14.4 · **§7.79, §7.80, §7.81** · `BACKLOG.md` *(Deliberately not doing: any invoice count in the coach app)* |
| **8.26** | 2026-08-02 | **Fee-free payment collection, Phases 0–3** — `INV-YYYY-NNNN` + a 128-bit public token by BEFORE INSERT trigger (the engine untouched), a client-computed **dynamic PayNow QR** with amount and reference locked, the **tokenized sessionless invoice page** served by the `public-invoice` edge function (deliberately not an anon RPC), the admin's **WhatsApp click-through queue** ("chat opened", never "reminded"), the parent's "I've paid" claim, and every mark-paid converged on `confirm_invoice_paid()`. Post-ship the same day, a question about the reference format exposed that **Postgres `LPAD` truncates** past the pad width — a silent reference collision within ~13 months for a large tenant, latent in `next_credit_note_ref` since July; both fixed. **Then the standing mission of this file completed: July billed for real and the first real money collected** | PRD §7.21 · `docs/design/PAYMENT_COLLECTION_DESIGN.md` · `docs/ARCHITECTURE.md` §6 *(anon-RPC refusal)* · **§7.77, §7.78** · `INVOICE_RUNBOOK.md` |
| **8.25** | 2026-08-02 | Make-up classes as the **guest-pass model** — an enrolled child booked into one lesson of another same-category class; a booking is never an enrolment, an unmarked make-up blocks the month like a trial, a package family's attended make-up draws from the package via the booking's snapshotted category, an ad-hoc guest pays their **home** class's effective-dated rate. Five migrations, the engine, all three UIs. Also closed the latent trial-guest visibility gap (a host coach could not read a guest's name) | PRD §7.20 · `docs/TESTING.md` §5 · `docs/ARCHITECTURE.md` §10 · `supabase/rollback/20260802_makeup_bookings_DOWN.sql` |
| **8.24** | 2026-08-02 | The parent invoice detail marks package-funded lines ("Paid by package · *name*"; a reversed draw reads ad hoc). App-only, no migration. The admin Invoices page renders no line items, so the parent detail is the only "which lines" surface — an admin invoice detail would be a new feature | PRD §7.16 · `docs/TESTING.md` §5 (`invoiceFunding`) |
| **8.23** | 2026-08-01 | The per-child, category-aware payment-method chip ("Package · N left" / "Ad-hoc") on ten admin surfaces + the parent app via `student_package_coverage()`, fixing the Students-page chip that summed by parent and counted date-expired packages; 'mixed' proven structurally unreachable and pgTAP-pinned; coaches deliberately see nothing | PRD §7.16 · `docs/TESTING.md` §5 · `docs/ARCHITECTURE.md` §10 |
| **8.22** | 2026-08-01 | A latent unordered `LIMIT 1` in `fixtures-trial-onboarding.sql` broke CI (§7.73 biting its author — fixture now owns its class, no `roundtrip-exempt` left); `verify-trial-onboarding.mjs` had aborted on check 1 since two hours after it was written (0 → 10 checks); and a user's coach-rate question found the platform "unpaid" badge had **never rendered** (`as`-cast field mismatch) plus the private-vs-school dropdown answering an unanswerable question — replaced with staff-without-rate. **`tenants.kind` still exists, nothing reads it, do not start**; the RPC-narrowing migration queues behind the two hygiene migrations (§7.55) | **§7.73, §7.76** · `docs/TESTING.md` §5 · PRD §4.4 |
| **8.21** | 2026-08-01 | The "possibly real product bugs" in `verify-attendance-window.mjs` were **clock rot, product correct in all three cases** — its three unique behaviours folded into `verify-attendance-guard.mjs` (20/20), driver + fixture deleted; found the guard driver's own unnamed-entity bug on the way | **§7.74, §7.75** · `docs/TESTING.md` §5 · `docs/plans/ATTENDANCE_WINDOW_DRIVER_FOLD_PLAN.md` |
| **8.20** | 2026-08-01 | **CI loads every UI fixture now** (`check-fixture-roundtrip.sh`, two passes: isolated round-trip, then stacked footprint comparison) — and it found three broken fixtures the first time it ran | `docs/TESTING.md` §5 · **§7.73** |
| **8.19** | 2026-07-26 | **A coach marked a real lesson on production for the first time** — four bugs on the marking path to get there. Every lesson list gained a marking status; the admin's tables became sortable and its student counts mean *active* | **§7.64–§7.68** · `docs/plans/COACH_ATTENDANCE_STATUS_PLAN.md` · PRD §7.6, §14.3/§14.4 |
| **8.18** | 2026-07-26 | Parallel work got a protocol (`docs/WORKTREES.md`), nine missing fixture teardowns written + a CI guard, and two skills (`/worktree-start`, `/worktree-close`). The round-trip harness it invented found §7.62 and §7.63; **§8.20 automated it** | `docs/WORKTREES.md` · `docs/TESTING.md` §5 · **§7.62, §7.63** |
| **8.17** | 2026-07-26 | The documents became an index: `HANDOVER.md` 3,972 lines → ~460, and the four `/session-start` documents ~131k → ~12k tokens. Four orphaned facts promoted first, and FIFO capping of the ledger was rejected — entries are cited from applied migrations | `docs/GOTCHAS.md` **§7.56, §7.61** · `docs/DEPLOYMENT.md` **§11.5, §11.6** |
| **8.16** | 2026-07-26 | Repo root 22 markdown files → 8 (`docs/design`, `docs/plans`, `docs/database`); the auth redirect allow-list found **broken in production** — admin password reset had been landing on the wrong page | `README.md` → *Where everything lives* · **§7.41** |
| **8.15** | 2026-07-26 | The attendance marking window became a **database rule**; a child who joins mid-month no longer blocks that month from billing. Engine **v16 → v17** | `docs/plans/ATTENDANCE_WINDOW_PLAN.md` · PRD §7.5, §7.6 · §7.57–§7.60 |
| **8.14** | 2026-07-26 | A parent's contact details can be fixed — deployed | `docs/plans/CONTACT_DETAILS_PLAN.md` · PRD §7.19 |
| **8.13** | 2026-07-26 | Two admin UI changes; the skill workflow reworked (`/session-close` → `/update-docs`) | `01_SESSION_WORKFLOW.md` · §7.54 |
| **8.12** | 2026-07-26 | Parents can claim their own child — deployed | `docs/plans/PARENT_CLAIM_PLAN.md` · PRD §7.18 · §7.48 |
| **8.11** | 2026-07-25 | Class categories are mandatory; a trial is a booking — deployed | `docs/plans/TRIAL_BOOKINGS_PLAN.md` · PRD §7.17 |
| **8.10** | 2026-07-25 | A child can exist before their parent — deployed | `docs/plans/TRIAL_ONBOARDING_PLAN.md` · PRD §7.17 · §7.42, §7.43 |
| **8.9** | 2026-07-21 | A business can be created in-app — deployed | `docs/plans/TENANT_PROVISIONING_PLAN.md` · PRD §4.4 |
| **8.8** | 2026-07-20 | Prepaid lesson packages — deployed | `docs/design/PACKAGES_DESIGN.md` · PRD §7.16 |
| **8.7** | 2026-07-19 | The platform admin gets their own panel — deployed | PRD §4.4 · BACKLOG *(tenants.kind, impersonation)* |
| **8.6** | 2026-07-19 | A billing month must have ENDED before it can be billed — deployed | PRD §7.7 · §7.32 · BACKLOG *(no override)* |
| **8** *(5th)* | 2026-07-19 | Child identity (name + DOB), coach-defined levels, family address — deployed, with an incident | PRD §5.1, §7.15 · §7.31 |
| **8.4** | 2026-07-19 | Active / inactive for families and children, all six phases — live | PRD §7.14 · **§7.61** |
| **8.3** | 2026-07-19 | A lesson is priced and paid by **its own date** (effective dating) | PRD §7.3, §7.13 · BACKLOG *(substitute coaches)* |
| **8.2** | 2026-07-19 | The SwimSync logo | `brand/README.md` · BACKLOG *(collisions; the mark is not on the invoice)* |
| **8.1** | 2026-07-19 | Multi-tenancy, phases 0–5 — live | `docs/design/TENANCY_DESIGN.md` · `docs/plans/TENANCY_PLAN.md` · PRD §4.3 |
| **8a** | 2026-07-18 | The underbilling cluster: multi-class fix, run day, sealing, hard block (+ §8a.1, the empty-month seal) | PRD §7.7 · `INVOICE_RUNBOOK.md` · BACKLOG |
| **8b** | 2026-07-17 | UTC-derived default billing month fixed (the `APP_TIMEZONE` seam) | §7.12 · BACKLOG *(per-tenant timezone)* |
| **8c** | 2026-07-17 | Attendance marking window (UI only) + truthful parent empty states | **superseded by §8.15** · PRD §7.5, §7.6 |
| **8d** | 2026-07-16 | Invoice email notifications via Resend | PRD §7.7 · BACKLOG *(credit-note emails, delivery tracking)* |
| **8e** | 2026-07-16 | Typecheck baseline + CI guard | §7.11 · BACKLOG *(generate real `Database` types)* |
| **8f** | 2026-07-16 | Bulk "Set all" attendance, admin class management, backlog ranking | PRD §7.6 · BACKLOG → *Build order* |
| **8g** | 2026-07-16 | Six future features recorded in BACKLOG; no code | BACKLOG · §7.56 |
| **8h** | 2026-07-16 | Parent Attendance screen fixed; the branch's first production deploy | PRD §5.1 · §7.9 · §7.56 |
| **8i** | 2026-07-16 | The docs split into three (PRD / BACKLOG / HANDOVER) | `README.md` · `01_SESSION_WORKFLOW.md` |
| **8j** | 2026-07-15 | Closed the silent-underbilling hole; fixed the SGT/UTC double-billing bug | §7.7 · PRD §7.5 |
| **8k** | 2026-07-13 → 14 | Custom domains, production email, clean-slate prod DB, first real coach onboarded | `docs/DEPLOYMENT.md` §11 |
| **8l** | 2026-07-12 | Password reset end to end + auth error mapping | PRD §7.1 |
| **8m** | 2026-07-11 | Credit-note ledger fix (`credit_applications`), PayNow QR, the first test suites | PRD §5.6, §9.17 |

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
2. **Keep August marked as it happens** (the coach's Unmarked Lessons list is the
   tracker), then **bill August in early September** — same runbook, now routine. The
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

### If you would rather build than onboard

**`BACKLOG.md` → `## Build order` is EMPTY** and has been since 2026-07-19. Pick from the
themed sections below it. Nearest candidates with no dependencies: **credit-note emails**
(the other half of the notification work), an **upcoming-lessons view for parents** (small,
and the building block already exists), or **convert a trial into an enrolled student**.

**A cheap, ordered pair added 2026-08-03** — *give package requests a reference number* (S)
then *demote the static PayNow QR upload* (S). The user is right that the uploaded QR should
be unnecessary now, but it still serves **package payments**, which have no reference to lock
into a computed QR. **Do them in that order**; the reverse breaks paying for a package. The
same session's copy fix (the PayNow screen calls the business "Coach") folds into whichever
ships first.

**The `authenticated` question from 2026-08-04 is ANSWERED — don't re-open it.** No, it does
not deserve `anon`'s sweep (§8.29, §3): one database role carries parent, coach and admin, so
only RLS can separate them. The part that *was* free is done — the grants are a declared
whitelist and CI re-proves it. **What replaced it as an open question is `service_role`**,
now a `BACKLOG.md` item: grants genuinely are its only gate, but the oracle used for
`authenticated` ("no policy could permit this") is useless for a role that bypasses RLS, so
it needs a usage audit of the edge functions and the admin's server routes. Don't start it
without that.

### ⚠ TWO RED SIGNALS TO CLEAR FIRST — neither caused by §8.32, both cheap to triage

**1. The nightly UI drivers are RED and issue #2 is OPEN.** An open `ui-driver-rot` issue
means red *right now* — that is the protocol, and §3 said the pipeline was green because
it was written the day the first sweep went green and never revisited. The 2026-08-06 sweep
scored **30/32**: `class-edit` **4/5** and `class-terms` **crashed outright (no score)**.
Everything else passed, including `attendance-guard` at 20/20 — so this predates §8.32 and
is untouched by it. Apply the §7.73 triage rule: product changed → real regression, fix the
product; the driver's or calendar's assumption moved → fix the driver. Both are class-editing
drivers, and class **terms** are effective-dated (§8.3), which makes a calendar assumption
the first thing to check. `gh issue view 2` has the full table and a logs link.

**2. CI on `b5da2c5` is red, and it is NOT the code — do not debug it.** GitHub Actions
was in a **major outage** (incident opened 2026-08-06T15:22Z, `Actions -> major_outage`),
and all three attempts died in *"Set up job"* at `Getting action download info` with
`Service Unavailable`, before checkout. `backend-tests` **passed**; the other two jobs were
cancelled by fail-fast rather than failing. Everything was verified locally before the push
(pgTAP 554, Deno 130 ×2, jest 256, vitest 255, both typechecks, driver 22/22) and the
migration was verified directly against production. **Just re-run it** once
`githubstatus.com` shows Actions operational: `gh run rerun 31118381157 --failed`.

***Run the UI drivers in CI* SHIPPED 2026-08-05 (§8.30) — it is now an operating rhythm,
not a to-do.** The nightly sweep (04:00 SGT, `ui-drivers.yml`) maintains one rolling
`ui-driver-rot` issue: an open issue means red *right now*; green closes it. Triage rule
when it reddens: the product changed → a real regression, fix the product; the
driver's/calendar's assumption moved (§7.73) → fix the driver. **A UI redesign is
planned** — expect regular reds through it, and treat "its drivers are green again" as
part of each redesigned screen being done. The pipeline is proven end to end: run 4 went
green and closed the rolling issue itself; `gh run list --workflow=ui-drivers.yml` and
the rolling issue are always the current fact.

**The migration queue is EMPTY.** The latest, `20260806000200` (the marking floor, §8.32),
shipped and deployed 2026-08-07 with its grant grid checked against production the same
hour (9/9 matching local). Nothing is in flight, so the next schema change can start
immediately — still one at a time (§7.55), and a worktree never authors one
(`docs/WORKTREES.md`). Keep budgeting the post-deploy grant check; it is the only honest
one (§7.39, §7.89, `docs/DEPLOYMENT.md` §11.7). **And budget the rollback REHEARSAL too —
§7.93, new this session: writing the DOWN file is half the job, running it is the half that
finds the bugs.**

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
