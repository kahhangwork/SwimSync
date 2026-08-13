-- ============================================================================
-- ROLLBACK for 20260813000400_audit_survives_admin_delete.sql
--
-- Restores the audit_log.actor_id exclusion and the purge — i.e. deleting an
-- admin destroys their audit history again. Run only if the refusal turns out
-- to strand something real; the trade it reverts to is the one BACKLOG.md
-- filed as a defect.
--
-- ⚠ BOTH BODIES BELOW ARE THE LIVE PRE-DEPLOY DEFINITIONS, taken from
-- `supabase db dump --linked` on 2026-08-13 (§7.40, §7.115) — NOT retyped from
-- 20260806000100, though they were verified byte-identical to it on that date.
-- If this file is ever run long after it was written, re-check that claim
-- first: `CREATE OR REPLACE` means the newest body can live in any later file.
--
-- ⚠ CREATE OR REPLACE, NEVER DROP. The signatures are unchanged and a DROP
-- would shed the grant state — for profile_reference_columns() it would hand
-- PUBLIC execute back. This file changes no grants; the live ACLs it must
-- preserve are prepare_admin_delete → {postgres, authenticated} and
-- profile_reference_columns → {postgres, service_role}.
--
-- ⚠ THE PURGE IS NOT REVERSIBLE. Rolling forward again is fine, but any audit
-- rows destroyed by a delete performed while this DOWN was in effect are gone.
-- ============================================================================


-- ── 1. audit_log.actor_id is exempt from the reference check again ───────────
-- The ORDER BY added by 20260813000400 goes with it: with audit_log excluded
-- there is no ambiguity for it to resolve.

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


-- ── 2. prepare_admin_delete purges again ─────────────────────────────────────

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
  -- FK with no cascade, so the target's own rows cannot outlive them.
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
