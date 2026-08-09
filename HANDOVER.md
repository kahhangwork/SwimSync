# SwimSync — Session Handover

_Last updated: 2026-08-09 (5th session) — **WAVE 1 IS COMPLETE. Chunk 4 is LIVE: a class can
be RETIRED, and retiring it no longer loses money (§8.39).** `classes.is_active` means
scheduling and nothing else — the engine used to scan `.eq("is_active", true)`, so retiring a
class at month end silently dropped its already-taught lessons *and* stopped it blocking, a
hole exactly where someone is tidying up. Migrations `20260809000300` + `20260809000400`,
engine **v18 → v19**, both apps, grant dump diffed, CI green, UI confirmed on production._

_**The fix could not be a `.eq()` deletion, and that is the whole chunk.** That scan also
feeds the completeness gate, so widening it lets an inactive class expect a lesson on every
weekly date and block the month — no override by design, invisible to every screen that could
clear it (**§7.109**). Closed three ways: `classes.deactivated_at` clamps how far an inactive
class is expected to have run; `deactivate_class()` refuses to create the state (three
refusals, no overrides); and the Classes page gained *Show retired* **in the same deploy**._

_**Three of this session's own assertions were passing for the wrong reason**, and only
breaking the code found them — §7.111 (a test helper that satisfies the gate under test),
§7.112 (`throws_ok(…, NULL, …)` matches any `P0001`, so a subject that trips a second guard
proves nothing) and a fixture span that let a different refusal do the refusing. §7.110 fired
exactly as the plan predicted: `makeups.test.ts:370` went vacuous, and its union arm turned
out **unreachable** rather than untested, so it was deleted._

_**Filed, not fixed, and confirmed by measurement:** `core.ts`'s two `continue` guards ignore
`bookingsByDate`, so an unmarked booking in a class with no active enrolments is neither
billed nor blocking — and the month **SEALS** over it. Pre-existing and unchanged here, but
every retired class now sits in that state by construction. **Zero on production**, and it is
`BACKLOG.md`'s top find with the audit any fix must gate on (§9)._

_Previously, 2026-08-09 (3rd session) — **Wave 1 Chunk 2 is LIVE: a package purchase is
now numbered and QR-payable like an invoice (§8.37).** `parent_packages` carries
**`PKG-YYYY-NNNN`**, the parent's PayNow screen builds the same amount-and-reference-locked
dynamic QR an invoice has had since 2026-08-02, and the admin Packages page shows the
reference so a bank line can be matched. Migration `20260809000100` deployed, both apps
deployed, remote grant dump diffed, CI green. **Four backlog items closed in one commit —
Wave 1 was down to two, each one migration** *(one of those two shipped the same day as
Chunk 3; §9 has the live count)*.

**Three findings outlived the code.** The plan's own RISK 6 assertion **cannot fail**:
`'2025-12-31 23:30+08'` is 2025 in both SGT and UTC, so it passes against the bug it was
written for — the discriminating case is `'2026-01-01 00:30+08'` (**§7.105**). And
`current_user = 'authenticated'` — the seam three other functions use — is **dead code
inside `SECURITY DEFINER`, failing open** (**§7.104**): the first version's refusal of a
client-supplied reference never fired, and a squatted number would have broken the
buy-a-package path for a whole business on the *next* request. Plus **§7.106** (a
concatenated `.select()` untypes the query and blames the schema) and **§7.107**
(`loginExpo` short-circuits, so a driver changing persona silently runs as the previous
user).

**The step that would have shipped blind now has coverage:** nothing anywhere touched
`app/(coach)/settings` — the only writer of `tenants.paynow_qr_url` — so
`verify-paynow-fallback.mjs` (21 checks, proven red both ways) now drives all three PayNow
states, including the stored-but-**unencodable** ID that decides whether the fallback upload
may ever be conditionally hidden. It may not; it is collapsed, always present._

