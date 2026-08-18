-- ============================================================
-- ROLLBACK — Holiday attendance (migrations 20260818000400 … 001100).
--
-- SAFE ON PRODUCTION AT DEPLOY TIME because prod holds ZERO packages and ZERO
-- holidays, so there is no holiday attendance, no package_holiday_extensions
-- state, and no extension to unwind — this file is structural teardown, not data
-- migration. REHEARSED against the local stack (db reset → apply all → this).
--
-- ORDER MATTERS: neutralize any holiday rows first (so nothing depends on the new
-- objects), drop the new objects, re-add the retired columns, then restore the
-- pre-feature spine (package_effective_end weeks form) BEFORE the app-visible
-- functions that call it. The 'holiday' enum value is PERMANENT (Postgres cannot
-- drop an enum value) — it is simply left unwritable once the guard and RPCs are
-- gone; it was never in the engine's BILLABLE set.
--
-- The large pre-feature bodies of enforce_parent_package_lifecycle, extend_package,
-- recompute_package_extensions and the acknowledge_* RPCs are restored by
-- RE-APPLYING their original, unchanged migrations from git AFTER this file:
--   20260815000200 (recompute + acknowledge_*), 20260815000300 (extend_package),
--   20260815000700 (enforce_parent_package_lifecycle), 20260814000400
--   (package_effective_end weeks form). This file undoes the additive/contract
--   schema; those migrations are the source of truth for the prior code, so it is
--   safer to replay them than to duplicate 150 lines here that could drift.
-- ============================================================

BEGIN;

-- 1. Neutralize any holiday attendance — non-billable, gate-clearing, renderable
--    by every pre-feature client. (No-op on prod: zero holiday rows.)
UPDATE attendance SET status = 'cancelled_coach' WHERE status = 'holiday';

-- 2. Drop the new triggers.
DROP TRIGGER IF EXISTS trg_holiday_reconcile_ins ON attendance;
DROP TRIGGER IF EXISTS trg_holiday_reconcile_upd ON attendance;
DROP TRIGGER IF EXISTS trg_holiday_reconcile_del ON attendance;
DROP TRIGGER IF EXISTS trg_holiday_admin_only    ON attendance;
DROP TRIGGER IF EXISTS trg_holiday_reconcile_on_activation ON parent_packages;

-- 3. Drop the new functions and state table.
DROP FUNCTION IF EXISTS holiday_reconcile();
DROP FUNCTION IF EXISTS holiday_reconcile_on_activation();
DROP FUNCTION IF EXISTS enforce_holiday_admin_only();
DROP FUNCTION IF EXISTS apply_holiday_reconcile(date[]);
DROP FUNCTION IF EXISTS holiday_covering_package(uuid, date, uuid, uuid);
DROP FUNCTION IF EXISTS mark_day_holiday(uuid, date);
DROP FUNCTION IF EXISTS unmark_day_holiday(uuid, date);
DROP TABLE    IF EXISTS package_holiday_extensions;

-- 4. Re-add the retired weeks columns the contract migration dropped, so the
--    restored pre-feature trigger/functions and the pre-feature apps find them.
ALTER TABLE parent_packages
  ADD COLUMN IF NOT EXISTS ph_extension_weeks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ph_ack_weeks_parent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ph_ack_weeks_admin  INTEGER NOT NULL DEFAULT 0;

-- 5. Restore package_effective_end to the WEEKS signature (the days form is
--    dropped; re-GRANT or every package sale breaks via the invoker trigger).
DROP FUNCTION IF EXISTS package_effective_end(DATE, INTEGER, INTEGER, INTEGER);
CREATE FUNCTION package_effective_end(
  p_start_date DATE, p_validity_weeks INTEGER, p_ph_ext_weeks INTEGER, p_manual_days INTEGER
) RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT p_start_date + (p_validity_weeks * 7) + (p_ph_ext_weeks * 7) + p_manual_days;
$$;
GRANT EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;

-- 6. Drop the days accumulators.
ALTER TABLE parent_packages DROP COLUMN IF EXISTS holiday_extension_days;
ALTER TABLE tenants          DROP COLUMN IF EXISTS holiday_extension_days;

COMMIT;

-- 7. NOW re-apply, unchanged, from git (they reference the columns restored above):
--      20260815000700_referrals.sql        → enforce_parent_package_lifecycle
--      20260815000300_extend_package.sql    → extend_package
--      20260815000200_package_holiday_extension.sql → recompute_package_extensions,
--                                              acknowledge_package_extension,
--                                              acknowledge_all_extensions
--    (Their CREATE OR REPLACE bodies overwrite the days-form definitions left by
--     the feature. Verify with `supabase test db` — the pre-feature holiday tests
--     are in git alongside those migrations.)
