-- ============================================================================
-- ROLLBACK for 20260812000200_class_shadow_coaches.sql
--
-- Committed BEFORE the deploy, deliberately: a scratchpad backup nobody can
-- find is not a rollback plan (the pattern 20260804 established).
--
-- ⚠ EVERY FUNCTION BODY BELOW WAS TAKEN FROM pg_get_functiondef() ON THE LIVE
-- DATABASE **BEFORE** THE MIGRATION WAS APPLIED — not retyped from
-- 20260811000200, and not from 20260812000100 (§7.115: CREATE OR REPLACE means
-- the newest definition can be in any later file, and grep finds the oldest
-- first; that cost a wrong risk rating on 2026-08-10). They are therefore
-- byte-identical to what was running, which is the property §7.93 asks for and
-- the only one that makes a rehearsal meaningful.
--
-- ORDER MATTERS AND IT IS THE MIRROR OF THE UP:
--   1. restore session_coaches.role FIRST — five function bodies below read it,
--      and restoring them against a table without the column would leave
--      functions that throw at runtime on a POLICY EXPRESSION (an outage).
--   2. restore the bodies.
--   3. drop what this wave added.
--
-- ⚠ THIS IS A SCHEMA ROLLBACK, NOT A DATA ONE. Any class_shadow_coaches or
-- session_coach_absences rows are DESTROYED, and any coach_rates row with
-- role = 'shadow' is deleted (the column cannot survive the type). On the day
-- this ships production holds none of the three, which is what makes running it
-- safe; that stops being true the first time a business assigns a shadow.
-- ============================================================================


-- ── 1. session_coaches gets its role column back ───────────────────────────
ALTER TABLE session_coaches DROP CONSTRAINT one_substitute_per_session;

ALTER TABLE session_coaches
  ADD COLUMN role session_coach_role NOT NULL DEFAULT 'main';
ALTER TABLE session_coaches ALTER COLUMN role DROP DEFAULT;

CREATE UNIQUE INDEX one_main_coach_per_session
  ON session_coaches (lesson_session_id) WHERE role = 'main';


-- ── 2. the function bodies, exactly as they were ───────────────────────────
CREATE OR REPLACE FUNCTION public.assign_session_coach(p_class_id uuid, p_session_date date, p_coach_id uuid, p_role session_coach_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Untouched. Promoting an existing shadow to main is legitimate, and
    -- set_session_main_coach() deletes the old main before upserting.
    PERFORM set_session_main_coach(v_session, p_coach_id);
  ELSE
    -- ── The ABSENCE-RULE main ────────────────────────────────────────────
    -- There is no row to conflict with, so this half cannot be atomic. The
    -- race is bounded and benign: the only way to lose it is for somebody to
    -- install a real main in the same instant, after which a shadow row for
    -- the class's coach is legitimate. The row-main half below is the one that
    -- had to be race-free.
    --
    -- ⚠ NOT coach_is_main_on_session(). That answers about current_coach_id(),
    -- and the caller here is the ADMIN, not the coach being assigned — it
    -- would return FALSE for every admin and the guard would never fire. A
    -- check that cannot see what it is checking is §7.125's shape exactly.
    IF NOT EXISTS (
          SELECT 1 FROM session_coaches sc
           WHERE sc.lesson_session_id = v_session AND sc.role = 'main')
       AND EXISTS (
          SELECT 1 FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
           WHERE ls.id = v_session AND c.coach_id = p_coach_id)
    THEN
      RAISE EXCEPTION 'that coach already teaches this lesson as the class''s coach — '
                      'adding them as a shadow would say two different things about one person';
    END IF;

    -- ── The ROW main ─────────────────────────────────────────────────────
    -- ⚠ THE GUARD IS THE STATEMENT'S OWN `WHERE`, NOT A PRE-CHECK BEFORE IT.
    -- An `IF EXISTS (… role = 'main') THEN RAISE` is TOCTOU by construction and
    -- the race is the exact bug being fixed: admin A promotes X to main while
    -- admin B adds X as a shadow; B's EXISTS cannot see A's uncommitted row, so
    -- it passes, B's INSERT then blocks on the unique index, A commits, and the
    -- DO UPDATE demotes the main B was just told did not exist. ON CONFLICT
    -- waits on the conflicting row's LOCK, so this WHERE is evaluated against
    -- the committed row.
    --
    -- ⚠ NOTHING MAY BE INSERTED BETWEEN THIS STATEMENT AND ITS `IF NOT FOUND`.
    -- FOUND is clobbered by the next SELECT / PERFORM / assignment-with-query,
    -- and a clobbered FOUND is a guard that still looks like a guard.
    --
    -- Re-adding an EXISTING shadow sets role to the value it already holds, so
    -- FOUND is true and nothing raises — idempotence survives.
    INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
    VALUES ('00000000-0000-0000-0000-000000000000', v_session, p_coach_id, 'shadow', auth.uid())
    ON CONFLICT (lesson_session_id, coach_id) DO UPDATE
      SET role = 'shadow'
      WHERE session_coaches.role <> 'main';

    IF NOT FOUND THEN
      -- Without this the excluded row simply would not update and the RPC would
      -- return success having done nothing — ON CONFLICT DO NOTHING wearing a
      -- different hat, which set_session_main_coach()'s own comment refuses.
      --
      -- This message reaches the admin verbatim: lesson-coaches/page.tsx renders
      -- `Could not assign: ${error.message}`.
      RAISE EXCEPTION 'that coach is already the main coach for this lesson — '
                      'change the main coach first, or the lesson would be left with none';
    END IF;
  END IF;

  RETURN v_session;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.coach_attributed_to_session(p_session_id uuid, p_coach_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.coach_is_main_on_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT sc.coach_id = current_coach_id()
       FROM session_coaches sc
      WHERE sc.lesson_session_id = p_session_id AND sc.role = 'main'),
    (SELECT c.coach_id = current_coach_id()
       FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
      WHERE ls.id = p_session_id),
    FALSE
  );
