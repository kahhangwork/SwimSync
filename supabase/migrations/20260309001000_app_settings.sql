-- ============================================================
-- App settings (key/value). Currently holds the master switch for
-- automatic (cron) invoice generation. Manual on-demand generation
-- from the admin panel ignores this flag.
-- ============================================================

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES
  ('auto_invoice_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Superadmin can read + change settings from the admin panel.
-- The Edge Function reads it via the service_role key (bypasses RLS).
CREATE POLICY app_settings_select ON app_settings FOR SELECT TO authenticated
  USING (is_superadmin());

CREATE POLICY app_settings_update ON app_settings FOR UPDATE TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

GRANT SELECT, UPDATE ON app_settings TO authenticated, service_role;
