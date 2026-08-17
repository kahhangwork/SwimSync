# Credit-note email notifications — plan

_Wave B remaining head (`BACKLOG.md`). Written 2026-08-17 via `/plan-with-confidence`,
hardened via `/plan-review` (a second agent ranked 12 product risks against the live DB;
three of its findings corrected on verification — see "Findings corrected" below).
Inherits the `invoice_email_sent_at` + per-row atomic-claim pattern shipped 2026-08-16
(§8.63, `docs/plans/INVOICE_EMAIL_RETRY_PLAN.md`) rather than inventing a second one._

**Every `⚠ RISK n MITIGATION` block below is a build step, not a caution.** They are
distributed under the step they govern deliberately: a trailing Risks section is read once
at planning time and never again, while the risk is needed forty tool calls later. The
ranked list lives in the session; the executable form lives here.

## Goal

Email the parent when a credit note is auto-issued, so they learn about an adjustment
without opening the app — and so the coach stops fielding "why is my bill different?"
by hand. One email per credit note, sent from a new edge function the coach app calls
after saving attendance, with an admin **Resend** button as the only retry.

## Why the backlog note is insufficient

The backlog item names two mechanisms — `pg_net` from the trigger, or a Supabase DB
webhook — and **both are wrong for this repo**:

- `pg_net` puts a network call inside `handle_attendance_update`, a `SECURITY DEFINER`
  trigger running in the attendance write's own transaction. Latency and failure would
  land on the billing path. It is also **cloud-only**, so the entire send path would
  ship having never run on the local stack.
- A DB webhook is dashboard config, not a migration — invisible to the repo,
  unreproducible locally, and its replay semantics would become load-bearing while
  being untestable.

A third pattern already exists here and neither option was weighed against it:
**`supabase/functions/package-emails/`** — `verify_jwt` ON, caller re-checked against
the row with a service client, every failure a 200 with `{sent:false}`. That is the
shape this follows.

## Settled design decisions (with the user, 2026-08-17)

| Decision | Answer | Consequence |
|---|---|---|
| Send point | **Coach app → new `credit-note-emails` edge function** | Locally testable end to end; no cloud-only config; reuses the package-emails shape |
| Batching | **One email per credit note** | Maps 1:1 onto a per-row `email_sent_at` claim — the exact §8.63 pattern. A digest cannot be claimed with a single-row conditional UPDATE, and a batch claim was already rejected in §8.63 (a mid-run crash strands the tail stamped-as-sent) |
| Retry | **Admin Resend button ONLY** | No `retryUnsentCreditNoteEmails` pass in generate-invoices. Confirmed with the user. ⚠ This choice is what makes RISK 8 sharp — there is no automatic pass to compensate for a lost claim |
| Content | Reference, amount, child/class/date, coach's reason, credit balance, auto-apply line (PRD §5.6) | See RISK 2 and RISK 11 — both the copy and the balance need guards the first draft did not have |
| Coach UX on failure | **Silent** | The normal "Attendance saved" toast. A failed email is not actionable by the coach and is actionable by the admin — the §8.27 reasoning |

## Facts verified against the live schema (not read off a migration)

Per §7.115, function bodies were read from `pg_get_functiondef()`:

- **`credit_notes` has one INSERT path — the `handle_attendance_update` trigger — but it
  is NOT the only writer.** *(Corrected by review; the first draft of this plan claimed a
  single write path.)* The billing engine also **UPDATEs** it: `core.ts:1429`
  (`status='applied'`) and `core.ts:1447` (`status`, `applied_to_invoice_id`,
  `applied_at`). The engine mutates the exact row the email describes, which is the whole
  of RISK 2.
- **Package-funded lines issue NO credit note.** The trigger reverses a
  `package_applications` row and `RETURN NEW`s before the credit-note insert, so those
  cannot email. *(Confirmed by review. Caveat, out of scope: the early return fires even
  when the application only partly covered the line, so a partly-package-funded
  correction issues no cash credit at all.)*
- **The only writer of `attendance` status is the coach app's client-side `.upsert()`**
  (`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx:637`). The admin Attendance page
  is read-only.
