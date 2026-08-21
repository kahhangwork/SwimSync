-- ============================================================
-- ROLLBACK for 20260821000600_ongoing_admin_only.sql (§7.202).
--
-- Restores add_unclaimed_student() to its 20260725000800 body: the ONGOING
-- arm again permits the class's OWN coach (c.coach_id = current_coach_id())
-- as well as the tenant admin. Same signature, so a plain CREATE OR REPLACE;
-- no grant change to undo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_unclaimed_student(
  p_class_id       UUID,
  p_full_name      TEXT,
  p_kind           unclaimed_student_kind,
  p_session_date   DATE     DEFAULT NULL,
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
