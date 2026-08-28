-- Per-child swim-skill grading — Wave C S-pool Piece 4.
-- Plan: docs/plans/WAVE_C_SPOOL_PLAN.md (all four product decisions settled there).
--
-- WHAT THIS ADDS, and the line it does NOT cross.
-- `tenant_level_skills` (20260719002200) describes what a LEVEL teaches. It was
-- built deliberately NOT per-child, with the per-child half filed for later —
-- "coach write access they do not currently have on students, a marking UI, and
-- a decision about what happens to those records when a child changes level".
-- This migration is that later half:
--   * skill_grade_levels    — a per-tenant GRADE SCALE (Developing/Competent/
--                             Mastered by default, admin-editable labels), and
--   * student_skill_progress — one graded row per (student, skill).
--
-- WHY A NEW TABLE AND NOT A students COLUMN OR A students_update WIDENING.
-- Coaches have no write path to `students` by design (20260719001800): granting
-- UPDATE would also let them edit names, dates of birth and notes, because RLS
-- is row-level, not column-level. This table exists precisely so the coach grant
-- is a narrow write on progress rows, and `students_update` is never touched.
--
-- "DONE" IS COMPUTED, NEVER STORED. A skill counts as done when its grade holds
-- the TOP rank in the tenant's scale — read as MAX(rank) at read time, not a
-- boolean. That is load-bearing: adding a higher grade level must retroactively
-- re-open every skill that was "done" at the old top, which a stored boolean
-- could not do. Do not add a `passed`/`done` column.
--
-- KEEP RECORDS ACROSS A LEVEL CHANGE. Nothing here is deleted when a child moves
-- level; the UIs simply render the CURRENT level's skills. Moving up and back
-- loses nothing. The two FKs that could erase an earned record are therefore
-- ON DELETE RESTRICT (see below), not CASCADE.

-- ── 1. The grade scale, per tenant ──────────────────────────────────────────
CREATE TABLE skill_grade_levels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Higher rank = more advanced. The TOP rank is "done". A gap-free sequence is
  -- not required — reordering swaps ranks, and only the ordering matters.
  rank        INTEGER NOT NULL,
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Two grades cannot share a rank within one scale — the ordering must be total.
  UNIQUE (tenant_id, rank)
);

-- No two grade labels that differ only by case/whitespace, same reasoning as the
-- level-name index (20260719002200): a constraint " Mastered" defeats is none.
-- An EXPRESSION index, so it cannot be a table constraint.
CREATE UNIQUE INDEX skill_grade_levels_label_uniq
  ON skill_grade_levels (tenant_id, lower(trim(label)));

CREATE INDEX skill_grade_levels_tenant_rank_idx
  ON skill_grade_levels (tenant_id, rank);

-- ⚠️ CREATE TABLE LEAVES RLS OFF (§7.20) — policies on an RLS-disabled table are
-- never consulted. tenant_levels (20260719001800) carries the full warning.
ALTER TABLE skill_grade_levels ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can see the business: its staff (coaches render the
-- grade cycler from it) and the parents it serves. Mirrors tenant_levels_select.
CREATE POLICY skill_grade_levels_select ON skill_grade_levels
  FOR SELECT
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)
  );

-- Only the business's own admin edits its scale (the parked product decision:
-- rename freely; deleting a rank in use is refused structurally by the FK below).
CREATE POLICY skill_grade_levels_write ON skill_grade_levels
  FOR ALL
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON skill_grade_levels TO authenticated;
GRANT ALL ON skill_grade_levels TO service_role;

COMMENT ON TABLE skill_grade_levels IS
  'A business''s own grade scale for swim skills (rank + label). The TOP rank is '
  '"done", computed at read time — never store a done boolean. Seeded per tenant '
  'with Developing/Competent/Mastered. See docs/plans/WAVE_C_SPOOL_PLAN.md.';