- **`credit_notes` grants `authenticated` SELECT only**; `service_role` holds UPDATE.
  `relacl` = `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`
  and **every `pg_attribute.attacl` is NULL**, so the grant is table-level and a new
  column inherits it. `table_grants.test.sql` asserts at **command** level, so a new
  column is invisible to it and it stays green. *(Confirmed by review.)*
- **`credit_notes` has NO unique constraint or index on `invoice_item_id`** — only PK,
  FKs, `credit_notes_status_check`, and `UNIQUE (tenant_id, reference_number)`. This is
  RISK 5.
- **`can_admin_tenant(p_tenant_id)` is `SELECT is_platform_admin() OR is_tenant_admin(p_tenant_id)`.**
  It is therefore **cross-tenant** and is the wrong check for the resend path (RISK 4).
- **`tenant_suspended(p_tenant_id)` reads `suspended_at` only**, and
  **`tenants.suspend` is vestigial** — `boolean`, default `false`, and `suspend_tenant()`
  writes only `suspended_at`. Nothing in the repo sets `suspend`. See RISK 10.
- `RESEND_API_KEY` is a project-level secret already shared by both email functions —
  **no new secret surface**. Keep it that way.
- **The local `credit_notes` table is EMPTY** (`SELECT count(*)` → 0). This is RISK 14.

## Failure contract

Every failure is a 200 with `{sent:false, reason}`. An attendance save, and the credit
note itself, must never look failed because an email was. Bad request → 400; unresolvable
caller → 401; authority refused → 403.

---

## Step 1 — Migration (`db/credit-note-email-tracking`, ROOT checkout)

One schema change in flight at a time; a worktree never authors a migration.

`supabase/migrations/20260817000100_credit_note_email_sent_at.sql`

```sql
ALTER TABLE credit_notes ADD COLUMN email_sent_at timestamptz;

-- ⚠ RISK 1: backfill in the SAME file, never a separate step.
UPDATE credit_notes SET email_sent_at = issued_at;
```

> ### ⚠ RISK 1 MITIGATION — the backfill is part of the migration, not a follow-up
>
> **Ranked #1 by blast radius.** A bare `ADD COLUMN` leaves every credit note ever issued
> at `NULL` → "Not emailed" pill → a working Resend button across the entire history. The
> plausible admin action on deploy day is to clear the list, which emails real parents
> about adjustments from settled, fully-paid months. This is `INVOICE_EMAIL_RETRY_PLAN.md`
> RISK 2 inverted, and this plan inherits the column from that one.
>
> **It cannot be caught locally** — `credit_notes` is empty on the local stack.
>
> - **STEP:** the `UPDATE` above ships in the same migration file.
> - **ASSERTION at deploy:** `SELECT count(*) FROM credit_notes WHERE email_sent_at IS NULL`
>   returns **0** immediately after `db push`. Any other value fails the deploy — stop and
>   investigate, do not proceed to the function.
> - **PROHIBITION:** do NOT split the backfill into a second migration "to keep the DDL
>   clean". Two files present at once is one deploy (§7.49, §7.30), and the window between
>   them is exactly the dangerous state.
> - **STRUCTURAL: yes** — a backfilled column cannot present a Resend button for a
>   historical note.

- **No GRANT, no policy change.** Comment saying why, citing §7.87: `authenticated` holds
  SELECT only and the new column inherits it at table level; `service_role` already holds
  the UPDATE the function needs. A blanket re-grant here would redden `table_grants`.
- `COMMENT ON COLUMN` recording that NULL means "never emailed", that the column is
  **both claim and sent-marker**, and that this is the same bounded-window tradeoff §8.63
  accepted (see RISK 8).
- **Rollback file committed BEFORE the deploy** (§7.93):
  `supabase/rollback/20260817_credit_note_email_sent_at_DOWN.sql`. Rehearse it — running
  the DOWN file is the half that finds the bugs.
- `supabase test db` after applying. Add a pgTAP assertion that `authenticated` still
  cannot UPDATE `credit_notes`, **proven red** by granting it.

---

## Step 2 — `supabase/functions/credit-note-emails/email.ts`

Pure builders + send helper, mirroring `package-emails/email.ts` (which keeps its own
copies of `shell` / `escapeHtml` / `money` / `formatDate` rather than importing — match
that; there is no `_shared` directory).

