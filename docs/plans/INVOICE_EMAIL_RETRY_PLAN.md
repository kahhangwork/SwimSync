# Invoice-email delivery tracking + retry — plan

_Backlog: "Track invoice-email delivery + retry" (Wave B head). Design B (real retry), not
the one-line backlog note (which does nothing on a sealed month)._

## Goal

A dropped invoice-email self-heals: re-running **Generate invoices** for the same month
re-sends only the misses — **even on a sealed month** — with no duplicate to any parent who
already received theirs.

## Why the one-line backlog note is insufficient

`emailCreatedInvoices` only ever receives `result.created` — invoices created *this run*. On
a re-run the month is sealed (`core.ts:317` returns `already_complete`, creates nothing), so
`created` is empty and there is nothing to filter. Real retry must source the send set from
the DB (`invoice_email_sent_at IS NULL`), rebuilding the payload from `invoices` +
`invoice_items`.

## Settled design decisions

- **Scope:** the `(tenant_id, billing_month)` being run — not a cross-month sweep. (User.)
- **Triggers:** both manual and auto (cron) runs. (User.)
- **Retries only send-time failures** Resend rejects (`resend_NNN`, `fetch_error`). NOT
  accepted-but-bounced/spam — that needs delivery webhooks (separate backlog item).
- **Additive, not unifying:** keep `emailCreatedInvoices` (happy path) behavior identical;
  ADD a separate retry pass. Unifying both into one DB-sourced send was rejected to keep the
  happy path's blast radius zero.
- **Backfill existing rows to `generated_at`** (not `now()`) — pre-feature invoices count as
  already-sent so no future re-run re-emails them.
- **`no_recipient` (parent has no email) keeps retrying harmlessly** — near-impossible in
  prod (parents self-register by email); the send is a logged no-op.
