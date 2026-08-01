# SwimSync — Session Handover

_Last updated: 2026-08-02 — **make-up classes shipped (guest-pass model, PRD §7.20,
§8.25)**: the admin books an enrolled child into one lesson of another same-category
class; a package family's attended make-up draws the package (the expiring-package
recourse), an ad-hoc guest pays their own class's rate. Five migrations + engine v17 +
all three UIs, **verified local only — NOT yet deployed** (migrations, the function and
the apps are all pending; §7.60 ordering applies). Same day, earlier: the parent invoice
detail marks package-funded lines (§8.24). The standing headline is unchanged: **real
attendance exists on production**, and **July has still not been billed** — §9, and the
marking window closes at the end of August._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.76** |
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
- **Coach** — marks/edits attendance (mobile), views their students' billing,
  uploads their PayNow QR.
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
- **Coach Billing screen (verified UI)** — queries live invoices (RLS-scoped) and marks
  them paid (invoice update + `payment_records` insert), web-safe via Toast /
  `confirmAction`. Needs `coach_serves_parent_profile()` to show parent names (§6).
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
- **Make-up classes (verified local: pgTAP + Deno ×2 + vitest + jest + a 14-check UI
  driver — NOT YET DEPLOYED)** — the guest-pass model (PRD §7.20): the business's admin
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

> **REAL ATTENDANCE EXISTS NOW (2026-07-26) — the thing blocked since 2026-07-13.** The coach
> marked live lessons through the app: rows exist for Sunday **12, 19 and 26 July** across at
> least the Tanglin View classes, including `present`, `absent` and `cancelled_rain`. Getting
> there took four bugs on the marking path (§8.19). **`invoices` is still empty** — nothing
> has been billed.
> **Do not read a count out of this paragraph.** How many lessons, and whether every class is
> complete, is `SELECT count(*) FROM attendance;` and the per-class query in §9 — not this
> sentence. Two prose counts have already gone stale in this file.
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
> **As of 2026-08-01 production is fully caught up**: every migration through
> `20260801000200` is applied (`supabase migration list --linked` shows nothing pending),
> `generate-invoices` is at **v16** (trial bookings + category trial pricing, on top of
> the unclaimed-attendance seal condition,
> package drawdown, the completed-month guard and effective-dated pricing), and a SECOND
> function exists: **`package-emails` v1** (verify_jwt ON — deployed separately, and a
> deploy of generate-invoices does NOT touch it). *(The previous version of this line went stale for two sessions —
> `supabase functions list` and `supabase migration list` are the honest answers; treat
> this sentence as a hint, not a fact.)*
> Backups were taken before each production migration (scratchpad, not committed).
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

**Not done yet** (see §9): real **parent onboarding** — parents self-register + add
their kids via **`swimsync.sg/welcome`**, then the superadmin assigns each to a class;
this is the last gate before real billing. Native App Store / Play Store builds remain
deferred (web app on iPhone for now).

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

## 8.25 (2026-08-02) — A MISSED LESSON CAN BE MADE UP IN ANOTHER CLASS

**The feature** (PRD §7.20 — the durable home): the guest-pass model, settled with the
user against three alternatives — freeform admin discretion (no per-miss ledger), any
enrolled child (not package-only), private-category make-ups reuse `schedule_extra_lesson()`
(different-coach private make-ups → BACKLOG), ad-hoc guests at the **home** class rate.
Five migrations (`20260802000100–500`), engine → **v17**, all three UIs. **NOT yet
deployed** — §7.60 ordering: `db push` → grant dump (§7.39) → `functions deploy` → push
`main` last.

**What made it cheap:** `trial_bookings` was the template, and the miss already billed $0
(`BILLABLE = {present, trial_paid}`), so one attended make-up = one draw / one charge —
no double relief, no "makeup credit" ledger. The predicted invariant breaks never
happened: a booking is not an enrolment, and billing still follows attendance rows.

**The two snapshots are the design** (§7.45): `category_id` (package matching survives a
host re-tag — pinned by the Deno snapshot test AND the `package_live_balances()` COALESCE,
whose absence would have broken the engine↔SQL pin on re-tag) and `home_class_id` (the
class id, not the rate number — corrections still flow; the engine's class-rates fetch
widens to cover it or a deactivated home class would kill the whole run in `rateOn`).

**Found while building:** `merge_students`' unknown-cascade tripwire REFUSED the suite the
moment `makeup_bookings` landed — exactly its designed behaviour; migration 5 teaches it
the fifth cascading table. And the coach-visibility gap was latent **for trials too**
(masked because the live coach is the admin) — `coach_serves_student()` now grants a read
via either booking table, proven needed by Phase-0 probes counting 0 as the real roles.

