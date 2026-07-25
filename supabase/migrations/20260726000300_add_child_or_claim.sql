-- ============================================================
-- add_child_or_claim(): the parent's ONLY path to creating a child
-- (PARENT_CLAIM_PLAN.md phase 2, §6).
--
-- Add Child used to be a plain INSERT from the app. That is what makes a
-- duplicate: a parent types a child their coach added weeks ago, a second
-- student row appears with none of the attendance, and the original keeps
-- holding the billing month open with nobody to bill.
--
-- So creating a child now goes through here, and the check happens BEFORE the
-- insert. Four modes:
--
--   check          → look for candidates. Found → return them, INSERT NOTHING.
--                    None → create + link, exactly as before.
--   claim_confirmed → the parent said "yes, that's my child"  ─┐ both file a
--   claim_unsure    → the parent said "not sure"               ─┘ claim for the
--                    admin to decide. NEITHER attaches the child.
--   create_anyway  → the parent said "no, that's a different child". Create it.
--
-- ⚠ CONFIRM DOES NOT LINK. It files a claim like any other. A wrong link
-- exposes a family's attendance, invoices and payments to a stranger, and the
-- parent's own certainty cannot price that — the admin decides every one.
--
-- ⚠ §7.42 DEVIATION, DELIBERATE AND GUARDED. That gotcha says a SECURITY
-- DEFINER writer must DERIVE tenant_id rather than accept it, because
-- pin_student_tenant() exempts definer functions and nothing downstream would
-- catch a wrong one. Here the tenant genuinely cannot be derived — the parent
-- is choosing which of their businesses the child belongs to. So it is a
-- parameter, and parent_in_tenant() is the guard that replaces the pin. That is
-- the SAME predicate the students_insert policy used before this function took
-- the path over, so the boundary has not moved, only its home.
-- ============================================================

CREATE TYPE add_child_mode AS ENUM (
  'check', 'claim_confirmed', 'claim_unsure', 'create_anyway'
);

