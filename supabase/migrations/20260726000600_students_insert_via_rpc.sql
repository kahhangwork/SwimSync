-- ============================================================
-- Close the parent's direct INSERT into `students`.
-- (PARENT_CLAIM_PLAN.md phase 2, RISK 2.)
--
-- ⚠ THIS IS A CONTRACT, NOT AN EXPANSION. IT MUST BE PUSHED **AFTER** THE APP
-- IS LIVE, AND IT IS DELIBERATELY IN ITS OWN FILE SO IT CAN BE ROLLED BACK
-- ALONE. The four migrations before it are additive and could go first; this
-- one breaks any build that still inserts directly. See §6's expand/contract
-- rule and §7.27 — a previous deploy got exactly this backwards and shipped an
-- admin calling an RPC that did not exist yet.
--
-- WHY NARROW IT AT ALL. add_child_or_claim() checks for an existing roster
-- entry BEFORE creating a child. If the parent can still INSERT directly, that
-- check lives only in the client and §7.8 is unambiguous about what that is
-- worth: A SAFETY GATE THAT THE ONLY LIVE CALLER BYPASSES IS NOT A GATE. The
-- whole point of the slice is that the duplicate is never created.
--
-- WHAT DOES NOT CHANGE. The platform admin and the business's admin keep their
-- branches untouched — the admin Students page inserts directly and should.
-- Only the parent branch moves, and it moves into a SECURITY DEFINER function
-- that re-checks the very same predicate (parent_in_tenant), so the boundary
-- has not been widened or narrowed, only relocated.
--
-- ROLLBACK: supabase/rollback/20260726_parent_claim_DOWN.sql, which restores
-- the policy below to its previous form. Written and executed BEFORE this was
-- pushed, not improvised during an incident.
-- ============================================================

DROP POLICY IF EXISTS students_insert ON students;

CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    -- A parent's own path is add_child_or_claim() (20260726000300). It runs as
    -- SECURITY DEFINER, so it is not subject to this policy at all — which is
    -- exactly why the parent branch can be removed here without breaking Add
    -- Child. Removing it is what makes the duplicate check unskippable.
    OR is_tenant_admin(tenant_id)
  );

COMMENT ON POLICY students_insert ON students IS
  'Admins only. A parent creates a child through add_child_or_claim(), which checks for an existing roster entry first — a check the client must not be able to skip.';
