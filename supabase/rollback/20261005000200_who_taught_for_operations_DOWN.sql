-- Rollback for 20261005000200_who_taught_for_operations.sql.
--
-- ⚠ APPS FIRST. Do NOT run this while an admin bundle that calls class_coach_terms is live — the Calendar,
-- lesson page, nav strip and Attendance page would all fail to load their coaches:
--   1. revert the app commit that switched the readers and push main;
--   2. prove the served admin bundle no longer contains "class_coach_terms" (§7.31);
--   3. only then run this file.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261005000200';
-- No data to undo — the function only reads.

DROP FUNCTION public.class_coach_terms(UUID[]);
