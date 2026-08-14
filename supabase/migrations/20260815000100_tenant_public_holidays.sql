-- ============================================================
-- Packages, phase B — the per-business public-holiday calendar.
-- Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md, Decision 3.
--
-- A tenant maintains its own list of holiday dates (a national PH, or its own
-- closure). Phase C reads it to auto-extend a package's validity by one week
-- for each week a scheduled lesson lands on one of these dates. The admin adds
-- them by hand or by importing a data.gov.sg CSV (date,day,holiday).
--
-- ⚠ RISK 5: grants follow policies exactly (§7.87). Admins write; parents and
-- coaches of the tenant read (a package card names the holiday that extended
-- it). ⚠ RISK 6: holiday_date is a DATE — every writer passes a YYYY-MM-DD
-- string straight in, never a timezone-shifted timestamp.
-- ============================================================

CREATE TABLE tenant_public_holidays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  holiday_date  DATE NOT NULL,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One entry per date per business — the CSV import upserts on this.
CREATE UNIQUE INDEX tenant_public_holidays_date_uniq
  ON tenant_public_holidays (tenant_id, holiday_date);
CREATE INDEX tenant_public_holidays_tenant_idx
  ON tenant_public_holidays (tenant_id, holiday_date);

ALTER TABLE tenant_public_holidays ENABLE ROW LEVEL SECURITY;

-- Read: the tenant's admins, and its parents/coaches (the card shows the reason).
CREATE POLICY tenant_public_holidays_select ON tenant_public_holidays
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR parent_in_tenant(tenant_id)
    OR EXISTS (
      SELECT 1 FROM coaches co
      WHERE co.profile_id = auth.uid() AND co.tenant_id = tenant_public_holidays.tenant_id
    )
  );

-- Write: the business's admins only.
CREATE POLICY tenant_public_holidays_write ON tenant_public_holidays
  FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

-- Grants follow the policies (§7.87): every verb has a policy, so authenticated
-- may hold all four; service_role holds ALL for the engine/recompute path.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_public_holidays TO authenticated;
GRANT ALL ON tenant_public_holidays TO service_role;

COMMENT ON TABLE tenant_public_holidays IS
  'Per-business public-holiday / closure dates. Phase C extends a package by '
  'one week per week a scheduled lesson falls on one of these. Admin-maintained '
  '(manual or data.gov.sg CSV import). PACKAGE_WEEKS_HOLIDAYS_PLAN.md.';
