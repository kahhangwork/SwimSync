-- Hand-check fixture for docs/refactor/coach-schedule-handchecks.mjs, applied ON TOP of
-- fixtures-coach-roster.sql (COACH_SCHEDULE_REFACTOR_PLAN.md, Stages 3–5).
\set ON_ERROR_STOP on
-- TODAY's lesson of RosterCov Lane (class a) with roster-sub as its substitute:
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('c7000000-0000-0000-0000-0000000000e9','c7000000-0000-0000-0000-00000000000a',
        (now() AT TIME ZONE 'Asia/Singapore')::date, 'scheduled')
ON CONFLICT (id) DO NOTHING;
INSERT INTO session_coaches (lesson_session_id, coach_id)
SELECT 'c7000000-0000-0000-0000-0000000000e9', c.id FROM coaches c
 WHERE c.profile_id = 'c7000000-0000-0000-0000-000000000001';
-- roster-shadow shadows RosterCov Second (class b), active today:
INSERT INTO class_shadow_coaches (class_id, coach_id, effective_from)
SELECT 'c7000000-0000-0000-0000-00000000000b', c.id, (now() AT TIME ZONE 'Asia/Singapore')::date - 30
  FROM coaches c WHERE c.profile_id = 'c7000000-0000-0000-0000-000000000002';
SELECT 'hc fixture ok';
