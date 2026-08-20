-- Rollback of 20260820000300: drop the badge count function.
-- Run once against a real apply (§7.93), then re-apply.
DROP FUNCTION IF EXISTS public.tenant_unmarked_lesson_count(uuid);
