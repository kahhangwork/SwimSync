-- ============================================================
-- ROLLBACK for 20260815000700_referrals.sql (⚠ RISK 16).
-- Plan: docs/plans/REFERRAL_PLAN.md.
--
-- Restores join_tenant_by_code, handle_new_user and
-- enforce_parent_package_lifecycle from pg_get_functiondef() taken BEFORE the
-- migration (§7.93, §7.115), drops the two new tables, the new triggers and
-- functions, and every added column. Rehearse: UP then DOWN on a fresh reset
-- must leave those three functions byte-identical and supabase test db at its
-- pre-migration totals.
--
-- Run manually (not auto-applied): supabase db reset does NOT run rollback/.
-- ============================================================

BEGIN;

-- ── 1. Drop the new triggers (before their functions) ────────────────────────
DROP TRIGGER IF EXISTS trg_settle_referral_reward   ON parent_packages;
DROP TRIGGER IF EXISTS trg_zz_apply_referral_reward ON parent_packages;
DROP TRIGGER IF EXISTS trg_assign_referral_code     ON parent_tenants;

-- ── 2. Restore the three replaced functions to their pre-migration bodies ────
-- join_tenant_by_code's RESULT changed, so DROP + recreate + re-grant + comment.
DROP FUNCTION IF EXISTS public.join_tenant_by_code(text);

CREATE OR REPLACE FUNCTION public.join_tenant_by_code(p_code text)
 RETURNS TABLE(tenant_id uuid, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_id UUID;
  v_tenant    RECORD;
  v_code      TEXT;
BEGIN
  v_parent_id := current_parent_id();
  IF v_parent_id IS NULL THEN
    -- Coaches and admins have no business joining a tenant as a customer.
    RAISE EXCEPTION 'only a parent account can join with a code';
  END IF;

  -- Normalised so a code read off a phone screen still works: codes are
  -- generated uppercase with no ambiguous characters, and people type them
  -- with stray spaces and lowercase.
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'enter a join code';
  END IF;

  SELECT t.id, t.display_name INTO v_tenant
    FROM tenants t WHERE UPPER(t.join_code) = v_code;

  IF v_tenant.id IS NULL THEN
    -- Deliberately identical wording for "no such code": distinguishing
    -- "wrong code" from "code exists but something else failed" would let a
    -- caller probe which codes are real.
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- Suspension refusal (20260813000300), IDENTICAL wording by the same
  -- anti-probing rule: a join code must not double as a suspension probe.
  IF tenant_suspended(v_tenant.id) THEN
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- ON CONFLICT names the CONSTRAINT rather than the columns: this function
  -- RETURNS TABLE (tenant_id …), so a bare `tenant_id` in the conflict target
  -- is ambiguous between the OUT parameter and the column.
  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent_id, v_tenant.id)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key
  DO UPDATE SET is_active = TRUE, inactivated_at = NULL;

  RETURN QUERY SELECT v_tenant.id, v_tenant.display_name;
END;
$function$;

REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM anon;
REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM service_role;
GRANT  EXECUTE ON FUNCTION public.join_tenant_by_code(text) TO authenticated;
COMMENT ON FUNCTION public.join_tenant_by_code(text) IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role     user_role;
  v_tenant   UUID;
  v_is_coach BOOLEAN;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent');
  v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
  v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id) VALUES (NEW.id);
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    -- A private coach: administers the business and teaches in it.
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  -- The FIRST admin of a tenant is its owner. Guarded: a co-admin invited
  -- later finds owner_profile_id already set and changes nothing, and a parent
  -- or platform_admin (v_tenant NULL / role mismatch) never reaches this.
  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_parent_package_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- Offer claim / supersede columns are system-lifecycle; never seeded here.
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      -- A parent's request is pending until the admin confirms payment. A
      -- parent cannot set a start date; that is the admin's at-sale decision.
      -- A parent must not spoof "your coach prepared this" either (RISK 4).
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
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
      -- Pending admin-recorded request or OFFER: a start date may be pre-set
      -- now and is finalised at confirmation. offered_by/at (from
      -- create_package_offer, which runs as postgres) pass through untouched.
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

  -- ⚠ RISK 4 — offer provenance and the payment claim are system-owned. A
  -- parent INSERTs into this table and could otherwise UPDATE these to spoof
  -- "your coach prepared this" or fake a payment. paid_claimed_at is written by
  -- the public-package edge function (service_role, which bypasses this clause);
  -- superseded_by by supersede_open_package_offer (DEFINER/postgres);
  -- offered_by/at only ever by create_package_offer on INSERT.
  IF current_user = 'authenticated'
     AND (NEW.offered_by         IS DISTINCT FROM OLD.offered_by
          OR NEW.offered_at      IS DISTINCT FROM OLD.offered_at
          OR NEW.paid_claimed_at IS DISTINCT FROM OLD.paid_claimed_at
          OR NEW.superseded_by   IS DISTINCT FROM OLD.superseded_by)
  THEN
    RAISE EXCEPTION 'Offer and payment-claim fields are set by the system, not edited directly.'
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
$function$;

-- ── 3. Drop the new sale columns on parent_packages ──────────────────────────
ALTER TABLE parent_packages DROP CONSTRAINT IF EXISTS parent_packages_amount_payable_valid;
ALTER TABLE parent_packages
  DROP COLUMN IF EXISTS referral_reward_id,
  DROP COLUMN IF EXISTS amount_payable,
  DROP COLUMN IF EXISTS discount_amount;

-- ── 4. Drop the two new tables (rewards FKs referrals) ───────────────────────
DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referrals;

-- ── 5. Drop the new functions ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_referral_reward();
DROP FUNCTION IF EXISTS public.settle_referral_reward();
DROP FUNCTION IF EXISTS public.assign_referral_code();
DROP FUNCTION IF EXISTS public.preview_package_price(uuid, uuid);
DROP FUNCTION IF EXISTS public.family_has_usable_reward(uuid, uuid);
DROP FUNCTION IF EXISTS public.referral_discount_for(uuid);
DROP FUNCTION IF EXISTS public.referral_discount_amount(text, numeric, numeric);
DROP FUNCTION IF EXISTS public.generate_referral_code();
DROP FUNCTION IF EXISTS public.grant_referral_reward(uuid, text);
DROP FUNCTION IF EXISTS public.void_referral_reward(uuid, text);
DROP FUNCTION IF EXISTS public.set_referral_code_disabled(uuid, boolean);
DROP FUNCTION IF EXISTS public.my_referrals();

-- ── 6. Drop the added settings/override/code columns ─────────────────────────
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_referral_discount_valid;
ALTER TABLE tenants
  DROP COLUMN IF EXISTS referral_enabled,
  DROP COLUMN IF EXISTS referral_discount_type,
  DROP COLUMN IF EXISTS referral_discount_value,
  DROP COLUMN IF EXISTS referral_reward_expiry_days;

ALTER TABLE package_products DROP CONSTRAINT IF EXISTS package_products_referral_override_valid;
ALTER TABLE package_products
  DROP COLUMN IF EXISTS referral_discount_type,
  DROP COLUMN IF EXISTS referral_discount_value;

ALTER TABLE parent_tenants
  DROP COLUMN IF EXISTS referral_code,
  DROP COLUMN IF EXISTS referral_code_disabled_at;

ALTER TABLE parents DROP COLUMN IF EXISTS signup_join_code;

COMMIT;
