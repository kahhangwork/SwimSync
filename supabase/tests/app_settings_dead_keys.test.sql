-- pgTAP: dead app_settings keys stay gone (20260925000100).
--
-- WHAT THIS FILE PROTECTS.
--   The global app_settings.invoice_run_day row is DEAD: the engine's run-day
--   guard and every admin surface read tenants.invoice_run_day (2026-09-24,
--   docs/plans/ENGINE_TENANT_RUN_DAY_PLAN.md). A dead global setting with a
--   live-looking name is how the engine came to read the wrong one for two
--   months — so its return (a re-seed, a rolled-back contract) goes red here.
--   The live per-tenant column is pinned alongside, so this file cannot pass
--   by the run day disappearing altogether.

BEGIN;

SELECT plan(2);

SELECT is_empty(
  $$ SELECT 1 FROM public.app_settings WHERE key = 'invoice_run_day' $$,
  'the dead global app_settings.invoice_run_day row is gone'
);

SELECT has_column(
  'public', 'tenants', 'invoice_run_day',
  'the run day lives on tenants (the column the engine reads)'
);

SELECT * FROM finish();
ROLLBACK;
