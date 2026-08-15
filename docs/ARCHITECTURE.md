# SwimSync — Architecture, file map, and removed UI (§6, §10, §12)

_Split out of `HANDOVER.md` on 2026-07-26. Three stable references that change only when
the shape of the system changes:_

| Section | What it answers |
|---|---|
| **§6** | Why the system is built the way it is — the decisions and their reasoning |
| **§10** | Where things live on disk |
| **§12** | Which UI stubs were removed on purpose (**read before "re-adding" a button**) |

> **The section numbers here are load-bearing.** They are cited by bare number
> (`§7.41`, `§6`) from **781 places** across this repo — including inside **applied
> migrations** and Playwright drivers, where they can never be corrected. So: items keep
> their numbers forever. Append new ones at the end, never renumber, never reuse a retired
> number, and strike a dead item in place rather than deleting it.


> **Resolving a section number you see cited anywhere:**
> §3 → `HANDOVER.md` · §5 → `docs/TESTING.md` · §6 → `docs/ARCHITECTURE.md` ·
> §7 → `docs/GOTCHAS.md` · §8 → the **two most recent** sessions are in `HANDOVER.md`, every
> older one (including `§8a`, cited from `core.ts` and `20260727000100_…sql`) is one row in
> **`docs/SESSIONS.md`** — moved 2026-08-10, numbers unchanged · §9 → `HANDOVER.md` ·
> §10, §12 → `docs/ARCHITECTURE.md` · §11 → `docs/DEPLOYMENT.md`.
> A bare `§11.6`-style number inside a PRD sentence means the **PRD's** §11 (edge cases) —
> check which document the sentence is about before following it.

---

## 6. Architecture & key decisions

- **Backend = ordered CLI migrations** in `supabase/migrations/` (source of truth):
  `20260309000100`→`001000` (schema, auth trigger, credit-note trigger, RLS,
  storage, grants, session/audit, app_settings) plus `20260711000100_credit_applications`.
  Never edit the historical `Database_*` files.
- **Invoice engine split for testability:** `generate-invoices/core.ts` holds the
  billing logic (exported `generateInvoices(supabase, opts)`); `index.ts` is a thin
  Deno.serve handler (auth + client + call). Behaviour is identical either way.
- **Invoice emails live in `email.ts`, deliberately OUT of `core.ts`** (§8c). The engine
  stays pure and returns a typed `created[]`; `index.ts` calls `emailCreatedInvoices()`
  *after* generation commits, so a delivery failure can never touch billing. Sends go via
  the **Resend HTTP API** (not Auth SMTP), keyed by `RESEND_API_KEY`, and are a **logged
  no-op when the key is unset** — so local + tests never send. Don't move sending into the
  engine or make it able to throw into the generation path. **The Edge Function is deployed
  by `supabase functions deploy`, NOT by a git push** (Vercel only builds the two web apps).
- **One invoice per parent per month is built in TWO PHASES** (§8a): the class loop only
  *tallies* billable items into a cross-class map; invoice creation runs once per parent
  afterwards. Creating invoices inside the class loop is what under-billed multi-class
  families — the "already has an invoice" guard skipped them on their second class. **Don't
  move invoice creation back inside the loop.**
