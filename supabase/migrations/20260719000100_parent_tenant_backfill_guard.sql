-- ============================================================
-- Multi-tenancy phase 3: guarantee every existing parent is linked to a tenant.
--
-- WHY THIS EXISTS SEPARATELY FROM PHASE 1's BACKFILL.
--
-- Phase 1 linked every parent that existed WHEN IT RAN. Phase 3 then gates
-- "Add child" on having joined a tenant — so any parent who registered AFTER
-- that migration but BEFORE the join-code UI ships has no link and silently
-- loses the ability to add a child. That window is real: production is live and
-- parents are onboarding through swimsync.sg right now.
--
-- This runs immediately before the join-code feature and closes the window:
-- backfill anyone still unlinked, then ASSERT that nobody is. The assertion is
-- the point — a silent miss here does not surface until a parent taps a button
-- that does nothing, which is exactly the kind of failure nobody reports.
--
-- The invariant is ONE-TIME, not permanent: from here on, a brand-new parent
-- legitimately has no link until they enter a code. There is deliberately no
-- constraint enforcing it.
-- ============================================================

DO $$
DECLARE
  v_tenants   INT;
  v_unlinked  INT;
  v_backfilled INT := 0;
  v_tenant_id UUID;
BEGIN
  SELECT COUNT(*) INTO v_tenants FROM tenants;

  SELECT COUNT(*) INTO v_unlinked
    FROM parents p
   WHERE NOT EXISTS (SELECT 1 FROM parent_tenants pt WHERE pt.parent_id = p.id);

  IF v_unlinked = 0 THEN
    RAISE NOTICE 'parent_tenants: all parents already linked, nothing to backfill.';
    RETURN;
  END IF;

  -- Prefer the tenant the parent's own children are in — correct even with
  -- several businesses on the platform, because a child's tenant is explicit.
  INSERT INTO parent_tenants (parent_id, tenant_id)
  SELECT DISTINCT ps.parent_id, s.tenant_id
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
   WHERE s.tenant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM parent_tenants pt
        WHERE pt.parent_id = ps.parent_id AND pt.tenant_id = s.tenant_id
     )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  -- A parent who registered but has not added a child yet has nothing to infer
  -- from. With exactly one business on the platform there is only one answer —
  -- they signed up for that coach. This is the case the user asked for: link
  -- them to the current private coach's tenant.
  SELECT COUNT(*) INTO v_unlinked
    FROM parents p
   WHERE NOT EXISTS (SELECT 1 FROM parent_tenants pt WHERE pt.parent_id = p.id);

  IF v_unlinked > 0 THEN
    IF v_tenants = 1 THEN
      SELECT id INTO v_tenant_id FROM tenants;
      INSERT INTO parent_tenants (parent_id, tenant_id)
      SELECT p.id, v_tenant_id
        FROM parents p
       WHERE NOT EXISTS (SELECT 1 FROM parent_tenants pt WHERE pt.parent_id = p.id)
      ON CONFLICT DO NOTHING;
      RAISE NOTICE 'parent_tenants: linked % childless parent(s) to the only tenant.', v_unlinked;
    ELSE
      -- Do NOT guess across several businesses: a wrong link puts a family in a
      -- stranger's add-child picker. Stop and let a human decide.
      RAISE EXCEPTION
        '% parent(s) have no children and no tenant link, across % tenants — cannot infer which business they belong to. Link them manually (INSERT INTO parent_tenants), then re-run.',
        v_unlinked, v_tenants;
    END IF;
  END IF;

  -- ---- The assertion this migration exists for ----------------------------
  SELECT COUNT(*) INTO v_unlinked
    FROM parents p
   WHERE NOT EXISTS (SELECT 1 FROM parent_tenants pt WHERE pt.parent_id = p.id);

  IF v_unlinked > 0 THEN
    RAISE EXCEPTION
      'BACKFILL FAILED: % parent(s) still have no tenant link. Shipping join codes now would leave them unable to add a child.',
      v_unlinked;
  END IF;

  RAISE NOTICE 'parent_tenants: backfill complete, % link(s) added, 0 parents unlinked.', v_backfilled;
END $$;
