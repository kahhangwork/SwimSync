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

-- 1am SGT = UTC+8, so 1am SGT = 17:00 UTC previous day
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
