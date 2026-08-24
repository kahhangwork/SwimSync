-- Location entity — CONTRACT phase.  Plan: docs/plans/LOCATION_ENTITY_PLAN.md
--
-- ⚠ HELD BACK ON PURPOSE — the `.hold` suffix keeps `supabase db push` / `db
-- reset` from applying it.  It is the LAST step of the deploy and lands only
-- AFTER the apps that stopped reading/writing the free-text columns are live on
-- prod (§8.70 pattern).  Applying it while the OLD app is still deployed makes
-- every class read/write 400 on a column that no longer exists (RISK 1).  To
-- ship: rename to `.sql`, `supabase db push`, then rename back is NOT possible —
-- it is a one-way contract.
--
-- ⚠ UN-HOLD IS A FIXTURE SWEEP, NOT JUST A RENAME.  Dropping the free-text
-- columns breaks every INSERT that still names them.  As of 2026-08-24 that is:
--   • supabase/seed.sql (line ~76) — insert a `locations` row per seeded tenant
--     and set classes.location_id instead of location_name/location_address;
--   • ~50 pgTAP fixtures under supabase/tests/ that insert a class with
--     `location_name` (grep: `grep -rln location_name supabase/tests`) — each
--     must create/reference a location and pass location_id;
--   • supabase/tests/locations.test.sql — drop its EXPAND-ONLY cases (the
--     free-text backfill and the location_name sync-trigger cases); the RLS,
--     archive guard, cross-tenant, RESTRICT, and reverse-mirror assertions hold.
--   • ⚠ disable_coach() (20260813000200) — it does `SELECT c.* INTO v_class` and
--     passes v_class.location_name / v_class.location_address positionally into
--     set_class_terms.  plpgsql binds record fields at execution, so after this
--     migration DROPs the columns the disable-with-replacement path throws
--     `record "v_class" has no field "location_name"` at RUNTIME.  This migration
--     MUST also CREATE OR REPLACE disable_coach to stop reading those fields
--     (pass NULL for p_location_name/p_location_address and v_class.location_id
--     for p_location_id — the 12-arg call still binds).
-- Do the sweep as its OWN change on the db branch, land it, prove `supabase test
-- db` + Deno green on the contract schema, THEN rename this to `.sql` and deploy
-- it LAST.  The bidirectional sync trigger means those fixtures already work on
-- the expand schema, so the sweep can be prepared and verified ahead of time.
--
-- What it does:
--   1. redefines set_class_terms to STOP writing the free-text columns (keeping
--      p_location_name / p_location_address as accepted-and-ignored params so the
--      deployed admin's argument list is unchanged — §7.123),
--   2. drops the expand-window sync trigger + its function,
--   3. re-runs the backfill idempotently and asserts 0 NULL location_id,
--   4. sets classes.location_id NOT NULL,
--   5. drops classes.location_name and classes.location_address.

-- ── 1. set_class_terms stops touching the free-text columns ───────────────────
-- SAME 12-arg signature as the expand form, so this is a plain CREATE OR REPLACE
-- with no §7.123 exposure and no re-grant needed (§11.32 pattern).  The two
-- location free-text params remain in the signature, accepted and ignored — the
-- deployed admin keeps sending them; removing them would change the named-arg set
-- it sends and reopen §7.123.  Drop the dead params in a later cleanup migration
-- once no deployed bundle sends them.
CREATE OR REPLACE FUNCTION public.set_class_terms(
  p_class_id         UUID,
  p_title            TEXT,
  p_day_of_week      day_of_week,
  p_start_time       TIME,
  p_end_time         TIME,
  p_location_name    TEXT,               -- accepted + ignored (see header)
  p_price_per_lesson NUMERIC,
  p_coach_id         UUID,
  p_effective_from   DATE    DEFAULT NULL,
  p_correct_in_place BOOLEAN DEFAULT FALSE,
  p_location_address TEXT    DEFAULT NULL, -- accepted + ignored (see header)
  p_location_id      UUID    DEFAULT NULL
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

  -- The free-text columns are gone; location is set by FK only.  A NULL
  -- p_location_id (an old 11-arg positional caller) leaves the location unchanged.
  UPDATE classes
     SET title            = p_title,
         day_of_week      = p_day_of_week,
         start_time       = p_start_time,
         end_time         = p_end_time,
         location_id      = COALESCE(p_location_id, location_id),
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

-- ── 2. Drop the expand-window sync trigger + function ────────────────────────
DROP TRIGGER IF EXISTS trg_class_location_sync ON classes;
DROP FUNCTION IF EXISTS public.sync_class_location_id();

-- ── 3. Heal any window rows, then assert (RISK 2) ────────────────────────────
-- The sync trigger kept location_id filled through the deploy window; this
-- idempotent re-backfill covers any row the old app wrote in the gap before it
-- fired, and the assertion is the gate for SET NOT NULL.
INSERT INTO locations (tenant_id, name, address)
SELECT c.tenant_id,
       COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location') AS name,
       MIN(NULLIF(trim(c.location_address), '')) AS address
FROM classes c
WHERE c.location_id IS NULL
GROUP BY c.tenant_id,
         COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location')
ON CONFLICT DO NOTHING;

UPDATE classes c
   SET location_id = l.id
  FROM locations l
 WHERE c.location_id IS NULL
   AND l.tenant_id = c.tenant_id
   AND l.name = COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location')
   AND l.archived_at IS NULL;

DO $$
DECLARE v_null INT;
BEGIN
  SELECT count(*) INTO v_null FROM classes WHERE location_id IS NULL;
  IF v_null <> 0 THEN
    RAISE EXCEPTION 'contract: % class(es) still have NULL location_id — cannot SET NOT NULL', v_null;
  END IF;
END $$;

-- ── 4. location_id is now mandatory ──────────────────────────────────────────
ALTER TABLE classes ALTER COLUMN location_id SET NOT NULL;

-- ── 5. Drop the free-text columns ────────────────────────────────────────────
ALTER TABLE classes DROP COLUMN location_name;
ALTER TABLE classes DROP COLUMN location_address;

-- ── 6. disable_coach stops reading the dropped record fields ──────────────────
-- disable_coach() does `SELECT c.* INTO v_class` (a RECORD) and passed
-- v_class.location_name / v_class.location_address positionally into
-- set_class_terms.  plpgsql binds record fields at EXECUTION, so after the DROPs
-- above the disable-with-replacement path throws `record "v_class" has no field
-- "location_name"` at runtime.  Re-create the function reading location_id only:
-- pass NULL for the (accepted-and-ignored) free-text params and v_class.location_id
-- as p_location_id.  Body is otherwise byte-identical to 20260813000200; only the
-- nested set_class_terms call changed.  Same (UUID, UUID) signature, so this is a
-- plain CREATE OR REPLACE — grants persist (§11.32), no re-grant needed.
CREATE OR REPLACE FUNCTION public.disable_coach(
  p_coach_id             UUID,
  p_replacement_coach_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coach       coaches%ROWTYPE;
  v_owner       UUID;
  v_class       RECORD;
  v_price       NUMERIC;
  v_class_names TEXT;
  v_reassigned  UUID[] := '{}';
BEGIN
  SELECT * INTO v_coach FROM coaches WHERE id = p_coach_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such coach';
  END IF;

  IF NOT is_tenant_admin(v_coach.tenant_id) THEN
    RAISE EXCEPTION 'not permitted to manage coaches for this business';
  END IF;

  IF v_coach.disabled_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT t.owner_profile_id INTO v_owner
    FROM tenants t WHERE t.id = v_coach.tenant_id;
  IF v_coach.profile_id IS NOT DISTINCT FROM v_owner AND NOT EXISTS (
    SELECT 1 FROM coaches c
     WHERE c.tenant_id = v_coach.tenant_id
       AND c.id <> p_coach_id
       AND c.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'this is the owner''s coach account and the business''s only active '
      'coach — hire another coach before disabling it';
  END IF;

  IF p_replacement_coach_id IS NOT NULL THEN
    IF p_replacement_coach_id = p_coach_id THEN
      RAISE EXCEPTION 'a coach cannot be their own replacement';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM coaches c
       WHERE c.id = p_replacement_coach_id
         AND c.tenant_id = v_coach.tenant_id
         AND c.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'the replacement must be an active coach of this business';
    END IF;
  END IF;

  SELECT string_agg(c.title, ', ' ORDER BY c.title) INTO v_class_names
    FROM classes c
   WHERE c.coach_id = p_coach_id AND c.is_active;
  IF v_class_names IS NOT NULL AND p_replacement_coach_id IS NULL THEN
    RAISE EXCEPTION
      'this coach still teaches: %. Choose a replacement coach — the classes '
      'are handed over and the coach disabled in one step.', v_class_names;
  END IF;

  FOR v_class IN
    SELECT c.* FROM classes c
     WHERE c.coach_id = p_coach_id AND c.is_active
     ORDER BY c.title
  LOOP
    SELECT r.price_per_lesson INTO v_price
      FROM class_rate_on(v_class.id, today_sg()) r;
    PERFORM set_class_terms(
      v_class.id,
      v_class.title,
      v_class.day_of_week,
      v_class.start_time,
      v_class.end_time,
      NULL,     -- p_location_name — free-text column dropped (contract), ignored
      COALESCE(v_price, v_class.price_per_lesson),
      p_replacement_coach_id,
      NULL,     -- effective from today
      FALSE,    -- a handover, never an in-place correction
      NULL,     -- p_location_address — dropped, ignored
      v_class.location_id   -- p_location_id: keep the class's location
    );
    v_reassigned := v_reassigned || v_class.id;
  END LOOP;

  UPDATE class_shadow_coaches
     SET effective_to = GREATEST(effective_from, today_sg()),
         ended_by     = auth.uid(),
         ended_at     = NOW()
   WHERE coach_id = p_coach_id AND effective_to IS NULL;

  DELETE FROM session_coaches sc
   USING lesson_sessions ls
   WHERE ls.id = sc.lesson_session_id
     AND sc.coach_id = p_coach_id
     AND ls.session_date > today_sg();

  UPDATE coaches SET disabled_at = NOW() WHERE id = p_coach_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'coach_disabled', 'Coach', p_coach_id,
          jsonb_build_object('disabled_at', NULL),
          jsonb_build_object(
            'disabled_at',           NOW(),
            'replacement_coach_id',  p_replacement_coach_id,
            'classes_reassigned',    to_jsonb(v_reassigned)));
END;
$$;
