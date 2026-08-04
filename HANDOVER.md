# SwimSync — Session Handover

_Last updated: 2026-08-04 — **the three queued migrations all shipped and DEPLOYED
(§8.28), and the queue is now empty**. Two of the three were mis-filed, which is the
useful part. *Revoke `anon` EXECUTE* was filed as "defence in depth, not a live hole" and
was one: `next_credit_note_ref` had **no ACL at all**, so an unauthenticated POST could
increment a business's credit-note counter (§7.82) — production went from **49 functions
granted to `anon` to 18**, all of them trigger functions. *Narrow `coaches_without_rate`*
had already been done in SQL since 2026-07-19; the 2026-08-01 session read the field
mapping **backwards** and replaced a working column with a 2000-row browser scan, writing
the false claim into four places (§7.83 — three oracles that settle it in seconds). The
third, `audit_log.tenant_id`, is now stamped from each row's **entity** by a trigger, with
the fabrication-friendly INSERT policy narrowed on the way past. **The standing headline is
unchanged: chase the outstanding invoices, keep marking August, bill it in early
September — §9.**_

_Previously, 2026-08-03 — **the mobile app caught up with the billing that shipped
without it (§8.27, LIVE)**. A day of real use produced four complaints, all correct:
the coach's **Classes tab** now lands on the class list (grouped by weekday, today
first) instead of a leftover attendance screen — the other half of §7.65, and §7.80
records the **three fixes that silently did nothing**; the coach's **Billing tab became
My Pay** (payouts only, hidden entirely when there are none, so production's private
coach sees **three** tabs) because every actionable thing about an invoice lives on the
admin panel now; the **parent app prints `INV-2026-0001`** on both invoice screens
instead of a UUID fragment that matched nothing on the QR, the reminder or the bank
statement; and Today's card counts **guests apart from students** ("4 students +
1 guest") after it was found printing enrolments beside a chip counting the expected
set. On the test side: deleted a driver with **zero assertions**, found the worse variant
— one reporting "18/18 passed" while four checks crashed — and then **found that the
detector written for it was itself wrong**, having libelled a second driver that turned
out to assert perfectly well (§7.79 carries the correction, which is the more useful half)._

