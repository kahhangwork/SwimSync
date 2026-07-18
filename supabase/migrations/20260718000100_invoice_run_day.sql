-- ============================================================
-- Configurable day-of-month for AUTOMATIC (cron) invoice generation.
--
-- Billing on the 1st is too early: the last lesson of the month may not be
-- marked yet, and a lesson marked AFTER the parent's invoice exists is never
-- added to it (the "already has an invoice" guard skips them). Waiting a few
-- days is the cheapest defence against that.
--
-- Seeded here rather than from the admin panel because app_settings grants
-- only SELECT + UPDATE to authenticated/service_role and has no INSERT policy
-- (20260309000800_grants.sql / 20260309001000_app_settings.sql) — the panel
-- can only update a row that already exists.
--
-- Applies to the automatic path ONLY. Manual generation from the admin panel
-- is an explicit instruction and is never blocked by it.
-- ============================================================

INSERT INTO app_settings (key, value) VALUES
  ('invoice_run_day', '7'::jsonb)
ON CONFLICT (key) DO NOTHING;
