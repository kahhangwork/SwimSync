-- ============================================================
-- AN ADJUSTMENT IS CARRIED ONCE, NOT ON EVERY LATER PAYOUT.
--
-- THE BUG. The adjustment loop asked, for every session in an already-PAID
-- period: "what is owed now vs what was actually paid then?" — and emitted the
-- difference. It asked that again on the NEXT period, and the next, forever,
-- because nothing recorded that the correction had already been carried.
--
-- A single -$45 correction to one March lesson therefore appeared on the
-- April payout, again on December's, and again on January's:
--
--     2026-04  draft  adjustment  orig 2026-03  -45.00
--     2026-12  paid   adjustment  orig 2026-03  -45.00
--     2027-01  draft  adjustment  orig 2026-03  -45.00
--
-- The coach is docked the same $45 every month, indefinitely. With a positive
-- correction it runs the other way — the business pays the same back-pay over
-- and over. `ON CONFLICT DO NOTHING` did not catch it: that dedupes within ONE
-- payout (payout_id, lesson_session_id), and each of these is a different
-- payout.
--
-- Found 2026-07-19 while testing the effective-dated attribution fix
-- (20260719000800); it is older than that change and independent of it.
--
-- THE FIX — subtract what has ALREADY been carried, not just what was paid:
--
--     diff := owed_now - paid_originally - SUM(adjustments already emitted)
--
-- Emitting once and then suppressing forever would have been the obvious
-- alternative and is WRONG: a lesson can be corrected twice (a late attendance
-- edit, then a backdated rate). The running-total form handles that — the
-- first correction emits its delta, a re-run emits zero, and a genuine SECOND
-- change emits only the new difference.
--
-- ORDERING NOTE. Draft payouts are rebuilt from scratch (their items are
-- deleted first), so which draft ends up holding an outstanding adjustment can
-- depend on the order periods are generated in. The money is correct either
-- way — across all payouts a correction is counted exactly once, which is the
-- invariant that matters — but do not be surprised to see one move between
-- drafts. A paid payout never moves.
-- ============================================================

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
    -- session's date, not by who holds the class today.
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
    -- changed. The paid record itself stays intact; the difference is carried
    -- forward — ONCE. See the header for why the running total is required.
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

        -- Everything already carried for this session on ANY other payout of
        -- this coach's, paid or draft. Without this the same difference is
        -- re-emitted every period, forever.
        SELECT COALESCE(SUM(i2.amount), 0) INTO v_carried
          FROM coach_payout_items i2
          JOIN coach_payouts p2 ON p2.id = i2.payout_id
         WHERE p2.tenant_id = p_tenant_id
           AND p2.coach_id = v_coach.id
           AND i2.lesson_session_id = v_sess.id
           AND i2.is_adjustment
           AND p2.id <> v_payout;   -- this one is being rebuilt

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
