-- ============================================================
-- PAYROLL FOLLOWS THE COACH WHO TAUGHT, NOT THE CLASS'S CURRENT COACH.
--
-- THE BUG THIS CLOSES. Both halves of payroll resolved the coach through
-- `classes.coach_id`, read live at compute time:
--
--   • session_pay_amount() priced a lesson using the rate of whoever holds
--     the class NOW.
--   • generate_coach_payouts() selected a coach's lessons with
--     `WHERE c.coach_id = v_coach.id`.
--
-- So handing a class to another coach moved its ENTIRE unpaid history. Coach A
-- teaches July, the class passes to Coach B on 3 Aug, July's draft payout
-- recomputes: A matches zero sessions and drops to $0, while B is paid for four
-- lessons they never taught — at B's rate. The draft-recalculates-every-run
-- design, a safety feature everywhere else, is exactly what made it silent.
--
-- Worse on the frozen path: A's July payout is correctly immutable, but the
-- adjustment loop asks "what is owed now?" for those sessions, which resolved
-- B's rate — so A received an adjustment computed from another coach's pay.
--
-- Same family as mutable coach rates, and the same cure: the answer must come
-- from the terms in force ON THE LESSON'S OWN DATE. class_rates.paid_coach_id
-- (20260719000700) is that record.
--
-- WHAT IS DELIBERATELY NOT CHANGED. `classes.coach_id` keeps its meaning —
-- "who teaches this class now" — and still drives ACCESS: coach_owns_class(),
-- coach_owns_session(), coach_serves_student() and coach_serves_parent() all
-- resolve through it. No policy is touched by this migration. Access follows
-- the current coach; money follows history. A coach who hands over a class
-- loses access to its past lessons (already true) while still being paid for
-- them.
-- ============================================================

/**
 * What this session pays, using the rates IN EFFECT ON ITS OWN DATE.
 *
 * A class flat-rate override replaces the duration calculation entirely.
 * Otherwise: rate.amount × (class duration ÷ rate.unit_minutes), PRO-RATA and
 * never rounded up — rounding up quietly overpays every short lesson, forever.
 *
 * Returns NULL when the coach has no rate in effect, which is how a private
 * coach falls out of payroll without any private-vs-school branch.
 */
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
  -- Duration still comes from the class (it is not effective-dated); the COACH
  -- now comes from the terms in force on the session's date, so a later
  -- handover cannot reprice this lesson.
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

  -- No terms in force is a broken invariant, not an absent rate: every class
  -- is guaranteed a floor-dated row. Returning NULL here would silently drop
  -- the lesson from the payout and underpay the coach, so fail loudly.
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
    RETURN;   -- no rate in effect: this coach is not on payroll
  END IF;

  RETURN QUERY SELECT ROUND(v_amt * (v_mins::NUMERIC / v_unit), 2), 'duration'::TEXT, v_mins;
END;
$$;

/**
 * Build (or rebuild) every coach's payout for one business and period.
 *
 * A payout is a DRAFT until marked paid: it recalculates on every run, so
 * ordinary late attendance corrections simply flow in. A PAID payout is frozen
 * and skipped; corrections to it surface as adjustments on a later period.
 *
 * Returns one row per coach so the caller can report what happened.
 */
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
  -- and refuse: a silent underpayment is the failure mode this whole migration
  -- exists to remove, and it must not be reintroduced by a quiet skip.
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
      -- Frozen. Report it and move on; corrections to it surface as
      -- adjustments on a LATER period, not by editing this one.
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

    -- This period's own sessions — attributed by WHO WAS PAID TO TEACH on each
    -- session's date, not by who holds the class today. `c.tenant_id` is
    -- redundant given coaches are tenanted, and kept explicit because this is
    -- the query a handover used to corrupt.
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

    -- Adjustments: sessions in ALREADY-PAID periods whose pay has since
    -- changed. Compares what is owed now against what was actually paid, and
    -- carries the difference forward — the paid record itself stays intact.
    --
    -- Now that attribution is effective-dated, a handover produces NO
    -- adjustment: those sessions still resolve to the original coach at the
    -- original rate, so "owed now" equals "paid then" and the difference is
    -- zero. Only a genuine amount change (a late attendance correction, a
    -- backdated rate) still moves.
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
        v_now NUMERIC := 0;
        v_diff NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now FROM session_pay_amount(v_sess.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        v_diff := v_now - v_sess.paid_amount;
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
