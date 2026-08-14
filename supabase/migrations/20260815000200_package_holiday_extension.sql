-- ============================================================
-- Packages, phase C — live public-holiday validity extension + acknowledge.
-- Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md, Decisions 4-5 / ⚠ RISK 4-5.
--
-- A package's validity extends by ONE WEEK for each distinct week, inside its
-- NOMINAL window [start_date, start_date + validity_weeks*7), in which at least
-- one scheduled lesson (a covered kid's current active class, on that class's
-- weekday) lands on a tenant public holiday. Per affected WEEK, not per lesson:
-- two of a kid's classes both hit in one week is +1 week, not +2 (the user's
-- edge case), and it self-scales to any number of kids/classes.
--
-- ⚠ RISK 4 — the recompute is convergent, idempotent, and cannot touch settled
--   money:
--   • NO CASCADE: the counting window is computed from start_date +
--     validity_weeks ONLY. It NEVER reads expires_on, so a holiday in the
--     already-granted tail cannot add a week that adds a week.
--   • IDEMPOTENT: it writes (and logs an audit event) only when the newly
--     computed week count DIFFERS from the stored one. Run twice ⇒ one event.
--   • SHRINK CLAMPS ACK: removing a holiday lowers the count; the ack
--     high-water is clamped down so a later re-bump goes loud again.
--   • Settled money is out of reach by construction: an invoiced lesson has an
--     invoice_items row and is excluded from the pending set; moving expires_on
--     reprices nothing already billed (a Deno test pins this).
--
-- ⚠ RISK 5 — every RPC here is SECURITY DEFINER (bypasses RLS), so each checks
--   authorization internally and never trusts a client-supplied identity.
-- ============================================================

-- ------------------------------------------------------------
-- 1. package_extension_events — the append-only audit + card breakdown source.
-- ------------------------------------------------------------

CREATE TABLE package_extension_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_package_id  UUID NOT NULL REFERENCES parent_packages(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('holiday', 'manual')),
  -- Signed: a removed holiday writes a negative delta.
  delta_days         INTEGER NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  created_by         UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX package_extension_events_pkg_idx
  ON package_extension_events (parent_package_id, created_at DESC);

ALTER TABLE package_extension_events ENABLE ROW LEVEL SECURITY;

-- Read-only to app roles: the owning parent and the business's admins. Writes
-- arrive exclusively via the DEFINER RPCs below (as postgres), so there is NO
-- insert/update/delete policy and NO write grant — the trail is not
-- client-forgeable, and table_grants.test.sql would go red on any grant a
-- policy does not permit (§7.87).
CREATE POLICY package_extension_events_select ON package_extension_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parent_packages pp
      WHERE pp.id = package_extension_events.parent_package_id
        AND (
          is_platform_admin()
          OR can_admin_tenant(pp.tenant_id)
          OR pp.parent_id = current_parent_id()
        )
    )
  );

GRANT SELECT ON package_extension_events TO authenticated;
GRANT ALL ON package_extension_events TO service_role;

