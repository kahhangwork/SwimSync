-- Coach-defined swimming levels, per business.
--
-- Replaces the fixed beginner/intermediate/advanced `swimming_ability` enum,
-- which was never populated and was never the right shape: a level ladder is
-- a business's own vocabulary ("SwimSafer Level 3", "Seahorse", "Dolphin"),
-- not a fixed three-way split SwimSync gets to choose.
--
-- Until now the CLASS NAME carried the level, which works for one coach with
-- four classes and stops working the moment a coach wants to track progress
-- WITHIN a class, or a second business uses different names.
--
-- A TABLE, NOT FREE TEXT, deliberately: free text makes every typo a new
-- level, nothing sorts, and there is no list to pick from. sort_order is the
-- reason the table earns its keep — a ladder that renders alphabetically is
-- not a ladder.
--
-- Who sets a student's level: the BUSINESS'S ADMIN, using the existing
-- students_update policy. Coaches deliberately get no write path — granting
-- them UPDATE on students would also let them edit names, dates of birth and
-- notes, because RLS is row-level, not column-level (the same reasoning that
-- made close_student_enrolment a SECURITY DEFINER RPC). If coach-set levels
-- are wanted later, that is an RPC, not a policy change.

CREATE TABLE tenant_levels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One business cannot have two levels of the same name. Trimmed + lowercased
  -- for the same reason the student identity index is (20260719001400): a
  -- constraint that " Level 1" defeats is not a constraint.
  UNIQUE (tenant_id, label)
);

CREATE INDEX tenant_levels_tenant_sort_idx
  ON tenant_levels (tenant_id, sort_order, label);

-- ⚠️ CREATE TABLE LEAVES RLS OFF. A table with policies but RLS disabled reads
-- as though the policies were never written — they are simply not consulted.
-- Three tenancy tables shipped that way in development and left every join
-- code world-readable. Audit after any new table:
--   SELECT relname FROM pg_class WHERE relkind='r'
--     AND relnamespace='public'::regnamespace AND NOT relrowsecurity;
ALTER TABLE tenant_levels ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can see the business: its staff, and the parents it
-- serves (a parent sees their own child's level, PRD §7.15).
CREATE POLICY tenant_levels_select ON tenant_levels
  FOR SELECT
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)
  );

-- Only the business's own admin defines its ladder.
CREATE POLICY tenant_levels_write ON tenant_levels
  FOR ALL
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_levels TO authenticated;
GRANT ALL ON tenant_levels TO service_role;

-- ── The student's level ────────────────────────────────────────────────────
-- ON DELETE SET NULL: retiring a level must not take students with it. They
-- become unlevelled, which is recoverable; deleting them is not.
ALTER TABLE students
  ADD COLUMN level_id UUID REFERENCES tenant_levels(id) ON DELETE SET NULL;

CREATE INDEX students_level_id_idx ON students (level_id);

COMMENT ON TABLE tenant_levels IS
  'A business''s own swimming-level ladder. Ordered by sort_order — alphabetical '
  'ordering of a ladder is wrong ("Advanced" before "Beginner").';
COMMENT ON COLUMN students.level_id IS
  'Set by the business''s admin. Coaches have no write path to students by '
  'design — see migration 20260719001800.';

-- A level belongs to the same business as the student it is applied to.
-- Without this, an admin could reference another business's level id directly
-- via the API: students_update checks the STUDENT's tenant, and nothing was
-- checking the LEVEL's. That is the same shape as the tenant_id hole closed in
-- 20260719001500 — a cross-table reference no single-row policy can see.
CREATE OR REPLACE FUNCTION enforce_student_level_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_level_tenant UUID;
BEGIN
  IF NEW.level_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_level_tenant FROM tenant_levels WHERE id = NEW.level_id;

  IF v_level_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'That level belongs to a different business.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_student_level_tenant
  BEFORE INSERT OR UPDATE OF level_id, tenant_id ON students
  FOR EACH ROW
  EXECUTE FUNCTION enforce_student_level_tenant();
