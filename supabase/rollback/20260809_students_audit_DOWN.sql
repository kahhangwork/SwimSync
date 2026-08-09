-- ROLLBACK for 20260809000200_students_audit_trigger.sql (Wave 1 Chunk 3, Step 3.1).
--
-- Committed, findable, and written BEFORE the deploy — the 2026-08-04 pattern (a
-- scratchpad backup nobody can find is not a rollback plan), and EXECUTED rather
-- than merely written (§7.93 — running the DOWN file is the half that finds the
-- bugs).
--
-- The migration is purely additive: one function, one trigger, two COMMENTs.
-- Nothing was CREATE OR REPLACEd over an existing body, so there is no prior
-- definition to restore.
--
-- WHAT YOU LOSE BY RUNNING THIS: nothing already written. The `student_updated`
-- rows stay in audit_log — this only stops new ones being recorded. Re-applying
-- the migration afterwards resumes recording with no gap other than the window
-- the rollback was in force.
--
-- NOTHING IN EITHER APP READS audit_log, so there is no app-side rollback to
-- pair with this and no deploy ordering to get right. If that ever changes, a
-- history screen would go from "no student edits" to "no student edits" — the
-- §7.94 shape, where the absence is indistinguishable from a quiet table.
--
-- The two COMMENT ON COLUMNs are restored to the state they were in before this
-- migration: there were none, so both are dropped.

BEGIN;

DROP TRIGGER IF EXISTS trg_audit_student_update ON public.students;

DROP FUNCTION IF EXISTS public.audit_student_update();

COMMENT ON COLUMN public.audit_log.old_value IS NULL;
COMMENT ON COLUMN public.audit_log.new_value IS NULL;

COMMIT;
