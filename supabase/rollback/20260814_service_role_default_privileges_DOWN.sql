-- ============================================================
-- ROLLBACK for 20260814000300 (turn OFF the service_role default-privilege grant).
-- NOT a migration — do not put this in supabase/migrations/. It lives here so it
-- exists BEFORE the deploy rather than being improvised during an incident.
--
-- WHY THIS FILE EXISTS. The forward migration only changes DEFAULT privileges —
-- it revokes NOTHING from any existing object (see its header). So the realistic
-- failure is not "a screen broke an hour ago"; it is a FUTURE migration that
-- creates a table/function `service_role` needs and forgets its explicit
-- `GRANT … TO service_role`, surfacing as `permission denied` inside an edge
-- function or admin route. The correct fix there is to add the missing grant to
-- THAT migration, not to roll this one back. This file is the blunt undo for the
-- case where the default itself must be restored — e.g. the change is judged to
-- have created more retrofit tax than it is worth.
--
-- WHAT THE PRE-CHANGE STATE WAS, on cloud (the only place it differs from local):
-- the pg_default_acl rows owned by `postgres` granted `service_role` the blanket
-- default —
--   • FUNCTIONS  — ALL (i.e. EXECUTE) on every new function
--   • TABLES     — ALL (arwdDxtm) on every new table
--   • SEQUENCES  — rwU (SELECT, UPDATE, USAGE) on every new sequence
-- The GRANTs below restore exactly that. `GRANT ALL` on each object type is the
-- literal prior state, written the other way round.
--
-- WHAT THIS DOES NOT NEED TO UNDO. The forward migration ran no existing-object
-- sweep, so there is nothing to re-grant on the 37 current tables — they kept
-- their service_role grants throughout. This restores only the DEFAULT for
-- objects created AFTER a rollback.
--
-- HOW TO RUN IT. There is no service-role key locally (§11.6), so a production
-- run goes through the dashboard SQL editor — the path with no migration record
-- and no CI. Write down what you ran, then take a fresh remote grant dump
-- (`docs/DEPLOYMENT.md` §11.7) to confirm the default row is back.
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