- **Unmarked attendance BLOCKS generation, with no override, in both modes** (§8a, PRD §7.7).
  This deliberately reverses the earlier "warn + Generate anyway". The justification for the
  bypass (a class that genuinely didn't run) is already served inside the completeness rule:
  mark it `cancelled_rain`/`cancelled_coach`. `force` no longer bypasses the gate — it only
  skips the sealed-month guard. **Don't add an override**; add a way to mark the lesson.
- **`close_student_enrolment()` is a SECURITY DEFINER RPC, not an RLS policy** (migration
  `20260718000200`). The operation must also write `students.assignment_status`, and
  `students_update` is (superadmin OR creator OR owning parent) — granting coaches UPDATE on
  `students` would let them edit names, DOBs and notes too, because **RLS is row-level, not
  column-level**. The function exposes exactly one operation, keeps its three writes
  together, and is audit-logged. It deliberately offers no INSERT (assignment stays
  superadmin, PRD §5.2) and no DELETE (history must survive, PRD §11.5; credit untouched,
  §11.8). Permission is interim: when coach type lands, a private coach keeps it and a
  school coach's admin takes it over.
- **The billing timezone/run-day seam is GLOBAL, not per-tenant** — `APP_TIMEZONE` and
  `app_settings.invoice_run_day`. Same reasoning as the timezone call (§8a), reaffirmed by
  the user for the run day: multi-tenant is a don't-paint-into-a-corner concern with zero
  users today. Promoting one integer to a per-tenant column later is trivial next to the
  RLS rewrite tenanting requires anyway.
- **Credit is pooled per PARENT** (`credit_notes.parent_id` + `parents.credit_balance`);
  a note's `student_id` is provenance only, so credit earned from one child is
  spendable against any child (invoices are one-per-parent-per-month).
- **`credit_applications` ledger** records every partial draw of a note against an
  invoice, so the note ledger reconciles with `invoices.credit_applied`. Invariants:
  `SUM(applications by invoice) = credit_applied`; `credit_balance = SUM(remaining across notes)`.
- **A PACKAGE IS MONEY AT A LOCKED RATE, AND ONLY THE ENGINE MOVES IT** (2026-07-20,
  PRD §7.16, `PACKAGES_DESIGN.md`). The rules that must not be re-derived wrongly:
  - **Dollars stored, lessons derived** (`balance ÷ rate` — exact because drawdown is
    locked-rate). Don't store a lesson counter; it has no answer when a lesson isn't the
    price you expected (HANDOVER of the age/DOB rule to money).
  - **Drawdown happens at INVOICE time, in `core.ts` phase 2** — never at marking time.
    Live displays derive via **`package_live_balances()`, the ONLY derivation of pending
    draws**; parent app + admin both call it. Do NOT reimplement "lessons left" in TS —
    a Deno test pins the RPC's prediction against the engine's settled result, and the
    grep gate is `grep -rn "value_remaining" SwimSyncApp/app SwimSyncAdmin/app`
    (stored-column display only; no arithmetic with attendance).
  - **Instance terms are snapshotted from the product BY THE DB at request time**
    (lifecycle trigger, NOT SECURITY DEFINER — §7.38); product money terms are immutable
    by trigger (a price change is retire + new product); balances are CHECK-bounded
    `0 ≤ value_remaining ≤ total_value` and client-immutable via the current_user seam.
  - **Corrections restore the package** (reversal rows in `package_applications`, at
    most once per line), never a cash credit note — prepaid value and refund liability
    are separate pots. The trigger is on its SEVENTH redefinition; start any edit from
    `grep -ln "handle_attendance_update" supabase/migrations/*.sql | tail -1`.
  - **Categories scope packages and are the class axis; tiers are products.** "No
    category = private coach" is FALSE — scope-less packages are just all-classes, and
    a tenant with no packages is simply ad hoc (coach type must not sneak back in).
  - **`package-emails`** is a separate Edge Function (verify_jwt ON, caller re-checked
    in-body), sharing the project-wide `RESEND_API_KEY`. Deployed separately, like
    everything under `supabase/functions/`.
- **ANYTHING PUBLIC (SESSIONLESS) IS SERVED BY AN EDGE FUNCTION, NEVER AN ANON RPC**
  (2026-08-02, `public-invoice`). The tempting alternative — `GRANT USAGE ON SCHEMA
  public TO anon` + one RPC — is a standing foot-gun: Supabase cloud's project-level
  default privileges grant EXECUTE on **every new public function** to `anon` (§7.39),
  so opening schema USAGE arms every function whose revoke is ever forgotten,
  forever. The house posture is *"anon gets nothing"* (20260309000800), and it held:
  an edge function with `verify_jwt = false` needs zero schema grants, rate-limits
  in-function, and its service-role reads go through an explicit serializer
  allowlist. Do not add the anon USAGE grant for a future public feature — add an
  edge function.
- **AN AUDIT ROW'S BUSINESS IS DERIVED FROM ITS ENTITY, BY A TRIGGER, AND THE CLIENT
  HAS NO SAY** (2026-08-04, `20260804000300`). `audit_log.tenant_id` is stamped
  `BEFORE INSERT` by `set_audit_log_tenant()` → `audit_log_tenant_of(entity_type,
  entity_id)`. Four things here are decisions, not implementation details:
  - **From the ENTITY, not the actor.** `current_tenant_id()` is right for a coach
    saving attendance and **wrong** for `join_tenant_by_code()` and
    `reassign_student_tenant()`, where the actor is a *parent with no tenant at all* and
    the row is about the tenancy being joined. Don't "simplify" this to the actor.
  - **An unknown `entity_type` RAISES.** A `CASE` falling through to NULL is the §7.37
    disease: the next entity type would write rows invisible to the business they
    describe and nothing would say so. If you add one, add its lookup — the error tells
    you where.
  - **A derivable value OVERWRITES what was supplied.** The INSERT policy only ever
    constrained `actor_id`, so a supplied `tenant_id` was always the client's word for
    it.
  - **A trigger, NOT 13 edited call sites.** Redefining `book_trial` or
    `add_unclaimed_student` purely to add a column is the §7.40 hazard. The trigger is
    atomic with the insert, covers the client writer, and is inherited by whatever
    writes next.
  Related: the INSERT policy was widened-by-default (`actor_id = auth.uid()` and nothing
  else) and is now the single real client case — a coach, on a session they own. Every
  other writer is `SECURITY DEFINER` and runs as the table owner, which policies do not
  reach (`audit_log` is owned by `postgres`, no FORCE ROW LEVEL SECURITY). **Nothing in
  the product reads `audit_log` yet** — this exists so that the first thing which does
  is not authoritative-and-wrong.
  - **The old rows WERE backfilled, against the backlog's own advice, and here is the
    check that made it safe.** The filed item said *"probably don't backfill — deriving
    from today's data invents history"*, citing the `invoice_items.student_name` refusal.
    The concrete way it could be wrong is narrow and nameable: a child who **changed
    businesses** since the event, whose old rows would then be attributed to the business
    they moved *to* — a small cross-tenant disclosure. Checked against the production
    dump before deploying: **zero `student_tenant_reassigned` rows, and one tenant**, so
    the failure could not have occurred, while leaving 81 of 103 rows permanently
    invisible had a certain cost. **If a second tenant ever exists and a child is moved,
    do not repeat this reasoning for a fresh backfill** — the trigger already stamps
    everything new, so there will never be a reason to.
- **A TRIGGER'S NAME IS PART OF ITS CONTRACT ON `parent_packages`, AND RENAMING IT IS AN
  OUTAGE** (2026-08-09, `20260809000100`). Postgres fires same-timing row triggers in
  **alphabetical order by trigger name**. `trg_parent_package_lifecycle` is what sets
  `NEW.tenant_id` from the product — the client never sends one, because *"the product
  decides the business and the terms"* (`20260720000100:268`). So
  `trg_parent_package_reference` is named to sort **after** it (`…_l` < `…_r`), and that
  name is the mitigation, not a convention.
  - **What a rename costs:** a reference trigger sorting first sees `tenant_id = NULL`,
    `next_package_ref` raises, and **every parent package request fails at the insert**.
    Verified by doing it: renamed to `trg_a_package_reference`, the parent's insert died
    with *"cannot number a package for unknown tenant"*.
  - **Three things defend it, deliberately at different layers**, because ordering is
    invisible in a schema dump: the name itself; a `RAISE` inside the function naming the
    expected order if `tenant_id` arrives NULL; and a `pg_trigger` assertion in
    `package_references.test.sql` that fails on a rename even if the runtime path ever
    becomes forgiving.
  - **The pgTAP case must insert AS THE PARENT with no `tenant_id`.** An admin-shaped
    insert supplies one and passes against the broken name, proving nothing — which is
    also why the admin path could historically mint a reference against a *different*
    tenant's counter than the row ends up in.
  - Generalises: any new `BEFORE INSERT` trigger on a table whose existing trigger
    *populates* a column you depend on has this constraint. Check `\d <table>` for
    siblings before choosing a name.
- **A BUSINESS IS CREATED BY ONE RPC, AND ONLY THE PLATFORM ADMIN MAY CALL IT**
  (2026-07-21, PRD §4.4, `TENANT_PROVISIONING_PLAN.md`). The rules that must not be
  re-derived wrongly:
  - **`provision_tenant()` is the only INSERT path into `tenants`.** The table has no
    INSERT grant and no `tenants_insert` policy, and it must stay that way — a tenant is
    the top of the isolation hierarchy, so a caller who can mint one has the largest blast
    radius in the schema. Audit:
    `grep -rn "tenants_insert\|GRANT INSERT.*tenants" supabase/migrations/` — no hits.
  - **The route calls it with the CALLER's token, never the service-role client.**
    `is_platform_admin()` resolves `auth.uid()`, which is NULL for `service_role`. Calling
    it as service role does not silently pass — it is refused — but it refuses for the
    wrong reason, and the pattern is one edit away from §7.8's "gate the only live caller
    bypasses". Service role is used only for the invite and the compensating delete.
  - **It RAISES rather than returning zero rows**, deliberately unlike
    `platform_tenant_overview()`. That one is a READ tool, where a 500 is
    indistinguishable from an outage; this is a WRITE, where a silent no-op reads as
    success.
  - **The tenant is created BEFORE its admin, and the route must compensate.** The auth
    trigger refuses to create a `tenant_admin` without a `tenant_id` rather than guessing,
    so the two writes cannot share a transaction. The intermediate state — a business that
    is live and **joinable** with no operator — is worse than either endpoint, so a failed
    invite deletes the tenant. `admin_status = 'none'` on the overview is the backstop for
    any that escape. **Don't "simplify" this by creating the auth user first**; it cannot
    be done.
  - **`is_coach` on the invite, NOT `tenants.kind`, decides whether a `coaches` row is
    made.** That is the private-coach-as-a-tenant-of-one shape. `kind` is copy and future
    pricing and must never reach an RLS policy or drive this checkbox — a school's owner
    may teach too.
  - **Exactly one admin per tenant**, because the role lives on `profiles.tenant_id`. That
    is a known limit with a named seam (`tenant_members`), not an invariant — see
    `BACKLOG.md`.
- **RLS** uses `SECURITY DEFINER` helpers (`is_superadmin()`, `current_parent_id()`,
  `current_coach_id()`, `coach_serves_parent()`) to avoid policy recursion — see
  `20260309000600_rls_policies.sql`. Plus `coach_serves_parent_profile()` (migration
  `20260712000100`), added because `profiles_select` otherwise hid served-parents' names
  from their own coach — the coach Billing screen needs them to label an invoice.
- **Tab navigation:** every tab folder in `(coach)/` and `(parent)/` has its own
  nested `_layout.tsx` (a `Stack`), so detail screens push within the tab instead of
  leaking as extra tab buttons. Add a nested `_layout` for any new tab section.
- **Cron** (`supabase/cloud/cron_schedule.sql`) is **cloud-only** (needs pg_cron/pg_net
  + project-ref + CRON_SECRET); kept out of local migrations.
- **Grants matter:** tables created by the `postgres` migration role don't auto-grant
  DML to `authenticated`/`service_role`; `20260309000800_grants.sql` does it (and sets
  default privileges that cover later tables).
- **There is no lesson-session generator, and that's deliberate** (PRD §7.5 is
  knowingly unimplemented). `lesson_sessions` rows are created **lazily** by the coach's
  attendance save — the only writer in the codebase. Sessions are keyed
  `UNIQUE (class_id, session_date)`, and the attendance screen is fully **date-driven**
  (takes any `date`, resolves-or-creates that date's session, pre-fills existing rows),
  so back-dating Just Works and nothing is ever overwritten. What was missing was not
  the rows but a **reckoning**: which lessons *should* have happened. That is derived at
  read time from `classes.day_of_week` (`lib/lessonDates.ts`) — see §8h. Don't "fix" this
  by pre-generating sessions unless you have a reason the read-time derivation can't
  serve; pre-generation adds a job, a schedule, and edge cases when classes change.
  - A class that legitimately didn't run needs **no new concept**: the coach marks
    everyone `cancelled_rain`/`cancelled_coach` (non-billable), which creates the
    session and drops the date out of the backlog permanently.
- **The marking floor follows `billing_periods`, not the calendar, and it is PER TENANT**
  (`markable_floor(tenant)`, `20260806000200`). It is `LEAST(1st of last month, the month
  after that business's latest sealed billing month, else its `created_at`)`. That
  function is **the single definition**; `session_window_start()` survives only as its
  calendar term. Anything that hardcodes "the 1st of last month" as the floor is wrong.
  - **Why it moved off the calendar.** The engine bills **any** completed month while the
    calendar floor reached back one, so billing August on 5 October with a single unmarked
    lesson made the gate name a lesson **nobody could record any more** — not the coach,
    not the admin — with no override by design (PRD §7.7). The month could then never be
    billed. While the window was a UI convention this was recoverable; `20260727000100`
    made it a database rule and removed the escape. Full history: that plan's §10.1.
  - **⚠ `LEAST` is the entire safety argument and must stay outermost.** It guarantees the
    floor can only move EARLIER than the old calendar rule, never later — so the change
    could not make any date unmarkable that was markable before it. `markable_floor.test.sql`
    asserts that as a **property over a matrix of tenant states**, not case by case,
    precisely so a `GREATEST` typo fails even when every named example still passes.
  - **Do NOT "simplify" it to "the earliest unsealed month",** which is what the backlog
    item specified and what anyone re-deriving this will reach for first. A month with
    nothing recorded is **never sealed** (§8a.1 — `core.ts` requires `classesComplete > 0`),
    so gaps in `billing_periods` are ordinary, and "earliest unsealed" reaches back past
    the business's first day and leaves no floor at all. Anchor on the **latest** seal.
  - **The client applies it as a MINIMUM, never directly** —
    `min(calendar, server ?? calendar)` in `backlogWindowStart()`. That makes an absent,
    null, unresolved or nonsense floor *mathematically incapable* of tightening the
    window, so screens do not have to sequence their loads correctly to stay safe and
    neither does any future caller. Don't replace it with the server value: refusing
    something the database would accept is a bug invented by the client, and this shape is
    what makes the failure impossible rather than merely unlikely.
  - Coaches cannot read `billing_periods` (its policy is platform- or tenant-admin only,
    and the coach app deliberately carries no invoice figures), so the client gets the
    floor from `markable_window_start()` — a no-arg SECURITY DEFINER RPC returning one
    DATE for the caller's own business. It must keep returning **only a date**.
- **`classes.is_active` means SCHEDULING, and `classes.deactivated_at` is why it can**
  (`20260809000300`). The engine scanned `.eq("is_active", true)`, so retiring a class at
  month end silently dropped its already-taught lessons *and* stopped it blocking — a hole
  exactly where someone is tidying up. The engine now bills every class in the tenant.
  - **The date is not decoration, and a boolean cannot replace it.** The same scan feeds
    the completeness gate, so widening it naively makes an inactive class expect a lesson
    on every weekly date and block the month for ever (**§7.109** — the class is invisible
    to every screen that could clear it). `deactivated_at` answers *"was this class running
    on the 13th?"*, which is the only question that separates a lesson still owed a mark
    from one that never existed. Lessons before it still block; dates after it are not
    expected.
  - **Inactive with a NULL `deactivated_at` means "expects nothing at all"**, not "expects
    everything". Those rows predate the RPC, so nothing is known about when they stopped —
    and that is both the conservative side of the deadlock and exactly how they behaved
    before, when the scan skipped them. Do not "fix" this by defaulting the column to
    `created_at` or to the month start.
    > **Since `20260810000100` that row CANNOT EXIST** —
    > `CHECK (is_active = true OR deactivated_at IS NOT NULL)`. The branch is kept in
    > `core.ts` anyway, because removing it leaves `new Date(String(null))` → Invalid Date
    > for anything that ever slips through, which fails silently; unreachable defence with a
    > loud alternative is worth two lines (contrast §7.110, where the unreachable arm's
    > failure mode was a loud throw and it was deleted). The constraint is also what makes
    > `deactivate_class()` the ONLY way to retire a class: `classes_write` is `FOR ALL TO
    > authenticated` and `20260804000600` grants UPDATE, so a raw PostgREST write could
    > otherwise skip all three refusals (§7.32 — the screen was the only limit).
- **A BOOKING IS EXPLICIT EVIDENCE, AND THE ENGINE MUST NEVER CLAMP ONE** (`20260810000100`,
  `core.ts`). `expectedDates` is a *guess* the engine derives from a weekday, so it is
  clamped by `lastScheduledDate`. A `trial_bookings` / `makeup_bookings` row is a statement
  that a **named child was expected at a named lesson**, made by an admin through an RPC; it
  cannot be spuriously generated, so it needs no bound and must always reach the
  completeness gate.
  - **Why this is written down rather than left to taste:** a clamp was drafted, and it
    would have re-created the exact underbill the change existed to close — dropping every
    booking date for any class with a null `lastScheduledDate` and sealing over the guest.
  - **The prohibition is structural, not advisory.** The CHECK constraint above means no row
    with a null `lastScheduledDate` exists, so a future clamp has nothing to clamp *and* no
    reachable state to justify itself with. If anyone re-adds one, they must first record a
    product path that can create the state it defends against.
  - The two `continue` guards at the top of the per-class loop each carry the third term
    `!bookingsByDate.size` for the same reason. **Do not instead widen
    `billableStudentIds`** — four consumers read that set, and widening it is safe only by
    coincidence of the item loop iterating `parentStudents`.
  - **`SwimSyncAdmin/lib/classCoverage.ts` is the same rule, second copy** (§7.18). It had
    this right before the engine did, which is why the admin's Generate dialog *named* a
    guest-only class's missing lesson while the engine skipped it. They still differ in the
    other direction — `classCoverage` does not union session dates — filed in `BACKLOG.md`.
  - **`reactivate_class()` must never grow a refusal.** It is the only exit from a class
    that is blocking a month while being invisible everywhere else; anything that can
    refuse it can strand a business. Its counterpart `deactivate_class()` carries three
    refusals and none of them takes an override — the enrolment one reads the enrolment
    **span**, never `is_active` (§7.66).
  - **The admin Classes page is the only screen that shows an inactive class.** The coach
    class list and the coach Schedule tab both still filter `is_active`, deliberately — a
    retired class is not on anyone's schedule. That makes the *Show retired* toggle
    load-bearing rather than cosmetic; it must not be removed without giving the exit
    somewhere else to live.
  - **Known hole, filed not fixed** (`BACKLOG.md`): `core.ts`'s two `continue` guards
    ignore `bookingsByDate`, so an unmarked booking in a class with **no active enrolments**
    is neither billed nor blocking, and the month seals over it. Pre-existing and unchanged
    by this work, but every retired class now sits in that state by construction. Measured
    zero on production 2026-08-09.

  - **Completeness rule — now ONE definition** (`lib/attendanceCompleteness.ts`, extracted
    2026-07-18). A lesson counts as marked only when its session exists **and every
    actively-enrolled student has an attendance row on it**, and **a lesson with no session
    row at all is UNMARKED, not absent** — sessions are created lazily, so "no row" is
    exactly what a forgotten lesson looks like. Used by
    `SwimSyncAdmin/lib/classCoverage.ts`, `(coach)/schedule/index.tsx` and
    `(coach)/classes/[id]/roster.tsx`. **Duplicated byte-identical in both apps** (same
    arrangement as `lessonDates.ts`), and the engine keeps its own Deno copy — so it is
    **three edits, not one**. Callers still own their own *window* (billing month vs coach
    backlog); only the meaning of "marked" is shared.
    - **They had already diverged, and it was a live underbill — see §7.17.**
    - **Drift is now enforced, not remembered**: `attendanceCompleteness.drift.test.ts`
      (admin vitest) reads all three copies off disk and fails if they differ. Verified
      by deliberately diverging one — a guard nobody has proved will fail is decoration.

- **WHO WAS EXPECTED AT A LESSON IS A QUESTION ABOUT THAT LESSON'S DATE** (2026-07-27,
  PRD §7.5/§7.6, `ATTENDANCE_WINDOW_PLAN.md`). `expectedStudentsOn()` takes enrolment
  **spans** (`{studentId, from, until}`, both ends inclusive), never a list of currently-
  active ids. `is_active` describes **today**, and a past lesson is not today.
  - **The inclusive end is load-bearing**: a trial walk-in's enrolment opens and closes on
    its own date, so an exclusive end would expect them at no lesson at all.
  - **Do NOT convert `billableStudentIds` or `deferrableParentIds` to spans**
    (`core.ts`). Those answer a different question — §7.13: *who gets billed* follows
    attendance rows, *who must be marked* follows enrolment. Collapsing them is the live
    underbill where one tap of "remove from class" cost a month's revenue.
  - **The screens must agree with the engine or the product deadlocks.** If the coach's
    roster hides a child the engine still expects, the month names a lesson with no way
    to mark it. Change all three copies and the engine together, or neither.

