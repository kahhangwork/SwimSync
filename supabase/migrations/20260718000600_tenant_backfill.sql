-- ============================================================
-- Multi-tenancy, step 3 of 4: backfill existing data into tenants.
--
-- DATA-DRIVEN, not hardcoded, so it produces the right result on the local seed
-- (one seeded coach) and on production (one real coach + 4 classes) without
-- knowing either. The rule:
--
--   ONE TENANT PER EXISTING COACH, and that coach becomes its tenant_admin.
--
-- That is the private-coach shape from TENANCY_DESIGN.md §1 — a tenant of one
-- where admin and coach are the same person. It is also the user's explicit call
-- for production: the real coach owns their business, and the owner steps back
-- to platform_admin.
--
-- ⚠️ ONE-WAY. Take a verified backup before `supabase db push`.
--
-- EXPAND/CONTRACT: it COPIES parents.credit_balance and coaches.paynow_qr_url to
-- their new homes but does NOT drop them — see the note at the bottom of this
-- file. Their readers move in later phases; a CONTRACT migration drops them then.
--
-- ⚠️ BEHAVIOUR CHANGE, deliberate: an existing coach becomes a tenant_admin and
-- therefore gains ADMIN PANEL ACCESS they did not have. That is the intended end
-- state (they own their business), but it is a real change to a real person's
-- account — tell them.
--
-- Defensive throughout: this runs once, against live billing data, and a silent
-- wrong answer here is worse than a failed migration. Ambiguity RAISEs.
-- ============================================================

DO $$
DECLARE
  v_coach       RECORD;
  v_tenant_id   UUID;
  v_code        TEXT;
  v_tenants     INT;
  v_orphans     INT;
  v_auto        BOOLEAN;
  v_run_day     SMALLINT;
  v_before      NUMERIC;
  v_after       NUMERIC;
