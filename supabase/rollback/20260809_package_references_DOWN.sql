-- ROLLBACK for 20260809000100_package_references.sql (Wave 1 Chunk 2, Step 2.1).
--
-- Committed, findable, and written BEFORE the deploy — the 2026-08-04 pattern
-- (a scratchpad backup nobody can find is not a rollback plan), and EXECUTED
-- rather than merely written (§7.93 — running the DOWN file is the half that
-- finds the bugs).
--
-- The migration is purely additive: two columns, two functions, two triggers,
-- one constraint. Nothing was REPLACEd, so there is no prior body to restore.
--
-- WHAT YOU LOSE BY RUNNING THIS: every package reference already minted is
-- DESTROYED with the column, and the per-tenant counter with it. Re-applying
-- the migration afterwards renumbers from 1 by requested_at — so a parent who
-- has already been shown PKG-2026-0003 and paid against it may be renumbered.
-- If any package payment has been collected against a reference, EXPORT
-- `SELECT id, tenant_id, reference_number FROM parent_packages` first.
--
-- The app side (the package dynamic QR, the admin Packages reference column)
-- reads reference_number and must be rolled back with it — revert the app
-- commit and redeploy, or the parent's PayNow screen falls back to the static
-- image path (which is the pre-2026-08-09 behaviour, so it degrades safely).

BEGIN;

-- ── Triggers first: they depend on the functions and the column ──────────────
DROP TRIGGER IF EXISTS trg_pin_parent_package_reference ON public.parent_packages;
DROP TRIGGER IF EXISTS trg_parent_package_reference ON public.parent_packages;

DROP FUNCTION IF EXISTS public.pin_parent_package_reference();
DROP FUNCTION IF EXISTS public.assign_parent_package_reference();
DROP FUNCTION IF EXISTS public.next_package_ref(UUID, TEXT);

-- ── The constraint, then the columns ─────────────────────────────────────────
ALTER TABLE public.parent_packages
  DROP CONSTRAINT IF EXISTS parent_packages_tenant_reference_key;

ALTER TABLE public.parent_packages
  DROP COLUMN IF EXISTS reference_number;

ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS package_counter;

COMMIT;

-- Verify (§7.93 — diff, do not assume):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'parent_packages'::regclass AND NOT tgisinternal;
--     → trg_parent_package_lifecycle only.
--   SELECT proname FROM pg_proc WHERE proname LIKE '%package_ref%';
--     → zero rows.
--   \d parent_packages   → no reference_number.
--   \d tenants           → no package_counter.
