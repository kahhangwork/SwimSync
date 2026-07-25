-- ============================================================
-- link_invited_parent(): attach a parent account to a child the coach already
-- put on the roster, and to that child's business.
--
-- This is the CLAIM, and the reason the whole feature needs no data migration:
-- the coach's student row IS the student row. Linking does not move attendance,
-- enrolments, sessions or invoice items — they already point at this
-- student_id and simply become visible, and billable, to a parent who now
-- exists. "Adopt, don't merge."
--
-- WHY AN RPC RATHER THAN TWO INSERTS FROM THE ROUTE. Two links must both exist
-- or neither:
--   parent_tenants  — membership. handle_new_user() deliberately does NOT
--                     create it: parents are GLOBAL (a family may deal with a
--                     school and a private coach), so they normally reach a
--                     business by redeeming a join code. An invited parent
--                     never types one, so somebody has to write it.
--   parent_students — the child themselves, which is the whole point of the
--                     invite.
-- A parent with membership but no child sees an empty app; a parent with a
-- child but no membership fails parent_in_tenant() checks. Both halves in one
-- transaction removes the question.
--
-- ⚠ CALL IT WITH THE CALLER'S TOKEN, NEVER THE SERVICE ROLE. is_tenant_admin()
-- resolves auth.uid(), which is NULL for service_role — the gate would not
-- silently pass (it refuses), but it would refuse for the wrong reason, and
-- that is one edit away from §7.8's "a gate the only live caller bypasses".
-- The route uses service role ONLY to create the auth user.
-- ============================================================

CREATE OR REPLACE FUNCTION public.link_invited_parent(
  p_profile_id UUID,
  p_student_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_tenant  UUID;
  v_parent  UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The tenant comes from the STUDENT, never from the caller's input — same
  -- rule as add_unclaimed_student, and for the same reason: this is SECURITY
  -- DEFINER, so pin_student_tenant() does not apply.
  SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may link a parent to this child';
  END IF;

  SELECT p.id INTO v_parent FROM parents p WHERE p.profile_id = p_profile_id;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'that account is not a parent account';
  END IF;

  -- Already linked to THIS parent: a no-op. An invite resent, or an admin
  -- clicking twice, must not error — nothing about the desired state differs.
  IF EXISTS (
    SELECT 1 FROM parent_students ps
     WHERE ps.student_id = p_student_id AND ps.parent_id = v_parent
  ) THEN
    RETURN;
  END IF;

  -- Linked to SOMEBODY ELSE: refuse. Adding a second parent to a family is a
  -- real future case (parent_students is many-to-many — see BACKLOG household
  -- split billing), but it is not what an invite does, and silently attaching
  -- a stranger to an existing family is the worst outcome available here.
  --
  -- The two cases are separated deliberately. Collapsing them into one "already
  -- has a parent" refusal makes the harmless case (re-inviting the same person)
  -- fail, and collapsing them the other way lets the dangerous one through.
  IF EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = p_student_id) THEN
    RAISE EXCEPTION 'that child is already linked to a different parent account';
  END IF;

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent, v_tenant)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id)
  VALUES (v_parent, p_student_id)
  ON CONFLICT (parent_id, student_id) DO NOTHING;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'unclaimed_student_linked_to_parent', 'Student', p_student_id,
    jsonb_build_object('parent_id', v_parent, 'tenant_id', v_tenant)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_invited_parent(UUID, UUID) FROM PUBLIC;
-- §7.39: Supabase cloud default-grants new functions to anon and service_role
-- where local grants neither. Revoke both EXPLICITLY and re-verify remotely.
REVOKE EXECUTE ON FUNCTION public.link_invited_parent(UUID, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.link_invited_parent(UUID, UUID) TO authenticated;