- **THE MARKING WINDOW IS ENFORCED IN THE DATABASE, AND THE SEAM IS `current_user`**
  (2026-07-27, `20260727000100`). RLS constrains *whose* class a caller may write, never
  *which* date, so the app was never a boundary here.
  - **Scoped to `authenticated` on purpose.** Fixtures are not clients — their job is to
    construct the past the rule is about (an invoiced March, a sealed month). An absolute
    rule would force every pgTAP fixture to date itself against the wall clock, which is
    §7.33's trap and already cost this repo eight hours a day of red suite (§8.12).
  - **The rule lives in `assert_markable_date()` / `assert_class_runs_on()`, not inline
    in the triggers**, because §7.42 means a future SECURITY DEFINER writer inherits the
    exemption silently — it must be able to call the same two functions.
  - **Corrections are always allowed; only NEW charges are bounded.** See §7.57 for why
    that distinction cannot be made by the trigger event alone.
  - **`schedule_extra_lesson()` is the ONLY way past the weekday rule**, and it is the
    second writer of `lesson_sessions` — so §7.43's rule is live again: date as a
    **parameter**, never `now()`, and `ON CONFLICT DO NOTHING`, because a duplicate
    `(class_id, session_date)` double-bills a whole class (§7.7).
- **A PRIVATE COACH IS A TENANT OF ONE — never branch on "coach type".** They hold
  `tenant_admin` *and* a `coaches` row. This is why coach type is not an authorization
  concept anywhere, why wages needed no private-vs-school check, and why the app must
  route on **which extension rows exist**, not on the role enum (undoing that is what
  locked the real coach out — §7.19). `tenants.kind` exists for copy and future pricing
  and **must never appear in an RLS policy**. Full reasoning: `TENANCY_DESIGN.md` §1.
