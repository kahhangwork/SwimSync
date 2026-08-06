-- ============================================================
-- CO-ADMINS: the business owner can invite, deactivate and delete
-- additional tenant_admin accounts. (§8.31, plan: co-admin management)
--
-- THE MODEL. Owner and co-admins share ONE role, `tenant_admin` — a second
-- enum value cannot enforce one-owner-per-tenant, is permanent once added, and
-- forks every `role = 'tenant_admin'` check in ~25 files. Ownership is DATA:
--   tenants.owner_profile_id  — the "main tenant admin" / tenant superadmin.
-- The first tenant_admin created for a tenant claims ownership (see the
-- handle_new_user change below); admin management RPCs are owner-gated; the
-- owner can never be deactivated or deleted. This supersedes the BACKLOG
-- `tenant_members` join-table sketch — a join table buys nothing while all
-- admins hold identical authorization, and a future permissions split can
-- still add one additively.
--
-- DEACTIVATION suspends ADMIN AUTHORITY ONLY: profiles.admin_disabled_at is
-- checked inside is_tenant_admin(), the choke point every admin policy calls.
-- Coach access is untouched — it derives from the `coaches` row via
-- current_coach_id() (20260309000600), not from the role; production's private
-- coach (role tenant_admin + coaches row) proves that shape daily. So a
-- deactivated admin-who-coaches keeps teaching, and a deactivated pure admin
-- is additionally BANNED at the auth layer by the API route (the ban is
-- auth-level state; it cannot live in this migration).
--
-- KNOWN, DELIBERATE LIMITATION — deactivation does not cut membership reads.
-- Five read policies key on current_tenant_id() rather than is_tenant_admin()
-- (tenants_select, coaches_select, profiles_select, parent_tenants_select,
-- parent_tenant_balances_select — 20260718000900), and a Supabase ban blocks
-- token REFRESH, not the live access token. A deactivated pure admin therefore
-- keeps those staff-baseline reads (including family balances) for at most one
-- token lifetime. Pinned deliberately in admin_management.test.sql. Widening
-- those clauses would break the coach app; if that residue ever matters, scope
-- them consciously in their own migration — do not "fix" it here.
--
-- ESCALATION GUARDS, and why they must exist NOW. profiles_update lets any
-- tenant_admin UPDATE any profile in their tenant — including `role`. With one
-- admin per tenant that was moot; with two, it is a co-admin promoting
-- themselves to platform_admin or re-enabling their own suspension. The BEFORE
-- UPDATE triggers below pin role / tenant_id / admin_disabled_at (and
-- tenants.owner_profile_id) against CLIENT writes while letting the SECURITY
-- DEFINER RPCs through.
--
--   !! THE GUARD TRIGGER FUNCTIONS MUST NOT BE SECURITY DEFINER (§7.38): a
--   definer guard sees current_user = 'postgres' for EVERY caller and waves
--   everyone through. They are invoker functions on purpose. Conversely,
--   handle_new_user MUST STAY SECURITY DEFINER — that is the only reason its
--   owner-claim UPDATE below passes the tenants guard (current_user inside a
--   definer function is its owner, postgres).
--
-- THE DELETE STORY (pure admins only). Deleting an admin who has recorded
-- work would orphan FK references (attendance.marked_by, students.created_by,
-- …), so prepare_admin_delete() refuses unless the profile is unreferenced.
-- The reference list is DERIVED FROM pg_constraint AT RUNTIME, not hardcoded —
-- a static cascade list is a stale copy (§7.46; the first draft of this
-- migration named three columns that do not exist and missed two that do).
-- The target's audit_log rows are purged (actor_id is a NOT NULL FK with no
-- cascade) — that is the warned-about, deliberate cost the admin confirms in
-- the UI. An admin-who-coaches is never hard-deleted: remove_admin_role()
-- demotes them to `coach`, keeping profile, coaches row and audit history.
-- ============================================================

