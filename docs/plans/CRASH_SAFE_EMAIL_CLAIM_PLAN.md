# Crash-safe email claim — plan

> **Status: NOT STARTED** (written 2026-09-27 via `/plan-with-confidence`). Wave 1, lane 2 of `BACKLOG.md` →
> *Current build order*. Backlog item: *Crash-safe email claim*. Residual of `INVOICE_EMAIL_RETRY_PLAN.md` ⚠ RISK 1.
> Index: `docs/plans/README.md`.

## 1. The problem

Two email paths use **one column as both the claim and the "sent" marker**:

| Path | Column | Claim | Stuck state today |
|---|---|---|---|
| Invoice **retry** pass | `invoices.invoice_email_sent_at` | `generate-invoices/email.ts` `retryUnsentInvoiceEmails` ~`:526-544` | killed between claim and send → row looks sent; nothing retries it |
| Credit notes | `credit_notes.email_sent_at` | `credit-note-emails/core.ts` `claimNote` ~`:233-247` | (a) killed mid-send, **and** (b) *deliberately* kept on a Resend 5xx / thrown send (`shouldResetClaim`, `email.ts:177-193`, RISK 7 — "may have delivered"). Both render **Emailed** with no Resend button (`creditNoteEmailState.ts:70-72`) and `findUnsentById` refuses them server-side |

Also found (not in the backlog item): the invoice **first send** (`emailCreatedInvoices`, `:400-426`) sends before it
stamps, and `excludeIds` only covers the same invocation — a **concurrent** run's retry pass can claim and send a
just-created invoice, so a parent can get **two** emails.

Package, referral and invite emails keep no sent state, so they have no window (research, 2026-09-27).

## 2. Decisions (settled with the user, 2026-09-27)

