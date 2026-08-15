-- ============================================================
-- Package renewal automation — Migration A: OFFERS.
-- Plan: docs/plans/PACKAGE_RENEWAL_AUTOMATION_PLAN.md (Phase 1).
--
-- Gives packages the loop invoices already have. An "offer" is an
-- admin-created PENDING parent_packages row carrying a public payment token;
-- the family pays via a tokenised /package/<token> page (the public-package
-- edge function), taps "I've paid", the admin confirms with the existing
-- Payment received button, and the row goes active WITH THE OFFER'S start_date.
--
-- This migration adds:
--   • five columns on parent_packages (offered_by/at, public_token,
--     paid_claimed_at, superseded_by) — each PINNED in the lifecycle trigger.
--   • public_token minting (UNCONDITIONAL, in the reference DEFINER trigger —
--     ⚠ RISK 4: a parent INSERTs into this table, so an invoker-rights mint
--     dies with `permission denied for gen_random_bytes`).
--   • supersede_open_package_offer() — a newer pending/active row cancels the
--     family's open UNCLAIMED offer (⚠ RISK 1: never one that carries a
--     payment claim; DEFINER with explicit tenant/parent scoping).
--   • tenants.package_expiry_warning_days (the expiry half of "running low").
--   • create_package_offer() RPC (⚠ RISK 12: one open offer per family).
--   • student_package_coverage() extended with package_id/name/expires_on/low
--     (⚠ RISK 2 / RISK 7: family-grain low; DROP+recreate re-grants the ACL).
--   • package_renewal_candidates() RPC — one row per low family.
-- ============================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE parent_packages
  ADD COLUMN offered_by      UUID REFERENCES profiles(id),
  ADD COLUMN offered_at      TIMESTAMPTZ,
  ADD COLUMN public_token    TEXT UNIQUE,
  ADD COLUMN paid_claimed_at TIMESTAMPTZ,
  ADD COLUMN superseded_by   UUID REFERENCES parent_packages(id);

COMMENT ON COLUMN parent_packages.offered_by IS
  'Non-null => an admin created this as a renewal OFFER (create_package_offer).';
COMMENT ON COLUMN parent_packages.public_token IS
  'Tokenised access to the /package/<token> pay page. Minted unconditionally by '
  'assign_parent_package_reference (DEFINER); never client-writable (RISK 4).';
COMMENT ON COLUMN parent_packages.paid_claimed_at IS
  'Stamped by the public-package edge function when the family taps "I''ve paid".';
COMMENT ON COLUMN parent_packages.superseded_by IS
  'The newer pending/active row that cancelled this open UNCLAIMED offer (RISK 1).';

-- Backfill: every existing row gets a token so an old pending request is also
-- payable via the new page. Same unconditional-mint doctrine as the trigger.
UPDATE parent_packages
   SET public_token = encode(extensions.gen_random_bytes(16), 'hex')
 WHERE public_token IS NULL;

-- ── tenants: the expiry half of "running low" ────────────────────────────────
-- Sibling of low_package_lessons. Covered by the existing table-level UPDATE
-- grant + the admin-only tenants_update policy (no explicit grant needed; the
-- catalogue-driven table_grants.test.sql stays green — §7.87).
ALTER TABLE tenants
  ADD COLUMN package_expiry_warning_days INTEGER NOT NULL DEFAULT 14
    CHECK (package_expiry_warning_days >= 0);

COMMENT ON COLUMN tenants.package_expiry_warning_days IS
  'The expiry half of "running low": a family is a renewal candidate when its '
  'latest covering package expires within this many days. Sibling of low_package_lessons.';

-- ── Lifecycle trigger — PIN the five new columns (§7.157) ────────────────────
-- Whole-body CREATE OR REPLACE (read from pg_get_functiondef — §7.115). The
-- only changes vs the live body: (1) INSERT nulls paid_claimed_at/superseded_by
-- always, and offered_by/offered_at for a parent (RISK 4); (2) a new UPDATE pin
-- block making offer provenance and the payment claim system-owned.
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

