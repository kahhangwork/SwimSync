-- Fixture for verify-tenant-suspension.mjs — Wave 5 chunk 3 (20260813000300).
--
-- ⚠ THE DRIVER SUSPENDS A FIXTURE TENANT, NEVER THE SEED ONE (⚠ RISK 9): a
-- suspended seed tenant breaks every sibling driver that logs in as its
-- staff. The driver's finally-block AND the teardown both unsuspend, so a
-- crashed run cannot leave the (fixture) tenant dark either.
--
-- What the driver needs:
--   SuspendCov School (fixture tenant) — the tenant to suspend:
--     ts-admin@swimsync.test   its owner-admin. Login must DIE on suspend and
--                              RETURN on unsuspend.
--     ts-coach@swimsync.test   a pure coach, INDIVIDUALLY DISABLED (and
--                              banned) BEFORE the suspension — the ⚠ RISK 3
--                              subject: the unsuspend must NOT resurrect
--                              them. The ban is written here directly, the
--                              same auth-layer state /api/disable-coach
--                              leaves behind.
--   ts-parent@swimsync.test    a TWO-TENANT parent: one child in the fixture
--                              tenant ("SuspendCov Gone Kid"), one in the
--                              SEED tenant ("SuspendCov Keep Kid"). Parents
--                              are never banned; after the suspend they must
--                              still see Keep Kid and no longer see Gone Kid.
--
-- Idempotent per fixture protocol. The DRIVER is re-runnable after the
-- teardown (it unsuspends on its way out, but the unbans and audit rows need
-- the teardown).
--
-- Load (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-tenant-suspension.sql

\set ON_ERROR_STOP on

CREATE TEMP TABLE tsx AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT
  today,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  )[EXTRACT(DOW FROM today)::int + 1]::day_of_week AS class_dow
FROM t;

-- ── The tenant to suspend ───────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('e6aa0000-0000-0000-0000-000000000001','suspendcov','SuspendCov School','SWIM-TSCV')
ON CONFLICT (id) DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('e6aa0000-0000-0000-0000-00000000cc01',
        'e6aa0000-0000-0000-0000-000000000001','Default Group')
ON CONFLICT (id) DO NOTHING;

-- ── The people ──────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000','e6aa0000-0000-0000-0000-000000000001',
   'authenticated','authenticated','ts-admin@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"SuspendCov Admin","role":"tenant_admin","tenant_id":"e6aa0000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e6aa0000-0000-0000-0000-000000000002',
   'authenticated','authenticated','ts-coach@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"SuspendCov Coach","role":"coach","tenant_id":"e6aa0000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e6aa0000-0000-0000-0000-000000000003',
   'authenticated','authenticated','ts-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"SuspendCov Parent"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- The fixture tenant was created directly above, so handle_new_user's
-- first-admin ownership claim may or may not have fired depending on
-- insertion order across re-runs — pin it.
UPDATE tenants SET owner_profile_id = 'e6aa0000-0000-0000-0000-000000000001'
 WHERE id = 'e6aa0000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'e6aa0000-0000-0000-0000-000000000001';

-- ── The ⚠ RISK 3 subject: ts-coach individually disabled AND banned ─────────
-- The same end-state /api/disable-coach leaves: coaches.disabled_at set (the
-- RLS half) and the auth account banned (the login half). Written directly —
-- postgres passes the coaches guard, exactly as the SECURITY DEFINER RPC does.
UPDATE coaches SET disabled_at = COALESCE(disabled_at, NOW())
 WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000002';
UPDATE auth.users SET banned_until = NOW() + INTERVAL '100 years'
 WHERE id = 'e6aa0000-0000-0000-0000-000000000002'
   AND (banned_until IS NULL OR banned_until <= NOW());