- **An email whose outcome is unknown is retried automatically after 15 minutes**, safely: every send carries a Resend
  **`Idempotency-Key`**, so Resend delivers at most one email per key within 24 h
  ([Resend docs](https://resend.com/docs/dashboard/emails/idempotency-keys)). The parent gets exactly one email.
- Credit notes keep their **manual** Resend (no automatic credit-note retry pass — unchanged decision); a stuck claim
  simply becomes Resend-able again after 15 minutes.
- **No new invoice UI** — *unless* §2b's option (a) is chosen, which adds one count + Resend on the Billing months card.

## 2b. OPEN QUESTION for the user — the 24-hour limit (found by review, 2026-09-27)

The "retry safely" decision assumed a stuck email is retried within minutes. **Billing runs are manual** (cron off),
so a stuck invoice email is normally retried at the **next** run — days later, after Resend's 24-hour idempotency
window has lapsed. At that point a retry *can* send a duplicate. Options:

- **(a) Recommended — never auto-retry an unknown-outcome claim older than 24 h.** Credit notes show **"May have been
  sent — Resend anyway?"** (admin decides). Invoices: the Billing months card shows a count, *"1 invoice email may not
  have arrived"*, with a per-invoice Resend. Small new UI; no duplicates without a human choosing one.
- **(b)** Retry anyway after 24 h — a rare duplicate is preferred over a missing email.

Build waits on this answer.

## 3. Design

### 3.1 Data (one migration, root checkout, `db/email-claim`)

- `invoices.invoice_email_claimed_at TIMESTAMPTZ NULL`, `credit_notes.email_claimed_at TIMESTAMPTZ NULL`.
  **No backfill** — NULL is correct for every existing row (§7.171: never blanket-backfill a delivery column).
- `*_sent_at` keeps its meaning but loses its second job: **it is stamped only after a confirmed send.**
- **Column privileges — check before writing, they differ per table:** `credit_notes` gives `authenticated`
  table-level SELECT and no UPDATE, so the new column is readable (the admin UI needs that) and not writable, with no
  column grant needed. **`invoices` gives `authenticated` table-level UPDATE**, so `invoice_email_claimed_at` — and
  `invoice_email_sent_at` today — are client-writable. The migration must REVOKE UPDATE on `invoices` and re-grant an
  explicit column list without the two email columns (coordinate with Roles P11, which touches the same privilege).
  `table_grants.test.sql` must stay green; add a pgTAP check that `authenticated` cannot write either email column.
- **Re-issue resets:** live, **one** function resets `credit_notes.email_sent_at = NULL` on re-issue —
  `handle_attendance_update`, at two sites (the four migration hits are historical bodies; read it with
  `pg_get_functiondef`, §7.40). A re-issue reuses the **same row** with a new `issued_at`. Add a `BEFORE UPDATE`
  trigger on `credit_notes`: **whenever `issued_at` changes**, clear `email_claimed_at` (and `email_sent_at` if the
  function didn't). Pin it with pgTAP. This also stops an in-flight sender from stamping a re-issued note as sent —
  see settle below.
- The **15-minute lease is computed in SQL only.** supabase-js filters cannot express `now() - interval`, so claim and
  discovery go through two small `SECURITY DEFINER` RPCs (`claim_invoice_email`, `claim_credit_note_email`, returning
  the claimed row or nothing) with `GRANT EXECUTE … TO service_role` in the same migration (§7.87 — callable by nobody
  until granted). The admin read gets a computed `claim_fresh BOOLEAN` (a view or RPC), so the browser never compares
  its own clock to the lease.

### 3.2 Claim, send, settle (both functions)

```
claim:   UPDATE … SET claimed_at = now()
         WHERE id = $1 AND sent_at IS NULL
           AND (claimed_at IS NULL OR claimed_at < now() - interval '15 minutes')
         RETURNING id                         -- 0 rows ⇒ someone else holds it; skip
send:    POST api.resend.com/emails  with  Idempotency-Key: invoice/<id>  |  credit-note/<id>/<issued_at epoch>
         (a re-issued credit note is a NEW email — versioning the key by issued_at stops Resend replaying the
          first send or answering 409 for it)
settle:  every settle UPDATE is conditional:  … WHERE id = $1 AND claimed_at = <the value I claimed with>
         (a re-issue or an expired-and-reclaimed row is no longer mine — settle nothing)
         2xx                               → SET sent_at = now(), claimed_at = NULL
         4xx definite refusal / no key /
           no recipient                    → SET claimed_at = NULL          (retryable now)
         409 invalid_idempotent_request    → treat as SENT (the key was already accepted with a
                                             different payload — e.g. a renamed child, RISK 7)
         409 concurrent_idempotent_requests,
           5xx, throw, crash               → leave claimed_at                (lease expires in 15 min)
```

- **Invoice first send** also claims first (same UPDATE) and uses the same key, closing the concurrent-run duplicate.
- Discovery queries (`retryUnsentInvoiceEmails` candidates; `findUnsentBySession`, `findUnsentById`) select
  `sent_at IS NULL AND (claimed_at IS NULL OR expired)`.
- `shouldResetClaim` (credit notes) is retired in favour of the settle table above — its RISK 7 caution is now carried
  by the idempotency key instead of by holding the claim forever.
- Keep the per-row try/catch and "one failure never blocks the rest" behaviour (existing tests pin it).
- `notifyGenerationBlocked` (~`email.ts:641`) is not a claimed send — out of scope.

### 3.3 Admin UI (credit notes only)

`creditNoteEmailState.ts`: a fresh claim (`claimed_at` < 15 min, `sent_at` NULL) renders **"Sending…"** with no
button; an expired claim renders **"Not emailed"** + Resend. The repo select (`creditNotes.repo.ts:41`) adds
`email_claimed_at` — which needs a column `GRANT SELECT` to `authenticated` for the admin read, **not** UPDATE.
`useResend`'s optimistic update sets the claimed state, not the sent state.

## 4. Sequence

1. Migration `db/email-claim` → `supabase test db` → land on `main` **before** Roles migration A (one schema change in
   flight).
2. Worktree (lane 2): edge-function changes + admin credit-note UI.
3. Deploy: migration (already on prod from step 1, dormant) → `supabase functions deploy generate-invoices` then
   `credit-note-emails`, one at a time, `supabase functions list` to confirm → admin app to `main` last.
4. Confirm in the served bundle: grep for "Sending…" (§7.31).

## 5. Tests

- **Deno `generate-invoices`:** a claim older than 15 min is re-claimed and sent once; a fresh claim is skipped;
  first send claims (a concurrent retry cannot double-send — extend the existing RISK 1 two-run test to cover
  first-send vs retry); the `Idempotency-Key` header is `invoice/<id>`; 5xx leaves the claim, 4xx clears it,
  409-invalid stamps sent. The **run-twice rule** applies (§7.15).
- **Deno `credit-note-emails`:** same truth table; `findUnsentById` returns an expired claim and hides a fresh one;
  existing tests updated where they pinned "5xx keeps the claim forever".
- **pgTAP:** new columns carry no `authenticated` write privilege; the re-issue trigger clears `email_claimed_at`;
  `table_grants.test.sql` green.
- **vitest:** `creditNoteEmailState` — fresh claim → Sending…, expired → Resend.
- Each new test proven RED without its fix (§7.25). A literal kill-between-claim-and-send stays untestable; the lease
  expiry is what the tests exercise (by writing an old `claimed_at`).

## 6. Risks

1. **Clock/lease maths in two languages** — do the expiry comparison **in SQL** (`now()`), never in Deno.
2. **Idempotency key reuse after 24 h** — with manual billing runs this is the NORMAL case for a stuck invoice email,
   not a theoretical one. Resolved by §2b.
3. **Edge-function deploy is separate from git** (CLAUDE.md) — confirm with `supabase functions list`.

## 7. Out of scope

Automatic credit-note retry pass; invoice email status UI; claim state for package / invite emails.

## 8. Graduate at `/update-docs`

PRD §7.7 / §7.8 (a stuck email retries after 15 minutes); BACKLOG item struck; a gotcha on idempotency-key 409
semantics if the build confirms them.
