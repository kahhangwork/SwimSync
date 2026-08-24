-- Location entity — EXPAND phase.  Plan: docs/plans/LOCATION_ENTITY_PLAN.md
--
-- Promotes the free-text classes.location_name / classes.location_address into a
-- per-tenant `locations` entity referenced by classes.location_id.  This is the
-- EXPAND half of an expand/contract pair (§8.70):
--   * adds `locations` (table + RLS + grants + cross-tenant guard),
--   * adds a NULLABLE classes.location_id FK,
--   * backfills one location per distinct (tenant, trimmed name),
--   * adds a SYNC trigger so the OLD deployed admin — which still writes only
--     location_name during the deploy window — keeps location_id correct, so the
--     later CONTRACT migration's SET NOT NULL cannot fail (RISK 2),
--   * keeps location_name / location_address in place.
-- The CONTRACT migration (lands LAST, after the apps stop reading the free-text
-- columns) sets location_id NOT NULL and drops the free-text columns.
--
-- Mirrors tenant_levels (20260719001800): per-tenant lookup, RLS, cross-tenant
-- FK guard.  DELETE = ARCHIVE (archived_at), never a hard row delete — so a
-- retired class keeps a valid FK and reactivate_class() never grows a refusal.

-- ── The table ────────────────────────────────────────────────────────────────
CREATE TABLE locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address     TEXT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One business cannot have two ACTIVE locations of the same name.  PARTIAL, so a
-- name is reusable after archiving (archive keeps the row for retired classes).
CREATE UNIQUE INDEX locations_tenant_name_active_idx
  ON locations (tenant_id, name) WHERE archived_at IS NULL;

CREATE INDEX locations_tenant_sort_idx
  ON locations (tenant_id, sort_order, name);

-- ⚠️ CREATE TABLE LEAVES RLS OFF — policies on an RLS-disabled table are never
-- consulted (tenant_levels 20260719001800 carries the full warning). Enable it.
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can see the business: its staff, and the parents it
-- serves (a parent sees where their child's class is — PRD parent display).
CREATE POLICY locations_select ON locations
  FOR SELECT
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)
  );

-- Only the business's own admin manages its locations.
CREATE POLICY locations_write ON locations
  FOR ALL
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO authenticated;
GRANT ALL ON locations TO service_role;

COMMENT ON TABLE locations IS
  'A business''s own swim-school locations (name, address, notes). Replaces the '
  'free-text classes.location_name. Delete = archive (archived_at); the row is '
  'kept so retired classes keep a valid FK. See docs/plans/LOCATION_ENTITY_PLAN.md.';

-- ── Archive guard (RISK 6) ───────────────────────────────────────────────────
-- The "cannot archive a location an ACTIVE class still uses" rule must live in
-- the DATABASE, not only in the admin page: the write policy is can_admin_tenant,
-- so any admin API call can set archived_at directly, around the page's check
-- (§7.143 — every writer includes PostgREST). SECURITY DEFINER so RLS cannot hide
-- a referencing class from the check (§7.125).
CREATE OR REPLACE FUNCTION enforce_location_archive_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM classes c
                  WHERE c.location_id = NEW.id AND c.is_active) THEN
    RAISE EXCEPTION
      'That location is still used by an active class — retag or retire those '
      'classes first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_location_archive_guard
  BEFORE UPDATE OF archived_at ON locations
  FOR EACH ROW EXECUTE FUNCTION enforce_location_archive_guard();

-- ── The class's location FK ──────────────────────────────────────────────────
-- NULLABLE in the expand phase; the contract migration sets it NOT NULL once the
-- backfill + sync trigger guarantee every row is filled.  ON DELETE RESTRICT is a
-- backstop only — the app ARCHIVES, it never hard-deletes a location.
ALTER TABLE classes
  ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE RESTRICT;

CREATE INDEX classes_location_id_idx ON classes (location_id);

-- A class's location must belong to the same business as the class.  Same shape
-- as enforce_class_category_tenant (20260720000100) — a cross-table reference no
-- single-row policy can see.
CREATE OR REPLACE FUNCTION enforce_class_location_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc_tenant UUID;
BEGIN
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO v_loc_tenant FROM locations WHERE id = NEW.location_id;
  IF v_loc_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that location belongs to another business';
  END IF;
  RETURN NEW;
