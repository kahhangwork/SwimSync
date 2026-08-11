-- ============================================================================
-- WAVE 3 — THE LESSON-LEVEL COACH ROSTER
--
-- Plan: docs/plans/WAVE_3_PLAN.md (settled 2026-08-11, risk-reviewed before
-- a line of this file existed).
--
-- Record that Coach B taught ONE lesson of Coach A's class without moving the
-- class, and let trainees SHADOW a lesson and be paid at their own rate.
-- A permanent handover already works through set_class_terms(); what had no
-- representation at all was the one-off cover.
--
-- THE ABSENCE RULE IS THE WHOLE SAFETY ARGUMENT OF THIS MIGRATION:
--
--     NO ROSTER ROW MEANS THE CLASS'S COACH IS THE MAIN COACH.
--
-- There is no backfill. session_coaches is EMPTY on the day this ships, so
-- every existing lesson keeps its exact current behaviour, and the one policy
-- NARROWING below (attendance_write) cannot bite anybody until an admin
-- actually assigns somebody. If this file is ever amended to seed roster rows,
-- that safety argument dies with it.
--
-- TWO AXES, DELIBERATELY NOT THE SAME FUNCTION (§8.43's lesson, one wave on):
--   ACCESS follows the roster + classes.coach_id  — the gates in section 2.
--   MONEY  follows class_rate_on().paid_coach_id  — never classes.coach_id.
-- 20260719000800 exists because those two were once the same query, and
-- handing a class over re-priced its entire unpaid history. classes.coach_id
-- appears NOWHERE in section 6.
-- ============================================================================


-- ============================================================================
-- 1. THE ROSTER
-- ============================================================================

CREATE TYPE session_coach_role AS ENUM ('main', 'shadow');

CREATE TABLE session_coaches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_session_id UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  coach_id          UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  role              session_coach_role NOT NULL,
  assigned_by       UUID REFERENCES profiles(id),
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_session_id, coach_id)
);

-- At most one MAIN per session. A partial unique index, which is why the admin
-- surface must go through set_session_main_coach() — PostgREST's .upsert()
-- cannot target a partial index, so a direct INSERT surfaces a raw 23505.
CREATE UNIQUE INDEX one_main_coach_per_session
  ON session_coaches (lesson_session_id) WHERE role = 'main';

CREATE INDEX ON session_coaches (coach_id);
CREATE INDEX ON session_coaches (tenant_id);

-- tenant_id is STAMPED, not derived through two joins in every policy.
-- Fires for UPDATE as well as INSERT: a BEFORE INSERT trigger also runs for
-- rows that resolve to an UPDATE via .upsert() (§7.57), and the tenant must
-- not survive a re-pointed lesson_session_id.
CREATE OR REPLACE FUNCTION public.session_coach_stamp_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class_tenant UUID;
  v_coach_tenant UUID;
BEGIN
  SELECT c.tenant_id INTO v_class_tenant
    FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = NEW.lesson_session_id;

  IF v_class_tenant IS NULL THEN
    RAISE EXCEPTION 'lesson session % does not exist', NEW.lesson_session_id;
  END IF;

  SELECT co.tenant_id INTO v_coach_tenant FROM coaches co WHERE co.id = NEW.coach_id;

  -- A coach of another business must never appear on this roster. Checked here
  -- rather than in a policy because RLS can hide the counterparty row and a
  -- check that cannot see a row silently passes (§7.125).
  IF v_coach_tenant IS DISTINCT FROM v_class_tenant THEN
    RAISE EXCEPTION
      'coach % belongs to a different business than this lesson', NEW.coach_id;
  END IF;

  NEW.tenant_id := v_class_tenant;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_coach_stamp_tenant
  BEFORE INSERT OR UPDATE ON session_coaches
  FOR EACH ROW EXECUTE FUNCTION public.session_coach_stamp_tenant();


-- ============================================================================
-- 2. THE TWO ACCESS GATES
--
-- SECURITY DEFINER is not style here, it is §7.125: RLS on session_coaches can
-- hide the very row that would have satisfied the check, and a check that
-- cannot see a row SILENTLY PASSES — the exact failure a gate exists to stop.
-- SET search_path is not optional on a SECURITY DEFINER function.
--
-- Neither gate is coach_owns_class() / coach_owns_session() /
-- coach_serves_student(). Those three keep their current meaning at all 43 of
-- their call sites, which is what stops a one-hour substitute inheriting
-- close_student_enrolment() and set_students_active().
-- ============================================================================

