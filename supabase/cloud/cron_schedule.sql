-- ============================================================
-- pg_cron Schedule: Daily Invoice Generation at 1am SGT
-- Run this in Supabase Dashboard → SQL Editor
--
-- BEFORE RUNNING:
--   1. Enable extensions in Supabase Dashboard → Database → Extensions:
--        pg_cron   (for scheduling)
--        pg_net    (for HTTP calls from SQL)
--
--   2. Deploy the Edge Function:
--        supabase functions deploy generate-invoices
--        supabase secrets set CRON_SECRET=<your-random-secret>
--
--   3. Replace the two placeholders below:
--        <project-ref>   → your Supabase project reference ID
--                          (found in Dashboard → Settings → General)
--        <your-cron-secret> → same value you set with `supabase secrets set`
-- ============================================================

-- 1am SGT = UTC+8, so 1am SGT = 17:00 UTC previous day.
-- The empty body ('{}') runs auto mode with the DEFAULT billing month, which the
-- function resolves as the previous calendar month in APP_TIMEZONE (SGT by
-- default) — not the UTC month — so this fires correctly at the SGT boundary.
-- See supabase/functions/generate-invoices/dates.ts.
--
-- This job runs EVERY DAY, but it does not bill every day. Which day invoices
-- are actually generated on is decided by the FUNCTION, not by this schedule:
--   • app_settings.invoice_run_day (default 7) — runs before that day of the
--     month return "before_run_day" and do nothing. Editable in the admin
--     panel; no need to touch this cron expression to change the billing day.
--   • Once a month is fully billed it is sealed in billing_periods, so every
--     later run that month returns "already_complete" immediately.
-- The daily cadence is deliberate: it is what lets the run retry while
-- attendance is still being marked, and it must keep firing for next month.
SELECT cron.schedule(
  'generate-invoices-daily',   -- job name (must be unique)
  '0 17 * * *',                -- cron: every day at 17:00 UTC (= 1:00 SGT)
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/generate-invoices',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer <your-cron-secret>',
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To verify the job was created:
-- SELECT * FROM cron.job;

-- To remove the job later:
-- SELECT cron.unschedule('generate-invoices-daily');
