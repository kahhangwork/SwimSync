-- Admins record a child's gender — the admin half of "gender is required, never pre-selected" (user, 2026-10-16).
--
-- WHY. Every one of the 27 prod children with no gender (2026-10-16) was created by an admin: add_unclaimed_student
-- (Students → Add student, Trials → Book trial) had no gender input, and no admin surface could set one afterwards.
-- 25 of the 27 have no parent, so the parent app's Edit Child (which now requires it) can never reach them.
--
--   add_unclaimed_student()  gains a trailing p_gender (the admin forms require it from this release)
--   set_student_gender()     NEW — the admin's guarded path to set a child's gender (model: rename_student)
--
-- EXPAND ONLY. p_gender is LAST with a DEFAULT, so the live admin's named-argument call (no p_gender) keeps working
-- until the new admin is deployed (§7.123). The server does not yet REFUSE a missing gender: the requirement is the
-- admin form's, exactly as it is the parent app's (add_child_or_claim's p_gender is optional too). Refusing NULL
-- server-side is a separate CONTRACT step, once no deployed client can omit it.
--
-- Body re-read from pg_get_functiondef() (§7.40); prod md5 = local md5 (534e5dc0…) on 2026-10-16 (§7.336). The only
-- changes: the signature, and `gender` in the students INSERT.
--
-- GRANTS (§7.35, §7.82, §7.39): both functions REVOKE ALL FROM PUBLIC/anon/authenticated/service_role, then GRANT
-- EXECUTE to authenticated; the body is the boundary (has_admin_area 'operations' 'edit'). After `db push`, dump the
-- remote and confirm anon holds neither:
--   supabase db dump --linked -f /tmp/remote_dump.sql
--   grep -iE 'add_unclaimed_student|set_student_gender' /tmp/remote_dump.sql | grep -iE 'grant|revoke'
--
-- Rollback: supabase/rollback/20261016000100_student_gender_admin_DOWN.sql (APPS FIRST — see its header).

-- ── 1. add_unclaimed_student gains p_gender ─────────────────────────────────────────────────────────────────────
-- §7.124: DROP the exact old signature first, or CREATE makes an overload PostgREST cannot choose between.
DROP FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE
);

CREATE FUNCTION public.add_unclaimed_student(p_class_id uuid, p_full_name text, p_kind unclaimed_student_kind, p_session_date date DEFAULT NULL::date, p_status attendance_status DEFAULT NULL::attendance_status, p_date_of_birth date DEFAULT NULL::date, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_starts_on date DEFAULT NULL::date, p_gender gender_type DEFAULT NULL::gender_type)
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
      full_name, date_of_birth, gender, tenant_id, created_by, assignment_status,
      provisional_contact_name, provisional_contact_phone, provisional_contact_email
    )
    VALUES (
      v_name, p_date_of_birth, p_gender, v_tenant, v_actor,
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
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE, gender_type
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT, DATE, gender_type
) TO authenticated;

-- ── 2. set_student_gender — set a child's gender from the admin's student page ───────────────────────────────────
CREATE FUNCTION public.set_student_gender(p_student_id UUID, p_gender gender_type)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_row   students%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM students WHERE id = p_student_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  -- Tenant from the ROW (§7.42), the same predicate as rename_student: refuses a non-admin, a view-only role, a
  -- disabled admin, a suspended tenant and the platform admin.
  IF NOT has_admin_area(v_row.tenant_id, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may set a child''s gender';
  END IF;

  -- Setting, never clearing: gender is required, so NULL is not a value this path writes.
  IF p_gender IS NULL THEN
    RAISE EXCEPTION 'a gender is required' USING ERRCODE = 'check_violation';
  END IF;

  -- The students audit trigger (trg_audit_student_update) records the change against auth.uid(); an unchanged
  -- value is a clean no-op (the trigger's WHEN skips it).
  UPDATE students SET gender = p_gender WHERE id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.set_student_gender(UUID, gender_type) IS
  'Admin sets a child''s gender (operations/edit, tenant from the row). Refuses NULL — gender is set, never cleared. Audited by trg_audit_student_update. 20261016000100.';

REVOKE ALL ON FUNCTION public.set_student_gender(UUID, gender_type) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_student_gender(UUID, gender_type) TO authenticated;