-- ── Reference trigger — mint public_token unconditionally (⚠ RISK 4) ─────────
CREATE OR REPLACE FUNCTION public.assign_parent_package_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    -- Unreachable while this trigger sorts AFTER trg_parent_package_lifecycle,
    -- which is what fills tenant_id from the product. If it ever fires, a
    -- trigger was renamed: same-timing row triggers run in alphabetical order
    -- by trigger name, and 'trg_parent_package_reference' must sort after
    -- 'trg_parent_package_lifecycle'. See this migration's header.
    RAISE EXCEPTION
      'package reference cannot be minted before tenant_id is set — trigger order broken (expected trg_parent_package_reference to fire AFTER trg_parent_package_lifecycle)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Unconditional: whatever the insert claimed is discarded. Do NOT "restore"
  -- an IS NULL guard here, and do NOT gate it on current_user — inside a
  -- SECURITY DEFINER function current_user is the owner, so such a check
  -- never fires. See this section's header.
  NEW.reference_number := next_package_ref(
    NEW.tenant_id,
    to_char(NEW.requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY')
  );

  -- ⚠ RISK 4 — mint the public token HERE, in the DEFINER trigger, and
  -- unconditionally. A parent INSERTs into parent_packages directly; an
  -- invoker-rights mint would die with `permission denied for gen_random_bytes`
  -- for the authenticated role, and an only-when-NULL mint would be
  -- parent-writable. Same doctrine as assign_invoice_public_fields.
  NEW.public_token := encode(extensions.gen_random_bytes(16), 'hex');

  RETURN NEW;
END;
$function$;

-- ── Pin trigger — public_token joins reference_number as non-client-writable ─
CREATE OR REPLACE FUNCTION public.pin_parent_package_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.reference_number IS DISTINCT FROM OLD.reference_number
      OR NEW.public_token   IS DISTINCT FROM OLD.public_token)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'parent_packages.reference_number / public_token are not client-writable — they identify and gate this package payment.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Supersede trigger — one open UNCLAIMED offer per family (⚠ RISK 1) ────────
CREATE OR REPLACE FUNCTION public.supersede_open_package_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A new pending request (from either side) or a direct active sale closes the
  -- family's open UNCLAIMED admin offer, so a family never holds two live pay
  -- links. It NEVER touches a parent's own pending request (offered_by IS NULL)
  -- nor an offer the family already PAID (paid_claimed_at IS NOT NULL — RISK 1:
  -- cancelled is terminal, and the PKG- reference on the bank statement must
  -- stay live). DEFINER so the lifecycle pins do not reject the system's own
  -- write; explicit tenant/parent scoping because DEFINER bypasses RLS.
  -- AFTER INSERT only: it never fires on UPDATE, so its own UPDATE cannot
  -- re-enter it (§7.57).
  IF NEW.status IN ('pending', 'active') THEN
    UPDATE parent_packages
       SET status        = 'cancelled',
           cancelled_at  = COALESCE(cancelled_at, now()),
           superseded_by = NEW.id
     WHERE tenant_id       = NEW.tenant_id
       AND parent_id       = NEW.parent_id
       AND id             <> NEW.id
       AND status          = 'pending'
       AND offered_by      IS NOT NULL
       AND paid_claimed_at IS NULL;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_supersede_open_package_offer
  AFTER INSERT ON parent_packages
  FOR EACH ROW EXECUTE FUNCTION supersede_open_package_offer();