- `CreditNoteEmailData` — `parentName`, `businessName`, `logoUrl`, `referenceNumber`,
  `amount`, `studentName`, `classTitle`, `sessionDate`, `reason`, `creditBalance`.
- `buildCreditNoteSubject` / `buildCreditNoteHtml`.
- `authorizeCreditNoteEmail(mode, ctx, caller)` — **pure decider, unit-tested away from
  `Deno.serve`**, exactly as `authorizePackageEmail` is.
- `sendCreditNoteEmail` — same signature and `SendResult` as `sendPackageEmail`.
- `isSendableNote(note)` — pure predicate for RISK 2.
- `canEmailForTenant(t)` — pure predicate for RISK 10.
- `resetOnReason(reason)` — pure predicate for RISK 7.

> ### ⚠ RISK 6 MITIGATION — the builder takes ONLY snapshot fields
>
> §7.155 was written for exactly this feature: *"if an invoice-resend feature is ever
> built, it MUST read `invoice_items.student_name`, not `students.full_name`."* A resend
> is precisely what this is. `rename_student` (2026-08-14) and class hand-over (§7.152)
> both make a live join wrong: a renamed child or re-titled class makes the resent email
> contradict the credit note and the invoice the parent is holding.
>
> - **PROHIBITION, named at the top of `email.ts`:** the send query reads
>   `credit_notes.student_name` and `invoice_items(class_title, session_date)` via
>   `credit_notes.invoice_item_id`. It must **NOT** select `students.full_name`,
>   `classes.title`, or `lesson_sessions.session_date`.
> - **STRUCTURAL STEP:** make `CreditNoteEmailData` carry only scalars and have the
>   builder accept **no** row object. A `students` row cannot be passed in, so the wrong
>   name cannot be reached.
> - **ASSERTION:** a test that renames the student between issue and resend still emails
>   the **original** name. Pass = snapshot name; fail = new name.
> - **STRUCTURAL: yes**, once the builder takes scalars only.

> ### ⚠ RISK 11 MITIGATION — two labelled numbers, never one
>
> The balance is a per-`(parent, tenant)` **aggregate** — the trigger does
> `credit_balance = credit_balance + EXCLUDED.credit_balance`. So two $30 notes from one
> rained-off lesson produce two emails both saying "your balance is now S$60.00", which a
> parent reasonably reads as $120. Separately, the parent's own app **pools across
> tenants**: `SwimSyncApp/app/(parent)/home/index.tsx:154` sums `credit_balance` over
> every tenant row, so the app's figure and a per-business email figure diverge the day a
> parent belongs to two businesses (identical for every production parent today).
>
> - **STEP:** the copy renders two distinctly labelled lines — "This credit note:
>   S$30.00" and "Total credit with {businessName}: S$60.00 (includes this and any earlier
>   credits)". The business name in the balance line is not decoration; it is what makes
>   the number unambiguous against the app's pooled total.
> - **ASSERTION (unit):** `buildCreditNoteHtml` renders both lines **even when
>   `amount === creditBalance`**. Pass = two lines; fail = one.
> - **STRUCTURAL: partly** — make `amount` and `creditBalance` both required
>   non-optional fields so the template cannot omit either.

> ### ⚠ RISK 13 MITIGATION — no UTC date arithmetic anywhere in this feature
>
> `credit_notes.issued_at` is `timestamptz`. The admin page already does
> `cn.issued_at?.split("T")[0]` (`SwimSyncAdmin/app/(admin)/credit-notes/page.tsx:58`) —
> the §7.7 pattern, a day early before 08:00 SGT. That is a display bug on a screen today;
> in a parent-facing email it is worse.
>
> - **PROHIBITION:** no `.toISOString()`, `.split("T")[0]`, or `.slice(0,10)` on
>   `issued_at` in any new code. Dates in the email come from `invoice_items.session_date`
>   (a real `date`) through the copied `formatDate` string parser.
> - **STEP:** do not display an issue date in the email at all — the lesson date is the
>   one the parent cares about. Nothing to get wrong.
> - **STRUCTURAL: yes**, by omission — the unsafe field is never read.

---

## Step 3 — `supabase/functions/credit-note-emails/index.ts`

`Deno.serve`, `verify_jwt` ON (no `config.toml` entry needed — `package-emails` has none
and defaults ON).

