-- Fixture for verify-assessment.mjs — the admin Assessment tab.
--
-- ⚠ THE SHAPE HERE IS THE WHOLE POINT, and every row exists to make one
-- specific way of getting this wrong observable:
--
--   * TWO LEVELS IN ONE CLASS. A class carries no level of its own
--     (students.level_id is per-CHILD), so a real roster is ragged. A fixture
--     with one level would let a single flat matrix pass.
--   * A CHILD WITH NO LEVEL. `assessed = fresh === total` is VACUOUSLY TRUE at
--     0 === 0, which would report this child as fully assessed and send the
--     assessor straight past them — inside the tool built to stop children
--     being skipped. This child is the fixture's most valuable row.
--   * A CHILD GRADED 90 DAYS AGO, at the TOP grade, on EVERY skill. This is the
--     scenario the whole round mechanism exists for: their row looks complete,
--     and an assessor who cannot tell old grades from today's will skip them.
--     They must render greyed and dated, count 0/2 for the round, and be
--     offered NO promotion (a promotion off stale grades would move a child
--     nobody has looked at today).
--   * A CHILD GRADED TODAY, so fresh and stale sit side by side on one screen —
--     the comparison a screenshot can actually fail on.
--
-- ⚠ THE BACKDATE MUST DISABLE THE TRIGGER. trg_skill_progress_tenant stamps
-- graded_at on every write that is not a bare student_id repoint
-- (20260829000100), so a plain UPDATE would be clobbered to NOW() and the
-- stale row would silently become fresh — the fixture would then prove the
-- opposite of what it is for. Same technique as skill_progress.test.sql.
--
-- ⚠ SHARED STACK. Namespaced 'Assess', fixed UUIDs, guarded inserts. Do NOT
-- add a TRUNCATE and do NOT run `supabase db reset` — other worktrees are on
-- this database. Teardown: fixtures-assessment-teardown.sql.
--
-- Idempotency note: tenant_levels' uniqueness is an EXPRESSION index
-- (tenant_id, lower(trim(label))), which ON CONFLICT (tenant_id, label) does
-- not match. Conflict on the primary key instead (§7.53's family).

-- ---- Two rungs of the ladder ----
INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES
  ('12000000-0000-0000-0000-000000000001'::uuid,
   '70000000-0000-0000-0000-000000000001', 'Assess Water Confidence', 1),
  ('12000000-0000-0000-0000-000000000002'::uuid,
   '70000000-0000-0000-0000-000000000001', 'Assess Front Crawl', 2)
ON CONFLICT (id) DO NOTHING;

-- ---- Two skills on each rung ----
INSERT INTO tenant_level_skills (id, level_id, label, sort_order)
VALUES
  ('12100000-0000-0000-0000-000000000001'::uuid,
   '12000000-0000-0000-0000-000000000001', 'Assess Float unaided', 1),
  ('12100000-0000-0000-0000-000000000002'::uuid,
   '12000000-0000-0000-0000-000000000001', 'Assess Glide 5 metres', 2),
  ('12100000-0000-0000-0000-000000000003'::uuid,
   '12000000-0000-0000-0000-000000000002', 'Assess Arms over water', 1),
  ('12100000-0000-0000-0000-000000000004'::uuid,
   '12000000-0000-0000-0000-000000000002', 'Assess Breathe to the side', 2)
ON CONFLICT (id) DO NOTHING;

-- ---- Four children: two on rung 1, one on rung 2, one with NO level ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active, level_id)
VALUES
  -- Graded 90 days ago at the TOP grade on both skills: looks done, is stale.
  ('12200000-0000-0000-0000-000000000001'::uuid,'Assess Stale Child',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE,
   '12000000-0000-0000-0000-000000000001'::uuid),
  -- Graded today on one skill: fresh, half done.
  ('12200000-0000-0000-0000-000000000002'::uuid,'Assess Fresh Child',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE,
   '12000000-0000-0000-0000-000000000001'::uuid),
  -- On the second rung, ungraded — proves the grid splits by level.
  ('12200000-0000-0000-0000-000000000003'::uuid,'Assess Second Level Child',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE,
   '12000000-0000-0000-0000-000000000002'::uuid),
  -- ⚠ No level at all. Must NOT read as assessed.
  ('12200000-0000-0000-0000-000000000004'::uuid,'Assess Unlevelled Child',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---- All four onto the seed's active Saturday class ----
-- ⚠ NEVER HARDCODE THE SEED CLASS'S ID. `supabase/seed.sql`'s classes INSERT
-- names no `id`, so Postgres mints a FRESH uuid on every `db reset`. This block
-- held a literal '2ce0a523-…' captured from the one database the fixture was
-- authored against: it loaded there forever and failed on the first reset,
-- with `cross-tenant enrolment refused: … class … is in tenant <NULL>` — a
-- message that reads like a tenancy bug and is really a missing row. §7.224.
-- Resolve by title; the ORDER BY is load-bearing (an unordered LIMIT 1 is §7.73).
DO $$
DECLARE
  v_class uuid;
BEGIN
  SELECT id INTO v_class FROM classes
   WHERE title = 'Saturday Beginners' ORDER BY created_at, id LIMIT 1;
  IF v_class IS NULL THEN
    RAISE EXCEPTION 'seed class "Saturday Beginners" is missing — is the database seeded?';
  END IF;

  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  SELECT v.student_id, v_class, TRUE
    FROM (VALUES
      ('12200000-0000-0000-0000-000000000001'::uuid),
      ('12200000-0000-0000-0000-000000000002'::uuid),
      ('12200000-0000-0000-0000-000000000003'::uuid),
      ('12200000-0000-0000-0000-000000000004'::uuid)
    ) AS v(student_id)
   WHERE NOT EXISTS (
     SELECT 1 FROM student_class_enrolments e
      WHERE e.student_id = v.student_id
        AND e.class_id = v_class
   );
END $$;

-- ---- Grades ----
-- The stale child at the TOP rank on BOTH skills, so "looks finished" is real:
-- if freshness were ignored they would show 2/2 done AND be offered a promotion.
INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
SELECT '70000000-0000-0000-0000-000000000001'::uuid,
       '12200000-0000-0000-0000-000000000001'::uuid, v.skill_id,
       (SELECT id FROM skill_grade_levels
         WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
         ORDER BY rank DESC LIMIT 1)
  FROM (VALUES
    ('12100000-0000-0000-0000-000000000001'::uuid),
    ('12100000-0000-0000-0000-000000000002'::uuid)
  ) AS v(skill_id)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_skill_progress p
    WHERE p.student_id = '12200000-0000-0000-0000-000000000001'::uuid
      AND p.skill_id = v.skill_id
 );

