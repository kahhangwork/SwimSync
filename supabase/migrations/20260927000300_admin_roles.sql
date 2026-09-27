-- ============================================================
-- EXPAND (dormant): owner-defined ROLES for co-admins — Roles & permissions
-- migration A (docs/plans/ROLES_PERMISSIONS_PLAN.md §5.1, §5.2, §5.4;
-- enforcement map: docs/plans/ROLES_ENFORCEMENT_MAP.md).
--
-- A role is a named grid of 8 AREAS × none / view / edit. Every non-owner
-- tenant_admin holds exactly one; the owner holds none and passes every check
-- (D1). NOTHING READS THIS YET: no policy or RPC is re-pointed until
-- migrations B–D, so behaviour is identical after this migration for every
-- account. Existing co-admins land on "Co-admin (as before)" — exactly
-- today's authority (P1).
--
-- 8 areas, not the draft's 11: attendance / students / classes / coaches read
-- each other's tables, so the user merged them into `operations` (step 0,
-- 2026-09-27). Consequence enforced here: a role with ANY area above none must
-- hold operations >= view (money pages show child and class names too).
--
-- What this adds:
--   * enums admin_area, admin_level ('none' < 'view' < 'edit' — ordered, so
--     `>=` compares levels)
--   * tenant_roles (+ standard_key for the four seeded roles, so renaming
--     one never breaks the code paths that look it up)
--   * tenant_role_permissions — ALL 8 rows per role, always; written only by
--     set_role_grid(), which refuses a partial or invalid grid
--   * profiles.admin_role_id — kept NULL for anyone not tenant_admin (BEFORE
--     trigger), tenant-matched, not client-writable (guard_profiles_privileges),
--     and REQUIRED for a non-owner tenant_admin at COMMIT (deferred constraint
--     triggers on profiles and on tenants.owner_profile_id — deferred because
--     handle_new_user decides ownership after inserting the profile)
--   * the four standard roles, seeded for every tenant now and by an AFTER
--     INSERT trigger on tenants (covers provision_tenant and every test)
--   * has_admin_area(tenant, area, level) — the one gate migrations B–D will
--     call; my_admin_permissions(tenant) — what the admin app will read
--   * owner-only role CRUD (D9), assign_admin_role with the escalation guard
--     (§5.4), all audited (P10)
--   * handle_new_user: a new co-admin's role comes from the invitation row
--     (staff_invitations.admin_role_id, 20260927000200) or, until the invite
--     form picks one (step 6), falls back to "Co-admin (as before)"
--   * platform_reassign_owner: the outgoing owner becomes a co-admin on Full
--     admin (P6) — brought forward from step 4 because the "every co-admin
--     holds a role" check would otherwise refuse the transfer
--
-- Grants (§7.87): SELECT on both tables to authenticated (policies below) and
-- service_role; EXECUTE on has_admin_area / my_admin_permissions / the RPCs to
-- authenticated + service_role; helpers and trigger functions to nobody.
-- After deploy, dump the REMOTE grants (§7.39):
--   supabase db dump --linked --schema public -f /tmp/d.sql
--   grep -iE 'tenant_role|admin_role|has_admin_area|my_admin_permissions|role_is_within|set_role_grid|seed_standard_roles' /tmp/d.sql | grep -i '"anon"'
--   # must print nothing
--
-- Rollback: supabase/rollback/20260927000300_admin_roles_DOWN.sql
-- ============================================================

CREATE TYPE public.admin_area AS ENUM
  ('operations', 'profile', 'admins', 'pricing', 'billing', 'packages', 'wages', 'accounting');
CREATE TYPE public.admin_level AS ENUM ('none', 'view', 'edit');

CREATE TABLE public.tenant_roles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  standard_key TEXT        NULL CHECK (standard_key IN
                 ('full_admin', 'operations_assistant', 'front_desk', 'co_admin_as_before')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No created_by: a second FK to profiles (beside profiles.admin_role_id)
  -- would make every PostgREST embed between the two ambiguous (§7.90).
  -- Who created a role is in audit_log ('role_created').
);
CREATE UNIQUE INDEX tenant_roles_name_uq     ON public.tenant_roles (tenant_id, lower(btrim(name)));
CREATE UNIQUE INDEX tenant_roles_standard_uq ON public.tenant_roles (tenant_id, standard_key)
  WHERE standard_key IS NOT NULL;

