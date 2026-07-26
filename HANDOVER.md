# SwimSync — Session Handover

_Last updated: 2026-07-26 — **this file is now an index.** The reference material it used to
carry (§5 tests, §6 architecture, §7 gotchas, §10 file map, §11 deployment, §12 removed UI)
moved to `docs/`, **keeping its section numbers**, and the session log collapsed from 29
narratives to 2 + a ledger. Nothing durable was deleted; four orphaned facts were promoted
first (§7.56, §7.61, §11.5, §11.6). See §8.17._

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
| **Traps that already cost real time** | **`docs/GOTCHAS.md`** | **§7.1–§7.61** |
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
  rates are admin-only.
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
- **Automated tests** — backend **397 pgTAP + 111 Deno**, plus frontend suites
  (`SwimSyncAdmin` vitest 162, `SwimSyncApp` jest-expo 109); all run in CI on push to `main`. See §5.

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

**Live in production on its own domain (web-first, $0 free tier)** — app at
**https://swimsync.sg**, admin at **https://admin.swimsync.sg**, real email via
**Resend** (`noreply@swimsync.sg`). The full loop is verified end to end on cloud
(incl. a live password-reset round-trip on `swimsync.sg`). A **real coach + 4 real
classes** are onboarded, alongside **7 real families and 9 real children** who
self-registered. `attendance`, `lesson_sessions` and `invoices` are **empty** — see §9.
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
> **As of 2026-07-25 production is fully caught up**: every migration through
> `20260725000800` is applied (`supabase migration list --linked` shows nothing pending),
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

## 8.16 (2026-07-27) — THE REPO ROOT HAS A SHAPE, AND THE AUTH ALLOW-LIST WAS BROKEN

Same conversation as §8.13, continued after the two sibling sessions merged. No product
code changed.

**The root went from 22 markdown files to 8** (`a6322e1`). Designs of record moved to
`docs/design/`, per-feature plans to `docs/plans/`, the historical artefact to
`docs/database/`. **Filenames did not change, only directories** — which is the whole
trick: all 379 prose references still name the right file, including **34 inside applied
migrations** that could never have been corrected. Nine git renames, so blame follows.
Zero markdown links pointed at a moved file with a path (checked before moving; every link
in the repo re-validated after).

**Numbered prefixes were considered and rejected** — the reasoning is in `README.md` →
*Where everything lives*, not repeated here. Short version: encoding a category into a
filename makes recategorising a rename, and a rename breaks references. `01_SESSION_WORKFLOW.md`
keeps its number because sorting first is its entire job.

> **A near-miss worth remembering.** The reorganisation was interrupted mid-flight and left
> twelve numbered copies behind. Four were **stale snapshots** — `11_HANDOVER.md` was
> missing **351 lines**, `02_AVAIL_SKILLS.md` was a week old — and two others went stale
> *during* the cleanup, because a sibling session pushed six commits while it was running.
> Finishing that rename by deleting the originals would have silently reverted two
> sessions of work. Every copy was diffed against **HEAD at the moment of deletion**, not
> against an earlier check. When `main` is moving, a verification is only true at the
> instant you make it.

**The auth redirect allow-list was wrong in two places** (`f845717`). `config.toml` was
missing the parent app's `https://swimsync.sg/reset-password`; production's dashboard list
was missing the **admin's**, so admin password reset had been silently landing on the wrong
page. Both fixed and reset tested end to end on both apps by the user. **§7.41 carries the
reasoning** — including the durable half, that production's list and `config.toml` are two
separate lists nothing keeps in step.

**Also filed:** `BACKLOG.md` → *`verify-attendance-window.mjs` guards nothing* — it scores
0/4 against any clock outside 16–17 Jul 2026, verified pre-existing on both sides of §8.15.

**Not done (deliberate):** the four living documents kept their names and their place at
the root — they are referenced 281 times and opened by name from `/session-start`; moving
them buys ordering nobody needs. And no skill scripts the merge (see §8.13(c)).

---

---

## 8.15 Fifteenth session (2026-07-27) — THE ATTENDANCE WINDOW IS A RULE — BUILT **AND DEPLOYED**

Branch **`debt/attendance-window-guard`** (worktree `SwimSync-attendance-window`), one
feature commit + two merges of `main` (it moved twice during the session). Planned with `/plan-with-confidence` +
`/plan-review`; the plan, its inlined risk mitigations and three accepted consequences
are in **`ATTENDANCE_WINDOW_PLAN.md`**.