_Previously, 2026-08-08 — **the coach's Today tab is gone: SCHEDULE replaced it, parents
can pay and claim straight from their invoice list, and `BACKLOG.md`'s build order is
ranked again for the first time since 2026-07-19. All LIVE — five commits on `main`, CI
green (§8.34).** The Schedule tab is a Monday-start week selector over NEEDS MARKING /
TODAY / COMING UP / DONE, and the two decisions worth carrying are that **NEEDS MARKING is
floor-scoped and ignores the selector** — week-scoping it would hide a straggler nobody
would go looking for, and unmarked attendance blocks billing with no override — and that
**the week is an offset integer, not a stored Monday** (**§7.95**: an absolute date captured
at mount goes stale on a PWA that survives a Sunday→Monday boundary, and the symptom is
today's lessons simply absent). Five gotchas graduated: **§7.95–§7.99**, plus a new
paragraph on **§7.70**.

**Three predictions were wrong this session and the corrections are the durable part.**
Nested Touchables do **not** double-fire on RN-web (**§7.99**, tested by re-nesting them);
the backlog range **can** grow large, for a tenant that has never sealed a month
(**§7.70**); and consolidating two drivers' "identical" `pressByText` copies broke one,
because deep-link and in-app navigation need opposite answers (**§7.98**). The prediction
that held was the expensive one: `verify-stale-screen.mjs` really was about to become a
permanent false pass. A pre-commit review then caught a regression introduced *while
writing* §7.97 — the extracted date-union clipped booking dates the old screen never
clipped, dropping a trial from the coach's list while the engine still blocked the month._

_Previously, 2026-08-07 — **the attendance-marking floor now follows `billing_periods`
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
every rollback and diff `pg_get_functiondef()`).

**Then triaging the red nightly drivers found a SECOND live bug and fixed it (§8.33):**
`CURRENT_DATE` is the session's time zone — UTC here — so `set_class_terms()` **refused
every class edit between 00:00 and 08:00 SGT**, three weeks live, while the admin panel
sent the correct Singapore date. Both red drivers were that one bug, not driver rot. The
lesson is **§7.94**: the RPC, its pgTAP file and its driver had all made the same UTC
assumption and therefore agreed, so a 14-test file on that exact function stayed green.
*(This session's CI was red purely because GitHub Actions was in a major outage — re-run
on 2026-08-08, see the dateline above.)*_

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.113** |
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

> **§3 is now ~400 lines — half this file, and the largest thing left in it.** It is the
> next graduation candidate, the way §8 was in §8.17: most bullets describe behaviour
> `PRD.md` already specifies in full, and what is genuinely load-bearing here is the
> **prohibitions** ("don't re-add a count", "no rate is the finished state", "clean slate
> is a banned phrase") and the *verified-vs-specified* distinction. When it is split, keep
> those and point at the PRD for the rest. Prefer editing a line here to adding one.

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
  the coach's Schedule tab leads with **NEEDS MARKING** and links straight to marking a
  past date, and the admin's invoice-generation dialog reports `N of M lessons marked` per
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
  > **A package request is now numbered and QR-payable like an invoice (verified local:
  > pgTAP 12 + 2 UI drivers — LIVE 2026-08-09).** `PKG-YYYY-NNNN` per business, the year
  > taken from the request's own `requested_at` in SGT, minted by a `BEFORE INSERT` trigger
  > whose **name is part of the contract**: it must sort after `trg_parent_package_lifecycle`,
  > which is what fills `tenant_id`, so renaming it breaks **every** package request
  > (`docs/ARCHITECTURE.md` §6). The parent's PayNow screen builds the same
  > amount-and-reference-locked QR an invoice gets, and the admin Packages page shows the
  > reference on both tables. Still dormant in the sense that matters: no package has been
  > sold on production. PRD §7.16, §8.37.
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
  input); the coach-Settings image upload is now a **collapsed fallback**, not the primary
  affordance (§8.37); the **tokenized public page** (`/invoice/<token>`, sessionless, edge
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
- **The coach's landing tab is a WEEK, not a day (verified local: jest 308 + a 19-check UI
  driver + 5 existing coach drivers re-run — LIVE 2026-08-08)** — the Today tab is gone;
  **Schedule** replaced it, and the tabs are Schedule / Classes / My Pay / Settings (a
  private coach still sees three). A Monday-start week selector sits over four sections:
  **NEEDS MARKING**, **TODAY**, **COMING UP**, **DONE**. The Classes tab and its roster are
  untouched.
  > **NEEDS MARKING is FLOOR-scoped and deliberately ignores the selector** — every
  > unmarked lesson from the business's `markable_floor` to today, whatever week is shown.
  > Week-scoping it would hide a straggler the coach has no reason to look for, and
  > unmarked attendance blocks billing with no override (§8i). `verify-schedule-week.mjs`
  > pins it, proven red by scoping the query to the week.
  > **The week is an offset integer, not a stored Monday** (§7.95): an absolute Monday
  > captured at mount goes stale on a PWA that survives a Sunday→Monday boundary, and the
  > symptom — today's lessons simply absent — is indistinguishable from a quiet day.
  > Sections are driven by **marking state, not the calendar**, so they still mean
  > something on a week that is not the current one. PRD §14.2, §7.5.
