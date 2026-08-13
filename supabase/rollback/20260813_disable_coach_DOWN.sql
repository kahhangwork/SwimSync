-- ═══════════════════════════════════════════════════════════════════════════
-- DOWN for 20260813000200_disable_coach (Wave 5 chunk 2).
-- Committed BEFORE the deploy, rehearsed on the local stack the same day —
-- running it is the half that finds the bugs (§7.93).
--
-- Order matters: the RPCs and the guard go first (they reference the column),
-- the function-body restores are CREATE OR REPLACE (no drop needed), and the
-- column goes last. Dropping coaches.disabled_at while current_coach_id()
-- still names it would leave every coach policy erroring, not just dark.
--
-- Both restored bodies were taken from pg_get_functiondef() against the live
-- local DB at their pre-chunk-2 state (§7.115): current_coach_id() as
-- 20260309000600 created it; audit_log_tenant_of() as 20260813000100 (chunk 1)
-- left it — the 'Tenant' arm STAYS, only the 'Coach' arm goes.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. The RPCs.
DROP FUNCTION IF EXISTS public.disable_coach(UUID, UUID);
DROP FUNCTION IF EXISTS public.reactivate_coach(UUID);

-- 2. The guard.
DROP TRIGGER IF EXISTS coaches_guard_privileges ON public.coaches;
DROP FUNCTION IF EXISTS public.guard_coaches_privileges();

-- 3. current_coach_id() back to its pre-chunk-2 body.
CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM coaches WHERE profile_id = auth.uid();
$$;

-- 4. audit_log_tenant_of() back to the chunk-1 body (Tenant arm kept, Coach
--    arm removed). Any coach_disabled/coach_reactivated audit rows already
--    written keep their stamped tenant_id — only future derivations change.
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

-- 5. The column, last.
ALTER TABLE public.coaches DROP COLUMN IF EXISTS disabled_at;