-- The fresh child on ONE skill only, at the LOWEST rank — so the row reads
-- 1/2 this round and cannot be confused with the stale child's full row.
INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
SELECT '70000000-0000-0000-0000-000000000001'::uuid,
       '12200000-0000-0000-0000-000000000002'::uuid,
       '12100000-0000-0000-0000-000000000001'::uuid,
       (SELECT id FROM skill_grade_levels
         WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
         ORDER BY rank ASC LIMIT 1)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_skill_progress p
    WHERE p.student_id = '12200000-0000-0000-0000-000000000002'::uuid
      AND p.skill_id = '12100000-0000-0000-0000-000000000001'::uuid
 );

-- ⚠ Backdate the stale child under a DISABLED trigger — see the header. A plain
-- UPDATE is clobbered to NOW() by trg_skill_progress_tenant and the fixture
-- would then assert nothing.
ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
UPDATE student_skill_progress
   SET graded_at = NOW() - interval '90 days'
 WHERE student_id = '12200000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;

-- The fresh child's grade is stamped NOW() by the trigger already, so it needs
-- no adjustment — it is genuinely from today.

SELECT s.full_name,
       COALESCE(l.label, '(no level)')                    AS level,
       count(p.id)                                        AS graded,
       count(p.id) FILTER (WHERE p.graded_at >= CURRENT_DATE) AS graded_today
  FROM students s
  LEFT JOIN tenant_levels l ON l.id = s.level_id
  LEFT JOIN student_skill_progress p ON p.student_id = s.id
 WHERE s.full_name LIKE 'Assess %'
 GROUP BY s.full_name, l.label
 ORDER BY s.full_name;
