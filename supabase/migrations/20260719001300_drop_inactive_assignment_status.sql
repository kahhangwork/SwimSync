-- ============================================================
-- ACTIVE / INACTIVE — phase 6 (CONTRACT): one spelling of "inactive".
--
-- `assignment_status` answers ONE question — "is this child in a class?" — so
-- its values are now `unassigned | assigned`. Whether they are still a customer
-- is `students.is_active`, a separate axis, because a child can be ACTIVE BUT
-- UNASSIGNED (a new signup awaiting placement) and collapsing the two is what
-- made "inactive" ambiguous in the first place.
--
-- ⚠️ DEPLOY ORDER INVERTS HERE. Every other migration in this feature is
-- additive, so migrations go first. This one DROPS, so the APP DEPLOYS FIRST:
-- the live parent status chip reads this column, and a running build that still
-- expects 'inactive' must be gone before the value is. Getting this backwards
-- broke class editing in production earlier the same day (§7.27).
--
-- ⚠️ A FUNCTION BODY IS NOT A TRACKED DEPENDENCY (§7.21). Dropping an enum
-- value that a function CASTS to succeeds at migration time and then fails at
-- RUNTIME, on whatever coach- or admin-facing path calls it. close_student_
-- enrolment() cast 'inactive'::assignment_status until phase 2 rewrote it. The
-- guard below refuses rather than trusting that.
-- ============================================================

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(proname, ', ') INTO v_bad
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND (prosrc LIKE '%''inactive''::assignment_status%'
       OR prosrc LIKE '%assignment_status = ''inactive''%');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing to drop the enum value: function body(s) still reference it (%). '
      'Postgres does not track function bodies as dependencies, so this would '
      'fail at runtime rather than here.', v_bad;
  END IF;
END $$;

-- Any child still carrying the retired value becomes `unassigned` AND inactive.
-- Both halves matter: 'inactive' meant "gone", and only is_active records that
-- now. Doing just the enum half would quietly resurrect departed children as
-- children awaiting a class.
UPDATE students
   SET is_active      = FALSE,
       inactivated_at = COALESCE(inactivated_at, updated_at),
       assignment_status = 'unassigned'
 WHERE assignment_status = 'inactive';

-- Postgres cannot remove a value from an enum in place: build the new type,
-- swap the column onto it, drop the old one.
ALTER TYPE assignment_status RENAME TO assignment_status_old;
CREATE TYPE assignment_status AS ENUM ('unassigned', 'assigned');

ALTER TABLE students
  ALTER COLUMN assignment_status DROP DEFAULT,
  ALTER COLUMN assignment_status TYPE assignment_status
    USING assignment_status::TEXT::assignment_status,
  ALTER COLUMN assignment_status SET DEFAULT 'unassigned';

DROP TYPE assignment_status_old;

COMMENT ON COLUMN students.assignment_status IS
  'Is this child in a class right now? unassigned | assigned. NOT whether they '
  'are still a customer — that is students.is_active, a separate axis. A new '
  'signup is active but unassigned.';
