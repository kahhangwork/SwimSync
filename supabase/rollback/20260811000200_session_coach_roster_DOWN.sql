-- ============================================================================
-- ROLLBACK for 20260811000200_session_coach_roster.sql (Wave 3).
--
-- Committed BEFORE the deploy and REHEARSED by running it — §7.93, where
-- actually running the DOWN file is the half that finds the bugs. A scratchpad
-- backup nobody can find later is not a rollback plan; the pattern being
-- copied is 20260804_authenticated_grants_DOWN.sql.
--
-- Restores every one of the EIGHT policies this wave widened, both function
-- bodies it replaced, and drops the roster itself. The policy bodies below are
-- the pre-wave definitions taken from pg_policies on a database at
-- 20260811000100 — not retyped from the migrations that first created them,
-- because CREATE OR REPLACE means the newest definition can live in any later
-- file and grep finds the oldest first (§7.115).
--
-- SAFE TO RUN WITH ROSTER DATA PRESENT: dropping session_coaches discards the
-- assignments, which is the point — every lesson reverts to being taught and
-- paid by its class's coach. Any payout ALREADY GENERATED from a roster row
-- keeps its amounts; re-running payroll for that period after this rollback
-- re-attributes it to the class's coach. Check coach_payout_items for
-- is_adjustment rows before rolling back a settled month.
-- ============================================================================

-- ── the eight policies, back to their pre-wave form ─────────────────────────

DROP POLICY IF EXISTS sessions_select ON lesson_sessions;
CREATE POLICY sessions_select ON lesson_sessions FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR coach_owns_class(class_id)
    OR is_tenant_admin(class_tenant(class_id))
    OR parent_has_child_in_class(class_id)
  );

DROP POLICY IF EXISTS attendance_select ON attendance;
CREATE POLICY attendance_select ON attendance FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_session(lesson_session_id)
    OR is_tenant_admin(session_tenant(lesson_session_id))
  );

DROP POLICY IF EXISTS attendance_write ON attendance;
CREATE POLICY attendance_write ON attendance FOR ALL TO authenticated
  USING (
    coach_owns_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  )
  WITH CHECK (
    coach_owns_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  );

DROP POLICY IF EXISTS classes_select ON classes;
CREATE POLICY classes_select ON classes FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_id = current_coach_id()
    OR parent_has_child_in_class(id)
  );

DROP POLICY IF EXISTS enrolments_select ON student_class_enrolments;
CREATE POLICY enrolments_select ON student_class_enrolments FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_class(class_id)
    OR is_tenant_admin(class_tenant(class_id))
  );

DROP POLICY IF EXISTS students_select ON students;
CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR created_by = auth.uid()
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
    OR coach_serves_student(id)
  );

DROP POLICY IF EXISTS trial_bookings_select ON trial_bookings;
CREATE POLICY trial_bookings_select ON trial_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = trial_bookings.class_id AND c.coach_id = current_coach_id()
    )
    OR parent_owns_student(student_id)
  );

DROP POLICY IF EXISTS makeup_bookings_select ON makeup_bookings;
CREATE POLICY makeup_bookings_select ON makeup_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = makeup_bookings.class_id AND c.coach_id = current_coach_id()
    )
    OR parent_owns_student(student_id)
  );

-- ── session_pay_amount(uuid), back to its 20260719000800 body ──────────────