- **Every lesson list says whether it has been marked (verified UI driver — LIVE
  2026-07-26)** — the Schedule tab's lesson cards, the NEEDS MARKING rows and the class roster each
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
  > **And since 2026-08-09 every EDIT to a child is recorded too (verified local: pgTAP 11
  > + the four UI drivers that write to `students` — LIVE, `20260809000200`).** An
  > `AFTER UPDATE … WHEN (OLD.* IS DISTINCT FROM NEW.*)` trigger writes the full
  > `to_jsonb(OLD)`/`to_jsonb(NEW)` for all four client writers — the admin level picker,
  > the admin contact modal, the admin Assign action, the parent's own edit-child screen.
  > **It is `SECURITY DEFINER` and that is not a style choice**: invoker-rights, the
  > `audit_log` INSERT policy refuses the row and the student UPDATE dies with it, so every
  > student edit in the product stops working (§7.104). A write with no JWT actor —
  > migration, `psql`, seed, edge function — records **nothing and is allowed through**, on
  > purpose: an audit gap on a backend path is recoverable, a refused student write is not.
  > **Two known holes, both disclosed rather than silent:** backend writes are unattributed
  > (a reader must render "system", not blank), and `prepare_admin_delete()` purges a
  > deleted admin's rows (`BACKLOG.md`). §8.38.
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
- **A class can be RETIRED, and retiring it no longer loses money (verified local: pgTAP 23 +
  Deno 5 ×2 + a 21-check UI driver, and audited against production — LIVE 2026-08-09)** —
  `classes.is_active` means **scheduling**, never billing. The invoice engine scanned
  `.eq("is_active", true)`, so deactivating a class at month end silently dropped its
  already-taught lessons *and* stopped it blocking generation. It now bills every class in
  the tenant, and the admin **Classes** page gained **Retire** / **Restore** and a
  *Show retired classes* toggle. Retiring is refused — with the reason rendered, naming the
  child, the guest or the dates — while children are still on the roster (by enrolment
  **span**, not `is_active` — §7.66), a guest is booked into a future lesson (trials **and**
  make-ups), or lessons are still owed a mark. **No overrides on any of the three.** An empty
  class retires, decided deliberately (§7.17). PRD §7.3, `docs/ARCHITECTURE.md` §6, §8.39.
  > **`classes.deactivated_at` is what makes the engine change safe, and a boolean cannot
  > replace it.** The same scan feeds the completeness gate, so widening it naively makes an
  > inactive class expect a weekly lesson for ever and block the month with no override and
  > **no screen able to clear it** — the coach class list and Schedule tab still filter
  > `is_active` (§7.109). The date answers *"was this class running on the 13th?"*: lessons
  > before it still block, dates after it are not expected, and a legacy row with a NULL date
  > expects nothing at all. **`reactivate_class()` takes no refusals and must never grow
  > one** — it is the only exit.
  > **Dormant in the sense that matters:** production had **zero** inactive classes on deploy
  > day (audited), so no class has been retired on real data yet.
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
  `docs/TESTING.md` §5. **Its first scheduled sweep found a LIVE product bug that had been
  invisible to four green manual runs — see §8.33 and §7.94. That is the whole argument for
  the nightly, made on its first outing.** Since 2026-08-09 the sweep also measures **column
  GEOMETRY on 15 of the 16 admin tables**, not just Levels — the §7.54 class of bug that
  every text assertion passes straight through (§8.36). Its **fourth** sweep made the
  argument again from the other direction (§8.35): `verify-trials` had been reporting PASS while asserting
  nothing since 2026-07-26, and only a sweep landing on a UTC Saturday exposed it. **So a
  green sweep is not proof a driver ran** — a driver that self-skips exits 0 and is counted
  as PASS (§7.100). `gh run list --workflow=ui-drivers.yml` is the current fact; an open
  `ui-driver-rot` issue means red right now.

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

