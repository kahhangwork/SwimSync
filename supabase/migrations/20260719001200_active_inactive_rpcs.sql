-- ============================================================
-- ACTIVE / INACTIVE — phase 2: the writers.
--
-- ONE WRITER PER FACT. `set_students_active()` is the ONLY thing that writes
-- students.is_active / inactivated_at / parent_tenants.is_active. This is not a
-- convention to remember: parent_tenants has no UPDATE policy at all, so RLS
-- already forbids every other path, and these functions are SECURITY DEFINER.
--
-- The alternative — a second function that also flips is_active — is the shape
-- that produced the drifted completeness rule (§7.18): two implementations of
-- one rule is one implementation and one liability. `close_student_enrolment()`
-- therefore DELEGATES here rather than keeping its own copy.
--
-- HOW THE FAMILY FLIP WORKS, AND WHY IT IS NOT A TRIGGER.
--
-- Deactivating a child is a CHOICE (do the siblings go too?). A family with no
-- active children being inactive is a CONSEQUENCE, not a second choice — so the
-- UI asks about siblings, then states the family outcome rather than asking it.
-- That is why this lives in the RPC and not in a trigger:
--
--   * A trigger fires AFTER the write and cannot ask anything, so the sibling
--     prompt would be a lie about what is going to happen.
--   * More importantly, a trigger maintaining the EQUIVALENCE
--     "no active children <=> family inactive" would break reactivation: a
--     returning family re-enters the join code, has zero active children by
--     design (status is restored, enrolments are not), and the trigger would
--     immediately flip them back to inactive. The join code would look broken.
--
-- So propagation is deliberately ONE-WAY and event-shaped: it runs when
-- children are written, never as a standing invariant. Do not "tidy" this into
-- a trigger or a CHECK constraint.
-- ============================================================

