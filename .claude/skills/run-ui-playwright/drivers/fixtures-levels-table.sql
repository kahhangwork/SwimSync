-- Fixture for verify-levels-table.mjs — the Swimming Levels table's column
-- geometry.
--
-- ⚠ THE LABELS ARE LONG ON PURPOSE. Two short rungs can align perfectly while
-- production's real ladder still pushes columns around: the page in the bug
-- report has 'SwimSafer Silver' beside '5 skills' beside two buttons. A
-- fixture that seeds 'A' and 'B' would prove the header sits above the data
-- and nothing about whether the table survives real content. So this mirrors
-- the shape of the live ladder — a long label, a multi-skill rung, a
-- single-skill rung, and non-zero student counts.
--
-- ⚠ SHARED STACK. Namespaced 'LvlTbl', fixed UUIDs, guarded inserts. Do NOT
-- add a TRUNCATE and do NOT run `supabase db reset` — other worktrees are on
-- this database. Teardown: fixtures-levels-table-teardown.sql.
--
-- Idempotency note: tenant_levels' uniqueness is an EXPRESSION index
-- (tenant_id, lower(trim(label))), which `ON CONFLICT (tenant_id, label)` does
-- not match — Postgres rejects the statement outright. Conflict on the primary
-- key instead. See `docs/GOTCHAS.md` §7.53 for the partial-index version of this trap.

-- ---- Three rungs, mirroring the live ladder's shape ----
INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid,
   '70000000-0000-0000-0000-000000000001', 'LvlTbl SwimSafer Silver', 1),
  ('11000000-0000-0000-0000-000000000002'::uuid,
   '70000000-0000-0000-0000-000000000001', 'LvlTbl SwimSafer Gold', 2),
  ('11000000-0000-0000-0000-000000000003'::uuid,
   '70000000-0000-0000-0000-000000000001', 'LvlTbl FrontCrawl', 3)
ON CONFLICT (id) DO NOTHING;

-- ---- Skills: 5 on the first rung, 1 on the second, none on the third ----
-- The three states the Skills cell can render ("5 skills", "1 skill",
-- "Add skills"), so the column is measured against its widest realistic
-- content rather than its narrowest.
INSERT INTO tenant_level_skills (level_id, label, sort_order)
SELECT v.level_id, v.label, v.sort_order
  FROM (VALUES
    ('11000000-0000-0000-0000-000000000001'::uuid, 'LvlTbl Float unaided',      1),
    ('11000000-0000-0000-0000-000000000001'::uuid, 'LvlTbl Glide 5 metres',     2),
    ('11000000-0000-0000-0000-000000000001'::uuid, 'LvlTbl Rotate to breathe',  3),
    ('11000000-0000-0000-0000-000000000001'::uuid, 'LvlTbl Tread water 30s',    4),
    ('11000000-0000-0000-0000-000000000001'::uuid, 'LvlTbl Enter and exit',     5),
    ('11000000-0000-0000-0000-000000000002'::uuid, 'LvlTbl Survival backstroke',1)
  ) AS v(level_id, label, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM tenant_level_skills s
    WHERE s.level_id = v.level_id AND s.label = v.label
 );

-- ---- Students, so the Students column is not uniformly "0" ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active, level_id)
VALUES
  ('11000000-0000-0000-0000-0000000000a1'::uuid,'LvlTbl Child One',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE,
   '11000000-0000-0000-0000-000000000001'::uuid),
  ('11000000-0000-0000-0000-0000000000a2'::uuid,'LvlTbl Child Two',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE,
   '11000000-0000-0000-0000-000000000001'::uuid),
  ('11000000-0000-0000-0000-0000000000a3'::uuid,'LvlTbl Child Three',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE,
   '11000000-0000-0000-0000-000000000002'::uuid)
ON CONFLICT (id) DO NOTHING;

SELECT l.sort_order, l.label,
       (SELECT count(*) FROM tenant_level_skills s WHERE s.level_id = l.id) AS skills,
       (SELECT count(*) FROM students st WHERE st.level_id = l.id)          AS students
  FROM tenant_levels l
 WHERE l.label LIKE 'LvlTbl %'
 ORDER BY l.sort_order;