## 8.39 (2026-08-09, 5th session) — WAVE 1 IS COMPLETE: A CLASS CAN BE RETIRED, AND RETIRING IT NO LONGER LOSES MONEY

**`classes.is_active` means SCHEDULING now, and nothing else.** The engine scanned
`.eq("is_active", true)`, so retiring a class at month end silently dropped its
already-taught lessons *and* stopped it blocking generation — a hole exactly where someone
is tidying up (BACKLOG #6, filed since July). The engine bills every class in the tenant,
the admin can retire and restore one from the Classes page, and **Wave 1 is done**.
Deployed in full: `20260809000300` + `20260809000400`, engine **v18 → v19**, both apps,
remote grant dump diffed, CI green, and the UI confirmed on production.

**The fix could not be a `.eq()` deletion, and that is the whole chunk.** That scan also
feeds the completeness gate, so widening it lets an inactive class expect a lesson on every
weekly date and block the month — no override by design, and the class is invisible to
every screen that could clear it (**§7.109**). Closed three ways, because the failure is a
whole business unbilled: `classes.deactivated_at` clamps how far an inactive class is
expected to have run so the unclearable expectation is never generated; `deactivate_class()`
refuses to create the state at all (three refusals, no overrides); and the Classes page
gained *Show retired* **in the same deploy**, so `reactivate_class()` always has a screen.
A boolean cannot do the first — *"was this class running on the 13th?"* needs a date.

**Nothing was trusted that could be broken instead.** All three refusals were proven red by
**breaking them in the database**, and the engine clamp red **both ways** — a naive `.eq()`
deletion and a blanket exemption. That is what caught the session's real lesson: **three
separate assertions of mine were passing for the wrong reason**, and none was visible in a
green run. Two Deno cases called `completeMonth()`, which satisfies the very gate under test
(**§7.111**); the §7.66 enrolment case was being refused by a *different* guard until its
fixture span was narrowed to one marked date; and the cross-tenant case went green from an
unrelated `P0001`, because `throws_ok(…, NULL, …)` matches any message (**§7.112**).

**Two predictions from the plan were right, and one finding was not predicted at all.**
`makeups.test.ts:370` went vacuous exactly as forecast — with the `home_class_id` union arm
deleted the file still passed 12/12 — and the arm turned out to be *unreachable*, not merely
untested, so it was **deleted** rather than kept (**§7.110**; its failure mode is a loud
throw, never a silent underbill). The unpredicted one came out of the pre-commit review and
is the more serious: **`core.ts`'s two `continue` guards ignore `bookingsByDate`**, so an
unmarked booking in a class with no active enrolments is neither billed nor blocking — and
with a second class billing, the month **SEALS** over it. Confirmed by running it, twice.

**Filed, not fixed, and disclosed rather than silent.** That underbill is **pre-existing and
unchanged by this work** — a retired class was skipped outright before, same outcome — but
every retired class now sits in that state by construction, and `book_trial()` lacks
`book_makeup()`'s `is_active` guard, which is the other half of the chain. It is in
`BACKLOG.md` **with the production audit any fix must gate on**, because making an unmarked
booking block is a change to what *blocks* a month. **Measured zero on production**, so
nothing is leaking today. Also filed: retired classes cost three queries per run for ever.

**Verified:** production audit **zero rows on all three** RISK 1/7 queries, run before a line
was written; pgTAP **604** (`class_deactivation.test.sql` 23/23); Deno **135 ×2** (§7.15);
vitest 255; jest 308; both typechecks; `verify-class-deactivation` **21/21** across three
consecutive runs, proven red by restoring the page's `is_active` filter; `check-teardowns`
19/19 and `check-fixture-roundtrip` clean three times; rollback file executed; CI green;
and on production the grant dump shows `class_unmarked_lesson_dates` callable by **nobody**,
`anon` EXECUTE still **18**, zero `GRANT ALL ON TABLE … TO "authenticated"`.

---

## 8.38 (2026-08-09, 4th session) — WAVE 1 CHUNK 3 IS LIVE: EVERY EDIT TO A CHILD IS RECORDED

**Four client paths changed a child's record and told nobody.** The admin level picker, the
admin contact-details modal, the admin Assign action and the parent's own edit-child screen
all `UPDATE students` straight from the browser. `provisional_contact_phone` and `_email`
are the top two ranked signals in `find_student_candidates()` — they decide **which parent
is offered which child**, and once a claim is approved nothing in the product can unlink
them except that flow's own undo (§7.47). *"Who changed the number, and when?"* is exactly
what a disputed claim asks, and the answer did not exist. An `AFTER UPDATE` trigger records
`to_jsonb(OLD)`/`to_jsonb(NEW)` — never the string "edited" — and is inherited free by
writers that do not exist yet, which is why it is a trigger and not an RPC per call site.
Deployed in full: migration `20260809000200`, remote grant dump taken and diffed, CI green.
**Wave 1 is down to one item** — see §9.

**All three of RISK 2's abort vectors were real, and each is closed AND asserted.** The
trigger is `SECURITY DEFINER` (or `audit_log_insert` refuses the row and the student UPDATE
dies with it); it resolves its actor through `profiles` and returns early when there is none
(or `actor_id`'s `NOT NULL` kills any backend write with no JWT — the next data-fix
migration would fail `supabase db push` against production); and `entity_type` is exactly
`'Student'` (or `audit_log_tenant_of`'s closed `CASE` raises). Proven by breaking the live
function twice: `SECURITY INVOKER` → assertion 1 dies with `42501` and takes the whole
transaction with it, which is the honest picture of that bug — not one broken screen, every
student edit; guard removed → 9 and 10 die with `23502` while 1–8 stay green, which is the
honest picture of *that* one — nothing a user does breaks, and the next migration fails
against production instead.

**What the work found that the plan did not.**
- **The plan's call-site list was wrong in BOTH directions**, and the reusable part is the
  correction: ask the code, never inherit a list. The coach roster is **not** a writer —
  `roster.tsx:295` is a `.select(`, and the coach app writes to `students` nowhere at all —
  and `unassigned/page.tsx:215` was missing. `WAVE_1_PLAN.md` RISK 2 is corrected in place,
  with the grep, because Chunk 4 reads the same file.
- **The plan's volume premise was wrong in the safe direction:** the invoice engine only
  `SELECT`s `students`, so engine-driven volume here is zero and an engine run cannot be
  aborted by this trigger.
- **§7.108**, from a driver failure that was neither the product nor the driver: a 30s
  `networkidle` timeout on `page.goto(admin/login)` is a cold Next.js compile. `curl` the
  route and re-run before reaching for §7.73.

**Deliberately not done.** `prepare_admin_delete()` still purges a deleted admin's
`audit_log` rows, so hard-deleting a departing admin destroys exactly the contact history
this preserves — **stated in the migration header and filed**, because a trail that quietly
evaporates is worse than a known-absent one. It is a retention decision before it is a
schema one, and `audit_log.actor_id` must **not** be made nullable to solve it (§7.50).
`audit_student_update` was left holding cloud's default `GRANT … TO service_role`, matching
its sibling trigger functions — the fourth data point for the standing `service_role` audit,
which must not be closed one migration at a time (`docs/DEPLOYMENT.md` §11.7). No
INSERT/DELETE arm: creation and merge already audit themselves from inside their own RPCs.

**Verified:** pgTAP **581** (`students_audit.test.sql` 11/11, proven red **both ways**);
Deno **130 ×2** (§7.15); vitest 255; jest 308; both typechecks clean; the four drivers that
write to `students` through the real UI — `verify-levels` 9/9, `verify-contact-details`
21/21, `verify-edit-child` 7/7, `verify-trial-visibility` 11/11; the rollback file
**executed** and the migration re-applied on top of it (§7.93); CI green on `main`; and on
production, the trigger present with its `WHEN` clause, `anon` EXECUTE still **18**, zero
`GRANT ALL ON TABLE … TO "authenticated"`.

---

### Older sessions — the ledger

| # | Date | What shipped | Where its reasoning lives now |
| **8.37** | 2026-08-09 | **A package purchase is numbered and QR-payable like an invoice** — `PKG-YYYY-NNNN` on `parent_packages`, the parent's PayNow screen builds the same amount-and-reference-locked dynamic QR an invoice has, the admin Packages page shows the reference so a bank line can be matched. **Four backlog items closed in one commit.** Three of the plan's mitigations were load-bearing and all three were proven by BREAKING them: renaming the reference trigger so it sorts before `trg_parent_package_lifecycle` fails **every** package request (that trigger fills `tenant_id`). The plan's own RISK 6 test case **could not fail** — `'2025-12-31 23:30+08'` is 2025 in both zones; the discriminating case is `'2026-01-01 00:30+08'`. And `current_user = 'authenticated'` — the seam three other functions use — is **dead code inside `SECURITY DEFINER`, failing OPEN**: a parent could have named their own reference, stranding the counter and breaking the buy-a-package path for a whole business. Nothing anywhere touched `app/(coach)/settings`, the only writer of `tenants.paynow_qr_url`, so a 21-check driver now covers all three PayNow states including the stored-but-**unencodable** ID | **§7.104–§7.107** · PRD §7.16 · `docs/TESTING.md` §5 · `BACKLOG.md` *(the unencodable PayNow ID, filed not fixed)* · `docs/DEPLOYMENT.md` §11.7 |
| **8.36** | 2026-08-09 | **Wave 1 got a PLAN, and its first chunk shipped — tooling only, nothing deployed.** `docs/plans/WAVE_1_PLAN.md` sequences the wave into four chunks with **17 mitigations inlined next to the steps they govern**, because a trailing Risks section is read once at planning time and never again; seven decisions were settled so they are not re-litigated, two of which changed the shape of the work (item #6 became engine fix **plus** a real class-deactivation feature; migrations run **strictly serially, no worktrees**). Two review findings would have broken chunks not yet built: a plain `AFTER UPDATE` audit trigger on `students` **refuses every student edit in the product** (it must be `SECURITY DEFINER` — this landed as Chunk 3, §8.38), and widening the engine's class scan widens what **blocks** it on a class invisible to all three clearing screens. Chunk 1: `verify-levels.mjs` made hermetic (its real failure was worse than filed — a second same-day run died after one check of nine, on a modal backdrop the refused create left open) and `verify-admin-table-geometry.mjs` took the §7.54 measurement from one admin table to **15 of 16**. A positional locator wrote a level onto **a child the driver did not own** while its own checks stayed green | **§7.101, §7.102** · `docs/TESTING.md` §5 · `docs/plans/WAVE_1_PLAN.md` · `BACKLOG.md` *(the sibling teardown that deletes invoices it does not own)* |
| **8.35** | 2026-08-09 | **The red nightly was a driver that had been reporting PASS while asserting NOTHING since 2026-07-26.** `verify-trials.mjs` never filled the phone field §8.12 had made mandatory, so `book_trial()` was never called and every later check failed for an unrelated reason. What hid it is the durable part: the driver **skipped itself unless today was the seed class's weekday**, computed from `new Date()` in the RUNNER's zone — and the nightly's `0 20 * * *` cron (04:00 SGT) means **every sweep runs on the previous UTC day**, so the skip fired every time until the first UTC-Saturday sweep. A driver that self-skips exits 0 and is counted PASS, so **a green sweep is not proof a driver ran**. A second finding fell out of the fix: the class roster gates Mark Attendance on enrolments only, so a lesson whose only attendee is a trial or make-up guest renders nothing there — real, filed, not a billing hole (the Schedule tab has no such gate). Caught in review: a reused `RegExp` would have carried `lastIndex` across elements | **§7.100** · `docs/TESTING.md` §5 · `BACKLOG.md` *(the roster gate)* |
| **8.34** | 2026-08-08 | **The coach's Today tab became a WEEK, parents can pay from the invoice list, and the backlog got its first ranking since July.** Schedule REPLACED Today (tabs: Schedule / Classes / My Pay / Settings), four sections under a Monday-start week selector driven by **marking state, not the calendar**. Two decisions carry the risk: **NEEDS MARKING is floor-scoped and ignores the selector** (week-scoping it hides a straggler nobody would look for, and unmarked attendance blocks billing with no override), and **the week is an OFFSET INTEGER, not a stored Monday** — an absolute date captured at mount goes stale on a PWA surviving a Sunday→Monday boundary, and the symptom is indistinguishable from a quiet day. **Three plan-review predictions were WRONG and the corrections outlived them**: nested Touchables do not double-fire on RN-web, the backlog range *can* grow unbounded for a tenant that never sealed a month, and consolidating two drivers' "identical" `pressByText` copies broke one. A pre-commit review then caught a regression introduced *while writing* §7.97 | PRD §14.2, §7.5 · **§7.95–§7.99** *(and a new paragraph on §7.70)* · `docs/TESTING.md` §5 |
| **8.33** | 2026-08-07 | **Triaging two red nightly drivers found a LIVE bug that refused every class edit for eight hours a day.** `CURRENT_DATE` in a function is the SESSION's time zone — UTC here — so between 00:00 and 08:00 SGT `set_class_terms()` read the admin's own SGT date as tomorrow and raised *terms cannot start in the future*; live since 20260719001000, with `sync_class_display_price()` on the same clock. Both moved to `today_sg()`, and `class_terms.test.sql` now asserts a `pg_proc` scan for UTC-dated functions returns nothing. **A 14-test file on that exact function stayed green because the RPC, the pgTAP file and the driver had all made the same assumption and therefore AGREED** — fixing only the RPC turned five assertions red. Both red drivers were that one bug, not driver rot. Its `pg_proc` probe also matched pgTAP's own `_def_is`, which would have aborted `supabase db push` on any pgTAP-installed database | **§7.94** *(and: test a date guard AT its boundary)* · §8.30 *(the nightly's first scheduled sweep is what found it)* · `docs/TESTING.md` §5 |
| **8.32** | 2026-08-07 | **The marking floor follows `billing_periods`, not the calendar** — `markable_floor(tenant)` = `LEAST(1st of last month, month after that business's latest seal, else `created_at`)`. Built as insurance ahead of its own stated trigger: billing a month LATE made the gate name a lesson **nobody could record any more**, with no override by design, so the month could never be billed. `LEAST` is the safety argument — the floor only ever moves EARLIER — asserted as a property over a matrix of tenant states, not case by case. All three production tenants read `2026-07-01` unchanged on deploy day. The filed fix was **wrong in one detail**: "the earliest UNSEALED month" leaves no floor at all, because a month with nothing recorded is never sealed (§8a.1). Found by EXECUTING the rollback file rather than writing it | PRD §7.6 · `docs/ARCHITECTURE.md` §6 *(why the LATEST seal, not the earliest unsealed)* · **§7.92, §7.93** · `supabase/rollback/20260806_markable_floor_DOWN.sql` |
| **8.31** | 2026-08-06 | **Co-admins:** the first admin of a tenant is its **owner** (`tenants.owner_profile_id` — ownership is a COLUMN, not a role); only the owner invites, deactivates and deletes co-admins, who otherwise hold identical authority. Deactivation is one clause in `is_tenant_admin()` plus an auth-layer ban for pure admins; a coach-admin keeps coaching. Guard triggers closed a pre-existing hole — `profiles_update` let ANY tenant admin rewrite any profile's **role**, harmless with one admin and an escalation path with two. Coach/parent logins refused at the panel door | PRD §4.3 · `docs/ARCHITECTURE.md` §6 *(why not an enum role, why not `tenant_members`)* · **§7.90, §7.91** · `supabase/rollback/20260806_co_admins_DOWN.sql` |
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

### ⚠ ONE THING TO CHECK, AND IT CHECKS ITSELF

**Confirm the nightly sweep went green.** `ui-driver-rot` **issue #3 was still OPEN** at the
close of 2026-08-09 — from the 2026-08-08 sweep, `verify-trials` only (34/35). Its cause is
fixed (§8.35) but **no sweep has run since**, and the sweep is the evidence, not this
sentence. `gh run list --workflow=ui-drivers.yml` and the issue's own state are the current
fact; a green run closes the issue itself. This section once read *"✅ NO RED SIGNALS"* for a
day after the sweep had gone red beneath it.

*(**Five** drivers have changed or arrived on 2026-08-09 and **none has faced a sweep yet**:
`verify-levels.mjs`, `verify-admin-table-geometry.mjs`, `verify-packages.mjs`,
`verify-paynow-fallback.mjs`, and the new `verify-class-deactivation.mjs`. All green locally
on three consecutive runs. **Two mutate shared state and are the ones to watch:**
`verify-paynow-fallback` writes the seed tenant's PayNow columns, and
`verify-class-deactivation` **retires a seed-adjacent class** — its fixture resets that with
`ON CONFLICT DO UPDATE` precisely because a run that dies mid-way used to leave the class
retired and blame the fixture on the next run (§7.113).)*

> **Before triaging any red, read §7.108.** A driver that dies on `page.goto(admin/login)`
> with a 30s `networkidle` timeout is a cold Next.js compile — not driver rot and not a
> product bug. `curl` the route and re-run before reaching for §7.73.

### WAVE 1 IS COMPLETE — the next build is chosen from `BACKLOG.md`

**All four chunks shipped (§8.36–§8.39).** `docs/plans/WAVE_1_PLAN.md` is now history, not a
queue; don't re-read it for work. **`BACKLOG.md` → `## Build order` governs what comes
next** — the six decisions the ranking rests on are in a table at its top; read them before
re-opening any.

**The highest-value item the wave left behind is the one it FOUND, not one it deferred:**
*An unmarked BOOKING is invisible when its class has no active enrolments* (**S**). A silent
permanent underbill, confirmed by running the engine twice, and the month **seals** over it
when another class bills. Pre-existing and unchanged by Chunk 4 — but every retired class now
sits in that state by construction, and `book_trial()` still lacks `book_makeup()`'s
`is_active` guard, which is the other half of the chain.

> **It measured ZERO on production on 2026-08-09, so nothing is leaking today** — and that is
> exactly why it is worth doing before it can be reached rather than after. **It is not a
> one-line fix**: making an unmarked booking block changes what *blocks* a billing month, and
> the block has no override, so any row already in that state would begin blocking the day it
> deploys. `BACKLOG.md` carries the production audit that has to gate it. **Named prohibition:
> do not fix it by adding an override to the unmarked-attendance block. Fix the scan.**

**The `authenticated` question from 2026-08-04 is ANSWERED — don't re-open it** (§8.29, §3):
one database role carries parent, coach and admin, so only RLS can separate them.
**`service_role` is the one still open**, and it now has a **fifth** data point which tested
the rule from the other side: `20260809000300` explicitly revoked its three functions and the
dump came back with **no `service_role` line at all**. So — *whatever you do not revoke,
`service_role` gets; whatever you do revoke, stays revoked*, and the fix costs one line
(`docs/DEPLOYMENT.md` §11.7). It is a `BACKLOG.md` item wanting a usage audit of the edge
functions and admin server routes **first** — do not close cells of it one migration at a time.

### Triage rules, when the sweep does redden

**Three triage rules worth keeping, all bought with real time:**

- **A job that dies before checkout is not your code.** Three CI runs on 2026-08-06 failed
  in *"Set up job"* during a GitHub Actions major outage. Check `githubstatus.com` before
  reading a diff.
- **When the sweep reddens, ask which moved — the product or the driver's assumption.**
  §7.73 is the calendar case; §8.33 is the product case, and it was a live bug that four
  green *manual* runs had missed because they ran outside the broken window.
- **The change that shipped yesterday is the SUSPECT, never the verdict** (§8.35). The
  2026-08-08 red looked exactly like §7.98 — written the day before, about the same screen
  — and was in fact a driver that had been broken for two weeks and had been skipping
  itself into a green PASS. Check when the driver last actually asserted anything.

**The migration queue is EMPTY, and nothing is queued to fill it.** The latest applied is
`20260809000400` (the class-deactivation grant, §8.39). Wave 1 spent three migrations and is
done. Whatever comes next: still one at a time (§7.55), a worktree never authors one, and
budget the post-deploy grant check (§7.39, §7.89) **and** the rollback rehearsal (§7.93 —
running the DOWN file is the half that finds the bugs). **Don't take `supabase db push`'s own
output as proof it applied:** on 2026-08-09 it printed a `pgdelta` certificate stack trace
*and* `Finished supabase db push`, twice. `supabase migration list --linked` is the fact —
check the `remote` column is filled.

> **To hold one migration back from another, MOVE THE FILE out of `supabase/migrations/` and
> put it back for the second push.** `supabase db push` applies everything pending, so two
> files present at once is one deploy and the ordering you wrote down did not happen (§7.49,
> §7.30). §8.39 used this to keep an RPC ungranted until its engine was confirmed live —
> §7.87 turned into a feature flag, and it is the pattern to copy whenever a new client path
> is only safe *after* something else deploys.

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
