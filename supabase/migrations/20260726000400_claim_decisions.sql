-- ============================================================
-- The admin's three verbs on a claim: approve, decline, undo.
-- (PARENT_CLAIM_PLAN.md phase 4, and RISK 1.)
--
-- ⚠ WHY undo_student_claim() SHIPS IN THE SAME MIGRATION AS APPROVE, AND MUST
-- NEVER BE SPLIT OUT OF IT.
--
-- Approving attaches a parent to a child, which hands them that child's
-- attendance, invoices and payment history. It is the highest-blast-radius
-- action in this slice. And the product has NO GENERIC WAY BACK:
--
--     parent_students_delete  USING (parent_id = current_parent_id()
--                                    OR is_platform_admin())
--
-- The PARENT can unlink and the PLATFORM admin can. The business's own admin —
-- the person clicking Approve — cannot. So without the function below, a
-- mis-approval is permanent in the shipped product and fixable only by SQL
-- against production, which is exactly where a bad afternoon comes from.
--
-- The tempting alternative was to widen parent_students_delete to tenant
-- admins. That is REJECTED: it grants a blanket delete over every family link
-- in the business in order to close a one-row problem, and RLS is row-level,
-- so there is no way to say "only the link you just made".
-- ============================================================

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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  -- The tenant comes from the CLAIM, never from the caller (§7.42).
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

  -- THE LINK ITSELF. link_invited_parent() is slice 1's function, proven on
  -- production, and it already refuses a child who has since gained a DIFFERENT
  -- parent — so the race between two admins deciding two claims is closed by
  -- REUSE rather than by a second copy of the rule. Do not inline the two
  -- inserts here.
  PERFORM link_invited_parent(v_profile, v_claim.student_id);

  -- ── Enrichment: fill a MISSING date of birth from what the parent typed ──
  -- This is the one thing that stops the same duplicate forming again. A NULL
  -- date of birth is exempt from students_identity_uniq, which is precisely why
  -- a coach-added child and a parent-added one become two rows silently.
  --
  -- Wrapped, because filling it in can COLLIDE with a third row that already
  -- has that name and date. If it does, keep the link and skip the enrichment:
  -- an unrelated collision must never fail an otherwise-correct approval.
  IF v_claim.claimed_dob IS NOT NULL THEN
    BEGIN
      UPDATE students
         SET date_of_birth = v_claim.claimed_dob
       WHERE id = v_claim.student_id
         AND date_of_birth IS NULL;
      v_dob := FOUND;
    EXCEPTION WHEN unique_violation THEN
      v_dob := FALSE;
    END;
  END IF;

  -- Gender and notes only where the business has recorded nothing. Never
  -- overwrite a value a coach set — they have met the child.
  -- claimed_gender is TEXT (it is whatever the parent's form sent); students
  -- .gender is the gender_type ENUM, so cast, and tolerate a value that is not
  -- one of the three rather than failing the whole approval over it.
  UPDATE students
     SET gender = COALESCE(
           gender,
           (CASE WHEN lower(btrim(COALESCE(v_claim.claimed_gender, '')))
                      IN ('male','female','other')
                 THEN lower(btrim(v_claim.claimed_gender))::gender_type END)
         ),
         notes  = COALESCE(notes, v_claim.claimed_notes)
   WHERE id = v_claim.student_id;

  UPDATE student_claims
     SET status = 'approved', decided_at = NOW(), decided_by = v_actor
   WHERE id = p_claim_id;

  -- ⚠ RISK 6: two parents may each hold a pending claim on the same child
  -- (student_claims_live_uniq is per parent+student). Approving one makes every
  -- other unapprovable — link_invited_parent() would refuse them — so close
  -- them HERE, in the same transaction, rather than leaving the admin to click
  -- a button that now errors.
  --
  -- decided_by is deliberately left NULL on these: nobody chose them, they are
  -- a consequence. The CHECK constraint permits exactly that.
  -- Aliased, because `student_id` is BOTH a column here and one of this
  -- function's OUT parameters — unqualified it is ambiguous and fails at
  -- runtime, not at creation time.
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
      'others_declined', v_others, 'dob_filled', v_dob
    )
  );

  RETURN QUERY SELECT v_claim.student_id, v_others, v_dob;
END;
$$;


CREATE OR REPLACE FUNCTION public.decline_student_claim(p_claim_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_claim student_claims%ROWTYPE;
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

  UPDATE student_claims
     SET status = 'declined', decided_at = NOW(), decided_by = v_actor
   WHERE id = p_claim_id;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_declined', 'Student', v_claim.student_id,
    jsonb_build_object('claim_id', p_claim_id, 'parent_id', v_claim.parent_id)
  );
END;
$$;


-- ── The way back. See the header for why this is not optional. ─────────────
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

  -- REFUSE once the link has been used for something an unlink cannot unwind.
  -- An invoice issued to this parent covering this child is a document that has
  -- been SENT; quietly detaching the child afterwards leaves a bill nobody in
  -- the app is attached to. Name the month so the admin can go and look.
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

  -- The claim goes back to DECLINED rather than pending: the admin has now
  -- actively decided this was wrong, and re-queueing it would ask them the same
  -- question again. The parent is unblocked either way.
  UPDATE student_claims
     SET status = 'declined', decided_at = NOW(), decided_by = v_actor
   WHERE id = p_claim_id;

  -- parent_tenants is deliberately LEFT ALONE. Membership is not the harm, and
  -- revoking it could evict a family who legitimately has other children here.
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_undone', 'Student', v_claim.student_id,
    jsonb_build_object('claim_id', p_claim_id, 'parent_id', v_claim.parent_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student_claim(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_student_claim(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_student_claim(UUID)    FROM PUBLIC;
-- §7.39 — cloud default-grants these to anon and service_role; local does not.
REVOKE EXECUTE ON FUNCTION public.approve_student_claim(UUID) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.decline_student_claim(UUID) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.undo_student_claim(UUID)    FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_student_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_student_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_student_claim(UUID)    TO authenticated;
