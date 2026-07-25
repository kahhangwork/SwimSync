-- ============================================================
-- add_unclaimed_student(): put a child on the roster before their parent has
-- a SwimSync account. Callable by the class's COACH or the tenant's ADMIN.
--
-- Why this exists: onboarding is the production bottleneck. A parent brings a
-- child for a trial, or an existing student's parent takes three weeks to
-- register — and in both cases the child does not exist, so the coach cannot
-- mark attendance, so the lesson is invisible to billing, to the coach's own
-- payout, and to the completeness gate. The remedy has to be reachable by the
-- person standing at the poolside.
--
-- Why a SECURITY DEFINER function rather than an RLS policy: identical
-- reasoning to close_student_enrolment (20260718000200). students_insert
-- already allows the tenant admin, so the ADMIN needs nothing new — but
-- granting coaches INSERT/UPDATE on students would also expose names, DOBs and
-- notes, because RLS is row-level, not column-level. A function exposes
-- exactly this one operation.
--
-- ⚠ THE TENANT PIN DOES NOT PROTECT THIS PATH. pin_student_tenant()
-- (20260719001500) exempts SECURITY DEFINER writers by design — its seam is
-- `current_user`, and this function runs as postgres. Verified empirically
-- during the phase 0 spike: inside a SECURITY DEFINER function auth.uid() is
-- the CALLER while current_user is `postgres`. So nothing downstream will
-- catch a wrong tenant_id here.
-- THEREFORE: p_tenant_id IS NOT A PARAMETER. The tenant is derived from the
-- class, every time. Do not add one.
--
-- TWO SHAPES, and the difference is the ENROLMENT LIFECYCLE, not a new concept:
--
--   'trial'   — a walk-in who is here for exactly one lesson. The enrolment is
--               opened AND closed on the session's own date, and the attendance
--               row is written in the same call ("add and mark" is one action
--               at the poolside — you are adding them because they are here).
--               Billing follows attendance rows, not active enrolments
--               (§7.13), so the lesson still bills; but activeStudentIds never
--               contains them afterwards, so a one-off trial cannot block the
--               completeness gate on every future lesson forever.
--
--   'ongoing' — an existing student whose parent has not registered. Open
--               recurring enrolment. They DO block the gate, which is correct:
--               they attend every week and must be marked.
--
-- Deliberately NOT offered: linking a parent (that is the invite/claim path),
-- and deleting (history must survive — PRD §11.5, and a free trial is what
-- justifies the coach's payout, §7.13).
-- ============================================================

CREATE TYPE unclaimed_student_kind AS ENUM ('trial', 'ongoing');

CREATE OR REPLACE FUNCTION public.add_unclaimed_student(
  p_class_id       UUID,
  p_full_name      TEXT,
  p_kind           unclaimed_student_kind,
  -- Required for 'trial': the date of the lesson they are attending. Passed in
  -- by the caller as an SGT date string.
  --
  -- ⚠ NEVER DERIVE THIS FROM now()/CURRENT_DATE. Postgres runs UTC on
  -- Supabase, which before 08:00 SGT is the PREVIOUS DAY (§7.7). That exact
  -- mistake — a weekday and a date disagreeing — created a second
  -- lesson_sessions row and DOUBLE-BILLED a whole class once already.
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
  v_actor      UUID := auth.uid();
  v_tenant     UUID;
  v_student    UUID;
  v_session    UUID;
  v_name       TEXT := trim(COALESCE(p_full_name, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- The tenant comes from the CLASS. See the header: nothing downstream will
  -- catch a wrong one.
  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- Authorisation: the coach who currently teaches this class, or the
  -- business's admin. Checked against the CLASS's tenant, so a coach of
  -- another business is refused even with a valid class id.
  IF NOT (
    is_tenant_admin(v_tenant)
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = p_class_id AND c.coach_id = current_coach_id()
    )
  ) THEN
    RAISE EXCEPTION 'not permitted to add a student to this class';
  END IF;

  IF p_kind = 'trial' THEN
    IF p_session_date IS NULL OR p_status IS NULL THEN
      RAISE EXCEPTION 'a trial needs the session date and an attendance status'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ── The student ────────────────────────────────────────────────────────
  -- created_by is the CALLING COACH, not postgres. This is load-bearing:
  -- coach_serves_student() requires an ACTIVE enrolment, so once a trial
  -- enrolment closes the coach would lose sight of the child they just marked.
  -- students_select's `created_by = auth.uid()` branch is what keeps them
  -- visible. (Same trick the parent path uses to read back its own insert.)
  BEGIN
    INSERT INTO students (
      full_name, date_of_birth, tenant_id, created_by, assignment_status,
      provisional_contact_name, provisional_contact_phone, provisional_contact_email
    )
    VALUES (
      v_name, p_date_of_birth, v_tenant, v_actor, 'assigned',
      NULLIF(trim(COALESCE(p_contact_name, '')), ''),
      NULLIF(trim(COALESCE(p_contact_phone, '')), ''),
      NULLIF(trim(COALESCE(p_contact_email, '')), '')
    )
    RETURNING id INTO v_student;
  EXCEPTION WHEN unique_violation THEN
    -- students_identity_uniq fires when this business already knows a child
    -- with this name and date of birth. PRD §5.1 requires a plain explanation
    -- rather than a database error — this happens at the poolside, mid-class.
    RAISE EXCEPTION
      'A child called % with that date of birth is already registered with this business. If this is the same child, find them on the roster instead of adding them again.',
      v_name
      USING ERRCODE = 'unique_violation';
  END;

  -- ── The enrolment ──────────────────────────────────────────────────────
  IF p_kind = 'trial' THEN
    -- Opened and closed on its own date. See the header.
    INSERT INTO student_class_enrolments
      (student_id, class_id, enrolled_at, unenrolled_at, is_active)
    VALUES (v_student, p_class_id, p_session_date, p_session_date, FALSE);
  ELSE
    INSERT INTO student_class_enrolments (student_id, class_id)
    VALUES (v_student, p_class_id);
  END IF;

  -- ── The attendance row (trial only) ────────────────────────────────────
  IF p_kind = 'trial' THEN
    -- ⚠ This makes the function the SECOND writer of lesson_sessions; the
    -- attendance save in the app is the first. A duplicate (class, date) row
    -- double-bills everyone (§7.7), so resolve with ON CONFLICT DO NOTHING and
    -- then SELECT — never check-then-insert, which races.
    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT ON CONSTRAINT lesson_sessions_class_id_session_date_key DO NOTHING;

    SELECT id INTO v_session
      FROM lesson_sessions
     WHERE class_id = p_class_id AND session_date = p_session_date;

    -- marked_by is a PROFILE id, not coaches.id (§7.2).
    INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
    VALUES (v_session, v_student, p_status, v_actor);
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor,
    CASE WHEN p_kind = 'trial' THEN 'unclaimed_trial_added'
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

-- §7.39: REVOKE FROM PUBLIC does NOT remove role grants, and Supabase *cloud*
-- default-grants new public functions to anon and service_role where the local
-- stack grants only postgres+authenticated. So a local check passes vacuously.
-- Both are revoked EXPLICITLY, and must be re-verified against the REMOTE
-- pg_proc after deploy.
REVOKE EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
) FROM anon, service_role;

GRANT EXECUTE ON FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
) TO authenticated;
