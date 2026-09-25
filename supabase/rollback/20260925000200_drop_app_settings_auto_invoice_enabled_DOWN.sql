-- ROLLBACK for 20260925000200_drop_app_settings_auto_invoice_enabled.sql
--
-- Restores the dead global app_settings.auto_invoice_enabled row with the value
-- PROD held when it was dropped: `false` (read 2026-09-25) — not the original
-- seed's `true` (20260309001000_app_settings.sql). NOTHING reads it — the
-- engine and the admin Invoices card read tenants.auto_invoice_enabled — so
-- restoring it changes no behaviour; this exists only so the contract is
-- reversible.
--
-- WHAT IS LOST: nothing — the value was already dead.
--
-- ORDER: none needed — no code depends on the row either way.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm
-- app_settings_dead_keys.test.sql fails, re-apply the UP, confirm green.

INSERT INTO public.app_settings (key, value) VALUES
  ('auto_invoice_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
