-- ============================================================
-- ROLLBACK for the 2026-07-27 attendance-window guard. NOT a migration — do not
-- put this in supabase/migrations/. It lives here so it exists BEFORE the deploy
-- rather than being improvised during an incident.
--
-- WHY THIS ONE MATTERS MORE THAN MOST. The migration it reverses is the only
-- thing in the repo that can stop a coach saving attendance. Production is
-- about to record its first real lessons (HANDOVER §9), so the failure mode of
-- a bug here is "no coach can mark anything", on the exact path everything else
-- is waiting on. That is why the rollback is two DROP statements and nothing
-- clever: it must be runnable by someone who is not thinking clearly.
--
-- DROPPING THE TRIGGERS IS ENOUGH TO RESTORE THE OLD BEHAVIOUR. The guard is
-- pure validation — it writes nothing, changes no existing row, and holds no
-- state. With the triggers gone the schema behaves exactly as it did at
-- 48d9d49, whatever the app is doing.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   • It does NOT drop `lesson_sessions.off_schedule_reason`. Dropping a column
--     is destructive and the data in it is a real record of why a lesson exists
--     (§7.30: a dropped column that live bundles still select breaks six
--     screens). A NULL-able column an older build ignores costs nothing.
--   • It does NOT drop schedule_extra_lesson(). Any lesson it already created
--     is a real lesson; removing the function does not remove them, and an
--     older admin build simply never calls it. Dropped last, and separately, if
--     you truly need the schema back to baseline — see the OPTIONAL block.
-- ============================================================

-- ── The whole rollback ──────────────────────────────────────────────────────
-- After these two statements attendance marking behaves exactly as it did
-- before the migration.

DROP TRIGGER IF EXISTS guard_attendance_date_trg ON attendance;
DROP TRIGGER IF EXISTS guard_session_date_trg    ON lesson_sessions;


-- ── Verify (run this, do not assume) ────────────────────────────────────────
-- Expected: zero rows. A row here means a trigger survived and the guard is
-- still live.
--
--   SELECT tgname, tgrelid::regclass
--     FROM pg_trigger
--    WHERE NOT tgisinternal
--      AND tgname IN ('guard_attendance_date_trg', 'guard_session_date_trg');


-- ── OPTIONAL: full schema reversal ──────────────────────────────────────────
-- Only if the migration must be removed entirely (e.g. to re-apply a corrected
-- version). Drop the functions AFTER the triggers, or the drops fail on the
-- dependency. Postgres does not track function bodies as dependencies (§7.21),
-- so nothing will warn you that guard_session_date() calls the two asserts —
-- drop them in this order.
--
--   DROP FUNCTION IF EXISTS public.guard_attendance_date();
--   DROP FUNCTION IF EXISTS public.guard_session_date();
--   DROP FUNCTION IF EXISTS public.schedule_extra_lesson(UUID, DATE, TEXT);
--   DROP FUNCTION IF EXISTS public.assert_class_runs_on(UUID, DATE);
--   DROP FUNCTION IF EXISTS public.assert_markable_date(DATE);
--   DROP FUNCTION IF EXISTS public.session_window_start();
--   DROP FUNCTION IF EXISTS public.today_sg();
--
-- And only if you accept the data loss, and no live bundle still selects it:
--   ALTER TABLE lesson_sessions DROP COLUMN IF EXISTS off_schedule_reason;
