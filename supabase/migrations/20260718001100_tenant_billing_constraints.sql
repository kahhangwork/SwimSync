-- ============================================================
-- Multi-tenancy phase 2: tighten the billing constraints, now that the engine
-- writes a tenant.
--
-- These were deliberately left loose by phase 1 (expand/contract): a constraint
-- must not be tightened ahead of the writer that satisfies it. The engine now
-- sets tenant_id on every invoice, seals per tenant, and draws credit per
-- tenant — so the constraints can follow.
--
-- ⚠️ THE UNIQUE SWAP IS THE IMPORTANT ONE. `invoices` currently carries
-- UNIQUE (parent_id, billing_month), which forbids the case the user expects to
-- be COMMON: a parent with children at two businesses must receive TWO invoices
-- in the same month, one from each. But it could not be swapped in phase 1,
-- because while the engine still wrote tenant_id NULL, two NULL-tenant invoices
-- for one parent-month would NOT have conflicted — NULLs never conflict in a
-- UNIQUE index — which is double billing, the exact failure the constraint
-- exists to prevent. Tightening tenant_id to NOT NULL first is what makes the
-- swap safe.
-- ============================================================

-- ------------------------------------------------------------
-- Backfill anything written between phases, then tighten.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_tenants INT;
  v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_tenants FROM tenants;

  -- An invoice's tenant follows the class its line items were taught in.
  UPDATE invoices i
     SET tenant_id = c.tenant_id
    FROM invoice_items ii
    JOIN lesson_sessions ls ON ls.id = ii.lesson_session_id
    JOIN classes c ON c.id = ls.class_id
   WHERE ii.invoice_id = i.id
     AND i.tenant_id IS NULL;

  UPDATE credit_notes cn
     SET tenant_id = s.tenant_id
    FROM students s
   WHERE s.id = cn.student_id
     AND cn.tenant_id IS NULL;

  IF v_tenants = 1 THEN
    UPDATE invoices        SET tenant_id = (SELECT id FROM tenants) WHERE tenant_id IS NULL;
    UPDATE credit_notes    SET tenant_id = (SELECT id FROM tenants) WHERE tenant_id IS NULL;
    UPDATE billing_periods SET tenant_id = (SELECT id FROM tenants) WHERE tenant_id IS NULL;
  END IF;

  SELECT (SELECT COUNT(*) FROM invoices WHERE tenant_id IS NULL)
       + (SELECT COUNT(*) FROM credit_notes WHERE tenant_id IS NULL)
       + (SELECT COUNT(*) FROM billing_periods WHERE tenant_id IS NULL)
    INTO v_orphans;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      '% billing row(s) still have no tenant across % tenants — attribute them before tightening, or an invoice ends up billed by the wrong business.',
      v_orphans, v_tenants;
  END IF;
END $$;

ALTER TABLE invoices        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE credit_notes    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE billing_periods ALTER COLUMN tenant_id SET NOT NULL;

-- ------------------------------------------------------------
-- One invoice per parent PER TENANT per month.
-- ------------------------------------------------------------

ALTER TABLE invoices DROP CONSTRAINT invoices_parent_id_billing_month_key;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_parent_tenant_month_key
  UNIQUE (parent_id, tenant_id, billing_month);

-- ------------------------------------------------------------
-- Sealing is per tenant.
--
-- With billing_month alone as the primary key, the first business to finish a
-- month closed it for EVERY other tenant — each later run short-circuits on
-- "already_complete" and bills nothing, silently. Same shape as the vacuous
-- empty-month seal that reached production, but crossing a business boundary.
-- ------------------------------------------------------------

ALTER TABLE billing_periods DROP CONSTRAINT billing_periods_pkey;
ALTER TABLE billing_periods ADD PRIMARY KEY (tenant_id, billing_month);
