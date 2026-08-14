-- ============================================================
-- Packages, phase A — sell in WEEKS, anchor on an explicit START DATE.
-- Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md.
--
-- Two axes change, both on the DATE side only (value_remaining is untouched):
--
--   1. A product's validity is measured in WEEKS, not months. Expand, do NOT
--      rename (⚠ RISK 3): validity_months stays and is kept in sync so the
--      currently-deployed admin/parent screens that read it don't break during
--      the migrations-first deploy window (§7.60). A BEFORE INSERT derive
--      trigger fills whichever column an insert omits — so every existing
--      fixture that supplies only validity_months keeps working, and the new
--      UI can supply only validity_weeks.
--
--   2. A parent_package carries an explicit start_date. It is the FIFO window
--      start (was SGT-of-confirmed_at, read live by the engine and
--      package_live_balances) and the anchor of the effective end:
--
--        nominal_end   = start_date + validity_weeks * 7
--        effective end = nominal_end + ph_extension_weeks*7 + manual_extension_days
--
--      ph_extension_weeks / manual_extension_days are 0 in this phase (added
--      here so the formula, the pins and the CHECK are all in place before
--      Phase C's recompute and Phase D's manual-extend ever write them).
--
-- ⚠ RISK 1: the new columns are parent-writable via the row-scoped UPDATE
--   policy until the lifecycle trigger pins them — done here, same migration.
-- ⚠ RISK 2: start_date is backfilled to EXACTLY the value the engine derives
--   today ((confirmed_at AT TIME ZONE 'Asia/Singapore')::date), so the window
--   of every existing package is bit-identical before/after. validity_weeks on
--   parent_packages is backfilled from the row's OWN dates with ceil(), which
--   can only ever LENGTHEN, never shorten a paid-for expiry.
-- ============================================================

-- ------------------------------------------------------------
-- 1. package_products.validity_weeks (expand; keep validity_months in sync).
-- ------------------------------------------------------------

ALTER TABLE package_products ADD COLUMN validity_weeks INTEGER;

-- Backfill existing products (forward-facing display only — no sold package
-- reads a product's validity, it reads its own snapshot). round() is fine here.
UPDATE package_products
   SET validity_weeks = GREATEST(1, round(validity_months * 52.0 / 12.0)::int);

-- Keep the two columns mutually derivable on INSERT, so neither the legacy
-- fixtures (validity_months only) nor the new UI (validity_weeks only) has to
-- supply both. Immutability of both is enforced by pin_package_product_terms
-- on UPDATE (below); this trigger is INSERT-only and never collides with it.
CREATE OR REPLACE FUNCTION derive_package_product_validity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.validity_weeks IS NULL AND NEW.validity_months IS NOT NULL THEN
    NEW.validity_weeks := GREATEST(1, round(NEW.validity_months * 52.0 / 12.0)::int);
  ELSIF NEW.validity_months IS NULL AND NEW.validity_weeks IS NOT NULL THEN
    NEW.validity_months := GREATEST(1, round(NEW.validity_weeks * 12.0 / 52.0)::int);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_derive_package_product_validity
  BEFORE INSERT ON package_products
  FOR EACH ROW
  EXECUTE FUNCTION derive_package_product_validity();

ALTER TABLE package_products ALTER COLUMN validity_weeks SET NOT NULL;
ALTER TABLE package_products ADD CONSTRAINT package_products_validity_weeks_check
  CHECK (validity_weeks > 0);

-- Money/duration terms remain immutable — validity_weeks joins the pinned set.
CREATE OR REPLACE FUNCTION pin_package_product_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.validity_weeks  IS DISTINCT FROM OLD.validity_weeks
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

-- ------------------------------------------------------------
-- 2. parent_packages: start_date, validity_weeks snapshot, extension + ack.
-- ------------------------------------------------------------

ALTER TABLE parent_packages
  ADD COLUMN start_date            DATE,
  ADD COLUMN validity_weeks        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ph_extension_weeks    INTEGER NOT NULL DEFAULT 0 CHECK (ph_extension_weeks >= 0),
  ADD COLUMN manual_extension_days INTEGER NOT NULL DEFAULT 0 CHECK (manual_extension_days >= 0),
  ADD COLUMN ph_ack_weeks_parent   INTEGER NOT NULL DEFAULT 0 CHECK (ph_ack_weeks_parent >= 0),
  ADD COLUMN ph_ack_weeks_admin    INTEGER NOT NULL DEFAULT 0 CHECK (ph_ack_weeks_admin >= 0);

-- ⚠ RISK 2 backfill — start_date is EXACTLY today's engine value.
UPDATE parent_packages
   SET start_date = (confirmed_at AT TIME ZONE 'Asia/Singapore')::date
 WHERE confirmed_at IS NOT NULL;

-- ⚠ RISK 2/3 backfill — validity_weeks from the row's OWN dates (ceil ⇒ never
-- shorter). Rows with dates: measure the window. Rows without (pending, never
-- confirmed): fall back to the month→week conversion of their own snapshot,
-- which has no expiry to shrink.
UPDATE parent_packages
   SET validity_weeks = CEIL((expires_on - start_date) / 7.0)::int
 WHERE start_date IS NOT NULL AND expires_on IS NOT NULL;

UPDATE parent_packages
   SET validity_weeks = GREATEST(1, round(validity_months * 52.0 / 12.0)::int)
 WHERE validity_weeks = 0 AND validity_months > 0;

