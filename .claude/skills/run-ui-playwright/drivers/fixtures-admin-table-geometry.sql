-- Fixture for verify-admin-table-geometry.mjs — one row in every admin table.
--
-- WHY IT EXISTS, AND THE NUMBER THAT JUSTIFIES IT. That driver measures each
-- <th>'s rect against its column's <td>, because the Levels table once shipped
-- with its header row nested inside another row and every TEXT assertion still
-- passed (§7.54). But a table with no body row has no column to be misaligned
-- against, so an empty page is SKIPPED — and measured on 2026-08-09, the bare
-- seed leaves **ten of sixteen** admin tables empty. Without this fixture the
-- nightly sweep would report green while checking six pages and silently
-- skipping ten. A skip is a gap in coverage, not a clean bill of health.
--
-- ⚠ SHARED STACK. Namespaced 'AdmGeo', UUID prefix a6000000-, guarded inserts.
-- Do NOT add a TRUNCATE and do NOT run `supabase db reset` — one Postgres
-- serves every worktree on the machine (§7.55).
-- Teardown: fixtures-admin-table-geometry-teardown.sql.
--
-- ⚠ IT SEEDS A LEVEL, SO IT IS INCOMPATIBLE WITH verify-levels.mjs BY DESIGN.
-- That driver asserts the business has NO ladder. Loading both is a
-- precondition violation, and verify-levels now FAILS loudly naming the
-- offending fixture rather than deleting it. run-all-drivers.sh resets between
-- drivers and loads one fixture each, so the nightly never sees both.
--
-- ⚠ THE LESSON DATE IS COMPUTED, NEVER HARD-CODED — and the reason is WORSE
-- than "it would fail to load". The attendance-window triggers (§8.15) short-
-- circuit on `current_user <> 'authenticated'`, and every loader here runs as
-- `postgres`, so a rotted literal date would load CLEANLY and simply describe
-- a lesson outside the markable window: the admin screens would render it, the
-- coach's could not mark it, and nothing would say why (§7.73's calendar rot,
-- with no error to read). The date below is derived as "the most recent lesson
-- weekday still inside the window", from today_sg() — never CURRENT_DATE,
-- which is the session's zone and is UTC here (§7.94).

DO $$
DECLARE
  v_tenant   UUID;
  v_class    UUID := 'a6000000-0000-0000-0000-0000000000c0'::uuid;
  v_title    TEXT := 'AdmGeo Saturday Squad';
  v_dow      TEXT := 'saturday';
  v_dow_num  INT;
  v_date     DATE;
  v_parent   UUID;
  v_coach    UUID;   -- coaches.id, for classes.coach_id
  v_coach_pr UUID;   -- profiles.id, for attendance.marked_by
  v_cat      UUID;
  v_month    CHAR(7);
