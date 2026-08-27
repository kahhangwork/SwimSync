-- Rollback for 20260827000100_reassign_student_tenant_loose_ends.sql
--
-- Restores the PRIOR body of reassign_student_tenant() (as defined in
-- 20260719000200_join_tenant_by_code.sql) — the one that does NOT clear
-- level_id and does NOT write the parent's membership at B.
--
-- ⚠ Rolling this back RE-INTRODUCES the production bug: moving a LEVELLED
-- student fails on trg_student_level_tenant. Only run this DOWN if the new
-- membership-write logic itself misbehaves; the level_id fix is not optional.
-- Same signature, so grants persist.

CREATE OR REPLACE FUNCTION public.reassign_student_tenant(
  p_student_id UUID,
  p_tenant_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old   JSONB;
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

  UPDATE students
     SET tenant_id = p_tenant_id,
         assignment_status = 'unassigned',
         updated_at = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_tenant_reassigned', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id),
          p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_student_tenant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_student_tenant(UUID, UUID) TO authenticated;
