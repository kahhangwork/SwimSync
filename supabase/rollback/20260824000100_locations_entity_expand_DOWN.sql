-- ============================================================
-- ROLLBACK for 20260824000100_locations_entity_expand.sql.
-- Plan: docs/plans/LOCATION_ENTITY_PLAN.md.
--
-- Reverses the EXPAND phase entirely: drops the sync/tenant/archive triggers and
-- their functions, drops classes.location_id (with its FK + index), drops the
-- `locations` table, and RESTORES set_class_terms to its exact 11-argument form
-- (20260812000200) so `supabase test db` is byte-identical to the pre-migration
-- state (§7.93). The backfilled locations rows and location_id values vanish with
-- the table/column — no data of value is lost, the free-text location_name /
-- location_address columns were never touched.
--
-- Deploy ORDER for a rollback: revert the admin + mobile apps FIRST (so nothing
-- sends p_location_id or selects the locations join), THEN run this. Only valid
-- while the CONTRACT migration has NOT been applied — once location_name is
-- dropped, this DOWN cannot restore it and a different recovery is needed.
--
-- Run manually (not auto-applied): supabase db reset does NOT run rollback/.
-- ============================================================

BEGIN;

-- ── Triggers + their functions ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_class_location_sync    ON classes;
DROP TRIGGER IF EXISTS trg_class_location_tenant  ON classes;
DROP FUNCTION IF EXISTS public.sync_class_location_id();
DROP FUNCTION IF EXISTS public.enforce_class_location_tenant();

DROP TRIGGER IF EXISTS trg_location_archive_guard ON locations;
DROP FUNCTION IF EXISTS public.enforce_location_archive_guard();

-- ── The FK column, then the table ────────────────────────────────────────────
ALTER TABLE classes DROP COLUMN IF EXISTS location_id;   -- drops FK + index too
DROP TABLE IF EXISTS locations;

-- ── Restore the 11-arg set_class_terms (20260812000200, verbatim) ────────────
DROP FUNCTION IF EXISTS public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT, UUID
);

CREATE FUNCTION public.set_class_terms(
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
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    RAISE EXCEPTION 'price per lesson must be zero or more';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM coaches c WHERE c.id = p_coach_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that coach does not belong to this business';
  END IF;

  IF p_coach_id IS DISTINCT FROM (SELECT c.coach_id FROM classes c WHERE c.id = p_class_id)
     AND EXISTS (
       SELECT 1 FROM class_shadow_coaches s
        WHERE s.class_id = p_class_id
          AND s.coach_id = p_coach_id
          AND s.effective_to IS NULL)
  THEN
    RAISE EXCEPTION
      'that coach is currently shadowing this class — end their shadow '
      'assignment first, then hand the class over. Their past shadow pay is '
      'kept either way.';
  END IF;

  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'terms cannot start in the future (got %)', v_from;
  END IF;

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

  SELECT r.price_per_lesson, r.paid_coach_id
    INTO v_cur
    FROM class_rate_on(p_class_id, v_from) r;

  IF v_cur.price_per_lesson IS NOT DISTINCT FROM p_price_per_lesson
     AND v_cur.paid_coach_id IS NOT DISTINCT FROM p_coach_id THEN
    RETURN;
  END IF;

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
-- §7.39: a DROP+CREATE is a new function and cloud default-grants it to anon;
-- REVOKE ALL FROM PUBLIC does not remove a direct anon grant, so close it here too.
REVOKE EXECUTE ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT
) TO authenticated;

COMMIT;
