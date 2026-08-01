-- ============================================================
-- merge_students() learns to move makeup_bookings.
--
-- THE TRIPWIRE WORKED. merge_students refuses to run while any cascading FK
-- into students exists that it has not been taught to move — and
-- makeup_bookings.student_id (20260802000100) is exactly the "future fifth
-- cascading table" its comment predicted. supabase test db failed loudly the
-- moment the table landed, instead of a merge eating bookings. This migration
-- is the teaching.
--
-- Body re-derived from 20260726000500 (§7.40 — the newest definition). The
-- changes: makeup_bookings joins the known-cascades allowlist, gets the same
-- move-then-drop-collisions treatment as trial_bookings (its live-slot unique
-- index has the same shape), joins the moved/dropped accounting and the
-- destroyed-rows invariant, and the result gains moved_makeup_bookings.
--
-- DROP + recreate, not CREATE OR REPLACE: the result type changes. The grants
-- a DROP takes with it (§7.35) are re-issued at the bottom of this file, in
-- the same transaction.
-- ============================================================

DROP FUNCTION IF EXISTS public.merge_students(UUID, UUID);

CREATE FUNCTION public.merge_students(
  p_survivor_id  UUID,
  p_duplicate_id UUID
)
RETURNS TABLE (
  moved_parent_links     INT,
  moved_trial_bookings   INT,
  moved_makeup_bookings  INT,
  moved_settlements      INT,
  moved_claims           INT,
  dropped_collisions     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_surv       students%ROWTYPE;
  v_dup        students%ROWTYPE;
  v_surv_att   INT;
  v_dup_att    INT;
  v_unknown    TEXT;
  v_ps INT := 0; v_tb INT := 0; v_mb INT := 0; v_ss INT := 0; v_cl INT := 0;
  v_drop INT := 0; v_drop_ps INT := 0; v_drop_tb INT := 0; v_drop_mb INT := 0;
  v_ps_before INT; v_tb_before INT; v_mb_before INT; v_ss_before INT;
  v_ps_after  INT; v_tb_after  INT; v_mb_after  INT; v_ss_after  INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_survivor_id = p_duplicate_id THEN
    RAISE EXCEPTION 'those are the same child';
  END IF;

  SELECT * INTO v_surv FROM students WHERE id = p_survivor_id;
  SELECT * INTO v_dup  FROM students WHERE id = p_duplicate_id;

  IF v_surv.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  IF v_surv.tenant_id <> v_dup.tenant_id THEN
    RAISE EXCEPTION 'those two children belong to different businesses';
  END IF;

  -- Tenant derived from the ROWS, never from a parameter (§7.42).
  IF NOT is_tenant_admin(v_surv.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may merge two children';
  END IF;

  -- ⚠ RISK 4 — THE STRUCTURAL GUARD. DO NOT REMOVE OR "SIMPLIFY" THIS.
  --
  -- This function ends in a DELETE, so every CASCADING foreign key into
  -- students silently takes rows with it. The mitigation cannot be a list in
  -- a comment that someone remembers to update. It is this: ask the CATALOGUE
  -- what cascades, and REFUSE if anything has appeared that this function has
  -- not been taught to move. makeup_bookings (2026-08-02) is the first table
  -- this guard actually caught — it failed the suite the moment the table
  -- landed, which is this list gaining its fifth entry.
  SELECT string_agg(conrelid::regclass::text, ', ')
    INTO v_unknown
    FROM pg_constraint
   WHERE confrelid = 'students'::regclass
     AND contype = 'f'
     AND confdeltype = 'c'
     AND conrelid::regclass::text NOT IN
         ('parent_students', 'student_settlements', 'trial_bookings',
          'student_claims', 'makeup_bookings');

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION
      'merge_students has not been taught to move %, which now CASCADES from students. Teach it before merging, or the merge will destroy those rows.',
      v_unknown;
  END IF;

  -- ── Direction. Asserted, never inferred silently. ───────────────────────
  SELECT count(*)::INT INTO v_surv_att FROM attendance WHERE student_id = p_survivor_id;
  SELECT count(*)::INT INTO v_dup_att  FROM attendance WHERE student_id = p_duplicate_id;

  IF v_surv_att > 0 AND v_dup_att > 0 THEN
    RAISE EXCEPTION
      'Both children have lessons recorded (% and %). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
      v_surv_att, v_dup_att;
  END IF;

  -- The survivor must be the row with the history. If the caller has them the
  -- wrong way round, REFUSE and say so rather than quietly swapping.
  IF v_dup_att > 0 THEN
    RAISE EXCEPTION
      'The child you marked as the duplicate is the one with % lessons recorded. Swap them: the record with the history must be the one that survives.',
      v_dup_att;
  END IF;

  IF EXISTS (SELECT 1 FROM invoice_items WHERE student_id = p_duplicate_id)
     OR EXISTS (SELECT 1 FROM credit_notes WHERE student_id = p_duplicate_id) THEN
    RAISE EXCEPTION
      'The duplicate record already appears on an invoice or credit note, so it cannot be deleted. Sort this one out by hand.';
  END IF;

  -- Counted before anything moves, so the invariant at the end is honest.
  SELECT count(*)::INT INTO v_ps_before FROM parent_students;
  SELECT count(*)::INT INTO v_tb_before FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_before FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_before FROM student_settlements;

  -- ── 1. The duplicate's better fields, ONLY where the survivor has none ──
  BEGIN
    UPDATE students
       SET date_of_birth = COALESCE(date_of_birth, v_dup.date_of_birth),
           gender        = COALESCE(gender,        v_dup.gender),
           notes         = COALESCE(notes,         v_dup.notes),
           level_id      = COALESCE(level_id,      v_dup.level_id),
           provisional_contact_name  = COALESCE(provisional_contact_name,  v_dup.provisional_contact_name),
           provisional_contact_phone = COALESCE(provisional_contact_phone, v_dup.provisional_contact_phone),
           provisional_contact_email = COALESCE(provisional_contact_email, v_dup.provisional_contact_email)
     WHERE id = p_survivor_id;
  EXCEPTION WHEN unique_violation THEN
    -- Filling the DOB can collide with a THIRD row of the same name and date.
    -- The merge is still correct; only the enrichment is impossible.
    NULL;
  END;

  -- ── 2. Parent links ─────────────────────────────────────────────────────
  WITH moved AS (
    UPDATE parent_students ps
       SET student_id = p_survivor_id
     WHERE ps.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM parent_students x
          WHERE x.student_id = p_survivor_id AND x.parent_id = ps.parent_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ps FROM moved;

  WITH dropped AS (
    DELETE FROM parent_students WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_ps FROM dropped;

  -- ── 3. Trial bookings ───────────────────────────────────────────────────
  WITH moved AS (
    UPDATE trial_bookings tb
       SET student_id = p_survivor_id
     WHERE tb.student_id = p_duplicate_id
       AND (
         tb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM trial_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = tb.class_id
              AND x.session_date = tb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_tb FROM moved;

  WITH dropped AS (
    DELETE FROM trial_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_tb FROM dropped;

  -- ── 3b. Make-up bookings — same live-slot rule as trials ────────────────
  -- makeup_bookings_live_slot_uniq is (student_id, class_id, session_date)
  -- WHERE cancelled_at IS NULL, so a live booking moves only if the survivor
  -- has no live booking in the same class on the same date.
  WITH moved AS (
    UPDATE makeup_bookings mb
       SET student_id = p_survivor_id
     WHERE mb.student_id = p_duplicate_id
       AND (
         mb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM makeup_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = mb.class_id
              AND x.session_date = mb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_mb FROM moved;

  WITH dropped AS (
    DELETE FROM makeup_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_mb FROM dropped;

  v_drop := v_drop_ps + v_drop_tb + v_drop_mb;

  -- ── 4. Settlements — no unique constraint, so all of them move ──────────
  WITH moved AS (
    UPDATE student_settlements SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ss FROM moved;

  -- ── 5. Claims ───────────────────────────────────────────────────────────
  UPDATE student_claims sc
     SET status = 'declined', decided_at = NOW()
   WHERE sc.student_id = p_duplicate_id
     AND sc.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM student_claims x
        WHERE x.student_id = p_survivor_id
          AND x.parent_id = sc.parent_id
          AND x.status = 'pending'
     );

  WITH moved AS (
    UPDATE student_claims SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_cl FROM moved;

  -- ── 6. Enrolments. Safe to delete: the duplicate has no attendance. ─────
  DELETE FROM student_class_enrolments WHERE student_id = p_duplicate_id;

  -- ── 7. The record of what was destroyed, BEFORE destroying it ───────────
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_surv.tenant_id, v_actor, 'students_merged', 'Student', p_survivor_id,
    to_jsonb(v_dup),
    jsonb_build_object(
      'survivor_id', p_survivor_id, 'duplicate_id', p_duplicate_id,
      'moved_parent_links', v_ps, 'moved_trial_bookings', v_tb,
      'moved_makeup_bookings', v_mb,
      'moved_settlements', v_ss, 'moved_claims', v_cl
    )
  );

  DELETE FROM students WHERE id = p_duplicate_id;

  -- ── 8. THE INVARIANT: a merge MOVES rows, it never destroys them. ───────
  SELECT count(*)::INT INTO v_ps_after FROM parent_students;
  SELECT count(*)::INT INTO v_tb_after FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_after FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_after FROM student_settlements;

  IF v_ss_after <> v_ss_before THEN
    RAISE EXCEPTION
      'merge lost % settlement row(s) — rolling back. A settlement is recorded revenue.',
      v_ss_before - v_ss_after;
  END IF;

  IF v_ps_after + v_tb_after + v_mb_after > v_ps_before + v_tb_before + v_mb_before THEN
    RAISE EXCEPTION 'merge invented rows — rolling back';
  END IF;

  IF (v_ps_before + v_tb_before + v_mb_before)
     - (v_ps_after + v_tb_after + v_mb_after) <> v_drop THEN
    RAISE EXCEPTION
      'merge lost % row(s) beyond the % deliberate collision drop(s) — rolling back',
      (v_ps_before + v_tb_before + v_mb_before)
        - (v_ps_after + v_tb_after + v_mb_after) - v_drop, v_drop;
  END IF;

  RETURN QUERY SELECT v_ps, v_tb, v_mb, v_ss, v_cl, v_drop;
END;
$$;

COMMENT ON FUNCTION public.merge_students(UUID, UUID) IS
  'Fold an empty duplicate into the child holding the history. Refuses if both carry attendance, if the direction is wrong, or if an unknown cascading FK into students has appeared.';

-- Re-issued in full: the DROP above took the previous grants with it (§7.35).
REVOKE ALL ON FUNCTION public.merge_students(UUID, UUID) FROM PUBLIC;
-- §7.39 — cloud default-grants; local does not reproduce them.
REVOKE EXECUTE ON FUNCTION public.merge_students(UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_students(UUID, UUID) TO authenticated;