$function$

;

CREATE OR REPLACE FUNCTION public.coach_rostered_in_class(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
     WHERE ls.class_id = p_class_id
       AND sc.coach_id = current_coach_id()
  );
$function$

;

CREATE OR REPLACE FUNCTION public.coach_rostered_with_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.coach_teaches_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.session_pay_amount(p_session_id uuid)
 RETURNS TABLE(amount numeric, basis text, minutes smallint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.session_pay_amount(p_session_id uuid, p_coach_id uuid)
 RETURNS TABLE(amount numeric, basis text, minutes smallint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.set_class_terms(p_class_id uuid, p_title text, p_day_of_week day_of_week, p_start_time time without time zone, p_end_time time without time zone, p_location_name text, p_price_per_lesson numeric, p_coach_id uuid, p_effective_from date DEFAULT NULL::date, p_correct_in_place boolean DEFAULT false, p_location_address text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_from     DATE := COALESCE(p_effective_from, today_sg());
  v_cur      RECORD;
  v_old      JSONB;
  v_month    TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to edit this class';
  END IF;

  IF p_price_per_lesson IS NULL OR p_price_per_lesson < 0 THEN
    -- Checked BEFORE any coercion. A blank field reaching Number() is how a
    -- $0 wage rate shipped, and how an unset run day became day 1.
    RAISE EXCEPTION 'price per lesson must be zero or more';
  END IF;

  -- The coach must belong to THIS business. The engine bypasses RLS and this
  -- function is SECURITY DEFINER, so neither would catch a cross-tenant id.
  IF NOT EXISTS (
    SELECT 1 FROM coaches c WHERE c.id = p_coach_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that coach does not belong to this business';
  END IF;

  -- No future-dating. The display sync (classes.price_per_lesson) tracks the
  -- rate in force TODAY and nothing re-runs it when a future date merely
  -- arrives, so a future row would show the wrong price until something
  -- happened to touch the class. Relax this and the sync together, not alone.
  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'terms cannot start in the future (got %)', v_from;
  END IF;

  -- ── Non-dated attributes ────────────────────────────────────────────────
  -- classes.coach_id follows the CURRENT teacher: it drives access (RLS) and
  -- display. Historical pay attribution lives in class_rates and is untouched
  -- by this write — that separation is the point of 20260719000800.
  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET title            = p_title,
         day_of_week      = p_day_of_week,
         start_time       = p_start_time,
         end_time         = p_end_time,
         location_name    = p_location_name,
         location_address = p_location_address,
         coach_id         = p_coach_id,
         updated_at       = NOW()
   WHERE id = p_class_id;

  -- ── Money: only if it actually moved ────────────────────────────────────
  SELECT r.price_per_lesson, r.paid_coach_id
    INTO v_cur
    FROM class_rate_on(p_class_id, v_from) r;

  IF v_cur.price_per_lesson IS NOT DISTINCT FROM p_price_per_lesson
     AND v_cur.paid_coach_id IS NOT DISTINCT FROM p_coach_id THEN
    RETURN;   -- a rename or a time change: nothing dated to record
  END IF;

  -- Settled money must not move under either intent. A correction rewrites
  -- history outright; a change from date D reprices every lesson on or after
  -- it. Both are refused once that period has been invoiced or paid out.
  v_month := to_char(v_from, 'YYYY-MM');

  IF EXISTS (
    SELECT 1 FROM billing_periods bp
     WHERE bp.tenant_id = v_tenant AND bp.billing_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — % or a later month has already been '
      'invoiced and sealed. Issue a credit note instead.', v_from, v_month;
  END IF;

  IF EXISTS (
    SELECT 1 FROM coach_payouts cp
     WHERE cp.tenant_id = v_tenant AND cp.status = 'paid'
       AND cp.period_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — a coach payout for % or later has already '
      'been paid. The correction will surface as an adjustment instead.',
      v_from, v_month;
  END IF;

  IF p_correct_in_place THEN
    -- Rewrite the row currently in force. There was never a period at the old
    -- number, so no new row is created and history reads as if the typo never
    -- happened.
    UPDATE class_rates r
       SET price_per_lesson = p_price_per_lesson,
           paid_coach_id    = p_coach_id
     WHERE r.class_id = p_class_id
       AND r.effective_from = (
         SELECT MAX(r2.effective_from) FROM class_rates r2
          WHERE r2.class_id = p_class_id AND r2.effective_from <= v_from
       );
  ELSE
    INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
    VALUES (p_class_id, p_price_per_lesson, p_coach_id, v_from)
    ON CONFLICT (class_id, effective_from)
    DO UPDATE SET price_per_lesson = EXCLUDED.price_per_lesson,
                  paid_coach_id    = EXCLUDED.paid_coach_id;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (
    v_actor,
    CASE WHEN p_correct_in_place THEN 'class_terms_corrected'
         ELSE 'class_terms_changed' END,
    'Class',
    p_class_id,
    v_old,
    jsonb_build_object(
      'effective_from',   v_from,
      'price_per_lesson', p_price_per_lesson,
      'paid_coach_id',    p_coach_id,
      'class',            (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id)
    ),
    v_tenant
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.set_session_main_coach(p_session_id uuid, p_coach_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;


CREATE OR REPLACE FUNCTION public.generate_coach_payouts(p_tenant_id uuid, p_period_month text)
 RETURNS TABLE(coach_id uuid, coach_name text, gross numeric, status text, items integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;


-- ── 3. drop everything this wave added ─────────────────────────────────────
-- Triggers go with their tables; the helper functions are dropped explicitly
-- because nothing else depends on them once the bodies above are restored.
DROP TABLE IF EXISTS session_coach_absences;
DROP TABLE IF EXISTS class_shadow_coaches;

-- ⚠ THE FUNCTIONS GO BEFORE THE TABLES ONLY IN INTENT — Postgres records no
-- dependency from a classic string-body function to the tables it reads, so
-- DROP TABLE above succeeds in silence and leaves any survivor GRANTed and
-- throwing `relation does not exist` on every call. Every function this wave
-- created must appear in this list; session_shadow_coaches was missed once.
DROP FUNCTION IF EXISTS public.session_shadow_coaches(UUID, DATE);
DROP FUNCTION IF EXISTS public.class_shadow_guard();
DROP FUNCTION IF EXISTS public.session_absence_seal_guard();
DROP FUNCTION IF EXISTS public.session_absence_stamp_tenant();
DROP FUNCTION IF EXISTS public.class_shadow_stamp_tenant();
DROP FUNCTION IF EXISTS public.assert_payout_month_open(UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS public.assign_class_shadow(UUID, UUID, DATE);
DROP FUNCTION IF EXISTS public.end_class_shadow(UUID, UUID, DATE);
DROP FUNCTION IF EXISTS public.coach_is_active_class_shadow(UUID);
DROP FUNCTION IF EXISTS public.coach_shadowed_class_on(UUID, DATE, UUID);
DROP FUNCTION IF EXISTS public.coach_attribution_kind(UUID, UUID);

-- The 3-arg form is this wave's; the 4-arg shim is what the restored body above
-- put back, so it stays.
DROP FUNCTION IF EXISTS public.assign_session_coach(UUID, DATE, UUID);

-- coach_rates loses its role dimension. The rate lookup must go BEFORE the
-- type, and the shadow rows before the column.
DROP FUNCTION IF EXISTS public.coach_rate_on(UUID, DATE, coach_rate_role);
DELETE FROM coach_rates WHERE role = 'shadow';
ALTER TABLE coach_rates DROP CONSTRAINT coach_rates_coach_id_role_effective_from_key;
DROP INDEX IF EXISTS coach_rates_coach_id_role_effective_from_idx;
ALTER TABLE coach_rates DROP COLUMN role;
ALTER TABLE coach_rates
  ADD CONSTRAINT coach_rates_coach_id_effective_from_key UNIQUE (coach_id, effective_from);
CREATE INDEX IF NOT EXISTS coach_rates_coach_id_effective_from_idx
  ON coach_rates (coach_id, effective_from DESC);
DROP TYPE IF EXISTS coach_rate_role;
