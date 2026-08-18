-- ============================================================
-- Holiday attendance, step 2 of 4: the per-tenant extension length.
--
-- How many days a single public holiday adds to a package's validity when a
-- lesson it would have funded is marked 'holiday'. Business-configurable, because
-- "give back a week" is one school's convention and not another's. Default 7
-- (one week), the previous hard-coded behaviour of recompute_package_extensions.
--
-- Mirrors tenants.invoice_run_day exactly: a plain SMALLINT with a CHECK, edited
-- by the tenant admin through the existing tenants_update policy — NO new grant or
-- policy is needed (20260718000900_tenant_rls.sql already GRANTs UPDATE on tenants
-- to authenticated and gates it by can_admin_tenant(id)).
--
-- 0 is legal and means "a holiday voids charges but extends nothing" — the
-- reconcile trigger (20260818000700) writes no state row in that case, so it never
-- churns a zero-day extension.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN holiday_extension_days SMALLINT NOT NULL DEFAULT 7
    CHECK (holiday_extension_days BETWEEN 0 AND 90);

COMMENT ON COLUMN tenants.holiday_extension_days IS
  'Days a public holiday adds to a package''s validity when a lesson it funds is marked holiday. Read at mark time by the reconcile trigger; 0 = void charges but no extension.';