-- ── 1. Columns ────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN admin_disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.admin_disabled_at IS
  'When set, this tenant_admin''s ADMIN authority is suspended: is_tenant_admin() '
  'returns false, so every admin policy refuses them. Coach access (coaches row) '
  'is deliberately untouched. Written only by deactivate_admin()/'
  'reactivate_admin() — a client UPDATE is refused by guard_profiles_privileges.';

-- ON DELETE SET NULL is REQUIRED, not a nicety: fixture teardowns delete a
-- tenant''s admin profiles BEFORE the tenant (fixtures-payment-collection-
-- teardown.sql deletes profiles at its step 3, tenants at step 5). With the
-- default NO ACTION every such teardown would abort against the owner
-- reference and leave the SHARED local database dirty (§7.55).
ALTER TABLE tenants ADD COLUMN owner_profile_id UUID
  REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN tenants.owner_profile_id IS
  'The business''s MAIN tenant admin (the "tenant superadmin"). Claimed by the '
  'first tenant_admin created for the tenant (handle_new_user); only this '
  'profile may manage co-admin accounts, and it can never be deactivated or '
  'deleted by them. Client UPDATEs are refused by guard_tenants_owner — there '
  'is deliberately no transfer path yet (BACKLOG: owner transfer).';

-- ── 2. Backfill ───────────────────────────────────────────────────────────────
-- Each tenant''s owner = its earliest-created tenant_admin — exactly who
-- platform_tenant_overview() and the resend-invite route already treated as
-- "the" admin, so this changes no observable behaviour for existing tenants.

UPDATE tenants t
   SET owner_profile_id = (
     SELECT p.id FROM profiles p
      WHERE p.tenant_id = t.id AND p.role = 'tenant_admin'
      ORDER BY p.created_at LIMIT 1)
 WHERE t.owner_profile_id IS NULL;

