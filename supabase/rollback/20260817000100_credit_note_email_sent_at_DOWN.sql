-- ============================================================
-- ROLLBACK for 20260817000100_credit_note_email_sent_at.sql.
-- Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md.
--
-- Drops the email_sent_at column. Clean: the column is brand new — no FK, policy,
-- view, trigger or generated column references it, and no GRANT was added.
--
-- ORDER MATTERS. The credit-note-emails edge function is the only writer, and both
-- apps call it. Before running this:
--   1. Revert the apps on `main` (the coach app's invoke and the admin Resend
--      button both target the function).
--   2. Delete or redeploy the function — its claim UPDATE errors on a missing
--      column. That error is caught per-note (⚠ RISK 12) so it degrades to "no
--      email sent" rather than a broken attendance save, but avoid it anyway.
-- Dropping the column does NOT lose money or audit data: the credit notes
-- themselves are untouched, and email delivery is best-effort by contract.
--
-- ⚠ The backfill is NOT reversible and does not need to be — the column it wrote
-- is being dropped. Re-running the UP later re-backfills every row as sent, which
-- is the same correct answer it gave the first time.
--
-- Rehearse: UP then DOWN on a fresh reset must leave supabase test db at its
-- pre-migration totals and the credit_notes table byte-identical bar this column.
--
-- Run manually (not auto-applied): supabase db reset does NOT run rollback/.
-- ============================================================

BEGIN;

ALTER TABLE credit_notes
  DROP COLUMN IF EXISTS email_sent_at;

COMMIT;