-- ── 2. Per-child progress ───────────────────────────────────────────────────
CREATE TABLE student_skill_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- A deleted student takes their progress with them — no keep-records claim
  -- covers a purged student (prepare_admin_delete / hard delete).
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT, unlike tenant_level_skills' own CASCADE from its level:
  -- a child's EARNED record must not vanish because an admin tidied the
  -- curriculum. The consequence is deliberate and surfaced in the levels page —
  -- an in-use skill (and, by cascade, its level) can no longer be deleted.
  skill_id       UUID NOT NULL REFERENCES tenant_level_skills(id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT for the same reason: a grade level in use cannot be
  -- removed, so a record never points at a grade that no longer exists.
  grade_level_id UUID NOT NULL REFERENCES skill_grade_levels(id) ON DELETE RESTRICT,
  -- Who last graded, and when. Stamped server-side by the trigger below, not by
  -- the client — the client payload is (tenant, student, skill, grade) only.
  -- ON DELETE SET NULL: a departed coach's grades stay, unattributed.
  graded_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  graded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The upsert target. Without it the tap-to-cycle UI would INSERT duplicates
  -- and every n-of-m count would double-count. Re-grading REPLACES.
  UNIQUE (student_id, skill_id)
);

CREATE INDEX student_skill_progress_student_idx ON student_skill_progress (student_id);
CREATE INDEX student_skill_progress_skill_idx   ON student_skill_progress (skill_id);
CREATE INDEX student_skill_progress_grade_idx   ON student_skill_progress (grade_level_id);
CREATE INDEX student_skill_progress_tenant_idx  ON student_skill_progress (tenant_id);

ALTER TABLE student_skill_progress ENABLE ROW LEVEL SECURITY;

-- Readable by staff of the business (tenant_id = current_tenant_id() covers both
-- coach and admin) and the owning parent. A coach seeing every student's grades
-- within their own business is intended — the same visibility the roster gives.
CREATE POLICY student_skill_progress_select ON student_skill_progress
  FOR SELECT
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_owns_student(student_id)
  );

