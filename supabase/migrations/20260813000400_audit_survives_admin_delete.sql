-- ============================================================================
-- Deleting an admin no longer destroys the audit history.
--
-- BACKLOG: "Deleting an admin destroys the audit history" (S, found 2026-08-09,
-- Wave 1 Chunk 3). Plan: docs/plans/SMALL_ITEMS_PLAN.md, Phase A.
--
-- WHAT WAS WRONG. prepare_admin_delete() purged the target's audit_log rows
-- before the hard delete, because audit_log.actor_id is a NOT NULL FK with no
-- cascade (20260309000100:233) and any surviving row blocks the
-- auth.users → profiles cascade. Since 20260809000200 (§8.38) EVERY edit to a
-- student is recorded — including provisional_contact_phone and _email, the two
-- top-ranked signals in find_student_candidates(), which decide which parent is
-- offered which child. The dispute that trail exists for is "who changed the
-- number, and when", and the person most likely to be at the centre of it is an
-- admin who has since left. The purge deleted exactly that evidence.
--
-- THE FIX, and the one that was NOT chosen. audit_log.actor_id was the single
-- deliberate exclusion in profile_reference_columns(); every other FK column
-- pointing at profiles already REFUSES the delete by name. Removing the
-- exclusion therefore does not add a mechanism — it stops exempting one table
-- from the mechanism that already exists. The alternative shapes weighed in
-- BACKLOG.md were a deleted_profiles tombstone the FK could point at, and
-- ON DELETE SET NULL plus a denormalised actor label. Both were refused on cost
-- 2026-08-13; the tombstone remains the upgrade path if hard delete is ever
-- needed back.
--
-- ⚠ actor_id STAYS NOT NULL. §7.50 is why, and 20260809000200's header carries
-- the same prohibition for the same column. Do NOT "solve" a future version of
-- this by making it nullable.
--
-- ⚠ THE ACCEPTED CONSEQUENCE, stated so nobody rediscovers it as a bug: an
-- admin who has written a single audit row can no longer be HARD-deleted at
-- all. Deactivation is the route (it revokes access immediately and is
-- reversible), and their profile + auth user — and therefore their email
-- address — are occupied permanently. That is the trade the user chose:
-- the record outlives the person.
--
-- ⚠ CREATE OR REPLACE, NEVER DROP, for both functions. The signatures are
-- unchanged and a DROP would shed the post-20260804000200 grant state
-- (20260806000100 §10 states the rule). Both bodies below were taken from a
-- `supabase db dump --linked` of the LIVE remote (§7.40, §7.115), not from the
-- migration that first created them — verified byte-identical to
-- 20260806000100 on 2026-08-13, i.e. nothing later had drifted them.
--
-- ⚠ THIS MIGRATION CHANGES NO GRANTS, deliberately. The live ACLs are
-- prepare_admin_delete → {postgres, authenticated} and
-- profile_reference_columns → {postgres, service_role}. The latter holds NO
-- grant to authenticated and does not need one: prepare_admin_delete is
-- SECURITY DEFINER and calls it as the owner. CREATE OR REPLACE preserves both.
-- Re-granting here would be the blanket re-grant §7.87 forbids.
-- ============================================================================


-- ── 1. audit_log.actor_id stops being exempt from the reference check ────────
-- The exclusion list is now exactly the two ON DELETE CASCADE columns. The
-- no-coaches-row gate inside prepare_admin_delete already excludes coach-admins
-- before the loop runs, and parents.profile_id cascades on its own.
--
-- ORDER BY IS NEW, AND IT IS LOAD-BEARING FOR THE MESSAGE. The loop raises on
-- the FIRST column that hits, and catalogue order is unspecified — so an admin
-- with both a student they created AND audit rows could get either sentence,
-- varying between databases. audit_log now sorts LAST, so the more specific
-- refusal ("recorded activity (students.created_by)") always wins and the
-- generic history refusal is what remains when it is the only thing left.

CREATE OR REPLACE FUNCTION public.profile_reference_columns()
RETURNS TABLE (ref_table regclass, ref_column name)
LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT c.conrelid::regclass, a.attname
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS ck(attnum) ON TRUE
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
  WHERE c.contype = 'f'
    AND c.confrelid = 'public.profiles'::regclass
    AND NOT (c.conrelid = 'public.parents'::regclass  AND a.attname = 'profile_id')
    AND NOT (c.conrelid = 'public.coaches'::regclass  AND a.attname = 'profile_id')
  ORDER BY (c.conrelid = 'public.audit_log'::regclass),
           c.conrelid::regclass::text,
           a.attname;
