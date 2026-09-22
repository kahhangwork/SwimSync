-- ROLLBACK for 20260922000100_billing_runs.sql
--
-- Drops the generation run log. The policy, index and grants go with the table.
--
-- WHAT IS LOST: every recorded run — the "why is this month open" history the
-- Billing months card shows. Billing itself is untouched: nothing in the engine
-- READS this table, and billing_periods (the seal) is a different table.
--
-- ORDER: roll back the apps and the engine FIRST. The engine's recordRuns is
-- best-effort, so an engine still writing after this runs only logs
-- "relation does not exist" and bills normally — safe, but noisy. The admin
-- card's read would error, so the apps go first.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm billing_runs.test.sql
-- fails (relation missing), re-apply the UP, confirm green.

DROP TABLE IF EXISTS public.billing_runs;
