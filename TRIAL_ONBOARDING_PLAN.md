# Trial & Provisional Student Onboarding — Build Plan (Slice 1)

_Written 2026-07-25. A coach or admin can put a child on the roster before that child's
parent has a SwimSync account; the parent is later invited by link and adopts the
existing record. Money taken outside SwimSync is recorded rather than lost._

> **STATUS: BUILT AND VERIFIED LOCALLY — NOT MERGED, NOT DEPLOYED.** All seven phases
> complete on `feat/trial-onboarding`. pgTAP **297** (19 files, +32), Deno **99** (+8, run
> twice), admin vitest **100** (+12), app jest **75** (+6), both apps typecheck, and
> `verify-trial-onboarding.mjs` **13/13** against both running UIs. The loop was confirmed
> end to end: settle → re-run → `unclaimed_billable: 0, sealed: true`.
> **The Deploy section below has NOT been executed.** Slice 2 (self-serve claiming,
> duplicate merge) remains out of scope — its design is recorded in `BACKLOG.md`.
>
> **What the mitigations actually caught** — the value was front-loaded and unevenly
> distributed, which is worth knowing next time:
> - **RISK 10 fired in phase 0, before any code**, exactly as written. The link came back
>   pointing at the admin root. "Read the actual link" was the whole mitigation and it was
>   the only thing that would have caught it.
> - **RISK 3 was confirmed real, not theoretical**, by the same spike — `current_user` is
>   `postgres` inside SECURITY DEFINER, so the tenant pin does not fire. Now §7.42.
> - **RISK 2's structural form worked.** Writing the engine tests first and proving them
>   red meant the create path could not land ahead of the block.
> - **RISK 1's tripwire stayed green throughout** — 145 insertions, 0 deletions in
>   `core.ts`, and claimed families bill byte-identically.
> - **The UI driver found two bugs the unit tests structurally could not**, both in wiring:
>   the refusal rendering through the fail-safe branch, and the settle buttons passing a
>   null amount into a CHECK that correctly refused it. Neither was a logic error; both
>   were invisible below the integration level.
> - **§7.44 was discovered the hard way** and cost the most time of anything here: after
>   `supabase db reset`, Kong holds a dead auth upstream and the entire Deno suite fails
>   with an empty error object. Now a gotcha.

## Phase 0 spike results (2026-07-25) — both PASS, and one risk fired immediately

**0a — `auth.uid()` inside SECURITY DEFINER: PASS.** Called from a `SET LOCAL ROLE
authenticated` transaction with JWT claims, a `postgres`-owned SECURITY DEFINER function
sees `auth.uid()` = **the caller's uuid** while `current_user` = `postgres`.

