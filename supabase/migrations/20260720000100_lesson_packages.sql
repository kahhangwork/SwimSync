-- ============================================================
-- Prepaid lesson packages (PACKAGES_DESIGN.md).
--
-- A package is MONEY held per (parent, business), spent down by the invoice
-- engine at the package's own locked rate. Four tables:
--
--   class_categories     — the business's own vocabulary for "what kind of
--                          class" (Group, Private, Squad…). Scopes packages.
--   package_products     — what the business SELLS: N lessons at rate R,
--                          valid M months, against one category (or all).
--   parent_packages      — what a family BOUGHT: a snapshot of the product's
--                          terms at request time, plus the remaining value.
--   package_applications — the ledger: every draw of a package against an
--                          invoice line, reversible for corrections.
--
-- Design rules enforced STRUCTURALLY here rather than by convention:
--   • A $0-rate or 0-lesson product is impossible (CHECKs) — §7.22's
--     Number("") wage bug would otherwise mint an infinite package.
--   • Product money terms are immutable (trigger): a price change is a NEW
--     product, never an edit — the class_rates philosophy.
--   • Instance terms are snapshotted from the product BY THE DATABASE at
--     request time; the client's claimed numbers are ignored. A fact about a
--     sale is never a live lookup.
--   • value_remaining is floored at 0 and capped at total_value (CHECKs),
--     and only non-client roles may change it (current_user seam, the
--     pin_student_tenant arrangement — see 20260719001500 for why not grants).
--   • Status may only move pending→active, pending→cancelled,
--     active→cancelled. Confirm is idempotent-safe: the transition is the
--     only writer of confirmed_at/expires_on.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CLASS_CATEGORIES — tenant-defined, like tenant_levels.
-- ------------------------------------------------------------

CREATE TABLE class_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Group " and "group" are the same category — the expression-index rule from
-- student identity (20260719001400): a constraint whitespace defeats isn't one.
CREATE UNIQUE INDEX class_categories_name_uniq
  ON class_categories (tenant_id, lower(trim(name)));

ALTER TABLE class_categories ENABLE ROW LEVEL SECURITY;

-- Parents see categories too: a package card names its scope.
CREATE POLICY class_categories_select ON class_categories FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)
  );

CREATE POLICY class_categories_write ON class_categories FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON class_categories TO authenticated;
GRANT ALL ON class_categories TO service_role;

-- ON DELETE SET NULL: deleting a category un-categorizes its classes. That
-- pushes those classes OUT of any scoped package (they bill ad-hoc), which is
-- the conservative direction — it can under-cover, never over-draw.
ALTER TABLE classes
  ADD COLUMN category_id UUID REFERENCES class_categories(id) ON DELETE SET NULL;

CREATE INDEX classes_category_id_idx ON classes (category_id);

-- A class may only take a category from its own business — the same
-- cross-table hole enforce_student_level_tenant() closes for levels.
CREATE OR REPLACE FUNCTION enforce_class_category_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_cat_tenant UUID;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_cat_tenant FROM class_categories WHERE id = NEW.category_id;

  IF v_cat_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'That category belongs to a different business.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_class_category_tenant
  BEFORE INSERT OR UPDATE OF category_id, tenant_id ON classes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_class_category_tenant();

-- ------------------------------------------------------------
-- 2. PACKAGE_PRODUCTS — what the business sells.
-- ------------------------------------------------------------

CREATE TABLE package_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- NULL = valid for ALL the business's classes (the private-coach shape).
  -- RESTRICT, not SET NULL: deleting a category must not silently widen every
  -- product sold against it to all-classes. Retire the products first.
  category_id      UUID REFERENCES class_categories(id) ON DELETE RESTRICT,
  lesson_count     INTEGER NOT NULL CHECK (lesson_count > 0),
  rate_per_lesson  NUMERIC(10, 2) NOT NULL CHECK (rate_per_lesson > 0),
  validity_months  INTEGER NOT NULL CHECK (validity_months > 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX package_products_tenant_idx ON package_products (tenant_id, is_active);

ALTER TABLE package_products ENABLE ROW LEVEL SECURITY;

-- Parents browse products to request one.
CREATE POLICY package_products_select ON package_products FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)
  );

CREATE POLICY package_products_write ON package_products FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON package_products TO authenticated;
GRANT ALL ON package_products TO service_role;

