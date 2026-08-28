-- ROLLBACK for 20260829000100_grading_admin_only.sql
--
-- Restores 20260828000100's two artefacts exactly: the write policy with its
-- coach arm, and the trigger body whose stamp fires only on a grade CHANGE.
--
-- REHEARSED, not merely written (§7.93) — running the DOWN is the half that
-- finds the bugs. Rehearsal: apply the UP, run this, confirm `supabase test db`
-- goes RED on the flipped assertions (a serving coach succeeds again), then
-- re-apply the UP and confirm green.
--
-- SAFE TO RUN AT ANY TIME. Nothing here touches data — no row is written,
-- deleted or re-stamped. Grades already recorded keep whatever graded_by /
-- graded_at they hold; the only effect is on FUTURE writes. In particular this
-- does NOT un-stamp a re-confirmation that the UP recorded, and it should not
-- try to: that timestamp is a true record of when someone confirmed the grade.
--
-- WHAT COMES BACK, AND ITS CONSEQUENCE. Restoring the coach arm re-opens the
-- coach write path at the database. If the apps have already been deployed, the
-- coach app's grading UI is gone, so nothing exercises it — the permission
-- simply sits unused until the apps are rolled back too. Rolling this back
-- WITHOUT rolling back the apps is therefore safe but pointless; the reason to
-- run it is a full revert of the release.

-- ── 1. Restore the coach write arm ──────────────────────────────────────────
DROP POLICY student_skill_progress_write ON student_skill_progress;

CREATE POLICY student_skill_progress_write ON student_skill_progress
  FOR ALL
  USING (can_admin_tenant(tenant_id) OR coach_serves_student(student_id))
  WITH CHECK (can_admin_tenant(tenant_id) OR coach_serves_student(student_id));

COMMENT ON TABLE student_skill_progress IS
  'One graded row per (student, skill). Grade is a skill_grade_levels rank; '
  '"done" = top rank, computed at read time. Written by the coach who serves the '
  'child (or an admin); read by staff and the owning parent. Records survive a '
  'level change. See docs/plans/WAVE_C_SPOOL_PLAN.md.';

-- ── 2. Restore the change-only stamp ────────────────────────────────────────
-- Byte-identical to 20260828000100's body, including its comments — a DOWN that
-- paraphrases the thing it restores is how the two silently diverge.
CREATE OR REPLACE FUNCTION enforce_skill_progress_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_tenant UUID;
  v_skill_tenant   UUID;
  v_grade_tenant   UUID;
BEGIN
  SELECT tenant_id INTO v_student_tenant FROM students WHERE id = NEW.student_id;
  IF v_student_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'skill progress tenant must match the student''s business'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT l.tenant_id INTO v_skill_tenant
    FROM tenant_level_skills s
    JOIN tenant_levels l ON l.id = s.level_id
   WHERE s.id = NEW.skill_id;
  IF v_skill_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that skill belongs to another business'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT tenant_id INTO v_grade_tenant FROM skill_grade_levels WHERE id = NEW.grade_level_id;
  IF v_grade_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that grade level belongs to another business'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Server-authoritative audit stamp (auth.uid() reads the JWT, not the DEFINER
  -- role, so it is still the real caller here). NULL for backend/service writes.
  -- Only when the GRADE is set or changed — a bare student_id repoint (what
  -- merge_students does when folding a duplicate) must preserve the original
  -- grader and time, not re-attribute the record to whoever ran the merge.
  IF TG_OP = 'INSERT' OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id THEN
    NEW.graded_by := auth.uid();
    NEW.graded_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_skill_progress_tenant() IS NULL;
