-- Rollback for 20261016000100_student_gender_admin.sql.
--
-- ⚠ APPS FIRST. Do NOT run this while an admin bundle that calls set_student_gender or add_unclaimed_student with
-- p_gender is live:
--   1. revert the admin app commit and push main;
--   2. prove the served admin bundle no longer contains "set_student_gender" (§7.31);
--   3. only then run this file.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261016000100';
--
-- Genders written through either function are ordinary column values — they stay (nothing to undo).
-- add_unclaimed_student is restored from pg_get_functiondef captured BEFORE the migration.

DROP FUNCTION public.set_student_gender(UUID, gender_type);

DROP FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE, gender_type
);
CREATE FUNCTION public.add_unclaimed_student(p_class_id uuid, p_full_name text, p_kind unclaimed_student_kind, p_session_date date DEFAULT NULL::date, p_status attendance_status DEFAULT NULL::attendance_status, p_date_of_birth date DEFAULT NULL::date, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_starts_on date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_student  UUID;
  v_name     TEXT := trim(COALESCE(p_full_name, ''));
  v_start_at TIMESTAMPTZ;
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

  -- BOTH kinds are now admin-only. A TRIAL always was (like book_trial()); an
  -- ONGOING student joins it as of 2026-08-21 — every new child goes through
  -- the admin, no coach arm. (§7.202)
  IF p_kind = 'trial' THEN
    IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
      RAISE EXCEPTION 'only this business''s admin may book a trial';
    END IF;
    IF p_session_date IS NULL THEN
      RAISE EXCEPTION 'a trial needs the date of the lesson'
        USING ERRCODE = 'check_violation';
    END IF;
    -- A trial is one dated lesson, not a placement; a start date means nothing here.
    IF p_starts_on IS NOT NULL THEN
      RAISE EXCEPTION 'a trial has its own lesson date — no start date'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
    RAISE EXCEPTION 'not permitted to add a student to this class';
  ELSE
    -- 20261005000100: validated BEFORE the student row, so a bad date adds nothing.
    v_start_at := enrolment_start_at(v_tenant, p_starts_on);
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
    INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at)
    VALUES (v_student, p_class_id, v_start_at);
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
$function$;

REVOKE ALL ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE
) TO authenticated;