**Deploy record (2026-07-27) — and I got the ordering wrong, which is the most useful
thing in this section.** The plan said **migrations → engine → apps**, and I pushed the
branch to `main` first. `main` *is* the app deploy: Vercel builds both sites from it. So
for the minutes between that push and `db push`, the live apps ran the new code against a
database with no triggers and an engine still at v16 — the exact inversion the plan calls
load-bearing. Harmless only because production has **0 attendance rows**; on a live month
it would have been the deadlock this work exists to remove.

> **The rule that would have prevented it:** `git push … :main` **IS** a deploy step, not
> a source-control step. Do the backend first, or push to `main` last. §7.27 says the
> ordering governs "the push, not just the migration command" — this is that sentence
> failing to be enough, twice.

What then went right, in order: backup (schema + data, scratchpad) → `db push` (one
migration; the `pg-delta` SSL trace printed again and succeeded, §8.11) →
`migration list --linked` shows **0 pending** → **remote grant dump**, which caught §7.39
live (below) → `functions deploy generate-invoices` → `functions list` confirms
**v17**, `package-emails` untouched at v1 → app bundle greps for `That lesson is closed`
(§7.51: a contiguous user-visible string, not an identifier) → production data
**byte-identical before and after**, attendance/sessions/invoices still 0.

**§7.39 fired again, and the audit is what caught it.** Three of the five new functions
carried only `REVOKE ALL … FROM PUBLIC`, and the remote dump showed cloud's project-level
default privileges had granted them to `anon`. **Nothing was exposed** — all three are
plain STABLE functions returning a date or raising; the one that is SECURITY DEFINER and
reads a table, and the one that writes, were both explicitly revoked and came back clean.
Fixed by `20260727000200`, and the audit now returns nothing. The lesson is not "anon had
a date function": it is that **a partially-applied recipe passes local `pg_proc` and only
the remote dump can tell you**.

**The backlog item was "reject a bad date in the save handler" (S). It grew, and the
reason is the whole session.** Planning found the same un-dated set behind the missing
guard also drove the **billing gate**, so the work was really two faces of one bug:

**(a) The window was a UI convention.** `(coach)/classes/[id]/attendance.tsx` wrote
whatever `date` the URL handed it. `sessions_write` constrains *whose* class a caller may
write, never *which* date — so a coach's own token against PostgREST could create, and
bill, a session on any date at all. Every *entry point* had been windowed since §8c; the
screen never was.

**(b) A child who joined mid-month blocked that month from billing.** The gate asked "who
is actively enrolled?" — one set for a whole month — and expected them at every lesson in
it. A child enrolled on the 20th was expected on the 6th and 13th, had no rows, and the
month reported `incomplete_attendance`, which blocks generation outright with **no
override** (§8a). Clearing it meant marking a child at a lesson they were not enrolled
for. **The user found this**, from the plan's own example: *"if Aisha joined in June and
the coach goes back to March, she should not be in his roster."*

**Fixing only the screen would have been WORSE than fixing neither** — the engine would
still have named a lesson the app correctly no longer offered any way to mark: a month
unbillable with no remedy in the product. That is §7.18's shape, and it is why the deploy
order below is not negotiable.

**What shipped**

- **Two DB triggers** (`20260727000100`), gated on `current_user = 'authenticated'`: a
  session must fall on the class's own weekday inside `[1st of last month, today]`; a
  **new** attendance row must fall in that window. Corrections are always allowed.
- **Enrolment is a SPAN** in `attendanceCompleteness.ts` (all three copies) and the
  engine — "who was expected" is answered per date.
- **The roster for a past lesson is the roster as it was then**, and a refused date shows
  a plain explanation instead of a roster that cannot be saved.
- **`schedule_extra_lesson()`** — the admin arranges a makeup (future dates allowed,
  reason required); the coach marks it. Surfaced on the coach's roster *and* backlog.
- **An admin control** on the Classes page. Still **no attendance-writing in the admin**.

**Four findings worth keeping**

- **§7.57 — a `BEFORE INSERT` trigger fires for rows that resolve to an UPDATE.** The
  coach's save is `.upsert()`. An "INSERT only" guard would have refused every
  credit-note correction, and failed the whole class's save on one row. Caught by
  `/plan-review` *before* the trigger was written, then confirmed with a probe table.
- **§7.58 — a stale RN-web screen can physically overlay the one you deep-linked to**, so
  `click({force:true})` presses the wrong element and the run reads as "the save is
  broken".
- **§7.59 — a global `COUNT(*)` baseline is role-dependent under RLS.** A pgTAP fixture
  counted as `postgres` and asserted as `authenticated`; the two count different rows.