CREATE TABLE public.tenant_role_permissions (
  role_id UUID        NOT NULL REFERENCES public.tenant_roles(id) ON DELETE CASCADE,
  area    admin_area  NOT NULL,
  level   admin_level NOT NULL,
  PRIMARY KEY (role_id, area)
);

COMMENT ON TABLE public.tenant_roles IS
  'Owner-defined co-admin roles (ROLES_PERMISSIONS_PLAN.md). standard_key marks the four seeded ones. Written only through the role RPCs. 20260927000300.';
COMMENT ON TABLE public.tenant_role_permissions IS
  'A role''s grid: exactly one row per admin_area, always all 8. Written only by set_role_grid(). 20260927000300.';

ALTER TABLE public.profiles
  ADD COLUMN admin_role_id UUID NULL REFERENCES public.tenant_roles(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.profiles.admin_role_id IS
  'The co-admin''s role. NULL for the owner (who passes everything) and for every non-tenant_admin. Required for a non-owner tenant_admin (checked at commit). 20260927000300.';

ALTER TABLE public.staff_invitations
  ADD COLUMN admin_role_id UUID NULL REFERENCES public.tenant_roles(id) ON DELETE CASCADE;

-- ── RLS + grants on the new tables ──────────────────────────────────────────
ALTER TABLE public.tenant_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_permissions ENABLE ROW LEVEL SECURITY;

-- Any active admin of the business reads its roles: a co-admin must see the
-- grid of the roles they may assign (§5.1). No write policy — RPCs only.
CREATE POLICY tenant_roles_select ON public.tenant_roles
  FOR SELECT TO authenticated USING (is_tenant_admin(tenant_id));
CREATE POLICY tenant_role_permissions_select ON public.tenant_role_permissions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM tenant_roles r WHERE r.id = role_id AND is_tenant_admin(r.tenant_id)));

REVOKE ALL ON public.tenant_roles, public.tenant_role_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_roles, public.tenant_role_permissions TO authenticated, service_role;

-- ── Grid helpers (callable by nobody; used inside definer functions) ────────
-- Replaces a role's whole grid. p_grid: {"operations":"edit","profile":"none",…}
-- with EXACTLY the 8 area keys. Refuses anything partial, unknown or invalid,
-- and the invariant: any area above none ⇒ operations >= view.
CREATE OR REPLACE FUNCTION public.set_role_grid(p_role_id UUID, p_grid JSONB)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_area  admin_area;
  v_level admin_level;
  v_any   BOOLEAN := FALSE;
  v_ops   admin_level;
BEGIN
  IF p_grid IS NULL OR jsonb_typeof(p_grid) <> 'object' THEN
    RAISE EXCEPTION 'a role grid must be an object of area → level' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_grid) k
       WHERE k NOT IN (SELECT unnest(enum_range(NULL::admin_area))::text)) > 0 THEN
    RAISE EXCEPTION 'unknown area in role grid: %',
      (SELECT string_agg(k, ', ') FROM jsonb_object_keys(p_grid) k
        WHERE k NOT IN (SELECT unnest(enum_range(NULL::admin_area))::text))
      USING ERRCODE = 'check_violation';
  END IF;

  FOREACH v_area IN ARRAY enum_range(NULL::admin_area) LOOP
    IF NOT (p_grid ? v_area::text) THEN
      RAISE EXCEPTION 'role grid is missing the % area — every role sets all 8', v_area
        USING ERRCODE = 'check_violation';
    END IF;
    BEGIN
      v_level := (p_grid->>v_area::text)::admin_level;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid level "%" for % — use none, view or edit', p_grid->>v_area::text, v_area
        USING ERRCODE = 'check_violation';
    END;
    IF v_area = 'operations' THEN v_ops := v_level;
    ELSIF v_level > 'none' THEN v_any := TRUE;
    END IF;
  END LOOP;

  IF v_any AND v_ops = 'none' THEN
    RAISE EXCEPTION 'a role with any access needs Operations at least View — every page shows student and class names'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM tenant_role_permissions WHERE role_id = p_role_id;
  INSERT INTO tenant_role_permissions (role_id, area, level)
  SELECT p_role_id, a, (p_grid->>a::text)::admin_level
    FROM unnest(enum_range(NULL::admin_area)) a;
END;
$$;

-- Every area level of p_role is <= p_ref's. The escalation guard (§5.4).
CREATE OR REPLACE FUNCTION public.role_is_within(p_role UUID, p_ref UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT p_role IS NOT NULL AND p_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM tenant_role_permissions a
      JOIN tenant_role_permissions b ON b.role_id = p_ref AND b.area = a.area
     WHERE a.role_id = p_role AND a.level > b.level);
