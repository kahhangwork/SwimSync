-- ═══════════════════════════════════════════════════════════════════════════
-- DISABLE A COACH — the coach twin of admin deactivation (Wave 5 chunk 2,
-- docs/plans/WAVE_5_PLAN.md)
--
-- The mechanism is the co-admin one (20260806000100, §8.31): authority cut by
-- one clause in an identity helper, an INVOKER guard trigger pinning the column
-- against client writes (§7.38), idempotent SECURITY DEFINER RPCs that gate
-- themselves, and an auth-layer ban applied by an API route — for a PURE coach
-- only; an admin-who-coaches keeps their admin login.
--
-- Five things, one file (the guard ships WITH the column, never later —
-- coaches_update's self-arm `profile_id = auth.uid()` would otherwise let a
-- disabled coach clear their own disabled_at):
--   1. coaches.disabled_at
--   2. current_coach_id() gains AND disabled_at IS NULL — the blast-radius
--      edit: every coach policy flows through it. Body from
--      pg_get_functiondef() against the live DB (§7.115), 2026-08-13; it
--      matched 20260309000600 exactly.
--   3. guard_coaches_privileges() — INVOKER trigger pinning disabled_at,
--      profile_id, tenant_id. LOAD-BEARING, not belt-and-braces (see above).
--   4. disable_coach() / reactivate_coach() — the only write paths.
--   5. audit_log_tenant_of() gains a WHEN 'Coach' arm — the ELSE RAISES by
--      design (§7.37); without the arm the first coach_disabled audit row
--      would kill the RPC that writes it. Body from pg_get_functiondef(),
--      2026-08-13; it matched 20260813000100 exactly.
--
-- What deliberately does NOT change: profiles.is_active stays unenforced
-- (whole-account; an admin-who-coaches must keep admining when their coach
-- half is disabled); generate_coach_payouts still pays a disabled coach's
-- taught lessons (disabling is forward-looking; class_rates.paid_coach_id is
-- wage history); past/today session_coaches overrides naming the target are
-- kept — they are wage history, and an unmarked one stays markable by the
-- ADMIN (WAVE_5_PLAN.md ⚠ RISK 8; the disable dialog names those lessons).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The column ────────────────────────────────────────────────────────────

ALTER TABLE public.coaches ADD COLUMN disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.coaches.disabled_at IS
  'Set/cleared ONLY by disable_coach()/reactivate_coach() — '
  'guard_coaches_privileges refuses client writes. While set, '
  'current_coach_id() returns NULL so every coach-scoped policy goes dark; '
  'current_tenant_id()-scoped reads survive for the token lifetime, ACCEPTED '
  '(WAVE_5_PLAN.md ⚠ RISK 5) — the auth-layer ban is the enforcement.';

-- ── 2. current_coach_id: the authority cut ───────────────────────────────────
-- A disabled coach stops resolving to a coach at all. Every coach-arm policy
-- (classes, sessions, attendance, rosters, shadows) flows through this.

CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM coaches WHERE profile_id = auth.uid() AND disabled_at IS NULL;
$$;

-- ── 3. The guard: disabled_at is not client-writable ─────────────────────────
-- Modelled on guard_profiles_privileges (20260806000100). INVOKER on purpose:
-- current_user is 'authenticated' for a client write and 'postgres' inside a
-- SECURITY DEFINER RPC — that difference IS the mechanism (§7.38).
--
-- LOAD-BEARING: coaches_update's self-arm (USING profile_id = auth.uid(),
-- 20260718000900) would otherwise let a disabled coach UPDATE their own row
-- and clear disabled_at. profile_id and tenant_id are pinned with it — the
-- same identity-shaped columns the profiles guard pins.

CREATE OR REPLACE FUNCTION public.guard_coaches_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND (
       OLD.profile_id  IS DISTINCT FROM NEW.profile_id
    OR OLD.tenant_id   IS DISTINCT FROM NEW.tenant_id
    OR OLD.disabled_at IS DISTINCT FROM NEW.disabled_at
  ) THEN
    RAISE EXCEPTION
      'coaches.profile_id / tenant_id / disabled_at cannot be changed directly '
      '— use disable_coach()/reactivate_coach() (20260813000200)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER coaches_guard_privileges
  BEFORE UPDATE ON public.coaches
  FOR EACH ROW EXECUTE FUNCTION public.guard_coaches_privileges();

-- ── 4. audit_log_tenant_of: the 'Coach' arm ──────────────────────────────────
-- A row about a coach belongs to that coach's business.

CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  CASE p_entity_type
    WHEN 'Student' THEN
      SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_entity_id;
    WHEN 'Class' THEN
      SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = p_entity_id;
    WHEN 'lesson_session' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_entity_id;
    WHEN 'Profile' THEN
      -- Admin-management rows (20260806000100). The subject profile still
      -- exists at insert time even on the delete path — prepare_admin_delete
      -- writes its audit row before auth.users cascades the profile away.
      SELECT p.tenant_id INTO v_tenant FROM profiles p WHERE p.id = p_entity_id;
    WHEN 'Coach' THEN
      -- Coach-lifecycle rows (20260813000200): coach_disabled/coach_reactivated.
      SELECT c.tenant_id INTO v_tenant FROM coaches c WHERE c.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      -- Deliberately NULL. entity_id is the parent, and a parent may belong to
      -- more than one business, so there is nothing to derive. The caller keeps
      -- its own value; see the trigger.
      v_tenant := NULL;
    WHEN 'Tenant' THEN
      -- Platform-level actions ON a business (owner_reassigned here;
      -- tenant suspension reuses this arm — WAVE_5_PLAN.md chunk 3). The row is
      -- about the tenant, so the entity id IS the tenant id — a lookup would
      -- only re-derive the argument. Note audit_log.tenant_id carries an FK to
      -- tenants(id) (20260718000500), so no 'Tenant' audit row can outlive its
      -- tenant regardless of what this arm returns; callers must audit BEFORE
      -- any future hard-delete, not after.
      v_tenant := p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$$;

-- ── 5. disable_coach ─────────────────────────────────────────────────────────
-- Atomic by decision 4: the dialog requires a replacement when active classes
-- exist, one transaction reassigns and disables, a refusal ANYWHERE aborts the
-- whole thing. That includes set_class_terms's own money guards (sealed billing
-- month at/after the current one; a PAID current-month payout — always reached
-- on reassignment because paid_coach_id moves) and class_shadow_guard's
-- payout-seal check on the shadow end-dating: composition is the point
-- (⚠ RISK 7), and the UI surfaces the underlying message plainly.

CREATE OR REPLACE FUNCTION public.disable_coach(
  p_coach_id             UUID,
  p_replacement_coach_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coach       coaches%ROWTYPE;
  v_owner       UUID;
  v_class       RECORD;
  v_price       NUMERIC;
  v_class_names TEXT;
  v_reassigned  UUID[] := '{}';
BEGIN
  -- FOR UPDATE: serializes concurrent disables of the same coach, so the
  -- idempotency check and the audit row cannot race.
  SELECT * INTO v_coach FROM coaches WHERE id = p_coach_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such coach';
  END IF;

  -- THE GATE. Any active admin of the coach's own business (decision 7 —
  -- "their own staffing", owner-only was considered and refused). The
  -- owner-lockout risk is closed by the sole-coach guard below, not here.
  IF NOT is_tenant_admin(v_coach.tenant_id) THEN
    RAISE EXCEPTION 'not permitted to manage coaches for this business';
  END IF;

  -- Idempotent: already disabled → nothing to do, no audit row.
  IF v_coach.disabled_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- The sole-coach-who-is-the-owner guard — decided by which EXTENSION ROWS
  -- exist, never role (§7.19, §7.91). A co-admin disabling the owner's coach
  -- half when no other active coach exists would put the whole business's
  -- coaching dark with nobody left to teach.
  SELECT t.owner_profile_id INTO v_owner
    FROM tenants t WHERE t.id = v_coach.tenant_id;
  IF v_coach.profile_id IS NOT DISTINCT FROM v_owner AND NOT EXISTS (
    SELECT 1 FROM coaches c
     WHERE c.tenant_id = v_coach.tenant_id
       AND c.id <> p_coach_id
       AND c.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'this is the owner''s coach account and the business''s only active '
      'coach — hire another coach before disabling it';
  END IF;

  -- Active classes need a live destination BEFORE anything is written.
  IF p_replacement_coach_id IS NOT NULL THEN
    IF p_replacement_coach_id = p_coach_id THEN
      RAISE EXCEPTION 'a coach cannot be their own replacement';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM coaches c
       WHERE c.id = p_replacement_coach_id
         AND c.tenant_id = v_coach.tenant_id
         AND c.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'the replacement must be an active coach of this business';
    END IF;
  END IF;

  SELECT string_agg(c.title, ', ' ORDER BY c.title) INTO v_class_names
    FROM classes c
   WHERE c.coach_id = p_coach_id AND c.is_active;
  IF v_class_names IS NOT NULL AND p_replacement_coach_id IS NULL THEN
    RAISE EXCEPTION
      'this coach still teaches: %. Choose a replacement coach — the classes '
      'are handed over and the coach disabled in one step.', v_class_names;
  END IF;

  -- Reassign each active class through set_class_terms, effective TODAY. The
  -- caller's auth.uid() survives into the nested definer call, so its
  -- can_admin_tenant gate passes (verified 20260812000200). Same terms, same
  -- price — only the coach moves; class_rates gets its effective-dated row and
  -- the audit trail its class_terms_changed entries, exactly as a manual
  -- handover would.
  FOR v_class IN
    SELECT c.* FROM classes c
     WHERE c.coach_id = p_coach_id AND c.is_active
     ORDER BY c.title
  LOOP
    SELECT r.price_per_lesson INTO v_price
      FROM class_rate_on(v_class.id, today_sg()) r;
    PERFORM set_class_terms(
      v_class.id,
      v_class.title,
      v_class.day_of_week,
      v_class.start_time,
      v_class.end_time,
      v_class.location_name,
      COALESCE(v_price, v_class.price_per_lesson),
      p_replacement_coach_id,
      NULL,     -- effective from today
      FALSE,    -- a handover, never an in-place correction
      v_class.location_address
    );
    v_reassigned := v_reassigned || v_class.id;
  END LOOP;

  -- End the target's own active shadow assignments, dated today — never
  -- deleted; past shadow pay is history (Wave 3 RISK 12). GREATEST keeps the
  -- shadow_dates_ordered check satisfied even for an anomalous future-dated
  -- row (assign_class_shadow refuses future dates, but a direct admin write
  -- predating this migration might not have). class_shadow_guard still
  -- asserts the payout month open — a refusal there aborts the whole disable,
  -- by design.
  UPDATE class_shadow_coaches
     SET effective_to = GREATEST(effective_from, today_sg()),
         ended_by     = auth.uid(),
         ended_at     = NOW()
   WHERE coach_id = p_coach_id AND effective_to IS NULL;

  -- Clear FUTURE substitute bookings naming the target. Past and TODAY rows
  -- stay: they are wage history, and an unmarked one stays markable by the
  -- admin (⚠ RISK 8 — the dialog tells the admin those lessons now fall to
  -- them).
  DELETE FROM session_coaches sc
   USING lesson_sessions ls
   WHERE ls.id = sc.lesson_session_id
     AND sc.coach_id = p_coach_id
     AND ls.session_date > today_sg();

  -- The disable itself. Passes coaches_guard_privileges as postgres (§7.38).
  UPDATE coaches SET disabled_at = NOW() WHERE id = p_coach_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'coach_disabled', 'Coach', p_coach_id,
          jsonb_build_object('disabled_at', NULL),
          jsonb_build_object(
            'disabled_at',           NOW(),
            'replacement_coach_id',  p_replacement_coach_id,
            'classes_reassigned',    to_jsonb(v_reassigned)));
