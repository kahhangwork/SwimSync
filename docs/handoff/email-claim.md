# Worktree — crash-safe email claim (Wave 1, lane 2)

**Branch:** feat/email-claim · **Base:** main @ ee688d9 · **Started:** 2026-09-27
**Plan:** docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md (§3.2, §3.3, §4 steps 2–4, §5) · **Backlog:** Current build order → Wave 1 → *Crash-safe email claim*
**Session:** swimsync-49 builds here. Root session swimsync-5b builds lane 1 (Roles & permissions) in the root checkout.

## Schema already landed — do NOT write a migration here
`20260927000100_crash_safe_email_claim.sql` (ee688d9) is on main and applied to the shared local DB. **Not on prod yet**
(the root session pushes it before any function deploy). What it gives you:
- `invoices.invoice_email_claimed_at`, `credit_notes.email_claimed_at`
- `claim_invoice_email(p_invoice_id, p_manual default false)` → `(claimed_at, prior_state)`, or NO row = not claimed
- `claim_credit_note_email(p_credit_note_id, p_manual default false)` → `(claimed_at, prior_state, issued_at)`, or no row
  - service_role only. Row-locked. Claims UNSENT/RETRYABLE; MAY_HAVE_SENT only when `p_manual`; SENT/SENDING never.
  - `claimed_at` is the SETTLE TOKEN: every settle UPDATE must be `.eq("…claimed_at", token)`. It is the transaction
    `now()` at full microsecond precision and round-trips exactly through PostgREST.
  - `prior_state = 'MAY_HAVE_SENT'` ⇒ the caller must use a NEW Idempotency-Key (`…/manual/<timestamp>`).
  - The claim IS the discovery filter: list `sent_at IS NULL` rows and claim each; SENDING / MAY_HAVE_SENT won't claim.
- `email_delivery_state(sent_at, claimed_at)` → SENT / UNSENT / SENDING (<15m) / RETRYABLE (15m–24h, exactly 15m and
  exactly 24h are RETRYABLE) / MAY_HAVE_SENT (>24h)
- PostgREST computed columns for the admin UI: `select=*,credit_note_email_state` and `select=*,invoice_email_state`
  (filterable too). Never compare claimed_at to the browser clock.
- `authenticated` cannot write either invoice email column (pin trigger); a credit-note re-issue (issued_at change)
  clears its claim + sent stamp.
- **Deviation from plan §3.1:** no column grant, no view (table_grants.test.sql assertion 6 forbids both).

## I own
- `supabase/` — **NO** (migration landed first from root; if you find the schema needs a change, STOP and message
  swimsync-5b — root writes it on a db/ branch)
- `supabase/functions/generate-invoices/**` (email.ts claim/send/settle, Idempotency-Key, first-send claims, tests)
- `supabase/functions/credit-note-emails/**` (claimNote / findUnsent* / shouldResetClaim retirement, tests)
- `SwimSyncAdmin/app/(admin)/credit-notes/**` (creditNoteEmailState.ts, useResend.ts, CreditNotesTable.tsx)
- `SwimSyncAdmin/app/(admin)/invoices/ui/BillingMonthsCard.tsx`, `invoices/domain/useBillingMonths.ts`, and any new
  invoices/ files for the "N invoice emails may not have arrived" list
- A NEW admin route for the per-invoice resend (e.g. `SwimSyncAdmin/app/api/resend-invoice-email/`), gated by
  `is_tenant_admin` for now (Roles re-points it to `billing:edit` — whichever lane lands second)

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root checkout at close
- `drivers/lib.mjs`, `supabase/config.toml` — shared with every worktree
- `lib/lessonDates.ts`, the three copies of `attendanceCompleteness.ts` (ARCHITECTURE §6)
- **Lane 1 (Roles) territory:** `supabase/migrations/**`, `SwimSyncAdmin/app/api/*` EXISTING routes (incl.
  `app/api/generate-invoices/route.ts` — Roles adds `billing:edit` there, P9), admin nav/layout/auth helpers,
  `package-emails`. If you need to change one, message swimsync-5b first.

## Shared DB + ports
- **DB owner: swimsync-5b (root) until it says otherwise.** Do not `supabase db reset`, do not run a UI driver
  (`run-all-drivers.sh --only …` RESETS the DB), without asking swimsync-5b first. `supabase test db` and the Deno
  suite are OK once you have announced them to swimsync-5b.
- Ports: admin **3100**, Expo **8082**. Only ONE `supabase functions serve` per stack — ask before starting it.
- Deploy: you do NOT deploy. Root does migration → `supabase functions deploy generate-invoices` →
  `credit-note-emails` → admin app, in order (plan §4).