- **The tenant boundary: parents GLOBAL, students TENANTED.** A parent may deal with
  several businesses (the common case, per the user), so `parents` has no `tenant_id`;
  a tenant reaches a parent through their children's enrolments (`tenant_serves_parent()`).
  `students.tenant_id` is a real NOT NULL column and **must not** be re-derived from
  enrolment — an unassigned child has no enrolment, and "Remove from class" deliberately
  keeps a child in the business while removing them from the class.
- **Credit NEVER crosses tenants** (`parent_tenant_balances`), though it pools freely
  within one. This **reverses** the earlier "credit is pooled per parent" decision, with
  the user's explicit go-ahead: pooling was right for one business and wrong for two.
- **The billing engine runs as `service_role` and BYPASSES RLS.** Tenant isolation in
  billing is enforced by explicit `tenant_id` filters in `core.ts` — the 37 policies do
  not protect that path at all. If you add a query there, scope it. Audit:
  `grep -n "tenantId" supabase/functions/generate-invoices/core.ts`.
- **RLS policies must not reach across tables with a bare `EXISTS`** — that subquery runs
  under RLS too, and scoping `classes` by tenant made `classes_select` ↔ `enrolments_select`
  mutually recursive. Use a `SECURITY DEFINER` lookup (`class_tenant()`, `session_tenant()`,
  `parent_has_child_in_class()`). Note this could not happen while `classes_select` was
  `USING (TRUE)`: **the leak was also what kept the policy graph acyclic.**
- **ACTIVITY AND ASSIGNMENT ARE SEPARATE AXES, AND ACTIVITY IS PER BUSINESS.**
  `students.is_active` / `parent_tenants.is_active` answer "still a customer of THIS
  business?"; `assignment_status` (`unassigned | assigned`) answers "in a class?". A new
  signup is **active but unassigned** — collapsing them is what made "inactive" ambiguous,
  and the enum no longer carries an `inactive` value. Activity lives on `parent_tenants`
  because parents are global: a global flag would let one business switch a family off at
  another. Full spec: PRD §7.14.
  - **The family flip is a CONSEQUENCE, not an invariant, and MUST NOT become a trigger.**
    Deactivating a child asks about siblings; a family with no active children left going
    inactive follows from that and is stated, not asked. A trigger enforcing
    `no active children ⇔ family inactive` **breaks join-code reactivation**, because a
    returning family has zero active children by design and would be flipped straight
    back. Propagation is one-way and event-shaped, in `set_students_active()`.
  - **`set_students_active()` is the sole writer** of both flags, and takes an ARRAY so the
    set the admin confirmed in the prompt is the set that gets written. `parent_tenants`
    has **no UPDATE policy**, so RLS already forbids every other path.
- **A FACT ABOUT A PAST LESSON IS NEVER A LIVE LOOKUP.** This now covers the student's
  NAME as well: `invoice_items.student_name` and `credit_notes.student_name` record the
  name the document was ISSUED with (2026-07-19). Five screens previously joined it live,
  so a rename rewrote invoices already sent and credit notes PRD §7.8 calls immutable.
  Pre-snapshot rows are NULL rather than back-filled — inventing a historical name from
  today's value is a guess presented as a record. What a lesson cost and who was
  paid for it come from `class_rates` via `class_rate_on(class, session_date)` — the terms
  in force on the lesson's **own date** (`20260719000700`). Reading `classes.price_per_lesson`
  or `classes.coach_id` at generation/payroll time is the bug this removed, three times over
  (§8). `classes.price_per_lesson` survives only as a **trigger-synced display copy** and
  carries a `COMMENT` saying so. Audit:
  `grep -rn "price_per_lesson" supabase/functions SwimSyncAdmin SwimSyncApp` — every money
  path must go through `class_rate_on`.
  - **`classes.coach_id` stays where it is and means "who teaches this NOW".** It drives
    **RLS** (`coach_owns_class`, `coach_owns_session`, `coach_serves_student`,
    `coach_serves_parent`). Access follows the current coach; money follows history. Do not
    "finish the job" by moving it into `class_rates` — that trades a billing fix for a
    rewrite of the largest permission surface in the codebase.
  - **A missing rate is a HARD FAILURE in both engines**, never a fallback to 0 or to
    `classes.price_per_lesson`. Every class is guaranteed floor-dated terms
    (`'2000-01-01'`, *not* `created_at` — attendance is markable a month back, so a lesson
    legitimately predates the row that created its class).
- **An adjustment is carried ONCE, via a running total**, not "emit once then suppress":
  `owed_now − paid_originally − already_carried` (`20260719000900`). Suppression looks
  equivalent and silently swallows a *second* genuine correction to the same lesson.
- **Wage rates are EFFECTIVE-DATED and only ever INSERTED.** A lesson is priced at the rate
  in force *on the day it was taught*, so no number of raises can reprice history. Editing
  a rate in place would change what a coach was owed in March because of a June decision —
  the same family as the UTC billing-month bug. Backdating a rate *does* produce back pay,
  deliberately.
- **Expand / contract, and the deploy order flips with the direction.** Adding? Migrate
  first (the new UI queries the new tables). Dropping? Deploy the app first (the live app
  still reads the old columns). A `git push` deploys both web apps via Vercel; migrations
  are a separate manual `supabase db push`, so they can never land atomically.
- **Dates are Singapore-local; never derive a date string from `toISOString()`.** That
  yields the **UTC** date, which is the *previous day* in SGT (UTC+8) before 08:00 —
  this shipped a real double-billing bug (§7.7). Use `todayInSg()` / `toSgDate()` from
  `lib/lessonDates.ts`, and derive a weekday from that same string via `dayOfWeekOf()`
  rather than a separate `new Date().getDay()`. Full ISO **instants** (`paid_at`,
  `updated_at`) are fine as-is — only date-*string* derivations are affected. The same
  rule now covers the **invoice engine's default billing month**: it is derived in the app
  timezone via `generate-invoices/dates.ts` (`previousBillingMonth()`), **not** `new
  Date()`'s local/UTC fields — see §8a and gotcha §7.12. The timezone is a single seam
  (`APP_TIMEZONE`, default `Asia/Singapore`), **deliberately not per-tenant** — one
  configured zone is enough while all usage is SGT, and true multi-timezone folds into the
  tenanting work when that lands.
- **`lib/lessonDates.ts` is duplicated byte-identical in both apps** — deliberate. There
  is no shared package: separate npm projects, no workspaces, different React majors,
  different bundlers/test runners. Sharing ~120 lines of pure date maths would need
  workspace + Metro `watchFolders` + `transpilePackages` surgery. The file has **zero
  imports** so drift is cheap to spot (`diff` the two); each has its own test file
  (identical but for jest-globals vs a vitest import). **Edit both.**
- **A LEVEL IS THE BUSINESS'S OWN VOCABULARY, AND IT IS NEVER PARENT-SET.**
  `swimming_ability` (the fixed beginner/intermediate/advanced enum) is **gone** —
  dropped 2026-07-19 after being always-NULL since parents stopped self-reporting
  ability. Levels now live in `tenant_levels` (per business, explicitly ordered) with
  `students.level_id`, and each rung carries an ordered `tenant_level_skills` list.
  - **Don't re-add a parent-facing level picker.** Parents self-reporting ability was
    removed on purpose; a level is the coach's judgement (PRD §5.1).
  - **Skills are ROWS, not a text blob** — a curriculum is a list, and prose cannot be
    counted, ordered, or ever ticked off. This is the whole reason per-child progress
    tracking (backlogged) will not need a migration out of a description field.
  - **The ladder is FLAT and generic on purpose.** Tiers, milestone markers and
    progression graphs ("T4 → B3") are **deliberately not modelled**: businesses
    structure levels differently, so modelling one school's shape forces every other
    tenant into it. A school with 16 rungs across 5 tiers names them that way and orders
    them; `tenant_levels.note` carries any progression rule in their own words.
  - **The admin sets a student's level; coaches have no write path to `students`** —
    granting them `UPDATE` would also expose names, DOBs and notes, because RLS is
    row-level, not column-level. Coach-set levels would be an RPC, not a policy change.

- **A CHILD IS IDENTIFIED BY NAME + DATE OF BIRTH, and age is DERIVED.**
  `students_identity_uniq` is an **expression index** on
  `(tenant_id, lower(trim(full_name)), date_of_birth)` — a plain index is defeated by a
  trailing space or a capital, which is the appearance of a constraint without the
  substance. NULL DOB never collides, which is what made it safe to apply to live data
  with no backfill.
  - **`students.age` is dropped and must not come back.** A stored integer beside the
    date it derives from goes stale the day after it is written — the same disease
    `class_rates` removed from money. Use `ageFromDob()` in `lessonDates.ts` (**both
    apps**), which returns `null`, never `0`.
  - **NRIC was considered and declined.** Partial NRIC is still personal data under PDPC
    guidance and its collection is restricted, so it needs a standing justification and
    would put regulated data on every coach's roster. DOB was already collected. Don't
    reintroduce it without that reasoning changing.

