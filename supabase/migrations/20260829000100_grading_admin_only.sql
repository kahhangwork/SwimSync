-- Swim-skill grading becomes ADMIN-ONLY, and graded_at becomes a usable
-- "when was this last confirmed" timestamp.
--
-- Plan: docs/plans/GRADING_ADMIN_ONLY_PLAN.md (all product decisions settled
-- there, plus the eight /plan-review risks and their mitigations).
--
-- WHY. 20260828000100 shipped grading with a per-STUDENT coach write predicate:
-- the coach who serves a child grades them. The business owner's decision
-- (2026-08-28, the session after) is that grading is an ADMINISTRATIVE record
-- the business controls, not a per-coach act — the coach app stays
-- attendance-only. So the write arm narrows to the tenant's admins.
--
-- This is a POLICY narrowing, not a data change: grading is dormant on prod
-- (zero rows — asserted by a count before this is pushed, see the plan's Stage
-- 3), so no coach's work is stranded and no backfill is needed.

-- ── 1. Write is admin-only ──────────────────────────────────────────────────
-- DROP + CREATE rather than an ALTER: a policy's USING/WITH CHECK cannot be
-- edited in place, and naming the whole predicate is what makes the diff
-- reviewable.
--
-- NO GRANT CHANGE, AND THE REASON IS NOT §11.32. §11.32's no-dump pattern is
-- specifically a same-signature CREATE OR REPLACE FUNCTION; this is a policy.
-- The correct argument is simpler and stronger: A POLICY CARRIES NO ACL. Grants
-- live on the table and are untouched here, and an admin-armed FOR ALL policy
-- still permits INSERT/UPDATE/DELETE, so every existing privilege remains one
-- that some policy could exercise — which is exactly what
-- supabase/tests/table_grants.test.sql asserts (§7.87). It stays green, and no
-- remote grant dump is required (§7.39/§7.89 do not apply).
DROP POLICY student_skill_progress_write ON student_skill_progress;

-- The SELECT policy is DELIBERATELY UNCHANGED. Staff read stays: the coach app
-- still renders a child's grades read-only on the roster's Skills screen, and
-- narrowing SELECT here would blank that screen. Read and write are different
-- questions and this migration answers only the second.
CREATE POLICY student_skill_progress_write ON student_skill_progress
  FOR ALL
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

COMMENT ON TABLE student_skill_progress IS
  'One graded row per (student, skill). Grade is a skill_grade_levels rank; '
  '"done" = top rank, computed at read time. Written ONLY by an admin of the '
  'business (20260829000100 — grading is an administrative record, not a '
  'per-coach act); read by staff and the owning parent. graded_by/graded_at mean '
  '"who last CONFIRMED this grade, and when" — see the trigger below. Records '
  'survive a level change. See docs/plans/GRADING_ADMIN_ONLY_PLAN.md.';

-- ── 2. graded_at must advance on a RE-CONFIRMATION, not only on a change ────
-- THE BUG THIS FIXES, AND WHY IT IS LOAD-BEARING.
--
-- Assessment is a periodic EVENT: every ~3 months an admin tours every class.
-- The grid shows each skill's CURRENT grade, so a child graded 'Competent' in
-- June looks identical to one graded 'Competent' this morning — and the
-- assessor skips them believing it is done. The Assessment tab closes that by
-- rendering anything older than the round's start date as stale.
--
-- That mechanism reads graded_at, and the ORIGINAL condition only stamped when
-- grade_level_id CHANGED. So re-confirming a child at the same grade — the most
-- common act of an assessment day — wrote a row but left graded_at in June, and
-- the child stayed "unassessed" for ever. The round mechanism would have shipped
-- the exact oversight it exists to prevent.
--
-- THE CONDITION IS WRITTEN AS ITS CONTRAPOSITIVE, DELIBERATELY. The positive
-- form (INSERT OR grade changed OR student unchanged) has the same truth table
-- but reads as a puzzle. This form states the rule directly: STAMP UNLESS THIS
-- IS A BARE student_id REPOINT — which is precisely, and only, what
-- merge_students() does when it folds a duplicate (20260828000100 §3c sets
-- student_id and nothing else). That preservation is a contract, not an
-- accident: a merge must not re-attribute a child's earned record to whoever
-- happened to run it. pgTAP pins both halves.
--
-- ⚠ NAMED PROHIBITION — A DIRECT graded_at DATA FIX NOW NEEDS DISABLE TRIGGER.
-- Every non-repoint UPDATE stamps from here on, so a future service_role
-- backfill that tries to correct graded_at will have its value clobbered to
-- NOW() and its graded_by nulled. Any such fix MUST wrap itself in
--   ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
--   … ; ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;
-- The pgTAP suite's own backdating fixture does exactly this, and is the worked
-- example. There is no structural guard against forgetting; this comment is
-- placed where the person writing that backfill will read it.
--
-- ATTRIBUTION SEMANTICS, STATED SO IT IS A DECISION AND NOT A SURPRISE: after
-- this migration graded_by means "who last CONFIRMED this grade", not "who
-- first awarded it". That is the right meaning for a round-based tool — the
-- round asks who looked at this child today. It is lossless only because prod
-- holds zero graded rows at deploy time; the plan's Stage 3 turns that premise
-- into a query that must return 0 before this is pushed.
--
-- Everything above the stamp is UNCHANGED from 20260828000100: the three
-- cross-tenant checks RLS cannot see, SECURITY DEFINER so RLS cannot hide a
-- sibling row from the lookups (§7.125), and no INSERT-only assumption so an
-- upsert-resolved UPDATE is governed identically (§7.57).
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
  -- Stamp on every write EXCEPT a bare student_id repoint — see the header.
  IF NOT (TG_OP = 'UPDATE'
          AND NEW.student_id     IS DISTINCT FROM     OLD.student_id
          AND NEW.grade_level_id IS NOT DISTINCT FROM OLD.grade_level_id) THEN
    NEW.graded_by := auth.uid();
    NEW.graded_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_skill_progress_tenant() IS
  'BEFORE INSERT OR UPDATE on student_skill_progress: refuses a row whose '
  'student, skill or grade level belongs to another business (the cross-table '
  'hole RLS cannot see), and stamps graded_by/graded_at on every write EXCEPT a '
  'bare student_id repoint — which is merge_students() folding a duplicate, and '
  'must preserve the original grader. A direct graded_at data fix must DISABLE '
  'TRIGGER trg_skill_progress_tenant first.';
