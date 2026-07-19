-- ============================================================
-- SET_CLASS_TERMS — the one sanctioned way to edit a class.
--
-- WHY AN RPC AND NOT AN UPDATE. Editing a class now writes TWO tables: the
-- non-dated attributes (title, day, time, location) live on `classes`, while
-- the money — price and which coach is paid — is effective-dated in
-- `class_rates` (20260719000700). A client doing two writes can half-fail and
-- leave a class whose displayed schedule and whose billing terms disagree.
-- One SECURITY DEFINER function is one transaction.
--
-- CORRECT vs CHANGE — the distinction that makes effective-dating usable.
-- These are genuinely different intents and the UI must ask which:
--
--   CORRECT  — "I typed 35 when I meant 45." There was never a $35 period.
--              Edits the current row IN PLACE, rewriting history, which is
--              exactly right for a typo and exactly wrong for a price rise.
--   CHANGE   — "the price goes up from 1 September." Inserts a NEW row from
--              that date. Earlier lessons keep the old terms forever.
--
-- Without the choice, every typo becomes permanent fictional history and every
-- genuine rise silently reprices the past — the bug this whole cluster
-- removes, reintroduced through the front door.
--
-- A save that changes neither price nor coach inserts NOTHING. Otherwise
-- renaming a class would litter its history with identical dated rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_class_terms(
  p_class_id         UUID,
  p_title            TEXT,
  p_day_of_week      day_of_week,
  p_start_time       TIME,
  p_end_time         TIME,
  p_location_name    TEXT,
  p_price_per_lesson NUMERIC,
  p_coach_id         UUID,
  p_effective_from   DATE    DEFAULT NULL,
  p_correct_in_place BOOLEAN DEFAULT FALSE,
  p_location_address TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_from     DATE := COALESCE(p_effective_from, CURRENT_DATE);
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
  IF v_from > CURRENT_DATE THEN
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
$$;

REVOKE ALL ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT
) TO authenticated;