Body is **one of** `{ lesson_session_id }` (coach path) or `{ credit_note_id }` (admin
Resend path). Anything else → 400.

1. Resolve the caller from the `Authorization` header via an anon client (`auth.getUser`).
2. Gather authority inputs **as the caller** (`anon.rpc(...)`, never the service client),
   then let `authorizeCreditNoteEmail` rule.
3. Gate on tenant suspension (RISK 10).
4. Select candidates with the service client (RISK 3 filter, RISK 2 + RISK 5 guards).
5. Per note: claim → send → conditional reset (RISK 7, 8, 12).
6. Respond `{ sent: n }`.

> ### ⚠ RISK 3 MITIGATION — the session-path select MUST carry a tenant filter
>
> The candidates are selected with the **service client**, which bypasses RLS, while
> authority was checked against the *session*. `core.ts:1400-1409` says of its own
> equivalent query: *"This filter is the only thing preventing it — service_role bypasses
> RLS."* And `credit_notes.tenant_id` comes from `invoices.tenant_id` with a fallback to
> `students.tenant_id`, so it can in principle diverge from `session_tenant()`.
>
> - **STEP:** add `.eq("tenant_id", sessionTenantId)` — using the value from the
>   `session_tenant` RPC already called for authz — to the session-path select.
> - **ASSERTION:** a fixture note whose `tenant_id` differs from
>   `session_tenant(lesson_session_id)` produces **0** sends.
> - **STRUCTURAL: yes** — the row cannot be selected.

> ### ⚠ RISK 4 MITIGATION — the resend path uses `is_tenant_admin`, NOT `can_admin_tenant`
>
> `can_admin_tenant` = `is_platform_admin() OR is_tenant_admin(...)` (verified from
> `pg_get_functiondef`). The Credit Notes page issues an **unfiltered** select and relies
> on RLS, which grants a platform admin every row. So the operator on
> `admin.swimsync.sg` could send email `From: <that business>` to another business's
> parents. Combined with RISK 1, day one would present a cross-tenant list of "Not
> emailed" rows with a working button.
>
> - **STEP:** the note path requires `is_tenant_admin(note.tenant_id)` specifically.
> - **PROHIBITION:** do NOT use `can_admin_tenant` on the resend path, and do not "fix" a
>   platform admin's 403 here by widening it — a platform admin has no business sending
>   mail in a tenant's name.
> - **STEP (UI):** render the Resend button only when the current user is a tenant admin
>   of that note's tenant.
> - **ASSERTION:** a platform-admin JWT resending another tenant's note gets 403 /
>   `{sent:false}` and **0** sends.
> - **STRUCTURAL: yes** server-side; the UI half is cosmetic.

> ### ⚠ RISK 2 MITIGATION — refuse any note that is not virgin
>
> **Ranked #2.** The engine flips `status='applied'`, sets `applied_to_invoice_id` /
> `applied_at`, and decrements `credit_balance`. A resend then renders "your credit
> balance is now S$0.00" plus the mandated auto-apply line — for a credit already
> consumed. **Partial consumption is worse:** `credit_applications` lets a $30 note be
> half-spent while `status` stays `'available'` (`core.ts:1437-1445`), so the note looks
> resendable and the quoted balance bears no relation to it. A real parent is told they
> hold credit they have already spent, and may under-pay.
>
> - **STEP:** `isSendableNote` returns false if `applied_to_invoice_id IS NOT NULL`, or
>   `status <> 'available'`, or **any** `credit_applications` row exists for the note.
>   Applies to the note path and the session path alike. Return
>   `{sent:false, reason:"already applied"}`.
> - **ASSERTION:** a fixture note with one `credit_applications` row produces **0** sends.
>   Pass = 0; fail = 1.
> - **STRUCTURAL: yes** for the guard. The copy staying honest still depends on the
>   author, so keep the auto-apply line inside the same branch as the guard.