$$;

-- The four standard roles for one business (D5, P1). Idempotent per key.
CREATE OR REPLACE FUNCTION public.seed_standard_roles(p_tenant UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r RECORD;
  v_id UUID;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('full_admin', 'Full admin',
     '{"operations":"edit","profile":"edit","admins":"edit","pricing":"edit","billing":"edit","packages":"edit","wages":"edit","accounting":"edit"}'),
    ('operations_assistant', 'Operations assistant',
     '{"operations":"edit","profile":"edit","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}'),
    ('front_desk', 'Front desk',
     '{"operations":"edit","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}'),
    ('co_admin_as_before', 'Co-admin (as before)',
     '{"operations":"edit","profile":"edit","admins":"none","pricing":"edit","billing":"edit","packages":"edit","wages":"edit","accounting":"none"}')
  ) AS t(key, name, grid)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_id = p_tenant AND standard_key = r.key) THEN
      INSERT INTO tenant_roles (tenant_id, name, standard_key)
      VALUES (p_tenant, r.name, r.key) RETURNING id INTO v_id;
      PERFORM set_role_grid(v_id, r.grid::jsonb);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.set_role_grid(UUID, JSONB)   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.role_is_within(UUID, UUID)   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seed_standard_roles(UUID)    FROM PUBLIC, anon, authenticated, service_role;

-- New businesses get their roles the moment they exist.
CREATE OR REPLACE FUNCTION public.seed_roles_for_new_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM seed_standard_roles(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_roles_for_new_tenant() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_seed_roles_for_new_tenant
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_roles_for_new_tenant();

-- ── Seed every existing business; existing co-admins keep today's authority ─
SELECT seed_standard_roles(id) FROM tenants;

UPDATE profiles p
   SET admin_role_id = r.id
  FROM tenant_roles r, tenants t
 WHERE p.role = 'tenant_admin'
   AND t.id = p.tenant_id
   AND p.id IS DISTINCT FROM t.owner_profile_id
   AND r.tenant_id = p.tenant_id
   AND r.standard_key = 'co_admin_as_before';

-- ── profiles.admin_role_id: shape, tenant match, not client-writable ────────
CREATE OR REPLACE FUNCTION public.profiles_admin_role_shape()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'tenant_admin' THEN
    NEW.admin_role_id := NULL;          -- remove_admin_role (→ coach) drops the role
  ELSIF NEW.admin_role_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM tenant_roles WHERE id = NEW.admin_role_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that role belongs to a different business' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_admin_role_shape() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_profiles_admin_role_shape
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_admin_role_shape();

-- Body read from the database 2026-09-27 (§7.40); gains admin_role_id.
CREATE OR REPLACE FUNCTION public.guard_profiles_privileges()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_user = 'authenticated' AND (
       OLD.role              IS DISTINCT FROM NEW.role
    OR OLD.tenant_id         IS DISTINCT FROM NEW.tenant_id
    OR OLD.admin_disabled_at IS DISTINCT FROM NEW.admin_disabled_at
    OR OLD.admin_role_id     IS DISTINCT FROM NEW.admin_role_id
  ) THEN
    RAISE EXCEPTION
      'profiles.role / tenant_id / admin_disabled_at / admin_role_id cannot be changed directly '
      '— use the admin-management RPCs (20260806000100, 20260927000300)';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── "Every co-admin holds a role", checked at COMMIT ────────────────────────
CREATE OR REPLACE FUNCTION public.check_admin_role_present()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile UUID;
BEGIN
  -- Two branches, not a CASE: PL/pgSQL resolves every field reference in an
  -- expression, so OLD.owner_profile_id inside a CASE fails on the profiles
  -- trigger (no such field) even when that arm is never taken.
  IF TG_TABLE_NAME = 'tenants' THEN
    v_profile := OLD.owner_profile_id;
  ELSE
    v_profile := NEW.id;
  END IF;
  IF v_profile IS NOT NULL AND EXISTS (
       SELECT 1 FROM profiles p
        WHERE p.id = v_profile
          AND p.role = 'tenant_admin'
          AND p.admin_role_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM tenants t
                           WHERE t.id = p.tenant_id AND t.owner_profile_id = p.id)) THEN
    RAISE EXCEPTION 'every co-admin must hold a role (profile %)', v_profile
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_admin_role_present() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER trg_profiles_admin_role_present
  AFTER INSERT OR UPDATE ON public.profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_admin_role_present();