-- READ gate: the roster's main OR any shadow; falls back to the class's coach
-- when the session has no roster main at all (the absence rule).
CREATE OR REPLACE FUNCTION public.coach_teaches_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM session_coaches sc
     WHERE sc.lesson_session_id = p_session_id
       AND sc.coach_id = current_coach_id()
  ) OR (
    NOT EXISTS (
      SELECT 1 FROM session_coaches sc2
       WHERE sc2.lesson_session_id = p_session_id AND sc2.role = 'main'
    )
    AND EXISTS (
      SELECT 1 FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_session_id AND c.coach_id = current_coach_id()
    )
  );
$$;

-- WRITE gate: the roster's main if one exists, else the class's coach.
-- NOT "main or shadow" — a trainee sees the lesson and does not mark it, so
-- the main coach stays unambiguous for marking exactly as they do for pay.
CREATE OR REPLACE FUNCTION public.coach_is_main_on_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT sc.coach_id = current_coach_id()
       FROM session_coaches sc
      WHERE sc.lesson_session_id = p_session_id AND sc.role = 'main'),
    (SELECT c.coach_id = current_coach_id()
       FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
      WHERE ls.id = p_session_id),
    FALSE
  );
$$;

-- Students the current coach can reach BECAUSE OF A ROSTER ROW.
--
-- A SEPARATE function, referenced ONLY from students_select. The roster branch
-- deliberately does NOT go inside coach_serves_student(), which authorizes
-- set_students_active() (20260719001200) — the coach app really does call it
-- (SwimSyncApp/lib/studentStatus.ts), so a coach covering one hour would
-- otherwise be able to deactivate a child across the whole business.
--
-- Mirrors coach_serves_student()'s three branches so a substitute sees exactly
-- what the class's own coach sees: enrolled children, trial guests, make-up
-- guests. Missing the guest branches is a BILLING DEADLOCK, not a cosmetic
-- gap: the engine expects the guest, the block has no override (§8i), and no
-- screen anywhere says why the month will not close.
CREATE OR REPLACE FUNCTION public.coach_rostered_with_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
      JOIN student_class_enrolments e ON e.class_id = ls.class_id
     WHERE sc.coach_id = current_coach_id()
       AND e.student_id = p_student_id
       AND e.is_active
  ) OR EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
      JOIN trial_bookings tb ON tb.class_id = ls.class_id
     WHERE sc.coach_id = current_coach_id()
       AND tb.student_id = p_student_id
  ) OR EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
      JOIN makeup_bookings mb ON mb.class_id = ls.class_id
     WHERE sc.coach_id = current_coach_id()
       AND mb.student_id = p_student_id
  );
$$;

-- Does this session have a roster row naming this coach at all? Used by the
-- class/enrolment/booking policies, which are class-scoped rather than
-- session-scoped (see the plan's accepted scope note).
CREATE OR REPLACE FUNCTION public.coach_rostered_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
     WHERE ls.class_id = p_class_id
       AND sc.coach_id = current_coach_id()
  );
$$;


-- ============================================================================
-- 3. RLS — the roster's own policies, then the EIGHT that must widen
--
-- A substitute given only sessions_select + attendance_* cannot run the
-- lesson: no class row means no title and no week card, no enrolment rows mean
-- nobody to mark, and an invisible guest means a month that will not close.
-- All of it ships here, in Step 1, because Phase B runs in worktrees and a
-- worktree may not author a migration (§7.55).
-- ============================================================================

ALTER TABLE session_coaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_coaches_select ON session_coaches FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR coach_id = current_coach_id()
  );

CREATE POLICY session_coaches_write ON session_coaches FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

-- A policy without the matching GRANT throws permission denied in dev (§7.87);
-- table_grants.test.sql goes red on any privilege no policy permits.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_coaches TO authenticated;

-- ---------------------------------------------------------------- 3.1 sessions
DROP POLICY sessions_select ON lesson_sessions;
CREATE POLICY sessions_select ON lesson_sessions FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR coach_owns_class(class_id)
    OR coach_teaches_session(id)
    OR is_tenant_admin(class_tenant(class_id))
    OR parent_has_child_in_class(class_id)
  );