END;
$$;

-- Validates the location_id the sync trigger (created AFTER the backfill, below)
-- has resolved.  On INSERT and on UPDATE OF location_id it fires; on a Direction-B
-- rename (UPDATE OF location_name only) it does NOT fire, which is safe because
-- that path resolves strictly within NEW.tenant_id and the coach-change path that
-- rewrites tenant_id is backstopped by the classes RLS WITH CHECK.
CREATE TRIGGER trg_class_location_tenant
  BEFORE INSERT OR UPDATE OF location_id, tenant_id ON classes
  FOR EACH ROW EXECUTE FUNCTION enforce_class_location_tenant();

-- ── Backfill (RISK 3) ────────────────────────────────────────────────────────
-- Runs BEFORE the sync trigger is created (below), deliberately: the backfill's
-- `UPDATE ... SET location_id` would otherwise fire the sync trigger's mirror
-- path and REWRITE every class's location_name/location_address (trimmed name,
-- MIN address) at expand time — changing what the still-deployed old app shows
-- and breaking the DOWN migration's "free-text columns untouched" guarantee.
-- With the trigger absent here, only the tenant guard fires (a no-op validation).
-- One location per distinct (tenant, TRIMMED name).  Blank/whitespace-only names
-- map to 'Unspecified location' (location_name is NOT NULL but has no CHECK, so
-- '' and '  ' are legal and do occur).  Address: MIN over the non-null trimmed
-- values, because one name can carry two addresses across classes and the insert
-- must pick one deterministically.
INSERT INTO locations (tenant_id, name, address)
SELECT c.tenant_id,
       COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location') AS name,
       MIN(NULLIF(trim(c.location_address), '')) AS address
FROM classes c
GROUP BY c.tenant_id,
         COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location');

UPDATE classes c
   SET location_id = l.id
  FROM locations l
 WHERE l.tenant_id = c.tenant_id
   AND l.name = COALESCE(NULLIF(trim(c.location_name), ''), 'Unspecified location')
   AND l.archived_at IS NULL;

-- Assertions — the gate for the contract migration's SET NOT NULL.
DO $$
DECLARE v_null INT; v_blank INT;
BEGIN
  SELECT count(*) INTO v_null  FROM classes   WHERE location_id IS NULL;
  IF v_null <> 0 THEN
    RAISE EXCEPTION 'location backfill left % class(es) with NULL location_id', v_null;
  END IF;
  SELECT count(*) INTO v_blank FROM locations WHERE length(trim(name)) = 0;
  IF v_blank <> 0 THEN
    RAISE EXCEPTION 'location backfill produced % blank-named location(s)', v_blank;
  END IF;
END $$;

