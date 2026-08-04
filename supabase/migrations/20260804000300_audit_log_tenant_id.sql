-- ============================================================
-- A BUSINESS CAN READ ITS OWN AUDIT TRAIL.
--
-- THE STATE THIS FIXES. audit_log.tenant_id is nullable, and 13 of the 19
-- writers never set it. The read policy is
--   is_platform_admin() OR is_tenant_admin(tenant_id)
-- and is_tenant_admin() opens with `p_tenant_id IS NOT NULL AND …`, so it
-- returns FALSE — not NULL — for a null tenant. A row with no tenant is
-- readable by the platform admin and by nobody else.
--
-- WHY NOW, WHEN NOTHING READS audit_log YET. Because the failure mode got
-- worse, not better. Before 2026-07-26 the column was uniformly empty, which
-- fails obviously. The parent-claim work then added six writers that DO set it,
-- so it is now PARTLY populated — and a history screen written the obvious way
-- would show every claim, approval and merge and NONE of the attendance saves,
-- enrolment closures or trial bookings, while looking authoritative. That is
-- the same failure this repo already warns about for revenue reporting: a
-- silent hole gets trusted, an absent feature does not.
--
-- ── WHY A TRIGGER, NOT 13 EDITED CALL SITES ──────────────────────────────────
-- Editing them means redefining large functions (book_trial,
-- add_unclaimed_student, set_class_terms) purely to add one column, which is
-- the §7.40 hazard: a redefinition that exists only to touch one line is where
-- an unrelated regression rides in. A trigger is atomic with the insert, covers
-- the client writer too, needs no app change, and is inherited automatically by
-- whatever writes next.
--
-- ── WHY DERIVED FROM THE ENTITY, NOT FROM THE ACTOR ──────────────────────────
-- current_tenant_id() is right for a coach saving attendance and an admin
-- approving a claim, and WRONG for join_tenant_by_code / reassign_student_tenant,
-- where the actor is a PARENT with no tenant_id at all and the row is about the
-- tenancy being joined. The entity is correct in every case. The cost is a CASE
-- with a lookup per type, and a type added later that falls through to NULL —
-- which is the §7.37 disease. So the ELSE branch RAISES. A new entity_type
-- fails loudly on its first insert, in development, instead of writing another
-- invisible row.
--
-- The full universe of entity_type today is four values, confirmed by parsing
-- every INSERT INTO audit_log in the migrations plus the one client writer:
--   'Student'        → students.tenant_id
--   'Class'          → classes.tenant_id
--   'lesson_session' → lesson_sessions → classes.tenant_id
--   'ParentTenant'   → NOT derivable from entity_id: entity_id is the parent,
--                      and a parent may belong to several businesses. Its only
--                      writer is set_parent_tenant_active(), a SECURITY DEFINER
--                      RPC that knows exactly which tenancy it changed, so this
--                      type keeps the value the writer supplied — and the
--                      policy below is what stops a client supplying one.
--
-- ── PRECEDENCE: DERIVED WINS ─────────────────────────────────────────────────
-- Where a value can be derived it OVERWRITES whatever was supplied. audit_log's
-- INSERT policy only ever constrained actor_id, so a client could always
-- attribute a row to any business it liked. The six writers that already set
-- tenant_id set it correctly, so overwriting changes nothing for them, and it
-- removes the client's say entirely for every derivable type.
--
-- Derivation returning NULL is NOT treated as an error on its own — an entity
-- row can legitimately be gone — but a row that ends with no tenant at all is
-- the invisible row this migration exists to prevent, so that RAISES.
--
-- ── AND THE POLICY, BECAUSE A FABRICATED TRAIL IS THE SAME FAILURE ───────────
-- audit_log_insert was `WITH CHECK (actor_id = auth.uid())` — any signed-in
-- user could write any audit row about any entity. That was survivable while
-- nothing read the table. This migration is what makes the rows readable BY THE
-- BUSINESS THEY DESCRIBE, so it is the moment to close it.
--
-- Exactly ONE client path writes audit rows: the coach's attendance screen
-- (SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx, entity_type
-- 'lesson_session'). Verified by grep across both apps — it is the only
-- `from("audit_log")` anywhere. Every other writer is inside a SECURITY DEFINER
-- function, which runs as the table owner and is not subject to policies
-- (audit_log is owned by postgres and does NOT have FORCE ROW LEVEL SECURITY),
-- so narrowing the policy cannot reach them.
-- ============================================================

-- ── 1. The derivation ─────────────────────────────────────────────────────────
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
    WHEN 'ParentTenant' THEN
      -- Deliberately NULL. entity_id is the parent, and a parent may belong to
      -- more than one business, so there is nothing to derive. The caller keeps
      -- its own value; see the trigger.
      v_tenant := NULL;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$$;

COMMENT ON FUNCTION public.audit_log_tenant_of(TEXT, UUID) IS
  'Which business an audit row is about, derived from its ENTITY rather than '
  'from the actor — the actor is wrong for join_tenant_by_code and '
  'reassign_student_tenant, where a parent with no tenant acts on a tenancy. '
  'RAISES on an unknown entity_type so the next one fails loudly instead of '
  'writing an invisible row.';

REVOKE ALL ON FUNCTION public.audit_log_tenant_of(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_log_tenant_of(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_log_tenant_of(TEXT, UUID) TO authenticated, service_role;

-- ── 2. The trigger ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_audit_log_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_derived UUID;
BEGIN
  v_derived := audit_log_tenant_of(NEW.entity_type, NEW.entity_id);

  IF v_derived IS NOT NULL THEN
    -- Derived wins. The client never had a legitimate say here.
    NEW.tenant_id := v_derived;
  ELSIF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION
      'audit_log: cannot determine the business for % %. A row with no '
      'tenant_id is invisible to the business it describes (20260804000300).',
      NEW.entity_type, NEW.entity_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_audit_log_tenant() IS
  'BEFORE INSERT on audit_log: stamps tenant_id from the entity. A derivable '
  'value OVERWRITES whatever was supplied; a row that would end with no tenant '
  'at all is refused.';

DROP TRIGGER IF EXISTS audit_log_set_tenant ON public.audit_log;
CREATE TRIGGER audit_log_set_tenant
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_log_tenant();

-- ── 3. Backfill ───────────────────────────────────────────────────────────────
-- Same rule, applied once to what is already there. Rows whose entity has since
-- been deleted stay NULL rather than being guessed; they were already invisible
-- and this does not make them worse. Deliberately NOT a DO block that raises on
-- an unknown entity_type: a historical row with a type nobody supports any more
-- must not be able to block the migration.
UPDATE audit_log a
   SET tenant_id = s.tenant_id
  FROM students s
 WHERE a.tenant_id IS NULL AND a.entity_type = 'Student' AND s.id = a.entity_id;

UPDATE audit_log a
   SET tenant_id = c.tenant_id
  FROM classes c
 WHERE a.tenant_id IS NULL AND a.entity_type = 'Class' AND c.id = a.entity_id;

UPDATE audit_log a
   SET tenant_id = c.tenant_id
  FROM lesson_sessions ls
  JOIN classes c ON c.id = ls.class_id
 WHERE a.tenant_id IS NULL AND a.entity_type = 'lesson_session' AND ls.id = a.entity_id;

-- ── 4. The INSERT policy ──────────────────────────────────────────────────────
-- From "any signed-in user may write any audit row" to "a coach may record that
-- they saved attendance on a session they own". Everything else writes through
-- SECURITY DEFINER functions, which policies do not reach.
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND entity_type = 'lesson_session'
    AND coach_owns_session(entity_id)
  );
