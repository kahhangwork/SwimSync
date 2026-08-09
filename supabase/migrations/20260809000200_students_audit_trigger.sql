-- Wave 1 Chunk 3, Step 3.1 — every edit to a `students` row is recorded
-- (docs/plans/WAVE_1_PLAN.md, BACKLOG #5).
--
-- ── WHAT WAS UNRECORDED ──────────────────────────────────────────────────────
-- FOUR client paths UPDATE `students` directly and write nothing anywhere. This
-- is the list asked of the code, not taken from the plan, which named a fifth
-- that does not exist and missed the fourth:
--   * the admin level picker      SwimSyncAdmin/app/(admin)/students/page.tsx:237
--   * the admin contact modal     SwimSyncAdmin/app/(admin)/students/page.tsx:462
--   * the admin Assign action     SwimSyncAdmin/app/(admin)/unassigned/page.tsx:215
--   * the parent's edit-child     SwimSyncApp/app/(parent)/home/edit-child.tsx:94
-- The COACH ROSTER is NOT one — WAVE_1_PLAN.md's RISK 2 names
-- (coach)/classes/[id]/roster.tsx:295 as a breakage site, but that line is a
-- `.select(`, and the coach app writes to `students` nowhere at all (its only
-- write path is marking attendance). Grep, don't inherit the list:
--   grep -rn -A2 'from("students")' SwimSyncAdmin/app SwimSyncApp/app | grep '\.update('
-- `provisional_contact_phone` and `_email` are the top two ranked signals in
-- find_student_candidates() — they decide which parent is offered which child,
-- and once a claim is approved NOTHING can unlink them except that flow's own
-- undo (§7.47). The dispute this exists for is "what was the number BEFORE",
-- so the row records to_jsonb(OLD) and to_jsonb(NEW), not "edited".
--
-- ── UPDATE ONLY, AND THAT IS NOT A GAP ───────────────────────────────────────
-- No INSERT or DELETE arm, because both already audit themselves from inside the
-- SECURITY DEFINER functions that own them: add_unclaimed_student() and
-- link_invited_parent() record a creation, merge_students() records a fold, and
-- prepare_admin_delete() records the delete. Direct client UPDATE was the one
-- writer with nobody recording it. Don't file the absence as a bug; check the
-- RPC first.
--
-- ── WHY A TRIGGER AND NOT AN RPC PER CALL SITE ───────────────────────────────
-- This supersedes what CONTACT_DETAILS_PLAN.md proposes. An RPC fixes one
-- screen and leaves setLevel(), the roster and every future direct write
-- unaudited. The trigger is atomic with the write it records, needs no client
-- change at all, and is inherited by call sites that do not exist yet.
--
-- ── WHY THIS IS NOT THE THING §7.61 PROHIBITS ────────────────────────────────
-- §7.61 says status propagation across students/families is DELIBERATELY not a
-- trigger and must not be "tidied" into one: a trigger fires after the write and
-- cannot ask the user anything, and that flow has to ask ("take the siblings
-- too?"). That prohibition is about PROPAGATION. This is RECORDING — append-only,
-- one INSERT into audit_log and nothing else. Read the named prohibition below
-- as the boundary between the two; the moment this trigger updates another table
-- or raises on a business rule, §7.61 applies and this design is wrong.
--
--   NAMED PROHIBITION: this trigger writes to audit_log and NOTHING ELSE. It
--   must never UPDATE another table, never cascade a status, never RAISE on a
--   business rule. It returns NULL so it is structurally incapable of altering
--   the row it is recording.
--
-- ── THE THREE WAYS THIS TRIGGER COULD REFUSE EVERY STUDENT EDIT ──────────────
-- All three abort the originating UPDATE, because a raising trigger kills the
-- whole statement (§7.66, §7.67) and post-20260804000600 a disallowed write
-- RAISES rather than matching zero rows (§7.88). All three are closed here, and
-- each has its own pgTAP assertion proven red (§7.25).
--
--   1. THE RLS POLICY. audit_log_insert (20260804000300) permits `authenticated`
--      to insert ONLY entity_type = 'lesson_session' AND coach_owns_session().
--      A 'Student' row from an INVOKER-rights trigger is refused → 42501 → the
--      students UPDATE aborts, breaking all four client writers above. Measured,
--      not argued: students_audit.test.sql assertion 1 dies with exactly that
--      error when the function is ALTERed to SECURITY INVOKER.
--      → the function is SECURITY DEFINER, so the INSERT runs as the table owner
--        and policies do not reach it — 20260804000300:69-74 states that design
--        explicitly. Without SECURITY DEFINER this step cannot work at all.
--      → and note the mirror image, §7.104: `current_user = 'authenticated'` is
--        DEAD CODE inside SECURITY DEFINER and fails OPEN. DEFINER is required
--        here AND it silently kills any current_user seam put inside. There is
--        none in this function on purpose; the actor test below is auth.uid().
--
--   2. audit_log.actor_id IS `NOT NULL REFERENCES profiles(id)` (§7.50, and it
--      is NOT NULL for reasons depended on elsewhere — do NOT make it nullable
--      to solve this). auth.uid() is NULL on every path with no JWT: a data-fix
--      migration, psql, the seed, an edge function under service_role. NULL
--      actor → NOT NULL violation → the students UPDATE aborts. There are ~12
--      migration files containing `UPDATE students` already, so the next one
--      would fail `supabase db push` AGAINST PRODUCTION.
--      → the function resolves the actor through profiles and RETURNS EARLY when
--        there is none, which also survives an auth.users row with no profiles
--        row. An audit gap on a backend path is recoverable; a refused student
--        write is not.
--
--   3. entity_type IS A CLOSED SET. audit_log_tenant_of (20260804000300:77-110)
--      is a CASE over exactly 'Student', 'Class', 'lesson_session' and
--      'ParentTenant', and RAISEs on anything else — from set_audit_log_tenant,
--      a BEFORE INSERT trigger on audit_log. 'student', 'students' or 'Students'
--      would abort the students UPDATE.
--      → NAMED PROHIBITION: the value is exactly 'Student'. Do not invent a new
--        one, and do not add an arm to audit_log_tenant_of for this.
--
-- A fourth was checked and does not exist: set_audit_log_tenant RAISEs if a row
-- would end with no tenant at all, but students.tenant_id has been NOT NULL
-- since 20260719000600, and an AFTER UPDATE trigger sees a row that is still
-- there. tenant_id is deliberately NOT supplied below — set_audit_log_tenant
-- derives it from the entity and OVERWRITES whatever is passed (:139-142,
-- pinned by audit_log_tenant.test.sql:100). Supplying it would be harmless and
-- relying on it would be wrong.
--
-- ── WRITE VOLUME: ZERO FROM THE ENGINE, AND THAT WAS WORTH CHECKING ──────────
-- The plan assumed the invoice engine writes this table under service_role. It
-- does not — `grep -n 'from("students")' supabase/functions/**/*.ts` is
-- .select( at every site (core.ts:667, core.ts:885, email.ts:325). So
-- engine-driven volume from this trigger is zero and an engine run cannot be
-- aborted by it. Re-confirm that grep if the engine ever gains a write.
--
-- ── KNOWN LIMITATION, RECORDED RATHER THAN FIXED HERE ────────────────────────
-- prepare_admin_delete() PURGES the target's audit_log rows, because actor_id is
-- a NOT NULL FK with no cascade (20260806000100:56). So hard-deleting a
-- departing admin destroys exactly the contact-detail history this trigger
-- exists to preserve — which is the dispute most likely to need it. Stated, not
-- silently shipped. Fixing it is a retention decision, not part of this step.
--
-- ── SENSITIVITY ──────────────────────────────────────────────────────────────
-- to_jsonb(OLD)/to_jsonb(NEW) copies the child's FULL row — date of birth,
-- notes, provisional_contact_phone/_email — into a table with a different
-- retention story and a platform-admin reader. That is the point of the record,
-- but audit_log is no longer low-sensitivity; the column comment says so.
--
-- ROLLBACK: supabase/rollback/20260809_students_audit_DOWN.sql (committed before
-- deploy, and EXECUTED — running the DOWN file is the half that finds the bugs,
-- §7.93).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_student_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  -- Abort vector 2. Resolved through profiles rather than taken from auth.uid()
  -- directly, so an auth.users row with no profiles row skips the record
  -- instead of violating the FK and killing the caller's UPDATE.
  SELECT p.id INTO v_actor FROM profiles p WHERE p.id = auth.uid();

  IF v_actor IS NULL THEN
    -- No JWT: a migration, psql, the seed, or an edge function under
    -- service_role. Record nothing and let the write through. Deliberate: an
    -- audit gap on a backend path is recoverable, a refused student write is not.
    RETURN NULL;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (v_actor, 'student_updated', 'Student', NEW.id,
          to_jsonb(OLD), to_jsonb(NEW));

  -- AFTER trigger: the return value is ignored. NULL rather than NEW so this
  -- function cannot be read as having a say in the row (see §7.61 above).
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.audit_student_update() IS
  'AFTER UPDATE on students: records the whole OLD and NEW row in audit_log. '
  'SECURITY DEFINER is MANDATORY — audit_log_insert permits authenticated '
  'exactly one entity_type, so an invoker-rights version refuses every student '
  'edit in the product (20260809000200). Returns early when there is no JWT '
  'actor, because actor_id is NOT NULL. Records only; never propagates (§7.61).';

-- No GRANT: Postgres does not privilege-check trigger functions against the
-- writing role and PostgREST does not expose them, which is why
-- function_grants.test.sql excludes `RETURNS trigger` from its anon sweep.

-- The WHEN clause keeps a no-op UPDATE (same values re-saved, which both the
-- level picker and the contact modal can produce) out of the trail. There is no
-- ordering contract with the one other trigger on this table —
-- trg_pin_student_tenant is BEFORE UPDATE and this is AFTER, so it has already
-- run and may already have aborted the statement.
DROP TRIGGER IF EXISTS trg_audit_student_update ON public.students;
CREATE TRIGGER trg_audit_student_update
  AFTER UPDATE ON public.students
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.audit_student_update();

-- BOTH columns, because both hold the same full row and a reader who checks
-- only one of them gets no warning at all.
COMMENT ON COLUMN public.audit_log.old_value IS
  'The entity''s previous state. For entity_type = ''Student'' this is the FULL '
  'row (date of birth, notes, provisional contact phone and email), so audit_log '
  'is NOT low-sensitivity data — it carries child PII with a platform-admin '
  'reader and its own retention story (20260809000200).';

COMMENT ON COLUMN public.audit_log.new_value IS
  'The entity''s resulting state. Same sensitivity as old_value: for '
  'entity_type = ''Student'' it is the FULL row, child PII included '
  '(20260809000200).';
