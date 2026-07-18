-- ============================================================
-- Phase 5: coach wages — computation.
--
-- Lives in Postgres rather than a second Edge Function: every input is already
-- here (attendance, classes, rates), there is no billing-style external side
-- effect to isolate, and putting it here means the coach app reads STORED rows
-- instead of re-deriving pay on a phone.
-- ============================================================

/**
 * Does this session pay its coach?
 *
 * Evaluated in this order, and the order matters:
 *   1. cancelled_coach       → NEVER. Not configurable: it was the coach's call.
 *   2. an explicit override  → whatever the admin decided for this session.
 *   3. cancelled_rain        → the tenant's default (they travelled; pool shut).
 *   4. ≥1 student attended   → pay.
 *   5. everyone absent       → no. The lesson "ran" on paper but nobody came.
 *
 * `trial_free` COUNTS as attendance here even though nobody was billed for it —
 * the coach still taught the lesson. Paying only for billable statuses would
 * quietly dock them for the business's own marketing.
 */
CREATE OR REPLACE FUNCTION public.session_pays_coach(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_override BOOLEAN;
  v_tenant   UUID;
  v_rain     BOOLEAN;
  v_attended INT;
  v_rows     INT;
  v_coach_x  INT;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM attendance WHERE lesson_session_id = p_session_id;
  IF v_rows = 0 THEN
    RETURN FALSE;   -- nothing marked: not a lesson that happened
  END IF;

  SELECT COUNT(*) INTO v_coach_x
    FROM attendance
   WHERE lesson_session_id = p_session_id AND status = 'cancelled_coach';
  IF v_coach_x = v_rows THEN
    RETURN FALSE;
  END IF;

  SELECT pays_coach INTO v_override
    FROM session_pay_overrides WHERE lesson_session_id = p_session_id;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT COUNT(*) INTO v_attended
    FROM attendance
   WHERE lesson_session_id = p_session_id
     AND status IN ('present', 'trial_paid', 'trial_free');
  IF v_attended > 0 THEN
    RETURN TRUE;
  END IF;

  -- Nobody attended. Rain is the tenant's policy; anything else is unpaid.
  IF EXISTS (
    SELECT 1 FROM attendance
     WHERE lesson_session_id = p_session_id AND status = 'cancelled_rain'
  ) THEN
    v_tenant := session_tenant(p_session_id);
    SELECT rain_pays_coach INTO v_rain FROM tenants WHERE id = v_tenant;
    RETURN COALESCE(v_rain, FALSE);
  END IF;

  RETURN FALSE;   -- everyone absent
END;
$$;

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
  SELECT ls.session_date, ls.class_id, c.coach_id,
         EXTRACT(EPOCH FROM (c.end_time - c.start_time)) / 60
    INTO v_date, v_class, v_coach, v_mins
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = p_session_id;

  IF v_date IS NULL THEN
    RETURN;
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
 * Build (or rebuild) the payouts for one tenant and one calendar month.
 *
 * A DRAFT payout is rebuilt from scratch every time — that is the whole point
 * of the draft window: late corrections just flow in, with no adjustment
 * machinery. A PAID payout is never touched; instead, any session in it whose
 * pay has since changed produces an ADJUSTMENT item on the current draft,
 * carrying the period it belongs to.
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

    -- This period's own sessions.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.coach_id = v_coach.id
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

/**
 * Freeze a payout: money has left the bank, so the record must stop moving.
 */
CREATE OR REPLACE FUNCTION public.mark_payout_paid(p_payout_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_status payout_status;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_status
    FROM coach_payouts WHERE id = p_payout_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'payout not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to mark this payout paid';
  END IF;
  IF v_status = 'paid' THEN
    RETURN;   -- idempotent: a double tap is not an error
  END IF;

  UPDATE coach_payouts
     SET status = 'paid', paid_at = NOW(), paid_marked_by = auth.uid()
   WHERE id = p_payout_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_coach_payouts(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_payout_paid(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_coach_payouts(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_paid(UUID) TO authenticated;
