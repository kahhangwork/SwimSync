-- ============================================================
-- ROLLBACK for 20260809000300_class_deactivation.sql
--                + 20260809000400_class_deactivation_grants.sql
--
-- §7.93: this file is EXECUTED before the deploy, not merely written — running
-- the DOWN is the half that finds the bugs. After executing it, re-apply the
-- UP and diff pg_get_functiondef() against the pre-rollback definition.
--
-- ── WHAT THIS DOES NOT UNDO ────────────────────────────────────────────────
-- The engine. `generate-invoices` is deployed separately and a git revert does
-- NOT roll it back — redeploy the previous function build. Order matters on the
-- way down as much as up: revoke first (below), so nothing can call
-- deactivate_class() while the new engine is still live, THEN redeploy the old
-- engine, THEN drop.
--
-- Nor does it undo a SEAL. If a month sealed wrongly, the documented fix is
-- deleting its billing_periods row (core.ts:1358, INVOICE_RUNBOOK.md).
--
-- ── THE COLUMN IS DROPPED LAST AND DELIBERATELY ────────────────────────────
-- `classes.deactivated_at` is what the NEW engine reads to decide how far to
-- expect lessons. Dropping it while that engine is live makes its class query
-- fail for every tenant — the run dies rather than misbills, but it dies. Only
-- reach the final statement once the old engine is confirmed back.
--
-- Any class deactivated before the rollback keeps is_active = FALSE and loses
-- its date. Under the old engine that is the pre-existing behaviour (inactive
-- classes were skipped outright), so it is consistent, not stranded — but it is
-- also a silent underbill for that class, which is exactly what Wave 1 item #6
-- exists to fix. Reactivate any such class BEFORE rolling back:
--   SELECT id, title FROM classes WHERE deactivated_at IS NOT NULL;
-- ============================================================

-- 1. Cut off the callers first.
REVOKE EXECUTE ON FUNCTION public.deactivate_class(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reactivate_class(UUID) FROM authenticated;

-- 2. Redeploy the previous `generate-invoices` build NOW, before step 3.
--    (Manual step — a git revert does not deploy an edge function.)

-- 3. The RPCs.
DROP FUNCTION IF EXISTS public.deactivate_class(UUID);
DROP FUNCTION IF EXISTS public.reactivate_class(UUID);
DROP FUNCTION IF EXISTS public.class_unmarked_lesson_dates(UUID);

-- 4. The column — only once the OLD engine is confirmed live again.
ALTER TABLE classes DROP COLUMN IF EXISTS deactivated_at;