_Previously, 2026-08-02 (third session that day) — **fee-free payment collection
shipped AND DEPLOYED, Phases 0–3 (PRD §7.21, §8.26)**: every invoice now carries a
per-tenant `INV-YYYY-NNNN` reference and a 128-bit public token (BEFORE INSERT
trigger — the engine is untouched); a **dynamic PayNow QR** with amount + reference
locked is computed client-side from new tenant UEN/mobile settings; a **tokenized
public invoice page** (`swimsync.sg/invoice/<token>`, no login, served by the new
`public-invoice` edge function) is where the **WhatsApp reminder button + click-through
queue** on the admin Invoices page send parents; the parent's **"I've paid" claim** and
ONE converged `confirm_invoice_paid()` path close the loop. Two migrations, a third
edge function, all three UIs, a 19-check driver — deployed in the §7.60 order and
verified (grant dumps clean, both bundles grep-positive). **Then, same day, the
standing mission of this file COMPLETED: the user passed the bank-app scan gate,
BILLED JULY FOR REAL, and COLLECTED THE FIRST REAL MONEY** — real invoices with
references, real PayNow payments against the dynamic QR, July sealed, audit rows
written by the converged confirm path. The product's whole loop has now run on real
data end to end. Earlier that day: make-up classes (§8.25). New standing headline:
**chase the remaining outstanding invoices (the WhatsApp queue exists for exactly
this), keep marking August, and bill it in early September** — §9._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.85** |
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
  between the 1st of last month and today, enforced by triggers rather than by the screen,
  so a phantom lesson can no longer be created *and billed* by reaching the screen with a
  hand-typed date. A genuine makeup lesson is scheduled by the business's admin instead
  (`schedule_extra_lesson()`), and the coach records it. Separately, "who was expected at
  this lesson" is now answered **per date** from enrolment spans — a child who joined on
  the 20th used to be expected on the 6th, which blocked the whole month from billing with
  no override. PRD §7.5/§7.6, `ATTENDANCE_WINDOW_PLAN.md`, §8.15.
  > **Dormant until a real lesson is marked.** Production has 0 attendance rows, so
  > neither the guard nor the joiner fix has been exercised on real data yet.
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
- **Automated tests** — pgTAP + Deno on the backend, vitest + jest-expo on the two apps, all
  in CI on push to `main`. **Counts are deliberately not written here**: the two frontend
  numbers that used to be (162 and 109) had drifted to 198 and 174 by 2026-08-01 while
  reading as current. `docs/TESTING.md` §5 says what each suite covers; **the runner is the
  fact**.
  Since 2026-08-01 CI also **loads every UI fixture** and asserts each one round-trips and
  writes only its own rows (`check-fixture-roundtrip.sh`); it found three broken fixtures on
  its first run (§8.20). **The drivers themselves still run by hand** — that is the half of
  the gap still open (`BACKLOG.md` → *Run the UI drivers in CI*), and §8.21 is what it costs.

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
> **As of 2026-08-02 (evening) production is fully caught up**: every migration through
> `20260802000700` is applied (`supabase migration list --linked` shows nothing pending),
> `generate-invoices` is at **version 18** on the platform's counter, and THREE functions
> exist: `generate-invoices` v18, **`package-emails` v1** (verify_jwt ON), and
> **`public-invoice` v1** (verify_jwt **false**, deliberately — the invoice token is the
> access control; deployed 2026-08-02, each deployed separately). *(This line has gone
> stale before — `supabase functions list` and `supabase migration list` are the honest
> answers; treat this sentence as a hint, not a fact.)*
> Backups were taken before each production migration through 2026-08-01 (scratchpad,
> not committed). **The 2026-08-02 make-ups batch went out WITHOUT a fresh backup** —
> additive-only plus three CREATE OR REPLACEs whose pre-change bodies are captured in
> `supabase/rollback/20260802_makeup_bookings_DOWN.sql`; noted here so the omission is
> a fact, not a discovery. The payment-collection batch (000600/000700) DID take
> schema + data dumps first (scratchpad, not committed); both migrations are additive
> and production's `invoices` table was empty when they landed.
>
> The **tenancy** deploys (§8.1) had **opposite orderings** and both were deliberate — phase 4
> *dropped* columns so the app deployed first; phase 5 only *added*, so migrations went
> first. **§8's deploy got that wrong**: the push to `main` went out before
> `supabase db push`, so Vercel shipped an admin calling an RPC that did not exist yet.
> The rule governs the **push**, not just the migration command — see §7.27.
>
> As of 2026-07-18 that also includes the whole §8a underbilling cluster (multi-class invoices, the
> configurable run day, month sealing, and the hard attendance block) **and the same-day
> empty-month seal fix (§8a.1) — `supabase functions list` shows `generate-invoices` at
> version 7, deployed 2026-07-18 19:45 SGT, ~1 min after commit `0363757`**, plus the earlier bulk
> attendance **"Set all"** control, **admin class
> editing + a required day-of-week** (§8e), the unmarked-lesson safety net, and the parent
> Attendance fixes (§8g). **Caveat worth keeping:** every check on that work ran against **local
> fixtures** — none of it has been driven against the real production DB. No schema or
> migration is involved, so failure looks wrong rather than destroying data.

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

## 8.28 (2026-08-04) — THE THREE QUEUED MIGRATIONS, AND THE ONE LIVE HOLE THEY FOUND

**All three shipped, deployed and verified on production the same day** (`e03cba6`,
`2a5fa0b`, `4981fd2` — migrations `20260804000100/200/300`). They were queued behind each
other by §7.55, not by importance; the reason to take them in one session was that each
was small and none blocked anything.

**The headline is the one nobody filed.** BACKLOG called the `anon` EXECUTE item *"defence
in depth, not a live hole"*. Auditing it found `next_credit_note_ref(uuid)` with **no ACL
at all**, so it sat on the Postgres default of `EXECUTE TO PUBLIC` — locally as well as on
cloud. It is `SECURITY DEFINER` and it **writes**. An unauthenticated POST carrying only
the anon key returned `CN-2026-0001` and left `tenants.credit_note_counter` incremented.
Anyone with a tenant's UUID could burn that business's credit-note numbers indefinitely.
Granted to **nobody** now — its callers are all inside other definer functions.
Reasoning: **§7.82**.