-- sessions_write is DELIBERATELY NOT WIDENED. assign_session_coach() creates
-- the lesson_sessions row as the ADMIN, so by the time a substitute opens the
-- screen the row already exists and they never need INSERT here. A substitute
-- able to create lesson rows could manufacture a lesson on a date the class
-- never ran, and that lesson is billable.

-- -------------------------------------------------------------- 3.2 attendance
DROP POLICY attendance_select ON attendance;
CREATE POLICY attendance_select ON attendance FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_session(lesson_session_id)
    OR coach_teaches_session(lesson_session_id)
    OR is_tenant_admin(session_tenant(lesson_session_id))
  );

-- THE ONE NARROWING IN THE WAVE. When B covers, A loses write on that lesson —
-- intended, and the point of "pay follows whoever actually taught". Safe to
-- ship only because session_coaches is empty (see the absence rule at the top).
DROP POLICY attendance_write ON attendance;
CREATE POLICY attendance_write ON attendance FOR ALL TO authenticated
  USING (
    coach_is_main_on_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  )
  WITH CHECK (
    coach_is_main_on_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  );

-- ---------------------------------------------------------------- 3.3 classes
DROP POLICY classes_select ON classes;
CREATE POLICY classes_select ON classes FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_id = current_coach_id()
    OR coach_rostered_in_class(id)
    OR parent_has_child_in_class(id)
  );

-- ------------------------------------------------------------- 3.4 enrolments
DROP POLICY enrolments_select ON student_class_enrolments;
CREATE POLICY enrolments_select ON student_class_enrolments FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_class(class_id)
    OR coach_rostered_in_class(class_id)
    OR is_tenant_admin(class_tenant(class_id))
  );

-- --------------------------------------------------------------- 3.5 students
DROP POLICY students_select ON students;
CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR created_by = auth.uid()
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
    OR coach_serves_student(id)
    OR coach_rostered_with_student(id)
  );

-- --------------------------------------------------------------- 3.6 bookings
-- Both guest types, and they are NOT deferrable to Phase B: a guest a
-- substitute cannot see is a guest they cannot mark, and the billing month
-- then blocks with no override and nothing on screen explaining it.
DROP POLICY trial_bookings_select ON trial_bookings;
CREATE POLICY trial_bookings_select ON trial_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = trial_bookings.class_id AND c.coach_id = current_coach_id()
    )
    OR coach_rostered_in_class(class_id)
    OR parent_owns_student(student_id)
  );

DROP POLICY makeup_bookings_select ON makeup_bookings;
CREATE POLICY makeup_bookings_select ON makeup_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = makeup_bookings.class_id AND c.coach_id = current_coach_id()
    )
    OR coach_rostered_in_class(class_id)
    OR parent_owns_student(student_id)
  );


