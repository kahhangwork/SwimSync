-- ============================================================
-- Parent referral codes — double-sided package discount. Migration A.
-- Plan: docs/plans/REFERRAL_PLAN.md (Phase 1).
--
-- The FIRST price modifier in SwimSync. It touches only what a family PAYS for a
-- package (parent_packages.amount_payable), never what the package is WORTH
-- (total_value / value_remaining / invoice package_applied are untouched — D14).
--
-- A referral code is a SECOND KIND OF JOIN CODE, minted per active tenant
-- membership (REF-XXXXX). Entering it at join records a referral and mints the
-- friend's first-package discount; the referrer earns a discount on a LATER
-- package when the friend's first package goes active.
--
-- This migration adds, in order:
--   • parent_tenants.referral_code (+ disabled_at) + generate/assign (RISK 15).
--   • tenants referral settings; package_products per-product override (D4).
--   • referrals + referral_rewards tables (the relationship and the FIFO queue).
--   • parent_packages sale snapshot: discount_amount, amount_payable,
--     referral_reward_id (RISK 10 nullable→backfill→NOT NULL; RISK 11 pinned).
--   • referral_discount_for / preview_package_price (RISK 7 preview source).
--   • apply_referral_reward (BEFORE INSERT, reserves — RISK 2/4) +
--     settle_referral_reward (AFTER INS/UPD, uses/releases/converts — RISK 1/13).
--   • join_tenant_by_code extended (RETURNS TABLE changes ⇒ DROP+re-grant RISK 8).
--   • grant/void/disable/my_referrals admin+parent RPCs (RISK 5/6/15).
--   • handle_new_user copies join_code into parents.signup_join_code.
-- ============================================================

-- ══ 1. Referral codes on the membership row ══════════════════════════════════
ALTER TABLE parent_tenants
  ADD COLUMN referral_code             TEXT UNIQUE,
  ADD COLUMN referral_code_disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN parent_tenants.referral_code IS
  'A second kind of join code (REF-XXXXX), globally unique — resolved without a '
  'tenant. Minted unconditionally by the assign_referral_code DEFINER trigger.';
COMMENT ON COLUMN parent_tenants.referral_code_disabled_at IS
  'A leaked REF- code is an un-rotatable join code; disabling is the revoke path '
  '(RISK 15). A disabled code fails join with the one generic error.';

-- REF- + 5 of the join-code alphabet. Not a secret (it is shared by design), so
-- random() is fine — same posture as generate_join_code, no CSPRNG needed.
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out TEXT := '';
BEGIN
  FOR _ IN 1..5 LOOP
    out := out || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  END LOOP;
  RETURN 'REF-' || out;
END;
$$;
REVOKE ALL     ON FUNCTION public.generate_referral_code() FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.generate_referral_code() FROM anon;
GRANT  EXECUTE ON FUNCTION public.generate_referral_code() TO authenticated, service_role;

-- Mint on INSERT, unconditionally, retrying against the UNIQUE constraint.
-- DEFINER + explicit collision loop is the assign_parent_package_reference
-- doctrine (a client cannot INSERT parent_tenants today, but the mint must not
-- depend on that). Sorts before any future trigger; no dependency on order.
CREATE OR REPLACE FUNCTION public.assign_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_try INT := 0;
BEGIN
  LOOP
    NEW.referral_code := generate_referral_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM parent_tenants WHERE referral_code = NEW.referral_code
    );
    v_try := v_try + 1;
    IF v_try > 20 THEN
      RAISE EXCEPTION 'could not mint a unique referral code after 20 tries';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_referral_code
  BEFORE INSERT ON parent_tenants
  FOR EACH ROW EXECUTE FUNCTION assign_referral_code();

-- Backfill every existing membership (RISK 9 — trivial today, never by hand).
DO $$
DECLARE
  r RECORD;
  v_code TEXT;
  v_try INT;
BEGIN
  FOR r IN SELECT id FROM parent_tenants WHERE referral_code IS NULL LOOP
    v_try := 0;
    LOOP
      v_code := generate_referral_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM parent_tenants WHERE referral_code = v_code);
      v_try := v_try + 1;
      IF v_try > 20 THEN RAISE EXCEPTION 'backfill: no unique code'; END IF;
    END LOOP;
    UPDATE parent_tenants SET referral_code = v_code WHERE id = r.id;
  END LOOP;
