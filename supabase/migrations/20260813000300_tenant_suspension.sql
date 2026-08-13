-- ═══════════════════════════════════════════════════════════════════════════
-- TENANT SUSPENSION — the platform-level kill switch (Wave 5 chunk 3,
-- docs/plans/WAVE_5_PLAN.md)
--
-- Suspension blocks STAFF AND PARENTS (decision 5): the tenant's data
-- disappears from its parents' app, per-tenant, never account-level — a parent
-- in two businesses keeps the other, and parents are never auth-banned. The
-- engine skips a suspended tenant (decision 6). Already-sent public-invoice
-- links keep working FOREVER (decision 8 — a PROHIBITION: no suspended_at
-- check in public-invoice; the user chose payability over consistency).
--
-- One new predicate, tenant_suspended(), and every enforcement point calls it:
--   STAFF  — two helper cuts: is_tenant_admin() (every admin policy) and
--            current_coach_id() (every coach policy, second clause after chunk
--            2's disabled_at — body from pg_get_functiondef(), ⚠ RISK 2).
--   PARENT — there is NO single choke point (⚠ RISK 1; the first draft
--            claimed 4 paths, the live enumeration found 21 policy arms).
--            Two helper cuts (parent_owns_student, parent_has_child_in_class)
--            plus one edit per remaining direct arm, enumerated below from
--            pg_policies on 2026-08-13 — the grep is the fact, not any list.
--   RPCs   — claim_invoice_paid() gate; join_tenant_by_code() refusal with
--            the file's own anti-probing wording (⚠ RISK 6).
--
-- Found by the live enumeration, beyond the plan's list:
--   * package_applications_select, parent_packages_insert,
--     parent_students_select — three more parent arms; edited below.
--   * students_select / students_update carry a `created_by = auth.uid()` arm:
--     a suspended tenant's parent who self-added their child would keep
--     reading AND EDITING that child through it. Cut per-tenant below.
--   * parent_tenants_insert no longer exists (20260804000500 dropped it and
--     revoked INSERT) — the plan's ⚠ RISK 2 (review) direct-insert path is
--     already closed; join_tenant_by_code() is the only re-entry and is gated
--     below. pgTAP pins the absence.
--
-- What deliberately does NOT change:
--   * current_tenant_id() — the membership-scoped residue (~10 arms) stays lit
--     for the token lifetime, ACCEPTED (⚠ RISK 5; the auth-layer ban applied
--     by /api/suspend-tenant is the enforcement). pgTAP pins it as EXPECTED.
--   * public-invoice — decision 8's prohibition, above.
--   * can_admin_tenant() keeps its is_platform_admin() arm untouched — the
--     platform admin retains full access to a suspended tenant (unsuspending,
--     oversight).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The column, and the guard extension ───────────────────────────────────

ALTER TABLE public.tenants ADD COLUMN suspended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tenants.suspended_at IS
  'Set/cleared ONLY by suspend_tenant()/unsuspend_tenant() — '
  'tenants_guard_owner refuses client writes. While set, tenant_suspended() '
  'is TRUE and every staff and parent enforcement point goes dark; '
  'current_tenant_id()-scoped staff reads survive for the token lifetime, '
  'ACCEPTED (WAVE_5_PLAN.md ⚠ RISK 5) — the auth-layer ban is the '
  'enforcement. Already-sent public-invoice links keep working (decision 8).';

-- Same trigger, one more pinned column (keep the name — §7.38 mechanism:
-- current_user is 'authenticated' for a client write, 'postgres' inside a
-- SECURITY DEFINER RPC).
CREATE OR REPLACE FUNCTION public.guard_tenants_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND (
       OLD.owner_profile_id IS DISTINCT FROM NEW.owner_profile_id
    OR OLD.suspended_at     IS DISTINCT FROM NEW.suspended_at
  ) THEN
    RAISE EXCEPTION
      'tenants.owner_profile_id / suspended_at cannot be changed by a client '
      '— use platform_reassign_owner / suspend_tenant / unsuspend_tenant '
      '(20260813000300)';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. The predicate everything else calls ───────────────────────────────────
-- ⚠ RISK 10: COALESCE is load-bearing. profiles.tenant_id is NULL for parents
-- and the platform admin; a NULL argument must read FALSE, never NULL — a NULL
-- result in a policy USING clause fails closed and would black out a legacy
-- row silently.

CREATE OR REPLACE FUNCTION public.tenant_suspended(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT t.suspended_at IS NOT NULL FROM tenants t WHERE t.id = p_tenant_id),
    FALSE
  );