-- ------------------------------------------------------------
-- The READ that drives the prompt. Called before anything is written, so the
-- admin confirms a named set of children rather than a count that might have
-- changed underneath them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_active_children(p_student_id UUID)
RETURNS TABLE (student_id UUID, full_name TEXT, is_self BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.full_name, s.id = p_student_id
    FROM students s
    JOIN parent_students ps  ON ps.student_id = s.id
    JOIN parent_students ps2 ON ps2.parent_id = ps.parent_id
   WHERE ps2.student_id = p_student_id
     AND s.tenant_id = (SELECT tenant_id FROM students WHERE id = p_student_id)
     AND s.is_active
   ORDER BY (s.id = p_student_id) DESC, s.full_name;
$$;

COMMENT ON FUNCTION public.family_active_children(UUID) IS
  'Active children of the same family AT THE SAME BUSINESS, including the one '
  'asked about (is_self). Scoped by tenant on purpose: a sibling at another '
  'business is none of this admin''s concern and must not appear in the prompt.';

-- ------------------------------------------------------------
-- The sole writer.
--
-- Takes an ARRAY of ids, not one, so the set the admin confirmed in the prompt
-- is exactly the set that gets written — no re-deriving "who are the siblings?"
-- between showing the prompt and doing the work, and no partial application if
-- one child fails.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_students_active(
  p_student_ids UUID[],
  p_active      BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_sid    UUID;
  v_tenant UUID;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no students given';
  END IF;

  FOREACH v_sid IN ARRAY p_student_ids LOOP
    SELECT tenant_id INTO v_tenant FROM students WHERE id = v_sid;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'student % not found', v_sid;
    END IF;

    -- Checked BEFORE anything is closed: coach_serves_student() reads the
    -- ACTIVE enrolment, so it returns false once we have closed it.
    IF NOT (is_platform_admin() OR is_tenant_admin(v_tenant)
            OR coach_serves_student(v_sid)) THEN
      RAISE EXCEPTION 'not permitted to change this student';
    END IF;

    SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = v_sid;

    IF NOT p_active THEN
      -- Closing the enrolment is not tidiness: an open enrolment for a child who
      -- no longer attends keeps their class permanently incomplete, which BLOCKS
      -- invoice generation for the whole business (PRD §7.7). Lessons already
      -- attended still bill — billing follows attendance rows, not enrolment
      -- (§7.13).
      UPDATE student_class_enrolments
         SET is_active = FALSE, unenrolled_at = NOW()
       WHERE student_id = v_sid AND is_active;
    END IF;

    UPDATE students
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END,
           -- 'inactive' is NO LONGER written here. Assignment answers only
           -- "in a class?", and phase 6 drops the value from the enum — which
           -- would fail at RUNTIME, not migration time, if a cast survived in
           -- a function body (§7.21).
           assignment_status = CASE WHEN p_active THEN assignment_status
                                    ELSE 'unassigned'::assignment_status END,
           updated_at     = NOW()
     WHERE id = v_sid;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                           old_value, new_value, tenant_id)
    VALUES (v_actor,
            CASE WHEN p_active THEN 'student_reactivated' ELSE 'student_set_inactive' END,
            'Student', v_sid, v_old,
            (SELECT to_jsonb(s) FROM students s WHERE s.id = v_sid), v_tenant);

    -- ── The family consequence, applied per (parent, tenant) ──────────────
    -- Deactivating: a family with no active children left here is no longer a
    -- customer here. Reactivating: a child cannot be active inside an inactive
    -- family, so the family comes back with them.
    UPDATE parent_tenants pt
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
      FROM parent_students ps
     WHERE ps.student_id = v_sid
       AND pt.parent_id  = ps.parent_id
       AND pt.tenant_id  = v_tenant
       AND pt.is_active IS DISTINCT FROM p_active
       AND (
         p_active                      -- reactivation: unconditional
         OR NOT EXISTS (               -- deactivation: only once none are left
           SELECT 1 FROM students s2
             JOIN parent_students ps2 ON ps2.student_id = s2.id
            WHERE ps2.parent_id = ps.parent_id
              AND s2.tenant_id  = v_tenant
              AND s2.is_active
         )
       );
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- Family-level entry point, for the admin Parents page.
--
-- Takes the child ids explicitly for the same reason as above: the admin
-- confirmed a named list, and that list is what gets written.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_parent_tenant_active(
  p_parent_id   UUID,
  p_tenant_id   UUID,
  p_active      BOOLEAN,
  p_student_ids UUID[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (is_platform_admin() OR is_tenant_admin(p_tenant_id)) THEN
    RAISE EXCEPTION 'not permitted to change this family';
  END IF;

  -- Children first: deactivating them flips the family via the consequence
  -- rule above, so this is usually all that is needed.
  IF p_student_ids IS NOT NULL AND array_length(p_student_ids, 1) IS NOT NULL THEN
    PERFORM set_students_active(p_student_ids, p_active);
  END IF;

  -- Then the family itself — for the case the children did not cover: marking a
  -- family inactive while deliberately leaving a child active (the admin chose
  -- "just this one"), or a family with no children yet.
  UPDATE parent_tenants
     SET is_active      = p_active,
         inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id
     AND is_active IS DISTINCT FROM p_active;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor,
          CASE WHEN p_active THEN 'family_reactivated' ELSE 'family_set_inactive' END,
          'ParentTenant', p_parent_id,
          jsonb_build_object('tenant_id', p_tenant_id),
          jsonb_build_object('is_active', p_active, 'students', p_student_ids),
          p_tenant_id);
END;
$$;

-- ------------------------------------------------------------
-- close_student_enrolment: now enrolment-only, and DELEGATES the inactive case.
--
-- Two behaviours share this entry point today — "Remove from class" (still a
-- customer, just not in a class) and "Set inactive" (gone). The second is now
-- set_students_active()'s job. Rewritten here rather than left alone because
-- its body cast to 'inactive'::assignment_status, which phase 6 removes from
-- the enum — and a function body is NOT a tracked dependency, so that would
-- have failed at runtime on a live coach-facing path (§7.21).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_student_enrolment(
  p_student_id   UUID,
  p_set_inactive BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_set_inactive THEN
    PERFORM set_students_active(ARRAY[p_student_id], FALSE);
    RETURN;
  END IF;

  SELECT tenant_id INTO v_tenant FROM students WHERE id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT (is_platform_admin() OR is_tenant_admin(v_tenant)
          OR coach_serves_student(p_student_id)) THEN
    RAISE EXCEPTION 'not permitted to change this student''s enrolment';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id AND is_active;

  UPDATE students
     SET assignment_status = 'unassigned'::assignment_status,
         updated_at        = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_removed_from_class', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id), v_tenant);
END;
$$;

-- ------------------------------------------------------------
-- Rejoining a business REACTIVATES the family.
--
-- This is the whole re-activation path, and it needs no new UI: an inactive
-- family can still log in (they are not disabled — that is a platform power
-- they do not have), so they simply re-enter the code the business gives them.
--
-- A returning parent CANNOT create a second account: profiles.email is UNIQUE
-- and so is auth.users.email, so email-as-identity is already guaranteed by the
-- schema and there is nothing to deduplicate.
--
-- Restores STATUS ONLY. Children stay inactive and the admin reassigns them
-- through the normal flow — guessing which class a returning child belongs in
-- is how you get a wrong roster.
--
-- The ON CONFLICT target names the CONSTRAINT, not the columns: this function
-- RETURNS TABLE (tenant_id …), so a bare `tenant_id` is ambiguous between the
-- OUT parameter and the column. Do not "simplify" it.
-- ------------------------------------------------------------
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
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key
  DO UPDATE SET is_active = TRUE, inactivated_at = NULL;

  RETURN QUERY SELECT v_tenant.id, v_tenant.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.set_students_active(UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_parent_tenant_active(UUID, UUID, BOOLEAN, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.family_active_children(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_students_active(UUID[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_parent_tenant_active(UUID, UUID, BOOLEAN, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.family_active_children(UUID) TO authenticated;
