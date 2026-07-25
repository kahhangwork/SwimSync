-- ============================================================
-- Let a parent clear a decided claim off their home screen.
--
-- Reported from production 2026-07-26: a declined claim showed a notice that
-- NEVER DISAPPEARED. The parent screen reads every claim with status pending
-- or declined, with no dismissal and no time bound, so a one-off "your coach
-- checked, that wasn't your child" became a permanent fixture of the app.
--
-- WHY A COLUMN AND NOT THE EXISTING 'withdrawn' STATUS. Reusing it would erase
-- the fact that the ADMIN DECLINED this — the status is the record of who
-- decided and what they decided, and overwriting it to mean "the parent has
-- read the notice" destroys an audit trail to save a migration.
--
-- WHY NOT AUTO-EXPIRE AFTER N DAYS. A notice that vanishes on its own is worse
-- than one you dismiss: the parent cannot tell whether they dealt with it or
-- simply missed it, and there is no moment at which the app knows they have
-- read it. An explicit tap is the only honest signal.
--
-- ⚠ ONLY A DECIDED CLAIM CAN BE DISMISSED. A PENDING one is live state — it is
-- the thing BLOCKING this parent from re-adding that child (add_child_or_claim
-- returns 'already_pending'), so letting them hide it would leave them blocked
-- with nothing on screen explaining why.
-- ============================================================

ALTER TABLE student_claims ADD COLUMN dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN student_claims.dismissed_at IS
  'When the PARENT cleared this from their home screen. Never set on a pending claim — that one is live state and explains why they are blocked.';

CREATE OR REPLACE FUNCTION public.dismiss_student_claim(p_claim_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent UUID := current_parent_id();
  v_claim  student_claims%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  -- Their own claim only. student_claims has no UPDATE policy at all, so this
  -- gate is the whole boundary — the same arrangement as every other writer on
  -- this table.
  IF v_parent IS NULL OR v_claim.parent_id <> v_parent THEN
    RAISE EXCEPTION 'that is not your request';
  END IF;

  IF v_claim.status = 'pending' THEN
    RAISE EXCEPTION 'that request is still being checked by your coach';
  END IF;

  UPDATE student_claims SET dismissed_at = NOW() WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_student_claim(UUID) FROM PUBLIC;
-- §7.39 — cloud default-grants new functions to anon and service_role.
REVOKE EXECUTE ON FUNCTION public.dismiss_student_claim(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_student_claim(UUID) TO authenticated;
