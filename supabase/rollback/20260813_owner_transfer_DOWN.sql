-- ROLLBACK for 20260813000100_owner_transfer.sql (Wave 5 chunk 1).
-- Committed BEFORE the deploy — the pattern 20260804/20260806 set: a scratchpad
-- backup nobody can find is not a rollback plan.
--
-- Order matters: the RPCs are dropped FIRST, because platform_reassign_owner
-- writes an audit row that needs the 'Tenant' arm this file removes — dropping
-- the arm first would leave a window where the RPC exists and dies mid-write.
--
-- Restores audit_log_tenant_of to its pre-migration body, byte-compared against
-- pg_get_functiondef() from 20260806000100's deployed state (§7.115). The
-- rehearsal (2026-08-13): DOWN applied locally, the full pre-change suite
-- (753 checks, owner_transfer.test.sql held out) ran green, migration
-- re-applied, 777 green.

DROP FUNCTION IF EXISTS public.platform_reassign_owner(UUID, UUID);
DROP FUNCTION IF EXISTS public.platform_tenant_admins(UUID);

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
