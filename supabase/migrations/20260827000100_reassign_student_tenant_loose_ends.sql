-- ============================================================
-- reassign_student_tenant() — close its two silent ends.
-- (WAVE_C_SPOOL_PLAN.md Piece 3.)
--
-- The platform admin's rescue tool (TENANCY_DESIGN.md §6) moves a student from
-- the wrong business to the right one. It shipped with two ends it never tied
-- off, and the FIRST is a live production BUG:
--
--   1. IT IS BROKEN TODAY FOR ANY LEVELLED STUDENT. The RPC changes
--      students.tenant_id while students.level_id still points at tenant A's
--      ladder, and trg_student_level_tenant (20260719001800) fires on
--      UPDATE OF tenant_id and raises 'That level belongs to a different
--      business.' — a check_violation. SECURITY DEFINER does NOT skip triggers,
--      and this one has no role carve-out, so the move simply fails. The fix is
--      to clear level_id in the SAME update: tenant A's vocabulary means nothing
--      at B, so the student lands UNLEVELLED and B's admin re-levels them. This
--      is the same reasoning as assignment_status → 'unassigned'.
--
--   2. THE PARENT IS LEFT OUT OF BUSINESS B. Moving the child never gave the
--      parent a parent_tenants membership at B, so the family the child now
--      belongs to could not see them — the child moved, the family did not. The
--      RPC now writes the membership for EVERY linked parent (parent_students is
--      many-to-many; an admin-created child may have zero), inserting when
--      missing and REACTIVATING a previously-offboarded one.
--
-- Same signature (uuid, uuid) and RETURNS VOID — a same-signature CREATE OR
-- REPLACE, so grants persist and no remote grant dump is needed (§11.32). The
-- credit-balance WARNING is deliberately client-side (advisory only): credit
-- never crosses businesses (PRD §5.6), so this tool does not move it.
--
-- TRIGGER NOTES (why the membership write is safe):
--   • parent_tenants has trg_guard_parent_offboard (BEFORE UPDATE,
--     WHEN old.is_active AND NOT new.is_active) — it fires ONLY on
--     deactivation. Reactivating (false → true) is the reverse, so it never
--     fires here. A plain INSERT fires nothing of its concern.
--   • parent_tenants has trg_assign_referral_code (BEFORE INSERT) — the SAME
--     trigger a normal join_tenant_by_code() insert fires, so a new membership
--     gets its referral code exactly as any join does. Nothing new.
--   The explicit insert/reactivate branch (rather than an upsert) keeps §7.57
--   out of scope entirely: no ON CONFLICT DO UPDATE, so no upsert-resolved
--   update to reason about.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reassign_student_tenant(
  p_student_id UUID,
  p_tenant_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_old    JSONB;
  v_parent UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may move a student between businesses';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id AND is_active;

  -- level_id = NULL alongside the tenant change: tenant A's level ladder is
  -- meaningless at B, and leaving it set makes trg_student_level_tenant refuse
  -- the whole move (see header #1). B's admin re-levels the student.
  UPDATE students
     SET tenant_id = p_tenant_id,
         assignment_status = 'unassigned',
         level_id = NULL,
         updated_at = NOW()
   WHERE id = p_student_id;

  -- Give every linked parent a membership at B so the family can see the child
  -- they now own. Zero parents (an admin-created child) is a clean no-op.
  FOR v_parent IN
    SELECT parent_id FROM parent_students WHERE student_id = p_student_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM parent_tenants
       WHERE parent_id = v_parent AND tenant_id = p_tenant_id
    ) THEN
      -- Membership exists — reactivate it if a previous offboarding left it
      -- inactive, or the pickers and billing grouping (which filter is_active)
      -- would keep the family invisible at B. Does not fire the offboard guard.
      UPDATE parent_tenants
         SET is_active = TRUE, inactivated_at = NULL
       WHERE parent_id = v_parent
         AND tenant_id = p_tenant_id
         AND NOT is_active;
    ELSE
      -- ON CONFLICT DO NOTHING (never DO UPDATE) so two concurrent moves of
      -- siblings sharing a parent cannot race to a unique violation on
      -- (parent_id, tenant_id). §7.57 does not apply — nothing is UPDATEd on
      -- conflict, so there is no upsert-resolved update to govern.
      INSERT INTO parent_tenants (parent_id, tenant_id)
      VALUES (v_parent, p_tenant_id)
      ON CONFLICT (parent_id, tenant_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_tenant_reassigned', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id),
          p_tenant_id);
END;
$$;

-- Grants persist across a same-signature CREATE OR REPLACE; re-affirmed here so
-- the file is self-contained and idempotent (matches 20260719000200).
REVOKE ALL ON FUNCTION public.reassign_student_tenant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_student_tenant(UUID, UUID) TO authenticated;
