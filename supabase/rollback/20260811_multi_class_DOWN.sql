-- ============================================================================
-- ROLLBACK for 20260811000100_multiple_classes_per_child.sql
--
-- Committed BEFORE the deploy (the 20260804 pattern — a scratchpad backup
-- nobody can find is not a rollback plan), and REHEARSED, because running the
-- DOWN file is the half that finds the bugs (§7.93).
--
-- ⚠ THIS ONE IS NOT PURELY MECHANICAL, AND THAT IS THE WHOLE POINT.
--
-- Restoring one_active_enrolment_per_student is a UNIQUE index over data that
-- may by then violate it. Every child holding two active enrolments must lose
-- one first, and NO AUTOMATIC CHOICE IS SAFE — closing "the newer" writes
-- unenrolled_at on a class the family may actually be attending, and the coach
-- roster silently loses a child who still turns up. Attendance already recorded
-- still bills either way (billing follows attendance rows, not enrolment), so
-- money is not at risk; the roster is.
--
-- So step 1 REPORTS and REFUSES rather than guessing. Resolve the list by hand
-- on the Students page, then re-run.
-- ============================================================================

BEGIN;

-- ── 1. Refuse to guess ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_kids TEXT;
BEGIN
  SELECT string_agg(DISTINCT s.full_name || ' (' || cnt.n || ' classes)', ', ')
    INTO v_kids
    FROM (SELECT student_id, count(*) AS n
            FROM student_class_enrolments
           WHERE is_active
           GROUP BY student_id
          HAVING count(*) > 1) cnt
    JOIN students s ON s.id = cnt.student_id;

  IF v_kids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot restore one_active_enrolment_per_student: these children hold more '
      'than one active enrolment — %. Remove each from all but one class on the '
      'Students page, then re-run this file. Do NOT automate the choice.', v_kids;
  END IF;
END $$;

-- ── 2. The triggers and their functions ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_class_time_no_enrolment_clash ON classes;
DROP FUNCTION IF EXISTS public.enforce_class_time_no_enrolment_clash();

DROP TRIGGER IF EXISTS trg_enrolment_schedule ON student_class_enrolments;
DROP FUNCTION IF EXISTS public.enforce_enrolment_schedule();

-- ── 3. The indexes ──────────────────────────────────────────────────────────
DROP INDEX IF EXISTS one_active_enrolment_per_student_class;

CREATE UNIQUE INDEX one_active_enrolment_per_student
  ON student_class_enrolments (student_id)
  WHERE is_active = TRUE;

-- ── 4. book_makeup back to 3 args ───────────────────────────────────────────
-- Body restored from 20260806000200_markable_floor.sql, which was the live
-- definition before this wave. Read it from pg_get_functiondef() if you are
-- unsure — CREATE OR REPLACE means grep finds the OLDEST file first (§7.115).
DROP FUNCTION IF EXISTS public.book_makeup(UUID, DATE, UUID, UUID);

CREATE FUNCTION public.book_makeup(p_class_id uuid, p_session_date date, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor          UUID := auth.uid();
  v_tenant         UUID;
  v_host_category  UUID;
  v_host_active    BOOLEAN;
  v_class_day      day_of_week;
  v_class_title    TEXT;
  v_home_class     UUID;
  v_home_category  UUID;
  v_home_title     TEXT;
  v_booking        UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title, c.is_active
    INTO v_tenant, v_host_category, v_class_day, v_class_title, v_host_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT v_host_active THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may book a make-up';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that child belongs to another business';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.is_active
  ) THEN
    RAISE EXCEPTION 'that child is no longer attending — reactivate them first';
  END IF;

  SELECT e.class_id, c.category_id, c.title
    INTO v_home_class, v_home_category, v_home_title
    FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
   WHERE e.student_id = p_student_id AND e.is_active;

  IF v_home_class IS NULL THEN
    RAISE EXCEPTION
      'that child is not enrolled in a class — a make-up is for enrolled children; book a trial instead';
  END IF;

  IF v_home_class = p_class_id THEN
    RAISE EXCEPTION
      'that is the child''s own class — schedule it with "Extra lesson" on the Classes page instead';
  END IF;

  IF v_home_category IS DISTINCT FROM v_host_category THEN
    RAISE EXCEPTION
      'a make-up must stay in the child''s own category: % is %, but % is %',
      v_home_title,
      (SELECT name FROM class_categories WHERE id = v_home_category),
      v_class_title,
      (SELECT name FROM class_categories WHERE id = v_host_category);
  END IF;

  IF (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1] <> v_class_day::text
     AND NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date
     )
  THEN
    RAISE EXCEPTION
      '% runs on a %, and no extra lesson is scheduled for % — pick a day the class actually meets',
      v_class_title, v_class_day, to_char(p_session_date, 'DD Mon YYYY');
  END IF;

  IF p_session_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'A make-up cannot be booked before % — that month has been billed.',
      to_char(markable_floor(v_tenant), 'DD Mon YYYY');
  END IF;

  IF EXISTS (
    SELECT 1 FROM makeup_bookings mb
     WHERE mb.student_id = p_student_id
       AND mb.class_id = p_class_id
       AND mb.session_date = p_session_date
       AND mb.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'that child is already booked into that lesson';
  END IF;

  INSERT INTO makeup_bookings
    (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
  VALUES
    (v_tenant, p_student_id, p_class_id, p_session_date, v_home_category, v_home_class, v_actor)
  RETURNING id INTO v_booking;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'makeup_booked', 'Student', p_student_id,
    jsonb_build_object('class_id', p_class_id, 'session_date', p_session_date,
                       'category_id', v_home_category, 'home_class_id', v_home_class,
                       'booking_id', v_booking)
  );

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.book_makeup(UUID, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID) TO authenticated;

-- ── 5. close_student_enrolment back to 2 args ───────────────────────────────
-- Body restored from 20260719001200_active_inactive_rpcs.sql.
DROP FUNCTION IF EXISTS public.close_student_enrolment(UUID, BOOLEAN, UUID);

CREATE FUNCTION public.close_student_enrolment(
  p_student_id   UUID,
  p_set_inactive BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_set_inactive THEN
    PERFORM set_students_active(ARRAY[p_student_id], FALSE);
    RETURN;
  END IF;

  SELECT tenant_id INTO v_tenant FROM students WHERE id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT (is_platform_admin() OR is_tenant_admin(v_tenant)
          OR coach_serves_student(p_student_id)) THEN
    RAISE EXCEPTION 'not permitted to change this student''s enrolment';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id AND is_active;

  UPDATE students
     SET assignment_status = 'unassigned'::assignment_status,
         updated_at        = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_removed_from_class', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id), v_tenant);
END;
$$;

REVOKE ALL ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN) TO authenticated;

COMMIT;
