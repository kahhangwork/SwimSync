-- ============================================================
-- Holiday attendance, step 4b: only a tenant admin may set/clear/delete a holiday.
--
-- A 'holiday' mark voids charges and extends package validity — a money-moving,
-- business-wide act. In SwimSync those live with the admin, not in the coach's
-- marking flow (invoices/credit-notes/settlements moved there — §8.27). The coach
-- app sees a holiday read-only; it is never a coach-settable status.
--
-- ENFORCED AT THE DB, BIDIRECTIONALLY, AND FOR DELETE (⚠ plan RISK 1):
--   * setting a holiday (INSERT/UPDATE to 'holiday'),
--   * clearing one (UPDATE away from 'holiday') — a coach un-voiding a day would
--     re-bill every parent in the class and retract a granted extension, and
--   * DELETING a holiday row — attendance_write is FOR ALL (20260811000200), so a
--     bare DELETE must be caught too; a BEFORE UPDATE arm never sees it.
--
-- THE SEAM IS current_user, EVALUATED HERE IN THE TRIGGER (§7.38): a client write
-- arrives as 'authenticated'; the day-void RPC (20260818000900) and every backend
-- writer run as 'postgres' and are exempt, so the RPC's own can_admin_tenant check
-- is the gate for the admin path. auth.uid() IS NULL would ALSO exempt fixtures and
-- the service role — correct here, but current_user is the established idiom.
-- ============================================================

CREATE FUNCTION enforce_holiday_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_touches_holiday BOOLEAN;
  v_session UUID;
BEGIN
  -- Only client DML is gated; backend writers (postgres) pass through.
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_touches_holiday :=
       (TG_OP = 'INSERT' AND NEW.status = 'holiday')
    OR (TG_OP = 'UPDATE' AND (NEW.status = 'holiday' OR OLD.status = 'holiday'))
    OR (TG_OP = 'DELETE' AND OLD.status = 'holiday');

  IF v_touches_holiday THEN
    v_session := COALESCE(NEW.lesson_session_id, OLD.lesson_session_id);
    IF NOT can_admin_tenant(session_tenant(v_session)) THEN
      RAISE EXCEPTION 'Only a tenant admin can set or clear a public-holiday mark.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- One BEFORE ROW trigger for all three events (row-level triggers, unlike the
-- statement-level reconcile, may be multi-event). Fires before the window guard's
-- own concerns are irrelevant here — this only cares about the holiday status.
CREATE TRIGGER trg_holiday_admin_only
  BEFORE INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION enforce_holiday_admin_only();
