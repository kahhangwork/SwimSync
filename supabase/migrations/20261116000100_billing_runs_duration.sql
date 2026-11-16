-- billing_runs.duration_ms — how long a generation run took (BILLING ENGINE SPEED, 2026-11-16).
--
-- WHY. October 2026 took 30+ s on prod and nothing recorded a run's duration, so the cause had to be reconstructed
-- from invoices.generated_at gaps (~300 ms per DB round trip: the admin API ran in Vercel iad1, the DB is in
-- ap-southeast-1). The Vercel region moved to sin1 the same day and the engine is being batched; this column is the
-- durable proof of both, and the regression alarm if either is ever undone. The response JSON and the Edge Function
-- log carry per-phase timings too, but the response is seen once and the log is short-lived.
--
-- WHAT IT MEASURES. An admin (scoped, one-tenant) run: milliseconds from the handler starting the run (before the
-- DB-clock read) to the run row being built — clock + guards + phase 1 + phase 2 + seal. A cron (every-tenant) run:
-- each tenant's row carries that TENANT'S OWN engine time, never the shared handler time (which would be the sum of
-- every tenant). Both EXCLUDE emails: the row is written BEFORE the email step on purpose (index.ts — a slow email
-- step must not lose the record), and the log is append-only (no UPDATE grant), so a later email time cannot be
-- added to it. The email/total figures are in the response (run_timings_ms) and the Edge Function log.
--
-- EXPAND-ONLY. Nullable, no default: every existing row and every row from the pre-change engine (which never sends
-- it) is NULL, meaning "not measured". No new grant: service_role's table-level INSERT/SELECT on billing_runs
-- (20260922000100) covers a new column, and authenticated's table-level SELECT lets the admin card read it later.
-- No policy change, so table_grants.test.sql is unaffected (§7.87).
--
-- Rollback: ALTER TABLE public.billing_runs DROP COLUMN duration_ms; (the engine treats the write as best-effort,
-- but a dropped column would make recordRuns' insert FAIL and lose the whole row — so drop the engine's write first).

ALTER TABLE public.billing_runs
  ADD COLUMN duration_ms INTEGER,
  ADD CONSTRAINT billing_runs_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0);

COMMENT ON COLUMN public.billing_runs.duration_ms IS
  'Generation time in ms: an admin run = clock read → run row built; a cron run = this tenant''s own engine time. '
  'EXCLUDES emails, which run after this row is written. '
  'NULL = not measured (runs before 2026-11-16, or an engine that does not send it).';