- **A pre-existing §7.7 instance left alone**: `core.ts` derives `earliestEnrolment` with
  `String(...).slice(0,10)` — the UTC date. It only widens a window floor, and changing
  it would move every existing test's expectations. New span code uses `dateInTimeZone`.

**Verification.** pgTAP **366 → 397**, Deno **108 → 111**, admin vitest **122 → 162**
(includes the sibling worktree's suites), app jest **91 → 109**; both apps typecheck;
backend suites run twice (§7.15). **Every new test was proven to fail without the fix**
(§7.25): dropping the triggers fails **12 of 31** pgTAP assertions; the mid-month-joiner
test fails on the pre-fix engine; the new driver scores **6/12** on the pre-fix screen and
**14/14** after. A **tripwire** pins that a month with no joiners bills byte-identically,
and a **drift test** reads all three copies of `attendanceCompleteness.ts` off disk and
fails if they diverge — verified by deliberately diverging one. Rollback SQL was
**executed forward, back and forward again** locally.

### Not done (deliberate)

- ~~**Not deployed.**~~ **Superseded — it WAS deployed the same day**, and this bullet was
  left behind saying otherwise. See the deploy record above: `generate-invoices` is at
  **v17** and both apps are live. The ordering rule it carried (**migrations → ENGINE →
  apps**) is durable and now lives in **§7.60**, which is where to read it. Kept struck
  rather than deleted because it is the example §7.60 is about: the plan named the right
  order, the session did it wrong, and then the write-up asserted the opposite of what
  had happened.
- **The window floor stays a calendar proxy.** Chosen over "refuse only already-invoiced
  months". Its sharpest consequence is now filed: a month billed **two or more months
  late** with an unmarked lesson **cannot be unblocked by anyone** — `BACKLOG.md` →
  *Tie the attendance-marking window to un-invoiced months*, upgraded S→M with this as
  the trigger to revisit.
- **`sessionId` in the URL is still trusted** — filed in `BACKLOG.md`. Not a billing hole
  (the DB guard reads the session's own date), only a cosmetic mismatch.
- **A fully-departed class can now block a month it previously did not** — spans reinstate
  leavers for the dates they *were* enrolled. More correct, and it has a remedy: those
  same leavers appear on that date's roster, because spans drive both. **Check that
  remedy still works before changing either side.**
- **`verify-attendance-window.mjs` (the older driver) scores 0/4 — identically before and
  after this work.** Its fixture header assumes a clock of 16–17 Jul 2026. Pre-existing
  staleness, not a regression, but that driver currently guards nothing.

---

---

### 8.17 (2026-07-26) — THE DOCUMENTS BECAME AN INDEX

No product code changed. `HANDOVER.md` went **3,972 lines → ~460**, and the four documents
`/session-start` reads went from **~131,000 tokens to ~12,000**.

**Why, in one line:** every model tested degrades as context grows, and *stale* content
hurts more than irrelevant content — a topically-adjacent falsehood is the worst thing to
put next to the truth. This file had 29 session narratives, 16 struck-through gotchas, and
at least three claims that contradicted their own section.

**What was actually wrong, found by auditing all 29 entries against §6/§7/§11/PRD/BACKLOG:**

- **25 of 29 entries were fully redundant** — their durable content had already graduated
  to §7, a plan's §10, `BACKLOG.md` or the PRD. The graduation discipline worked; nothing
  was collecting the entries afterwards.
- **Four facts had never graduated** and would have been lost by a bulk delete. Promoted
  first: the prohibition on turning family/child status propagation into a trigger
  (**§7.61** — it breaks re-activation), the concurrent-session `git status` lesson
  (**§7.56**), and two deployment facts (**§11.5** an apex `A` record blocks an apex
  `CNAME`; **§11.6** destructive production work runs in the dashboard SQL editor because
  there is no local service key).
- **Three stale claims corrected.** §8.15 said "**Not deployed**" directly beneath its own
  deploy record. §11 said the engine was **v14**; it is **v17**. §8g described
  `assignment_status` as a three-value enum, but `20260719001300` dropped `inactive`.
- **§7.59 and §7.60 were out of numeric order** and are now ordered. Numbers unchanged.

**The rule that keeps it this way** is in `/update-docs`: promote first, then write the
entry; two entries stay in full, the rest are ledger lines.

**Not done (deliberate):**

- **The ledger is NOT capped by count, and FIFO was rejected as the primary rule.** The
  plan going in was 20 lines, then roll off to git. The reference audit killed it: §8
  entries are cited from **applied migrations and source code**, which can never be
  edited, so a rolled-off entry is a dangling pointer. Age was the wrong axis anyway —
  the orphans were scattered across all eras, and the *newest* entries were the most
  redundant. Graduation-at-write-time is the real control; the ledger is just cheap.
- **§3 was not trimmed** despite being the largest thing left (~4,400 tokens). It is the
  verified-state list, which is what a new session actually reads, and the PRD's build
  status is a spec-shaped duplicate rather than a substitute.
- **Nothing was archived to a `docs/sessions/` folder.** A fully-graduated entry has no
  unique content, so an archive file would be a farm of exactly the stale-but-adjacent
  text that motivated this. `git log` is the archive.

---

### Older sessions — the ledger

| # | Date | What shipped | Where its reasoning lives now |
|---|---|---|---|
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

### FIRST: the deploy is DONE — what is not done is real usage

§8.15 is on `main` and live: migrations, `generate-invoices` **v17**, both web apps.
Production has **0 attendance rows**, so neither the window guard nor the joiner fix has
been exercised on real data. Nothing about §8.15 is outstanding.

**One gotcha it created for whoever bills first**, now also in `INVOICE_RUNBOOK.md`: the
coach can only mark back to **the 1st of last month**, and the database enforces it. Bill
July in August and every lesson is markable; leave it to September and the gate will name
a gap **nobody can fill**. Bill promptly, or fix the floor (`BACKLOG.md` → *Tie the
attendance-marking window to un-invoiced months*).

### THEN: the thing that has blocked everything since 2026-07-13

**No real lesson has ever been taught and recorded, and no invoice has ever been
generated.** The mechanism is proven — the whole loop was walked on production 2026-07-25
and the evidence then removed by the 2026-07-26 cleanup, so `attendance` reads 0 for a
reason that is not "it has never worked". Don't re-derive that; §8.12 and the banned-phrase
note in §3 explain it.

1. **Get the coach marking a REAL lesson.** An onboarding push, not a build task. It is
   also the first exercise of §8.15's guard on real data.
2. **Then bill a real month**, following `INVOICE_RUNBOOK.md`. Expect the gate to refuse
   until every lesson is marked — working as designed. Mark them, or mark them cancelled;
   **never override**. Do it in the month after, not two months after (above).

Still true and worth knowing before that first run: `auto_invoice_enabled` is **false**,
**no coach rate is set** (so payroll computes nothing), and the join code is **`SWIM-RVM9`**
— the only route in for a new family, and the re-entry route for one marked inactive.

### ~~One narrow thing still unverified on production~~ — **CLOSED 2026-07-27, and it was broken**

Password reset is now **verified end to end on production for both apps** —
`https://swimsync.sg` and `https://admin.swimsync.sg`. Nothing here is outstanding.

**It was not merely unverified; it was broken.** The production dashboard's allow-list was
missing `https://admin.swimsync.sg/reset-password` entirely, so every admin password reset
had been silently landing on the wrong page — exactly the failure §7.41 describes, in the
place §7.41 suspected. The user found it, added it, and tested both apps. The full
reasoning now lives in **§7.41**, which is the right home for it; this section is a
pointer, not a second copy.

`supabase/config.toml` was missing `https://swimsync.sg/reset-password` too and has been
corrected — but note that **fixing the file does not fix production, and vice versa**
(§7.41).

### If you would rather build than onboard

**`BACKLOG.md` → `## Build order` is EMPTY** and has been since 2026-07-19. Pick from the
themed sections below it. Nearest candidates with no dependencies: **credit-note emails**
(the other half of the notification work), an **upcoming-lessons view for parents** (small,
and the building block already exists), or **convert a trial into an enrolled student**.

**Two hygiene items, neither urgent:** *revoke `anon` EXECUTE from the remaining SECURITY
DEFINER functions* (§7.39's missing second layer), and *a business cannot read its own audit
trail* — 13 of 19 writers never set `audit_log.tenant_id`, and the parent-claim work made
that column **half**-populated, which fails more quietly than empty did. Both are migrations,
so they queue behind each other; only one schema change should be in flight at a time (§7.55).

### Worth deciding, not urgent

**Whether to enable cron.** Both original blockers are long gone (timezone-correct billing
month, configurable run day) and the engine is per-tenant. Before switching it on: a blocked
month becomes a *silent stall* rather than a button that refuses, and the block-notification
email **has still never fired in production**.

**Dormant but live, so don't rediscover them as bugs:** prepaid packages (Admin → Packages),
business provisioning (Platform → New business — creating one is immediate and its join code
works straight away, and there is deliberately no delete button), trial bookings, and parent
claiming. Each does nothing until first used.
