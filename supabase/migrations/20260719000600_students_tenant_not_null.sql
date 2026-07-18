-- ============================================================
-- Contract step: students.tenant_id becomes NOT NULL.
--
-- The last piece of the expand/contract cycle, and it was nearly missed.
--
-- Phase 1 added the column NULLABLE on purpose: a constraint must not be
-- tightened ahead of the writer that satisfies it, and at that point the
-- parent's add-child flow did not set a tenant. Phase 3 shipped that flow
-- (add-child is gated on having joined a business via a join code, and stamps
-- the chosen tenant on the row) — but the matching tighten never followed, so
-- `TENANCY_DESIGN.md` §2 said NOT NULL while the database disagreed.
--
-- That gap is not cosmetic. A tenant-less student is invisible to every admin
-- queue (each is scoped by tenant), so a child could be created and then simply
-- never appear for anyone to assign.
--
-- ALSO RETIRES THE TRANSITIONAL BRANCH in the enrolment guard. That branch
-- existed only to adopt a class's tenant for students created before phase 3;
-- with this constraint it is unreachable, and leaving unreachable code in a
-- security guard invites someone to reason about a path that cannot happen.
-- ============================================================

DO $$
DECLARE
  v_tenants INT;
  v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_tenants FROM tenants;
  SELECT COUNT(*) INTO v_orphans FROM students WHERE tenant_id IS NULL;

  IF v_orphans = 0 THEN
    RAISE NOTICE 'students.tenant_id: no orphans, tightening directly.';
  ELSIF v_tenants = 1 THEN
    -- A child created in the window between phase 1 and the phase-3 app deploy
    -- could have no tenant. With one business there is only one answer.
    UPDATE students SET tenant_id = (SELECT id FROM tenants) WHERE tenant_id IS NULL;
    RAISE NOTICE 'students.tenant_id: adopted % orphan(s) into the only tenant.', v_orphans;
  ELSE
    -- Refuse rather than guess: putting a child in the wrong business makes
    -- them visible to strangers and billable by them.
    RAISE EXCEPTION
      '% student(s) have no tenant across % tenants. Assign them (platform admin → Move a student) before tightening.',
      v_orphans, v_tenants;
  END IF;
END $$;

ALTER TABLE students ALTER COLUMN tenant_id SET NOT NULL;

-- ------------------------------------------------------------
-- The guard is now purely a check.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_enrolment_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_tenant UUID;
  v_class_tenant   UUID;
BEGIN
  SELECT tenant_id INTO v_student_tenant FROM students WHERE id = NEW.student_id;
  SELECT tenant_id INTO v_class_tenant   FROM classes  WHERE id = NEW.class_id;

  -- Both columns are NOT NULL, so this is a straight comparison now. A
  -- cross-tenant enrolment is the single most damaging row this schema can
  -- hold: it would put a child on another business's roster, in their
  -- attendance, and on their invoices.
  IF v_student_tenant IS DISTINCT FROM v_class_tenant THEN
    RAISE EXCEPTION
      'cross-tenant enrolment refused: student % is in tenant %, class % is in tenant %',
      NEW.student_id, v_student_tenant, NEW.class_id, v_class_tenant;
  END IF;

  RETURN NEW;
END;
$$;
