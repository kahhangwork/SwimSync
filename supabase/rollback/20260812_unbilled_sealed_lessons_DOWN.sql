-- DOWN for 20260812000400_unbilled_sealed_lessons.sql (§7.93 — committed
-- BEFORE the deploy, and rehearsed: apply, re-run the pre-change suite, put
-- the schema back).
--
-- The function is new and read-only: nothing else references it, no data
-- shape changed, so the rollback is a single DROP. The grant dies with it.

DROP FUNCTION IF EXISTS public.unbilled_sealed_lessons(UUID);