- **Auto-heal window is ONE month** (consequence of the chosen scope, not a defect): the cron
  always runs the *previous* month, so an unsent invoice only auto-retries while it stays
  "previous month" (~30 days). A miss discovered later needs a **targeted manual run for that
  specific month** — the cron will NOT eventually catch it. (Plan-review #10.)

## Failure contract (confirmed, `email.ts:246`)

`sendInvoiceEmail` never throws. Returns `{sent:false, reason}` for `no_api_key` /
`no_recipient` / `resend_NNN` / `fetch_error`; `{sent:true}` on HTTP 200. **Stamp
`invoice_email_sent_at` iff `sent === true`.**

---

## Step 1 — Migration (`db/invoice-email-tracking`, root checkout)

- `ALTER TABLE invoices ADD COLUMN invoice_email_sent_at timestamptz;` (nullable).
- Backfill (see ⚠ RISK 2 — the WHERE clause is load-bearing).
- Committed rollback DOWN (`supabase/rollback/`), rehearsed UP→DOWN→UP.
- `supabase test db` + `table_grants.test.sql` green.

> **⚠ RISK 2 MITIGATION — a blanket backfill can permanently seal genuine live misses.**
> Invoice email shipped **2026-07-16** (§8d). Every invoice generated since then whose send
> silently failed (best-effort, swallowed at `email.ts:358`) is a generated-but-unsent row
> with no record of the miss. `SET … = generated_at` for ALL rows marks those as sent, so the
> first live re-run treats them as done — the exact failure this feature exists to fix.
> **STEP (at deploy):** first run `SELECT billing_month, status, count(*) FROM invoices WHERE
> generated_at >= '2026-07-16' GROUP BY 1,2` on prod. **DECISION, made against that count, not
> defaulted:** the recommended default here is still a **blanket backfill of ALL existing rows**
> — because every existing month is already billed and July is fully collected (S$0
> outstanding, HANDOVER §9), so re-emailing a settled/paid invoice is pure noise, not a heal.
> Only leave post-launch rows NULL (`WHERE generated_at < '2026-07-16'`) if the prod count shows
> unpaid post-launch invoices the user wants chased by email. **ASSERTION:** after backfill,
> `count(*) WHERE invoice_email_sent_at IS NULL` equals the intended target (0 for blanket; the
> post-launch count if scoped) — never an accidental value. `generated_at` is `NOT NULL DEFAULT
> NOW()` (`20260309000100:173`), so the backfill never writes NULL.

> **⚠ RISK 8 (grants) — CONFIRMED NON-ISSUE, do NOT add a grant.** A nullable column changes no
> policy and no grant; `table_grants.test.sql` asserts at command level, and `invoices` already
> has select/update policies + backing grants (`20260718000900:404`). Engine touches the column
> only as `service_role`. Still take the remote grant dump (§7.39/§7.89) as due diligence — it
> must come back a **clean no-op**. §7.87 is NOT triggered — you are adding no grant.

> **⚠ RISK 9 (migration safety) — CONFIRMED SAFE.** `ADD COLUMN … timestamptz` nullable no-default
> is metadata-only (no table rewrite). The backfill UPDATE takes a row-exclusive lock (doesn't
> block reads); invoice count is small. `DROP COLUMN` rollback is clean — no FK/policy/view/trigger
> references the new column.

## Step 2 — `email.ts`

- Extract `sendInvoicesAndStamp(supabase, invoices: CreatedInvoice[], opts)`: send each; on
  `sent===true`, `UPDATE invoices SET invoice_email_sent_at = now() WHERE id = ?`.
- `emailCreatedInvoices` delegates to it (behavior identical + now stamps).
- New exported `retryUnsentInvoiceEmails(supabase, tenantId, billingMonth, opts)` — see
  ⚠ RISK 1 for the atomic-claim query; rebuild `CreatedInvoice[]` from `invoices` +
  `invoice_items`; return count retried.

> **⚠ RISK 4 MITIGATION — the stamp UPDATE must not abort the batch.** Today the happy-path
> loop (`email.ts:333`) continues past any send failure because `sendInvoiceEmail` never throws.
> A raw stamp UPDATE *can* throw (transient DB error; or "column does not exist" if deployed
> before the migration), and the only catch is the outer `try` at `:290`, which exits the WHOLE
> loop — silently dropping every parent after the failure point. **STEP:** wrap each stamp
> UPDATE in its own `try/catch` that logs and continues, mirroring the send-failure
> `console.log` at `:356`. A stamp error must never escape the per-invoice iteration.
> **ASSERTION:** a test where invoice #1's stamp rejects still produces Resend sends for
> #2..N (pass = N sends, fail = 1).

> **⚠ RISK 7 MITIGATION (reconstruction fidelity) — NAMED PROHIBITION.** `emailCreatedInvoices`
> resolves student *names* LIVE from `students.full_name` (`email.ts:324`), NOT from the
> `invoice_items.student_name` snapshot (`20260719001600`). The retry reconstruction MUST
> resolve names the same live way — do **not** read `invoice_items.student_name`, or a renamed
> student renders differently between first-send and retry. All other fields (`gross_amount`,
> `package_applied`, `credit_applied`, `net_amount`, item `session_date`/`class_title`/`amount`)
> are faithfully reconstructable and confirmed present.

## Step 3 — `index.ts`

- After the existing email step, iterate `(result.per_tenant ?? [result])`; for each with a
  `tenant_id` **and an allowed `status`** (see ⚠ RISK 3), call
  `retryUnsentInvoiceEmails(tenant_id, billing_month, {excludeIds})` — runs even on
  `already_complete`. Best-effort, never throws.
- Add `emails_retried` to the JSON response.

> **⚠ RISK 1 MITIGATION — concurrent runs must not double-email (highest blast radius).** The
> retry pass runs on EVERY invocation, including the instant `already_complete` short-circuit
> (`core.ts:317`). A double-clicked Generate button, or the daily cron overlapping a manual run,
> has both invocations read the same `IS NULL` set before either stamps → every unsent parent
> gets 2+ emails. The upstream double-billing guards do NOT protect this path.
> **STEP — atomic claim, not read-then-send:** `retryUnsentInvoiceEmails` claims the set in one
> statement — `UPDATE invoices SET invoice_email_sent_at = now() WHERE tenant_id=$1 AND
> billing_month=$2 AND invoice_email_sent_at IS NULL [AND id <> ALL($excludeIds)] RETURNING …`.
> Send only to the RETURNING rows; on any `sent===false`, reset that row to NULL so a later run
> retries. A concurrent second run's UPDATE matches nothing → sends nothing.
> **ASSERTION:** two `retryUnsentInvoiceEmails` fired concurrently for one scope produce exactly
> ONE Resend call per invoice (pass = 1, fail = 2).

> **⚠ RISK 5 MITIGATION — same-invocation duplicate.** If a happy-path send returns `sent:true`
> but its stamp write fails (RISK 4), that row stays `IS NULL` and the retry pass would re-email
> it in the SAME invocation. **STEP:** pass `result.created`'s invoice IDs as `excludeIds` into
> the retry claim (the `id <> ALL($excludeIds)` above) — the happy path owns them this run, so
> the retry never touches them regardless of stamp outcome. Also shrinks the RISK 1 window.

> **⚠ RISK 3 MITIGATION — never email for a suspended/disabled tenant. NAMED PROHIBITION.**
> `generateForTenant` returns `tenant_suspended` (`core.ts:285`) and `auto_disabled` (`:295`) as
> normal result shapes carrying `tenant_id`+`billing_month`. Core deliberately gives a suspended
> tenant no new invoicing (`:281`); the retry loop MUST NOT resurrect outbound email for it.
> **STEP:** skip any result whose `status === 'tenant_suspended'` unconditionally, and skip
> `status === 'auto_disabled'` on **auto** runs (a manual run for that tenant is an explicit
> instruction and may proceed). **ASSERTION:** for a `tenant_suspended` result,
> `emails_retried === 0` and zero Resend calls.

## Step 4 — Tests

- **Deno** (`test.sh`, **run twice** — §7.15 sealing: run 1 seals the month, so run 2
  exercises the `already_complete` → DB-sourced retry path, which is the whole point).
- Extend the fetch stub (`core.test.ts:389`) to return **500 for a chosen recipient** (branch
  on parsed `init.body.to`) and 200 for the rest.
- Prove each assertion RED without the fix first (§7.25): with the retry pass deleted, run 2
  sends nothing and the "missed one re-sent" assertion fails.
- Retarget/extend existing `emailCreatedInvoices` tests for stamping.
- `deno check` / function typecheck.

> **⚠ RISK 6 MITIGATION — close the vacuity traps (a green test that proves nothing).**
> The "no duplicate to the already-sent parent" check passes even if retry does nothing, so it
> is NOT sufficient alone. Add these positive assertions:
> - **ASSERTION:** on run 2, the *missed* recipient (the 500 one) receives exactly one Resend
>   call AND its `invoice_email_sent_at` flips from NULL to non-null.
> - **ASSERTION:** a fixture row pre-stamped with `invoice_email_sent_at` produces ZERO Resend
>   calls on any run (proves backfilled rows are never re-emailed).
> - **ASSERTION (RISK 1):** two concurrent retry calls → one Resend call per invoice.
> - **ASSERTION (RISK 4):** stamp-failure on #1 still sends #2..N.
> - **ASSERTION (RISK 3):** `tenant_suspended` scope → zero Resend calls.

## Step 5 — Deploy (later, on user's word)

- No `core.ts` change → engine untouched. Order: migration (`supabase db push`, confirm
  `remote` filled) → `supabase functions deploy generate-invoices` → grant dump. Verify with a
  live re-run showing `emails_retried:0` on a fully-sent month.

**Estimate:** ~1 day (mitigations add ~half a day, mostly the concurrency test + atomic-claim
query).

---

## Pre-commit gate — walk every box before committing

**The three merge-blockers:**
- [x] **RISK 1** — retry uses an **atomic `UPDATE … RETURNING` claim** (`email.ts`
      `retryUnsentInvoiceEmails`, `.is(...,null).select()`); concurrency test proves 1 Resend
      call per invoice under two concurrent runs.
- [ ] **RISK 2 — DEPLOY-TIME** — backfill WHERE clause decided against the **real prod count**.
      Migration ships the blanket default (all rows → `generated_at`, rationale in the file);
      the count query + final decision happen at `db push` time, not now. Asserted local no-op
      (`UPDATE 0` on fresh reset).
- [x] **RISK 4** — stamping moved to a **separate loop after all sends** (structurally cannot
      drop a send) + its own `try/catch`.

**The rest:**
- [x] **RISK 3** — `shouldRetryTenantEmails` skips `tenant_suspended` (always) and
      `auto_disabled` (auto runs); unit-tested in `email.test.ts`.
- [x] **RISK 5** — `result.created` IDs excluded from the retry claim (`excludeIds`); tested.
- [x] **RISK 6** — positive assertions present (missed-one re-sent + stamp flips; reset-on-fail;
      concurrency). Proven RED without the fix (§7.25): the 4 positive-behavior tests fail when
      retry is a no-op / stamp is skipped.
- [x] **RISK 7** — retry reuses `emailInvoices`, which resolves student name LIVE from
      `students` (never `invoice_items.student_name`).
- [ ] **RISK 8 — DEPLOY-TIME** — remote grant dump after push (local `table_grants.test.sql`
      green; no grant added).
- [x] `test.sh` passes **twice** in a row (169/169); `deno check` clean; `supabase test db`
      green bar the pre-declared `coach_disable` date-flake (§8.61), orthogonal to `invoices`.

## Graduate to GOTCHAS on landing

When this ships, promote the durable, non-obvious traps to `docs/GOTCHAS.md` §7 (read every
session by `/session-start`; a plan file is discarded):
- **The retry pass runs on the `already_complete` short-circuit** — a re-run of a sealed month
  is no longer a total no-op; it re-sends unsent invoice emails. Anyone reasoning "sealed month
  ⇒ nothing happens" is now wrong.
- **Best-effort email + a completeness backfill is a trap** — marking historical rows "sent"
  can permanently seal real misses (RISK 2). The pattern recurs for any future delivery-tracking
  column.
- **Atomic-claim, not read-then-send, is mandatory for any DB-sourced send set** invoked from
  both cron and a manual button (RISK 1).
