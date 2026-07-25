-- ============================================================
-- ROLLBACK for the 2026-07-26 parent-claim work. NOT a migration — do not put
-- this in supabase/migrations/. It lives here so it exists BEFORE the deploy
-- rather than being improvised during an incident.
--
-- WHAT ACTUALLY NEEDS UNDOING. Four of the five migrations are purely additive
-- (a new table, four new functions) and an older build simply ignores them.
-- Exactly ONE is a contract: 20260726000600 removed the PARENT branch from
-- students_insert, because add_child_or_claim() took that path over.
--
-- So this is the minimum that makes an older app work again, and nothing more:
-- a build that predates this slice inserts into `students` directly, and that
-- insert is refused until the policy below is restored. Add Child is the ONE
-- path every new family walks, so this is the highest-urgency rollback in the
-- repo — hence the small, single-statement shape.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   • It does NOT drop student_claims. Rows there are parents' real requests,
--     and a claim already approved has produced a real parent_students link
--     that dropping the table would not (and must not) reverse.
--   • It does NOT drop the functions. An older build never calls them, and a
--     dropped function is a re-deploy away from a broken forward path.
--   • It does NOT undo any approved claim or completed merge. Those are
--     deliberate operator decisions on real data, not schema.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS students_insert ON students;

-- Verbatim the policy as it stood in 20260718000900_tenant_rls.sql — taken from
-- the LIVE definition via pg_policy, not retyped from the file whose name
-- matched (§7.40, which has now fired twice on this codebase).
CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    -- A parent may only create a child in a tenant they have joined.
    OR (current_parent_id() IS NOT NULL AND parent_in_tenant(tenant_id))
    OR is_tenant_admin(tenant_id)
  );

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- Expect the WITH CHECK expression to mention current_parent_id again:
--
--   SELECT pg_get_expr(polwithcheck, polrelid)
--     FROM pg_policy WHERE polname = 'students_insert';
--
-- And prove it for real, which the expression alone does not: sign in as a
-- parent in the app and add a child. A policy that reads correctly and refuses
-- anyway is the failure mode worth ten seconds of checking.
--
-- ── If you then need to go FORWARD again ──────────────────────────────────
-- Re-running 20260726000600 is safe: it is a DROP POLICY IF EXISTS followed by
-- a CREATE, with no data involved.
