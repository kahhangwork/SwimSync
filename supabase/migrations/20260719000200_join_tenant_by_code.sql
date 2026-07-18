-- ============================================================
-- Multi-tenancy phase 3: redeeming a join code.
--
-- A parent must be able to join a business they cannot yet see. `tenants_select`
-- deliberately has no "anyone may look up a tenant" branch — that is what makes
-- codes meaningful instead of a browsable directory (TENANCY_DESIGN.md §6), and
-- a lookup policy would hand every parent the customer list the picker was
-- rejected for exposing.
--
-- So redemption is a SECURITY DEFINER RPC: it resolves the code with the
-- policies bypassed, creates the link, and returns ONLY the tenant's display
-- name. It never returns the id of a tenant whose code did not match, so it
-- cannot be used to enumerate.
--
-- WHY NOT A PLAIN INSERT POLICY ON parent_tenants: the parent would first have
-- to turn a code into a tenant_id, which is the lookup we are refusing to grant.
-- ============================================================

/**
 * Redeem a join code for the CALLING parent.
 *
 * Returns the tenant's id and display name so the app can confirm which
 * business was joined ("You've joined Coach Marcus Swim School").
 * Idempotent: re-entering a code you already hold is a no-op, not an error —
 * a parent who taps twice should not see a failure.
 */
CREATE OR REPLACE FUNCTION public.join_tenant_by_code(p_code TEXT)
RETURNS TABLE (tenant_id UUID, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent_id UUID;
  v_tenant    RECORD;
  v_code      TEXT;
BEGIN
  v_parent_id := current_parent_id();
  IF v_parent_id IS NULL THEN
    -- Coaches and admins have no business joining a tenant as a customer.
    RAISE EXCEPTION 'only a parent account can join with a code';
  END IF;

  -- Normalised so a code read off a phone screen still works: codes are
  -- generated uppercase with no ambiguous characters, and people type them
  -- with stray spaces and lowercase.
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'enter a join code';
  END IF;

  SELECT t.id, t.display_name INTO v_tenant
    FROM tenants t WHERE UPPER(t.join_code) = v_code;

  IF v_tenant.id IS NULL THEN
    -- Deliberately identical wording for "no such code": distinguishing
    -- "wrong code" from "code exists but something else failed" would let a
    -- caller probe which codes are real.
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- ON CONFLICT names the CONSTRAINT rather than the columns: this function
  -- RETURNS TABLE (tenant_id …), so a bare `tenant_id` in the conflict target
  -- is ambiguous between the OUT parameter and the column.
  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent_id, v_tenant.id)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  RETURN QUERY SELECT v_tenant.id, v_tenant.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.join_tenant_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_tenant_by_code(TEXT) TO authenticated;

/**
 * Regenerate this tenant's join code — for when one leaks or is over-shared.
 *
 * Only the tenant's own admin (or the platform admin) may call it. Existing
 * parent_tenants links are NOT revoked: the code is an invitation, not an
 * ongoing credential, so rotating it must not evict families who already joined.
 */
CREATE OR REPLACE FUNCTION public.regenerate_join_code(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT can_admin_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'not permitted to change this business''s join code';
  END IF;

  LOOP
    v_code := generate_join_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE join_code = v_code);
  END LOOP;

  UPDATE tenants SET join_code = v_code, updated_at = NOW() WHERE id = p_tenant_id;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_join_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_join_code(UUID) TO authenticated;

/**
 * Move a student to a different business. The platform admin's rescue tool
 * (TENANCY_DESIGN.md §6) — it fixes the realistic error, a parent entering the
 * wrong code, not just the theoretical orphan.
 *
 * Closes any active enrolment first: an enrolment in the OLD tenant's class
 * would otherwise violate the cross-tenant enrolment guard the moment the
 * student moves, and the child would be on a roster their business no longer
 * owns.
 */
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
