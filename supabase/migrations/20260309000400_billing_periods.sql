-- ============================================================
-- Billing Periods Completion Tracker
--
-- Records which billing months have been fully processed. The
-- generate-invoices Edge Function checks this table at the start
-- of every daily run and exits immediately if the current billing
-- month is already marked complete (idempotent daily cron).
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_periods (
  billing_month   CHAR(7) PRIMARY KEY,          -- format: YYYY-MM
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invoices_issued INTEGER     NOT NULL DEFAULT 0,
  notes           TEXT
);

ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
-- No policies: only the service_role (Edge Function) touches this table.
-- Superadmin read access is granted in the RLS policies migration.