-- ── create_package_offer() — the ONLY offer path (⚠ RISK 12) ─────────────────
-- Admin-only, tenant looked up server-side (copy of extend_package's guard
-- shape). Client never inserts offers directly, so offered_by can be trusted.
CREATE OR REPLACE FUNCTION public.create_package_offer(
  p_parent_id  uuid,
  p_product_id uuid,
  p_start_date date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product  package_products%ROWTYPE;
  v_offer_id uuid;
BEGIN
  SELECT * INTO v_product FROM package_products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT can_admin_tenant(v_product.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to offer a package for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'That package is no longer offered.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The parent must belong to this product's business. Parents link to a tenant
  -- via parent_tenants (many-to-many), NOT profiles.tenant_id (that is NULL for
  -- a parent — it names a STAFF member's home tenant).
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants pt
    WHERE pt.parent_id = p_parent_id AND pt.tenant_id = v_product.tenant_id
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 12 — one open offer per family. A second (or a double-click) must
  -- not mint a second pay link; the first would then 404 after supersede.
  IF EXISTS (
    SELECT 1 FROM parent_packages
    WHERE tenant_id = v_product.tenant_id
      AND parent_id = p_parent_id
      AND status = 'pending'
      AND offered_by IS NOT NULL
      AND paid_claimed_at IS NULL
      AND superseded_by IS NULL
  ) THEN
    RAISE EXCEPTION 'An offer is already open for this family — Decline it first.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO parent_packages (tenant_id, parent_id, product_id, status,
                               start_date, offered_by, offered_at)
  VALUES (v_product.tenant_id, p_parent_id, p_product_id, 'pending',
          p_start_date, auth.uid(), now())
  RETURNING id INTO v_offer_id;

  RETURN v_offer_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION create_package_offer(uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION create_package_offer(uuid, uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION create_package_offer(uuid, uuid, date) IS
  'Admin-only: create a PENDING renewal offer (offered_by = caller) with a '
  'public pay token. One open unclaimed offer per family (RISK 12).';

-- ── student_package_coverage() — add package_id/name/expires_on/low ──────────
-- RETURNS TABLE changes, so DROP + re-create, then RE-GRANT the ACL (⚠ RISK 7).
-- lessons_remaining stays the per-student, category-scoped family sum EXACTLY
-- as before (verify-packages "14 left" / Pia "Ad-hoc"). `low` is a FAMILY
-- verdict (⚠ RISK 2). No affordability comparison enters the predicate (the
-- coverage test greps the source for it).
DROP FUNCTION IF EXISTS student_package_coverage();
CREATE FUNCTION public.student_package_coverage()
 RETURNS TABLE(student_id uuid, parent_id uuid, tenant_id uuid, coverage text,
               lessons_remaining integer, package_id uuid, package_name text,
               expires_on date, low boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH live AS (
  SELECT lv.parent_package_id, lv.parent_id, lv.tenant_id, lv.category_id,
         lv.live_lessons_remaining, lv.expires_on, lv.name
  FROM package_live_balances() lv
  JOIN parent_packages pp ON pp.id = lv.parent_package_id
  WHERE lv.expires_on >= (now() AT TIME ZONE 'Asia/Singapore')::date
    AND pp.start_date <= (now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps
  JOIN students s ON s.id = ps.student_id
),
cats AS (
  SELECT DISTINCT sce.student_id, c.category_id
  FROM student_class_enrolments sce
  JOIN classes c ON c.id = sce.class_id
  WHERE sce.is_active
),
-- ⚠ RISK 2 — "low" is a FAMILY verdict, and a family that already has an open
-- pending row or a future-start active package is NOT low (those are not in
-- `live`, so without this exclusion they would flag as low forever).
fam AS (
  SELECT l.parent_id, l.tenant_id,
         sum(l.live_lessons_remaining)::integer AS fam_left,
         max(l.expires_on)                      AS fam_max_expiry
  FROM live l
  GROUP BY l.parent_id, l.tenant_id
),
open_row AS (
  SELECT DISTINCT pp.parent_id, pp.tenant_id
  FROM parent_packages pp
  WHERE pp.status = 'pending'
     OR (pp.status = 'active'
         AND pp.start_date > (now() AT TIME ZONE 'Asia/Singapore')::date)
),
fam_low AS (
  SELECT f.parent_id, f.tenant_id,
    ( (f.fam_left <= t.low_package_lessons
       OR f.fam_max_expiry - (now() AT TIME ZONE 'Asia/Singapore')::date
            <= t.package_expiry_warning_days)
      AND NOT EXISTS (SELECT 1 FROM open_row o
                       WHERE o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id)
    ) AS low
  FROM fam f
  JOIN tenants t ON t.id = f.tenant_id
),
verdict AS (
  SELECT
    l.student_id, l.parent_id, l.tenant_id,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id) AS n_cats,
    (SELECT count(*) FROM cats ct
      WHERE ct.student_id = l.student_id
        AND EXISTS (
          SELECT 1 FROM live lv
          WHERE lv.parent_id = l.parent_id
            AND lv.tenant_id = l.tenant_id
            AND (lv.category_id IS NULL OR lv.category_id = ct.category_id)
        )) AS n_covered,
    EXISTS (
      SELECT 1 FROM live lv
      WHERE lv.parent_id = l.parent_id AND lv.tenant_id = l.tenant_id
    ) AS has_any
  FROM links l
),
-- The covering package to SHOW per student: earliest-expiring covering package
-- that still has live lessons (fallback: earliest covering). Covering = the
-- package is all-classes, or its category is one of the student's.
cover AS (
  SELECT v.student_id,
    (SELECT lv.parent_package_id FROM live lv
      WHERE lv.parent_id = v.parent_id AND lv.tenant_id = v.tenant_id
        AND (lv.category_id IS NULL
             OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                    WHERE ct.student_id = v.student_id))
      ORDER BY (lv.live_lessons_remaining > 0) DESC, lv.expires_on, lv.parent_package_id
      LIMIT 1) AS package_id
  FROM verdict v
)
SELECT
  v.student_id,
  v.parent_id,
  v.tenant_id,
  CASE
    WHEN v.n_cats = 0 THEN CASE WHEN v.has_any THEN 'package' ELSE 'ad_hoc' END
    WHEN v.n_covered = 0 THEN 'ad_hoc'
    WHEN v.n_covered = v.n_cats THEN 'package'
    ELSE 'mixed'
  END AS coverage,
  CASE
    WHEN (v.n_cats = 0 AND v.has_any) OR v.n_covered > 0 THEN
      (SELECT sum(lv.live_lessons_remaining)::integer
       FROM live lv
       WHERE lv.parent_id = v.parent_id
         AND lv.tenant_id = v.tenant_id
         AND (v.n_cats = 0
              OR lv.category_id IS NULL
              OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                     WHERE ct.student_id = v.student_id)))
    ELSE NULL
  END AS lessons_remaining,
  cv.package_id,
  (SELECT lv.name       FROM live lv WHERE lv.parent_package_id = cv.package_id) AS package_name,
  (SELECT lv.expires_on FROM live lv WHERE lv.parent_package_id = cv.package_id) AS expires_on,
  CASE WHEN ((v.n_cats = 0 AND v.has_any) OR v.n_covered > 0)
       THEN COALESCE(fl.low, false) ELSE false END AS low
FROM verdict v
LEFT JOIN cover cv    ON cv.student_id = v.student_id
LEFT JOIN fam_low fl  ON fl.parent_id = v.parent_id AND fl.tenant_id = v.tenant_id
$function$;

REVOKE ALL     ON FUNCTION student_package_coverage() FROM public;
REVOKE EXECUTE ON FUNCTION student_package_coverage() FROM anon;
GRANT  EXECUTE ON FUNCTION student_package_coverage() TO authenticated, service_role;

-- ── package_renewal_candidates() — one row per LOW family ────────────────────
-- SECURITY INVOKER: RLS scopes it to the caller's own tenant. Phase 1 suggests
-- only the family's original product (if still active); Phase 2's Migration B
-- teaches it the per-category defaults.
CREATE OR REPLACE FUNCTION public.package_renewal_candidates()
 RETURNS TABLE(parent_id uuid, tenant_id uuid, parent_name text, parent_phone text,
               children text, package_name text, lessons_left integer, expires_on date,
               expired_days_ago integer,
               original_product_id uuid, suggested_product_id uuid, has_open_offer boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS d),
-- MATERIALIZED: student_package_coverage() runs package_live_balances()'s loop;
-- cov is read four times below, so evaluate it once.
cov AS MATERIALIZED (
  SELECT * FROM student_package_coverage()
),
low_fams AS (
  SELECT DISTINCT c.parent_id, c.tenant_id FROM cov c WHERE c.low
),
-- ⚠ RISK 2 — families whose latest active package EXPIRED within the last 30
-- days drop out of `live` (coverage cannot see them), yet are the ones most in
-- need of a renewal. Same open-row exclusion as `low`.
expired_fams AS (
  SELECT pp.parent_id, pp.tenant_id,
         (SELECT d FROM today) - max(pp.expires_on) AS expired_days_ago
  FROM parent_packages pp
  WHERE pp.status = 'active'
    AND pp.expires_on <  (SELECT d FROM today)
    AND pp.expires_on >= (SELECT d FROM today) - 30
    AND NOT EXISTS (
      -- Any open row disqualifies: a pending request/offer, OR any active
      -- package not yet expired — including a FUTURE-START one the admin
      -- pre-sold (its expires_on is >= today too).
      SELECT 1 FROM parent_packages o
      WHERE o.parent_id = pp.parent_id AND o.tenant_id = pp.tenant_id
        AND (o.status = 'pending'
             OR (o.status = 'active' AND o.expires_on >= (SELECT d FROM today)))
    )
  GROUP BY pp.parent_id, pp.tenant_id
),
fams AS (
  SELECT parent_id, tenant_id, NULL::integer AS expired_days_ago FROM low_fams
  UNION
  SELECT parent_id, tenant_id, expired_days_ago FROM expired_fams
        WHERE (parent_id, tenant_id) NOT IN (SELECT parent_id, tenant_id FROM low_fams)
),
-- Most recent non-cancelled package the family bought — its product.
original AS (
  SELECT DISTINCT ON (pp.parent_id, pp.tenant_id)
         pp.parent_id, pp.tenant_id, pp.product_id
  FROM parent_packages pp
  WHERE pp.status <> 'cancelled'
  ORDER BY pp.parent_id, pp.tenant_id, pp.requested_at DESC
)
SELECT
  f.parent_id,
  f.tenant_id,
  pr.full_name AS parent_name,
  pr.phone     AS parent_phone,
  (SELECT string_agg(s.full_name, ', ' ORDER BY s.full_name)
     FROM parent_students ps JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = f.parent_id AND s.is_active) AS children,
  (SELECT c.package_name FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL
    ORDER BY c.expires_on NULLS LAST LIMIT 1) AS package_name,
  (SELECT max(c.lessons_remaining) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id) AS lessons_left,
  (SELECT min(c.expires_on) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL) AS expires_on,
  f.expired_days_ago,
  o.product_id AS original_product_id,
  CASE WHEN op.is_active THEN o.product_id ELSE NULL END AS suggested_product_id,
  EXISTS (SELECT 1 FROM parent_packages x
           WHERE x.parent_id = f.parent_id AND x.tenant_id = f.tenant_id
             AND x.status = 'pending' AND x.offered_by IS NOT NULL
             AND x.paid_claimed_at IS NULL AND x.superseded_by IS NULL) AS has_open_offer
FROM fams f
JOIN parents pa   ON pa.id = f.parent_id
JOIN profiles pr  ON pr.id = pa.profile_id
LEFT JOIN original o  ON o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id
LEFT JOIN package_products op ON op.id = o.product_id
$function$;

REVOKE EXECUTE ON FUNCTION package_renewal_candidates() FROM public;
GRANT  EXECUTE ON FUNCTION package_renewal_candidates() TO authenticated, service_role;

COMMENT ON FUNCTION package_renewal_candidates() IS
  'One row per LOW family (lessons OR expiry, minus families with an open row) '
  'plus families whose latest package expired within 30 days. SECURITY INVOKER '
  '— RLS scopes it to the caller''s tenant. RISK 2.';