**Verified:** pgTAP 445 (26 new, incl. negative RLS probes and a table-did-not-grow
mutation check); Deno 123 **run twice** (12 make-up tests, 8 proven RED on v16; tripwire
recorded green on v16 first); vitest 222; jest 192; `verify-makeups.mjs` 14/14 (fixture
in round-trip CI, 14 fixtures clean; coach screens by fixed-id deep link, §7.58; the
fixture's off-schedule session on *today* makes the marking checks day-independent).
Durable homes: PRD §7.20 · `docs/TESTING.md` §5 · `docs/ARCHITECTURE.md` §10 · BACKLOG
(three follow-ups + the shipped item retired) · `supabase/rollback/20260802_…_DOWN.sql`.

---

## 8.24 (2026-08-02) — AN INVOICE NOW SAYS WHICH LINES THE PACKAGE PAID FOR

One commit, app-only — **no migration**: parents could already read their own
`package_applications` (`parent_id = current_parent_id()` was in the 2026-07-20 policy).
The parent invoice detail joins that ledger to its line items: a funded line reads
**"Paid by package · *name*"** in emerald; a **reversed** draw deliberately reads ad hoc,
because the correction path put that money back on the package. Durable material:
**PRD §7.16** (the behaviour + the historic-vs-current rule), `docs/TESTING.md` §5
(`invoiceFunding` suite). The BACKLOG item — filed the previous day as deliberately
skipped — shipped and was removed.

**Scope fact:** the admin Invoices page renders **no line items at all** (its
`invoice_items` join only feeds the student-names column), so the parent detail is the
only surface where "which lines" can render. An admin invoice-detail view would be a new
feature, not part of this.

**Verified**: jest 188 (+5, incl. reversed-draw-is-not-funding and the null-input
fail-safe); a throwaway two-line invoice (one funded + ledger row, one ad hoc) driven in
the real UI — exactly one line tagged, by name — then torn down. Not a committed driver:
a permanent version needs a fixture invoice, which would entangle
`fixtures-packages.sql`'s carefully un-invoiced live-balance scenario.

---

### Older sessions — the ledger

| # | Date | What shipped | Where its reasoning lives now |
|---|---|---|---|
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

### FIRST — finish July's attendance, then bill it

**The long block is broken: real attendance exists (§3, ledger §8.19).** What is left is the
other half — nothing has been invoiced, and nobody has checked that July is *complete*.
**As of 2026-08-01 July has ended, so it can be billed now** — and the marking window that
makes it possible closes at the end of August.

1. **Audit July class by class.** The gate blocks generation outright with **no override**, so
   find the gaps before running it, not from an error message:

   ```sql
   select c.title, ls.session_date, count(a.id) as marked
   from classes c
   left join lesson_sessions ls on ls.class_id = c.id
        and ls.session_date >= date '2026-07-01'
   left join attendance a on a.lesson_session_id = ls.id
   where c.is_active
   group by c.title, ls.session_date
   order by c.title, ls.session_date;
   ```

   Compare against each class's expected Sundays from **8 July** (enrolments were backdated
   to the 8th). A lesson that did not run is marked **cancelled** — never skipped, never
   overridden.
2. **Then bill July, in August**, following `INVOICE_RUNBOOK.md`. This will be the **first
   invoice this product has ever generated**, so expect to read the runbook rather than skim
   it. `auto_invoice_enabled` is **false**, so it is the admin button.
> **There is no third item, and "set a coach rate" is NOT one.** This list carried
> *"before payroll means anything, set a coach rate — still none, so wages compute
> nothing"* until 2026-08-01, and it was **wrong**. Production is a **private coach** — one
> coach, who is also the business's admin — and PRD §7.13 is explicit: *"a private coach
> simply has no rate, because their income IS their parents' invoices and there is nobody
> upstream to pay them."* **No rate is the correct, finished state here**, not a gap.
> The product already knows this everywhere it matters — the admin wages page says it in
> the UI, the coach app deliberately hides the "Your pay" card when there are no payouts,
> and the platform overview excludes owners from `staff_without_rate`. Only this file was
> wrong, and it is the file every session reads first, so the error was repeated at every
> handover. **A rate becomes a real to-do the day this business hires a second coach —
> not before.**

**The deadline, now enforced by the database:** the coach can only mark back to **the 1st of
last month** (§8.15). Bill July in August and every lesson is markable; leave it to September
and the gate will name a gap **nobody can fill**. Bill promptly, or fix the floor
(`BACKLOG.md` → *Tie the attendance-marking window to un-invoiced months*).

The join code is **`SWIM-RVM9`** — the only route in for a new family, and the re-entry route
for one marked inactive.

### If you would rather build than onboard

**`BACKLOG.md` → `## Build order` is EMPTY** and has been since 2026-07-19. Pick from the
themed sections below it. Nearest candidates with no dependencies: **credit-note emails**
(the other half of the notification work), an **upcoming-lessons view for parents** (small,
and the building block already exists), or **convert a trial into an enrolled student**.

**The highest-value engineering item is now *Run the UI drivers in CI* (M).** CI loads every
fixture as of 2026-08-01 but executes no driver, and **three drivers were caught rotting in
one week, every one of them by accident** (§8.21, §8.22): one at 2/5 for a month from a stale
calendar, one aborting on check 1 since two hours after it was written, and §7.62's pair that
could not load at all. It needs a browser and both dev servers, so weigh the narrower options
in its `BACKLOG.md` entry — nightly rather than per-push, a subset, or the DB-visible half
without a browser.

**Three migrations are queued behind each other, none urgent** — *revoke `anon` EXECUTE from
the remaining SECURITY DEFINER functions* (§7.39's missing second layer), *a business cannot
read its own audit trail* (13 of 19 writers never set `audit_log.tenant_id`, and the
parent-claim work made it **half**-populated, which fails more quietly than empty did), and
*retire `tenants.kind` / narrow `coaches_without_rate`* (§8.22 shipped the page half; the SQL
half needs a changed `RETURNS TABLE`). **One schema change in flight at a time** (§7.55), and
a worktree never authors one (`docs/WORKTREES.md`).

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
