-- ============================================================
-- 1. Lesson sessions inherit start/end time from their class.
--    The app inserts only { class_id, session_date, status }, but
--    start_time/end_time are NOT NULL. A BEFORE INSERT trigger fills
--    them from the class so every insert path stays consistent with
--    the PRD ("each session inherits class date/time/location").
-- ============================================================

CREATE OR REPLACE FUNCTION fill_lesson_session_times()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    SELECT c.start_time, c.end_time
    INTO   NEW.start_time, NEW.end_time
    FROM   classes c
    WHERE  c.id = NEW.class_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_session_times ON lesson_sessions;

CREATE TRIGGER trg_fill_session_times
  BEFORE INSERT ON lesson_sessions
  FOR EACH ROW EXECUTE FUNCTION fill_lesson_session_times();

-- ============================================================
-- 2. Allow users to write their own audit-log entries.
--    The coach app logs an entry when saving attendance. Users may
--    only insert rows attributed to themselves (actor_id = auth.uid()).
--    Reads remain superadmin-only (see rls_policies migration).
-- ============================================================

CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