**And one that had been filed backwards.** *Narrow `coaches_without_rate`* was already
done in SQL — since 2026-07-19. The 2026-08-01 session read the field mapping in reverse,
concluded the page was reading a column "the RPC has never returned", and replaced a
correct SQL column with a 2000-row browser scan, a tripwire and a warning banner, writing
the false claim into a code comment, `BACKLOG.md`, `PRD.md` §4.4 and an immutable commit
message. All removed; **§7.83** carries the three oracles that settle this kind of
question in seconds. The *decision* from that session — don't show a business's "shape" —
was sound and stands; only the stated reason was wrong.

**What actually needed a migration**, then: dropping `tenants.kind` (never read by
anything) and with it `provision_tenant`'s `p_kind` parameter; the grant sweep; and
`audit_log.tenant_id`, stamped from its **entity** by a `BEFORE INSERT` trigger with a
`RAISE` on an unknown `entity_type` (`docs/ARCHITECTURE.md` §6 — the four parts of that
are decisions, not implementation). The audit work also **narrowed an INSERT policy** that
had been `actor_id = auth.uid()` and nothing else, i.e. any signed-in user could fabricate
any audit row; it is now the single real client case, a coach on a session they own.

**Departed from BACKLOG's advice once, deliberately:** it said *probably don't backfill*.
The concrete failure — a child who changed businesses being attributed to the wrong one —
was checked against the production dump first: **zero reassignments, one tenant**, against
81 of 103 rows being permanently invisible. Recorded in `docs/ARCHITECTURE.md` §6 with the
condition under which it must not be repeated.

**Production numbers worth keeping** (from remote dumps, not from prose): functions
granting EXECUTE to `anon` went **49 → 18**, and all 18 are trigger/event-trigger
functions that Postgres never privilege-checks and PostgREST does not expose
(`docs/DEPLOYMENT.md` §11.7 has the re-run command — **the number climbs back on its own**
as new functions are created). `audit_log` held 103 rows, 81 unstamped, now backfilled.

**A fourth migration followed, once the question "should we ever run that line?" was
asked properly.** `20260804000400` turns off the mechanism itself: default privileges no
longer grant `anon` — or `PUBLIC` — a new function, table or sequence, so the 49→18 sweep
stops being point-in-time. Two things made it safe to do what July had refused: the
2026-08-02 edge-function rule (`docs/ARCHITECTURE.md` §6) means no future function can
legitimately need `anon`, and **the statement both refusals had in mind would not have
worked anyway** — `… IN SCHEMA public REVOKE … FROM PUBLIC` succeeds and changes nothing,
because the built-in PUBLIC grant is global (**§7.85**). Found by mutation-testing the
migration's own probes: the function probe went red for a revoke that had been *written*,
not one deleted. All three probes then proven to fire independently.

**Verified:** pgTAP **479** (27 files; 11 new assertions across two new files, all proven
RED first — §7.25), Deno 130 **run twice** (§7.15), vitest 237, jest 244, both typechecks,
fixtures 15/15. Six drivers, because the narrowed policy and the helper revokes are
exactly what unit tests cannot see: payment-collection 19/19, coach-wages 10/10,
platform-admin 6/6, tenant-provisioning 15/15 (a whole business provisioned through the
real UI on the new one-argument RPC), attendance-guard 20/20, makeups 15/15. After the
attendance run the database showed the coach's own client-side `attendance_saved` rows
written **through** the new policy and stamped. The anon exploit re-run after the fix
returns `42501` and leaves the counter at 0. CI green; both Vercel production deployments
are on `4981fd2`. **§7.84** records that `supabase start` leaves the edge runtime stopped,
which cost a debugging round when four driver checks failed looking like product bugs.

---

## 8.27 (2026-08-03) — THE APP CATCHES UP WITH THE BILLING THAT SHIPPED WITHOUT IT

**The trigger was the user opening their own app.** Payment collection (§8.26) shipped
entirely on the admin panel and the public invoice page; the mobile app was never
reconciled against it, and a day of real use surfaced it as four questions. All four were
real, and a fifth was found while answering them. Shipped and **deployed** as one
app-only change — no migration, no edge function, no engine change (`aa89bd3`).

**What was wrong, and where its reasoning now lives:**
1. *"What are the 4 outstanding?"* — unpaid invoices, counted with no date bound, sitting
   between two today-scoped tiles. Removed with the whole category — `BACKLOG.md` →
   *Deliberately not doing*, and PRD §7.9.