END $$;

-- ══ 2. Tenant-wide referral settings ═════════════════════════════════════════
-- Covered by the admin-only tenants_update policy + the existing table grant
-- (§7.87 stays green: adding a column to an already-granted table changes no
-- table-level privilege).
ALTER TABLE tenants
  ADD COLUMN referral_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN referral_discount_type      TEXT
    CHECK (referral_discount_type IN ('percent', 'amount')),
  ADD COLUMN referral_discount_value     NUMERIC(10, 2),
  ADD COLUMN referral_reward_expiry_days INTEGER
    CHECK (referral_reward_expiry_days > 0),
  ADD CONSTRAINT tenants_referral_discount_valid CHECK (
    referral_discount_type IS NULL
    OR (referral_discount_value IS NOT NULL
        AND referral_discount_value >= 0
        AND (referral_discount_type <> 'percent' OR referral_discount_value <= 100))
  );

COMMENT ON COLUMN tenants.referral_enabled IS
  'Master switch. Off ⇒ discount 0 and no reward consumed (D15); the referral '
  'relationship and the referee reward are still recorded at join.';
COMMENT ON COLUMN tenants.referral_reward_expiry_days IS
  'Days from earn date for a REFERRER reward. NULL = never. A referee''s '
  'first-package discount never expires (D6).';

-- ══ 3. Per-product override (outside pin_package_product_terms) ═══════════════
-- Both NULL = inherit the tenant default; 0 = explicit "no referral discount on
-- this product", a conscious admin act (D4). Mutable: not in the pinned set.
ALTER TABLE package_products
  ADD COLUMN referral_discount_type  TEXT
    CHECK (referral_discount_type IN ('percent', 'amount')),
  ADD COLUMN referral_discount_value NUMERIC(10, 2),
  ADD CONSTRAINT package_products_referral_override_valid CHECK (
    (referral_discount_type IS NULL AND referral_discount_value IS NULL)
    OR (referral_discount_type IS NOT NULL
        AND referral_discount_value IS NOT NULL
        AND referral_discount_value >= 0
        AND (referral_discount_type <> 'percent' OR referral_discount_value <= 100))
  );

-- ══ 4. referrals — the relationship, one per (referee, tenant) ════════════════
CREATE TABLE referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referrer_parent_id   UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  referee_parent_id    UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  code_used            TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'converted', 'void')),
  void_reason          TEXT,
  converted_package_id UUID REFERENCES parent_packages(id),
  converted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referee_parent_id, tenant_id),
  CHECK (referrer_parent_id <> referee_parent_id)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_parent_id, tenant_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- ⚠ RISK 5 — a referrer sees only ids/status/dates HERE; NO arm is added to
-- parents_select / profiles_select, so the referee's name/email/phone stay
-- hidden. First names come from my_referrals() alone.
CREATE POLICY referrals_select ON referrals FOR SELECT TO authenticated
  USING (
    can_admin_tenant(tenant_id)
    OR referrer_parent_id = current_parent_id()
    OR referee_parent_id  = current_parent_id()
  );
-- No client INSERT/UPDATE/DELETE: every write is a DEFINER function.

GRANT SELECT ON referrals TO authenticated;
GRANT ALL    ON referrals TO service_role;

-- ══ 5. referral_rewards — the FIFO queue, one row per discountable package ═════
CREATE TABLE referral_rewards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id           UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL
                        CHECK (kind IN ('referee_first', 'referrer', 'manual')),
  referral_id         UUID REFERENCES referrals(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','reserved','used','expired','void')),
  earned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  -- ⚠ RISK 2 — reserved/used are written from a BEFORE INSERT trigger, when the
  -- package tuple does not exist yet. A non-deferrable FK's RI check fires at the
  -- end of that inner UPDATE and every package purchase dies. Defer to commit.
  reserved_package_id UUID REFERENCES parent_packages(id) DEFERRABLE INITIALLY DEFERRED,
  used_package_id     UUID REFERENCES parent_packages(id) DEFERRABLE INITIALLY DEFERRED,
  used_at             TIMESTAMPTZ,
  granted_by          UUID REFERENCES profiles(id),
  grant_reason        TEXT,
  voided_by           UUID REFERENCES profiles(id),
  voided_at           TIMESTAMPTZ,
  void_reason         TEXT,
  -- manual rewards have no referral; every other kind must name one.
  CHECK ((kind = 'manual') = (referral_id IS NULL))
);
CREATE INDEX referral_rewards_queue_idx
  ON referral_rewards (parent_id, tenant_id, status, earned_at);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_rewards_select ON referral_rewards FOR SELECT TO authenticated
  USING (
    can_admin_tenant(tenant_id)
    OR parent_id = current_parent_id()
  );