Both halves matter, and the second **confirms RISK 3 is real rather than theoretical**:
`created_by = auth.uid()` will record the coach (so RISK 6's mitigation holds), *and* the
function is genuinely exempt from `pin_student_tenant()`, whose seam is `current_user`.
**Nothing will catch a wrong `tenant_id` in this RPC.** Derive it from the class.

**0b — parent invite round-trip: PASS, with two findings.**

1. `generateLink({type:'invite'})` returns `action_link` without sending; metadata survives;
   `handle_new_user()` creates `profiles` (role=parent, `tenant_id` NULL, correct per its
   own comment — parents are global) and `parents`.
2. **`parent_tenants` is CONFIRMED ABSENT.** The trigger deliberately leaves membership to
   join codes, so **the invite route must create it** — and, because the invite is *about a
   specific child*, `parent_students` too. Both need the `parents.id` that only exists after
   the auth user, so Phase 6 does: generate link → resolve parent → link membership + child.
   **Do this in one SECURITY DEFINER RPC** (`link_invited_parent`), not two service-role
   inserts, so the pair is atomic; gate it with the **caller's** token per §8.9, because
   `is_tenant_admin()` resolves `auth.uid()`, which is NULL for service role.
3. ⚠ **RISK 10 FIRED ON THE FIRST RUN.** The spike passed
   `redirectTo: http://localhost:8081/accept-invite` and the returned link carried
   **`redirect_to=http://127.0.0.1:3000`** — `site_url`, silently substituted, pointing at
   the *admin panel root*. Exactly §7.41, exactly what bit the provisioning session.
   `additional_redirect_urls` currently lists `:8081` and `:8081/reset-password` but **no
   app accept URL**. Phase 6 must add `http://localhost:8081/accept-invite` and
   `swimsync://accept-invite`, then restart the stack, then **re-read the link**.

---

## The gap this closes

Onboarding is the bottleneck (`HANDOVER.md` §9: still **zero attendance rows in
production**). Two situations break it:

1. **A trial walk-in.** The child does not exist in SwimSync, so the coach cannot mark
   them, so the lesson is invisible to billing, to the coach's payout, and to the gate.
2. **An existing student whose parent is slow to register.** Same, every week.

### The live latent bug underneath it

`core.ts:487-490` resolves attendance→parent with a plain lookup:

```ts
const { data: parentStudents } = await supabase
  .from("parent_students").select("parent_id, student_id")
  .in("student_id", billableStudentIds);
```

A student with **no `parent_students` row yields no rows** — their billable attendance is
silently dropped. They are not in `deferrableParentIds` (`core.ts:505-510`) so they defer
nobody, and not in `activeStudentIds` unless enrolled so they block nothing. **The month
completes, seals, and those lessons are permanently unbillable.**

Fourth appearance of one family — §7.8, §7.13, §7.32. Phase 2 exists to close it and
**must land before Phase 3**.

---

## What the schema already gives us (verified, not assumed)

| Fact | Where | Consequence |
|---|---|---|
| The parent link is a **join table** | `20260309000100:86-92` | A student with zero parent links is **already legal**. No schema change for "unclaimed". |
| `students_insert` permits `is_tenant_admin(tenant_id)` | `20260718000900:291-297` | The **admin** needs no new permission. Only the coach does. |
| `students_select` includes `created_by = auth.uid()` | `20260718000900:282-290` | The creating coach keeps visibility independent of enrolment — load-bearing for RISK 6. |
| `coach_serves_student()` requires `e.is_active` | `20260309000600:63-71` | Closing an enrolment **removes** coach visibility. `20260718000200:48-50` documents this. |
| `students.is_active` = "still a customer of THIS business" | PRD §7.14 | A non-converting trial needs **no new state**. |
| Of five FKs into `students`, only `parent_students` cascades | `20260309000100:87,117,151,186,202` | The database **refuses to delete a student carrying any history.** |
| A free trial counts as attendance **for wages** | PRD §7.13 | Deleting a trial student destroys the basis for a possibly-frozen payout. |
| `profiles.phone` is collected at registration | `20260309000100:29` | Slice 2's strongest matching signal already exists parent-side. |
| `invoices.parent_id`, `payment_records.invoice_id` both NOT NULL | `20260309000100` | Money for an unclaimed student **cannot** ride the invoice rails. Hence `student_settlements`. |
| The only money aggregate in the admin is `totalOutstanding` | `invoices/page.tsx:389` | There is **no revenue ledger**. See `BACKLOG.md` → *Revenue reporting*. |
| The attendance screen builds its roster from `is_active` enrolments only | `attendance.tsx:133` | A closed trial enrolment hides the child from the screen that marked them — RISK 6. |

---

## Settled decisions (do not re-litigate)

| Decision | Why |
|---|---|
| **Adopt, don't merge** | Attendance/enrolments/items keep pointing at the same `student_id`. No migration step to get wrong. |
| **"Unclaimed" is DERIVED** (no `parent_students` row) | Cannot drift; needs no backfill. Same rule that removed `students.age`. |
| **Unclaimed billable attendance BLOCKS sealing** | Matches the no-override stance (§7.7), and makes late claiming free — the month never sealed, so a re-run bills it. No reopen path needed. |
| **A trial enrolment opens and closes on its own date** | Billing follows attendance rows (§7.13) so it still bills, but `activeStudentIds` never holds them later, so it cannot block future lessons. |
| **The invite is the happy path; matching is slice 2** | The invite asserts the link: no matching, no disclosure risk, no approval step. |
| **Admin only** records settlements and (slice 2) approves claims | User's call. Works because `trial_paid` on an unclaimed student *is* the coach's implicit "settle this". |
| **Coach *and* admin** may create an unclaimed student | The coach is at the poolside. Via SECURITY DEFINER RPC — never an INSERT grant, because RLS is row-level. |
| **Settlements are ROWS**, effective-dated by `settled_through` | A column cannot be counted, cannot hold a second trial, cannot be summed. |
| **A non-converting trial is marked INACTIVE, never deleted** | The coach was paid for it (§7.13). `close_student_enrolment()` offers no DELETE either. |
| **Conversion = the existing Unassigned → assign flow** | PRD §5.2 reserves assignment for the admin. No new screen. |
| **A bare invoice is fine** on first claim; **cash is out of scope** | User's call. |

---

## Phase 0 — Spike FIRST (blocks Phases 3 and 6)

Two independent unknowns. Both are cheap to test and expensive to assume.

**0a — `auth.uid()` inside SECURITY DEFINER.** The whole trial flow rests on the RPC
recording `created_by` as the *calling coach*, so RISK 6's mitigation holds.

> ⚠ **RISK 6 MITIGATION — assert, don't reason.** In a throwaway function owned by
> `postgres`, `SET LOCAL ROLE authenticated` with a coach's JWT claims and
> `SELECT auth.uid()`.
> **Pass value: the coach's profile UUID, not NULL and not `postgres`.**
> If it is NULL, `created_by` must be passed explicitly and validated against the caller —
> **do not fall back to `postgres`**, which would make the row invisible to the coach.

**0b — the parent invite round-trip.** Same shape as `TENANT_PROVISIONING_PLAN.md` Phase 0,
whose RISK 4 fired for real elsewhere.

1. `generateLink({ type:'invite', email, data:{ role:'parent', … } })` creates the auth
   user and returns `action_link` **without sending**.
2. `handle_new_user()` fires with metadata intact → `profiles` + `parents`.
3. **Does the parent land in the tenant?** Membership normally comes from a join code, not
   the trigger.

> ⚠ **RISK 9 MITIGATION.** Assert the round-trip:
> `SELECT raw_user_meta_data FROM auth.users WHERE email = '<spike>';` then confirm
> `parents` **and** `parent_tenants` rows exist.
> **Pass value: a `parent_tenants` row for the inviting tenant.**
> If absent, the API route must write it — decide **here**, not while writing Phase 6.
> **Do NOT write Phase 6 before this passes**; an invited parent in no tenant sees an
> empty app and cannot add a child.

---

## Phase 1 — Database (one migration, additive only)

**`student_settlements`** — money received or forgone for a student with no parent to
invoice.

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `student_id` | Scoped and FK'd |
| `settled_through` | DATE. Attendance **on or before** this is settled. Effective-dated, like `class_rates` |
| `kind` | `paid_outside` \| `written_off` |
| `amount` | NUMERIC, NULL for `written_off` |
| `method`, `note` | e.g. "PayNow 12 Jul" |
| `recorded_by`, `recorded_at` | Audit |

RLS: tenant admin only for INSERT/UPDATE; tenant admin + platform admin for SELECT.
Grants per `20260309000800`.

> ⚠ **RISK 11 MITIGATION — a step, because §7.39 proved comments don't hold.** End the
> migration with an explicit
> `REVOKE EXECUTE ON FUNCTION … FROM anon, service_role;` for every new function.
> **Then verify against the REMOTE `pg_proc` after deploy, not the local one** —
> Supabase *cloud* default-grants all three where local grants two, so a local check
> passes vacuously.

**Additive columns on `students`:** `provisional_contact_name`, `_phone`, `_email`.

> The phone column ships **now, though matching is slice 2**, for the §5.1 reason: a field
> added later only ever holds data for people who arrived after it shipped.

---

## Phase 2 — Engine (**must land, and be green, before Phase 3**)

In `core.ts`, after the billable set is built:

1. Compute `unclaimedBillable` — billable attendance whose student has no `parent_students`
   row, **minus** anything covered by a `student_settlements` row where
   `settled_through >= session_date`.
2. Return it in the result so the admin dialog can name names.
3. **Add a seal condition:** a month with non-empty `unclaimedBillable` is not finished.

> ⚠ **RISK 1 MITIGATION — named prohibition.** `unclaimedBillable` is a **REPORT**.
> **Do NOT let it modify `billableStudentIds`, the item loop, or any invoice arithmetic.**
> The existing billing path for claimed students must be untouched. Audit before commit:
> `git diff supabase/functions/generate-invoices/core.ts` — every changed line is either
> the new query, the new result field, or the new seal condition. Anything else is a bug.

> ⚠ **RISK 2 MITIGATION — structural, not vigilance.** Write these Deno tests **first**
> and merge them before the Phase 3 migration exists. **Prove the seal test is RED on
> today's engine before making it pass** — a test that was never red proves nothing. CI
> then blocks any branch that adds the create path without the block.

**Tests (Deno):**
- **Tripwire:** a tenant with **no** unclaimed students produces **byte-identical**
  invoices. *(The packages session's best idea; it is what proves RISK 1 didn't fire.)*
- Unclaimed billable attendance blocks the seal; a settlement covering it unblocks.
- A settlement dated **before** the lesson does **not** unblock it.
- `trial_free` only → no block (non-billable).
- **Run the suite twice** (§7.15 — a sealing test leaks state; passing once proves nothing).

---

## Phase 3 — `add_unclaimed_student()` RPC

`SECURITY DEFINER`, modelled on `close_student_enrolment()` (`20260718000200`) — one
operation, audit-logged, no INSERT grant to coaches.

- **Caller:** the class's coach **or** the tenant admin. Refuse everyone else.
- **`created_by = auth.uid()`** (per spike 0a) — the calling coach, not `postgres`.
- **Two modes:**
  - `trial` — student + a **closed** enrolment dated to the session + resolve-or-create the
    `lesson_session` + the attendance row. One atomic "add and mark": at the poolside you
    are adding someone *because they are here today*.
  - `ongoing` — student + an **open** enrolment. Blocks the gate normally, which is
    correct: they attend weekly.

> ⚠ **RISK 3 MITIGATION — the tenant pin does NOT protect this path.** §6: the
> `pin_student_tenant()` seam is `current_user`, and **SECURITY DEFINER writers owned by
> `postgres` inherit the exemption automatically.** So this function can write a student
> into any tenant and no trigger will stop it.
> **Named prohibition: `tenant_id` is NOT a parameter.** Derive it inside the function from
> the class (`class_tenant(p_class_id)`).
> **Assertion (pgTAP): a coach of tenant A calling with tenant B's `class_id` is REFUSED,
> and `students` does not grow.** Plus: the created student's `tenant_id` equals the
> class's, always.

> ⚠ **RISK 4 MITIGATION — this becomes the SECOND writer of `lesson_sessions`.** §6 records
> that the attendance save is "the only writer in the codebase", and §7.7 records that a
> duplicate session **double-billed everyone**. Two steps, both mandatory:
> 1. Resolve the session with `INSERT … ON CONFLICT (class_id, session_date) DO NOTHING`
>    then `SELECT` — never a bare `INSERT`, never check-then-insert.
> 2. **Named prohibition: do NOT derive `session_date` inside the function from `now()`.**
>    It is passed in as an SGT date string by the caller (§7.7 — a UTC-derived date is the
>    previous day before 08:00 local).
>
> **Assertion (pgTAP): calling the RPC twice for the same class + date yields exactly ONE
> `lesson_sessions` row and exactly ONE `attendance` row.**

> ⚠ **RISK 8 MITIGATION — a duplicate name+DOB must not surface as a raw DB error.**
> `students_identity_uniq` will reject a walk-in whose name and DOB match an existing
> child, at the poolside, mid-class. PRD §5.1 already requires "a plain explanation rather
> than a database error". **Step:** catch `unique_violation` and return a typed result the
> UI renders as *"SwimSync already knows an Ethan Tan born 4 Mar 2018 — is this the same
> child?"* **Assertion (pgTAP):** the duplicate case returns that typed error, not SQLSTATE
> 23505.

Also: `marked_by` on the attendance row is a **profile** id, not `coaches.id` (§7.2).

---

## Phase 4 — Coach UI (`SwimSyncApp`)

- **"Add walk-in"** on Mark Attendance: name, optional phone/email, Trial — Free or Paid.

> ⚠ **RISK 6 MITIGATION — the roster union is required, not optional.**
> `attendance.tsx:133` builds its list purely from `is_active` enrolments, so a closed
> trial enrolment makes the child **vanish from the screen that just marked them**.
> **Step:** the roster becomes *actively-enrolled* **∪** *has an attendance row on this
> session*. Semantically right regardless — a marking screen for a date should show
> everyone marked on that date.
> **Assertion (UI driver):** after adding and marking a walk-in, reload the screen and
> assert the child is **still listed with their status intact**.

---

## Phase 5 — Admin UI (`SwimSyncAdmin`)

- **Unclaimed students list** — active only; who created them, when, lessons attended,
  and whether any are billable-but-unsettled.
- **Invite parent** (Phase 6) per row.
- **Record settlement** — `paid_outside` (amount + method) or `written_off`,
  `settled_through` defaulting to today.
- **"Trial didn't convert"** — sets `is_active = false` with the departure date and closes
  any open enrolment. Reuses §7.14; adds no new state.

> ⚠ **RISK 5 MITIGATION — one forgotten walk-in stalls the WHOLE tenant's billing.**
> The block is all-or-nothing by design (§7.7: "invoicing the complete classes would give
> those parents an invoice and strand the rest"). So an unsettled `trial_paid` walk-in
> holds up every family's invoice that month. That is correct, and it is only survivable
> if the remedy is obvious.
> **Step:** the invoice pre-flight dialog **names each blocking student** and offers
> *Record settlement* / *Write off* **inline in the dialog** — not a link to another page.
> **Assertion (UI driver):** generation refuses, the refusal message contains the
> student's name, and settling from within the dialog makes the next run succeed.

> ⚠ **RISK 7 MITIGATION — settlement is the one button that makes money disappear.**
> Admin-only (RLS), audit-logged, **reversible** (a parent who appears two months later
> must be recoverable), and shown on the invoice dialog rather than buried in a detail
> page. **Prohibition: no bulk "settle all" control** — that turns a deliberate act into
> one careless tap across a whole roster.

---

## Phase 6 — Parent invite + accept

- `POST /api/invite-parent` in `SwimSyncAdmin`. Gate with the **caller's** token —
  `is_tenant_admin()` resolves `auth.uid()`, which is NULL for service role (§8.9). Service
  role only for the invite itself.
- Code-owned Resend email reusing the `email.ts` builder pattern, unit-tested,
  **no-op without `RESEND_API_KEY`**.
- **The landing page is in `SwimSyncApp`, not the admin panel** — parents live on
  `swimsync.sg`. A new Expo route, not a copy of the admin's `/accept-invite`.

> ⚠ **RISK 10 MITIGATION — §7.41, the easiest thing to get wrong, and it fails quietly.**
> An unlisted redirect is **not rejected — `site_url` is silently substituted**, so the
> link works and lands on the wrong page. **Steps:** add the app's accept URL to
> `[auth].additional_redirect_urls` in `supabase/config.toml` **and** the production
> dashboard; `supabase stop && supabase start` (read only at boot).
> **Assertion:** the generated `action_link` contains `redirect_to=<the app's accept URL>`
> — **read the actual link, don't trust that the flow "worked"**, because it works either
> way.

---

## Phase 7 — Tests

**pgTAP** (`trial_onboarding.test.sql`) — every refusal in its **own explicit transaction**
(§7.16; `SET LOCAL ROLE` outside one is a no-op that passes everything): parent, unrelated
coach, cross-tenant coach, anon — each asserting `students` did **not** grow. Plus the
assertions named inline above (RISK 3 tenant derivation, RISK 4 idempotency, RISK 6 coach
SELECT after close, RISK 8 typed duplicate error), settlement RLS, and the
`student_settlements` tenant boundary.

> ⚠ **Mutation-test the gate** to the `tenant_provisioning.test.sql` standard: delete the
> caller check and **at least one assertion must fail proving the ungated function wrote
> rows**. A refusal test that passes against an ungated function is testing nothing.

**Deno**: as Phase 2. **Frontend**: vitest for the roster-union logic; jest-expo for the
walk-in form. **UI driver** `verify-trial-onboarding.mjs`: coach adds a walk-in → marks a
paid trial → admin sees unclaimed-and-unbillable → generation **refuses** → settle →
generation succeeds. The refusal is the load-bearing assertion.

---

## Deploy — EXPAND order (migrate first, push last)

Adding only. Backup → `db push --dry-run` → push → **re-verify the remote schema by
dumping it** → `migration list` clean → deploy `generate-invoices` → `functions list` to
confirm the version moved → merge + push → smoke a route only the new build has → CI green.

> ⚠ **RISK 12 — the completeness rule has THREE copies** (`SwimSyncAdmin`, `SwimSyncApp`,
> the Deno engine). **Prohibition: prefer changing the *callers'* student set over the
> shared file.** If the shared file changes at all, it is **three edits** —
> `diff` all three before commit.

---

## Pre-commit gate

A box that cannot be ticked is a **blocker**, not a caveat.

**The three that matter most — none is recoverable after a bad production run:**

- [ ] **RISK 1** — `git diff core.ts` shows only the new query, the new result field, and
      the new seal condition. **The tripwire test proves invoices are byte-identical for a
      tenant with no unclaimed students.**
- [ ] **RISK 4** — calling the RPC twice for one class+date yields exactly one session and
      one attendance row, and `session_date` is never derived from `now()` server-side.
- [ ] **RISK 3** — `tenant_id` is not a parameter; a cross-tenant coach is refused and
      `students` does not grow.

**The rest:**

- [ ] **RISK 2** — engine tests merged first, and the seal test was proven red beforehand.
- [ ] **RISK 5** — the pre-flight dialog names blocking students and settles inline.
- [ ] **RISK 6** — spike 0a passed; the roster union reload assertion is green.
- [ ] **RISK 7** — settlement is reversible and there is no bulk control.
- [ ] **RISK 8** — duplicate name+DOB returns a typed error, not SQLSTATE 23505.
- [ ] **RISK 9** — spike 0b passed; an invited parent lands in the tenant.
- [ ] **RISK 10** — `action_link` was **read** and contains the app's accept URL.
- [ ] **RISK 11** — remote `pg_proc` shows `{postgres, authenticated}` only.
- [ ] **RISK 12** — if the shared rule changed, all three copies diff clean.
- [ ] Deno suite run **twice**; both apps typecheck under the §7.11 stubbed condition.

---

## Graduating to `HANDOVER.md` §7

Two findings outlive this task and belong in §7, which `/session-start` mandates reading:

1. **A SECURITY DEFINER writer is exempt from `pin_student_tenant()`** — the seam is
   `current_user`, so every such function must derive `tenant_id` itself. This generalises
   beyond this RPC to any future one.
2. **`lesson_sessions` now has a second writer.** §6 currently states the attendance save
   is the only one. Update that sentence when this ships, or the next person will trust it.

---

## Deferred to slice 2 (do not build here)

- **Parent self-serve claiming** — tiered matcher (phone → name tokens → nothing), masked
  candidate disclosure, `student_claims`, admin approval queue.
- **Duplicate merge** — constrained to *unclaimed ↔ claimed*, refusing when both rows carry
  attendance. Survivor is the row with the history; the duplicate's better fields are
  copied onto it first; the empty duplicate is hard-deleted with its contents written to
  the audit log (hard delete rather than a tombstone because `students_identity_uniq` would
  otherwise collide with the survivor).

> ⚠ **RISK 13 — slice 1 has no merge tool, so a parent who self-registers before being
> invited creates a duplicate with no in-app remedy.** Accepted with eyes open.
> **Step:** slice 1 adds a **detection-only** warning on the admin Students page (possible
> duplicate: unclaimed X vs registered Y in the same class). **Step:** document the SQL
> remedy in `LOCAL_DEV_GUIDE.md` so it is not re-derived under pressure.

## Explicitly not in scope

- **Revenue reporting** — `BACKLOG.md`. A figure counting trial income and nothing else is
  worse than none: PRD §4.4 records that exact mistake.
- **Cash handling**; **coach-set settlements** — both per the user.