CREATE CONSTRAINT TRIGGER trg_tenants_old_owner_role_present
  AFTER UPDATE OF owner_profile_id ON public.tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_admin_role_present();

-- ── The gate ────────────────────────────────────────────────────────────────
-- NOT is_tenant_admin → false (suspension + deactivation, one choke point;
-- also false for a platform admin — P7). Owner → true (D1). Else the role.
CREATE OR REPLACE FUNCTION public.has_admin_area(p_tenant UUID, p_area admin_area, p_level admin_level)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_tenant_admin(p_tenant) AND (
       EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND owner_profile_id = auth.uid())
    OR EXISTS (SELECT 1
                 FROM profiles pr
                 JOIN tenant_role_permissions rp ON rp.role_id = pr.admin_role_id
                WHERE pr.id = auth.uid() AND rp.area = p_area AND rp.level >= p_level));
$$;

CREATE OR REPLACE FUNCTION public.my_admin_permissions(p_tenant UUID)
RETURNS TABLE (area admin_area, level admin_level)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a, 'edit'::admin_level
    FROM unnest(enum_range(NULL::admin_area)) a
   WHERE is_tenant_admin(p_tenant)
     AND EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND owner_profile_id = auth.uid())
  UNION ALL
  SELECT rp.area, rp.level
    FROM profiles pr
    JOIN tenant_role_permissions rp ON rp.role_id = pr.admin_role_id
   WHERE pr.id = auth.uid()
     AND is_tenant_admin(p_tenant)
     AND pr.tenant_id = p_tenant
     AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND owner_profile_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.has_admin_area(UUID, admin_area, admin_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_admin_permissions(UUID)                     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_area(UUID, admin_area, admin_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_admin_permissions(UUID)                     TO authenticated, service_role;

-- ── Role CRUD — owner only (D9), audited (P10) ──────────────────────────────
-- audit_log derives each row's tenant by entity_type (20260804000300); it
-- learns TenantRole. Body read from the database 2026-09-27 (§7.40).
CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(p_entity_type text, p_entity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  CASE p_entity_type
    WHEN 'Student' THEN
      SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_entity_id;
    WHEN 'Class' THEN
      SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = p_entity_id;
    WHEN 'lesson_session' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_entity_id;
    WHEN 'Profile' THEN
      SELECT p.tenant_id INTO v_tenant FROM profiles p WHERE p.id = p_entity_id;
    WHEN 'Coach' THEN
      SELECT c.tenant_id INTO v_tenant FROM coaches c WHERE c.id = p_entity_id;
    WHEN 'credit_note' THEN
      -- ⟨ITEM 3⟩ void_credit_note() audits under this type. The note is UPDATEd,
      -- never deleted, so it exists at insert time; its own tenant_id is the row.
      SELECT cn.tenant_id INTO v_tenant FROM credit_notes cn WHERE cn.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      v_tenant := NULL;
    WHEN 'Tenant' THEN
      v_tenant := p_entity_id;
    WHEN 'TenantRole' THEN
      -- 20260927000300: role CRUD. delete_role audits BEFORE deleting, so
      -- the row still exists here.
      SELECT r.tenant_id INTO v_tenant FROM tenant_roles r WHERE r.id = p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_role(p_name TEXT, p_grid JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
  v_id     UUID;
BEGIN
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may create roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_id = v_tenant AND lower(btrim(name)) = lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'a role named "%" already exists', btrim(p_name) USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO tenant_roles (tenant_id, name)
  VALUES (v_tenant, btrim(p_name)) RETURNING id INTO v_id;
  PERFORM set_role_grid(v_id, p_grid);
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value, tenant_id)
  VALUES (auth.uid(), 'role_created', 'TenantRole', v_id,
          jsonb_build_object('name', btrim(p_name), 'grid', p_grid), v_tenant);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_role_permissions(p_role_id UUID, p_grid JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
  v_old    JSONB;
BEGIN
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may change roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM tenant_roles WHERE id = p_role_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such role in your business' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT jsonb_object_agg(area, level) INTO v_old FROM tenant_role_permissions WHERE role_id = p_role_id;
  PERFORM set_role_grid(p_role_id, p_grid);
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, tenant_id)
  VALUES (auth.uid(), 'role_permissions_updated', 'TenantRole', p_role_id, v_old, p_grid, v_tenant);
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_role(p_role_id UUID, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
  v_old    TEXT;
BEGIN
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may rename roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT name INTO v_old FROM tenant_roles WHERE id = p_role_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such role in your business' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_id = v_tenant AND id <> p_role_id
               AND lower(btrim(name)) = lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'a role named "%" already exists', btrim(p_name) USING ERRCODE = 'unique_violation';
  END IF;
  UPDATE tenant_roles SET name = btrim(p_name) WHERE id = p_role_id;
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, tenant_id)
  VALUES (auth.uid(), 'role_renamed', 'TenantRole', p_role_id,
          jsonb_build_object('name', v_old), jsonb_build_object('name', btrim(p_name)), v_tenant);
END;
$$;

-- P3: a role in use cannot be deleted — reassign its holders first.
CREATE OR REPLACE FUNCTION public.delete_role(p_role_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant  UUID := current_tenant_id();
  v_name    TEXT;
  v_holders INT;
BEGIN
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may delete roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT name INTO v_name FROM tenant_roles WHERE id = p_role_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such role in your business' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*) INTO v_holders FROM profiles WHERE admin_role_id = p_role_id;
  IF v_holders > 0 THEN
    RAISE EXCEPTION '"%" is held by % admin(s) — give them another role first', v_name, v_holders
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Audit FIRST: audit_log derives its tenant from the role row.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, tenant_id)
  VALUES (auth.uid(), 'role_deleted', 'TenantRole', p_role_id, jsonb_build_object('name', v_name), v_tenant);
  DELETE FROM tenant_roles WHERE id = p_role_id;
END;
$$;

-- §5.4: the owner may assign any role; a co-admin with admins:edit may assign
-- only a role no stronger than their own (to anyone, themselves included).
-- Nobody assigns a role to the owner — the owner holds none.
CREATE OR REPLACE FUNCTION public.assign_admin_role(p_profile_id UUID, p_role_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant   UUID := current_tenant_id();
  v_is_owner BOOLEAN := is_tenant_owner(current_tenant_id());
  v_old      UUID;
BEGIN
  IF NOT v_is_owner AND NOT has_admin_area(v_tenant, 'admins', 'edit') THEN
    RAISE EXCEPTION 'your role cannot manage admins' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT admin_role_id INTO v_old FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that person is not an admin of your business' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant AND owner_profile_id = p_profile_id) THEN
    RAISE EXCEPTION 'the owner holds no role — they can always do everything' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_roles WHERE id = p_role_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'no such role in your business' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_is_owner AND NOT role_is_within(
       p_role_id, (SELECT admin_role_id FROM profiles WHERE id = auth.uid())) THEN
    RAISE EXCEPTION 'you can only give a role that is no stronger than your own'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_role_id THEN
    RETURN;
  END IF;
  UPDATE profiles SET admin_role_id = p_role_id WHERE id = p_profile_id;
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, tenant_id)
  VALUES (auth.uid(), 'admin_role_assigned', 'Profile', p_profile_id,
          jsonb_build_object('admin_role_id', v_old), jsonb_build_object('admin_role_id', p_role_id), v_tenant);
END;
$$;

REVOKE ALL ON FUNCTION public.create_role(TEXT, JSONB)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_role_permissions(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_role(UUID, TEXT)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_role(UUID)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_admin_role(UUID, UUID)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_role(TEXT, JSONB)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_role_permissions(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_role(UUID, TEXT)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_role(UUID)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_admin_role(UUID, UUID)        TO authenticated, service_role;

-- ── handle_new_user: a new co-admin gets a role ─────────────────────────────
-- Body read from the database 2026-09-27 (§7.40) = 20260927000200's. Adds
-- v_admin_role: from the invitation row, or trusted metadata, else the
-- business's "Co-admin (as before)" (until the invite form picks — step 6).
-- The first admin of a business becomes its owner and holds no role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        user_role;
  v_tenant      UUID;
  v_is_coach    BOOLEAN;
  v_meta_role   TEXT := NULLIF(NEW.raw_user_meta_data->>'role', '');
  v_nonce       TEXT := NULLIF(NEW.raw_user_meta_data->>'invitation_nonce', '');
  v_inv         staff_invitations%ROWTYPE;
  v_admin_role  UUID;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN
    -- Direct SQL (seed, migrations, tests, fixtures): trusted, as before.
    v_role := COALESCE(v_meta_role::user_role, 'parent');
    v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
    v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);
    v_admin_role := NULLIF(NEW.raw_user_meta_data->>'admin_role_id', '')::UUID;
  ELSIF v_nonce IS NOT NULL THEN
    SELECT * INTO v_inv FROM staff_invitations
     WHERE nonce = v_nonce
       AND lower(email) = lower(NEW.email)
       AND consumed_at IS NULL
       AND expires_at > now()
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'this staff invitation is invalid, used or expired — ask the admin to send a new one'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE staff_invitations SET consumed_at = now(), consumed_by = NEW.id WHERE nonce = v_nonce;
    v_role := v_inv.role;
    v_tenant := v_inv.tenant_id;
    v_is_coach := v_inv.is_coach;
    v_admin_role := v_inv.admin_role_id;
  ELSIF v_meta_role IS NULL OR v_meta_role = 'parent' THEN
    v_role := 'parent';
    v_tenant := NULL;
    v_is_coach := FALSE;
  ELSE
    RAISE EXCEPTION 'staff accounts are created by invitation only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  IF v_role = 'tenant_admin' THEN
    IF EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant AND owner_profile_id IS NULL) THEN
      v_admin_role := NULL;                       -- becomes the owner below
    ELSIF v_admin_role IS NULL THEN
      SELECT id INTO v_admin_role FROM tenant_roles
       WHERE tenant_id = v_tenant AND standard_key = 'co_admin_as_before';
      IF v_admin_role IS NULL THEN
        RAISE EXCEPTION 'choose a role for the new admin — this business has no "Co-admin (as before)" role any more'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    v_admin_role := NULL;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id, admin_role_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END,
    v_admin_role
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id, signup_join_code)
    VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data->>'join_code', ''));
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── platform_reassign_owner: the outgoing owner keeps full authority (P6) ───
-- Body read from the database 2026-09-27 (§7.40); adds the block after the
-- ownership UPDATE. The incoming owner keeps whatever role they held — the
-- owner's role is never consulted (D1).
CREATE OR REPLACE FUNCTION public.platform_reassign_owner(p_tenant_id uuid, p_new_owner_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_owner UUID;
  v_target    profiles%ROWTYPE;
  v_full      UUID;
BEGIN
  -- THE GATE, first act. Platform admin only — decision 2: no self-service.
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may reassign a business''s owner';
  END IF;

  -- FOR UPDATE: serializes concurrent transfers of the same tenant, so the
  -- audit rows' old_value → new_value chain always replays to true history.
  -- Without it, two racing calls both record the original owner as old_value.
  SELECT owner_profile_id INTO v_old_owner
    FROM tenants WHERE id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such business';
  END IF;

  -- Idempotent: already the owner → nothing to do, no audit row. The API-less
  -- UI path retries freely (the deactivate_admin precedent, 20260806000100).
  IF v_old_owner = p_new_owner_profile_id THEN
    RETURN;
  END IF;

  -- The target must be a LIVE admin of THAT business. v_old_owner may be NULL
  -- (owner's auth account deleted → ON DELETE SET NULL) — that is the
  -- lost-owner case this RPC exists for, and it needs no special arm.
  SELECT * INTO v_target FROM profiles
   WHERE id = p_new_owner_profile_id
     AND role = 'tenant_admin'
     AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the new owner must be an admin of that business';
  END IF;
  IF v_target.admin_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION
      'that admin is deactivated — reactivate them before making them owner';
  END IF;

  -- Passes guard_tenants_owner: current_user is postgres inside a definer
  -- function (§7.38). This UPDATE is the entire transfer; everything downstream
  -- (overview, resend-invite) keys on the column.
  UPDATE tenants SET owner_profile_id = p_new_owner_profile_id
   WHERE id = p_tenant_id;

  -- P6 (20260927000300): the outgoing owner stays a co-admin on Full admin.
  IF v_old_owner IS NOT NULL THEN
    SELECT id INTO v_full FROM tenant_roles
     WHERE tenant_id = p_tenant_id AND standard_key = 'full_admin';
    IF v_full IS NULL THEN
      RAISE EXCEPTION 'this business has no "Full admin" role for the outgoing owner — recreate it first';
    END IF;
    UPDATE profiles SET admin_role_id = v_full
     WHERE id = v_old_owner AND role = 'tenant_admin' AND admin_role_id IS NULL;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'owner_reassigned', 'Tenant', p_tenant_id,
          jsonb_build_object('owner_profile_id', v_old_owner),
          jsonb_build_object('owner_profile_id', p_new_owner_profile_id));
END;
$function$;