-- ── One class + child per tenant for the parent ─────────────────────────────
-- The fixture-tenant class keeps the disabled coach as its (historical)
-- coach — visibility for the parent flows through the child's enrolment, not
-- the coach. The seed-tenant class borrows the seed coach, same as
-- fixtures-coach-disable adds classes to the seed tenant.
-- A location per tenant these classes span (contract: classes.location_id FK):
-- one in the suspended tenant, one in the seed tenant the Keep Lane lives in.
INSERT INTO locations (id, tenant_id, name) VALUES
  ('e6aa0000-0000-0000-0000-0000000010c1','e6aa0000-0000-0000-0000-000000000001','SuspendCov Gone Pool'),
  ('e6aa0000-0000-0000-0000-0000000010c2','70000000-0000-0000-0000-000000000001','SuspendCov Keep Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_id, price_per_lesson, category_id, tenant_id, is_active
)
SELECT v.id, co.id, v.title, tsx.class_dow, v.st::time, v.et::time,
       v.loc, 40.00, v.cat, v.tenant, TRUE
  FROM tsx,
       (VALUES
         ('e6aa0000-0000-0000-0000-0000000000aa'::uuid,'SuspendCov Gone Lane',
          'e6aa0000-0000-0000-0000-000000000002'::uuid,
          'e6aa0000-0000-0000-0000-00000000cc01'::uuid,
          'e6aa0000-0000-0000-0000-000000000001'::uuid,
          'e6aa0000-0000-0000-0000-0000000010c1'::uuid,'14:00','15:00'),
         ('e6aa0000-0000-0000-0000-0000000000ab'::uuid,'SuspendCov Keep Lane',
          'c0000000-0000-0000-0000-000000000001'::uuid,
          '7c000000-0000-0000-0000-000000000002'::uuid,
          '70000000-0000-0000-0000-000000000001'::uuid,
          'e6aa0000-0000-0000-0000-0000000010c2'::uuid,'16:30','17:30')
       ) AS v(id, title, coach_pid, cat, tenant, loc, st, et)
  JOIN coaches co ON co.profile_id = v.coach_pid
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES
  ('e6aa0000-0000-0000-0000-0000000000e1','SuspendCov Gone Kid','assigned', TRUE,
   'e6aa0000-0000-0000-0000-000000000001'),
  ('e6aa0000-0000-0000-0000-0000000000e2','SuspendCov Keep Kid','assigned', TRUE,
   '70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, v.sid
  FROM parents p,
       (VALUES ('e6aa0000-0000-0000-0000-0000000000e1'::uuid),
               ('e6aa0000-0000-0000-0000-0000000000e2'::uuid)) AS v(sid)
 WHERE p.profile_id = 'e6aa0000-0000-0000-0000-000000000003'
   AND NOT EXISTS (SELECT 1 FROM parent_students ps
                    WHERE ps.parent_id = p.id AND ps.student_id = v.sid);

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, v.tid
  FROM parents p,
       (VALUES ('e6aa0000-0000-0000-0000-000000000001'::uuid),
               ('70000000-0000-0000-0000-000000000001'::uuid)) AS v(tid)
 WHERE p.profile_id = 'e6aa0000-0000-0000-0000-000000000003'
   AND NOT EXISTS (SELECT 1 FROM parent_tenants pt
                    WHERE pt.parent_id = p.id AND pt.tenant_id = v.tid);

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
SELECT v.sid, v.cid, TRUE
  FROM (VALUES
    ('e6aa0000-0000-0000-0000-0000000000e1'::uuid,'e6aa0000-0000-0000-0000-0000000000aa'::uuid),
    ('e6aa0000-0000-0000-0000-0000000000e2'::uuid,'e6aa0000-0000-0000-0000-0000000000ab'::uuid)
  ) AS v(sid, cid)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_class_enrolments e
    WHERE e.student_id = v.sid AND e.class_id = v.cid);

-- ── Postconditions — fail at APPLY time, not twenty minutes later ───────────
DO $$
DECLARE
  v_susp TIMESTAMPTZ; v_dis INT; v_ban INT; v_memb INT; v_kids INT;
BEGIN
  SELECT suspended_at INTO v_susp FROM tenants
   WHERE id = 'e6aa0000-0000-0000-0000-000000000001';
  IF v_susp IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: SuspendCov School is ALREADY SUSPENDED — a '
                    'prior driver run crashed before its finally-block. Run '
                    'the teardown first (⚠ RISK 9).';
  END IF;

  SELECT count(*) INTO v_dis FROM coaches
   WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000002'
     AND disabled_at IS NOT NULL;
  SELECT count(*) INTO v_ban FROM auth.users
   WHERE id = 'e6aa0000-0000-0000-0000-000000000002'
     AND banned_until > NOW();
  IF v_dis <> 1 OR v_ban <> 1 THEN
    RAISE EXCEPTION 'fixture: ts-coach must be disabled (%) AND banned (%) '
                    'BEFORE the suspend — they are the ⚠ RISK 3 subject.',
                    v_dis, v_ban;
  END IF;

  SELECT count(*) INTO v_memb FROM parent_tenants pt
    JOIN parents p ON p.id = pt.parent_id
   WHERE p.profile_id = 'e6aa0000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_kids FROM parent_students ps
    JOIN parents p ON p.id = ps.parent_id
   WHERE p.profile_id = 'e6aa0000-0000-0000-0000-000000000003';
  IF v_memb <> 2 OR v_kids <> 2 THEN
    RAISE EXCEPTION 'fixture: the parent must span TWO tenants (memberships '
                    '%, children %) — the keep-the-other-business check '
                    'is vacuous otherwise.', v_memb, v_kids;
  END IF;
END $$;

SELECT today, class_dow FROM tsx;