$$;

COMMENT ON FUNCTION public.tenant_suspended(UUID) IS
  'Is this business suspended? THE single suspension predicate — every '
  'enforcement point (helper cuts, policy arms, RPC gates) calls this, never '
  'the column. NULL/unknown tenant reads FALSE by COALESCE, deliberately '
  '(WAVE_5_PLAN.md chunk 3 ⚠ RISK 10).';

REVOKE ALL ON FUNCTION public.tenant_suspended(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_suspended(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_suspended(UUID) TO authenticated;

-- ── 3. Staff-side: the two helper cuts ───────────────────────────────────────
-- is_tenant_admin: every admin policy flows through this one clause (the
-- 20260806000100 mechanism). can_admin_tenant = this OR is_platform_admin(),
-- so the platform admin keeps full access. Body from pg_get_functiondef(),
-- 2026-08-13.

CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
     AND NOT tenant_suspended(p_tenant_id)
     AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'tenant_admin'
      AND tenant_id = p_tenant_id
      AND admin_disabled_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_tenant_admin(UUID) IS
  'Is the caller an ACTIVE admin of this ACTIVE tenant? Deliberately not true '
  'for the platform admin (sites spell that out via can_admin_tenant), false '
  'while admin_disabled_at is set — deactivation suspends every admin policy '
  'through this one clause (20260806000100) — and false while the tenant is '
  'suspended (20260813000300): suspension cuts every admin policy the same '
  'way.';

-- current_coach_id: chunk 2's disabled_at clause AND the new suspension
-- clause. ⚠ RISK 2 of the wave — this function is edited in BOTH chunks; body
-- taken from pg_get_functiondef() against the live DB (§7.115), 2026-08-13,
-- and pgTAP re-runs chunk 2's "disabled coach is NULL" case in the suspension
-- suite to prove both clauses survived.

CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM coaches
   WHERE profile_id = auth.uid()
     AND disabled_at IS NULL
     AND NOT tenant_suspended(tenant_id);
$$;

-- ── 4. Parent-side: the two helper cuts ──────────────────────────────────────
-- Both resolve current_parent_id() internally and are parent-only by
-- construction (the first draft's reason not to touch them was false —
-- /plan-review). parent_owns_student covers: attendance_select,
-- enrolments_select, trial_bookings_select, makeup_bookings_select,
-- students_select, students_update (parent arms). Suspension is judged by the
-- STUDENT's tenant — a two-tenant parent keeps every read on their other
-- business.

CREATE OR REPLACE FUNCTION public.parent_owns_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    WHERE ps.student_id = p_student_id
      AND ps.parent_id = current_parent_id()
      AND NOT tenant_suspended(s.tenant_id)
  );
$$;

COMMENT ON FUNCTION public.parent_owns_student(UUID) IS
  'Does the calling parent own this student — and is the student''s business '
  'not suspended (20260813000300)? The parent-side choke point for '
  'attendance, enrolments, bookings and the students parent arms.';

-- parent_has_child_in_class covers classes_select and sessions_select. The
-- gate is the CLASS's tenant, checked once up front; a missing class reads
-- FALSE from the EXISTS arms exactly as before (tenant_suspended(NULL) is
-- FALSE, so the new clause never widens anything). Body from
-- pg_get_functiondef() (§7.115 — the live body is 20260802000300's, with
-- 20260726001400's trial arm and the make-up arm; the plan's citation history
-- is exactly why the live DB is the source).

CREATE OR REPLACE FUNCTION public.parent_has_child_in_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT tenant_suspended(
           (SELECT c.tenant_id FROM classes c WHERE c.id = p_class_id))
     AND (
    EXISTS (
      SELECT 1
      FROM student_class_enrolments e
      JOIN parent_students ps ON ps.student_id = e.student_id
      WHERE e.class_id = p_class_id
        AND ps.parent_id = current_parent_id()
    ) OR EXISTS (
      -- Trying one lesson counts as being in the class, for reading.
      SELECT 1
      FROM trial_bookings tb
      JOIN parent_students ps ON ps.student_id = tb.student_id
      WHERE tb.class_id = p_class_id
        AND ps.parent_id = current_parent_id()
    ) OR EXISTS (
      -- A make-up lesson counts the same way.
      SELECT 1
      FROM makeup_bookings mb
      JOIN parent_students ps ON ps.student_id = mb.student_id
      WHERE mb.class_id = p_class_id
        AND ps.parent_id = current_parent_id()
    )
  );
$$;

COMMENT ON FUNCTION public.parent_has_child_in_class(UUID) IS
  'Does this parent have a child in this class — by ENROLMENT, TRIAL BOOKING '
  'or MAKE-UP — and is the class''s business not suspended (20260813000300)? '
  'Feeds classes_select and sessions_select. SECURITY DEFINER so reading '
  'trial_bookings here cannot make the two policies mutually recursive.';

-- parent_in_tenant — the THIRD parent-only choke point, found in review, not
-- in the plan: add_child_or_claim() and find_student_candidates() both gate
-- on it ("you have not joined that business"), so without this cut a
-- suspended tenant's parent could still CREATE a student there through the
-- direct API. book_trial/book_makeup need nothing — they are admin-gated,
-- and the is_tenant_admin() cut already covers them. The refusal reuses the
-- RPCs' own existing wording by construction.

CREATE OR REPLACE FUNCTION public.parent_in_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT tenant_suspended(p_tenant_id) AND EXISTS (
    SELECT 1 FROM parent_tenants
    WHERE tenant_id = p_tenant_id AND parent_id = current_parent_id()
  );
$$;

COMMENT ON FUNCTION public.parent_in_tenant(UUID) IS
  'Is the calling parent a member of this ACTIVE business? FALSE while the '
  'tenant is suspended (20260813000300) — this is the choke point for the '
  'membership-gated parent RPCs (add_child_or_claim, '
  'find_student_candidates) and the parent_packages insert arm.';

-- ── 5. Parent-side: the direct policy arms ───────────────────────────────────
-- One edit per arm; ONLY the parent arm gains the clause. Staff arms are cut
-- by the helpers above; is_platform_admin() arms never are. Each policy below
-- is the live pg_policies text of 2026-08-13 with the single clause added —
-- and each has its own proven-red pgTAP case: a missed arm fails SILENT, so
-- the test list is the enumeration (⚠ RISK 1).

DROP POLICY invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

DROP POLICY invoice_items_select ON public.invoice_items;
CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_items.invoice_id
      AND (
        (i.parent_id = current_parent_id()
           AND NOT tenant_suspended(i.tenant_id))
        OR is_platform_admin()
        OR is_tenant_admin(i.tenant_id)
        OR coach_serves_parent(i.parent_id)
      )
  ));