CREATE OR REPLACE FUNCTION public.add_child_or_claim(
  p_tenant_id    UUID,
  p_full_name    TEXT,
  p_date_of_birth DATE,
  p_gender       TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_mode         add_child_mode DEFAULT 'check',
  p_candidate_id UUID DEFAULT NULL
)
RETURNS TABLE (
  outcome    TEXT,     -- 'created' | 'candidates' | 'pending' | 'already_pending'
  student_id UUID,
  candidates JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_parent   UUID := current_parent_id();
  v_name     TEXT := btrim(COALESCE(p_full_name, ''));
  v_reason   TEXT;
  v_student  UUID;
  v_cands    JSONB;
  v_existing UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'only a parent can add a child';
  END IF;

  -- The guard that replaces the tenant pin. See the header.
  IF NOT parent_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'you have not joined that business';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- ── The block (PARENT_CLAIM_PLAN decision 5) ─────────────────────────────
  -- While a claim is pending, this parent cannot re-add the same child. Without
  -- it, tapping Save again is a way straight round the popup.
  --
  -- ⚠ IS NOT DISTINCT FROM, NOT `=`. Half the children this feature exists for
  -- have no date of birth — that is precisely why students_identity_uniq lets
  -- their duplicate through. With `=`, a NULL dob makes the whole predicate
  -- NULL, the block silently never fires, and the bug returns.
  SELECT sc.id INTO v_existing
    FROM student_claims sc
   WHERE sc.parent_id = v_parent
     AND sc.tenant_id = p_tenant_id
     AND sc.status = 'pending'
     AND lower(btrim(sc.claimed_name)) = lower(v_name)
     AND sc.claimed_dob IS NOT DISTINCT FROM p_date_of_birth
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'already_pending'::TEXT, NULL::UUID, NULL::JSONB;
    RETURN;
  END IF;

  -- ── claim_confirmed / claim_unsure ───────────────────────────────────────
  IF p_mode IN ('claim_confirmed', 'claim_unsure') THEN
    IF p_candidate_id IS NULL THEN
      RAISE EXCEPTION 'which child are you claiming?' USING ERRCODE = 'check_violation';
    END IF;

    -- ⚠ NEVER TRUST THE CANDIDATE ID FROM THE CLIENT. Re-derive eligibility
    -- from find_student_candidates() rather than checking a couple of columns
    -- here: that function IS the definition of "a child this parent may claim"
    -- (unclaimed, this tenant, actually matching, not already pending), and a
    -- second hand-written copy of that rule would drift. Without this, a parent
    -- could post any student id they could guess.
    SELECT c.match_reason INTO v_reason
      FROM find_student_candidates(p_tenant_id, v_name, p_date_of_birth) c
     WHERE c.student_id = p_candidate_id;

    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'that child is not one you can claim';
    END IF;

    INSERT INTO student_claims (
      tenant_id, student_id, parent_id,
      claimed_name, claimed_dob, claimed_gender, claimed_notes,
      certainty, match_reason
    ) VALUES (
      p_tenant_id, p_candidate_id, v_parent,
      v_name, p_date_of_birth,
      NULLIF(btrim(COALESCE(p_gender, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      (CASE WHEN p_mode = 'claim_confirmed' THEN 'confirmed' ELSE 'unsure' END)::claim_certainty,
      v_reason
    );

    INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    VALUES (
      p_tenant_id, v_actor, 'student_claim_filed', 'Student', p_candidate_id,
      jsonb_build_object(
        'parent_id', v_parent, 'certainty', p_mode::TEXT,
        'match_reason', v_reason, 'claimed_name', v_name
      )
    );

    RETURN QUERY SELECT 'pending'::TEXT, p_candidate_id, NULL::JSONB;
    RETURN;
  END IF;

  -- ── check: look before creating ──────────────────────────────────────────
  IF p_mode = 'check' THEN
    SELECT jsonb_agg(to_jsonb(c)) INTO v_cands
      FROM find_student_candidates(p_tenant_id, v_name, p_date_of_birth) c;

    IF v_cands IS NOT NULL AND jsonb_array_length(v_cands) > 0 THEN
      -- INSERT NOTHING. The parent has not answered yet.
      RETURN QUERY SELECT 'candidates'::TEXT, NULL::UUID, v_cands;
      RETURN;
    END IF;
  END IF;

  -- ── create (no candidates, or the parent said "no") ──────────────────────
  -- ⚠ TRIPWIRE: everything below must stay byte-for-byte equivalent to what
  -- the app's plain INSERT did before this function existed. Same columns, same
  -- defaults, same friendly 23505. A parent whose child matches nothing must
  -- not be able to tell this slice shipped.
  BEGIN
    INSERT INTO students (
      full_name, date_of_birth, gender, notes,
      assignment_status, is_active, tenant_id, created_by
    ) VALUES (
      v_name, p_date_of_birth,
      -- gender is the gender_type ENUM, not text — cast explicitly. An unknown
      -- value raises here rather than being silently dropped.
      NULLIF(btrim(lower(COALESCE(p_gender, ''))), '')::gender_type,
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      'unassigned', TRUE, p_tenant_id, v_actor
    )
    RETURNING id INTO v_student;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END;

  -- No ON CONFLICT clause, deliberately: the student was created two statements
  -- ago, so a link to them cannot already exist. It would also be AMBIGUOUS —
  -- `student_id` is both a column of parent_students and one of this function's
  -- OUT parameters, and a conflict target cannot tell them apart.
  INSERT INTO parent_students (parent_id, student_id) VALUES (v_parent, v_student);

  -- A deliberate "no, that is a different child" is worth recording: it is the
  -- moment a known duplicate is created on purpose, and the admin's detection
  -- list will surface the pair afterwards. The parent may be wrong.
  IF p_mode = 'create_anyway' THEN
    INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    VALUES (
      p_tenant_id, v_actor, 'child_created_despite_candidates', 'Student', v_student,
      jsonb_build_object('parent_id', v_parent, 'claimed_name', v_name)
    );
  END IF;

  RETURN QUERY SELECT 'created'::TEXT, v_student, NULL::JSONB;
END;
$$;

COMMENT ON FUNCTION public.add_child_or_claim(UUID, TEXT, DATE, TEXT, TEXT, add_child_mode, UUID) IS
  'The parent''s only path to creating a child. Checks for an existing roster entry first; claims go to the admin queue and never link directly.';

REVOKE ALL ON FUNCTION public.add_child_or_claim(UUID, TEXT, DATE, TEXT, TEXT, add_child_mode, UUID)
  FROM PUBLIC;
-- §7.39 — cloud default-grants these; local does not show it.
REVOKE EXECUTE ON FUNCTION public.add_child_or_claim(UUID, TEXT, DATE, TEXT, TEXT, add_child_mode, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_child_or_claim(UUID, TEXT, DATE, TEXT, TEXT, add_child_mode, UUID)
  TO authenticated;