-- No client writes.

GRANT SELECT ON referral_rewards TO authenticated;
GRANT ALL    ON referral_rewards TO service_role;

-- ══ 6. parent_packages — sale snapshot columns ═══════════════════════════════
-- ⚠ RISK 10 — amount_payable added nullable → backfilled → NOT NULL (a NOT NULL
-- add with no default fails on a populated table). The base is owned by the
-- lifecycle trigger's INSERT branch, so every fixture is correct even if the
-- referral trigger is dropped; apply_referral_reward only ever REDUCES it.
ALTER TABLE parent_packages
  ADD COLUMN discount_amount    NUMERIC(10, 2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN amount_payable     NUMERIC(10, 2),
  ADD COLUMN referral_reward_id UUID REFERENCES referral_rewards(id);

UPDATE parent_packages SET amount_payable = total_value WHERE amount_payable IS NULL;
ALTER TABLE parent_packages ALTER COLUMN amount_payable SET NOT NULL;
ALTER TABLE parent_packages ADD CONSTRAINT parent_packages_amount_payable_valid
  CHECK (amount_payable >= 0 AND amount_payable <= total_value);

COMMENT ON COLUMN parent_packages.amount_payable IS
  'What the family PAYS (total_value − discount_amount). The QR/pay-page amount. '
  'Distinct from total_value (the package''s WORTH, which never moves — D14).';

-- ══ 7. Lifecycle trigger — set the discount base + pin the three columns ══════
-- Whole-body CREATE OR REPLACE off the live body (pg_get_functiondef, §7.115).
-- Only changes vs 20260815000500: INSERT sets discount_amount/amount_payable
-- base and nulls referral_reward_id; UPDATE gains the RISK 11 pin block.
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
    -- The discount BASE: full price, no discount, no reward. apply_referral_reward
    -- (trg_zz, DEFINER, runs after this) is the ONLY thing that reduces it.
    NEW.discount_amount    := 0;
    NEW.amount_payable     := NEW.total_value;
    NEW.referral_reward_id := NULL;
    -- Extensions and acks always start at zero — they are never seeded by a sale.
    NEW.ph_extension_weeks    := 0;
    NEW.manual_extension_days := 0;
    NEW.ph_ack_weeks_parent   := 0;
    NEW.ph_ack_weeks_admin    := 0;
    -- Offer claim / supersede columns are system-lifecycle; never seeded here.
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.ph_extension_weeks, NEW.manual_extension_days);
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

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

  IF current_user = 'authenticated'
     AND (NEW.ph_extension_weeks    IS DISTINCT FROM OLD.ph_extension_weeks
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days
          OR NEW.ph_ack_weeks_parent   IS DISTINCT FROM OLD.ph_ack_weeks_parent
          OR NEW.ph_ack_weeks_admin    IS DISTINCT FROM OLD.ph_ack_weeks_admin)
  THEN
    RAISE EXCEPTION 'Package extension and acknowledgement fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.offered_by         IS DISTINCT FROM OLD.offered_by
          OR NEW.offered_at      IS DISTINCT FROM OLD.offered_at
          OR NEW.paid_claimed_at IS DISTINCT FROM OLD.paid_claimed_at
          OR NEW.superseded_by   IS DISTINCT FROM OLD.superseded_by)
  THEN
    RAISE EXCEPTION 'Offer and payment-claim fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 11 — the referral discount snapshot is system-owned. Written on
  -- INSERT by apply_referral_reward and zeroed on expiry by settle_referral_reward
  -- (both DEFINER/postgres, which bypass this clause). Without this pin a parent
  -- PATCHes amount_payable to 0.01 and the QR honours it (parent_packages_update
  -- is row-scoped to their own rows).
  IF current_user = 'authenticated'
     AND (NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount
          OR NEW.amount_payable     IS DISTINCT FROM OLD.amount_payable
          OR NEW.referral_reward_id IS DISTINCT FROM OLD.referral_reward_id)
  THEN
    RAISE EXCEPTION 'Referral discount fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

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