-- ------------------------------------------------------------
-- 2. recompute_package_extensions() — the live recompute.
--    Scope: a tenant (admin/service) or a single parent (their own packages).
--    Returns the number of packages whose extension changed.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION recompute_package_extensions(
  p_tenant uuid DEFAULT NULL,
  p_parent uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Inside a SECURITY DEFINER function current_user is always the owner
  -- (postgres), so it CANNOT tell a service call from a client one — that seam
  -- is auth.uid(): NULL only when there is no JWT (the nightly / engine path).
  v_is_service BOOLEAN := auth.uid() IS NULL;
  pp        parent_packages%ROWTYPE;
  v_nominal DATE;
  v_weeks   INTEGER;
  v_reason  TEXT;
  v_changed INTEGER := 0;
BEGIN
  -- ⚠ RISK 5 authorization: a client caller may only recompute a scope they
  -- own. A parent passes their own parent id; an admin passes a tenant they
  -- administer. Anything else is refused.
  IF NOT v_is_service THEN
    IF p_parent IS NOT NULL AND p_parent = current_parent_id() THEN
      NULL; -- a parent recomputing their own packages
    ELSIF p_tenant IS NOT NULL AND can_admin_tenant(p_tenant) THEN
      NULL; -- an admin recomputing their tenant
    ELSE
      RAISE EXCEPTION 'Not authorized to recompute package extensions.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  FOR pp IN
    SELECT * FROM parent_packages
    WHERE status = 'active'
      AND (p_tenant IS NULL OR tenant_id = p_tenant)
      AND (p_parent IS NULL OR parent_id = p_parent)
    -- ⚠ #8: lock each package row so two concurrent recomputes (parent's phone
    -- + admin's browser) can't both observe the old count and both log the
    -- delta. Stored state converges regardless, but the audit would double.
    FOR UPDATE
  LOOP
    -- ⚠ RISK 4 no-cascade: the window is start_date + validity_weeks, NEVER
    -- expires_on.
    v_nominal := pp.start_date + (pp.validity_weeks * 7);

    -- Distinct affected weeks + the names that caused them, in one pass.
    SELECT count(DISTINCT date_trunc('week', h.holiday_date))::int,
           COALESCE(string_agg(DISTINCT h.name, ', ' ORDER BY h.name), '')
      INTO v_weeks, v_reason
    FROM tenant_public_holidays h
    WHERE h.tenant_id = pp.tenant_id
      AND h.holiday_date >= pp.start_date
      AND h.holiday_date <  v_nominal
      AND EXISTS (
        SELECT 1
        FROM parent_students ps
        JOIN student_class_enrolments e ON e.student_id = ps.student_id AND e.is_active
        JOIN classes c ON c.id = e.class_id
                      AND c.is_active
                      AND c.tenant_id = pp.tenant_id
                      AND (pp.category_id IS NULL OR c.category_id = pp.category_id)
        WHERE ps.parent_id = pp.parent_id
          -- day_of_week is an enum (monday..sunday, ISODOW order); match by
          -- ISO weekday, locale-independent — no to_char, no client clock.
          AND c.day_of_week::text = (ARRAY['monday','tuesday','wednesday',
                'thursday','friday','saturday','sunday'])[
                EXTRACT(ISODOW FROM h.holiday_date)::int]
      );

    v_weeks := COALESCE(v_weeks, 0);

    -- ⚠ RISK 4 idempotent: only write when the count actually moved.
    IF v_weeks <> pp.ph_extension_weeks THEN
      INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
      VALUES (
        pp.id, 'holiday', (v_weeks - pp.ph_extension_weeks) * 7,
        CASE WHEN v_weeks > 0
             THEN 'Public holidays (' || v_weeks || ' week' ||
                  CASE WHEN v_weeks = 1 THEN '' ELSE 's' END || '): ' || v_reason
             ELSE 'Public-holiday extension removed' END,
        -- ⚠ #7: the admin whose import/edit triggered this (NULL for the
        -- nightly/engine service path, which distinguishes it).
        auth.uid()
      );

      UPDATE parent_packages SET
        ph_extension_weeks  = v_weeks,
        -- ⚠ RISK 4 shrink clamps the ack high-water so a re-bump re-alerts.
        ph_ack_weeks_parent = LEAST(ph_ack_weeks_parent, v_weeks),
        ph_ack_weeks_admin  = LEAST(ph_ack_weeks_admin, v_weeks),
        expires_on = package_effective_end(start_date, validity_weeks,
                                           v_weeks, manual_extension_days)
      WHERE id = pp.id;

      v_changed := v_changed + 1;
    END IF;
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION recompute_package_extensions(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION recompute_package_extensions(uuid, uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Acknowledge — clear the loud state, per role, on one package or all.
-- ------------------------------------------------------------

-- One package, on ONE surface. p_as names which ack to move ('parent' or
-- 'admin'), validated against the caller's actual relationship — so a user who
-- is BOTH an admin and the owning parent (a tenant-of-one coach with their own
-- child, ⚠ #5) acks the surface they are actually looking at, and the other
-- surface's badge is untouched. p_as NULL keeps the old best-effort behaviour
-- (admin wins) for any un-migrated caller.
CREATE OR REPLACE FUNCTION acknowledge_package_extension(
  p_package_id uuid,
  p_as         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent BOOLEAN;
  v_admin  BOOLEAN;
  v_tenant UUID;
  v_owner  UUID;
BEGIN
  IF p_as IS NOT NULL AND p_as NOT IN ('parent', 'admin') THEN
    RAISE EXCEPTION 'p_as must be parent or admin.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT tenant_id, parent_id INTO v_tenant, v_owner
  FROM parent_packages WHERE id = p_package_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Unknown package.' USING ERRCODE = 'no_data_found';
  END IF;

  v_admin  := can_admin_tenant(v_tenant);
  v_parent := (v_owner = current_parent_id());

  IF p_as = 'parent' OR (p_as IS NULL AND v_parent AND NOT v_admin) THEN
    IF NOT v_parent THEN
      RAISE EXCEPTION 'Not the owning parent of this package.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE parent_packages SET ph_ack_weeks_parent = ph_extension_weeks
    WHERE id = p_package_id;
  ELSIF p_as = 'admin' OR (p_as IS NULL AND v_admin) THEN
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Not an admin of this package''s business.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE parent_packages SET ph_ack_weeks_admin = ph_extension_weeks
    WHERE id = p_package_id;
  ELSE
    RAISE EXCEPTION 'Not authorized to acknowledge this package.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION acknowledge_package_extension(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION acknowledge_package_extension(uuid, text)
  TO authenticated, service_role;

-- All of a tenant's packages — admin only, scoped by the WHERE, never a
-- client-supplied tenant id.
CREATE OR REPLACE FUNCTION acknowledge_all_extensions(p_tenant uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  IF NOT can_admin_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE parent_packages
     SET ph_ack_weeks_admin = ph_extension_weeks
   WHERE tenant_id = p_tenant
     AND status = 'active'
     AND ph_ack_weeks_admin < ph_extension_weeks;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION acknowledge_all_extensions(uuid) FROM public;
GRANT EXECUTE ON FUNCTION acknowledge_all_extensions(uuid)
  TO authenticated, service_role;

COMMENT ON TABLE package_extension_events IS
  'Append-only audit of package validity extensions (holiday recompute + '
  'manual). Client-readable, DEFINER-written. PACKAGE_WEEKS_HOLIDAYS_PLAN.md.';