END;
$$;

COMMENT ON FUNCTION public.disable_coach(UUID, UUID) IS
  'Any active tenant admin: disable a coach, atomically handing their active '
  'classes to a replacement via set_class_terms (effective today). Refuses the '
  'owner''s coach row when it is the business''s only active coach. Ends the '
  'target''s shadow assignments (dated, kept), deletes only FUTURE substitute '
  'overrides. Idempotent. The auth-layer ban for a PURE coach is the API '
  'route''s job, never this function''s. WAVE_5_PLAN.md chunk 2.';

-- ── 6. reactivate_coach ──────────────────────────────────────────────────────
-- The exit door takes no refusals beyond the gate (the reactivate_class()
-- doctrine) and does NOT hand classes back — the reassignment was
-- effective-dated and stands; returning a class is a deliberate
-- set_class_terms call by the admin.

CREATE OR REPLACE FUNCTION public.reactivate_coach(p_coach_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coach coaches%ROWTYPE;
BEGIN
  SELECT * INTO v_coach FROM coaches WHERE id = p_coach_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such coach';
  END IF;

  IF NOT is_tenant_admin(v_coach.tenant_id) THEN
    RAISE EXCEPTION 'not permitted to manage coaches for this business';
  END IF;

  IF v_coach.disabled_at IS NULL THEN
    RETURN; -- idempotent: already active, nothing to do, no audit row
  END IF;

  UPDATE coaches SET disabled_at = NULL WHERE id = p_coach_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'coach_reactivated', 'Coach', p_coach_id,
          jsonb_build_object('disabled_at', v_coach.disabled_at),
          jsonb_build_object('disabled_at', NULL));
END;
$$;

COMMENT ON FUNCTION public.reactivate_coach(UUID) IS
  'Mirror of disable_coach: gate + idempotency and NOTHING else — the exit '
  'door never grows a lock (reactivate_class doctrine). Does not hand classes '
  'back. The auth-layer unban is the API route''s job. WAVE_5_PLAN.md chunk 2.';

-- ── 7. Grants: the standard triple ───────────────────────────────────────────

REVOKE ALL ON FUNCTION public.disable_coach(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_coach(UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.disable_coach(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reactivate_coach(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_coach(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_coach(UUID) TO authenticated;