-- Money terms are IMMUTABLE — a price change is retire + create new, so no
-- edit can ever reprice a package a family already holds or has requested.
-- Unconditional (no role exemption): there is no legitimate writer.
CREATE OR REPLACE FUNCTION pin_package_product_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
  THEN
    RAISE EXCEPTION
      'A package product''s terms cannot be edited. Retire it (is_active = false) and create a new one.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pin_package_product_terms
  BEFORE UPDATE ON package_products
  FOR EACH ROW
  EXECUTE FUNCTION pin_package_product_terms();

-- ------------------------------------------------------------
-- 3. PARENT_PACKAGES — what a family bought (or asked to buy).
-- ------------------------------------------------------------

CREATE TABLE parent_packages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id        UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES package_products(id),

  -- Snapshots of the product AT REQUEST TIME, filled by the lifecycle trigger
  -- below (client-supplied values are overwritten — the client cannot claim a
  -- price). Defaults exist only so an INSERT naming none of them is valid
  -- before the trigger fills them.
  name             TEXT NOT NULL DEFAULT '',
  category_id      UUID REFERENCES class_categories(id) ON DELETE RESTRICT,
  lesson_count     INTEGER NOT NULL DEFAULT 0,
  rate_per_lesson  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_value      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  validity_months  INTEGER NOT NULL DEFAULT 0,

  value_remaining  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'cancelled')),
  -- Set at confirmation: SGT date of confirmed_at + validity_months.
  expires_on       DATE,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     UUID REFERENCES profiles(id),
  cancelled_at     TIMESTAMPTZ,

  -- The floor-at-zero and restore-cannot-overfill rules live HERE, not only
  -- in engine code (PACKAGES_DESIGN.md ⚠ RISK 1).
  CHECK (value_remaining >= 0),
  CHECK (value_remaining <= total_value),
  -- An active package always knows when it was confirmed and when it expires.
  CHECK (status <> 'active' OR (confirmed_at IS NOT NULL AND expires_on IS NOT NULL))
);

CREATE INDEX parent_packages_parent_tenant_idx
  ON parent_packages (parent_id, tenant_id, status);
CREATE INDEX parent_packages_tenant_status_idx
  ON parent_packages (tenant_id, status);

ALTER TABLE parent_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY parent_packages_select ON parent_packages FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR parent_id = current_parent_id()
  );

-- A parent requests for THEMSELVES at a business they have joined; an admin
-- records a sale for their own business. The lifecycle trigger forces a
-- parent-created row to 'pending' regardless of what the insert claims.
CREATE POLICY parent_packages_insert ON parent_packages FOR INSERT TO authenticated
  WITH CHECK (
    can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id() AND parent_in_tenant(tenant_id))
  );

-- Updates: the admin (confirm / cancel), or the owning parent (the trigger
-- limits them to cancelling their own pending request).
CREATE POLICY parent_packages_update ON parent_packages FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id) OR parent_id = current_parent_id())
  WITH CHECK (can_admin_tenant(tenant_id) OR parent_id = current_parent_id());

-- No DELETE policy: cancelled is the terminal state; history survives.

GRANT SELECT, INSERT, UPDATE ON parent_packages TO authenticated;
GRANT ALL ON parent_packages TO service_role;