-- ── 3. is_tenant_admin(): deactivation bites every admin policy at once ───────
-- Body from 20260718000900:59-67 plus the admin_disabled_at clause. Still
-- deliberately NOT true for the platform admin (see the original's comment).

CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'tenant_admin'
      AND tenant_id = p_tenant_id
      AND admin_disabled_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_tenant_admin(UUID) IS
  'Is the caller an ACTIVE admin of this tenant? Deliberately not true for the '
  'platform admin (sites spell that out via can_admin_tenant), and false while '
  'admin_disabled_at is set — deactivation suspends every admin policy through '
  'this one clause (20260806000100).';

-- ── 4. is_tenant_owner(): the management gate ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_tenant_admin(p_tenant_id) AND EXISTS (
    SELECT 1 FROM tenants
    WHERE id = p_tenant_id AND owner_profile_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_tenant_owner(p_tenant_id UUID) IS
  'Is the caller this tenant''s OWNER (main admin)? Gates the co-admin '
  'management RPCs. Composes is_tenant_admin, so a (hypothetically) suspended '
  'owner is not an owner either.';

REVOKE ALL ON FUNCTION public.is_tenant_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_owner(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner(UUID) TO authenticated;

-- ── 5. handle_new_user: the first tenant_admin claims ownership ───────────────
-- Full body from 20260718000700 (§7.40: redefinitions carry regressions — the
-- ONLY change is the guarded ownership claim after the profiles INSERT).
-- MUST STAY SECURITY DEFINER: the owner-claim UPDATE passes guard_tenants_owner
-- only because current_user inside a definer function is postgres.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     user_role;
  v_tenant   UUID;
  v_is_coach BOOLEAN;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent');
  v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
  v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id) VALUES (NEW.id);
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    -- A private coach: administers the business and teaches in it.
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  -- The FIRST admin of a tenant is its owner. Guarded: a co-admin invited
  -- later finds owner_profile_id already set and changes nothing, and a parent
  -- or platform_admin (v_tenant NULL / role mismatch) never reaches this.
  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 6. Escalation guards ──────────────────────────────────────────────────────
-- INVOKER functions, NOT SECURITY DEFINER (§7.38 — a definer guard passes
-- everyone). PostgREST PATCHes send only the changed columns, so ordinary
-- name/phone edits sail through the IS DISTINCT FROM checks untouched.

CREATE OR REPLACE FUNCTION public.guard_profiles_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND (
       OLD.role              IS DISTINCT FROM NEW.role
    OR OLD.tenant_id         IS DISTINCT FROM NEW.tenant_id
    OR OLD.admin_disabled_at IS DISTINCT FROM NEW.admin_disabled_at
  ) THEN
    RAISE EXCEPTION
      'profiles.role / tenant_id / admin_disabled_at cannot be changed directly '
      '— use the admin-management RPCs (20260806000100)';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profiles_privileges() IS
  'BEFORE UPDATE on profiles: pins role, tenant_id and admin_disabled_at '
  'against client writes. profiles_update permits any tenant_admin to UPDATE '
  'any tenant profile, which with co-admins would be an escalation path. '
  'Invoker function ON PURPOSE — a SECURITY DEFINER guard checks postgres, not '
  'the caller (§7.38).';

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_privileges();

CREATE OR REPLACE FUNCTION public.guard_tenants_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND OLD.owner_profile_id IS DISTINCT FROM NEW.owner_profile_id THEN
    RAISE EXCEPTION
      'tenants.owner_profile_id cannot be changed by a client — there is no '
      'owner-transfer path yet (20260806000100)';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_tenants_owner() IS
  'BEFORE UPDATE on tenants: tenants_update lets any tenant_admin write any '
  'column, so without this a co-admin could reassign ownership to themselves. '
  'Invoker function on purpose (§7.38).';

DROP TRIGGER IF EXISTS tenants_guard_owner ON public.tenants;
CREATE TRIGGER tenants_guard_owner
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenants_owner();

-- ── 7. audit_log_tenant_of: the RPCs below write entity_type 'Profile' ────────
-- Full body from 20260804000300 plus the one new WHEN arm. Without it the
-- first admin-management audit row RAISES (that ELSE is deliberate — §7.37).

CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      -- Admin-management rows (20260806000100). The subject profile still
      -- exists at insert time even on the delete path — prepare_admin_delete
      -- writes its audit row before auth.users cascades the profile away.
      SELECT p.tenant_id INTO v_tenant FROM profiles p WHERE p.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      -- Deliberately NULL. entity_id is the parent, and a parent may belong to
      -- more than one business, so there is nothing to derive. The caller keeps
      -- its own value; see the trigger.
      v_tenant := NULL;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$$;

-- ── 8. The reference map for hard deletes ─────────────────────────────────────
-- Which (table, column) pairs point at a profile — derived from pg_constraint
-- so a future REFERENCES profiles(id) column is covered the day it is added
-- (§7.46: a hardcoded cascade list is a stale copy). Exclusions are exactly:
--   parents/coaches.profile_id — ON DELETE CASCADE, and the no-coaches-row
--                                gate already excludes coach-admins;
--   audit_log.actor_id         — purged by prepare_admin_delete itself.

CREATE OR REPLACE FUNCTION public.profile_reference_columns()
RETURNS TABLE (ref_table regclass, ref_column name)
LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT c.conrelid::regclass, a.attname
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS ck(attnum) ON TRUE
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
  WHERE c.contype = 'f'
    AND c.confrelid = 'public.profiles'::regclass
    AND NOT (c.conrelid = 'public.parents'::regclass  AND a.attname = 'profile_id')
    AND NOT (c.conrelid = 'public.coaches'::regclass  AND a.attname = 'profile_id')
    AND NOT (c.conrelid = 'public.audit_log'::regclass AND a.attname = 'actor_id');
$$;

COMMENT ON FUNCTION public.profile_reference_columns() IS
  'Every FK column that references profiles(id), minus the three '
  'prepare_admin_delete handles itself. Catalogue-derived so it can never go '
  'stale; admin_management.test.sql pins that it sees students.created_by and '
  'payment_records.marked_by.';

REVOKE ALL ON FUNCTION public.profile_reference_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_reference_columns() FROM anon;

-- ── 9. The management RPCs ────────────────────────────────────────────────────
-- All SECURITY DEFINER (they change columns the guard triggers pin), all gated
-- on is_tenant_owner() as their first act, all scoped to the caller''s tenant.
-- deactivate/reactivate are IDEMPOTENT — success as a no-op when the target is
-- already in the requested state — because the API route pairs each with a
-- non-atomic auth ban/unban, and the owner''s RETRY is the recovery path when
-- that second half fails. A refusal here would strand the pair half-applied.

CREATE OR REPLACE FUNCTION public.deactivate_admin(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot be deactivated';
  END IF;

  IF v_target.admin_disabled_at IS NOT NULL THEN
    RETURN; -- idempotent: already deactivated, nothing to do, no audit row
  END IF;

  UPDATE profiles SET admin_disabled_at = NOW() WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_deactivated', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$$;

COMMENT ON FUNCTION public.deactivate_admin(UUID) IS
  'Owner-only: suspend a co-admin''s admin authority (admin_disabled_at). '
  'Idempotent. Coach access untouched; the API route additionally bans PURE '
  'admins at the auth layer. The owner cannot be a target.';

REVOKE ALL ON FUNCTION public.deactivate_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_admin(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_admin(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF v_target.admin_disabled_at IS NULL THEN
    RETURN; -- idempotent: already active
  END IF;

  UPDATE profiles SET admin_disabled_at = NULL WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_reactivated', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$$;

COMMENT ON FUNCTION public.reactivate_admin(UUID) IS
  'Owner-only: restore a deactivated co-admin. Idempotent. The API route '
  'additionally unbans pure admins.';

REVOKE ALL ON FUNCTION public.reactivate_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_admin(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_admin_role(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot remove their own admin role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM coaches WHERE profile_id = p_profile_id) THEN
    RAISE EXCEPTION
      'this admin is not a coach — a pure admin account is deleted, not demoted';
  END IF;

  UPDATE profiles SET role = 'coach', admin_disabled_at = NULL
   WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_role_removed', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$$;

COMMENT ON FUNCTION public.remove_admin_role(UUID) IS
  'Owner-only "delete" for an admin who is ALSO a coach: demote to coach. '
  'Profile, coaches row and audit history all survive — only the admin '
  'authority is removed, permanently. Pure admins go through '
  'prepare_admin_delete instead.';

REVOKE ALL ON FUNCTION public.remove_admin_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_admin_role(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_admin_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_admin_delete(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
  r        RECORD;
  v_hit    BOOLEAN;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot be deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM coaches WHERE profile_id = p_profile_id) THEN
    RAISE EXCEPTION
      'this admin is also a coach — remove their admin role instead of deleting';
  END IF;

  -- Catalogue-derived reference check (§7.46). Any surviving reference makes
  -- the eventual auth.users → profiles cascade fail anyway; refusing here, by
  -- name, is the honest version of that failure.
  FOR r IN SELECT ref_table, ref_column FROM profile_reference_columns() LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
                   r.ref_table, r.ref_column)
      INTO v_hit USING p_profile_id;
    IF v_hit THEN
      RAISE EXCEPTION
        'this admin has recorded activity (%.%) — deactivate them instead of deleting',
        r.ref_table, r.ref_column;
    END IF;
  END LOOP;

  -- The deletion audit row FIRST, while the subject profile still exists
  -- (audit_log_tenant_of derives the tenant from it), attributed to the OWNER,
  -- who survives. THEN the purge the UI warned about: actor_id is a NOT NULL
  -- FK with no cascade, so the target''s own rows cannot outlive them.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_deleted', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant, 'email', v_target.email,
                             'full_name', v_target.full_name));

  DELETE FROM audit_log WHERE actor_id = p_profile_id;

  -- The profile row itself is NOT deleted here: the API route calls
  -- auth.admin.deleteUser, and auth.users → profiles cascades. Route order is
  -- ban → this RPC → deleteUser, so the target cannot write fresh audit rows
  -- into the window between the purge and the cascade.
END;
$$;

COMMENT ON FUNCTION public.prepare_admin_delete(UUID) IS
  'Owner-only, PURE admins only: everything a hard delete needs from the '
  'database — refuse if any FK still references the profile (catalogue-derived '
  'list), write the deletion audit row (actor = owner), purge the target''s '
  'audit rows. The API route then deletes the auth user, which cascades the '
  'profile. Never call for an admin with a coaches row.';

REVOKE ALL ON FUNCTION public.prepare_admin_delete(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_admin_delete(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_admin_delete(UUID) TO authenticated;

-- ── 10. platform_tenant_overview: report the OWNER, not the oldest admin ──────
-- Body taken from pg_get_functiondef() against the live database (§7.40), not
-- from the migration file. CREATE OR REPLACE, never DROP — the signature is
-- unchanged and a DROP would shed the post-20260804000200 grant state.
-- The ONLY change: admin_email / admin_status read tenants.owner_profile_id
-- instead of ORDER BY created_at LIMIT 1 (identical output post-backfill).
-- NOTE, unchanged on purpose: a co-admin invited with is_coach = true flips
-- `shape` from 'private coach' to 'school' — one business, two coaches IS a
-- school (pinned by platform_overview.test.sql).

CREATE OR REPLACE FUNCTION public.platform_tenant_overview()
RETURNS TABLE(tenant_id uuid, display_name text, shape text, join_code text, active_students integer, active_classes integer, coaches integer, staff_without_rate integer, last_attendance_date date, sessions_this_month integer, sessions_fully_marked integer, last_month_billing text, active_families integer, admin_email text, admin_status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT is_platform_admin() AS ok),
  bounds AS (
    SELECT
      to_char((date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month'), 'YYYY-MM') AS last_month,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))::date AS this_month_start,
      (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) + INTERVAL '1 month')::date AS next_month_start
  )
  SELECT
    t.id,
    t.display_name,
    CASE
      WHEN (SELECT COUNT(*) FROM coaches co WHERE co.tenant_id = t.id) = 1
       AND EXISTS (
             SELECT 1 FROM coaches co
             JOIN profiles pr ON pr.id = co.profile_id
             WHERE co.tenant_id = t.id
               AND pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
        THEN 'private coach'
      ELSE 'school'
    END,
    t.join_code,
    (SELECT COUNT(*)::INT FROM students s
       WHERE s.tenant_id = t.id AND s.is_active),
    (SELECT COUNT(*)::INT FROM classes c
       WHERE c.tenant_id = t.id AND c.is_active),
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM coaches co
       JOIN profiles pr ON pr.id = co.profile_id
       WHERE co.tenant_id = t.id
         AND NOT (pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)),
    (SELECT MAX(ls.session_date) FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)
         AND (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id)
             >= (SELECT COUNT(*) FROM student_class_enrolments e
                   WHERE e.class_id = ls.class_id AND e.is_active)
         AND (SELECT COUNT(*) FROM student_class_enrolments e
                WHERE e.class_id = ls.class_id AND e.is_active) > 0),
    CASE
      WHEN EXISTS (SELECT 1 FROM billing_periods bp
                     WHERE bp.tenant_id = t.id
                       AND bp.billing_month = (SELECT last_month FROM bounds))
        THEN 'sealed'
      WHEN EXISTS (SELECT 1 FROM invoices i
                     WHERE i.tenant_id = t.id
                       AND i.billing_month = (SELECT last_month FROM bounds))
        THEN 'open'
      ELSE 'never run'
    END,
    (SELECT COUNT(*)::INT FROM parent_tenants pt
       WHERE pt.tenant_id = t.id AND pt.is_active),
    (SELECT pr.email FROM profiles pr WHERE pr.id = t.owner_profile_id),
    COALESCE((
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM profiles pr
      JOIN auth.users u ON u.id = pr.id
      WHERE pr.id = t.owner_profile_id
    ), 'none')
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$$;