- **THE TENANT BOUNDARY ON `students` IS A TRIGGER, NOT A POLICY — AND NOT COLUMN GRANTS.**
  `students_update`'s `WITH CHECK` cannot see the OLD row, so it cannot say "this column
  did not change"; a parent could therefore move their own child to another business and
  still satisfy it (fixed 2026-07-19, verified exploitable first). `pin_student_tenant()`
  pins `tenant_id` and `created_by`; `pin_parent_identity()` does the same for
  `parents.profile_id`.
  - **Column grants were rejected deliberately.** `REVOKE UPDATE` + `GRANT UPDATE (cols)`
    is equally airtight but enumerates columns, so every column added later is silently
    read-only until someone extends the grant — a trap that would have fired on the very
    next migration.
  - The seam is **`current_user`, not `auth.uid()`**: the legitimate writers are
    `SECURITY DEFINER` owned by `postgres`, so client DML is distinguishable by the role
    it arrives as. Any new SECURITY DEFINER writer inherits the exemption automatically.

- **Business OWNERSHIP is data, not a role — `tenants.owner_profile_id` — and the choice
  was deliberate (2026-08-06, §8.31).** Owner and co-admins share the one `tenant_admin`
  role; the hierarchy platform admin → owner → co-admin → coach/parent is carried by that
  column, not by the enum. Considered and rejected: a `tenant_superadmin` enum value —
  permanent once added (enum values are retired by data, never DDL), hardcoded-string
  audits across ~25 files, and structurally unable to enforce one-owner-per-tenant; and
  the `tenant_members` join table once sketched in `BACKLOG.md` — buys nothing while all
  admins hold identical authorization, and stays available additively if permissions ever
  split. Consequences a future session must not undo:
  - **The first `tenant_admin` of a tenant claims ownership inside `handle_new_user`**
    (guarded `owner_profile_id IS NULL`), which is why provisioning needed no change.
    `handle_new_user` must STAY `SECURITY DEFINER` — that is the only reason its claim
    UPDATE passes the `tenants` guard trigger.
  - **Deactivation is one clause in one function**: `admin_disabled_at IS NULL` inside
    `is_tenant_admin()`, so every admin policy inherits it. Coach access survives because
    it derives from the `coaches` row (`current_coach_id()`), not the role — the same
    fact that makes the private coach work. Membership reads keyed on
    `current_tenant_id()` are deliberately NOT cut (the coach app needs them); the auth
    ban on pure admins is what ends those, within one token lifetime.
  - **The guard triggers on `profiles` (role/tenant_id/admin_disabled_at) and `tenants`
    (owner_profile_id) are INVOKER functions on purpose** — a SECURITY DEFINER guard
    checks `postgres`, not the caller (§7.38) — and they exist because `profiles_update`
    lets any tenant admin update any tenant profile, which with two admins is an
    escalation path.
  - **There is no owner-transfer path** — refused at the trigger. Adding one is a
    `BACKLOG.md` item, not a quick UPDATE.

- **The mark renders two different ways on purpose, and is absent from the invoice email
  on purpose.** `SwimSyncAdmin/components/Logo.tsx` inlines the SVG paths (recolourable via
  `currentColor`, no request); `SwimSyncApp/components/Logo.tsx` uses a white-knockout
  **PNG** at @1x/@2x/@3x with `tintColor`, because the app has **no `react-native-svg`** and
  adding a native module to a project that has not cut a native build is a risk branding
  does not justify. The geometry therefore lives in two places — `brand/mark.svg` (source of
  truth) and the admin component — the same duplicate-and-document arrangement used for
  `lessonDates.ts`, and `brand/README.md` says so. **Don't add the mark to the invoice email
  header**: that slot belongs to the *tenant's* logo (PRD §7.10).

---

---

## 10. File map