-- Lifecycle trigger: snapshots, forced-pending for parents, legal status
-- transitions, and the current_user seam on value_remaining.
--
-- Deliberately NOT SECURITY DEFINER: the whole seam is that client DML
-- arrives as 'authenticated' — inside a definer function current_user is
-- 'postgres' and every branch below would wave clients through. (Verified
-- the failing way first: as a definer this trigger let a parent's request
-- insert itself as 'active'.) The product lookup below therefore runs under
-- the caller's RLS, which is correct: a parent can only request a product
-- they can see, i.e. from a business they have joined.
CREATE OR REPLACE FUNCTION enforce_parent_package_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_product FROM package_products WHERE id = NEW.product_id;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
    END IF;

    -- The product decides the business and the terms; the client cannot.
    NEW.tenant_id       := v_product.tenant_id;
    NEW.name            := v_product.name;
    NEW.category_id     := v_product.category_id;
    NEW.lesson_count    := v_product.lesson_count;
    NEW.rate_per_lesson := v_product.rate_per_lesson;
    NEW.validity_months := v_product.validity_months;
    NEW.total_value     := v_product.lesson_count * v_product.rate_per_lesson;
    NEW.value_remaining := NEW.total_value;
    NEW.cancelled_at    := NULL;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      -- A parent's request is pending until the admin confirms payment,
      -- whatever the insert claimed.
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    ELSIF NEW.status = 'active' THEN
      -- Admin direct sale (or service path): active immediately.
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.expires_on   := ((NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date
                            + make_interval(months => NEW.validity_months))::date;
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

  -- Snapshots are a record of the sale: immutable for everyone, always.
  IF NEW.product_id      IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id       IS DISTINCT FROM OLD.parent_id
     OR NEW.name            IS DISTINCT FROM OLD.name
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.total_value     IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.requested_at    IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only the engine and SECURITY DEFINER paths may move money. Client DML
  -- arrives as 'authenticated'; the legitimate writers arrive as postgres
  -- (definer functions) or service_role (the engine). Same seam as
  -- pin_student_tenant — see 20260719001500 for why not column grants.
  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'active' THEN
      -- Confirm: admin (or service) only — a parent cannot activate their
      -- own request; that is the admin's proof-of-payment step.
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.expires_on   := ((NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date
                            + make_interval(months => NEW.validity_months))::date;
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      -- The owning parent may withdraw their own request; the admin may
      -- decline it. (The UPDATE policy already limits us to those two.)
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      -- Refunds settle offline (PACKAGES_DESIGN.md §1): admin only.
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSE
      RAISE EXCEPTION 'Illegal package status change (% -> %).', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- No status change: confirmation fields must hold still under client DML.
    IF current_user = 'authenticated'
       AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
            OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
            OR NEW.expires_on   IS DISTINCT FROM OLD.expires_on
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    THEN
      RAISE EXCEPTION 'Confirmation fields are set by the status transition, not edited.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_parent_package_lifecycle
  BEFORE INSERT OR UPDATE ON parent_packages
  FOR EACH ROW
  EXECUTE FUNCTION enforce_parent_package_lifecycle();

-- ------------------------------------------------------------
-- 4. PACKAGE_APPLICATIONS — the drawdown ledger.
-- ------------------------------------------------------------

CREATE TABLE package_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_package_id  UUID NOT NULL REFERENCES parent_packages(id),
  invoice_item_id    UUID NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
  amount             NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A correction reverses the row rather than deleting it (append-only
  -- ledger). reversed_at IS NULL = this funding is live.
  reversed_at        TIMESTAMPTZ,
  reversed_by        UUID REFERENCES profiles(id)
);

-- One live funding per invoice line — the credit-note trigger keys off this.
CREATE UNIQUE INDEX package_applications_live_item_uniq
  ON package_applications (invoice_item_id) WHERE reversed_at IS NULL;
CREATE INDEX package_applications_package_idx
  ON package_applications (parent_package_id);

ALTER TABLE package_applications ENABLE ROW LEVEL SECURITY;

-- Read-only to app roles (engine + triggers write; both bypass RLS).
CREATE POLICY package_applications_select ON package_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parent_packages pp
      WHERE pp.id = package_applications.parent_package_id
        AND (
          is_platform_admin()
          OR can_admin_tenant(pp.tenant_id)
          OR pp.parent_id = current_parent_id()
        )
    )
  );

GRANT SELECT ON package_applications TO authenticated;
GRANT ALL ON package_applications TO service_role;

-- ------------------------------------------------------------
-- 5. Invoices carry what the package covered.
-- ------------------------------------------------------------

ALTER TABLE invoices
  ADD COLUMN package_applied NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN invoices.package_applied IS
  'Sum of package_applications against this invoice''s items at generation. '
  'net_amount = gross_amount - package_applied - credit_applied.';

-- ------------------------------------------------------------
-- 6. The admin-configurable low-balance threshold (per business).
-- ------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN low_package_lessons INTEGER NOT NULL DEFAULT 2
    CHECK (low_package_lessons >= 0);

COMMENT ON COLUMN tenants.low_package_lessons IS
  'Students page "running low" filter: flag families whose live package '
  'balance is at or below this many lessons. Per business — deliberately not '
  'a global constant.';