-- ── The expand-window sync trigger (RISK 2) ──────────────────────────────────
-- Created AFTER the backfill (see the note above).  Keeps location_id and the
-- free-text columns consistent from EITHER direction, so BOTH the old and the new
-- app work during the deploy window and — crucially — the new app never has to
-- write the free-text columns at all, which is what lets the contract migration
-- drop them without a second app change.
--
-- ⚠ THE DIRECTION IS CHOSEN BY WHAT ACTUALLY CHANGED, NOT BY "is location_id set".
-- After the backfill EVERY class has a non-NULL location_id, so a bare
-- `NEW.location_id IS NOT NULL` test would send every old-admin rename down the
-- mirror path and SILENTLY REVERT it (finding 1).  So:
--   Direction B (resolve id from the name) when a rename changed location_name but
--     NOT location_id — the OLD app's free-text edit, or an old-app INSERT;
--   Direction A (mirror the free-text columns from the entity) otherwise — the NEW
--     app writing location_id, or an id change.
--
-- SECURITY DEFINER so it can read/insert locations across RLS from whatever role
-- touched classes (§7.125).  Idempotent, so §7.57 (BEFORE INSERT also fires for an
-- upsert-resolved UPDATE) is harmless.  Fires BEFORE the tenant guard (name sorts
-- earlier), which then validates any id it resolved.
CREATE OR REPLACE FUNCTION sync_class_location_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT;
  v_addr TEXT;
  v_loc  UUID;
  v_resolve_from_name BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A rename: location_name changed while location_id was left as it was.
    v_resolve_from_name := (NEW.location_id IS NOT DISTINCT FROM OLD.location_id)
                       AND (NEW.location_name IS DISTINCT FROM OLD.location_name);
  ELSE  -- INSERT: only a name, no id, is the old-app shape.
    v_resolve_from_name := (NEW.location_id IS NULL);
  END IF;

  IF NOT v_resolve_from_name AND NEW.location_id IS NOT NULL THEN
    -- Direction A: location_id is authoritative — the free-text columns mirror it.
    SELECT name, address INTO v_name, v_addr FROM locations WHERE id = NEW.location_id;
    IF v_name IS NOT NULL THEN   -- NULL only if the id is bogus; the FK then rejects
      NEW.location_name    := v_name;
      NEW.location_address := v_addr;
    END IF;
    RETURN NEW;
  END IF;

  -- Direction B: resolve/create the entity from the (new) name, fill the id.
  v_name := COALESCE(NULLIF(trim(NEW.location_name), ''), 'Unspecified location');
  NEW.location_name := v_name;   -- persist the trimmed/defaulted form
  SELECT id INTO v_loc FROM locations
    WHERE tenant_id = NEW.tenant_id AND name = v_name AND archived_at IS NULL;
  IF v_loc IS NULL THEN
    -- ON CONFLICT closes the create/create race between two concurrent inserts of
    -- the same brand-new name (finding 7); the loser re-selects the winner's row.
    INSERT INTO locations (tenant_id, name, address)
      VALUES (NEW.tenant_id, v_name, NULLIF(trim(NEW.location_address), ''))
      ON CONFLICT (tenant_id, name) WHERE archived_at IS NULL DO NOTHING
      RETURNING id INTO v_loc;
    IF v_loc IS NULL THEN
      SELECT id INTO v_loc FROM locations
        WHERE tenant_id = NEW.tenant_id AND name = v_name AND archived_at IS NULL;
    END IF;
  END IF;
  NEW.location_id := v_loc;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_class_location_sync
  BEFORE INSERT OR UPDATE OF location_name, location_id ON classes
  FOR EACH ROW EXECUTE FUNCTION sync_class_location_id();

-- ── set_class_terms: accept p_location_id (RISK 7) ───────────────────────────
-- CREATE OR REPLACE with a new default param would leave a SECOND pg_proc row and
-- PostgREST could keep calling the old body (§7.124).  DROP the exact 11-arg
-- signature first, then create the 12-arg form with p_location_id appended LAST
-- and defaulted, so the deployed admin's 11-argument call still resolves here
-- through the window (§7.123).  A DROP+CREATE does not carry the old grant, so
-- re-REVOKE/GRANT below.  The 11 existing parameters KEEP their order and names.
DROP FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT
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
  p_location_address TEXT    DEFAULT NULL,
  p_location_id      UUID    DEFAULT NULL   -- LAST + defaulted: 11-arg callers still bind
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

  -- ── The handover guard ── (unchanged; see 20260812000200 for the reasoning)
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

  -- ── Non-dated attributes ──
  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET title            = p_title,
         day_of_week      = p_day_of_week,
         start_time       = p_start_time,
         end_time         = p_end_time,
         location_name    = p_location_name,
         location_address = p_location_address,
         -- Expand phase: keep writing the free-text columns AND set location_id.
         -- When p_location_id is NULL (an old-admin 11-arg call) the sync trigger
         -- resolves it from location_name, so it is never nulled.
         location_id      = COALESCE(p_location_id, location_id),
         coach_id         = p_coach_id,
         updated_at       = NOW()
   WHERE id = p_class_id;

  -- ── Money: only if it actually moved ──
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

-- New 12-arg signature = new function object: callable by nobody until granted
-- (§7.87), and cloud default-grants new public functions to anon (§7.39) — both
-- closed explicitly here.
REVOKE ALL ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_class_terms(
  UUID, TEXT, day_of_week, TIME, TIME, TEXT, NUMERIC, UUID, DATE, BOOLEAN, TEXT, UUID
) TO authenticated;

-- Exactly one set_class_terms row must remain (RISK 7 — no orphaned old signature).
DO $$
DECLARE v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE proname = 'set_class_terms' AND pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 set_class_terms overload, found %', v_n;
  END IF;
END $$;
