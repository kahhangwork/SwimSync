-- Retire the fixed swimming_ability enum, superseded by tenant_levels.
--
-- ⚠️ THIS IS A CONTRACT MIGRATION — DEPLOY THE APPS FIRST.
--
-- Expand/contract runs in opposite directions (HANDOVER §6, §7.27):
--   • ADDING   → migrate first, then push (the new UI queries the new table).
--   • DROPPING → push first, then migrate (the LIVE app still reads the old
--                column until the new bundle is actually being served).
--
-- Six screens selected swimming_ability. Applying this before the deployed
-- bundle stops asking for it makes every one of them fail: parent home, parent
-- child detail, coach roster, admin dashboard, admin students, admin
-- unassigned. Nothing in that list is optional — it is most of both apps.
--
-- ORDER, EXPLICITLY:
--   1. `supabase db push` — applies every EXPAND migration up to 002000.
--   2. Merge and push to main. Vercel builds BOTH projects, but they are
--      SEPARATE projects and deploy independently (§7.23) — confirm the
--      surface you changed, comparing a known-good route against a known-bad.
--   3. Only then `supabase db push` again, which applies THIS migration alone.
--
-- NUMBERED 002100, AFTER the expand migrations, deliberately: `supabase db
-- push` applies everything pending in one go, so a contract migration sitting
-- in the middle (it was 001900) cannot be held back without moving the file
-- out of the directory. Being last is what makes the two-phase deploy a plain
-- `db push`, run twice.
--
-- ROLLBACK, if this is applied too early: re-add the column as nullable. It
-- was always NULL, so nothing is lost by re-adding it and nothing was lost by
-- dropping it.
--     ALTER TABLE students ADD COLUMN swimming_ability swimming_ability;
--
-- WHY DROP AT ALL, rather than leaving a harmless unused column: leaving it is
-- exactly the second-source-of-truth this session removed from `age`. A
-- permanently-NULL "level" column beside a real one guarantees someone
-- eventually writes to the wrong one.
--
-- The column was ALWAYS NULL — parents never set it (PRD §5.1) and nothing in
-- the codebase ever wrote it — so there is no data to migrate into
-- tenant_levels. Verified below rather than assumed.

DO $$
DECLARE v_set INTEGER;
BEGIN
  SELECT count(*) INTO v_set FROM students WHERE swimming_ability IS NOT NULL;
  IF v_set > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop swimming_ability: % student(s) have a value. Migrate them into tenant_levels first.', v_set;
  END IF;
END $$;

ALTER TABLE students DROP COLUMN swimming_ability;

-- Postgres does NOT track function bodies as dependencies (§7.21), so dropping
-- the type would not error on a function that names it — it would fail at
-- runtime instead, on a live path. Checked here:
--   grep -rn "swimming_ability" supabase/migrations/
DROP TYPE swimming_ability;