-- ------------------------------------------------------------
-- 7. package_live_balances() — THE ONLY derivation of pending draws.
--
-- The stored balance moves at invoice time only. This function answers "what
-- is it REALLY, right now" by simulating the engine's allocation over
-- billable, not-yet-invoiced attendance: chronological lessons, packages
-- FIFO by (expires_on, confirmed_at, id), draw = the PACKAGE's locked rate,
-- skip a package that cannot fully fund a lesson.
--
-- SECURITY INVOKER on purpose (the §7.35 trap is DEFINER aggregates): a
-- parent computes over the rows they can see (their packages, their
-- children's attendance); a tenant admin over their tenant's. The engine
-- does NOT call this — core.ts allocates for real at generation; a Deno test
-- pins the two against each other so they cannot drift silently.
--
-- Do NOT reimplement this in TypeScript in either app (PACKAGES_DESIGN.md
-- ⚠ RISK 4): both the parent card and the admin filter call this function.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION package_live_balances()
RETURNS TABLE (
  parent_package_id       UUID,
  parent_id               UUID,
  tenant_id               UUID,
  name                    TEXT,
  category_id             UUID,
  rate_per_lesson         NUMERIC(10, 2),
  lesson_count            INTEGER,
  total_value             NUMERIC(10, 2),
  expires_on              DATE,
  value_remaining         NUMERIC(10, 2),
  live_value_remaining    NUMERIC(10, 2),
  live_lessons_remaining  INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  pkg_ids        UUID[]    := '{}';
  pkg_parents    UUID[]    := '{}';
  pkg_tenants    UUID[]    := '{}';
  pkg_cats       UUID[]    := '{}';
  pkg_rates      NUMERIC[] := '{}';
  pkg_starts     DATE[]    := '{}';
  pkg_ends       DATE[]    := '{}';
  pkg_remaining  NUMERIC[] := '{}';
  r    RECORD;
  les  RECORD;
  i    INTEGER;
BEGIN
  -- Active packages, in exactly the engine's draw order.
  FOR r IN
    SELECT pp.id, pp.parent_id AS p_id, pp.tenant_id AS t_id, pp.category_id AS c_id,
           pp.rate_per_lesson AS rate, pp.expires_on AS ends, pp.value_remaining AS rem,
           (pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date AS starts
    FROM parent_packages pp
    WHERE pp.status = 'active'
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LOOP
    pkg_ids       := pkg_ids       || r.id;
    pkg_parents   := pkg_parents   || r.p_id;
    pkg_tenants   := pkg_tenants   || r.t_id;
    pkg_cats      := pkg_cats      || r.c_id;
    pkg_rates     := pkg_rates     || r.rate;
    pkg_starts    := pkg_starts    || r.starts;
    pkg_ends      := pkg_ends      || r.ends;
    pkg_remaining := pkg_remaining || r.rem;
  END LOOP;

  -- Billable, not-yet-invoiced lessons, chronological (the engine's item
  -- order). "No invoice line" is the definition of pending — invoiced draws
  -- are already inside value_remaining.
  FOR les IN
    SELECT ps.parent_id AS p_id, c.tenant_id AS t_id, c.category_id AS c_id,
           ls.session_date AS d
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id
    JOIN parent_students ps ON ps.student_id = a.student_id
    WHERE a.status IN ('present', 'trial_paid')
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii
        WHERE ii.lesson_session_id = a.lesson_session_id
          AND ii.student_id = a.student_id
      )
    ORDER BY ls.session_date, a.student_id
  LOOP
    FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
      IF pkg_parents[i] = les.p_id
         AND pkg_tenants[i] = les.t_id
         AND (pkg_cats[i] IS NULL OR pkg_cats[i] = les.c_id)
         AND les.d >= pkg_starts[i]
         AND les.d <= pkg_ends[i]
         AND pkg_remaining[i] >= pkg_rates[i]
      THEN
        pkg_remaining[i] := pkg_remaining[i] - pkg_rates[i];
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
    RETURN QUERY
      SELECT pp.id, pp.parent_id, pp.tenant_id, pp.name, pp.category_id,
             pp.rate_per_lesson, pp.lesson_count, pp.total_value, pp.expires_on,
             pp.value_remaining,
             pkg_remaining[i],
             floor(pkg_remaining[i] / pp.rate_per_lesson)::integer
      FROM parent_packages pp WHERE pp.id = pkg_ids[i];
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION package_live_balances() TO authenticated, service_role;

COMMENT ON TABLE parent_packages IS
  'Prepaid lesson value held per (parent, business). Terms are snapshotted '
  'from the product at request time. Balance moves at invoice time only; '
  'live displays derive via package_live_balances(). PACKAGES_DESIGN.md.';
COMMENT ON TABLE package_applications IS
  'Ledger of package draws against invoice lines. Append-only; corrections '
  'reverse a row (reversed_at) and restore parent_packages.value_remaining.';