-- Active packages must now also carry a start_date — the engine and
-- package_live_balances both anchor on it, so a NULL is not merely unexpected,
-- it is a wrong-window bug. (⚠ RISK 2)
ALTER TABLE parent_packages DROP CONSTRAINT parent_packages_check1;
ALTER TABLE parent_packages ADD CONSTRAINT parent_packages_check1
  CHECK (status <> 'active'
         OR (confirmed_at IS NOT NULL AND expires_on IS NOT NULL AND start_date IS NOT NULL));

-- ------------------------------------------------------------
-- 3. package_effective_end() — the ONE end-date formula (the spine).
--    IMMUTABLE: pure arithmetic over its arguments, no lookups. Every writer
--    of expires_on goes through this so the definition can never fork.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION package_effective_end(
  p_start_date      DATE,
  p_validity_weeks  INTEGER,
  p_ph_ext_weeks    INTEGER,
  p_manual_days     INTEGER
) RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_start_date
       + (p_validity_weeks * 7)
       + (p_ph_ext_weeks * 7)
       + p_manual_days;
$$;

-- The lifecycle trigger (SECURITY INVOKER) calls this while an authenticated
-- user sells or confirms a package, so authenticated needs EXECUTE — a new
-- function is callable by nobody until granted (§7.87).
GRANT EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Lifecycle trigger — snapshot validity_weeks, anchor on start_date,
--    weeks-based expiry, and pin the new columns (⚠ RISK 1).
-- ------------------------------------------------------------

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
    NEW.validity_weeks  := v_product.validity_weeks;
    NEW.total_value     := v_product.lesson_count * v_product.rate_per_lesson;
    NEW.value_remaining := NEW.total_value;
    NEW.cancelled_at    := NULL;
    -- Extensions and acks always start at zero — they are never seeded by a sale.
    NEW.ph_extension_weeks    := 0;
    NEW.manual_extension_days := 0;
    NEW.ph_ack_weeks_parent   := 0;
    NEW.ph_ack_weeks_admin    := 0;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      -- A parent's request is pending until the admin confirms payment. A
      -- parent cannot set a start date; that is the admin's at-sale decision.
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
    ELSIF NEW.status = 'active' THEN
      -- Admin direct sale (or service path): active immediately. The admin may
      -- supply start_date; default it to the SGT date of confirmation.
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.ph_extension_weeks, NEW.manual_extension_days);
    ELSE
      -- Pending admin-recorded request: a start date may be pre-set now and is
      -- finalised at confirmation.
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

  -- Snapshots are a record of the sale: immutable for everyone, always.
  -- validity_weeks joins the pinned set.
  IF NEW.product_id      IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id       IS DISTINCT FROM OLD.parent_id
     OR NEW.name            IS DISTINCT FROM OLD.name
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.total_value     IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.validity_weeks  IS DISTINCT FROM OLD.validity_weeks
     OR NEW.requested_at    IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 1 — the extension and acknowledgement columns are system-owned.
  -- Client DML arrives as 'authenticated'; the legitimate writers (the
  -- recompute, ack and extend RPCs) are SECURITY DEFINER and arrive as
  -- postgres. Same seam as value_remaining.
  IF current_user = 'authenticated'
     AND (NEW.ph_extension_weeks    IS DISTINCT FROM OLD.ph_extension_weeks
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days
          OR NEW.ph_ack_weeks_parent   IS DISTINCT FROM OLD.ph_ack_weeks_parent
          OR NEW.ph_ack_weeks_admin    IS DISTINCT FROM OLD.ph_ack_weeks_admin)
  THEN
    RAISE EXCEPTION 'Package extension and acknowledgement fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 1 — the start date is the admin's at-sale decision, and it is fixed
  -- once active. A PARENT may never set it (their pending request must not park
  -- a start date the confirm step would then adopt — the deploy-gap hole); the
  -- ADMIN may set it while pending, never once active (moving it re-scopes the
  -- FIFO window over months already billed — fix a wrong date by cancel+resell).
  IF current_user = 'authenticated'
     AND NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN
    IF NOT can_admin_tenant(OLD.tenant_id) THEN
      RAISE EXCEPTION 'Only the business sets a package''s start date.'
        USING ERRCODE = 'check_violation';
    ELSIF OLD.status = 'active' THEN
      RAISE EXCEPTION 'A package''s start date is fixed once active — cancel and re-sell to change it.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'active' THEN
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.ph_extension_weeks, NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
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
    -- (start_date is covered by its own active-immutability guard above; while
    -- pending, an admin may still adjust it before confirmation.)
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

-- ------------------------------------------------------------
-- 5. package_live_balances() — re-anchor the window start to start_date.
--    FIFO order (expires_on, confirmed_at, id) is UNCHANGED (⚠ RISK 2).
--
--    ⚠ §7.115: the CURRENT body is the make-up-category-snapshot version from
--    20260802000400, NOT the original 20260720000100. Re-derived from the LIVE
--    definition (pg_get_functiondef), so the COALESCE(mb.category_id, …) that
--    makes the simulation read a make-up booking's snapshot is PRESERVED. The
--    only change here is the window start: pp.start_date, not SGT-of-confirmed.
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
           pp.start_date AS starts
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
  -- order). A lesson's CATEGORY is the make-up booking's snapshot when the row
  -- is a make-up guest's, else the class's live category — the engine's rule.
  FOR les IN
    SELECT ps.parent_id AS p_id, c.tenant_id AS t_id,
           COALESCE(mb.category_id, c.category_id) AS c_id,
           ls.session_date AS d
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id
    JOIN parent_students ps ON ps.student_id = a.student_id
    LEFT JOIN makeup_bookings mb
      ON mb.student_id = a.student_id
     AND mb.class_id = ls.class_id
     AND mb.session_date = ls.session_date
     AND mb.cancelled_at IS NULL
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
