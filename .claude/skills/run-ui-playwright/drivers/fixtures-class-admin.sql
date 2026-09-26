-- Fixture for verify-class-admin.mjs — the Classes-page shadow-coach actions no
-- other driver presses (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U7).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-class-admin.sql
--
-- ITS OWN BUSINESS ("ClsAdm Swim", prefix d4000000-). Ending a shadow changes
-- PAY for every lesson after the end date, and shadow rates are per coach — on
-- the seed tenant that would move what verify-coach-roster / the wages drivers
-- read (plan rule 12). Everything here is owned.
--
-- The shapes, each for one check:
--   ClsAdm Owner    tenant admin (also coaches) — the login, and the class's
--                   own coach (so never offered as its shadow).
--   ClsAdm Shadow   staff coach with a teaching AND a shadow rate (both 60
--                   days old), an ONGOING shadow on ClsAdm Squad from 14 days
--                   ago, and an EARLIER assignment that already ended — the
--                   history row the drawer must show, not hide. The driver
--                   presses End on the ongoing one.
--   ClsAdm Norate   staff coach with a TEACHING rate only — "has a rate
--                   somewhere" is the wrong question, so picking them must
--                   warn "no shadow rate yet".
--   ClsAdm Late     staff coach whose shadow rate starts 30 days from today —
--                   picking them warns "only starts on …" until the
--                   assignment's own start date reaches the rate's.
--   ClsAdm Squad    one Wednesday class taught by the owner. No lessons, no
--                   children, no invoices: the drawer's shadow section is the
--                   only thing under test.
--
-- All dates are relative to today_sg() (§7.225) — the driver asks the DB for them.
--
-- IDEMPOTENT AND RESETTING: re-loading undoes the one write the driver makes
-- (End: effective_to / ended_by / ended_at on the ongoing row) and deletes any
-- other assignment on the class, so a re-run without `supabase db reset`
-- starts from the same state.
-- Teardown: fixtures-class-admin-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('d4000000-0000-0000-0000-000000000001','class-admin','ClsAdm Swim','SWIM-CLSA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','class-admin-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"ClsAdm Owner","role":"tenant_admin","is_coach":true,"tenant_id":"d4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000a2',
  'authenticated','authenticated','class-admin-shadow@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"ClsAdm Shadow","role":"coach","tenant_id":"d4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000a3',
  'authenticated','authenticated','class-admin-norate@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"ClsAdm Norate","role":"coach","tenant_id":"d4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000a4',
  'authenticated','authenticated','class-admin-late@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"ClsAdm Late","role":"coach","tenant_id":"d4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

UPDATE tenants SET owner_profile_id = 'd4000000-0000-0000-0000-0000000000a1'
 WHERE id = 'd4000000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'd4000000-0000-0000-0000-0000000000a1';

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('d4000000-0000-0000-0000-00000000cc01','d4000000-0000-0000-0000-000000000001','ClsAdm Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('d4000000-0000-0000-0000-0000000010c1','d4000000-0000-0000-0000-000000000001','ClsAdm Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
-- Any assignment on the class the fixture did not write (a hand-pressed Add).
DELETE FROM class_shadow_coaches
 WHERE class_id = 'd4000000-0000-0000-0000-0000000000c1'
   AND id NOT IN ('d4000000-0000-0000-0000-0000000005a1','d4000000-0000-0000-0000-0000000005a2');
DELETE FROM coach_rates WHERE coach_id IN
  (SELECT id FROM coaches WHERE profile_id::text LIKE 'd4000000-%')
  AND id NOT IN ('d4000000-0000-0000-0000-0000000003a1','d4000000-0000-0000-0000-0000000003a2',
                 'd4000000-0000-0000-0000-0000000003a3','d4000000-0000-0000-0000-0000000003a4');

-- ── Everything keyed on a random coaches.id ─────────────────────────────────
DO $$
DECLARE
  t       CONSTANT uuid := 'd4000000-0000-0000-0000-000000000001';
  v_owner uuid;
  v_sh    uuid;
  v_nr    uuid;
  v_late  uuid;
  v_sg    date := today_sg();
BEGIN
  SELECT id INTO v_owner FROM coaches WHERE profile_id = 'd4000000-0000-0000-0000-0000000000a1';
  SELECT id INTO v_sh    FROM coaches WHERE profile_id = 'd4000000-0000-0000-0000-0000000000a2';
  SELECT id INTO v_nr    FROM coaches WHERE profile_id = 'd4000000-0000-0000-0000-0000000000a3';
  SELECT id INTO v_late  FROM coaches WHERE profile_id = 'd4000000-0000-0000-0000-0000000000a4';
  IF v_owner IS NULL OR v_sh IS NULL OR v_nr IS NULL OR v_late IS NULL THEN
    RAISE EXCEPTION 'fixture: coach rows were not created by the auth trigger';
  END IF;

  -- Rates. Shadow: teaching + shadow, 60 days old. Norate: teaching ONLY.
  -- Late: a shadow rate that starts 30 days from today. Dates re-asserted.
  INSERT INTO coach_rates (id, coach_id, amount, unit_minutes, effective_from, role)
  VALUES ('d4000000-0000-0000-0000-0000000003a1', v_sh,   40.00, 60, v_sg - 60, 'main'),
         ('d4000000-0000-0000-0000-0000000003a2', v_sh,   15.00, 60, v_sg - 60, 'shadow'),
         ('d4000000-0000-0000-0000-0000000003a3', v_nr,   40.00, 60, v_sg - 60, 'main'),
         ('d4000000-0000-0000-0000-0000000003a4', v_late, 15.00, 60, v_sg + 30, 'shadow')
  ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, unit_minutes = EXCLUDED.unit_minutes,
                                 effective_from = EXCLUDED.effective_from, role = EXCLUDED.role;

  INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                       end_time, location_id, price_per_lesson, category_id, is_active)
  VALUES ('d4000000-0000-0000-0000-0000000000c1', t, v_owner, 'ClsAdm Squad',
          'wednesday', '10:00', '11:00', 'd4000000-0000-0000-0000-0000000010c1', 40.00,
          'd4000000-0000-0000-0000-00000000cc01', TRUE)
  ON CONFLICT (id) DO UPDATE SET coach_id = EXCLUDED.coach_id, is_active = TRUE,
                                 deactivated_at = NULL;

  -- The ENDED history row (120 → 60 days ago), then the ONGOING one (14 days
  -- ago → open). Both reset on every load: End stamps the ongoing row.
  INSERT INTO class_shadow_coaches (id, tenant_id, class_id, coach_id, effective_from,
                                    effective_to, assigned_by, ended_by, ended_at)
  VALUES ('d4000000-0000-0000-0000-0000000005a1', t, 'd4000000-0000-0000-0000-0000000000c1',
          v_sh, v_sg - 120, v_sg - 60, 'd4000000-0000-0000-0000-0000000000a1',
          'd4000000-0000-0000-0000-0000000000a1', now()),
         ('d4000000-0000-0000-0000-0000000005a2', t, 'd4000000-0000-0000-0000-0000000000c1',
          v_sh, v_sg - 14, NULL, 'd4000000-0000-0000-0000-0000000000a1', NULL, NULL)
  ON CONFLICT (id) DO UPDATE SET effective_from = EXCLUDED.effective_from,
                                 effective_to = EXCLUDED.effective_to,
                                 ended_by = EXCLUDED.ended_by,
                                 ended_at = EXCLUDED.ended_at;
END $$;

-- ── Postconditions — fail at load time, not ten checks later ───────────────
DO $$
DECLARE v_rows int; v_open int; v_from date; v_shadow_rates int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE effective_to IS NULL),
         max(effective_from) FILTER (WHERE effective_to IS NULL)
    INTO v_rows, v_open, v_from
    FROM class_shadow_coaches WHERE class_id = 'd4000000-0000-0000-0000-0000000000c1';
  SELECT count(*) INTO v_shadow_rates
    FROM coach_rates r JOIN coaches c ON c.id = r.coach_id
   WHERE c.profile_id = 'd4000000-0000-0000-0000-0000000000a3' AND r.role = 'shadow';
  IF v_rows <> 2 OR v_open <> 1 OR v_from > today_sg() - 7 OR v_shadow_rates <> 0 THEN
    RAISE EXCEPTION 'fixture: expected 2 assignments / 1 ongoing from ≥7 days ago / Norate 0 shadow rates, got % / % / % / %',
      v_rows, v_open, v_from, v_shadow_rates;
  END IF;
END $$;

COMMIT;
