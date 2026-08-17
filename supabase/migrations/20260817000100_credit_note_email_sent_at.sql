-- ============================================================
-- Credit-note email notifications — Migration (Backlog "Wave B" remaining head).
-- Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md.
--
-- Adds a per-credit-note "when was the notification email sent" stamp, so the new
-- credit-note-emails edge function can send exactly once per note: the coach app
-- calls it after saving attendance, and the admin Credit Notes page can Resend a
-- note that never went out. NULL = never emailed.
--
-- No new policy and no new GRANT, and unlike the invoice precedent that is not
-- merely "accepted" — it is airtight here. credit_notes grants `authenticated`
-- SELECT and nothing else (relacl = {postgres=arwdDxtm,service_role=arwdDxtm,
-- authenticated=r}, every pg_attribute.attacl NULL), and the only policy is
-- credit_notes_select. So this column is client-READABLE (the admin page needs
-- that) and client-UNWRITABLE: no tenant member can null it to force a re-email or
-- set it to suppress one. Contrast 20260816000100, where invoices' existing
-- update policy + table grant left the equivalent column writable by construction.
-- ⚠ table_grants.test.sql asserts at COMMAND level, so a new column is invisible to
-- it and it stays green (§7.87). NEVER "fix" a permission error here with a
-- re-grant — service_role already holds the UPDATE the edge function needs.
--
-- ⚠ RISK 1 (plan, ranked #1) — THE BACKFILL IS PART OF THIS FILE, NOT A FOLLOW-UP.
-- A bare ADD COLUMN leaves every credit note ever issued at NULL, which the admin
-- page renders as "Not emailed" beside a working Resend button. The plausible
-- action on deploy day is to clear the list, which emails real parents about
-- adjustments to settled, fully-paid months. Every existing note predates the
-- feature and no parent was ever promised an email for one, so ALL of them are
-- backfilled as already-sent; the feature is forward-looking from launch.
--   This CANNOT be caught locally — credit_notes is empty on the local stack
--   (SELECT count(*) → 0), so the local run of this migration is a no-op and
--   proves nothing about production.
--   BEFORE THE PROD `db push`: record SELECT count(*) FROM credit_notes.
--   AFTER IT: SELECT count(*) FROM credit_notes WHERE email_sent_at IS NULL
--   MUST return 0. Any other value stops the deploy.
-- Do NOT split the backfill into a second migration "to keep the DDL clean":
-- db push applies everything pending, so two files present at once is one deploy
-- (§7.49, §7.30) and the window between them is exactly the dangerous state.
--
-- ⚠ RISK 8 (plan) — this column is BOTH the claim and the sent-marker, the same
-- bounded-window tradeoff §8.63 accepted. The function claims a row by stamping
-- it, then sends, then resets on failure. A throw is covered (try/finally), but a
-- PROCESS KILL between claim and send loses that one email SILENTLY: the row
-- renders as emailed and Resend cannot reach it. Unlike the invoice precedent
-- there is no automatic retry pass to compensate — the admin Resend button is the
-- only retry, by decision. Eliminating the window needs a separate claimed_at
-- column or an advisory lock; filed in BACKLOG.md.
-- ============================================================

ALTER TABLE credit_notes
  ADD COLUMN email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN credit_notes.email_sent_at IS
  'When the credit-note notification email was successfully sent (Resend HTTP '
  '200). NULL = never sent; the admin Credit Notes page shows those as "Not '
  'emailed" with a Resend button. Written by the credit-note-emails edge function '
  '(service_role) only — authenticated holds SELECT on this table and nothing '
  'else, so no client can write it. Doubles as the send CLAIM: a process kill '
  'between claim and send loses that email silently and Resend cannot reach it '
  '(no automatic retry pass exists by design). See CREDIT_NOTE_EMAIL_PLAN.md.';

-- Backfill (⚠ RISK 1 above) — every pre-feature note counts as already sent.
-- No-op on a fresh local reset: migrations run before seed.sql, and production
-- is the only place credit_notes has rows.
UPDATE credit_notes
  SET email_sent_at = issued_at
  WHERE email_sent_at IS NULL;
