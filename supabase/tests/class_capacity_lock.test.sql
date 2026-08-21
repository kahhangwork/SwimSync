-- pgTAP: THE CAPACITY HARD LIMIT HOLDS A CLASS-ROW LOCK BEFORE IT COUNTS.
-- book_makeup / book_trial / enforce_class_capacity (20260821000200, §7.198).
--
-- WHAT THIS FILE EXISTS TO PROTECT. 20260820000200 made capacity a hard limit,
-- but each write path is a check-then-insert: count(*) of the expected set /
-- active roster, compare to the cap, then INSERT. Under READ COMMITTED two
-- writers for the LAST seat each read cap-1 before either commits, both pass,
-- both insert -> cap+1. 20260821000200 closes it by locking the CLASS row
-- (`FOR UPDATE`) before every count, serialising writers for that one class.
--
-- ⚠ WHY THIS IS A STRUCTURAL PIN, NOT A RACE. The bug is a concurrency property;
-- proving it directly needs TWO sessions committing in a controlled interleave,
-- and pgTAP runs inside ONE transaction that is rolled back — it cannot open a
-- second connection or observe a real lock wait. So this file asserts the only
-- thing a single session can: that the lock STATEMENT is present on every path
-- that counts against the cap. Delete any one lock and the matching assertion
-- goes red. A genuine two-writer stress test would live in a Deno/bash harness;
-- filed as the honest limitation, not hidden. (The lock's placement — inside the
-- `v_cap IS NOT NULL` branch, before the count — is fixed by the migration and
-- reviewed there.)

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

-- Match the whole `FROM classes WHERE id … FOR UPDATE` shape, not a bare
-- 'FOR UPDATE' a comment mentioning the lock could satisfy.
SELECT ok(
  pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) LIKE '%FROM classes WHERE id%FOR UPDATE%',
  'book_makeup locks the class row before counting the expected set (§7.198)');

SELECT ok(
  pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) LIKE '%FROM classes WHERE id%FOR UPDATE%',
  'book_trial locks the class row before counting the expected set (§7.198)');

SELECT ok(
  pg_get_functiondef('public.enforce_class_capacity()'::regprocedure) LIKE '%FROM classes WHERE id%FOR UPDATE%',
  'the enrolment trigger locks the class row before counting the active roster (§7.198)');

SELECT * FROM finish();
ROLLBACK;
