-- ============================================================
-- ROLLBACK for 20260823000100_accounting_summary.sql.
-- Plan: docs/plans/ACCOUNTING_PAGE_PLAN.md.
--
-- Drops the two owner-only read RPCs. Clean and read-only: they are brand new,
-- add no column/table/policy, hold no data, and nothing in the schema depends
-- on them (no view, trigger, generated column, or other function references
-- them — they are called only from the admin app, which the app rollback
-- removes). No GRANT/REVOKE cleanup needed: dropping a function drops its ACL.
--
-- Deploy ORDER for a rollback: revert the admin app FIRST (so nothing calls the
-- RPCs), THEN run this. Running it while the app is still live only makes the
-- Accounting page error — it cannot corrupt data (both functions are STABLE and
-- read-only).
--
-- Rehearse (§7.93): UP then DOWN on a fresh reset must leave `supabase test db`
-- at its pre-migration state — the two functions absent, everything else
-- byte-identical.
--
-- Run manually (not auto-applied): supabase db reset does NOT run rollback/.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.accounting_summary(UUID, CHAR);
DROP FUNCTION IF EXISTS public.accounting_months(UUID);

COMMIT;