CREATE OR REPLACE FUNCTION public.session_pay_amount(p_session_id UUID)
RETURNS TABLE (amount NUMERIC, basis TEXT, minutes SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date     DATE;
  v_class    UUID;
  v_coach    UUID;
  v_mins     SMALLINT;
  v_flat     NUMERIC;
  v_amt      NUMERIC;
  v_unit     SMALLINT;
BEGIN
  SELECT ls.session_date, ls.class_id,
         EXTRACT(EPOCH FROM (c.end_time - c.start_time)) / 60
    INTO v_date, v_class, v_mins
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = p_session_id;

  IF v_date IS NULL THEN
    RETURN;
  END IF;

  SELECT r.paid_coach_id INTO v_coach FROM class_rate_on(v_class, v_date) r;

  IF v_coach IS NULL THEN
    RAISE EXCEPTION
      'no class terms in force for class % on % — refusing to price this lesson',
      v_class, v_date;
  END IF;

  SELECT o.flat_amount INTO v_flat
    FROM class_rate_overrides o
   WHERE o.class_id = v_class AND o.effective_from <= v_date
   ORDER BY o.effective_from DESC
   LIMIT 1;

  IF v_flat IS NOT NULL THEN
    RETURN QUERY SELECT v_flat, 'flat'::TEXT, v_mins;
    RETURN;
  END IF;

  SELECT r.amount, r.unit_minutes INTO v_amt, v_unit
    FROM coach_rates r
   WHERE r.coach_id = v_coach AND r.effective_from <= v_date
   ORDER BY r.effective_from DESC
   LIMIT 1;

  IF v_amt IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT ROUND(v_amt * (v_mins::NUMERIC / v_unit), 2), 'duration'::TEXT, v_mins;
END;
$$;

-- ── generate_coach_payouts, back to its 20260719000900 body ────────────────

CREATE OR REPLACE FUNCTION public.generate_coach_payouts(
  p_tenant_id    UUID,
  p_period_month TEXT
)
RETURNS TABLE (coach_id UUID, coach_name TEXT, gross NUMERIC, status TEXT, items INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_coach RECORD;
  v_pay   RECORD;
  v_sess  RECORD;
  v_payout UUID;
  v_gross NUMERIC;
  v_items INT;
  v_status payout_status;
BEGIN
  IF NOT can_admin_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'not permitted to run payroll for this business';
  END IF;

  IF p_period_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'period must be YYYY-MM';
  END IF;

  v_start := (p_period_month || '-01')::DATE;
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  IF EXISTS (
    SELECT 1
      FROM lesson_sessions ls
      JOIN classes c ON c.id = ls.class_id
     WHERE c.tenant_id = p_tenant_id
       AND ls.session_date BETWEEN v_start AND v_end
       AND NOT EXISTS (
         SELECT 1 FROM class_rates r
          WHERE r.class_id = ls.class_id AND r.effective_from <= ls.session_date
       )
  ) THEN
    RAISE EXCEPTION
      'a lesson in % has no class terms in force — refusing to run payroll '
      'rather than silently underpay', p_period_month;
  END IF;

  FOR v_coach IN
    SELECT c.id, p.full_name
      FROM coaches c JOIN profiles p ON p.id = c.profile_id
     WHERE c.tenant_id = p_tenant_id
       AND EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)
     ORDER BY p.full_name
  LOOP
    SELECT cp.id, cp.status INTO v_payout, v_status
      FROM coach_payouts cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.coach_id = v_coach.id
       AND cp.period_month = p_period_month;

    IF v_status = 'paid' THEN
      SELECT cp.gross_amount INTO v_gross FROM coach_payouts cp WHERE cp.id = v_payout;
      SELECT COUNT(*) INTO v_items FROM coach_payout_items WHERE payout_id = v_payout;
      RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'paid'::TEXT, v_items;
      CONTINUE;
    END IF;

    IF v_payout IS NULL THEN
      INSERT INTO coach_payouts (tenant_id, coach_id, period_month)
      VALUES (p_tenant_id, v_coach.id, p_period_month)
      RETURNING id INTO v_payout;
    ELSE
      DELETE FROM coach_payout_items WHERE payout_id = v_payout;
    END IF;

    v_gross := 0;
    v_items := 0;

    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
        CROSS JOIN LATERAL class_rate_on(ls.class_id, ls.session_date) r
       WHERE r.paid_coach_id = v_coach.id
         AND c.tenant_id = p_tenant_id
         AND ls.session_date BETWEEN v_start AND v_end
       ORDER BY ls.session_date
    LOOP
      CONTINUE WHEN NOT session_pays_coach(v_sess.id);

      SELECT * INTO v_pay FROM session_pay_amount(v_sess.id);
      CONTINUE WHEN v_pay.amount IS NULL;

      INSERT INTO coach_payout_items
        (payout_id, lesson_session_id, class_title, session_date, basis, minutes, amount)
      VALUES
        (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
         v_pay.basis, v_pay.minutes, v_pay.amount);

      v_gross := v_gross + v_pay.amount;
      v_items := v_items + 1;
    END LOOP;

    FOR v_sess IN
      SELECT i.lesson_session_id AS id, i.session_date, i.class_title AS title,
             i.amount AS paid_amount, prev.period_month AS orig
        FROM coach_payout_items i
        JOIN coach_payouts prev ON prev.id = i.payout_id
       WHERE prev.tenant_id = p_tenant_id
         AND prev.coach_id = v_coach.id
         AND prev.status = 'paid'
         AND prev.period_month < p_period_month
         AND NOT i.is_adjustment
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now FROM session_pay_amount(v_sess.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        SELECT COALESCE(SUM(i2.amount), 0) INTO v_carried
          FROM coach_payout_items i2
          JOIN coach_payouts p2 ON p2.id = i2.payout_id
         WHERE p2.tenant_id = p_tenant_id
           AND p2.coach_id = v_coach.id
           AND i2.lesson_session_id = v_sess.id
           AND i2.is_adjustment
           AND p2.id <> v_payout;

        v_diff := v_now - v_sess.paid_amount - v_carried;

        IF v_diff <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis,
             amount, is_adjustment, original_period)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             'adjustment', v_diff, TRUE, v_sess.orig)
          ON CONFLICT DO NOTHING;
          v_gross := v_gross + v_diff;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    UPDATE coach_payouts
       SET gross_amount = v_gross, generated_at = NOW()
     WHERE id = v_payout;

    RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'draft'::TEXT, v_items;
  END LOOP;
END;
$$;

-- ── drop the wave's own objects ────────────────────────────────────────────
-- session_pay_amount(uuid,uuid) must go BEFORE the table: it references
-- coach_attributed_to_session, which references session_coaches.

DROP FUNCTION IF EXISTS public.assign_session_coach(UUID, DATE, UUID, session_coach_role);
DROP FUNCTION IF EXISTS public.set_session_main_coach(UUID, UUID);
DROP FUNCTION IF EXISTS public.session_pay_amount(UUID, UUID);
DROP FUNCTION IF EXISTS public.session_carried_for_coach(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.coach_attributed_to_session(UUID, UUID);
DROP FUNCTION IF EXISTS public.coach_rostered_with_student(UUID);
DROP FUNCTION IF EXISTS public.coach_rostered_in_class(UUID);
DROP FUNCTION IF EXISTS public.coach_is_main_on_session(UUID);
DROP FUNCTION IF EXISTS public.coach_teaches_session(UUID);

DROP TRIGGER IF EXISTS trg_session_coach_stamp_tenant ON session_coaches;
DROP FUNCTION IF EXISTS public.session_coach_stamp_tenant();
DROP TABLE IF EXISTS session_coaches;
DROP TYPE IF EXISTS session_coach_role;
