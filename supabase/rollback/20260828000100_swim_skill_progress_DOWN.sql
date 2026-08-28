-- ============================================================================
-- ROLLBACK for 20260828000100_swim_skill_progress.sql
--
-- Committed BEFORE the deploy and REHEARSED — running the DOWN is the half that
-- finds the bugs (§7.93).
--
-- Removes the two new tables and their triggers, and RESTORES merge_students to
-- its pre-migration body (20260802000500 — the newest before this one, §7.40),
-- because the up-migration DROP+CREATEd it to learn student_skill_progress.
--
-- DATA LOSS is expected and acceptable here: dropping the tables discards every
-- recorded grade and each tenant's grade scale. That is the correct meaning of
-- rolling back a feature that added them — there is nowhere else those rows
-- belong. Nothing else references them (the FKs point INTO these tables, never
-- out), so no other table is touched.
-- ============================================================================

BEGIN;

-- ── 1. The per-child progress table (releases its RESTRICT FKs) ─────────────
DROP TRIGGER IF EXISTS trg_skill_progress_tenant ON student_skill_progress;
DROP FUNCTION IF EXISTS enforce_skill_progress_tenant();
DROP TABLE IF EXISTS student_skill_progress;

-- ── 2. The grade scale + its seed trigger ───────────────────────────────────
DROP TRIGGER IF EXISTS trg_seed_skill_grade_levels ON tenants;
DROP FUNCTION IF EXISTS seed_default_skill_grade_levels();
DROP TABLE IF EXISTS skill_grade_levels;

-- ── 3. Restore merge_students to its 20260802000500 body ────────────────────
-- Byte-for-byte the definition this migration replaced, minus the
-- student_skill_progress handling it added. DROP + recreate (the result type
-- loses moved_skill_progress); grants re-issued below (§7.35).
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

  IF NOT is_tenant_admin(v_surv.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may merge two children';
  END IF;

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

  SELECT count(*)::INT INTO v_surv_att FROM attendance WHERE student_id = p_survivor_id;
  SELECT count(*)::INT INTO v_dup_att  FROM attendance WHERE student_id = p_duplicate_id;

  IF v_surv_att > 0 AND v_dup_att > 0 THEN
    RAISE EXCEPTION
      'Both children have lessons recorded (% and %). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
      v_surv_att, v_dup_att;
  END IF;

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

  SELECT count(*)::INT INTO v_ps_before FROM parent_students;
  SELECT count(*)::INT INTO v_tb_before FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_before FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_before FROM student_settlements;

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
    NULL;
  END;

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

  WITH moved AS (
    UPDATE student_settlements SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ss FROM moved;

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

  DELETE FROM student_class_enrolments WHERE student_id = p_duplicate_id;

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

REVOKE ALL ON FUNCTION public.merge_students(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_students(UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_students(UUID, UUID) TO authenticated;

COMMIT;
