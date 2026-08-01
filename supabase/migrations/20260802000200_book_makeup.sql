-- ============================================================
-- Booking a make-up: an ENROLLED child guests into one lesson of ANOTHER class
-- in the same category (MAKEUP_CLASSES_PLAN). book_trial's shape with the
-- trial-specific refusals inverted — a trial child must not be enrolled, a
-- make-up child must be.
--
-- Every refusal is HERE, not in the UI. A limit only the admin screen applies
-- is not a limit (§7.32).
-- ============================================================

CREATE OR REPLACE FUNCTION public.book_makeup(
  p_class_id     UUID,   -- the HOST class being guested into
  p_session_date DATE,
  p_student_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Admin only. Arranging is the admin's, observing is the coach's — the same
  -- split book_trial and schedule_extra_lesson enforce.
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

  -- ── The HOME class: the child's one active enrolment ─────────────────────
  -- one_active_enrolment_per_student guarantees at most one row, so this
  -- SELECT INTO is deterministic. Derived here, never a parameter.
  SELECT e.class_id, c.category_id, c.title
    INTO v_home_class, v_home_category, v_home_title
    FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
   WHERE e.student_id = p_student_id AND e.is_active;

  IF v_home_class IS NULL THEN
    RAISE EXCEPTION
      'that child is not enrolled in a class — a make-up is for enrolled children; book a trial instead';
  END IF;

  -- ── Own class? That is an EXTRA LESSON, which already exists ─────────────
  IF v_home_class = p_class_id THEN
    RAISE EXCEPTION
      'that is the child''s own class — schedule it with "Extra lesson" on the Classes page instead';
  END IF;

  -- ── Same category only ───────────────────────────────────────────────────
  -- Compared LIVE at booking time, then v_home_category is snapshotted onto
  -- the row (§7.45 — both category columns are mutable).
  IF v_home_category IS DISTINCT FROM v_host_category THEN
    RAISE EXCEPTION
      'a make-up must stay in the child''s own category: % is %, but % is %',
      v_home_title,
      (SELECT name FROM class_categories WHERE id = v_home_category),
      v_class_title,
      (SELECT name FROM class_categories WHERE id = v_host_category);
  END IF;

  -- ── The date must be a lesson that will actually happen ──────────────────
  -- Either a day this class runs (EXTRACT(DOW), not to_char — a non-English
  -- lc_time would break every name comparison, see book_trial), OR a date an
  -- admin-scheduled off-schedule session already exists for. The OR branch is
  -- deliberate: guesting into another class's extra lesson is a real make-up,
  -- and the session's existence proves the lesson is real and markable — the
  -- same reasoning as guard_attendance_date's deliberate no-weekday-check.
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

  -- ── Floor: never into an already-billed month ────────────────────────────
  -- A booking below the attendance window can neither be marked nor bill — it
  -- would be silently lost. Future dates are allowed, no ceiling: the picker's
  -- window is an affordance, this is the guard. (book_trial has no floor —
  -- recorded as a BACKLOG asymmetry, deliberately not changed here.)
  IF p_session_date < session_window_start() THEN
    RAISE EXCEPTION
      'A make-up cannot be booked before % — that month has been billed.',
      to_char(session_window_start(), 'DD Mon YYYY');
  END IF;

  -- ── Duplicate live booking: a plain sentence, not a constraint error ─────
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
REVOKE EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID) TO authenticated;

/**
 * Cancel a make-up booking. Soft: the row survives so the record of the
 * arrangement does, and a cancelled slot can be re-booked (partial index).
 */
CREATE OR REPLACE FUNCTION public.cancel_makeup_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT tenant_id INTO v_tenant FROM makeup_bookings WHERE id = p_booking_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may cancel a make-up';
  END IF;

  UPDATE makeup_bookings
     SET cancelled_at = NOW(), cancelled_by = v_actor
   WHERE id = p_booking_id AND cancelled_at IS NULL;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (v_actor, 'makeup_booking_cancelled', 'Student',
          (SELECT student_id FROM makeup_bookings WHERE id = p_booking_id),
          jsonb_build_object('booking_id', p_booking_id));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_makeup_booking(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_makeup_booking(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_makeup_booking(UUID) TO authenticated;