DROP POLICY credit_notes_select ON public.credit_notes;
CREATE POLICY credit_notes_select ON public.credit_notes
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

DROP POLICY credit_applications_select ON public.credit_applications;
CREATE POLICY credit_applications_select ON public.credit_applications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM credit_notes cn
    WHERE cn.id = credit_applications.credit_note_id
      AND (
        (cn.parent_id = current_parent_id()
           AND NOT tenant_suspended(cn.tenant_id))
        OR is_platform_admin()
        OR is_tenant_admin(cn.tenant_id)
        OR coach_serves_parent(cn.parent_id)
      )
  ));

DROP POLICY payment_records_select ON public.payment_records;
CREATE POLICY payment_records_select ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND (
          (i.parent_id = current_parent_id()
             AND NOT tenant_suspended(i.tenant_id))
          OR is_tenant_admin(i.tenant_id)
          OR coach_serves_parent(i.parent_id)
        )
    )
  );

DROP POLICY parent_packages_select ON public.parent_packages;
CREATE POLICY parent_packages_select ON public.parent_packages
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
  );

DROP POLICY parent_packages_update ON public.parent_packages;
CREATE POLICY parent_packages_update ON public.parent_packages
  FOR UPDATE TO authenticated
  USING (
    can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
  )
  WITH CHECK (
    can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
  );