-- WRITE is the whole point of this table, and its predicate is DELIBERATELY
-- per-STUDENT (coach_serves_student), not per-class like close_student_enrolment.
-- Grading is an act on a CHILD the coach actively teaches (or an admin of the
-- business), so the coach-owns-a-specific-class rule would be the wrong shape:
-- a coach grades any child on a roster of theirs, across whichever of their
-- classes the child sits in. Admins can grade too (the admin already marks
-- attendance, §8.71). Parents get no write path — read-only above.
CREATE POLICY student_skill_progress_write ON student_skill_progress
  FOR ALL
  USING (can_admin_tenant(tenant_id) OR coach_serves_student(student_id))
  WITH CHECK (can_admin_tenant(tenant_id) OR coach_serves_student(student_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON student_skill_progress TO authenticated;
GRANT ALL ON student_skill_progress TO service_role;

COMMENT ON TABLE student_skill_progress IS
  'One graded row per (student, skill). Grade is a skill_grade_levels rank; '
  '"done" = top rank, computed at read time. Written by the coach who serves the '
  'child (or an admin); read by staff and the owning parent. Records survive a '
  'level change. See docs/plans/WAVE_C_SPOOL_PLAN.md.';

-- ── 3. Cross-tenant consistency + audit stamp (one BEFORE trigger) ──────────
-- RLS is row-level and cannot see a cross-TABLE reference: nothing in the write
-- policy stops a row pairing this tenant's student with ANOTHER tenant's skill
-- or grade level (the exact hole 20260719001800 closed for students.level_id).
-- So a structural guard is required. It ALSO stamps graded_by/graded_at, keeping
-- those columns server-authoritative regardless of what the client sends.
--
-- SECURITY DEFINER so RLS cannot hide a sibling row from the tenant lookups
-- (§7.125). Pure validation + idempotent stamp — no INSERT-only assumption — so
-- an upsert-resolved UPDATE is governed identically (§7.57).
CREATE OR REPLACE FUNCTION enforce_skill_progress_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_tenant UUID;
  v_skill_tenant   UUID;
  v_grade_tenant   UUID;
BEGIN
  SELECT tenant_id INTO v_student_tenant FROM students WHERE id = NEW.student_id;
  IF v_student_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'skill progress tenant must match the student''s business'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT l.tenant_id INTO v_skill_tenant
    FROM tenant_level_skills s
    JOIN tenant_levels l ON l.id = s.level_id
   WHERE s.id = NEW.skill_id;
  IF v_skill_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that skill belongs to another business'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT tenant_id INTO v_grade_tenant FROM skill_grade_levels WHERE id = NEW.grade_level_id;
  IF v_grade_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'that grade level belongs to another business'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Server-authoritative audit stamp (auth.uid() reads the JWT, not the DEFINER
  -- role, so it is still the real caller here). NULL for backend/service writes.
  -- Only when the GRADE is set or changed — a bare student_id repoint (what
  -- merge_students does when folding a duplicate) must preserve the original
  -- grader and time, not re-attribute the record to whoever ran the merge.
  IF TG_OP = 'INSERT' OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id THEN
    NEW.graded_by := auth.uid();
    NEW.graded_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_skill_progress_tenant
  BEFORE INSERT OR UPDATE ON student_skill_progress
  FOR EACH ROW EXECUTE FUNCTION enforce_skill_progress_tenant();

-- ── 4. Seed the default scale — existing tenants AND every future one ────────
-- Two halves, deliberately. The backfill covers tenants alive today; the trigger
-- covers every tenant created afterwards (provision_tenant, seed, or a manual
-- insert), so a business is never born without a scale to grade against.
INSERT INTO skill_grade_levels (tenant_id, rank, label)
SELECT t.id, v.rank, v.label
  FROM tenants t
 CROSS JOIN (VALUES (1, 'Developing'), (2, 'Competent'), (3, 'Mastered')) AS v(rank, label)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_default_skill_grade_levels()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO skill_grade_levels (tenant_id, rank, label)
  VALUES (NEW.id, 1, 'Developing'), (NEW.id, 2, 'Competent'), (NEW.id, 3, 'Mastered')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_skill_grade_levels
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION seed_default_skill_grade_levels();

-- ── 5. Teach merge_students() to move student_skill_progress ────────────────
-- student_skill_progress.student_id CASCADES from students, and merge_students()
-- ends in a DELETE of the duplicate. Its RISK-4 tripwire (20260726000500,
-- re-derived 20260802000500) REFUSES to run the moment any un-taught cascading
-- FK into students appears — which this table is. So the teaching is part of
-- this migration, not a follow-up: without it every merge on a business that
-- uses skills would refuse.
--
-- Same move-then-drop-collisions shape as trial/makeup bookings. The collision
-- key is the upsert key UNIQUE (student_id, skill_id): a graded skill moves to
-- the survivor only if the survivor is not already graded on that skill (the
-- survivor holds the history, so its grade wins). The re-derivation is the whole
-- body (§7.40 — the newest definition is the one that runs); the changes are
-- the allowlist entry, the move/drop block, the return column, the audit line,
-- and the destroyed-rows invariant.
--
-- DROP + recreate, not CREATE OR REPLACE: the result type gains
-- moved_skill_progress. Grants a DROP takes with it (§7.35) are re-issued below,
-- in this same transaction.
DROP FUNCTION IF EXISTS public.merge_students(UUID, UUID);

CREATE FUNCTION public.merge_students(
  p_survivor_id  UUID,
  p_duplicate_id UUID
)
RETURNS TABLE (
  moved_parent_links     INT,
  moved_trial_bookings   INT,
  moved_makeup_bookings  INT,
  moved_settlements      INT,
  moved_claims           INT,
  moved_skill_progress   INT,
  dropped_collisions     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_surv       students%ROWTYPE;
  v_dup        students%ROWTYPE;
  v_surv_att   INT;
  v_dup_att    INT;
  v_unknown    TEXT;
  v_ps INT := 0; v_tb INT := 0; v_mb INT := 0; v_ss INT := 0; v_cl INT := 0;
  v_sp INT := 0;
  v_drop INT := 0; v_drop_ps INT := 0; v_drop_tb INT := 0; v_drop_mb INT := 0;
  v_drop_sp INT := 0;
  v_ps_before INT; v_tb_before INT; v_mb_before INT; v_ss_before INT; v_sp_before INT;
  v_ps_after  INT; v_tb_after  INT; v_mb_after  INT; v_ss_after  INT; v_sp_after  INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_survivor_id = p_duplicate_id THEN
    RAISE EXCEPTION 'those are the same child';
  END IF;

  SELECT * INTO v_surv FROM students WHERE id = p_survivor_id;
  SELECT * INTO v_dup  FROM students WHERE id = p_duplicate_id;

  IF v_surv.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  IF v_surv.tenant_id <> v_dup.tenant_id THEN
    RAISE EXCEPTION 'those two children belong to different businesses';
  END IF;

  -- Tenant derived from the ROWS, never from a parameter (§7.42).
  IF NOT is_tenant_admin(v_surv.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may merge two children';
  END IF;

  -- ⚠ RISK 4 — THE STRUCTURAL GUARD. DO NOT REMOVE OR "SIMPLIFY" THIS.
  --
  -- This function ends in a DELETE, so every CASCADING foreign key into
  -- students silently takes rows with it. The mitigation cannot be a list in
  -- a comment that someone remembers to update. It is this: ask the CATALOGUE
  -- what cascades, and REFUSE if anything has appeared that this function has
  -- not been taught to move. student_skill_progress (2026-08-28) is the newest
  -- table this guard caught — it failed the suite the moment the table landed.
  SELECT string_agg(conrelid::regclass::text, ', ')
    INTO v_unknown
    FROM pg_constraint
   WHERE confrelid = 'students'::regclass
     AND contype = 'f'
     AND confdeltype = 'c'
     AND conrelid::regclass::text NOT IN
         ('parent_students', 'student_settlements', 'trial_bookings',
          'student_claims', 'makeup_bookings', 'student_skill_progress');

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION
      'merge_students has not been taught to move %, which now CASCADES from students. Teach it before merging, or the merge will destroy those rows.',
      v_unknown;
  END IF;

  -- ── Direction. Asserted, never inferred silently. ───────────────────────
  SELECT count(*)::INT INTO v_surv_att FROM attendance WHERE student_id = p_survivor_id;
  SELECT count(*)::INT INTO v_dup_att  FROM attendance WHERE student_id = p_duplicate_id;

  IF v_surv_att > 0 AND v_dup_att > 0 THEN
    RAISE EXCEPTION
      'Both children have lessons recorded (% and %). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
      v_surv_att, v_dup_att;
  END IF;

  -- The survivor must be the row with the history. If the caller has them the
  -- wrong way round, REFUSE and say so rather than quietly swapping.
  IF v_dup_att > 0 THEN
    RAISE EXCEPTION
      'The child you marked as the duplicate is the one with % lessons recorded. Swap them: the record with the history must be the one that survives.',
      v_dup_att;
  END IF;

  IF EXISTS (SELECT 1 FROM invoice_items WHERE student_id = p_duplicate_id)
     OR EXISTS (SELECT 1 FROM credit_notes WHERE student_id = p_duplicate_id) THEN
    RAISE EXCEPTION
      'The duplicate record already appears on an invoice or credit note, so it cannot be deleted. Sort this one out by hand.';
  END IF;

  -- Counted before anything moves, so the invariant at the end is honest.
  SELECT count(*)::INT INTO v_ps_before FROM parent_students;
  SELECT count(*)::INT INTO v_tb_before FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_before FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_before FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_before FROM student_skill_progress;

  -- ── 1. The duplicate's better fields, ONLY where the survivor has none ──
  BEGIN
    UPDATE students
       SET date_of_birth = COALESCE(date_of_birth, v_dup.date_of_birth),
           gender        = COALESCE(gender,        v_dup.gender),
           notes         = COALESCE(notes,         v_dup.notes),
           level_id      = COALESCE(level_id,      v_dup.level_id),
           provisional_contact_name  = COALESCE(provisional_contact_name,  v_dup.provisional_contact_name),
           provisional_contact_phone = COALESCE(provisional_contact_phone, v_dup.provisional_contact_phone),
           provisional_contact_email = COALESCE(provisional_contact_email, v_dup.provisional_contact_email)
     WHERE id = p_survivor_id;
  EXCEPTION WHEN unique_violation THEN
    -- Filling the DOB can collide with a THIRD row of the same name and date.
    -- The merge is still correct; only the enrichment is impossible.
    NULL;
  END;

  -- ── 2. Parent links ─────────────────────────────────────────────────────
  WITH moved AS (
    UPDATE parent_students ps
       SET student_id = p_survivor_id
     WHERE ps.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM parent_students x
          WHERE x.student_id = p_survivor_id AND x.parent_id = ps.parent_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ps FROM moved;

  WITH dropped AS (
    DELETE FROM parent_students WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_ps FROM dropped;

  -- ── 3. Trial bookings ───────────────────────────────────────────────────
  WITH moved AS (
    UPDATE trial_bookings tb
       SET student_id = p_survivor_id
     WHERE tb.student_id = p_duplicate_id
       AND (
         tb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM trial_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = tb.class_id
              AND x.session_date = tb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_tb FROM moved;

  WITH dropped AS (
    DELETE FROM trial_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_tb FROM dropped;

  -- ── 3b. Make-up bookings — same live-slot rule as trials ────────────────
  WITH moved AS (
    UPDATE makeup_bookings mb
       SET student_id = p_survivor_id
     WHERE mb.student_id = p_duplicate_id
       AND (
         mb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM makeup_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = mb.class_id
              AND x.session_date = mb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_mb FROM moved;

  WITH dropped AS (
    DELETE FROM makeup_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_mb FROM dropped;

  -- ── 3c. Skill progress — collision key is UNIQUE (student_id, skill_id) ──
  -- A graded skill moves to the survivor unless the survivor already holds a
  -- grade on that skill; the survivor holds the history, so its grade wins and
  -- the duplicate's colliding row is dropped. The student_id repoint fires
  -- enforce_skill_progress_tenant (validation only — the grade is unchanged, so
  -- graded_by/graded_at are preserved, not re-stamped to the merging admin).
  WITH moved AS (
    UPDATE student_skill_progress sp
       SET student_id = p_survivor_id
     WHERE sp.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM student_skill_progress x
          WHERE x.student_id = p_survivor_id AND x.skill_id = sp.skill_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_sp FROM moved;

  WITH dropped AS (
    DELETE FROM student_skill_progress WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_sp FROM dropped;

  v_drop := v_drop_ps + v_drop_tb + v_drop_mb + v_drop_sp;

  -- ── 4. Settlements — no unique constraint, so all of them move ──────────
  WITH moved AS (
    UPDATE student_settlements SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ss FROM moved;

  -- ── 5. Claims ───────────────────────────────────────────────────────────
  UPDATE student_claims sc
     SET status = 'declined', decided_at = NOW()
   WHERE sc.student_id = p_duplicate_id
     AND sc.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM student_claims x
        WHERE x.student_id = p_survivor_id
          AND x.parent_id = sc.parent_id
          AND x.status = 'pending'
     );

  WITH moved AS (
    UPDATE student_claims SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_cl FROM moved;

  -- ── 6. Enrolments. Safe to delete: the duplicate has no attendance. ─────
  DELETE FROM student_class_enrolments WHERE student_id = p_duplicate_id;

  -- ── 7. The record of what was destroyed, BEFORE destroying it ───────────
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_surv.tenant_id, v_actor, 'students_merged', 'Student', p_survivor_id,
    to_jsonb(v_dup),
    jsonb_build_object(
      'survivor_id', p_survivor_id, 'duplicate_id', p_duplicate_id,
      'moved_parent_links', v_ps, 'moved_trial_bookings', v_tb,
      'moved_makeup_bookings', v_mb,
      'moved_settlements', v_ss, 'moved_claims', v_cl,
      'moved_skill_progress', v_sp
    )
  );

  DELETE FROM students WHERE id = p_duplicate_id;

  -- ── 8. THE INVARIANT: a merge MOVES rows, it never destroys them. ───────
  SELECT count(*)::INT INTO v_ps_after FROM parent_students;
  SELECT count(*)::INT INTO v_tb_after FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_after FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_after FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_after FROM student_skill_progress;

  IF v_ss_after <> v_ss_before THEN
    RAISE EXCEPTION
      'merge lost % settlement row(s) — rolling back. A settlement is recorded revenue.',
      v_ss_before - v_ss_after;
  END IF;

  IF v_ps_after + v_tb_after + v_mb_after + v_sp_after
     > v_ps_before + v_tb_before + v_mb_before + v_sp_before THEN
    RAISE EXCEPTION 'merge invented rows — rolling back';
  END IF;

  IF (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
     - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) <> v_drop THEN
    RAISE EXCEPTION
      'merge lost % row(s) beyond the % deliberate collision drop(s) — rolling back',
      (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
        - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) - v_drop, v_drop;
  END IF;

  RETURN QUERY SELECT v_ps, v_tb, v_mb, v_ss, v_cl, v_sp, v_drop;
END;
$$;

COMMENT ON FUNCTION public.merge_students(UUID, UUID) IS
  'Fold an empty duplicate into the child holding the history. Refuses if both carry attendance, if the direction is wrong, or if an unknown cascading FK into students has appeared. Moves parent links, trial/make-up bookings, settlements, claims and skill progress.';

-- Re-issued in full: the DROP above took the previous grants with it (§7.35).
REVOKE ALL ON FUNCTION public.merge_students(UUID, UUID) FROM PUBLIC;
-- §7.39 — cloud default-grants; local does not reproduce them.
REVOKE EXECUTE ON FUNCTION public.merge_students(UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_students(UUID, UUID) TO authenticated;
