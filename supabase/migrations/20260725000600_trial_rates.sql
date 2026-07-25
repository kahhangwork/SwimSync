-- ============================================================
-- What a paid trial costs, per class CATEGORY (TRIAL_BOOKINGS_PLAN.md phase 2).
--
-- WHY THE CATEGORY IS THE AXIS. A private trial costs more than a group trial
-- because it IS a different kind of lesson, and `class_categories` already
-- means exactly that. Pricing trials on any other axis would invent a second
-- vocabulary beside an existing one.
--
-- WHY NOT THE CLASS'S OWN PRICE. A trial is an intro price — one number for
-- "a group trial" regardless of which specific class is sampled. The class
-- price is what an ENROLLED family pays ongoing, and it varies by level,
-- duration and cohort within a single category (production: four classes, one
-- category, $40/$35/$35/$40). Different questions, different axes.
--
-- WHY EFFECTIVE-DATED AND INSERT-ONLY. Invoices run up to five weeks after a
-- lesson, so a mutable price would silently re-value every unbilled trial of
-- the previous month the moment it changed. That is §7.3/§7.7's bug, already
-- fixed three times in this schema (class terms, wage rates, package products).
-- A price change is a NEW ROW, exactly like class_rates.
--
-- RESOLUTION IS TWO TIERS, and the second is today's behaviour:
--   1. the rate in force for this class's category on the lesson's own date
--   2. otherwise the class's own price (class_rate_on)
-- A business that never sets a trial rate is therefore completely unaffected.
-- There is deliberately no scope-less "default" tier: categories are mandatory
-- (20260725000400), so every class has one and the tier would price nothing.
-- ============================================================

CREATE TABLE trial_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- ON DELETE RESTRICT, never SET NULL. These rows price PAST lessons. If a
  -- category's rates vanished with the category, every unbilled trial in the
  -- five-week window between lesson and invoice run would silently re-resolve
  -- to the class rate — §7.7 through a new door. RESTRICT is what
  -- package_products.category_id already does (20260720000100:112) for exactly
  -- this reason.
  category_id    UUID NOT NULL REFERENCES class_categories(id) ON DELETE RESTRICT,

  -- A $0 trial would silently bill nothing on a document that freezes when
  -- created (§11.6). A genuinely free trial is the `trial_free` ATTENDANCE
  -- status, which is non-billable and needs no rate at all.
  rate           NUMERIC(10, 2) NOT NULL CHECK (rate > 0),

  effective_from DATE NOT NULL,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (category_id, effective_from)
);

CREATE INDEX trial_rates_lookup ON trial_rates (category_id, effective_from DESC);

COMMENT ON TABLE trial_rates IS
  'What a paid trial costs, per class category, effective-dated and INSERT-ONLY. A price change is a new row; editing one in place would re-value trials already taught (§7.3).';

ALTER TABLE trial_rates ENABLE ROW LEVEL SECURITY;

-- Read: the business's admin, the platform admin for support, and the coach —
-- who may reasonably want to see what a trial of their class is sold at.
CREATE POLICY trial_rates_select ON trial_rates FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
  );

-- Write: the business's admin only. NO UPDATE and NO DELETE policy — the
-- effective-dated model has no use for either, and their absence is what makes
-- "insert-only" true rather than merely intended.
CREATE POLICY trial_rates_insert ON trial_rates FOR INSERT TO authenticated
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT ON trial_rates TO authenticated, service_role;

-- A rate may only be scoped to a category of its OWN business. The RLS policy
-- above checks `tenant_id` and cannot see whether the CATEGORY belongs to it —
-- the same cross-table hole enforce_class_category_tenant() closes for classes
-- (20260720000100:81-97).
CREATE OR REPLACE FUNCTION enforce_trial_rate_category_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_cat_tenant
    FROM class_categories WHERE id = NEW.category_id;

  IF v_cat_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that category belongs to another business';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trial_rates_category_tenant
  BEFORE INSERT OR UPDATE OF category_id, tenant_id ON trial_rates
  FOR EACH ROW EXECUTE FUNCTION enforce_trial_rate_category_tenant();

/**
 * The trial rate in force for a category on a given date, or NULL if none.
 *
 * NULL is a real answer meaning "this business has not priced trials for this
 * category", and the caller falls back to the class's own rate. That is
 * DIFFERENT from a missing CLASS rate, which is a hard failure (§6) because the
 * alternative there would be silently charging 0.
 */
CREATE OR REPLACE FUNCTION public.trial_rate_on(p_category_id UUID, p_on DATE)
RETURNS NUMERIC
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tr.rate
    FROM trial_rates tr
   WHERE tr.category_id = p_category_id
     AND tr.effective_from <= p_on
   ORDER BY tr.effective_from DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.trial_rate_on(UUID, DATE) FROM PUBLIC;
-- §7.39: cloud default-grants new public functions to anon and service_role
-- where local does not, so both are revoked explicitly and re-verified remotely.
REVOKE EXECUTE ON FUNCTION public.trial_rate_on(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.trial_rate_on(UUID, DATE)
  TO authenticated, service_role;
