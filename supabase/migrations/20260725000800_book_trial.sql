-- ============================================================
-- Booking a trial, and what add_unclaimed_student()'s trial mode now means.
--
-- Two entry points, one behaviour:
--   book_trial(class, date, student)      — an EXISTING child
--   add_unclaimed_student(..., 'trial')   — a NEW child, created and booked
--
-- Both produce a trial_bookings row and nothing else: no enrolment, no
-- lesson_sessions row, no attendance. The coach marks it on the day.
-- ============================================================

/**
 * Book an existing child into one lesson as a trial.
 *
 * THE THREE REFUSALS, all here rather than in the UI. A limit only the admin
 * screen applies is not a limit (§7.32).
 */
CREATE OR REPLACE FUNCTION public.book_trial(
  p_class_id     UUID,
  p_session_date DATE,
  p_student_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_category UUID;
  v_class_day day_of_week;
  v_booking  UUID;
  v_class_title TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title
    INTO v_tenant, v_category, v_class_day, v_class_title
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- Admin only. Booking is an arrangement, not an observation.
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may book a trial';
  END IF;

  -- The student must belong to this business.
  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that child belongs to another business';
  END IF;

  -- ── 1. The date must be a day this class actually runs ──────────────────
  -- Otherwise the child is expected at a lesson that never happens: never on
  -- any roster, never marked, and blocking the billing month indefinitely with
  -- no visible cause.
  --
  -- EXTRACT(DOW) rather than to_char(…,'day'): to_char renders the weekday
  -- NAME through `lc_time`, so on a server with a non-English locale every
  -- comparison here would fail and NO trial could ever be booked. DOW is an
  -- integer and means the same thing everywhere. 0 = Sunday.
  IF (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1] <> v_class_day::text THEN
    RAISE EXCEPTION
      '% runs on a %, but % is a %',
      v_class_title,
      v_class_day,
      to_char(p_session_date, 'DD Mon YYYY'),
      (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1];
  END IF;

  -- ── 2. Not already a customer: an ACTIVE enrolment in ANY class ─────────
  -- A trial means "not in a class yet". A CLOSED enrolment does not block — a
  -- family that left and is considering coming back, possibly to a different
  -- class, is a real trial.
  IF EXISTS (
    SELECT 1 FROM student_class_enrolments e
     WHERE e.student_id = p_student_id AND e.is_active
  ) THEN
    RAISE EXCEPTION
      'that child is already enrolled in a class — trials are for children not yet in one';
  END IF;

  -- ── 3. Nor holding prepaid value ────────────────────────────────────────
  -- Checked across EVERY parent linked to the child: parent_students is
  -- many-to-many, so testing only the first would make this bypassable
  -- depending on which row came back first.
  IF EXISTS (
    SELECT 1
      FROM parent_students ps
      JOIN parent_packages pp ON pp.parent_id = ps.parent_id
     WHERE ps.student_id = p_student_id
       AND pp.tenant_id = v_tenant
       AND pp.status = 'active'
       AND pp.value_remaining > 0
       AND (pp.expires_on IS NULL OR pp.expires_on >= p_session_date)
  ) THEN
    RAISE EXCEPTION
      'that family already has a prepaid package with this business — a trial is for new families';
  END IF;

  -- category_id is SNAPSHOTTED from the class. See the column comment on
  -- trial_bookings: classes.category_id is mutable and money depends on it.
  INSERT INTO trial_bookings
    (tenant_id, student_id, class_id, session_date, category_id, booked_by)
  VALUES (v_tenant, p_student_id, p_class_id, p_session_date, v_category, v_actor)
  RETURNING id INTO v_booking;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'trial_booked', 'Student', p_student_id,
    jsonb_build_object('class_id', p_class_id, 'session_date', p_session_date,
                       'category_id', v_category, 'booking_id', v_booking)
  );

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.book_trial(UUID, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_trial(UUID, DATE, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_trial(UUID, DATE, UUID) TO authenticated;

/**
 * Cancel a booking. Soft: the row survives so the record of the arrangement
 * does, and a cancelled slot can be re-booked (the unique index is partial).
 */
CREATE OR REPLACE FUNCTION public.cancel_trial_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT tenant_id INTO v_tenant FROM trial_bookings WHERE id = p_booking_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may cancel a trial';
  END IF;

  UPDATE trial_bookings
     SET cancelled_at = NOW(), cancelled_by = v_actor
   WHERE id = p_booking_id AND cancelled_at IS NULL;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (v_actor, 'trial_booking_cancelled', 'Student',
          (SELECT student_id FROM trial_bookings WHERE id = p_booking_id),
          jsonb_build_object('booking_id', p_booking_id));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_trial_booking(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_trial_booking(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_trial_booking(UUID) TO authenticated;

-- ============================================================
-- add_unclaimed_student()'s trial mode now books instead of marking.
--
-- ⚠ THE SIGNATURE IS UNCHANGED, DELIBERATELY. PostgREST resolves a function by
-- its EXACT argument list, so removing `p_status` would break the currently
-- deployed coach walk-in form the instant this migration lands — and under the
-- migrate-first deploy order that window is the whole deploy. `p_status` is
-- therefore kept and IGNORED, the same deprecate-then-drop discipline used for
-- coaches.paynow_qr_url. A later migration drops it once no caller passes it.
--
-- Body re-derived from the live definition (§7.40), changing only the trial
-- branch.
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_unclaimed_student(
  p_class_id       UUID,
  p_full_name      TEXT,
  p_kind           unclaimed_student_kind,
  p_session_date   DATE     DEFAULT NULL,
  -- DEPRECATED AND IGNORED since 20260725000800. A trial no longer writes
  -- attendance — the coach marks it on the day. Kept only so the previously
  -- deployed caller still resolves; do not read it.
  p_status         attendance_status DEFAULT NULL,
  p_date_of_birth  DATE     DEFAULT NULL,
  p_contact_name   TEXT     DEFAULT NULL,
  p_contact_phone  TEXT     DEFAULT NULL,
  p_contact_email  TEXT     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_student  UUID;
  v_name     TEXT := trim(COALESCE(p_full_name, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- A TRIAL is now admin-only, like book_trial(). An ONGOING student is still
  -- the coach's to add: that is a child already turning up every week, which
  -- the coach is the one to notice.
  IF p_kind = 'trial' THEN
    IF NOT is_tenant_admin(v_tenant) THEN
      RAISE EXCEPTION 'only this business''s admin may book a trial';
    END IF;
    IF p_session_date IS NULL THEN
      RAISE EXCEPTION 'a trial needs the date of the lesson'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT (
    is_tenant_admin(v_tenant)
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = p_class_id AND c.coach_id = current_coach_id()
    )
  ) THEN
    RAISE EXCEPTION 'not permitted to add a student to this class';
  END IF;

  BEGIN
    INSERT INTO students (
      full_name, date_of_birth, tenant_id, created_by, assignment_status,
      provisional_contact_name, provisional_contact_phone, provisional_contact_email
    )
    VALUES (
      v_name, p_date_of_birth, v_tenant, v_actor,
      -- A trial is not an assignment. They are expected at ONE lesson, not
      -- placed in the class, so they stay unassigned until someone enrols them
      -- deliberately.
      (CASE WHEN p_kind = 'trial' THEN 'unassigned' ELSE 'assigned' END)::assignment_status,
      NULLIF(trim(COALESCE(p_contact_name, '')), ''),
      NULLIF(trim(COALESCE(p_contact_phone, '')), ''),
      NULLIF(trim(COALESCE(p_contact_email, '')), '')
    )
    RETURNING id INTO v_student;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'A child called % with that date of birth is already registered with this business. If this is the same child, find them on the roster instead of adding them again.',
      v_name
      USING ERRCODE = 'unique_violation';
  END;

  IF p_kind = 'trial' THEN
    -- One booking, nothing else. book_trial() carries the date and
    -- already-a-customer checks; a brand-new child can trip neither, but
    -- routing through it keeps ONE definition of what booking means.
    PERFORM book_trial(p_class_id, p_session_date, v_student);
  ELSE
    INSERT INTO student_class_enrolments (student_id, class_id)
    VALUES (v_student, p_class_id);
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor,
    CASE WHEN p_kind = 'trial' THEN 'unclaimed_trial_booked'
         ELSE 'unclaimed_student_added' END,
    'Student',
    v_student,
    (SELECT to_jsonb(s) FROM students s WHERE s.id = v_student)
  );

  RETURN v_student;
END;
$$;

REVOKE ALL ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
) TO authenticated;