$$;

COMMENT ON FUNCTION public.profile_reference_columns() IS
  'Every FK column that references profiles(id), minus the two that ON DELETE '
  'CASCADE (parents/coaches.profile_id — and the no-coaches-row gate already '
  'excludes coach-admins). audit_log.actor_id was a third exclusion until '
  '20260813000400: it is now reported like any other reference, so a departing '
  'admin''s trail survives instead of being purged. Catalogue-derived so it can '
  'never go stale; audit_log sorts LAST so the more specific refusal wins. '
  'admin_management.test.sql pins that it sees students.created_by, '
  'payment_records.marked_by and audit_log.actor_id.';


-- ── 2. prepare_admin_delete: refuse, do not purge ────────────────────────────
-- The only changes to the body:
--   • the DELETE FROM audit_log is GONE — it is now unreachable anyway, because
--     the loop above refuses before execution can reach it;
--   • the audit_log arm of the loop gets its own sentence (see below).
-- Everything else is verbatim from the live definition.

CREATE OR REPLACE FUNCTION public.prepare_admin_delete(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
  r        RECORD;
  v_hit    BOOLEAN;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot be deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM coaches WHERE profile_id = p_profile_id) THEN
    RAISE EXCEPTION
      'this admin is also a coach — remove their admin role instead of deleting';
  END IF;

  -- Catalogue-derived reference check (§7.46). Any surviving reference makes
  -- the eventual auth.users → profiles cascade fail anyway; refusing here, by
  -- name, is the honest version of that failure.
  FOR r IN SELECT ref_table, ref_column FROM profile_reference_columns() LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
                   r.ref_table, r.ref_column)
      INTO v_hit USING p_profile_id;
    IF v_hit THEN
      -- audit_log gets a sentence rather than a table name. After
      -- 20260813000400 this is the COMMON outcome, not the rare one — every
      -- edit to a student writes a row — and delete-admin/route.ts hands the
      -- message straight to the business owner in the modal. "this admin has
      -- recorded activity (audit_log.actor_id)" is not something to show them.
      IF r.ref_table = 'public.audit_log'::regclass THEN
        RAISE EXCEPTION
          'this admin has history recorded against their account and cannot be '
          'deleted — deactivate them instead. That revokes their access '
          'immediately, and keeps the record of what they did.';
      END IF;
      RAISE EXCEPTION
        'this admin has recorded activity (%.%) — deactivate them instead of deleting',
        r.ref_table, r.ref_column;
    END IF;
  END LOOP;

  -- The deletion audit row, while the subject profile still exists
  -- (audit_log_tenant_of derives the tenant from it), attributed to the OWNER,
  -- who survives. entity_id is a plain UUID and NOT an FK (20260309000100:236),
  -- so this row does not block the cascade it is recording.
  --
  -- THE PURGE THAT USED TO FOLLOW IS GONE. It read
  --   DELETE FROM audit_log WHERE actor_id = p_profile_id;
  -- and it is why this migration exists. Execution can no longer reach here
  -- with any such row in existence — the loop above refuses first — so the
  -- statement was not merely undesirable, it was dead.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_deleted', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant, 'email', v_target.email,
                             'full_name', v_target.full_name));

  -- The profile row itself is NOT deleted here: the API route calls
  -- auth.admin.deleteUser, and auth.users → profiles cascades. Route order is
  -- ban → this RPC → deleteUser. The ban no longer closes a purge-to-cascade
  -- window (there is no purge), but it still closes the window in which the
  -- target could write a FRESH audit row between this check and the cascade —
  -- which would now fail the cascade on the actor_id FK.
END;
$$;

COMMENT ON FUNCTION public.prepare_admin_delete(UUID) IS
  'Owner-only, PURE admins only: everything a hard delete needs from the '
  'database — refuse if any FK still references the profile (catalogue-derived '
  'list, which since 20260813000400 INCLUDES audit_log.actor_id), then write '
  'the deletion audit row (actor = owner). It no longer purges the target''s '
  'audit rows: an admin with any history is refused and must be deactivated '
  'instead. The API route then deletes the auth user, which cascades the '
  'profile. Never call for an admin with a coaches row.';