-- ══ 8. referral_discount_for — the resolved (type, value) for a product ══════
-- Master switch first (D15): referral_enabled off ⇒ (NULL, 0), regardless of any
-- product override. Then product override (D4: a 0 override is a real "no
-- discount"), then tenant default, else (NULL, 0). STABLE + pure.
CREATE OR REPLACE FUNCTION public.referral_discount_for(p_product_id uuid)
 RETURNS TABLE(discount_type text, discount_value numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  p package_products%ROWTYPE;
  t tenants%ROWTYPE;
BEGIN
  SELECT * INTO p FROM package_products WHERE id = p_product_id;
  IF p.id IS NULL THEN
    discount_type := NULL; discount_value := 0; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO t FROM tenants WHERE id = p.tenant_id;

  IF NOT t.referral_enabled THEN
    discount_type := NULL; discount_value := 0; RETURN NEXT; RETURN;
  END IF;

  IF p.referral_discount_type IS NOT NULL THEN
    discount_type := p.referral_discount_type; discount_value := p.referral_discount_value;
  ELSIF t.referral_discount_type IS NOT NULL THEN
    discount_type := t.referral_discount_type; discount_value := t.referral_discount_value;
  ELSE
    discount_type := NULL; discount_value := 0;
  END IF;
  RETURN NEXT;
END;
$function$;
REVOKE ALL     ON FUNCTION public.referral_discount_for(uuid) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.referral_discount_for(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.referral_discount_for(uuid) TO authenticated, service_role;

-- The dollar discount for a resolved (type, value) against a price, capped.
CREATE OR REPLACE FUNCTION public.referral_discount_amount(
  p_type text, p_value numeric, p_total numeric
) RETURNS numeric
 LANGUAGE sql IMMUTABLE
AS $$
  SELECT LEAST(
    p_total,
    CASE
      WHEN p_type = 'percent' THEN round(COALESCE(p_value, 0) * p_total / 100, 2)
      WHEN p_type = 'amount'  THEN COALESCE(p_value, 0)
      ELSE 0
    END
  );
$$;
REVOKE ALL     ON FUNCTION public.referral_discount_amount(text, numeric, numeric) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.referral_discount_amount(text, numeric, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.referral_discount_amount(text, numeric, numeric) TO authenticated, service_role;

-- Does this family hold a reward that apply_referral_reward would consume for a
-- new package? Mirrors apply's usable set: available-unexpired, OR reserved by
-- the family's own open unclaimed offer (RISK 4 reclaim).
CREATE OR REPLACE FUNCTION public.family_has_usable_reward(p_parent_id uuid, p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM referral_rewards rr
    WHERE rr.parent_id = p_parent_id AND rr.tenant_id = p_tenant_id
      AND rr.status = 'available'
      AND (rr.expires_at IS NULL OR rr.expires_at > now())
    UNION ALL
    SELECT 1 FROM referral_rewards rr
    JOIN parent_packages pp ON pp.id = rr.reserved_package_id
    WHERE rr.parent_id = p_parent_id AND rr.tenant_id = p_tenant_id
      AND rr.status = 'reserved'
      AND (rr.expires_at IS NULL OR rr.expires_at > now())
      AND pp.status = 'pending' AND pp.offered_by IS NOT NULL
      AND pp.paid_claimed_at IS NULL
  );
$$;
REVOKE ALL     ON FUNCTION public.family_has_usable_reward(uuid, uuid) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.family_has_usable_reward(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.family_has_usable_reward(uuid, uuid) TO authenticated, service_role;

-- ⚠ RISK 7 — the ONE source of truth for every pre-insert price preview. Applies
-- exactly apply_referral_reward's rule WITHOUT reserving. DEFINER + can_admin.
CREATE OR REPLACE FUNCTION public.preview_package_price(p_parent_id uuid, p_product_id uuid)
 RETURNS TABLE(total_value numeric, discount_amount numeric, amount_payable numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p       package_products%ROWTYPE;
  v_type  text;
  v_value numeric;
  v_disc  numeric := 0;
BEGIN
  SELECT * INTO p FROM package_products WHERE id = p_product_id;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT can_admin_tenant(p.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to preview a package price for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  total_value := p.lesson_count * p.rate_per_lesson;

  IF family_has_usable_reward(p_parent_id, p.tenant_id) THEN
    SELECT dt.discount_type, dt.discount_value INTO v_type, v_value
      FROM referral_discount_for(p_product_id) dt;
    v_disc := referral_discount_amount(v_type, v_value, total_value);
  END IF;

  discount_amount := v_disc;
  amount_payable  := total_value - v_disc;
  RETURN NEXT;
END;
$function$;
REVOKE ALL     ON FUNCTION public.preview_package_price(uuid, uuid) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.preview_package_price(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.preview_package_price(uuid, uuid) TO authenticated, service_role;

-- ══ 9. apply_referral_reward — reserve at INSERT (⚠ RISK 2 / RISK 4) ══════════
-- BEFORE INSERT, DEFINER, named trg_zz_* so it sorts AFTER trg_parent_package_-
-- lifecycle (which sets total_value + the discount base) and after the reference
-- trigger. Reserves ONE reward FIFO, re-checking expiry, FOR UPDATE SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.apply_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reward_id uuid;
  v_type  text;
  v_value numeric;
  v_disc  numeric;
BEGIN
  -- Pick the oldest usable reward for THIS family. The candidate set is:
  --   available + unexpired, OR reserved by an open unclaimed offer of the same
  -- family that this insert is about to supersede (RISK 4 — the offer still
  -- holds the reward while this row is priced; create_package_offer refuses on
  -- an open offer so it cannot release it, so the handoff resolves HERE).
  SELECT rr.id INTO v_reward_id
  FROM referral_rewards rr
  WHERE rr.parent_id = NEW.parent_id
    AND rr.tenant_id = NEW.tenant_id
    AND (rr.expires_at IS NULL OR rr.expires_at > now())
    AND (
      rr.status = 'available'
      OR (
        rr.status = 'reserved'
        AND NEW.status IN ('pending', 'active')
        AND EXISTS (
          SELECT 1 FROM parent_packages pp
          WHERE pp.id = rr.reserved_package_id
            AND pp.id <> NEW.id
            AND pp.status = 'pending'
            AND pp.offered_by IS NOT NULL
            AND pp.paid_claimed_at IS NULL
        )
      )
    )
  ORDER BY rr.earned_at, rr.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_reward_id IS NULL THEN
    RETURN NEW;  -- no reward; base price stands.
  END IF;

  SELECT dt.discount_type, dt.discount_value INTO v_type, v_value
    FROM referral_discount_for(NEW.product_id) dt;
  v_disc := referral_discount_amount(v_type, v_value, NEW.total_value);

  -- ⚠ D9 / D15 — a 0-discount product (or programme off) does NOT consume a
  -- reward; it waits for the next eligible package.
  IF v_disc <= 0 THEN
    RETURN NEW;
  END IF;

  NEW.discount_amount    := v_disc;
  NEW.amount_payable     := NEW.total_value - v_disc;
  NEW.referral_reward_id := v_reward_id;

  UPDATE referral_rewards
     SET status = 'reserved', reserved_package_id = NEW.id
   WHERE id = v_reward_id;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_zz_apply_referral_reward
  BEFORE INSERT ON parent_packages
  FOR EACH ROW EXECUTE FUNCTION apply_referral_reward();

-- ══ 10. settle_referral_reward — use / release / convert (⚠ RISK 1 / 13) ══════
-- AFTER INSERT OR UPDATE, DEFINER, explicit family scoping.
CREATE OR REPLACE FUNCTION public.settle_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_became_active boolean;
  v_reward        referral_rewards%ROWTYPE;
  v_ref           referrals%ROWTYPE;
  v_same_house    boolean;
  v_expiry        timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_became_active := (NEW.status = 'active');
  ELSE
    v_became_active := (NEW.status = 'active' AND OLD.status <> 'active');
  END IF;

  -- (a) Reserved reward settles when its package goes active. ⚠ RISK 13 — a
  -- reward that EXPIRED while reserved settles as 'expired' and the discount is
  -- zeroed ONLY on an unclaimed row; a claimed row keeps the price it was paid
  -- (§7.159 family — never re-price a paid_claimed_at row).
  IF NEW.referral_reward_id IS NOT NULL AND v_became_active THEN
    SELECT * INTO v_reward FROM referral_rewards
      WHERE id = NEW.referral_reward_id FOR UPDATE;
    IF v_reward.status = 'reserved' THEN
      IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at <= now()
         AND NEW.paid_claimed_at IS NULL THEN
        UPDATE referral_rewards SET status = 'expired' WHERE id = v_reward.id;
        UPDATE parent_packages
           SET discount_amount = 0, amount_payable = total_value, referral_reward_id = NULL
         WHERE id = NEW.id;
      ELSE
        UPDATE referral_rewards
           SET status = 'used', used_package_id = NEW.id, used_at = now()
         WHERE id = v_reward.id;
      END IF;
    END IF;
  END IF;

  -- (b) A pending row that is cancelled (parent cancel, or supersede) releases
  -- its reserved reward back to available (or expired). The reserved_package_id
  -- guard is the RISK 4 safety: if apply_referral_reward re-pointed the reward
  -- to a newer row, this WHERE does not match and the reward is NOT released.
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'cancelled'
     AND NEW.referral_reward_id IS NOT NULL THEN
    UPDATE referral_rewards
       SET status = CASE WHEN expires_at IS NOT NULL AND expires_at <= now()
                         THEN 'expired' ELSE 'available' END,
           reserved_package_id = NULL
     WHERE id = NEW.referral_reward_id
       AND status = 'reserved'
       AND reserved_package_id = NEW.id;
  END IF;

  -- (c) Conversion — the referee's first package goes active. Once per referral
  -- (the pending→converted transition is the idempotency guard). ⚠ RISK 1 — a
  -- shared student / phone / postal_code voids it as same_household with no
  -- reward; the admin's manual Grant is the override.
  IF v_became_active THEN
    SELECT * INTO v_ref FROM referrals
      WHERE referee_parent_id = NEW.parent_id
        AND tenant_id = NEW.tenant_id
        AND status = 'pending'
      FOR UPDATE;
    IF FOUND THEN
      v_same_house := (
        EXISTS (
          SELECT 1 FROM parent_students a
          JOIN parent_students b ON a.student_id = b.student_id
          WHERE a.parent_id = v_ref.referrer_parent_id
            AND b.parent_id = v_ref.referee_parent_id
        )
        OR EXISTS (
          SELECT 1
          FROM parents pa1 JOIN profiles pr1 ON pr1.id = pa1.profile_id
          JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          JOIN profiles pr2 ON pr2.id = pa2.profile_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pr1.phone IS NOT NULL AND pr1.phone = pr2.phone
        )
        OR EXISTS (
          SELECT 1 FROM parents pa1 JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pa1.postal_code IS NOT NULL AND pa1.postal_code = pa2.postal_code
        )
      );

      IF v_same_house THEN
        UPDATE referrals
           SET status = 'void', void_reason = 'same_household'
         WHERE id = v_ref.id;
      ELSE
        UPDATE referrals
           SET status = 'converted', converted_package_id = NEW.id, converted_at = now()
         WHERE id = v_ref.id;

        SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
                    ELSE now() + (t.referral_reward_expiry_days || ' days')::interval END
          INTO v_expiry
          FROM tenants t WHERE t.id = NEW.tenant_id;

        INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at)
        VALUES (NEW.tenant_id, v_ref.referrer_parent_id, 'referrer', v_ref.id, v_expiry);
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_settle_referral_reward
  AFTER INSERT OR UPDATE ON parent_packages
  FOR EACH ROW EXECUTE FUNCTION settle_referral_reward();

-- ══ 11. join_tenant_by_code — extended (⚠ RISK 8: RETURNS TABLE change) ═══════
-- The signature stays (text), but the RESULT changes (adds `referred`), which
-- forces DROP + recreate. That destroys the ACL and COMMENT (§7.150), and on
-- cloud the default-privilege fallback is EXECUTE to anon (§7.39). Re-grant and
-- re-comment ADJACENT to the DROP, in this migration.
DROP FUNCTION IF EXISTS public.join_tenant_by_code(text);
CREATE FUNCTION public.join_tenant_by_code(p_code TEXT)
RETURNS TABLE(tenant_id UUID, display_name TEXT, referred BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id  UUID;
  v_tenant     RECORD;
  v_code       TEXT;
  v_referrer   UUID;
  v_was_member BOOLEAN;
  v_has_pkg    BOOLEAN;
  v_referred   BOOLEAN := FALSE;
BEGIN
  v_parent_id := current_parent_id();
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'only a parent account can join with a code';
  END IF;

  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'enter a join code';
  END IF;

  -- First a tenant join code (the non-referred route).
  SELECT t.id, t.display_name, NULL::uuid AS referrer
    INTO v_tenant
    FROM tenants t WHERE UPPER(t.join_code) = v_code;

  -- Else a referral code on an ACTIVE, non-disabled membership. Every failure
  -- below keeps the ONE generic message (anti-probing): a code must not double
  -- as a probe for which tenants/referrers/suspensions exist.
  IF v_tenant.id IS NULL THEN
    SELECT t.id, t.display_name, pt.parent_id AS referrer
      INTO v_tenant
      FROM parent_tenants pt
      JOIN tenants t ON t.id = pt.tenant_id
     WHERE UPPER(pt.referral_code) = v_code
       AND pt.is_active
       AND pt.referral_code_disabled_at IS NULL;
    v_referrer := v_tenant.referrer;
  END IF;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  IF tenant_suspended(v_tenant.id) THEN
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- Self-referral is not a real referral, and disclosing "that's your own code"
  -- is a probe — same generic message (D3, RISK from the plan's step 4).
  IF v_referrer IS NOT NULL AND v_referrer = v_parent_id THEN
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- Referral recorded iff (a) not self [above], (b) the joiner was NOT already a
  -- member of this tenant, (c) they hold no package in it. Capture (b)/(c)
  -- BEFORE the upsert.
  -- Qualify every column: the OUT parameter `tenant_id` shadows a bare one.
  SELECT EXISTS (
    SELECT 1 FROM parent_tenants pt2
    WHERE pt2.parent_id = v_parent_id AND pt2.tenant_id = v_tenant.id
  ) INTO v_was_member;
  SELECT EXISTS (
    SELECT 1 FROM parent_packages pp2
    WHERE pp2.parent_id = v_parent_id AND pp2.tenant_id = v_tenant.id
  ) INTO v_has_pkg;

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent_id, v_tenant.id)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key
  DO UPDATE SET is_active = TRUE, inactivated_at = NULL;

  IF v_referrer IS NOT NULL AND NOT v_was_member AND NOT v_has_pkg THEN
    INSERT INTO referrals (tenant_id, referrer_parent_id, referee_parent_id, code_used)
    VALUES (v_tenant.id, v_referrer, v_parent_id, v_code);

    -- B's first-package discount: minted always, never expires (D6/D15).
    INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id)
    SELECT v_tenant.id, v_parent_id, 'referee_first', r.id
      FROM referrals r
     WHERE r.referee_parent_id = v_parent_id AND r.tenant_id = v_tenant.id;

    v_referred := TRUE;
  END IF;

  RETURN QUERY SELECT v_tenant.id, v_tenant.display_name, v_referred;
END;
$$;

REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM anon;
REVOKE ALL     ON FUNCTION public.join_tenant_by_code(text) FROM service_role;
GRANT  EXECUTE ON FUNCTION public.join_tenant_by_code(text) TO authenticated;

COMMENT ON FUNCTION public.join_tenant_by_code(text) IS
  'Join a business by its SWIM- code OR a REF- referral code. A referral is '
  'recorded (and both rewards minted) only for a NEW member with no package; '
  'every failure returns the one generic message (anti-probing). RISK 8.';

-- ══ 12. Admin + parent RPCs ══════════════════════════════════════════════════
-- grant_referral_reward — goodwill / forgot-the-code (D12). Manual reward in the
-- caller's own admin tenant, for a family that belongs to it.
CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_parent_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_tenant   uuid;
  v_expiry   timestamptz;
  v_reward_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF v_tenant IS NULL OR NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'Not authorized to grant a referral reward.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants WHERE parent_id = p_parent_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
              ELSE now() + (t.referral_reward_expiry_days || ' days')::interval END
    INTO v_expiry FROM tenants t WHERE t.id = v_tenant;

  INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at,
                                granted_by, grant_reason)
  VALUES (v_tenant, p_parent_id, 'manual', NULL, v_expiry, auth.uid(), p_reason)
  RETURNING id INTO v_reward_id;
  RETURN v_reward_id;
END;
$function$;
REVOKE ALL     ON FUNCTION public.grant_referral_reward(uuid, text) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.grant_referral_reward(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.grant_referral_reward(uuid, text) TO authenticated, service_role;

-- void_referral_reward — only available/reserved. ⚠ RISK 6 — REFUSES on a
-- reserved package that carries a payment claim (never re-price a claimed row).
-- On an unclaimed reserved row it zeroes the package's discount.
CREATE OR REPLACE FUNCTION public.void_referral_reward(p_reward_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_reward referral_rewards%ROWTYPE;
  v_claimed timestamptz;
BEGIN
  SELECT * INTO v_reward FROM referral_rewards WHERE id = p_reward_id FOR UPDATE;
  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'No such reward.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT can_admin_tenant(v_reward.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to void this reward.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_reward.status NOT IN ('available', 'reserved') THEN
    RAISE EXCEPTION 'Only an unused reward can be voided.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_reward.status = 'reserved' AND v_reward.reserved_package_id IS NOT NULL THEN
    SELECT paid_claimed_at INTO v_claimed FROM parent_packages
      WHERE id = v_reward.reserved_package_id;
    IF v_claimed IS NOT NULL THEN
      RAISE EXCEPTION 'This reward is on a package the family has already paid — it cannot be voided.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Unclaimed: restore the reserved package to full price.
    UPDATE parent_packages
       SET discount_amount = 0, amount_payable = total_value, referral_reward_id = NULL
     WHERE id = v_reward.reserved_package_id;
  END IF;

  UPDATE referral_rewards
     SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = p_reason
   WHERE id = p_reward_id;
END;
$function$;
REVOKE ALL     ON FUNCTION public.void_referral_reward(uuid, text) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.void_referral_reward(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.void_referral_reward(uuid, text) TO authenticated, service_role;

-- disable / enable a family's referral code (RISK 15).
CREATE OR REPLACE FUNCTION public.set_referral_code_disabled(
  p_parent_tenant_id uuid, p_disabled boolean
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM parent_tenants WHERE id = p_parent_tenant_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No such membership.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE parent_tenants
     SET referral_code_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END
   WHERE id = p_parent_tenant_id;
END;
$function$;
REVOKE ALL     ON FUNCTION public.set_referral_code_disabled(uuid, boolean) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.set_referral_code_disabled(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_referral_code_disabled(uuid, boolean) TO authenticated, service_role;

-- my_referrals — the PARENT's own view: families they brought, first name only
-- (⚠ RISK 5 — never the full identity).
CREATE OR REPLACE FUNCTION public.my_referrals()
 RETURNS TABLE(tenant_id uuid, business_name text, referee_first_name text,
               status text, created_at timestamptz, converted_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT r.tenant_id, t.display_name,
         split_part(pr.full_name, ' ', 1) AS referee_first_name,
         r.status, r.created_at, r.converted_at
  FROM referrals r
  JOIN tenants t   ON t.id = r.tenant_id
  JOIN parents pa  ON pa.id = r.referee_parent_id
  JOIN profiles pr ON pr.id = pa.profile_id
  WHERE r.referrer_parent_id = current_parent_id()
  ORDER BY r.created_at DESC;
$function$;
REVOKE ALL     ON FUNCTION public.my_referrals() FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.my_referrals() FROM anon;
GRANT  EXECUTE ON FUNCTION public.my_referrals() TO authenticated, service_role;

-- ══ 13. handle_new_user — carry the join code through signup ══════════════════
ALTER TABLE parents ADD COLUMN signup_join_code TEXT;
COMMENT ON COLUMN parents.signup_join_code IS
  'The join/referral code entered at registration (email confirmation defers any '
  'session, so it cannot be applied post-signup). The parent home applies it once '
  'via join_tenant_by_code and clears it via their own UPDATE.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    INSERT INTO parents (profile_id, signup_join_code)
    VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data->>'join_code', ''));
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
