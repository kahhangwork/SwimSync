-- ROLLBACK for 20260925000100_drop_app_settings_invoice_run_day.sql
--
-- Restores the dead global app_settings.invoice_run_day row with its original
-- seed value (20260718000100_invoice_run_day.sql). NOTHING reads it — the
-- engine and every admin surface read tenants.invoice_run_day — so restoring
-- it changes no behaviour; this exists only so the contract is reversible.
--
-- WHAT IS LOST: nothing. If prod held a value other than 7, it was already dead.
--
-- ORDER: none needed — no code depends on the row either way.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm
-- app_settings_dead_keys.test.sql fails, re-apply the UP, confirm green.

INSERT INTO public.app_settings (key, value) VALUES
  ('invoice_run_day', '7'::jsonb)
ON CONFLICT (key) DO NOTHING;
