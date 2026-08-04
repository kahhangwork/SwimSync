-- ============================================================
-- ROLLBACK for 20260804000600 (the `authenticated` table-grant whitelist).
-- NOT a migration — do not put this in supabase/migrations/. It lives here so
-- it exists BEFORE the deploy rather than being improvised during an incident.
--
-- WHY THIS FILE EXISTS. Every deploy since tenancy has been additive enough
-- that "revert the Vercel build" was a sufficient undo. This one is not:
-- 20260804000600 REVOKES privileges from the role every signed-in user runs
-- as. If its whitelist is wrong — one table missed, one command missed — the
-- symptom is a real parent or coach getting `permission denied for table …`
-- on a screen that worked an hour ago. Reverting the app does not restore a
-- revoked grant.
--
-- WHAT THE PRE-CHANGE STATE ACTUALLY WAS, measured on 2026-08-04 rather than
-- assumed. Both databases were identical here, and both were the blanket
-- default rather than anything a migration wrote:
--   • local  — `authenticated` held all 7 privileges (SELECT, INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES, TRIGGER) on all 37 tables in `public`.
--   • remote — the schema dump carried `GRANT ALL ON TABLE "public"."<t>" TO
--     "authenticated";` for all 37, i.e. the same thing written the other way.
-- That is why the restore below is a single blanket GRANT: it is not a
-- convenience, it is the literal prior state.
--
-- HOW TO RUN IT. There is no service-role key locally (§11.6), so production
-- runs go through the dashboard SQL editor — the path with no migration record
-- and no CI. Write down what you ran.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT UNDO ────────────────────────────────
-- 20260804000500 is a SEPARATE migration and a SECURITY fix: it dropped
-- `parent_tenants_insert` and `parent_students_insert`, the two policies that
-- let a self-registered stranger join any business without a join code and
-- attach themselves to any child by UUID (all three exploits reproduced —
-- HTTP 201, 201, 200 — see that migration's header). **Do not roll that back
-- to fix a grant problem.**
--
-- Note what the blanket GRANT below does and does not reopen: it does restore
-- INSERT on `parent_tenants` and `parent_students`, but with those two policies
-- dropped RLS still denies the INSERT, because a table with RLS enabled and no
-- matching policy denies by default. The grant alone is not the hole; the
-- policy was. Running this file does not undo the security fix.
-- ============================================================

-- 1. Restore the blanket grant on every existing table.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- 2. Restore the mechanism that granted new objects automatically. Without
--    this, tables created after the rollback would still be born unreachable
--    and the outage would return one migration later.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO authenticated;

-- 3. Confirm. Expect 37 rows, each reading exactly 7 privileges.
SELECT table_name, count(*) AS privilege_count
  FROM information_schema.role_table_grants
 WHERE grantee = 'authenticated' AND table_schema = 'public'
 GROUP BY table_name
HAVING count(*) <> 7;
-- ^ returns ZERO rows when the restore is complete.