BEGIN
  -- ⚠ THIS FIXTURE OWNS ITS CLASS, AND THAT IS NOT TIDINESS.
  -- It first reused the seed's 'Saturday Beginners' and put a lesson on the
  -- most recent Saturday — which is exactly what fixtures-parent-claim.sql
  -- does, so `lesson_sessions_class_id_session_date_key` blew up the moment
  -- the two were stacked. check-fixture-roundtrip.sh pass 2 caught it before
  -- it ever reached CI. Same remedy as §8.22: own the class, and no sibling
  -- can collide with you on (class_id, session_date).
  -- ⚠ THE TENANT COMES FROM THE SEED CLASS, AND EVERY OTHER LOOKUP IS SCOPED
  -- TO IT. This was `SELECT id, tenant_id FROM coaches LIMIT 1` — an UNORDERED
  -- LIMIT 1, the exact trap §7.73 and §8.22 are about. Stacked behind a fixture
  -- that creates its own coach (phase4-billing's 'Harbour Swim Club',
  -- trial-onboarding's), it picked a coach in ANOTHER business: this fixture's
  -- class, children and lesson then landed in that tenant, and that tenant's
  -- own teardown could no longer delete its rows. Caught by
  -- check-fixture-roundtrip.sh pass 2 on 2026-08-09 — the unwind failed and
  -- left six tables dirty, while every fixture still "loaded fine".
  SELECT tenant_id INTO v_tenant FROM classes
   WHERE title = 'Saturday Beginners' ORDER BY created_at, id LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'seed class "Saturday Beginners" is missing — is the database seeded?';
  END IF;

  SELECT id, profile_id INTO v_coach, v_coach_pr
    FROM coaches WHERE tenant_id = v_tenant ORDER BY id LIMIT 1;
  IF v_coach IS NULL THEN
    RAISE EXCEPTION 'no coach in the seed tenant % — is the database seeded?', v_tenant;
  END IF;

  SELECT id INTO v_cat FROM class_categories
   WHERE tenant_id = v_tenant ORDER BY name, id LIMIT 1;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'no class category for tenant % — categories are mandatory since §8.11', v_tenant;
  END IF;

  -- The location the class sits at (contract: classes.location_id FK), in v_tenant.
  INSERT INTO locations (id, tenant_id, name)
  VALUES ('a6000000-0000-0000-0000-0000000010c1', v_tenant, 'AdmGeo Pool')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                       location_id, price_per_lesson, is_active, tenant_id, category_id)
  VALUES (v_class, v_coach, v_title, v_dow::day_of_week, '14:00', '15:00',
          'a6000000-0000-0000-0000-0000000010c1', 40.00, TRUE, v_tenant, v_cat)
  ON CONFLICT (id) DO NOTHING;

  v_dow_num := CASE v_dow
    WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday'  THEN 2
    WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
    WHEN 'saturday' THEN 6 END;

  SELECT max(d::date) INTO v_date
    FROM generate_series(markable_floor(v_tenant)::timestamp,
                         today_sg()::timestamp, interval '1 day') d
   WHERE EXTRACT(DOW FROM d) = v_dow_num;

  IF v_date IS NULL THEN
    RAISE EXCEPTION
      'no % fell between the marking floor (%) and today (%) — the window is '
      'shorter than a week, which should be impossible; check markable_floor()',
      v_dow, markable_floor(v_tenant), today_sg();
  END IF;

  -- ⚠ FOUR MONTHS BACK, DELIBERATELY, AND NOT "LAST MONTH".
  -- fixtures-trial-onboarding-teardown.sql deletes EVERY invoice and
  -- invoice_item in this tenant for ITS billing month — rows it does not own —
  -- and this is the first fixture ever to hold a credit note against one, so
  -- that over-broad DELETE now hits `credit_notes_invoice_item_id_fkey` and
  -- the whole unwind fails. Standing clear of it is the cheap half of the fix;
  -- the sibling's teardown is over-broad regardless — it deletes rows it does
  -- not own, which is the one thing check-fixture-roundtrip.sh pass 2 exists to
  -- forbid — and fixing it is its own change, not this one's.
  -- Computed, never hard-coded — a literal month rots (§7.73). The /invoices
  -- page filters by STATUS only (no month filter), so an older month renders.
  v_month := to_char((today_sg() - interval '4 months'), 'YYYY-MM');

  -- ── A parent (the auth trigger creates profiles + parents) ───────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000','a6000000-0000-0000-0000-0000000000b1',
    'authenticated','authenticated','admgeo-parent@test.local',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email"}', '{"full_name":"AdmGeo Parent","role":"parent"}', now(), now(),
    '','','','')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_parent FROM parents
   WHERE profile_id = 'a6000000-0000-0000-0000-0000000000b1';
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'handle_new_user did not create a parents row for the AdmGeo parent';
  END IF;

  INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (v_parent, v_tenant)
    ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  -- ── Students: one enrolled, one unassigned ───────────────────────────────
  -- The unassigned one is not decoration: /unassigned renders ONLY children
  -- with assignment_status = 'unassigned', so without it that page is empty
  -- and skipped.
  INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, is_active)
  VALUES
    ('a6000000-0000-0000-0000-0000000000a1'::uuid, 'AdmGeo Enrolled Child',
     '2018-05-04', 'assigned',   v_tenant, TRUE),
    ('a6000000-0000-0000-0000-0000000000a2'::uuid, 'AdmGeo Waiting Child',
     '2019-09-21', 'unassigned', v_tenant, TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id) VALUES
    (v_parent, 'a6000000-0000-0000-0000-0000000000a1'::uuid),
    (v_parent, 'a6000000-0000-0000-0000-0000000000a2'::uuid)
  ON CONFLICT DO NOTHING;

  -- ⚠ ENROLLED ON THE LESSON DATE, NOT AT THE MARKING FLOOR.
  -- Back-dating to markable_floor() looked harmless and was not: the engine
  -- derives expected lessons from the class weekday across the enrolment span
  -- (core.ts expectedLessonDates), and ANY unmarked expected date stops a
  -- billing run outright, with no override by design. A floor-dated enrolment
  -- on a weekly class invents ~4 unmarked lessons and leaves the SEED TENANT
  -- unbillable for as long as this fixture is loaded. The nightly resets per
  -- driver so it never saw this; the shared dev database (§7.55) is where it
  -- would have bitten. Enrolling on the one lesson this fixture actually marks
  -- means expected == marked.
  INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
  VALUES ('a6000000-0000-0000-0000-0000000000a1'::uuid, v_class,
          v_date::timestamptz, TRUE)
  ON CONFLICT DO NOTHING;

  -- ── A level ladder ───────────────────────────────────────────────────────
  INSERT INTO tenant_levels (id, tenant_id, label, sort_order) VALUES
    ('a6000000-0000-0000-0000-0000000000c1'::uuid, v_tenant, 'AdmGeo Starter', 1),
    ('a6000000-0000-0000-0000-0000000000c2'::uuid, v_tenant, 'AdmGeo Improver', 2)
  ON CONFLICT (id) DO NOTHING;

  UPDATE students SET level_id = 'a6000000-0000-0000-0000-0000000000c1'::uuid
   WHERE id = 'a6000000-0000-0000-0000-0000000000a1'::uuid;

  -- ── A package product and a confirmed purchase ───────────────────────────
  INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson,
                                validity_months, is_active)
  VALUES ('a6000000-0000-0000-0000-0000000000d1'::uuid, v_tenant,
          'AdmGeo 10-lesson pack', 10, 40.00, 6, TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, name, lesson_count,
                               rate_per_lesson, total_value, validity_months,
                               value_remaining, status, confirmed_at, expires_on)
  VALUES ('a6000000-0000-0000-0000-0000000000d2'::uuid, v_tenant, v_parent,
          'a6000000-0000-0000-0000-0000000000d1'::uuid, 'AdmGeo 10-lesson pack',
          10, 40.00, 400.00, 6, 400.00, 'active', now(),
          (today_sg() + interval '6 months')::date)
  ON CONFLICT (id) DO NOTHING;

  -- ── A marked lesson (date computed above — see the header) ───────────────
  INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time, status)
  SELECT 'a6000000-0000-0000-0000-0000000000e1'::uuid, v_class, v_date,
         c.start_time, c.end_time, 'completed'
    FROM classes c WHERE c.id = v_class
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_by)
  VALUES ('a6000000-0000-0000-0000-0000000000e2'::uuid,
          'a6000000-0000-0000-0000-0000000000e1'::uuid,
          'a6000000-0000-0000-0000-0000000000a1'::uuid, 'present', v_coach_pr)
  ON CONFLICT (id) DO NOTHING;

  -- ── An invoice, its line item, and a credit note against that line ───────
  -- Written directly rather than generated: the engine seals a billing month
  -- when it completes (§7.15), and a fixture must never do that to a shared
  -- database.
  INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                        net_amount, status, reference_number, public_token)
  VALUES ('a6000000-0000-0000-0000-0000000000f1'::uuid, v_parent, v_tenant, v_month,
          40.00, 40.00, 'outstanding', 'INV-' || left(v_month, 4) || '-9801',
          'a6000000admgeo00a6000000admgeo00')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                             attendance_status, amount, class_title, session_date,
                             student_name)
  VALUES ('a6000000-0000-0000-0000-0000000000f2'::uuid,
          'a6000000-0000-0000-0000-0000000000f1'::uuid,
          'a6000000-0000-0000-0000-0000000000a1'::uuid,
          'a6000000-0000-0000-0000-0000000000e1'::uuid,
          'present', 40.00, v_title, v_date, 'AdmGeo Enrolled Child')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO credit_notes (id, reference_number, parent_id, student_id, invoice_id,
                            invoice_item_id, lesson_session_id, amount,
                            original_status, corrected_status, reason, tenant_id,
                            student_name)
  VALUES ('a6000000-0000-0000-0000-0000000000fa'::uuid,
          'CN-' || left(v_month, 4) || '-9801', v_parent,
          'a6000000-0000-0000-0000-0000000000a1'::uuid,
          'a6000000-0000-0000-0000-0000000000f1'::uuid,
          'a6000000-0000-0000-0000-0000000000f2'::uuid,
          'a6000000-0000-0000-0000-0000000000e1'::uuid,
          40.00, 'present', 'cancelled_rain',
          'AdmGeo fixture — geometry sweep only', v_tenant, 'AdmGeo Enrolled Child')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'AdmGeo fixture: lesson date %, billing month %', v_date, v_month;
END $$;

-- Expected: students 2, levels 2, and 1 for each of the rest.
-- (Two students because /unassigned needs one that is NOT enrolled; two
-- levels so the ladder has an order to render.)
SELECT (SELECT count(*) FROM students        WHERE full_name LIKE 'AdmGeo %') AS students,
       (SELECT count(*) FROM tenant_levels   WHERE label     LIKE 'AdmGeo %') AS levels,
       (SELECT count(*) FROM package_products WHERE name     LIKE 'AdmGeo %') AS products,
       (SELECT count(*) FROM parent_packages WHERE name      LIKE 'AdmGeo %') AS packages,
       (SELECT count(*) FROM attendance      WHERE id = 'a6000000-0000-0000-0000-0000000000e2'::uuid) AS attendance,
       (SELECT count(*) FROM invoices        WHERE id = 'a6000000-0000-0000-0000-0000000000f1'::uuid) AS invoices,
       (SELECT count(*) FROM credit_notes    WHERE id = 'a6000000-0000-0000-0000-0000000000fa'::uuid) AS credit_notes;
