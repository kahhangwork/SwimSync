-- State for throttling the "invoices are blocked by unmarked attendance"
-- alert. The cron runs daily; without this it would email the same reminder
-- every day until the lessons are marked, which just teaches people to filter
-- it. Value is { "YYYY-MM": "<fingerprint of the blocking lessons>" }, so a
-- fresh alert goes out only when the outstanding set actually changes.
--
-- Seeded here because app_settings has no INSERT policy — the function reads
-- and UPDATEs it via the service role.
INSERT INTO app_settings (key, value) VALUES
  ('invoice_block_notified', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;