DROP POLICY parent_packages_insert ON public.parent_packages;
CREATE POLICY parent_packages_insert ON public.parent_packages
  FOR INSERT TO authenticated
  WITH CHECK (
    can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id()
          AND parent_in_tenant(tenant_id)
          AND NOT tenant_suspended(tenant_id))
  );

DROP POLICY package_applications_select ON public.package_applications;
CREATE POLICY package_applications_select ON public.package_applications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM parent_packages pp
    WHERE pp.id = package_applications.parent_package_id
      AND (
        is_platform_admin()
        OR can_admin_tenant(pp.tenant_id)
        OR (pp.parent_id = current_parent_id()
              AND NOT tenant_suspended(pp.tenant_id))
      )
  ));

-- parent_students has no tenant column — the link is judged by the STUDENT's
-- tenant. NOT by an inline subselect on students: that subselect would run
-- under the caller's OWN RLS, which post-suspension hides the very student
-- row it needs, returns NULL, and the arm passes (found by this chunk's
-- suite, test 55). parent_owns_student() is SECURITY DEFINER and already
-- carries the suspension check — for the parent's own link rows the two
-- spellings are equivalent, so it IS the arm.
DROP POLICY parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id() AND parent_owns_student(student_id))
    OR is_platform_admin()
    OR tenant_serves_parent(parent_id)
    OR coach_serves_parent(parent_id)
  );

-- The tenant_id = current_tenant_id() arms below are the ⚠ RISK 5 residue,
-- deliberately NOT cut (accepted, token-lifetime, the ban enforces).
DROP POLICY parent_tenants_select ON public.parent_tenants;
CREATE POLICY parent_tenants_select ON public.parent_tenants
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
    OR (tenant_id = current_tenant_id())
  );

DROP POLICY parent_tenant_balances_select ON public.parent_tenant_balances;
CREATE POLICY parent_tenant_balances_select ON public.parent_tenant_balances
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
    OR (tenant_id = current_tenant_id())
  );

DROP POLICY student_claims_select ON public.student_claims;
CREATE POLICY student_claims_select ON public.student_claims
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id() AND NOT tenant_suspended(tenant_id))
    OR is_tenant_admin(tenant_id)
  );

-- students: the parent arm (parent_owns_student) is already cut by the helper.
-- These two are recreated for the CREATED_BY arm — found by the live
-- enumeration, not the plan: a suspended tenant's parent who self-added their
-- child would otherwise keep reading and EDITING that child through it.
DROP POLICY students_select ON public.students;
CREATE POLICY students_select ON public.students
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (created_by = auth.uid() AND NOT tenant_suspended(tenant_id))
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
    OR coach_serves_student(id)
    OR coach_rostered_with_student(id)
  );

DROP POLICY students_update ON public.students;
CREATE POLICY students_update ON public.students
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR (created_by = auth.uid() AND NOT tenant_suspended(tenant_id))
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    is_platform_admin()
    OR (created_by = auth.uid() AND NOT tenant_suspended(tenant_id))
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
  );

-- ── 6. The two RPC gates ─────────────────────────────────────────────────────
-- claim_invoice_paid: without this a suspended tenant's parent could still
-- write paid_claimed_at through PostgREST. The gate sits before every write
-- and every disclosure. Body from pg_get_functiondef(), 2026-08-13.