## Fixture prefix
`wt-email-claim-` — every row I insert uses it; the teardown deletes by it.

## To graduate at session close (from the ROOT checkout, on main)
- (add findings here as you hit them — gotcha → §7, consequence → the plan, unbuilt idea → BACKLOG, behaviour → PRD)
- PRD §7.7 / §7.8: a stuck email retries after 15 minutes; >24 h shows "May have been sent" (plan §8)
- BACKLOG: strike *Crash-safe email claim*
- Possible gotcha: Resend Idempotency-Key 409 semantics, if the build confirms them
  - CONFIRMED from Resend docs (2026-09-27): header `Idempotency-Key`, ≤256 chars, 24 h retention;
    409 `invalid_idempotent_request` = key already used with a DIFFERENT payload (treated as SENT);
    409 `concurrent_idempotent_requests` = same key in flight (KEEP claim); 400 `invalid_idempotency_key`.
    Same key + same payload returns the original response without re-sending. Told apart by the body's `name`.
  - UNVERIFIED: whether a 4xx-REFUSED request "uses up" its key for 24 h. If it does, a released
    claim's retry gets the same refusal replayed until the key lapses — harmless (it keeps releasing),
    but worth one real-key probe before calling it a gotcha.
- Deviation: the credit-note post-claim sibling re-read (RISK 5 concurrency) was REMOVED —
  UNIQUE(invoice_item_id) (credit_notes_invoice_item_id_key, 20260818000100) makes a second note on a
  line impossible, and the claim no longer stamps sent_at, so the old check could never fire.
- Deviation: the per-invoice resend is a new branch of generate-invoices (`{resend_invoice_email: id}`,
  CRON_SECRET), called from new route app/api/resend-invoice-email (is_tenant_admin AS CALLER) — not a
  new edge function. Roles: re-point to billing:edit. Self-contained auth (does NOT import lane 1's
  lib/adminManagementGate).
- DECISION (user, 2026-09-27, during /commit-review) — SUPERSEDES plan §2's "new key": a human
  resend of a MAY_HAVE_SENT email reuses the ONE key per email (`invoice/<id>`,
  `credit-note/<id>/<issued_at epoch>`). The key has lapsed by then (>24 h), so Resend sends fresh.
  A per-resend key opened a second duplicate path: resend → unknown outcome → RETRYABLE 15 min
  later → auto-retry (or coach re-save) under the lapsed normal key. Plan §2 corrected IN the lane 2
  commit (plan docs are allowed). Graduate: PRD wording if it says "new key". Pinned by
  emailClaim.test.ts "reuses the SAME key".
- FOR ROOT (swimsync-5b): applied migration 20260927000100's header AND the COMMENT ON FUNCTION for
  claim_invoice_email / claim_credit_note_email still say "prior_state MAY_HAVE_SENT ⇒ caller uses a NEW
  key" — now wrong. Applied migrations are immutable; root corrects the two function COMMENTs in a
  later root migration. (This WORKTREE.md's own "Schema already landed" section says the same — stale.)
- SHIPPED 2026-09-27 (swimsync-5b sequenced): generate-invoices v30, credit-note-emails v3, main =
  7d6c979 (admin on Vercel; live credit-notes chunk contains "May have been sent"). Migration
  20260927000100 went to prod earlier with the staff-invitation fix.
- TESTING §5: new suite generate-invoices/emailClaim.test.ts (lease, keys, settle, concurrency,
  MAY_HAVE_SENT resend; in test.sh); vitest undeliveredEmails.test.ts + BillingMonthsCard.test.tsx.
  Deno 251 → 278. KNOWN GAP (§7.25): the new DB-backed Deno tests were NOT mutation-proven red (each
  proof needs a shared-DB run); the admin + pure Deno tests were (6 mutations).
- ARCHITECTURE §10: new file SwimSyncAdmin/app/api/resend-invoice-email/route.ts (CRON_SECRET proxy to
  generate-invoices' {resend_invoice_email} branch).
- Process note: this session's auto-mode classifier refused running test.sh against the shared DB
  ("modify shared resources") even with the DB owner's go — the user ran the suites via `!`. A peer's
  go is not the user's approval; plan for it when a worktree needs DB runs.
- Flaky admin vitest: 1 failure in 5 full `npm test` runs on d98cc46 + lane 2 (929 tests); not
  reproduced in 4 reruns, name not captured. Worth a BACKLOG line if it recurs.
- Small fix in scope: a VOIDED credit note used to render "Emailed" in the Parent-notified column; it
  now reads "Credit voided" (the label existed but was unreachable).
- PRD: credit-note Resend states now include "Sending…" (no button) and "May have been sent —
  Resend anyway?"; Billing months card gains "N invoice emails may not have arrived" + per-invoice Resend.