2. *"Why does Classes open on a class?"* — the other half of **§7.65**, live for weeks.
   `docs/GOTCHAS.md` **§7.80**, which is mostly a list of the **three fixes that silently
   did nothing** (`navigate({screen})`, targeted `popToTop`, `dismissAll`) — each looked
   right and changed no behaviour. Only the driver caught them.
3. *"The Billing page is outdated"* — correct; PRD §7.9 and §14.2/§14.4.
4. *"The PayNow QR should be unnecessary"* — correct **but not yet safe**: the static
   upload still serves native builds and **package payments**, which have no reference to
   lock into a QR. Recorded in `BACKLOG.md` as an ordered pair — references first, retire
   the upload second. Doing it in the other order breaks paying for a package.
5. **Found while working:** Today's card printed *active enrolments* while the chip beside
   it counted the *expected* set, so it could read "4 students · 3 of 5 marked". A coach
   trusting the head-count leaves a lesson unmarked, and that blocks the month with no
   override. Now "4 students + 1 guest", split **by subtraction from the same array the
   chip uses**, so the two cannot drift (§7.18).

**The driver work is the durable half.** `verify-coach-billing.mjs` was deleted: it had
**zero `check()` calls**, swallowed every error and set no exit code — it could never have
failed. Hunting for siblings found the worse variant in `verify-stale-screen.mjs`, which
printed *"18/18 passed"* and exited **0** while four newly-appended checks crashed, because
`finally` reached `process.exit` first. Both are **§7.79**, with a one-line detector that
flagged one survivor — **wrongly**. `verify-tz-saturday.mjs` asserts through its own
`[label, bool]` array and exits non-zero; the detector had grepped for this repo's
`check(` helper name rather than for the *property*, and the false positive was written up
as fact in both §7.79 and `BACKLOG.md`. **Running it showed 5/5** (2026-08-03). Both
documents corrected, the backlog item deleted, the detector replaced with one that greps
for a non-zero exit path — which now returns nothing, i.e. every driver can fail. The
driver was hardened anyway (crash-as-failed-check, browser closed in `finally`, a run that
asserts nothing exits 1; all three proven by mutation). **§7.81** records that
Metro caches the route manifest, so a renamed route folder leaves a **ghost tab** and every
driver run against it measures the old app — which cost a debugging round here.

**Verified:** jest **244** (was 207), vitest 237, both typechecks clean, fixtures 15/15,
`verify-stale-screen` **22/22** (was 18/18), `verify-coach-wages` 10/10 (was 8/9),
`verify-makeups` 15/15, `verify-payment-collection` 19/19. New tests proven RED first
(§7.25). CI green; the served swimsync.sg bundle greps positive for all four changes and
negative for the old strings.

---


### Older sessions — the ledger

| # | Date | What shipped | Where its reasoning lives now |
|---|---|---|---|
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

**Still open from 2026-08-04:** whether `authenticated` deserves the same treatment
`anon` just got. That role IS reachable, and it holds `TRUNCATE` on all 37 tables — a
privilege **RLS does not restrain**. Not filed as an item yet because it needs the same
"prove nothing depends on it" pass that `anon`'s did, and unlike `anon` the answer is not
obviously "nothing".

**The highest-value engineering item is still *Run the UI drivers in CI* (M), and 2026-08-03
made the case stronger.** CI loads every fixture but executes no driver, and the count of
drivers caught rotting **by accident** is now four (§8.21, §8.22, §8.27): one at 2/5 from a
stale calendar, one aborting on check 1 since two hours after it was written, §7.62's pair
that could not load at all, and now one with **zero assertions** that could never fail plus a
second that printed *"18/18 passed"* while four checks crashed (§7.79). §7.79 carries a
one-line detector — **that half is mechanical and could be a CI step on its own, without a
browser**, which is the cheapest slice of this item. It currently returns nothing, which is
the point of running it. **But note what §7.79 also records:** the *first* version of that
detector grepped for a helper name and produced a false positive that was written up as
fact in two documents. A static check tells you a driver *can* fail, never that it *does* —
only executing it does that, which is the whole argument for this item. Weigh the narrower
options in its `BACKLOG.md` entry.

**The migration queue is EMPTY.** All three shipped and deployed on 2026-08-04 (§8.28).
Nothing is in flight, so the next schema change can start immediately — still one at a time
(§7.55), and a worktree never authors one (`docs/WORKTREES.md`).

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
