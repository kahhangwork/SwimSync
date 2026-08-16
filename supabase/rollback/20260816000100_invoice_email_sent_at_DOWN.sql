-- ============================================================
-- ROLLBACK for 20260816000100_invoice_email_sent_at.sql.
-- Plan: docs/plans/INVOICE_EMAIL_RETRY_PLAN.md.
--
-- Drops the invoice_email_sent_at column. Clean: the column is brand new — no
-- FK, policy, view, trigger or generated column references it (⚠ RISK 9). The
-- generate-invoices engine writes it, so deploy the PRIOR engine build before
-- running this, or the engine's stamp UPDATE will error on a missing column
-- (that error is swallowed per-invoice — ⚠ RISK 4 — but avoid it anyway).
--
-- Rehearse: UP then DOWN on a fresh reset must leave supabase test db at its
-- pre-migration totals and the invoices table byte-identical bar this column.
--
-- Run manually (not auto-applied): supabase db reset does NOT run rollback/.
-- ============================================================

BEGIN;

ALTER TABLE invoices
  DROP COLUMN IF EXISTS invoice_email_sent_at;

COMMIT;