> ### ⚠ RISK 5 MITIGATION — never email the same invoice line twice
>
> A re-toggled correction issues a **second** credit note and **double** credit.
> `present→absent` issues note #1 and adds `+amount`; `absent→present` reverses nothing;
> `present→absent` again re-enters the same branch and inserts note #2 with a fresh
> reference, adding `+amount` again. Verified: **no unique constraint or index on
> `invoice_item_id`**. A parent gets $60 of credit for one $30 lesson — silently today,
> and as two emails quoting a $60 balance after this ships. **The email turns a latent
> data bug into a written promise.**
>
> - **STEP:** the candidate select skips any note whose `invoice_item_id` already has
>   another note with `email_sent_at IS NOT NULL`. One invoice line, one email, ever.
> - **STEP:** add a `BACKLOG.md` item for the underlying duplicate-note guard (a unique
>   index on `credit_notes(invoice_item_id)` plus a decision on what the trigger should do
>   on re-correction) **before this ships**, so the data bug is filed rather than absorbed.
> - **PROHIBITION:** do NOT fix the trigger in this plan. It is a billing-path change with
>   its own blast radius and belongs in its own migration, one at a time (§7.55).
> - **ASSERTION:** two notes on one `invoice_item_id` → exactly **1** send.
>
> **⚠ "EVER" WAS OVER-CLAIMED. Corrected 2026-08-17 after review.** The guarantee is
> *one email per line per run*, plus a best-effort cross-run check. A condition evaluated
> **before** the claim is not a claim: two notes on one line, with a coach save and an
> admin Resend firing together, both read the set as empty and then claim **different
> rows** — so both claims succeed and two emails go out. Mitigated by re-reading the line's
> stamps *after* our own claim and backing out if another note also holds one, which
> narrows the window to the interval between the two claims but cannot close it.
> - **STRUCTURAL: partly.** Closing it fully needs a partial unique index on
>   `credit_notes(invoice_item_id) WHERE email_sent_at IS NOT NULL`, filed with the
>   duplicate-note item in `BACKLOG.md`. The double credit itself is deferred there too.

