-- Wave 4 lane 1: a start date on add-to-class, and changing it afterwards.
-- docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md (reviewed 2026-10-05).
--
-- WHY. Every enrolment was stamped enrolled_at = NOW(), and every roster starts on
-- that Singapore date. On 04 Oct 2026 a child swam the day BEFORE the admin assigned
-- them, so that lesson had no roster to mark; the only remedy was a raw UPDATE on
-- production (DEPLOYMENT #62), with no audit trail — enrolments carry no audit trigger.
--
-- WHAT.
--   enrolment_start_at()      internal: a validated start date → the timestamptz to store
--   set_enrolment_start()     add a child to a class, or change an existing start (audited)
--   enrolment_start_bounds()  the date picker's min / max / sealed-month inputs
--   add_unclaimed_student()   gains a trailing p_starts_on (the 4th add path, D12)
--   COMMENTs on the two email claim functions (BACKLOG item; no behaviour)
--
-- STORAGE (D10). A past start is stored at 12:00 SGT (= 04:00 UTC, same calendar date).
-- The billing engine reads enrolled_at with a raw .slice(0,10) — the UTC date
-- (core.ts earliestEnrolment, orderingGuard.ts rawFrom); every other reader takes the
-- SGT date. At noon the two agree. SGT MIDNIGHT would put the engine a day early.
-- DEPLOYMENT #62's working backdate is noon too. A start of today keeps NOW().
--
-- REMOTE CHECK after deploy (§7.39 — local cannot show cloud default privileges):
--   scripts/prod-query-ro.sh "select has_function_privilege('anon','public.set_enrolment_start(uuid,uuid,date,text)','EXECUTE')"
--   → must be false; likewise enrolment_start_bounds(uuid) and add_unclaimed_student(...10 args).
--
-- ROLLBACK: supabase/rollback/20261005000100_enrolment_start_date_DOWN.sql — APPS FIRST.

-- ── 1. The one place a start date becomes a timestamp ────────────────────────────
CREATE FUNCTION public.enrolment_start_at(p_tenant_id UUID, p_starts_on DATE)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := today_sg();
  v_floor DATE := markable_floor(p_tenant_id);
BEGIN
  IF p_starts_on IS NULL OR p_starts_on = v_today THEN
    RETURN NOW();
  END IF;

  -- D6: a future start is a different feature.
  IF p_starts_on > v_today THEN
    RAISE EXCEPTION 'A class can''t start in the future — pick today or an earlier date.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- D3: earlier than the floor is unmarkable anyway.
  IF p_starts_on < v_floor THEN
    RAISE EXCEPTION 'The earliest start date allowed is %.', to_char(v_floor, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  -- D10: 12:00 Singapore — the UTC date and the SGT date are the same day.
  RETURN (p_starts_on + TIME '12:00') AT TIME ZONE 'Asia/Singapore';
END;
$$;

COMMENT ON FUNCTION public.enrolment_start_at(UUID, DATE) IS
  'Internal. A start date → the enrolled_at to store: NULL/today → NOW(); past → 12:00 SGT (UTC and SGT dates agree, so the engine''s raw slice reads the same day); future or below markable_floor → refused. Called only from SECURITY DEFINER functions; no client grant. 20261005000100.';

REVOKE ALL ON FUNCTION public.enrolment_start_at(UUID, DATE) FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. Add, or change a start ────────────────────────────────────────────────────
CREATE FUNCTION public.set_enrolment_start(
  p_student_id UUID,
  p_class_id   UUID,
  p_starts_on  DATE,
  p_mode       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_tenant     UUID;
  v_class      TEXT;
  v_day        TEXT;
  v_stu_tenant UUID;
  v_child      TEXT;
  v_start      DATE := COALESCE(p_starts_on, today_sg());
  v_row        student_class_enrolments%ROWTYPE;
  v_old_start  DATE;
  v_prev_end   DATE;
  v_marked     DATE;
  v_dropped    DATE[] := '{}';
  v_old        JSONB;
  v_new        JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ⚠ RISK 2: the mode is EXPLICIT. Never "a row exists, so edit" — that turns a
  -- duplicate Add into a silent start-date rewrite.
  IF p_mode IS NULL OR p_mode NOT IN ('add', 'change') THEN
    RAISE EXCEPTION 'mode must be add or change';
  END IF;

  -- ⚠ RISK 4: SECURITY DEFINER, so RLS does not run here — this IS the check.
  -- The tenant comes from the CLASS. No coach arm: every child is added by the
  -- admin (§7.202) — unlike close_student_enrolment, which admits the coach.
  SELECT c.tenant_id, c.title, c.day_of_week::text
    INTO v_tenant, v_class, v_day
    FROM classes c
   WHERE c.id = p_class_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'operations', 'edit')) THEN
    RAISE EXCEPTION 'not permitted to change this child''s classes';
  END IF;

  SELECT s.tenant_id, s.full_name INTO v_stu_tenant, v_child
    FROM students s WHERE s.id = p_student_id;
  IF v_stu_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;
  IF v_stu_tenant <> v_tenant THEN
    RAISE EXCEPTION 'that child belongs to a different business';
  END IF;

  SELECT * INTO v_row
    FROM student_class_enrolments e
   WHERE e.student_id = p_student_id
     AND e.class_id   = p_class_id
     AND e.is_active
     FOR UPDATE;

  -- D8 (corrected, RISK 7): not BEFORE the previous window's end. EQUAL is allowed —
  -- the two windows share a day, which every span reader de-duplicates, and refusing
  -- it would break today's same-day remove → re-add.
  SELECT max((e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date)
    INTO v_prev_end
    FROM student_class_enrolments e
   WHERE e.student_id = p_student_id
     AND e.class_id   = p_class_id
     AND NOT e.is_active
     AND e.unenrolled_at IS NOT NULL;
  IF v_prev_end IS NOT NULL AND v_start < v_prev_end THEN
    RAISE EXCEPTION '% was last in % until % — the new start can''t be earlier than that.',
      v_child, v_class, to_char(v_prev_end, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_mode = 'add' THEN
    IF v_row.id IS NOT NULL THEN
      RAISE EXCEPTION '% is already in % (since %). To change when they started, use Change on the class roster.',
        v_child, v_class,
        to_char((v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date, 'FMDD Mon YYYY')
        USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at)
    VALUES (p_student_id, p_class_id, enrolment_start_at(v_tenant, p_starts_on))
    RETURNING * INTO v_row;

    -- Only ever TOWARD assigned (close_student_enrolment owns the other way).
    UPDATE students
       SET assignment_status = 'assigned', updated_at = NOW()
     WHERE id = p_student_id
       AND assignment_status <> 'assigned';

    v_new := to_jsonb(v_row);
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (v_actor, 'enrolment_added', 'Student', p_student_id, NULL, v_new);

  ELSE  -- 'change'
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION '% is not in %.', v_child, v_class;
    END IF;

    v_old_start := (v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date;
    v_old := to_jsonb(v_row);

    IF v_start > v_old_start THEN
      -- D7: a later start may not strand a lesson that was already marked.
      SELECT min(ls.session_date) INTO v_marked
        FROM attendance a
        JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       WHERE a.student_id = p_student_id
         AND ls.class_id = p_class_id
         AND ls.session_date >= v_old_start
         AND ls.session_date <  v_start;
      IF v_marked IS NOT NULL THEN
        RAISE EXCEPTION '% already has a mark on % — the start can''t move past a marked lesson.',
          v_child, to_char(v_marked, 'FMDD Mon YYYY')
          USING ERRCODE = 'check_violation';
      END IF;

      -- ⚠ RISK 6: a later start is NOT a way to clear the unmarked block. Record
      -- exactly which expected lessons stop being expected.
      SELECT COALESCE(array_agg(d ORDER BY d), '{}') INTO v_dropped
        FROM (
          SELECT g::date AS d
            FROM generate_series(v_old_start, v_start - 1, INTERVAL '1 day') g
           WHERE (ARRAY['sunday','monday','tuesday','wednesday','thursday',
                        'friday','saturday'])[EXTRACT(DOW FROM g)::int + 1] = v_day
          UNION
          SELECT ls.session_date
            FROM lesson_sessions ls
           WHERE ls.class_id = p_class_id
             AND ls.session_date >= v_old_start
             AND ls.session_date <  v_start
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM lesson_sessions ls
          WHERE ls.class_id = p_class_id
            AND ls.session_date = x.d
            AND ls.cancelled_at IS NOT NULL
       );
    END IF;

    UPDATE student_class_enrolments
       SET enrolled_at = enrolment_start_at(v_tenant, p_starts_on)
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    v_new := to_jsonb(v_row) || jsonb_build_object('dropped_dates', to_jsonb(v_dropped));
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (v_actor, 'enrolment_start_changed', 'Student', p_student_id, v_old, v_new);
  END IF;

  RETURN jsonb_build_object(
    'enrolment_id',    v_row.id,
    'starts_on',       (v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date,
    'in_sealed_month', EXISTS (
      SELECT 1 FROM billing_periods bp
       WHERE bp.tenant_id = v_tenant
         AND bp.billing_month >= to_char(v_start, 'YYYY-MM')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.set_enrolment_start(UUID, UUID, DATE, TEXT) IS
  'Add a child to a class (p_mode add) or change an active enrolment''s start (p_mode change), audited. Mode is explicit: add refuses an existing enrolment. operations:edit or platform admin; no coach arm (§7.202). Start NULL = today; bounds via enrolment_start_at. A later start refuses past a mark and records dropped_dates. 20261005000100.';

REVOKE ALL ON FUNCTION public.set_enrolment_start(UUID, UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_enrolment_start(UUID, UUID, DATE, TEXT) TO authenticated;

-- ── 3. The date picker's inputs ──────────────────────────────────────────────────
CREATE FUNCTION public.enrolment_start_bounds(p_class_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_day    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.day_of_week::text INTO v_tenant, v_day
    FROM classes c WHERE c.id = p_class_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'operations', 'view')) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  RETURN jsonb_build_object(
    'floor',             markable_floor(v_tenant),
    'today',             today_sg(),
    'last_sealed_month', (SELECT max(bp.billing_month)::text FROM billing_periods bp
                           WHERE bp.tenant_id = v_tenant),
    'day_of_week',       v_day
  );
END;
$$;

COMMENT ON FUNCTION public.enrolment_start_bounds(UUID) IS
  'Inputs for the Starts-on picker: floor (markable_floor), today (SGT), last_sealed_month, the class weekday. operations:view. Exposing last_sealed_month to a role without billing access is DELIBERATE — markable_floor already implies it (RISK 16). 20261005000100.';

REVOKE ALL ON FUNCTION public.enrolment_start_bounds(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enrolment_start_bounds(UUID) TO authenticated;

-- ── 4. The fourth add path (D12) ─────────────────────────────────────────────────
-- §7.124: DROP the exact old signature first, or CREATE makes an overload and
-- PostgREST cannot choose between them. The new parameter is LAST with a DEFAULT,
-- so the live app's named-argument call keeps working until it is redeployed
-- (§7.123). Body otherwise identical to the live one (read via pg_get_functiondef,
-- §7.40) — the only change is the enrolment insert's enrolled_at.
DROP FUNCTION public.add_unclaimed_student(
  UUID, TEXT, unclaimed_student_kind, DATE, attendance_status, DATE, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.add_unclaimed_student(
  p_class_id      UUID,
  p_full_name     TEXT,
  p_kind          unclaimed_student_kind,
  p_session_date  DATE DEFAULT NULL,
  p_status        attendance_status DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL,
  p_contact_name  TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_starts_on     DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- ── 5. The email-claim COMMENTs (BACKLOG; no behaviour) ──────────────────────────
-- The catalogue text says nothing about keys; the wrong "NEW Idempotency-Key" line
-- lives only in a `--` comment of applied migration 20260927000100. Re-issue the
-- current text unchanged, plus one sentence, so \df+ carries the decision.
COMMENT ON FUNCTION public.claim_invoice_email(UUID, BOOLEAN) IS
  'Claim one invoice email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token, or no row. service_role only. 20260927000100. A MAY_HAVE_SENT resend REUSES the email''s one Idempotency-Key (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2); the -- note in 20260927000100 saying otherwise is superseded (20261005000100).';

COMMENT ON FUNCTION public.claim_credit_note_email(UUID, BOOLEAN) IS
  'Claim one credit-note email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token + issued_at, or no row. service_role only. 20260927000100. A MAY_HAVE_SENT resend REUSES the email''s one Idempotency-Key (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2); the -- note in 20260927000100 saying otherwise is superseded (20261005000100).';
