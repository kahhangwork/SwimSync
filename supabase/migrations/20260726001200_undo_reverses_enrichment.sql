-- ============================================================
-- UNDOING AN APPROVAL MUST ALSO UNDO WHAT IT WROTE ONTO THE CHILD.
--
-- Found in production testing 2026-07-26, and confirmed from the audit log:
--
--     child created with   "date_of_birth": null
--     approval logged      "dob_filled": true
--     after the undo       date_of_birth = 2020-01-01, gender = 'male'
--
-- approve_student_claim() fills a MISSING date of birth (and gender, and
-- notes) from what the parent typed — that is the one thing which stops the
-- same duplicate forming again, since students_identity_uniq exempts NULL.
-- undo_student_claim() removed the parent link and left all of that in place.
--
-- ⚠ WHY THAT IS WRONG AND NOT MERELY UNTIDY. An undo means the admin decided
-- THIS IS NOT THEIR CHILD. So the date of birth now sitting on that record was
-- supplied by someone who is not the child's parent, about another family's
-- child, and it stays there looking like fact — §7.37's disease with a human
-- author.
--
-- It also has a visible, dead-ending consequence, which is how it was found: a
-- record enriched by a wrongly-approved claim carries exactly the identity the
-- parent is about to type, so students_identity_uniq then REFUSES to let them
-- create their own child. "Already registered with this coach or school",
-- with no way forward.
--
-- ⚠ THE REVERSAL IS GUARDED ON THE VALUE, NOT JUST THE FLAG. Between approval
-- and undo, a coach may have corrected the date themselves. Blanking it then
-- would destroy their work to undo ours, so each field is cleared only if it
-- STILL holds exactly what the claim supplied.
-- ============================================================

ALTER TABLE student_claims
  ADD COLUMN filled_dob    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN filled_gender BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN filled_notes  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN student_claims.filled_dob IS
  'The approval wrote this child''s date of birth. undo_student_claim() clears it again — an undone claim must leave no trace on another family''s child.';

-- ── approve: record exactly what it filled ────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_student_claim(p_claim_id UUID)
RETURNS TABLE (
  student_id       UUID,
  others_declined  INT,
  dob_filled       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_claim   student_claims%ROWTYPE;
  v_profile UUID;
  v_others  INT := 0;
  v_dob     BOOLEAN := FALSE;
  v_gender  BOOLEAN := FALSE;
  v_notes   BOOLEAN := FALSE;
  v_had_dob BOOLEAN;
  v_had_gen BOOLEAN;
  v_had_not BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  IF NOT is_tenant_admin(v_claim.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may decide a claim';
  END IF;

  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'that claim has already been decided';
  END IF;

  SELECT p.profile_id INTO v_profile FROM parents p WHERE p.id = v_claim.parent_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'that parent account no longer exists';
  END IF;

  PERFORM link_invited_parent(v_profile, v_claim.student_id);

  -- What was MISSING before we touched it. Read first, so "we filled this" is
  -- a fact rather than an inference from the value afterwards.
  SELECT date_of_birth IS NULL, gender IS NULL, notes IS NULL
    INTO v_had_dob, v_had_gen, v_had_not
    FROM students WHERE id = v_claim.student_id;

  IF v_claim.claimed_dob IS NOT NULL AND v_had_dob THEN
    BEGIN
      UPDATE students SET date_of_birth = v_claim.claimed_dob
       WHERE id = v_claim.student_id AND date_of_birth IS NULL;
      v_dob := FOUND;
    EXCEPTION WHEN unique_violation THEN
      -- A third row already has that name and date. Keep the link, skip this.
      v_dob := FALSE;
    END;
  END IF;

  UPDATE students
     SET gender = COALESCE(
           gender,
           (CASE WHEN lower(btrim(COALESCE(v_claim.claimed_gender, '')))
                      IN ('male','female','other')
                 THEN lower(btrim(v_claim.claimed_gender))::gender_type END)
         ),
         notes  = COALESCE(notes, v_claim.claimed_notes)
   WHERE id = v_claim.student_id;

  v_gender := v_had_gen AND lower(btrim(COALESCE(v_claim.claimed_gender, '')))
                             IN ('male','female','other');
  v_notes  := v_had_not AND v_claim.claimed_notes IS NOT NULL;

  UPDATE student_claims
     SET status = 'approved', decided_at = NOW(), decided_by = v_actor,
         filled_dob = v_dob, filled_gender = v_gender, filled_notes = v_notes
   WHERE id = p_claim_id;

  WITH closed AS (
    UPDATE student_claims sc
       SET status = 'declined', decided_at = NOW()
     WHERE sc.student_id = v_claim.student_id
       AND sc.id <> p_claim_id
       AND sc.status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::INT INTO v_others FROM closed;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_approved', 'Student', v_claim.student_id,
    jsonb_build_object(
      'claim_id', p_claim_id, 'parent_id', v_claim.parent_id,
      'others_declined', v_others, 'dob_filled', v_dob,
      'gender_filled', v_gender, 'notes_filled', v_notes
    )
  );

  RETURN QUERY SELECT v_claim.student_id, v_others, v_dob;
END;
$$;

-- ── undo: put the child back exactly as it was ────────────────────────────
CREATE OR REPLACE FUNCTION public.undo_student_claim(p_claim_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_claim   student_claims%ROWTYPE;
  v_invoice TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  IF NOT is_tenant_admin(v_claim.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may undo a claim';
  END IF;

  IF v_claim.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved claim can be undone';
  END IF;

  SELECT i.billing_month INTO v_invoice
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.student_id = v_claim.student_id
     AND i.parent_id = v_claim.parent_id
   LIMIT 1;

  IF v_invoice IS NOT NULL THEN
    RAISE EXCEPTION
      'This link cannot be undone: % has already been invoiced to this parent (%). Issue a credit note instead.',
      (SELECT full_name FROM students WHERE id = v_claim.student_id), v_invoice;
  END IF;

  DELETE FROM parent_students
   WHERE parent_id = v_claim.parent_id
     AND student_id = v_claim.student_id;

  -- ⚠ AND UNDO WHAT THE APPROVAL WROTE ONTO THE CHILD. Each field is cleared
  -- only if it STILL holds exactly what this claim supplied — a coach may have
  -- corrected it since, and destroying their correction to reverse ours would
  -- be a worse error than the one being fixed.
  UPDATE students s
     SET date_of_birth = CASE
           WHEN v_claim.filled_dob AND s.date_of_birth IS NOT DISTINCT FROM v_claim.claimed_dob
             THEN NULL ELSE s.date_of_birth END,
         gender = CASE
           WHEN v_claim.filled_gender
            AND s.gender::text IS NOT DISTINCT FROM lower(btrim(v_claim.claimed_gender))
             THEN NULL ELSE s.gender END,
         notes = CASE
           WHEN v_claim.filled_notes AND s.notes IS NOT DISTINCT FROM v_claim.claimed_notes
             THEN NULL ELSE s.notes END
   WHERE s.id = v_claim.student_id;

  UPDATE student_claims
     SET status = 'declined', decided_at = NOW(), decided_by = v_actor,
         filled_dob = FALSE, filled_gender = FALSE, filled_notes = FALSE
   WHERE id = p_claim_id;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_undone', 'Student', v_claim.student_id,
    jsonb_build_object(
      'claim_id', p_claim_id, 'parent_id', v_claim.parent_id,
      'reverted_dob', v_claim.filled_dob,
      'reverted_gender', v_claim.filled_gender,
      'reverted_notes', v_claim.filled_notes
    )
  );
END;
$$;
