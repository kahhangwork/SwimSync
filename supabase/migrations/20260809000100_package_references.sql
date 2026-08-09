-- ============================================================
-- Package payment references — PKG-YYYY-NNNN (docs/plans/WAVE_1_PLAN.md,
-- Chunk 2 Step 2.1; BACKLOG Wave 1 #1).
--
-- An invoice has carried a reference and a dynamic PayNow QR since
-- 20260802000600. A PACKAGE purchase carried neither, so a parent buying a
-- package still scanned a static image and typed the amount by hand — the
-- exact unattributable payment the reference was introduced to remove. This
-- gives parent_packages the same two things an invoice has: a per-tenant
-- reference minted by a BEFORE INSERT trigger, and a pin so no client can
-- rewrite it afterwards.
--
-- Shape is deliberately verbatim from 20260802000600 (+ the LPAD fix from
-- 20260802000800). Three differences, each load-bearing:
--
--   1. TRIGGER NAME ORDER IS THE DESIGN, NOT COSMETICS.
--      Postgres fires same-timing row triggers in ALPHABETICAL ORDER BY
--      TRIGGER NAME. parent_packages already carries
--      trg_parent_package_lifecycle (20260720000100:374, BEFORE INSERT OR
--      UPDATE) and THAT trigger is what sets NEW.tenant_id — line 268,
--      `NEW.tenant_id := v_product.tenant_id`, because "the product decides
--      the business and the terms; the client cannot". A parent's request
--      inserts { parent_id, product_id } and no tenant_id at all
--      (SwimSyncApp/app/(parent)/billing/index.tsx). So a reference trigger
--      sorting BEFORE the lifecycle trigger sees tenant_id = NULL and
--      next_package_ref raises — EVERY parent package request would fail at
--      the insert. This trigger is therefore named
--      trg_parent_package_reference (…_l < …_r). Do NOT rename it to
--      trg_assign_*, trg_a*, or anything sorting before …_lifecycle.
--      Ordering is invisible in a schema dump, so the function ALSO raises
--      with a message naming the ordering if tenant_id arrives NULL. That
--      RAISE is the tripwire for a future rename; it is not dead code.
--
--   2. THE YEAR COMES FROM THE ROW, NOT THE CLOCK.
--      to_char(NEW.requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY').
--      NOT today_sg() and NOT CURRENT_DATE/NOW() — the latter two are the
--      SESSION's time zone, UTC here (§7.94), and even today_sg() would put a
--      backfilled or late-inserted row in the wrong year. Column defaults are
--      applied before BEFORE triggers fire, so NEW.requested_at is always
--      populated. Same doctrine as invoices, which take the year from their
--      own billing_month (§7.7).
--
--   3. GRANTS ARE WRITTEN OUT, BOTH KINDS.
--      §7.82: next_credit_note_ref — the identical SECURITY DEFINER
--      "increment a tenant counter" shape — shipped with NO ACL at all, and
--      an unauthenticated POST returned CN-2026-0001 and burned the counter.
--      §7.39/§7.89: cloud default privileges grant EXECUTE on new public
--      functions to anon/authenticated/service_role and the local stack does
--      NOT reproduce that, so a local pg_proc check is vacuous by
--      construction. REVOKE FROM PUBLIC alone does not remove role grants;
--      both statements are required. next_package_ref is callable by NOBODY,
--      including service_role — its only caller is the SECURITY DEFINER
--      trigger below, which reaches it as the function owner. §7.78: if a
--      permission error ever appears on next_package_ref, the bug is that the
--      DEFINER hop was flattened. Do NOT "fix" it with a GRANT.
--
-- LPAD: GREATEST(4, length(...)) — plain LPAD(v, 4, '0') TRUNCATES past the
-- pad width, silently reusing …-1000 for the 10,000th row and then violating
-- the UNIQUE constraint (§7.77, 20260802000800). Carried here so this counter
-- is not the third to inherit the bug.
--
-- Rollback: supabase/rollback/20260809_package_references_DOWN.sql (committed
-- before deploy, and executed rather than merely written — §7.93).
-- ============================================================

-- ------------------------------------------------------------
-- 1. The per-tenant counter, and the column it numbers.
-- ------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN package_counter INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tenants.package_counter IS
  'Per-tenant package-request numbering, drawn by next_package_ref() with a '
  'row lock. Per-tenant for the same reason as invoice_counter and '
  'credit_note_counter: each business expects its own numbering, and a shared '
  'sequence leaks platform volume through the gaps.';

ALTER TABLE parent_packages
  ADD COLUMN reference_number TEXT;

COMMENT ON COLUMN parent_packages.reference_number IS
  'PKG-YYYY-NNNN, numbered within the tenant. YYYY is the year of this row''s '
  'OWN requested_at in SGT, never the clock (§7.7, §7.94). Embedded in the '
  'PayNow QR (Tag 62 bill number, so it must stay <= 25 chars) — it is how a '
  'bank transfer is matched back to this package request. Pinned: not '
  'client-writable, and parent_packages_update lets the owning PARENT update '
  'their own row, so the pin is doing real work here.';

-- ------------------------------------------------------------
-- 2. Reference numbering. Clone of next_invoice_ref (20260802000600 +
--    20260802000800) with the year passed in by the caller.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_package_ref(p_tenant_id UUID, p_year TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE tenants
     SET package_counter = package_counter + 1
   WHERE id = p_tenant_id
  RETURNING package_counter INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'cannot number a package for unknown tenant %', p_tenant_id;
  END IF;

  RETURN 'PKG-' || p_year || '-' ||
         LPAD(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_package_ref(UUID, TEXT) FROM PUBLIC;
-- §7.39: cloud default privileges grant EXECUTE on new public functions to
-- anon/authenticated/service_role — strip all three. No external caller exists.
REVOKE EXECUTE ON FUNCTION public.next_package_ref(UUID, TEXT)
  FROM anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Assignment trigger. SECURITY DEFINER is LOAD-BEARING: an admin sale and
--    a parent request both arrive as 'authenticated', which (correctly) has
--    no EXECUTE on next_package_ref; only the DEFINER hop lets the draw
--    happen.
--
--    IT MINTS UNCONDITIONALLY — it does NOT assign-only-when-NULL, and that
--    is a deliberate divergence from the invoice version. The invoice one
--    could skip a row that already carried a reference because nothing but
--    the engine (service_role) inserts invoices. Here parent_packages_insert
--    (20260720000100:222) lets the owning PARENT insert. A parent who could
--    supply their own reference_number would not merely mislabel their own
--    row: the tenant's counter stays where it was, so the NEXT genuine
--    request draws the number they squatted and dies on
--    parent_packages_tenant_reference_key. One hand-written insert would
--    break the buy-a-package path for that whole business.
--
--    THE OBVIOUS GUARD DOES NOT WORK HERE, AND FAILS OPEN. Refusing a
--    client-supplied value with `current_user = 'authenticated'` — the seam
--    used by pin_invoice_public_fields and by the lifecycle trigger next door
--    — is DEAD CODE inside this function, because SECURITY DEFINER makes
--    current_user the function's owner. Every such check reads 'postgres' and
--    waves the client through. (Caught by pgTAP, which expected the raise and
--    got a successful insert; 20260720000100:365 warns about exactly this in
--    the other direction.) Overwriting needs no role test at all, so it is
--    both simpler and the only version that actually fires.
--
--    §7.57 (a BEFORE INSERT trigger also fires for rows an .upsert() resolves
--    to an UPDATE) is checked, not assumed: `grep -rn "\.upsert("
--    SwimSyncApp SwimSyncAdmin supabase | grep parent_packages` → zero rows,
--    2026-08-09. If an upsert is ever added here, an UPDATE-resolving row
--    would draw a FRESH reference and burn a counter slot — so add the
--    TG_OP/OLD guard at that point rather than discovering it in a bank
--    statement.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_parent_package_reference()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_parent_package_reference() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_parent_package_reference()
  FROM anon, authenticated, service_role;

-- Name sorts AFTER trg_parent_package_lifecycle. This is the mitigation, not
-- a convention — see the header.
CREATE TRIGGER trg_parent_package_reference
  BEFORE INSERT ON parent_packages
  FOR EACH ROW
  EXECUTE FUNCTION assign_parent_package_reference();

-- ------------------------------------------------------------
-- 4. Backfill, then lock. ORDER MATTERS: backfill → reset the counter from
--    the backfill → SET NOT NULL → UNIQUE. Skip the backfill and either the
--    NOT NULL aborts `supabase db push` against production, or live pending
--    package requests carry a NULL reference — and a NULL reference is a
--    package the parent cannot be given a dynamic QR for.
--    Ordered by requested_at so numbering follows request order; year from
--    each row's own requested_at in SGT, matching the trigger exactly.
-- ------------------------------------------------------------

WITH numbered AS (
  SELECT id,
         'PKG-' || to_char(requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY') || '-' ||
           LPAD((ROW_NUMBER() OVER (
             PARTITION BY tenant_id ORDER BY requested_at, id))::TEXT, 4, '0')
           AS ref
  FROM parent_packages
)
UPDATE parent_packages p
   SET reference_number = n.ref
  FROM numbered n
 WHERE p.id = n.id
   AND p.reference_number IS NULL;

UPDATE tenants t
   SET package_counter = COALESCE(
     (SELECT COUNT(*) FROM parent_packages p WHERE p.tenant_id = t.id), 0
   );

ALTER TABLE parent_packages
  ALTER COLUMN reference_number SET NOT NULL,
  ADD CONSTRAINT parent_packages_tenant_reference_key
    UNIQUE (tenant_id, reference_number);

-- ------------------------------------------------------------
-- 5. Pin the reference. Plain, NOT SECURITY DEFINER — DEFINER would make
--    current_user 'postgres' and defeat the check entirely (same reason as
--    pin_invoice_public_fields, 20260802000600, and pin_parent_identity,
--    20260719002000).
--
--    This pin is doing more work than the invoice one: parent_packages_update
--    (20260720000100:230) lets the OWNING PARENT update their own row, so
--    without this a parent could rewrite the reference their own payment will
--    be matched by.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pin_parent_package_reference()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_number IS DISTINCT FROM OLD.reference_number
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'parent_packages.reference_number is not client-writable — it identifies this package payment to the bank.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pin_parent_package_reference
  BEFORE UPDATE ON parent_packages
  FOR EACH ROW
  EXECUTE FUNCTION pin_parent_package_reference();