> ### ⚠ RISK 10 MITIGATION — gate on `tenant_suspended()`, and do NOT read `tenants.suspend`
>
> A suspended business is dark: `credit_notes_select` denies the parent visibility when
> `tenant_suspended(tenant_id)`, so emailing them would describe a credit they cannot see
> in the app.
>
> **The review proposed reading both `suspended_at` and the `suspend` boolean. That is
> wrong and is not being done.** Verified: `tenants.suspend` is **vestigial** — `boolean`,
> default `false`, and `suspend_tenant()` writes only `suspended_at`. Nothing in the repo
> sets it. Encoding a dead column into new code would give it false authority.
>
> **⚠ THIS STEP AS ORIGINALLY WRITTEN SHIPPED A BUG. Corrected 2026-08-17 after review.**
> It said "call the existing `tenant_suspended(tenant_id)` helper", and that was done —
> from the SERVICE client, which holds **no EXECUTE on it**:
> `proacl = {postgres=X,authenticated=X}`, and `SET ROLE service_role; SELECT
> tenant_suspended(...)` → `permission denied`. The code discarded the RPC's `error`, so
> `data` was null, `null === true` was false, and the gate concluded "not suspended" on
> **every invocation**. The mitigation was dead code; `canEmailForTenant` was never at
> fault — its input always said false. No test could see it, because the gate lived in the
> `Deno.serve` closure (see RISK 3's note in Step 6).
>
> - **STEP:** read the **column** with the service client — `fetchTenantSuspended` in
>   `core.ts`, mirroring `generate-invoices/core.ts:275-285` — and **fail closed**: an
>   unreadable tenant row returns null, which must not send.
> - **PROHIBITION:** do NOT fix this by granting EXECUTE to `service_role` (§7.87). A
>   plain column read needs no new privilege; `service_role` already holds SELECT on
>   `tenants`.
> - **ASSERTION:** three integration tests — live → false, `suspended_at` set → true,
>   unknown tenant → null. Proven red against the RPC form (2 of 3 fail).
> - **PROHIBITION:** do NOT read `tenants.suspend` in this feature.
> - **STEP:** file a `BACKLOG.md` note that `tenants.suspend` is vestigial and should be
>   dropped, so the next person does not read it either.
> - **ASSERTION:** a tenant with `suspended_at` set produces **0** sends.
> - **NOTE:** `auto_disabled` is deliberately NOT a gate here. It concerns whether the
>   billing run may proceed; it says nothing about whether a business is dark. §8.63's
>   `shouldRetryTenantEmails` takes a *generate-invoices result string* and has nothing to
>   inherit on this path — the first draft of this plan was wrong to say it did.

> ### ⚠ RISK 7 MITIGATION — reset only on provably pre-send reasons
>
> `sendPackageEmail` — the shape being copied — returns `{sent:false, reason: e.message}`
> on **any** `fetch` throw, including a timeout after Resend already accepted and
> delivered. A blanket reset then makes the pill reappear, the admin presses Resend, and a
> real parent gets the same email twice. The atomic claim prevents *concurrent*
> duplicates; it does nothing here.
>
> - **STEP:** `resetOnReason(reason)` returns true only for provably pre-send reasons —
>   missing API key, missing recipient, and an HTTP **4xx** from Resend. On a thrown
>   `fetch` error or a **5xx**, leave the claim stamped and log it: treat it as
>   *sent-unknown*, not *not-sent*.
> - **ASSERTION:** a stubbed `fetch` that throws leaves `email_sent_at` **non-NULL**; a
>   stubbed missing-recipient leaves it **NULL**.
> - **STRUCTURAL: yes** — the reset is gated on a closed set of reasons.

> ### ⚠ RISK 8 MITIGATION — the claim window's safety net does not exist; build one
>
> **The first draft of this plan was factually backwards.** It said a crash between claim
> and send leaves the admin seeing "Not emailed", "which is exactly the state the button
> exists for". The claim **sets** `email_sent_at = now()`, so a claimed-then-crashed note
> renders as **emailed**: a permanently lost email, invisible on the page and unreachable
> by Resend. The precedent tolerated this only because
> `retryUnsentInvoiceEmails` runs on every invocation — and this plan deliberately has no
> such pass.
>
> - **STEP:** wrap claim→send in `try/finally` so any throw after a successful claim
>   resets `email_sent_at` to NULL before propagating. Combine with RISK 7: the `finally`
>   handles throws, `resetOnReason` handles returned failures.
> - **ASSERTION:** a test where `sendCreditNoteEmail` **throws** leaves the row's
>   `email_sent_at` **NULL**. Pass = NULL; fail = timestamp.
> - **STEP:** correct the `COMMENT ON COLUMN` text from Step 1 to say what is actually
>   true — a process kill between claim and send loses that email silently.
> - **STRUCTURAL: yes** for throws; **no** for a process kill. That residue needs the
>   separate `claimed_at` column already in `BACKLOG.md`; add a line to that item noting
>   credit notes now share the exposure.

> ### ⚠ RISK 12 MITIGATION — one try/catch PER NOTE, inside the loop
>
> The claim is a raw `UPDATE` and can throw — a transient DB error, or
> `column "email_sent_at" does not exist` if the function is ever deployed ahead of the
> migration. With a single outer `try`, the first throw silently drops every remaining
> parent in a rained-off class. This is verbatim `INVOICE_EMAIL_RETRY_PLAN.md` RISK 4,
> whose pre-commit gate required stamping in a separate loop with its own `try/catch`.
>
> - **STEP:** each note's claim + send + reset sits in its own `try/catch` inside the
>   loop. The outer `try` stays as the last resort only.
> - **ASSERTION:** a test where note #1's claim rejects still sends notes #2..N.
>   Pass = N−1; fail = 0.
> - **STRUCTURAL: yes.**

---

## Step 4 — Coach app (`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx`)

> ### ⚠ RISK 9 MITIGATION — hold the screen for the request; do not fire into a unmount
>
> The first draft framed a dropped send as exceptional ("a crash between save and POST").
> It is the **normal** path: `showToast("Attendance saved.")` is followed on the next line
> by `leaveScreen()` → `router.replace` (`attendance.tsx:710-711`, `:161-163`), and a coach
> poolside locks the phone within a second. Backgrounding suspends the in-flight fetch on
> native; closing the tab aborts it on RN-web. If dropping is common, "Not emailed"
> becomes the default state, the pill loses all signal, and admins mass-Resend — which
> feeds RISK 1 and RISK 2. The cited precedent
> (`SwimSyncApp/app/(parent)/billing/index.tsx:320-329`) fires then `await`s `loadData()`
> before navigating; **it holds the screen and the coach path does not.**
>
> - **STEP:** `await Promise.race([invoke, timeout(3000)])` **before** `leaveScreen()`,
>   swallowing every error and showing the same toast either way. The save is already
>   committed, so the await risks nothing but up to 3s of a spinner the coach is already
>   looking at.
> - **ASSERTION (jest-expo):** `leaveScreen` is not called until the invoke promise has
>   settled or the timeout has fired.
> - **STRUCTURAL: yes** — ordering navigation after the request makes the common-case drop
>   impossible.

Placement and shape:

```ts
// After the attendance upsert's success check (~line 645), before leaveScreen().
await Promise.race([
  supabase.functions
    .invoke("credit-note-emails", { body: { lesson_session_id: finalSessionId } })
    .catch(() => {}),
  new Promise((r) => setTimeout(r, 3000)),
]);
```

- **Silent on failure** — the decided behaviour. Nothing is reported to the coach.
- **Only on a successful upsert.** A failed save issues no credit note.
- `Alert.alert` is a no-op on RN-web — irrelevant here precisely because nothing is
  reported. **PROHIBITION:** do not later "improve" this into an alert.

---

## Step 5 — Admin Credit Notes page (`SwimSyncAdmin/app/(admin)/credit-notes/page.tsx`)

- Select `email_sent_at` alongside the existing columns (no grant needed — table-level
  SELECT covers a new column).
- Show a **Not emailed** pill where it is NULL, and a **Resend** button invoking the
  function with `{ credit_note_id }`, then refresh.
- Disable while in flight; on `{sent:false}` show the reason inline (web page → inline
  error, not an Alert).
- **Per RISK 4:** render Resend only for a tenant admin of that note's tenant.
- **Per RISK 2:** do not render Resend for a note that is applied or partly applied — show
  the applied state instead. The server refuses it anyway; this stops the admin trying.
- Keep the state derivation pure and vitest it.

---

## Step 6 — Tests

> ### ⚠ RISK 14 MITIGATION — fixtures must drive the TRIGGER, never insert a note
>
> The local `credit_notes` table is **empty** (`SELECT count(*)` → 0). A fixture that
> `INSERT`s a credit note directly proves nothing about the path that actually fires, and
> would silently pass even if the trigger's conditions never matched.
>
> - **STEP:** every fixture creates its credit note by **editing attendance on an
>   already-invoiced lesson**, the way production does.
> - **ASSERTION:** the fixture helper throws if the edit produced **0** `credit_notes`
>   rows — a vacuous fixture fails loudly instead of passing quietly (§7.73's family).
> - **STRUCTURAL: yes** — the helper cannot return a fixture it did not actually create.

- **Deno** — new `credit-note-emails/email.test.ts`, appended to the `deno test` list in
  `supabase/functions/generate-invoices/test.sh` (where `../package-emails/email.test.ts`
  already lives). Cover both authorize modes and their refusals, `isSendableNote`,
  `canEmailForTenant`, `resetOnReason`, the builders, `sendCreditNoteEmail`'s missing-key
  and missing-`to` paths, and the claim's zero-rows-back skip.
  **Run the suite TWICE** (§7.15) — a completing run seals a billing month.
- **pgTAP** — the `authenticated`-cannot-UPDATE assertion from Step 1.
- **vitest** — the admin page's "Not emailed" derivation and the RISK 4 / RISK 2 button
  visibility.
- **jest-expo** — the RISK 9 ordering assertion, and that the invoke fires only on a
  successful save.
- **Prove every test red without the fix** (§7.25).
- `npm run typecheck` in both apps; `deno check` on the new function.

---

## Step 7 — Deploy (later, on the user's word)

**Backend-first, apps LAST** (§7.60 — got wrong twice). The apps call a function that must
already exist:

1. **RISK 1 pre-flight:** `SELECT count(*) FROM credit_notes;` on production **before**
   the migration, and record it. §8.63 did the equivalent count and it is what made that
   deploy safe.
2. `supabase db push` → confirm `supabase migration list --linked` shows `remote` filled.
   Do **not** trust `db push`'s own output (§7.30; the `pgdelta` stack trace is normal).
3. **RISK 1 gate:** `SELECT count(*) FROM credit_notes WHERE email_sent_at IS NULL` must
   return **0**. Anything else stops the deploy here.
4. `supabase functions deploy credit-note-emails` → confirm with
   `supabase functions list`. One at a time; a git push deploys none of them.
5. **Remote grant dump** even though no GRANT was written (§7.39, §7.89,
   `docs/DEPLOYMENT.md` §11.7) — local and cloud disagree by construction.
6. Push to `main` LAST (that is the app deploy). Then grep the served bundle for a
   user-visible string only the new build has — **a 200 proves nothing** (§7.31, §7.51).
7. Expect it **DORMANT for the coach half only**: no credit note has been issued on
   production since July was billed and every July invoice is Paid, so the first firing is
   the first post-billing attendance edit. **The admin half is NOT dormant** — it is live
   against whatever history exists, which is why RISK 1's backfill is a deploy gate.
   Record both halves in HANDOVER §3's DORMANT list with that distinction.

---

## Pre-commit gate — walk every box before committing

**The three that can reach a real parent's inbox with something false. A box that cannot
be ticked is a blocker, not a caveat.**

- [ ] **RISK 1** — backfill `UPDATE` is in the same migration file; the post-push
      `count(*) WHERE email_sent_at IS NULL` = 0 check is written into the deploy steps.
- [ ] **RISK 2** — `isSendableNote` refuses applied *and partly applied* notes; the
      `credit_applications` check is present, not just `status`.
- [ ] **RISK 3** — the session-path select carries `.eq("tenant_id", sessionTenantId)`.

Then the rest:

- [ ] **RISK 4** — resend path uses `is_tenant_admin`, not `can_admin_tenant`; platform
      admin gets 403.
- [ ] **RISK 5** — one email per `invoice_item_id`, ever; duplicate-note backlog item filed.
- [ ] **RISK 6** — builder takes scalars only; no `students` / `classes` /
      `lesson_sessions` join in the send query; rename test passes with the snapshot name.
- [ ] **RISK 7** — `resetOnReason` resets only on missing key, missing recipient, 4xx.
- [ ] **RISK 8** — `try/finally` resets a claimed row on throw; the `COMMENT ON COLUMN`
      says what is actually true; the `claimed_at` backlog item mentions credit notes.
- [ ] **RISK 9** — navigation happens after the invoke settles or 3s elapses; jest-expo
      pins the ordering.
- [ ] **RISK 10** — gated on `tenant_suspended()`; `tenants.suspend` is NOT read;
      vestigial-column backlog note filed.
- [ ] **RISK 11** — two labelled numbers, rendered even when equal; business named in the
      balance line.
- [ ] **RISK 12** — per-note `try/catch` inside the loop; note #1 failing still sends #2..N.
- [ ] **RISK 13** — no `.toISOString()` / `.split("T")[0]` / `.slice(0,10)` on `issued_at`.
- [ ] **RISK 14** — fixtures drive the trigger; the helper throws on a vacuous fixture.
- [ ] Deno suite green **twice**; pgTAP green; both apps typecheck; `deno check` clean.
- [ ] Every new test **proven red** without its fix.

## Graduate to GOTCHAS on landing

Next free numbers are **§7.172** onward (§7.171 is the newest). These outlive the plan file
and belong where `/session-start` mandates reading them:

- **Adding a nullable `*_sent_at` column to a table with history ARMS every historical row.**
  The backfill is part of the migration. Generalises §8.63's RISK 2 to any future
  tracking column, and it cannot be caught on a local stack whose table is empty.
- **`can_admin_tenant` includes `is_platform_admin()`** — so it is the wrong check for
  anything that sends mail, or acts, in a single tenant's name. Use `is_tenant_admin`.
- **`tenants.suspend` is vestigial; `suspended_at` via `tenant_suspended()` is the truth.**
  Written so the next person does not read the dead column.
- **A re-toggled attendance correction issues a SECOND credit note and doubles the credit** —
  no unique constraint on `credit_notes(invoice_item_id)`. Currently silent; record it
  even though the fix is deferred.
- **Why the send point is the coach app and not `pg_net` / a DB webhook**, with the
  cloud-only-is-untestable reasoning.
- **`credit_notes` grants `authenticated` SELECT only** — why the column needed no GRANT,
  and the warning not to "fix" a future `permission denied` here with a re-grant.
- **A fire-and-forget invoke followed immediately by `router.replace` is a dropped
  request, not a background one.** The parent billing screen holds its screen; the coach
  attendance screen did not.