BEGIN
  -- Carry the current GLOBAL settings onto each tenant so the per-tenant values
  -- start out identical to today's behaviour.
  SELECT COALESCE((value #>> '{}')::boolean, TRUE) INTO v_auto
    FROM app_settings WHERE key = 'auto_invoice_enabled';
  SELECT COALESCE((value #>> '{}')::smallint, 7) INTO v_run_day
    FROM app_settings WHERE key = 'invoice_run_day';
  v_auto := COALESCE(v_auto, TRUE);
  v_run_day := LEAST(28, GREATEST(1, COALESCE(v_run_day, 7)));

  -- ---- One tenant per coach -------------------------------------------------
  FOR v_coach IN
    SELECT c.id AS coach_id, c.profile_id, c.paynow_qr_url, p.full_name
    FROM coaches c
    JOIN profiles p ON p.id = c.profile_id
    ORDER BY c.created_at
  LOOP
    -- Retry on the (vanishingly unlikely) join-code collision rather than
    -- failing the whole migration on a random draw.
    LOOP
      v_code := generate_join_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE join_code = v_code);
    END LOOP;

    INSERT INTO tenants (
      display_name, slug, kind, paynow_qr_url, join_code,
      auto_invoice_enabled, invoice_run_day
    )
    VALUES (
      COALESCE(NULLIF(TRIM(v_coach.full_name), ''), 'SwimSync Coach'),
      -- Slug from the coach id: stable, unique, no name-collision handling.
      'coach-' || REPLACE(v_coach.coach_id::text, '-', '')::text,
      'private',
      v_coach.paynow_qr_url,   -- QR moves to the business
      v_code,
      v_auto,
      v_run_day
    )
    RETURNING id INTO v_tenant_id;

    UPDATE coaches  SET tenant_id = v_tenant_id WHERE id = v_coach.coach_id;
    UPDATE classes  SET tenant_id = v_tenant_id WHERE coach_id = v_coach.coach_id;

    -- The coach becomes the admin of their own business AND keeps their coaches
    -- row. Capability is determined by which extension rows exist, not by the
    -- enum alone, so the mobile app still routes them to the coach UI.
    UPDATE profiles
       SET role = 'tenant_admin', tenant_id = v_tenant_id
     WHERE id = v_coach.profile_id;
  END LOOP;

  -- ---- Students -------------------------------------------------------------
  -- From their class where they have one.
  UPDATE students s
     SET tenant_id = c.tenant_id
    FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
   WHERE e.student_id = s.id
     AND s.tenant_id IS NULL;

  -- Unassigned children have no enrolment to derive from. With exactly one
  -- tenant they can only belong to it — they signed up for that coach. With
  -- several the answer is genuinely unknown, and guessing would put a child in a
  -- stranger's queue, so stop and let a human decide.
  SELECT COUNT(*) INTO v_tenants FROM tenants;
  SELECT COUNT(*) INTO v_orphans FROM students WHERE tenant_id IS NULL;

  IF v_orphans > 0 THEN
    IF v_tenants = 1 THEN
      UPDATE students SET tenant_id = (SELECT id FROM tenants) WHERE tenant_id IS NULL;
    ELSE
      RAISE EXCEPTION
        '% student(s) have no class and there are % tenants — cannot infer which business they belong to. Assign them manually, then re-run.',
        v_orphans, v_tenants;
    END IF;
  END IF;

  -- ---- Billing rows ---------------------------------------------------------
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

  -- An invoice with no line items (possible: a fully credit-covered one still
  -- has items, but be defensive) falls back to its parent's only tenant.
  UPDATE invoices i
     SET tenant_id = (SELECT id FROM tenants)
   WHERE i.tenant_id IS NULL AND v_tenants = 1;

  UPDATE billing_periods SET tenant_id = (SELECT id FROM tenants)
   WHERE tenant_id IS NULL AND v_tenants = 1;

  IF EXISTS (SELECT 1 FROM billing_periods WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION
      'billing_periods rows could not be attributed to a tenant (% tenants exist). Resolve manually.', v_tenants;
  END IF;

  -- ---- Parents: tenant links + credit ---------------------------------------
  -- EVERY existing parent must get a parent_tenants row, or phase 3 (join codes)
  -- strands them: add-child is gated on having joined a tenant, so a parent
  -- already onboarded would silently lose the ability to add a child.
  INSERT INTO parent_tenants (parent_id, tenant_id)
  SELECT DISTINCT ps.parent_id, s.tenant_id
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
   WHERE s.tenant_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- A parent with no children yet still needs a link when there is only one
  -- business to belong to.
  IF v_tenants = 1 THEN
    INSERT INTO parent_tenants (parent_id, tenant_id)
    SELECT p.id, (SELECT id FROM tenants) FROM parents p
    ON CONFLICT DO NOTHING;
  END IF;

  -- Credit moves to (parent, tenant). Attributed to the tenant the parent
  -- actually deals with; with one tenant that is unambiguous.
  SELECT COALESCE(SUM(credit_balance), 0) INTO v_before FROM parents;

  INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
  SELECT p.id, pt.tenant_id, p.credit_balance
    FROM parents p
    JOIN parent_tenants pt ON pt.parent_id = p.id
   WHERE p.credit_balance <> 0
  ON CONFLICT (parent_id, tenant_id) DO UPDATE
     SET credit_balance = EXCLUDED.credit_balance;

  SELECT COALESCE(SUM(credit_balance), 0) INTO v_after FROM parent_tenant_balances;

  -- Credit is money owed to real families. If the move did not conserve it,
  -- something is wrong with an assumption above — stop rather than silently
  -- create or destroy a balance. (A parent in two tenants with a non-zero
  -- balance would duplicate it; that cannot happen at one tenant, and this
  -- assertion is what catches it if it ever could.)
  IF v_before <> v_after THEN
    RAISE EXCEPTION
      'credit did not reconcile: parents.credit_balance summed to %, parent_tenant_balances to %', v_before, v_after;
  END IF;

  -- ---- Platform admin -------------------------------------------------------
  -- The owner sees everything, belongs to no tenant. Done AFTER the coach loop
  -- so a superadmin who is somehow also a coach ends up a tenant_admin (the
  -- narrower, safer role) rather than platform_admin.
  UPDATE profiles SET role = 'platform_admin', tenant_id = NULL
   WHERE role = 'superadmin';
END $$;

-- ------------------------------------------------------------
-- Now that every row has a tenant, tighten the columns.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Tighten ONLY the columns whose writers already supply a tenant.
--
--   coaches — the auth trigger refuses to create one without a tenant.
--   classes — the class_tenant_fill trigger derives it from the coach.
--
-- The rest stay NULLABLE until the phase that updates their writer, which is
-- what expand/contract means here:
--   students        — the parent add-child flow sets it in phase 3 (join codes).
--   invoices        — the billing engine sets it in phase 2.
--   credit_notes    — follows the invoice.
--   billing_periods — the engine seals per tenant in phase 2.
--
-- Tightening ahead of the writer would break a live flow for no benefit: the
-- backfill has already populated every existing row, so the only rows that
-- could be NULL are ones written by code that has not moved yet.
-- ------------------------------------------------------------

ALTER TABLE coaches ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE classes ALTER COLUMN tenant_id SET NOT NULL;

-- ------------------------------------------------------------
-- EXPAND / CONTRACT: the old columns STAY, deprecated.
--
-- `coaches.paynow_qr_url` and `parents.credit_balance` have been COPIED to
-- `tenants.paynow_qr_url` and `parent_tenant_balances`, which are now the source
-- of truth. They are deliberately NOT dropped here.
--
-- Dropping them in this migration would break a LIVE app: the parent home and
-- child-detail screens read credit_balance, and the PayNow screen, coach
-- settings and admin coaches page read paynow_qr_url. A `git push` deploys the
-- two web apps via Vercel while migrations need a separate manual
-- `supabase db push`, so the two can never land atomically — there is always a
-- window where one is ahead of the other.
--
-- Worse, it would take the test suites red for the whole gap between this phase
-- and the reader migration, which is exactly the stretch that rewrites the
-- money model. Losing the regression signal during the riskiest change is a bad
-- trade for two DDL lines.
--
-- CONTRACT STEP (a later migration, once nothing reads them):
--   ALTER TABLE coaches DROP COLUMN paynow_qr_url;
--   ALTER TABLE parents DROP COLUMN credit_balance;
-- Until then the credit-note trigger DUAL-WRITES both balances so the
-- deprecated column never goes stale (20260718001000).
-- ------------------------------------------------------------

COMMENT ON COLUMN coaches.paynow_qr_url IS
  'DEPRECATED — superseded by tenants.paynow_qr_url (parents pay the business, not the coach). Kept until the readers move; drop then.';
COMMENT ON COLUMN parents.credit_balance IS
  'DEPRECATED — superseded by parent_tenant_balances (credit never crosses tenants). Dual-written by handle_attendance_update until the readers move; drop then.';

-- ------------------------------------------------------------
-- A student may only ever be enrolled in a class of their OWN tenant.
--
-- A cross-tenant enrolment is the single most damaging row this schema can
-- hold: it would put a child on another business's roster, in their attendance,
-- and on their invoices. Enforced by trigger because a CHECK cannot reach
-- across tables.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_enrolment_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_tenant UUID;
  v_class_tenant   UUID;
BEGIN
  SELECT tenant_id INTO v_student_tenant FROM students WHERE id = NEW.student_id;
  SELECT tenant_id INTO v_class_tenant   FROM classes  WHERE id = NEW.class_id;

  -- TRANSITIONAL (until phase 3): a student created by the current add-child
  -- flow has no tenant yet. Assignment is what places them in a business, so
  -- adopt the class's tenant rather than refusing — otherwise the superadmin
  -- could not assign any newly-added child. Once add-child sets tenant_id at
  -- creation this branch becomes dead and the guard is purely a check.
  IF v_student_tenant IS NULL AND v_class_tenant IS NOT NULL THEN
    UPDATE students SET tenant_id = v_class_tenant WHERE id = NEW.student_id;
    RETURN NEW;
  END IF;

  IF v_student_tenant IS DISTINCT FROM v_class_tenant THEN
    RAISE EXCEPTION
      'cross-tenant enrolment refused: student % is in tenant %, class % is in tenant %',
      NEW.student_id, v_student_tenant, NEW.class_id, v_class_tenant;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enrolment_tenant_guard
  BEFORE INSERT OR UPDATE ON student_class_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_enrolment_tenant();
