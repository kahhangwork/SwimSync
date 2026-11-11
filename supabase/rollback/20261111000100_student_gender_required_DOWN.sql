-- Rollback for 20261111000100_student_gender_required.sql — restores both bodies as captured by
-- pg_get_functiondef() BEFORE the migration (md5 4865f526… / 3b90fb8c…). No app dependency: the clients send p_gender
-- either way. After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261111000100';

CREATE OR REPLACE FUNCTION public.add_unclaimed_student(p_class_id uuid, p_full_name text, p_kind unclaimed_student_kind, p_session_date date DEFAULT NULL::date, p_status attendance_status DEFAULT NULL::attendance_status, p_date_of_birth date DEFAULT NULL::date, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_starts_on date DEFAULT NULL::date, p_gender gender_type DEFAULT NULL::gender_type)
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

CREATE OR REPLACE FUNCTION public.add_child_or_claim(p_tenant_id uuid, p_full_name text, p_date_of_birth date, p_gender text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_mode add_child_mode DEFAULT 'check'::add_child_mode, p_candidate_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(outcome text, student_id uuid, candidates jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_parent   UUID := current_parent_id();
  v_name     TEXT := btrim(COALESCE(p_full_name, ''));
  v_reason   TEXT;
  v_student  UUID;
  v_cands    JSONB;
  v_existing UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'only a parent can add a child';
  END IF;

  -- The guard that replaces the tenant pin. See the header.
  IF NOT parent_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'you have not joined that business';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- ── The block (PARENT_CLAIM_PLAN decision 5) ─────────────────────────────
  -- While a claim is pending, this parent cannot re-add the same child. Without
  -- it, tapping Save again is a way straight round the popup.
  --
  -- ⚠ IS NOT DISTINCT FROM, NOT `=`. Half the children this feature exists for
  -- have no date of birth — that is precisely why students_identity_uniq lets
  -- their duplicate through. With `=`, a NULL dob makes the whole predicate
  -- NULL, the block silently never fires, and the bug returns.
  SELECT sc.id INTO v_existing
    FROM student_claims sc
   WHERE sc.parent_id = v_parent
     AND sc.tenant_id = p_tenant_id
     AND sc.status = 'pending'
     AND lower(btrim(sc.claimed_name)) = lower(v_name)
     AND sc.claimed_dob IS NOT DISTINCT FROM p_date_of_birth
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'already_pending'::TEXT, NULL::UUID, NULL::JSONB;
    RETURN;
  END IF;

  -- ── claim_confirmed / claim_unsure ───────────────────────────────────────
  IF p_mode IN ('claim_confirmed', 'claim_unsure') THEN
    IF p_candidate_id IS NULL THEN
      RAISE EXCEPTION 'which child are you claiming?' USING ERRCODE = 'check_violation';
    END IF;

    -- ⚠ NEVER TRUST THE CANDIDATE ID FROM THE CLIENT. Re-derive eligibility
    -- from find_student_candidates() rather than checking a couple of columns
    -- here: that function IS the definition of "a child this parent may claim"
    -- (unclaimed, this tenant, actually matching, not already pending), and a
    -- second hand-written copy of that rule would drift. Without this, a parent
    -- could post any student id they could guess.
    SELECT c.match_reason INTO v_reason
      FROM find_student_candidates(p_tenant_id, v_name, p_date_of_birth) c
     WHERE c.student_id = p_candidate_id;

    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'that child is not one you can claim';
    END IF;

    INSERT INTO student_claims (
      tenant_id, student_id, parent_id,
      claimed_name, claimed_dob, claimed_gender, claimed_notes,
      certainty, match_reason
    ) VALUES (
      p_tenant_id, p_candidate_id, v_parent,
      v_name, p_date_of_birth,
      NULLIF(btrim(COALESCE(p_gender, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      (CASE WHEN p_mode = 'claim_confirmed' THEN 'confirmed' ELSE 'unsure' END)::claim_certainty,
      v_reason
    );

    INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    VALUES (
      p_tenant_id, v_actor, 'student_claim_filed', 'Student', p_candidate_id,
      jsonb_build_object(
        'parent_id', v_parent, 'certainty', p_mode::TEXT,
        'match_reason', v_reason, 'claimed_name', v_name
      )
    );

    RETURN QUERY SELECT 'pending'::TEXT, p_candidate_id, NULL::JSONB;
    RETURN;
  END IF;

  -- ── check: look before creating ──────────────────────────────────────────
  IF p_mode = 'check' THEN
    SELECT jsonb_agg(to_jsonb(c)) INTO v_cands
      FROM find_student_candidates(p_tenant_id, v_name, p_date_of_birth) c;

    IF v_cands IS NOT NULL AND jsonb_array_length(v_cands) > 0 THEN
      -- INSERT NOTHING. The parent has not answered yet.
      RETURN QUERY SELECT 'candidates'::TEXT, NULL::UUID, v_cands;
      RETURN;
    END IF;
  END IF;

  -- ── create (no candidates, or the parent said "no") ──────────────────────
  -- ⚠ TRIPWIRE: everything below must stay byte-for-byte equivalent to what
  -- the app's plain INSERT did before this function existed. Same columns, same
  -- defaults, same friendly 23505. A parent whose child matches nothing must
  -- not be able to tell this slice shipped.
  BEGIN
    INSERT INTO students (
      full_name, date_of_birth, gender, notes,
      assignment_status, is_active, tenant_id, created_by
    ) VALUES (
      v_name, p_date_of_birth,
      -- gender is the gender_type ENUM, not text — cast explicitly. An unknown
      -- value raises here rather than being silently dropped.
      NULLIF(btrim(lower(COALESCE(p_gender, ''))), '')::gender_type,
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      'unassigned', TRUE, p_tenant_id, v_actor
    )
    RETURNING id INTO v_student;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END;

  -- No ON CONFLICT clause, deliberately: the student was created two statements
  -- ago, so a link to them cannot already exist. It would also be AMBIGUOUS —
  -- `student_id` is both a column of parent_students and one of this function's
  -- OUT parameters, and a conflict target cannot tell them apart.
  INSERT INTO parent_students (parent_id, student_id) VALUES (v_parent, v_student);

  -- A deliberate "no, that is a different child" is worth recording: it is the
  -- moment a known duplicate is created on purpose, and the admin's detection
  -- list will surface the pair afterwards. The parent may be wrong.
  IF p_mode = 'create_anyway' THEN
    INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    VALUES (
      p_tenant_id, v_actor, 'child_created_despite_candidates', 'Student', v_student,
      jsonb_build_object('parent_id', v_parent, 'claimed_name', v_name)
    );
  END IF;

  RETURN QUERY SELECT 'created'::TEXT, v_student, NULL::JSONB;
END;
$function$;