-- ============================================================================
-- 4. ASSIGNMENT RPCs — the admin never handles a lesson_session_id
--
-- lesson_sessions rows are created LAZILY, by the coach, when attendance is
-- first saved (core.ts:603, PRD §7.5). A FUTURE lesson therefore has no id at
-- all — and "assign Coach B to cover next Tuesday" is the entire point of this
-- wave. So the assignment resolves-or-creates the row, as the admin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID,
  p_role         session_coach_role
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session UUID;
BEGIN
  IF NOT can_admin_tenant(class_tenant(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NULL THEN
    -- Refuse a date the class does not run on. A roster row against a
    -- fabricated date is a lesson that will be marked, paid and BILLED on a
    -- day the class never met. An existing row is honoured either way, because
    -- a rescheduled or extra lesson is legitimately off-pattern.
    PERFORM assert_class_runs_on(p_class_id, p_session_date);

    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT (class_id, session_date) DO NOTHING;

    SELECT ls.id INTO v_session
      FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;
  END IF;

  IF p_role = 'main' THEN
    PERFORM set_session_main_coach(v_session, p_coach_id);
  ELSE
    INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
    VALUES ('00000000-0000-0000-0000-000000000000', v_session, p_coach_id, 'shadow', auth.uid())
    ON CONFLICT (lesson_session_id, coach_id) DO UPDATE SET role = 'shadow';
  END IF;

  RETURN v_session;
END;
$$;

-- The main slot is a PARTIAL unique index, which .upsert() cannot target — so
-- "that cover was wrong, it was Coach C" must go through here, not an INSERT.
-- Never ON CONFLICT DO NOTHING on the main row: silently keeping the OLD main
-- is a wrong-coach-gets-paid bug, which is the failure this table removes.
CREATE OR REPLACE FUNCTION public.set_session_main_coach(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_admin_tenant(session_tenant(p_session_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  DELETE FROM session_coaches
   WHERE lesson_session_id = p_session_id AND role = 'main';

  INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
  VALUES ('00000000-0000-0000-0000-000000000000', p_session_id, p_coach_id, 'main', auth.uid())
  ON CONFLICT (lesson_session_id, coach_id) DO UPDATE SET role = 'main';
END;
$$;


-- ============================================================================
-- 5. PAY — per (session, coach)
--
-- The two-argument form takes NO DEFAULT on p_coach_id. A defaulted parameter
-- creates a second pg_proc row and PostgREST goes on resolving the old one by
-- name (§7.124, measured in Wave 2). \df session_pay_amount must show exactly
-- two rows, one per arity.
-- ============================================================================

-- IS THIS COACH OWED ANYTHING FOR THIS LESSON AT ALL?
--
-- The roster names them (main or shadow), OR there is no roster main and the
-- class's terms paid them on that date. One predicate, used by BOTH the payout
-- builder's selection query and session_pay_amount below — they must never be
-- able to disagree, because the pair of them is what makes a clawback work.
--
-- WITHOUT THIS THE WAVE DOUBLE-PAYS, and it is not a theoretical: the first
-- draft let session_pay_amount answer "what would this coach's rate produce"
-- instead of "what is this coach owed", so the adjustment loop asked what the
-- REPLACED coach was owed for a lesson they no longer taught, got their full
-- rate back, computed a difference of zero, and never clawed anything back.
-- Measured before any pgTAP existed: Coach A 30.00 + Coach B 50.00 on one
-- 50.00 lesson.
CREATE OR REPLACE FUNCTION public.coach_attributed_to_session(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_coach_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM session_coaches sc
       WHERE sc.lesson_session_id = p_session_id AND sc.coach_id = p_coach_id
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM session_coaches sc2
         WHERE sc2.lesson_session_id = p_session_id AND sc2.role = 'main'
      )
      AND EXISTS (
        SELECT 1
          FROM lesson_sessions ls
          CROSS JOIN LATERAL class_rate_on(ls.class_id, ls.session_date) r
         WHERE ls.id = p_session_id AND r.paid_coach_id = p_coach_id
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.session_pay_amount(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS TABLE (amount NUMERIC, basis TEXT, minutes SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date   DATE;
  v_class  UUID;
  v_mins   SMALLINT;
  v_flat   NUMERIC;
  v_amt    NUMERIC;
  v_unit   SMALLINT;
  v_terms  UUID;
BEGIN
  SELECT ls.session_date, ls.class_id,
         EXTRACT(EPOCH FROM (c.end_time - c.start_time)) / 60
    INTO v_date, v_class, v_mins
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = p_session_id;

  IF v_date IS NULL OR p_coach_id IS NULL THEN
    RETURN;
  END IF;

  -- A coach this lesson is not attributed to is owed NOTHING for it. This is
  -- what makes "the substituted coach is paid nothing" survive a correction:
  -- the adjustment loop asks what they are owed NOW, gets nothing, and the
  -- difference against what they were paid is a clawback.
  IF NOT coach_attributed_to_session(p_session_id, p_coach_id) THEN
    RETURN;
  END IF;

  SELECT r.paid_coach_id INTO v_terms FROM class_rate_on(v_class, v_date) r;

  IF v_terms IS NULL THEN
    RAISE EXCEPTION
      'no class terms in force for class % on % — refusing to price this lesson',
      v_class, v_date;
  END IF;

  -- A class FLAT amount is a property of the class's own coach teaching it.
  -- A substitute always falls through to their own rate, which is what
  -- "a substitute is paid their own rate" says in plain words. Written as the
  -- condition rather than a note, so a flat-rate class inherits it without
  -- anyone having to remember. (No flat-rate class exists yet — this is the
  -- rule the first one will meet.)
  IF p_coach_id = v_terms THEN
    SELECT o.flat_amount INTO v_flat
      FROM class_rate_overrides o
     WHERE o.class_id = v_class AND o.effective_from <= v_date
     ORDER BY o.effective_from DESC
     LIMIT 1;

    IF v_flat IS NOT NULL THEN
      RETURN QUERY SELECT v_flat, 'flat'::TEXT, v_mins;
      RETURN;
    END IF;
  END IF;

  SELECT r.amount, r.unit_minutes INTO v_amt, v_unit
    FROM coach_rates r
   WHERE r.coach_id = p_coach_id AND r.effective_from <= v_date
   ORDER BY r.effective_from DESC
   LIMIT 1;

  IF v_amt IS NULL THEN
    RETURN;   -- no rate in effect: this coach is not on payroll
  END IF;

  RETURN QUERY SELECT ROUND(v_amt * (v_mins::NUMERIC / v_unit), 2), 'duration'::TEXT, v_mins;
END;
$$;

-- The one-argument form survives ONLY for the deployed client across the
-- §7.123 window — Wave 2 dropped a signature the live apps still called and
-- broke "Remove from class" in production for one Vercel build. It is NOT
-- called from inside the payout builder; every call site there passes a coach.
--
-- Who it delegates to is the PAY axis, so it is the roster main if there is
-- one and class_rate_on().paid_coach_id otherwise. Never classes.coach_id.
CREATE OR REPLACE FUNCTION public.session_pay_amount(p_session_id UUID)
RETURNS TABLE (amount NUMERIC, basis TEXT, minutes SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach UUID;
BEGIN
  SELECT sc.coach_id INTO v_coach
    FROM session_coaches sc
   WHERE sc.lesson_session_id = p_session_id AND sc.role = 'main';

  IF v_coach IS NULL THEN
    SELECT r.paid_coach_id INTO v_coach
      FROM lesson_sessions ls
      CROSS JOIN LATERAL class_rate_on(ls.class_id, ls.session_date) r
     WHERE ls.id = p_session_id;
  END IF;

  RETURN QUERY SELECT * FROM session_pay_amount(p_session_id, v_coach);
END;
$$;

-- Everything already carried for one session on this coach's OTHER payouts,
-- counting NON-adjustment items too.
--
-- Lifted into a helper on purpose: the payout builder has three places that
-- need it, and 20260719000900 exists because the difference was re-emitted
-- every period forever. A copied running total is a fix that lands on one of
-- three call sites.
CREATE OR REPLACE FUNCTION public.session_carried_for_coach(
  p_tenant_id  UUID,
  p_coach_id   UUID,
  p_session_id UUID,
  p_exclude    UUID
)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(i.amount), 0)
    FROM coach_payout_items i
    JOIN coach_payouts p ON p.id = i.payout_id
   WHERE p.tenant_id = p_tenant_id
     AND p.coach_id  = p_coach_id
     AND i.lesson_session_id = p_session_id
     AND p.id IS DISTINCT FROM p_exclude;
$$;


-- ============================================================================
-- 6. THE PAYOUT BUILDER
--
-- classes.coach_id APPEARS NOWHERE BELOW. Attribution for a session with no
-- roster main is class_rate_on(class_id, session_date).paid_coach_id, exactly
-- as 20260719000900 shipped it: access follows the current coach, money
-- follows history. Substituting ownership back in reinstates "handing a class
-- over moves its entire unpaid history".
-- ============================================================================

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

  -- A lesson whose class has no terms in force belongs to NO coach, so it would
  -- vanish from every payout rather than raise. Check the whole period up front
  -- and refuse: a silent underpayment is the failure mode this cluster exists
  -- to remove, and it must not be reintroduced by a quiet skip.
  --
  -- CARRIED THROUGH WAVE 3 UNCHANGED, AND IT CAUGHT THE WAVE'S OWN REGRESSION.
  -- The first draft of this rewrite dropped this block and moved attribution
  -- into the selection query's WHERE, where a NULL paid_coach_id simply fails
  -- to match and the lesson leaves payroll in silence — the exact "quiet skip"
  -- the paragraph above forbids. coach_wages.test.sql 33 went red on it.
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
       -- On payroll only if a rate exists at all. A private coach has none.
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

    -- ---- This period's own sessions -------------------------------------
    -- Two sources, unioned: the roster names this coach (main or shadow), OR
    -- there is no roster main and the class's terms paid them on that date.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = p_tenant_id
         AND ls.session_date BETWEEN v_start AND v_end
         AND coach_attributed_to_session(ls.id, v_coach.id)
       ORDER BY ls.session_date
    LOOP
      CONTINUE WHEN NOT session_pays_coach(v_sess.id);

      SELECT * INTO v_pay FROM session_pay_amount(v_sess.id, v_coach.id);
      CONTINUE WHEN v_pay.amount IS NULL;

      DECLARE
        v_carried NUMERIC;
        v_net     NUMERIC;
      BEGIN
        -- Net out anything already carried for this session on another payout.
        -- Without this, an admin who re-runs a settled period AFTER a later
        -- period already carried the correction pays the same money twice.
        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);
        v_net := v_pay.amount - v_carried;

        IF v_net <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis, minutes, amount)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             v_pay.basis, v_pay.minutes, v_net);

          v_gross := v_gross + v_net;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    -- ---- Adjustments A: sessions already paid, whose pay has since changed
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
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
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

    -- ---- Adjustments B: NEWLY OWED for a settled period -------------------
    --
    -- Adjustments A is driven FROM EXISTING ITEMS, so it can only ever visit a
    -- coach who was already paid something in that period. A substitute named
    -- after the month was settled has no item and no payout at all, so their
    -- money is invisible to it: A's -$40 lands and B's +$55 never does.
    --
    -- Same three-term form as A, with paid_originally = 0, and the SAME
    -- carried-once helper — written as "emit once then suppress" it would
    -- re-emit forever, which is exactly the bug 20260719000900 closed.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title,
             to_char(ls.session_date, 'YYYY-MM') AS orig
        FROM session_coaches sc
        JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
        JOIN classes c ON c.id = ls.class_id
       WHERE sc.coach_id = v_coach.id
         AND c.tenant_id = p_tenant_id
         AND ls.session_date < v_start
         AND EXISTS (
           SELECT 1 FROM coach_payouts settled
            WHERE settled.tenant_id = p_tenant_id
              AND settled.period_month = to_char(ls.session_date, 'YYYY-MM')
              AND settled.status = 'paid'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM coach_payout_items i3
             JOIN coach_payouts p3 ON p3.id = i3.payout_id
            WHERE p3.tenant_id = p_tenant_id
              AND p3.coach_id = v_coach.id
              AND i3.lesson_session_id = ls.id
              AND NOT i3.is_adjustment
         )
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);

        v_diff := v_now - 0 - v_carried;

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


-- ============================================================================
-- 7. GRANTS
--
-- 20260804000700 revoked the default EXECUTE for `authenticated`, and
-- 20260804000400 did the same for anon/PUBLIC — so a function created today
-- reaches NOBODY until this block runs. That is deliberate (§7.87), and it is
-- load-bearing here: a POLICY expression is evaluated as the INVOKING role, so
-- sessions_select gaining coach_teaches_session() without a grant would make
-- every SELECT on lesson_sessions throw permission denied — for parents and
-- admins too, not just coaches. A whole-app read outage from one missing line.
-- ============================================================================

DO $$
DECLARE
  fn TEXT;
  fns TEXT[] := ARRAY[
    'public.coach_teaches_session(uuid)',
    'public.coach_is_main_on_session(uuid)',
    'public.coach_rostered_with_student(uuid)',
    'public.coach_rostered_in_class(uuid)',
    'public.coach_attributed_to_session(uuid,uuid)',
    'public.session_carried_for_coach(uuid,uuid,uuid,uuid)',
    'public.session_pay_amount(uuid,uuid)',
    'public.assign_session_coach(uuid,date,uuid,session_coach_role)',
    'public.set_session_main_coach(uuid,uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

COMMENT ON TABLE session_coaches IS
  'Who actually taught a lesson: one main coach plus N shadows. NO ROW means '
  'the class''s coach is main (the absence rule) — see the header of '
  '20260811000200 and docs/plans/WAVE_3_PLAN.md.';
