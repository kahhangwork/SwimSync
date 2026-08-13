-- ═══════════════════════════════════════════════════════════════════════════
-- OWNER TRANSFER — platform-admin only (Wave 5 chunk 1, docs/plans/WAVE_5_PLAN.md)
--
-- tenants.owner_profile_id has had NO transfer path since it shipped
-- (20260806000100): guard_tenants_owner refuses every client write, deliberately,
-- because with co-admins any writable path is a takeover path. A lost owner
-- therefore froze a business until the platform admin intervened in SQL.
--
-- The transfer is PLATFORM-ADMIN ONLY, settled with the user 2026-08-13
-- (WAVE_5_PLAN.md decision 2): there is no self-service path, so one RPC covers
-- both the handover and the lost-owner case. The guard trigger needs no change —
-- a SECURITY DEFINER function runs as postgres and passes it; that is §7.38's
-- designed mechanism, not a loophole.
--
-- Three things, one file:
--   1. audit_log_tenant_of() gains a WHEN 'Tenant' arm. The ELSE RAISES by
--      design (§7.37) — without the arm, the first owner_reassigned audit row
--      would kill the RPC that writes it. Body from pg_get_functiondef() against
--      the live DB (§7.115), 2026-08-13; it matched 20260806000100 exactly.
--   2. platform_reassign_owner() — the transfer itself. Idempotent; audits.
--   3. platform_tenant_admins() — the candidate list for the Platform page's
--      dropdown. A self-gating RPC, not a service-role API route, same
--      WITH me AS … WHERE me.ok shape as platform_tenant_overview().
--
-- Effects that move WITH the column, asserted in owner_transfer.test.sql rather
-- than re-implemented: platform_tenant_overview() reports the new owner's
-- email/status, and resend-invite mails the new owner (route.ts keys strictly on
-- owner_profile_id).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. audit_log_tenant_of: the 'Tenant' arm ─────────────────────────────────
-- A row ABOUT a tenant belongs to that tenant: the entity id IS the answer.

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
    WHEN 'Tenant' THEN
      -- Platform-level actions ON a business (owner_reassigned here;
      -- tenant suspension reuses this arm — WAVE_5_PLAN.md chunk 3). The row is
      -- about the tenant, so the entity id IS the tenant id — a lookup would
      -- only re-derive the argument. Note audit_log.tenant_id carries an FK to
      -- tenants(id) (20260718000500), so no 'Tenant' audit row can outlive its
      -- tenant regardless of what this arm returns; callers must audit BEFORE
      -- any future hard-delete, not after.
      v_tenant := p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$$;

-- ── 2. platform_reassign_owner ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_reassign_owner(
  p_tenant_id            UUID,
  p_new_owner_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_owner UUID;
  v_target    profiles%ROWTYPE;
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

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'owner_reassigned', 'Tenant', p_tenant_id,
          jsonb_build_object('owner_profile_id', v_old_owner),
          jsonb_build_object('owner_profile_id', p_new_owner_profile_id));
END;
$$;

COMMENT ON FUNCTION public.platform_reassign_owner(UUID, UUID) IS
  'Platform-admin only: hand a business to another of its live admins. The ONLY '
  'write path for tenants.owner_profile_id (guard_tenants_owner refuses '
  'clients; this passes as postgres, §7.38). Idempotent. Covers self-service '
  'handover AND the lost-owner case (owner_profile_id NULL after auth-layer '
  'delete). WAVE_5_PLAN.md chunk 1.';

REVOKE ALL ON FUNCTION public.platform_reassign_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_reassign_owner(UUID, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_reassign_owner(UUID, UUID)
  TO authenticated;

-- ── 3. platform_tenant_admins: the dropdown feed ─────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_tenant_admins(p_tenant_id UUID)
RETURNS TABLE (
  profile_id  UUID,
  email       TEXT,
  full_name   TEXT,
  is_owner    BOOLEAN,
  is_disabled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT is_platform_admin() AS ok)
  SELECT p.id,
         p.email,
         p.full_name,
         p.id IS NOT DISTINCT FROM t.owner_profile_id,
         p.admin_disabled_at IS NOT NULL
    FROM profiles p
    JOIN tenants t ON t.id = p.tenant_id
    CROSS JOIN me
   WHERE me.ok               -- THE GATE. No rows for anyone else.
     AND p.tenant_id = p_tenant_id
     AND p.role = 'tenant_admin'
   ORDER BY p.full_name;
$$;

COMMENT ON FUNCTION public.platform_tenant_admins(UUID) IS
  'Platform-admin only: a tenant''s admin accounts, for the Change-owner '
  'dropdown. Gate inside (WITH me), platform_tenant_overview''s shape. '
  'is_disabled rows render but are not selectable — the RPC refuses them too.';

REVOKE ALL ON FUNCTION public.platform_tenant_admins(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_admins(UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_tenant_admins(UUID) TO authenticated;
