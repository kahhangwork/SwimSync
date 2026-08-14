-- ============================================================
-- Packages, phase D — the admin's MANUAL validity extension.
-- Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md, Decision 6 / ⚠ RISK 5.
--
-- A goodwill / discretionary extension, stacked ON TOP of any holiday
-- extension (never an absolute end-date override), with an audit row. It feeds
-- the same effective-end formula, so the manual days and the holiday weeks add:
--   expires_on = package_effective_end(start, validity_weeks, ph_weeks, manual_days)
--
-- ⚠ RISK 5 — SECURITY DEFINER bypasses RLS, so the function enforces authz
-- itself: the caller must administer the package's OWN tenant (looked up
-- server-side, never a tenant-id parameter); the package must be active; days
-- is bounded 1..365 (a fat-finger ceiling); a negative is refused (shortening a
-- paid package is cancel + resell, not a minus sign).
-- ============================================================

CREATE OR REPLACE FUNCTION extend_package(
  p_package_id uuid,
  p_days       integer,
  p_reason     text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pp parent_packages%ROWTYPE;
BEGIN
  SELECT * INTO pp FROM parent_packages WHERE id = p_package_id;
  IF pp.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT can_admin_tenant(pp.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to extend this package.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF pp.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active package can be extended.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Extension must be between 1 and 365 days.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE parent_packages SET
    manual_extension_days = manual_extension_days + p_days,
    expires_on = package_effective_end(start_date, validity_weeks,
                                       ph_extension_weeks,
                                       manual_extension_days + p_days)
  WHERE id = p_package_id;

  INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
  VALUES (p_package_id, 'manual', p_days, COALESCE(NULLIF(trim(p_reason), ''), 'Manual extension'),
          auth.uid());
END;
$$;

REVOKE EXECUTE ON FUNCTION extend_package(uuid, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION extend_package(uuid, integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION extend_package(uuid, integer, text) IS
  'Admin-only discretionary package extension (1..365 days), stacked on top of '
  'the holiday extension, audited in package_extension_events. ⚠ RISK 5.';
