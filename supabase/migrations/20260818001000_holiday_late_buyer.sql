-- ============================================================
-- Holiday attendance, step 4d: close the late-buyer gap (⚠ plan RISK 5).
--
-- The retired calendar-scan recompute was CONVERGENT: a package sold AFTER a
-- future day was voided picked up the extension on the next page-load scan. The
-- event model fires only at marking time, so without this a package bought later
-- — whose nominal window contains an already-voided date — would never extend: a
-- permanent, silent under-extension the old model did not have.
--
-- Close it at the source: when a package BECOMES active, reconcile the holiday
-- dates already sitting inside its nominal window for the parent's children. The
-- reconcile must run AFTER the row is active (holiday_covering_package filters
-- status='active'), so this is an AFTER trigger, not part of the BEFORE lifecycle
-- trigger. apply_holiday_reconcile then resolves coverage afresh for those dates
-- and inserts the state row for the now-eligible package.
--
-- No recursion: apply_holiday_reconcile's UPDATE leaves status unchanged, so the
-- "just became active" condition below is false on that write.
-- ============================================================

CREATE FUNCTION holiday_reconcile_on_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates DATE[];
BEGIN
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.status = 'active')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'active' AND OLD.status IS DISTINCT FROM NEW.status)
  ) THEN
    RETURN NULL;
  END IF;

  -- Holiday dates already inside this package's NOMINAL window, for its parent's
  -- children, in a class of a covered category.
  SELECT array_agg(DISTINCT ls.session_date) INTO v_dates
  FROM attendance a
  JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  JOIN classes c          ON c.id  = ls.class_id
  JOIN parent_students ps ON ps.student_id = a.student_id AND ps.parent_id = NEW.parent_id
  WHERE a.status = 'holiday'
    AND c.tenant_id = NEW.tenant_id  -- the resolver is tenant-scoped; don't collect another business's dates
    AND ls.session_date >= NEW.start_date
    AND ls.session_date <  NEW.start_date + (NEW.validity_weeks * 7)
    AND (NEW.category_id IS NULL OR c.category_id = NEW.category_id);

  IF v_dates IS NOT NULL THEN
    PERFORM apply_holiday_reconcile(v_dates);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_holiday_reconcile_on_activation
  AFTER INSERT OR UPDATE ON parent_packages
  FOR EACH ROW EXECUTE FUNCTION holiday_reconcile_on_activation();
