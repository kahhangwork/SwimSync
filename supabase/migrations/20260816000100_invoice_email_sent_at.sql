-- ============================================================
-- Invoice-email delivery tracking + retry — Migration (Backlog "Wave B" head).
-- Plan: docs/plans/INVOICE_EMAIL_RETRY_PLAN.md.
--
-- Adds a per-invoice "when was the invoice email sent" stamp so a dropped send
-- self-heals: re-running generate-invoices for the same (tenant, month) re-sends
-- ONLY the misses (invoice_email_sent_at IS NULL), even on a sealed month, with
-- no duplicate to parents who already got theirs. The engine (service_role) is the
-- AUTHORITATIVE writer; no client reads this column and it is not UI-exposed, so no new
-- policy or grant is added (⚠ RISK 8 — table_grants.test.sql asserts at command level and
-- stays green). Note it is nonetheless client-WRITABLE by construction: invoices already
-- carries an invoices_update policy + table grant for authenticated (a tenant admin / a
-- coach serving the parent), and grants are not column-scoped — so a tenant member could
-- in principle null it (force a re-email) or set it (suppress one) via a raw PostgREST
-- call. That stays inside the tenant's existing trust boundary (they can already edit
-- their own invoices) and is accepted, not a hole; the deploy-time grant dump confirms it.
--
-- ⚠ RISK 2 — the backfill decides which historical rows count as "already sent".
-- Invoice email shipped 2026-07-16 (§8d), best-effort and swallowing failures,
-- so a month of invoices could be generated-but-never-emailed with NO record of
-- the miss. Marking them "sent" seals those misses permanently.
--   DEFAULT (below): blanket backfill of ALL existing rows to generated_at.
--   Rationale: every existing billing month is already billed and July is fully
--   collected (S$0 outstanding, HANDOVER §9), so re-emailing a settled/paid
--   invoice is noise, not a heal. The feature is forward-looking from launch.
--   BEFORE THE PROD `db push`: run the count query in the plan's RISK 2 step and
--   confirm this decision against real data. If unpaid post-launch invoices need
--   chasing by email, change the WHERE to `generated_at < '2026-07-16'` so those
--   rows stay NULL and the first live re-run heals them.
-- On a fresh local `supabase db reset` this backfill is a no-op: migrations run
-- before seed.sql, so no invoices exist yet.
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN invoice_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.invoice_email_sent_at IS
  'When the invoice email was successfully sent (Resend HTTP 200). NULL = never '
  'sent; the generate-invoices retry pass re-sends NULL rows for the month being '
  'run. Written by the engine (service_role) only. See INVOICE_EMAIL_RETRY_PLAN.md.';

-- Backfill — blanket default (⚠ RISK 2 above). No-op on a fresh local reset.
UPDATE invoices
  SET invoice_email_sent_at = generated_at
  WHERE invoice_email_sent_at IS NULL;