CREATE OR REPLACE FUNCTION public.claim_invoice_paid(p_invoice_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_row  invoices%ROWTYPE;
  v_when TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The caller must BE the invoice's parent — not an admin, not a coach.
  -- A claim is the family speaking for itself.
  SELECT i.* INTO v_row
    FROM invoices i
    JOIN parents p ON p.id = i.parent_id
   WHERE i.id = p_invoice_id
     AND p.profile_id = v_uid
     FOR UPDATE OF i;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  -- Suspension gate (20260813000300). The already-sent public-invoice LINK
  -- stays payable forever (decision 8) — this closes only the app-side write.
  IF tenant_suspended(v_row.tenant_id) THEN
    RAISE EXCEPTION 'this business is currently suspended';
  END IF;

  -- Idempotent: claiming twice keeps the FIRST timestamp — when the parent
  -- first said "paid" is the fact the admin checks the bank against.
  IF v_row.paid_claimed_at IS NOT NULL THEN
    RETURN v_row.paid_claimed_at;
  END IF;

  IF v_row.status <> 'outstanding' THEN
    RAISE EXCEPTION 'invoice is not outstanding';
  END IF;

  UPDATE invoices
     SET paid_claimed_at = NOW()
   WHERE id = p_invoice_id
  RETURNING paid_claimed_at INTO v_when;

  RETURN v_when;
END;
$$;

-- join_tenant_by_code: ⚠ RISK 6 — the ON CONFLICT … DO UPDATE SET is_active
-- arm REACTIVATES an inactivated membership, which is exactly how a
-- formerly-active family of a suspended tenant would re-enter. The refusal
-- fires immediately after the code resolves, BEFORE the insert/update. Body
-- from pg_get_functiondef(), 2026-08-13.

CREATE OR REPLACE FUNCTION public.join_tenant_by_code(p_code TEXT)
RETURNS TABLE(tenant_id UUID, display_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ── 7. suspend_tenant / unsuspend_tenant ─────────────────────────────────────
-- Platform-admin only, idempotent, audit rows on the 'Tenant' arm (chunk 1).
-- The auth-layer ban/unban of the tenant's pure staff is the API route's job,
-- never these functions' — and the unban set is (staff of tenant) MINUS
-- (individually disabled), ⚠ RISK 3, enforced in the route.

CREATE OR REPLACE FUNCTION public.suspend_tenant(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant tenants%ROWTYPE;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not permitted to suspend a business';
  END IF;

  -- FOR UPDATE: serializes concurrent suspends, so the idempotency check and
  -- the audit row cannot race.
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such business';
  END IF;

  IF v_tenant.suspended_at IS NOT NULL THEN
    RETURN; -- idempotent: already suspended, nothing to do, no audit row
  END IF;

  UPDATE tenants SET suspended_at = NOW() WHERE id = p_tenant_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'tenant_suspended', 'Tenant', p_tenant_id,
          jsonb_build_object('suspended_at', NULL),
          jsonb_build_object('suspended_at', NOW()));
END;
$$;

COMMENT ON FUNCTION public.suspend_tenant(UUID) IS
  'Platform admin only: suspend a business. Staff and parent access goes dark '
  'through tenant_suspended(); the engine skips the tenant; already-sent '
  'public-invoice links keep working (decision 8). The auth-layer staff ban '
  'is /api/suspend-tenant''s job. Idempotent. WAVE_5_PLAN.md chunk 3.';

CREATE OR REPLACE FUNCTION public.unsuspend_tenant(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant tenants%ROWTYPE;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not permitted to unsuspend a business';
  END IF;

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such business';
  END IF;

  IF v_tenant.suspended_at IS NULL THEN
    RETURN; -- idempotent: not suspended, nothing to do, no audit row
  END IF;

  UPDATE tenants SET suspended_at = NULL WHERE id = p_tenant_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'tenant_unsuspended', 'Tenant', p_tenant_id,
          jsonb_build_object('suspended_at', v_tenant.suspended_at),
          jsonb_build_object('suspended_at', NULL));
END;
$$;

COMMENT ON FUNCTION public.unsuspend_tenant(UUID) IS
  'Mirror of suspend_tenant: gate + idempotency and NOTHING else — the exit '
  'door never grows a lock (reactivate_class doctrine). The auth-layer unban '
  'is /api/unsuspend-tenant''s job, and its unban set EXCLUDES individually '
  'disabled staff (⚠ RISK 3). WAVE_5_PLAN.md chunk 3.';

REVOKE ALL ON FUNCTION public.suspend_tenant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suspend_tenant(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_tenant(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.unsuspend_tenant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unsuspend_tenant(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.unsuspend_tenant(UUID) TO authenticated;

-- ── 8. platform_tenant_overview: the suspended_at column ─────────────────────
-- A return-type change CANNOT go through CREATE OR REPLACE — this is the one
-- place the wave must DROP a function. The full grant state is restated
-- ADJACENT to the DROP (plan step 8): post-20260804000400 default privileges
-- mean a forgotten regrant fails CLOSED (the platform page errors rather than
-- leaks), but a broken page is still broken. The post-deploy grant dump is
-- the proof (§7.39, §7.89).

DROP FUNCTION public.platform_tenant_overview();

CREATE FUNCTION public.platform_tenant_overview()
RETURNS TABLE(
  tenant_id             UUID,
  display_name          TEXT,
  shape                 TEXT,
  join_code             TEXT,
  active_students       INTEGER,
  active_classes        INTEGER,
  coaches               INTEGER,
  staff_without_rate    INTEGER,
  last_attendance_date  DATE,
  sessions_this_month   INTEGER,
  sessions_fully_marked INTEGER,
  last_month_billing    TEXT,
  active_families       INTEGER,
  admin_email           TEXT,
  admin_status          TEXT,
  suspended_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT is_platform_admin() AS ok),
  bounds AS (
    SELECT
      to_char((date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month'), 'YYYY-MM') AS last_month,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))::date AS this_month_start,
      (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) + INTERVAL '1 month')::date AS next_month_start
  )
  SELECT
    t.id,
    t.display_name,
    CASE
      WHEN (SELECT COUNT(*) FROM coaches co WHERE co.tenant_id = t.id) = 1
       AND EXISTS (
             SELECT 1 FROM coaches co
             JOIN profiles pr ON pr.id = co.profile_id
             WHERE co.tenant_id = t.id
               AND pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
        THEN 'private coach'
      ELSE 'school'
    END,
    t.join_code,
    (SELECT COUNT(*)::INT FROM students s
       WHERE s.tenant_id = t.id AND s.is_active),
    (SELECT COUNT(*)::INT FROM classes c
       WHERE c.tenant_id = t.id AND c.is_active),
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM coaches co
       JOIN profiles pr ON pr.id = co.profile_id
       WHERE co.tenant_id = t.id
         AND NOT (pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)),
    (SELECT MAX(ls.session_date) FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)
         AND (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id)
             >= (SELECT COUNT(*) FROM student_class_enrolments e
                   WHERE e.class_id = ls.class_id AND e.is_active)
         AND (SELECT COUNT(*) FROM student_class_enrolments e
                WHERE e.class_id = ls.class_id AND e.is_active) > 0),
    CASE
      WHEN EXISTS (SELECT 1 FROM billing_periods bp
                     WHERE bp.tenant_id = t.id
                       AND bp.billing_month = (SELECT last_month FROM bounds))
        THEN 'sealed'
      WHEN EXISTS (SELECT 1 FROM invoices i
                     WHERE i.tenant_id = t.id
                       AND i.billing_month = (SELECT last_month FROM bounds))
        THEN 'open'
      ELSE 'never run'
    END,
    (SELECT COUNT(*)::INT FROM parent_tenants pt
       WHERE pt.tenant_id = t.id AND pt.is_active),
    (SELECT pr.email FROM profiles pr WHERE pr.id = t.owner_profile_id),
    COALESCE((
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM profiles pr
      JOIN auth.users u ON u.id = pr.id
      WHERE pr.id = t.owner_profile_id
    ), 'none'),
    t.suspended_at
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$$;

COMMENT ON FUNCTION public.platform_tenant_overview() IS
  'Per-tenant operations overview for the platform admin. SECURITY DEFINER: '
  'gated on is_platform_admin() internally because it bypasses RLS. `shape` '
  'is DERIVED from whether the only coach is also the tenant admin — never '
  'from tenants.kind, which nothing maintains. Returns facts about recorded '
  'rows only; it deliberately does NOT derive which lessons should have run '
  '(§7.18). admin_status comes from auth.users.last_sign_in_at: ''none'' '
  'means the business has no admin at all and is still joinable — treat it '
  'as a fault. suspended_at added 20260813000300 (the DROP+regrant this '
  'required is why its grants sit right below).';

REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_overview()
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_tenant_overview() TO authenticated;