| Path | What |
|------|------|
| `docs/WORKTREES.md` | **How to run two sessions in parallel without clashing** — one writer per shared resource, six phases, two worked examples (with and without a migration) |
| `.claude/skills/worktree-start/` · `worktree-close/` | The skills that run that protocol. Start goes **after** planning; close goes **before** `/update-docs` |
| `.claude/skills/run-ui-playwright/drivers/check-teardowns.sh` | CI guard: every `fixtures-*.sql` must have a `-teardown.sql`. Run it locally too |
| `.claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh` | CI guard: every fixture LOADS (`ON_ERROR_STOP=1`), owns only its own rows, and its teardown restores every row count. Two passes — isolated, then stacked. Found three broken fixtures the first time it ran |
| `docs/design/TENANCY_DESIGN.md` | **The multi-tenancy design of record.** 10 settled decisions (§10). Read before changing anything tenant-shaped |
| `docs/plans/TENANCY_PLAN.md` | The 6-phase build, its risks, and the definition of done |
| `supabase/migrations/20260718000400…20260719000600` | The tenancy migrations: roles, tenants, backfill, RLS rewrite, billing constraints, join codes, wages, contract |
| `supabase/tests/tenant_isolation.test.sql` | Cross-tenant isolation — two full tenants proving they cannot see each other |
| `supabase/tests/coach_wages.test.sql` | The pay-decision table, pro-rata, effective dating, draft→freeze, adjustments |
| `SwimSyncApp/lib/landing.ts` | Where a signed-in user lands. Routes on **extension rows**, not the role enum (§7.19) |
| `SwimSyncApp/lib/attendanceCompleteness.ts` | The completeness rule, shared. **Twin in SwimSyncAdmin; a third copy in the Deno engine — three edits** |
| `SwimSyncApp/lib/coachRoster.ts` | Pure role resolution for a lesson: am I the main, a shadow, or covered? No I/O. ⚠ Its input order is a safety rule, not a style — §7.146 |
| `SwimSyncApp/lib/sessionMainCoach.ts` | The `SECURITY DEFINER` probe behind §7.134 — a coach cannot *see* the roster row that replaced them, so this asks the database. **Fails towards "I am the main coach"**, so a probe outage leaves the coach able to mark rather than silently locked out |
| `SwimSyncApp/lib/payoutBreakdown.ts` | Splits a payout into lessons taught vs corrections to earlier months |
| `SwimSyncAdmin/lib/sessionRoster.ts` | The Lesson Coaches page's model — the **access** axis, so it uses `classes.coach_id`. **Substitutes only** since 2026-08-12 |
| `SwimSyncAdmin/lib/payoutItems.ts` | The Coach Wages breakdown — the **money** axis, and it never mentions `classes.coach_id`. **The pair above disagree deliberately**: access follows the current coach, money follows history (`20260719000800`) |
| `SwimSyncAdmin/lib/lessonAttribution.ts` | Who was **paid** for a lesson, for the Attendance audit page — the **money** axis (`class_rate_on().paid_coach_id`), mirroring `coach_attribution_kind()` (substitute → terms → shadow). Reads `classes.coach_id` nowhere (§7.152). `resolveShadows()` is the **one** home for the client shadow arm — `wages/page.tsx` calls it too, so there is no second copy |
| `SwimSyncAdmin/lib/claimNaming.ts` | The two naming decisions on the claim-approval screen, pure: the certainty-dependent picker default (parent's name for `confirmed`, current for `unsure`) and the post-approve message (a rename failure reads "linked, name not applied", never an approval failure). Backend primitive is `rename_student()` (`20260814000100`); §7.154 |
| `docs/plans/TRIAL_ONBOARDING_PLAN.md` | A child before their parent: the plan, its ranked risks inlined as mitigations, and the pre-commit gate. **Read before merging §8.10** |
| `docs/plans/PARENT_CLAIM_PLAN.md` | **The parent-claiming design of record** — the settled decisions (including the two the user reversed mid-planning), seven ranked risks with mitigations inlined beside the step each governs, and the pre-commit gate. Read before changing matching, the claim queue, or `merge_students()` |
| `SwimSyncApp/lib/attendanceRoster.ts` | Who appears on Mark Attendance: enrolled **∪** already-marked-on-this-session. Why a closed trial enrolment doesn't hide the child it marked |
| `docs/plans/ATTENDANCE_WINDOW_PLAN.md` | **The marking-window design of record** — the settled decisions, ranked risks with mitigations inlined beside the step each governs, the pre-commit gate, and **§10: three consequences accepted deliberately**. Read before changing the window, the completeness rule, or `schedule_extra_lesson()` |
| `supabase/migrations/20260727000100_attendance_window_guard.sql` | The window as a rule: two `current_user`-seamed triggers, the four functions that hold it in one place, `off_schedule_reason`, and `schedule_extra_lesson()` |
| `supabase/rollback/20260727_attendance_window_DOWN.sql` | Two DROP TRIGGERs and nothing clever — the guard is pure validation, so dropping them restores the old behaviour whatever the app is doing |
| `SwimSyncApp/lib/attendanceWindow.ts` | The client's copy of the window rule. **An affordance, not the guard** — the database is the rule; this exists so a coach sees English instead of a Postgres error |
| `SwimSyncApp/lib/attendanceSession.ts` | A session id is never a bare string — it is **bound to the date it was resolved for**. Anything else is `stale` and the save re-resolves from `(class_id, date)`. Second layer behind the marking screen's effect deps (§7.64) |
| `SwimSyncApp/lib/attendancePayload.ts` | Builds the attendance upsert body. **Every row carries an identical key set**, because supabase-js derives `columns=` from the union of keys and PostgREST sends `NULL` — not the column default — for a key a row omits (§7.67) |
| `SwimSyncApp/lib/attendanceSummary.ts` | What a coach's list SAYS about a lesson: the five states, the status breakdown, and the wording. **The display layer's answer, deliberately not the billing gate's** — an empty roster is `no-students` here and vacuously *complete* to `attendanceCompleteness.ts`, and that asymmetry is load-bearing for invoicing (§7.68) |
| `SwimSyncApp/lib/weekOrder.ts` | Groups the coach's classes by weekday with **today first**. The weekday is a **parameter**, never read from a clock inside — the same shape `timeOfDay.ts` forced after §7.7. Also pins `WEEK_ORDER` to the Postgres `day_of_week` enum's declaration order, which is why `.order("day_of_week")` sorts in week order rather than alphabetically. An unrecognised weekday is **kept and sorted last, never dropped** — losing a class silently is worse than showing it oddly |
| `SwimSyncApp/lib/invoiceLabel.ts` | The single answer to "what is this invoice called" for the parent app — the `INV-YYYY-NNNN` reference, falling back to the legacy UUID fragment only for rows that predate the trigger. Shared by the invoice list and the detail so the two cannot drift; before it, both printed a UUID fragment while the QR, the reminder and the bank statement said something else (PRD §7.21) |
| `supabase/migrations/20260809000100_package_references.sql` | `PKG-YYYY-NNNN` on `parent_packages`: counter, `next_package_ref`, the assignment trigger **named to sort after the lifecycle trigger** (see §6), and the pin. The header is the design record — read it before renaming anything on that table |
| `supabase/rollback/20260809_package_references_DOWN.sql` | Purely additive migration, so purely DROPs — but running it **destroys every minted reference**, and re-applying renumbers from 1. Export `reference_number` first if any package payment has been collected |
| `.claude/skills/run-ui-playwright/drivers/verify-paynow-fallback.mjs` | The only coverage anywhere for `app/(coach)/settings`. Drives all three PayNow states, including the **stored-but-unencodable** proxy that decides whether the fallback upload may ever be conditionally hidden (it may not). Restores the seed tenant's PayNow columns in a `finally` |
| `SwimSyncApp/lib/useCoachHasPayouts.ts` | Whether the **My Pay** tab exists. ⚠ Runs in the coach ROOT layout, so its blast radius is the whole coach app — every failure path resolves to `false` and it **never gates render**. Keyed to the session because the layout mounts during the post-login redirect, and an anonymous read would otherwise pin "no payouts" for the whole session. Uses `coach_payouts` and **not** a rate: `coach_rates` is admin-only RLS, so a coach cannot read their own rate at all |
| `SwimSyncApp/lib/timeOfDay.ts` | Time of day in Singapore. Coach-only, **not** in the `lessonDates.ts` twins. Only `nowMinutesInSg()` knows about timezones; everything comparing times takes a plain number, so it **cannot** read a clock and therefore cannot read the wrong one (§7.7) |
| `SwimSyncAdmin/lib/tableSort.ts` | One comparison rule for all 22 admin tables. Blanks last in **both** directions, numeric-aware, weekdays in week order, stable, and ISO dates compared as text so nothing constructs a `Date` (§7.7-proof by construction) |
| `SwimSyncAdmin/components/Table.tsx` | Now the shared **sorting primitive**, not just markup — carries `useTableSort` and the column-width mechanism. `<Thead>` owns its own `<tr>`, pinned by a call-site scan |
| `SwimSyncAdmin/lib/studentCounts.ts` | The wording for every "N students" surface. Counts `students.is_active` only, never the family's `parent_tenants.is_active` — §7.61 leaves those deliberately unreconciled. `describeLevelRemoval` is a **destructive-action guard, not a display string** (§7.69) — the Levels removal warning deliberately does NOT use the active-only count: `level_id` is `ON DELETE SET NULL`, so it must speak about every student pointing at the rung, active or not |
| `.claude/skills/run-ui-playwright/drivers/verify-attendance-guard.mjs` | Drives the window across both UIs — the roster-as-it-was-then case, both refusals, the admin's extra lesson, and the save/correct round-trip that §7.57 governs. Carries `pressByText()` for §7.58 |
| `supabase/migrations/20260725000100…000300` | `student_settlements`, `add_unclaimed_student()`, `link_invited_parent()` |
| `SwimSyncAdmin/lib/classRoster.ts` | Who is in a class: active enrolments + **upcoming** trials, and the `2+1` count. **Takes `today` as a required parameter and touches no clock** — §7.7 made unreachable rather than discouraged |
| `SwimSyncAdmin/components/Drawer.tsx` | Right-hand slide-over. Deliberately the same prop shape as `Modal.tsx` and no richer |
| `SwimSyncAdmin/components/Table.test.tsx` | **The `<Thead>` call-site contract, enforced.** Scans every `app/(admin)/**/page.tsx` and fails if one wraps its `<Th>`s in a `<Tr>`. Walks the tree at test time, so pages that don't exist yet are covered. §7.54 |
| `SwimSyncAdmin/app/(admin)/wages/page.tsx` | Coach payroll: rates, policy, run, mark paid |
| `SwimSyncAdmin/app/(admin)/platform/page.tsx` | Platform admin: every business + the student rescue tool |
| `supabase/migrations/` | Schema, RLS, triggers, grants (ordered, source of truth) |
| `…/20260309000500_credit_note_trigger.sql` | Auto-issues a credit note on billable→non-billable edit of an invoiced lesson |
| `…/20260711000100_credit_applications.sql` | Credit-note allocation ledger (fixes partial-application drift) |
| `supabase/functions/generate-invoices/core.ts` | Billing engine logic (exported, tested) |
| `supabase/functions/generate-invoices/index.ts` | Thin HTTP handler (auth + client + call core) |
| `supabase/functions/generate-invoices/email.ts` | Invoice-email builders + Resend sender + `emailCreatedInvoices()` orchestration (§8c) |
| `supabase/functions/public-package/` | The tokenised renewal-offer pay page's data source (core.ts + index.ts), the package mirror of `public-invoice`; `verify_jwt=false`, the 128-bit `public_token` is the access control. Refuses a SUSPENDED business (an offer is prepayment, unlike an invoice) — §8.60 |
| `SwimSyncAdmin/components/WhatsAppQueue.tsx` | The shared "open next chat" `wa.me` queue shell; `ReminderQueue` (invoices) and the packages renewal queue are both thin wrappers over it — §8.60 |
| `SwimSyncAdmin/lib/packageOffers.ts` · `SwimSyncApp/app/package/[token].tsx` | Pure offer deciders (`defaultConfirmStart` RISK 3, `pickOfferProduct` Decision 5) · the parent public offer page — §8.60 |
| `supabase/migrations/20260718000200_coach_close_enrolment.sql` | `close_student_enrolment()` RPC — remove-from-class / set-inactive for the tenant admin **and** the owning coach (§6, §8a) |
| `supabase/migrations/20260718000100_…invoice_run_day` · `…000300_…invoice_block_notice` | `app_settings` seeds: automatic run day (default 7) + blocked-alert throttle state |
| `SwimSyncAdmin/lib/studentStatus.ts` · `SwimSyncApp/lib/studentStatus.ts` | **Byte-identical twins** — `removeFromClass` / `setStudentInactive` over the RPC. Edit both (§6) |
| `supabase/migrations/20260719001200_active_inactive_rpcs.sql` | `set_students_active()` (sole writer), `set_parent_tenant_active()`, `family_active_children()` (the read behind the prompt), join-code reactivation |
| `supabase/migrations/20260719001300_drop_inactive_assignment_status.sql` | Enum contract, with the `pg_proc` guard that refuses if a function body still casts to the retired value (§7.21) |
| `SwimSyncAdmin/app/(admin)/parents/page.tsx` | Families at this business — there was no Parents page before |
| `supabase/tests/active_inactive.test.sql` | Family consequence both ways, the one-way property, the tenant boundary |
| `docs/plans/TENANT_PROVISIONING_PLAN.md` | **The tenant-provisioning design of record** - the settled decisions, the eight ranked risks with their mitigations inline, and a *What actually happened* header recording which of them fired. Read before changing anything about creating a business |
| `docs/design/PACKAGES_DESIGN.md` | **The prepaid-packages design of record** — the locked decision table + the /plan-review risk mitigations, inline. Read before changing anything package-shaped |
| `supabase/migrations/20260720000100_lesson_packages.sql` | The four package tables, CHECKs, lifecycle trigger (NOT definer — §7.38), RLS, `package_live_balances()` |
| `supabase/migrations/20260720000200_package_correction_restore.sql` | `handle_attendance_update` 7th redefinition: restore-to-package, refund-at-most-once |
| `supabase/tests/lesson_packages.test.sql` · `package_corrections.test.sql` | The package money rules + the correction paths (30 + 12) |
| `supabase/functions/generate-invoices/packages.test.ts` | Engine drawdown incl. the no-package TRIPWIRE and the fault-injection unsealed-month test |
| `supabase/functions/package-emails/` | Purchase emails (request + confirm), caller-authorized, own deploy |
| `SwimSyncAdmin/app/(admin)/packages/page.tsx` | Admin: pending queue, products, held packages (live balances), class categories |
| `supabase/migrations/20260801000200_student_package_coverage.sql` | `student_package_coverage()` — the per-child payment-method verdict (package/mixed/ad_hoc + family-shared count). Category *matching* over `package_live_balances()`, never a second balance derivation; coverage is category + date ONLY (the engine's affordability rule must not decide a label) |
| `SwimSyncAdmin/lib/packageCoverage.ts` · `SwimSyncApp/lib/packageCoverage.ts` | The chip/badge row-shapers (mirrored, logic stays in SQL): `coverageByStudent` (null-tolerant — an RPC error renders no chip, never a broken page), `isRunningLow`, and admin-only `familyLessonsByParent`/`familyLabel` for the two family-grain surfaces (Parents, Claims) |
| `SwimSyncAdmin/components/PackageChip.tsx` · `SwimSyncApp/components/PackageBadge.tsx` | "Package · N left" / "Ad-hoc" — explicit both ways; renders nothing only with no coverage row (unclaimed child / failed RPC) |
| `supabase/migrations/20260802000100..500_*.sql` | Make-ups (PRD §7.20): `makeup_bookings` (trial_bookings' shape + TWO snapshots — home category for package matching, home class id for the ad-hoc rate, §7.45), `book_makeup()`/`cancel_makeup_booking()`, the coach/parent visibility widening (also closed the latent trial-guest gap), `package_live_balances()` reading the snapshot, and `merge_students` taught the fifth cascading table — its unknown-cascade tripwire caught it on the suite's first run |
| `SwimSyncAdmin/app/(admin)/makeups/page.tsx` · `lib/makeupSearch.ts` | Admin: book/cancel make-ups — child found via ONE search box matching name OR class title (pure filter in the lib, unit-tested), past-and-unmarked list, package-expiry advisory |
| `supabase/migrations/20260802000600_payment_collection_schema.sql` · `…000700_invoice_paid_rpcs.sql` | Payment collection (PRD §7.21): per-tenant `INV-YYYY-NNNN` references (year from the invoice's OWN `billing_month`, §7.7) + 128-bit `public_token`, assigned by a BEFORE INSERT trigger so the engine is untouched (§7.78 — the DEFINER hop is load-bearing); the pin trigger; `claim_invoice_paid()` / `confirm_invoice_paid()` (gate = the `invoices_update` policy, verbatim) |
| `SwimSyncApp/lib/paynow.ts` | EMVCo PayNow payload builder (TLV + CRC-16/CCITT-FALSE) — pure, **throws on dubious input** (a wrong-but-valid QR pays the wrong amount silently), test-pinned to an INDEPENDENT generator's vector |
| `supabase/functions/public-invoice/` | The tokenized invoice page's data source — deliberately an edge function, NOT an anon RPC (see §6); serializer allowlist, uniform 404, in-memory rate limit; also the sessionless "I've paid" claim |
| `SwimSyncApp/app/invoice/[token].tsx` | The public invoice page (chrome-less, in `PUBLIC_PATHS`): computed QR, Save-QR-image + scan-from-gallery instruction, claim button |
| `SwimSyncAdmin/lib/waMessage.ts` · `app/(admin)/invoices/ReminderQueue.tsx` | The wa.me reminder message/link builders (on `normalizeSgPhone`; unusable number → null → visible "no number") and the click-through queue ("chat opened" wording is a rule, not copy taste) |
| `supabase/functions/generate-invoices/makeups.test.ts` | Engine: the zero-bookings TRIPWIRE, gate both directions, home-rate + snapshot pins, the live-balances re-tag pin |
| `supabase/functions/generate-invoices/rates.ts` | `rateOn()` — the terms in force on a lesson's date. Pure + unit-tested, like `dates.ts`. Dates compared as **YYYY-MM-DD strings**, never parsed to `Date` (keeps the timezone traps of §7.7/§7.12 out). A missing rate **throws** (§6) |
| `supabase/migrations/20260719000700_class_rates.sql` | Effective-dated price + paid coach, `class_rate_on()`, floor-dated backfill + seed trigger, display sync, RLS |
| `supabase/migrations/20260719001000_set_class_terms.sql` | The only sanctioned class edit: both tables in one transaction, correct-vs-change, settled-money guards |
| `supabase/tests/class_terms.test.sql` | correct-vs-change, rename-records-nothing, future-dating, cross-tenant coach, sealed-month refusal |
| `supabase/functions/generate-invoices/dates.ts` | Timezone seam: `APP_TIMEZONE` + `previousBillingMonth()` (SGT-correct default month, §8a) + `dayOfMonthInTimeZone`/`clampRunDay` for the run day (§8a) |
| `supabase/functions/generate-invoices/core.test.ts` · `email.test.ts` · `dates.test.ts` · `test.sh` | Deno integration + email + billing-month tests + runner |
| `supabase/tests/*.test.sql` | pgTAP DB tests (trigger, RLS, constraints) |
| `supabase/cloud/cron_schedule.sql` | Cloud-only daily cron wiring |
| `supabase/seed.sql` | Local seed (superadmin, coach, one class) |
| `SwimSyncApp/app/` | Expo Router screens: `(auth)/ (parent)/ (coach)/`, each tab folder has a nested `_layout.tsx` |
| `…/(auth)/forgot-password.tsx` · `reset-password.tsx` | Password-reset flow (request link + set new password) |
| `SwimSyncApp/app/_layout.tsx` | Root: session restore + `PASSWORD_RECOVERY` routing + native recovery deep-link handler |
| `SwimSyncApp/lib/authErrors.ts` | Maps raw Supabase auth errors to friendly copy |
| `SwimSyncApp/lib/attendanceBulk.ts` · `.test.ts` | Bulk "Set all to…" helper (`applyBulkStatus` + options) for the coach attendance screen (§8e) |
| `SwimSyncApp/lib/lessonDates.ts` · `SwimSyncAdmin/lib/lessonDates.ts` | **Byte-identical twins** — SG-safe date strings + expected lesson dates. Edit both (§6) |
| `SwimSyncAdmin/lib/classCoverage.ts` | Expected-vs-marked coverage maths for the admin pre-generation check |
| `SwimSyncAdmin/app/(admin)/` | Admin pages; `app/api/` server routes |
| `.claude/skills/run-ui-playwright/` | Skill to launch + drive both UIs (Playwright/Chrome) |
| `01_SESSION_WORKFLOW.md` | **Which skill to run when** — the user-facing one-page loop. Start here for workflow questions |
| `.claude/skills/update-docs/` | Skill: reconcile PRD/BACKLOG/HANDOVER by their own rules (**was `/session-close`** until 2026-07-26) |
| `.claude/skills/session-close/` | Skill: shut the session down — fixtures torn down, ports released, nothing unpushed, worktree settled |
| `AVAIL_SKILLS.md` | Reference for all available skills |
| `LOCAL_DEV_GUIDE.md` | Run/test commands, seed logins, service URLs |
| `INVOICE_RUNBOOK.md` | Monthly manual invoice-generation procedure (superadmin) |
| `README.md` | Front door + **the rule for which document to write in** |
| `PRD.md` | Product spec — **what exists** (*(implemented)* sections = build decisions) |
| `BACKLOG.md` | **What doesn't exist yet** — every item carries a `Why` |

Memory files (Claude project memory dir) also capture project state + backend
| `brand/` | **The mark's source of truth** (`mark.svg`) + recolours, app-icon tile, adaptive foreground. `README.md` there has the regeneration table and where the mark must NOT go |
| `SwimSyncApp/components/Logo.tsx` | The mark in the app: white-knockout **PNG** + `tintColor`. Deliberately not SVG — no `react-native-svg` (§6) |
| `SwimSyncAdmin/components/Logo.tsx` | The mark in the admin: **inline SVG**, `currentColor`. Hand-kept copy of `brand/mark.svg` — edit both |
| `supabase/migrations/20260719001400…002200` | This session: student identity + derived age, the tenant pin, document name snapshots, `tenant_levels`, the `swimming_ability` drop (CONTRACT), parent address, level skills |
| `SwimSyncApp/lib/lessonDates.ts` | Also holds **`ageFromDob()`** — age is derived, never stored. **Twin file**: edit `SwimSyncAdmin/lib/lessonDates.ts` too |
| `SwimSyncApp/app/(parent)/home/edit-child.tsx` | Parent edits their child (name/DOB/gender/notes). The first thing in the app that mutates `students` — see §6 on the tenant pin |
| `SwimSyncApp/app/(parent)/profile/contact.tsx` | Parent's address + postal code, editable after signup (the backfill path for parents who predate the fields) |
| `SwimSyncAdmin/app/(admin)/levels/page.tsx` | The business's level ladder **and** each rung's skill list (expand a row). Order is set here and preserved everywhere |
| `supabase/tests/student_identity · student_tenant_pin · document_name_snapshot · tenant_levels · level_skills · parent_address` | This session's pgTAP (+50). Each was confirmed to FAIL without its fix |
| `.claude/skills/run-ui-playwright/drivers/verify-{student-identity,edit-child,levels,level-skills,parent-address}.mjs` | Fifth session's UI drivers (49 checks). They caught three defects that typechecked clean and passed pgTAP |
| `.claude/skills/run-ui-playwright/drivers/verify-invoice-controls.mjs` | Sixth session (21 checks): MEASURES the toggle's track/knob rects from the DOM and asserts the billing-month default + cap. Its **14/21 baseline on unfixed code** is what located the knob bug (§7.34) |
| `SwimSyncAdmin/lib/adminNav.ts` (+ test) | **Which pages** an admin sees, keyed on `tenant_id` (§7.19). Panel **entry** is a separate, role-based question since co-admins — the two-question split is §7.91 and the file's own header. Sidebar, the layout gate and the post-login landing all derive from it, so they cannot disagree. Unknown routes fail closed |
| `SwimSyncAdmin/components/RequiresTenant.tsx` | The audience gate, applied once in the `(admin)` layout: role gate (coach/parent → "use the SwimSync app", **only on a resolved profile** — §7.91), suspension screen for deactivated admins, then tenant-vs-platform scope. **Early-returns** so a refused page's children never mount — an overlay would leave the queries running (§7.10) |
| `SwimSyncAdmin/app/(admin)/admins/page.tsx` + `app/api/{invite,resend-admin-invite,deactivate,reactivate,delete,list}-admin*` | Co-admin management (§8.31): roster visible to every admin, levers owner-only. Routes call the RPCs **as the caller** (service-role would blow past `is_tenant_owner()`); delete order is ban → RPC → deleteUser |
| `SwimSyncAdmin/lib/adminManagementGate.ts` | The shared route gate (caller's tenant from their OWN profile, owner check against `tenants.owner_profile_id`) — five routes, one boundary |
| `SwimSyncAdmin/lib/coAdminInviteEmail.ts` (+ test) | Co-admin invite copy: "help manage", **no join-code custody paragraph** — that language belongs to the owner invite (`inviteEmail.ts`) |
| `supabase/migrations/2026071900{2300,2400}` | `platform_tenant_overview()` + `platform_stranded_parents()`, then the derived-shape correction. SECURITY DEFINER, gated internally, REVOKEd from PUBLIC (§7.35) |
| `.claude/skills/run-ui-playwright/drivers/verify-platform-admin-scope.mjs` | 32 checks: every refusal asserts the **absence of rows**, the tenant-admin half asserts each listed page renders its **content** — "no refusal" would also pass on a blank page — and the sidebar count is pinned (16 since Admins, 2026-08-06) |
| `supabase/functions/generate-invoices/test-helpers.ts` → `monthEnded()` | The suite's clock seam. Supplies billing month + a clock at which it is billable + an early-enough enrolment as ONE fact, and **throws on a scenario expecting zero lessons** (§7.33) |

gotchas: `swimsync-project`, `swimsync-backend-gotchas`.

---

---

## 12. Removed / hidden UI stubs (READ before "re-adding" a button)

During the web deployment we found several buttons that were **placeholder stubs**
— rendered in the UI but with empty `onPress={() => {}}` handlers, so they did
nothing on **any** platform (not just web). These were **removed** so the shipped
app has no dead controls. If a future session is asked to "add X back," check here
first — it was intentionally removed as unbuilt, not lost.

| Screen (file) | Removed button | Why | To restore |
|---------------|----------------|-----|-----------|
| Coach Settings `app/(coach)/settings/index.tsx` | **Notification Preferences** | Push notifications are **out of MVP scope** (PRD §3.2). Was an empty stub. | Build a notifications feature first, then re-add a real `MenuItem`. |
| Parent Profile `app/(parent)/profile/index.tsx` | **Notification Preferences** | Same as above. | Same as above. |
| Parent Profile `app/(parent)/profile/index.tsx` | **Help & Support** | Empty stub; no support content/flow exists yet. | Add a real target (support email/link/FAQ screen), then re-add the `MenuItem`. |

**Implemented (not removed):** the **Change Password** buttons on both those screens
were also empty stubs — they are now **wired to a real screen**
(`components/ChangePasswordScreen.tsx`, routes `…/settings/change-password.tsx` and
`…/profile/change-password.tsx`). Kept & working: parent **Add Child Profile**.

### 6z. A SUBSTITUTE IS PER-LESSON; A SHADOW IS PER-CLASS — and they take OPPOSITE date sources

*(2026-08-12, `20260812000200`. Wave 3 shipped both on the lesson on 2026-08-11; the shadow
half was wrong and was moved a day later, cheap only because production held zero roster rows.)*

The two look like one feature and are not:

| | Substitute | Shadow |
|---|---|---|
| Scope | ONE lesson | the WHOLE class, dated, until ended |
| Table | `session_coaches` (≤1 row per lesson) | `class_shadow_coaches` |
| Managed on | Lesson Coaches | Classes → the class drawer |
| Sees | only the lesson they were named on | the class's whole recurrence |
| Marks | yes — `attendance_write` narrows to them | never |

**The date sources are the trap.** A substitute's dates come from their per-lesson rows; a
shadow holds none at all, so their dates come from the class's recurrence — the same arm an
*owner* takes. Point the shadow at the substitute's arm and they see an empty week, which is
indistinguishable from a quiet one. The coach app names this `showsWholeSchedule` rather than
writing `owned || shadowed` inline, because the adjacent line — whether a lesson enters the
covered-out probe — asks a *different* question and must stay `owned &&` (§7.138).

**THREE AXES NOW, and merging any two re-creates a bug this repo has already paid for:**

- **ACCESS** — the roster + `classes.coach_id` + *"am I a shadow TODAY?"*
- **MONEY** — `class_rate_on().paid_coach_id` + *"was I a shadow ON THAT LESSON'S DATE?"*
- **MARKING** — the roster main, else the class's coach. A shadow never marks.

The two shadow date questions are deliberately two functions (`coach_is_active_class_shadow`
vs `coach_shadowed_class_on`). Collapse them and either an ex-shadow keeps seeing the class,
or a current one loses their pay history. `20260719000800` exists because ACCESS and MONEY
were once the same query and a handover re-priced a class's entire unpaid history.

**Pay attribution is ONE ordered function.** `coach_attribution_kind()` returns
`substitute | terms | shadow | NULL`, and both the pay predicate and the rate choice read it.
A coach can satisfy two arms at once — they shadow the class and cover one of its lessons —
and a boolean predicate cannot say which matched, so the rate would be chosen by a second copy
of the rule. That is §7.129's shape inside §7.129's own function; it cost a real double
payment. **Substitute beats shadow**, and the client mirrors the same order.

---

### 12a. `Alert.alert` is a no-op on the web build (known pattern)

`Alert.alert` has **no `react-native-web` implementation** — on the deployed web app
it does nothing (no dialog, and none of its button `onPress` handlers fire). It works
normally on native iOS/Android. **This whole family has been swept** (verified on cloud
across sign-out, register, reset-password, login errors, add-child, coach QR/attendance).
The three mechanisms — reuse them for any new user feedback so it works on web too:

1. **Confirm dialogs** → `confirmAction(title, message, onConfirm, confirmLabel)` from
   `lib/confirm.ts` (web `window.confirm` / native `Alert.alert`). Used by Sign Out.
2. **Transient feedback** (errors, "Saved", "Uploaded", …) → the **global Toast**:
   `useAppStore.showToast(message, "success" | "error" | "info")`, rendered by
   `components/Toast.tsx` (mounted once in `app/_layout.tsx`). Auto-dismisses in 3s.
3. **Form validation** on auth screens → inline `error` state under the form
   (register / reset-password / Change Password), or a toast where there's no form slot.

For alerts that used an `onPress` to redirect, the fix does the navigation **directly**
(e.g. `showToast(...); router.back()`), since the old `onPress` never fired on web.

**Do NOT reintroduce `Alert.alert` for user feedback.** The only sanctioned use left is
the **native-only media-library permission prompt** in coach settings, guarded by
`Platform.OS !== "web"`. Audit with `grep -rn "Alert.alert" SwimSyncApp/app`. See also
the `run-ui-playwright` skill gotcha #5.
