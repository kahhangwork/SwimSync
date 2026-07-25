-- ============================================================
-- ROLLBACK for the 2026-07-25 trials work. NOT a migration — do not put this
-- in supabase/migrations/. It lives here so it exists BEFORE the deploy rather
-- than being improvised during an incident.
--
-- WHY THIS FILE EXISTS AT ALL. Every deploy since tenancy has been purely
-- additive, so "revert the Vercel build" has always been a sufficient undo.
-- It is not here: 20260725000400 WRITES TO LIVE ROWS (it backfills every
-- class's category) and adds a NOT NULL constraint to a central table.
-- Reverting the app does not remove a constraint.
--
-- WHEN YOU WOULD RUN THIS. Only if the app has to be rolled back to a build
-- that predates 20260725000400 — that build's class form treats the category as
-- optional, so it cannot satisfy NOT NULL and class creation breaks.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   • It does NOT clear classes.category_id. Those values are correct and
--     harmless to an older build, which simply ignores the column. Blanking
--     them would throw away the backfill for nothing.
--   • It does NOT drop class_categories rows. They are a business's own data.
--   • It does NOT drop trial_rates or trial_bookings. Dropping a table that has
--     priced or scheduled anything is a worse outcome than leaving it unused;
--     an older build does not read them.
--
-- So this is the MINIMUM that makes an older app work again, and nothing more.
-- ============================================================

BEGIN;

-- 1. Let a class exist without a category again.
ALTER TABLE classes ALTER COLUMN category_id DROP NOT NULL;

-- 2. Restore the original delete behaviour. With the column nullable,
--    SET NULL is coherent again: deleting a category un-categorises its
--    classes, which pushes them out of scoped packages (under-covers, never
--    over-draws) — the reasoning in 20260720000100.
ALTER TABLE classes DROP CONSTRAINT classes_category_id_fkey;
ALTER TABLE classes
  ADD CONSTRAINT classes_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES class_categories(id) ON DELETE SET NULL;

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- Expect: is_nullable = YES, and confdeltype = 'n' (SET NULL).
--
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name = 'classes' AND column_name = 'category_id';
--
--   SELECT confdeltype FROM pg_constraint
--    WHERE conname = 'classes_category_id_fkey';
--
-- ── If you then need to go FORWARD again ──────────────────────────────────
-- Re-running 20260725000400 is safe: its category creation skips names that
-- already exist, its backfill only touches NULL rows, and its self-check
-- raises rather than leaving a class untagged.
