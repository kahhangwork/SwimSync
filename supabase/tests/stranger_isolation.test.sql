-- pgTAP: A SELF-REGISTERED STRANGER SEES NOTHING, ACROSS ALL 37 TABLES AT ONCE.
--
-- The persona none of the other isolation files covers. `tenant_isolation` and
-- `rls_isolation` probe tenant A against tenant B — two legitimate customers who
-- must not see each other. This one probes the person who is not a customer at
-- all: signup is open (`SwimSyncApp/app/(auth)/register.tsx` asks for a join
-- code afterwards, never at registration), so "any signed-in user" means anyone
-- on the internet with an email address. That is what an attacker actually is,
-- and until 2026-08-04 they could forge their way into a business and onto a
-- child (20260804000500).
--
-- WHY IT SWEEPS THE CATALOGUE INSTEAD OF NAMING TABLES. A named assertion
-- cannot fail for a table nobody thought to name — the same argument as
-- `function_grants.test.sql` and `table_grants.test.sql`. A table added next
-- month is swept on the day it is created, and if it leaks to a stranger this
-- file goes red without anyone remembering to extend it.
--
-- ── THE VACUITY PROBLEM, AND THE STRUCTURAL GUARD AGAINST IT ────────────────
-- "Sees zero rows" is the easiest assertion in the world to pass by accident:
-- an empty fixture passes it, a failed `SET LOCAL ROLE` passes it (§7.16), and
-- a typo'd `request.jwt.claims` passes it. So the stranger's counts are never
-- asserted alone. Assertion 1 pins what a LEGITIMATE MEMBER sees from the same
-- fixture, table by table — if the fixture stops populating something, that
-- assertion fails first and names it, rather than assertion 2 quietly getting
-- easier. The two are read together or not at all.
--
-- ── ON CLOCK ROT (§7.74) ────────────────────────────────────────────────────
-- The lesson is dated `today_sg()` and the class's weekday is DERIVED from that
-- same date, so the attendance-window trigger (§8.15) is satisfied on every day
-- this is ever run. Nothing here is a hardcoded date; a fixture that "worked in
-- August" is how the attendance-window driver rotted to 2/5.
--
-- PROVEN RED (§7.25). Restoring `parent_students_insert` with its grant and
-- letting the stranger forge one link takes assertion 2 red, reading:
--
--   attendance:1, classes:1, lesson_sessions:1, parent_students:1, parents:1,
--   profiles:1, student_class_enrolments:1, students:1
--
-- Six tables beyond their own two, from a single forged row — the child, their
-- attendance history, their enrolment, the class and the lesson. That fan-out
-- is the argument for sweeping the catalogue rather than asserting on the one
-- or two tables the forgery obviously touches: `classes` and `lesson_sessions`
-- were not on the list when this comment was first drafted, and the sweep
-- found them.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- ── One business, fully populated, one real family, one stranger ────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('1b000000-0000-0000-0000-000000000001','stranger-school','Stranger Test School','SWIM-STRG');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','2b000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','strg-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Strg Admin","role":"tenant_admin","tenant_id":"1b000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','2b000000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','strg-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Strg Coach","role":"coach","tenant_id":"1b000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','2b000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','strg-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Real Parent","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','2b000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','strg-mallory@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Mallory Stranger","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('3b000000-0000-0000-0000-000000000001','1b000000-0000-0000-0000-000000000001','Default Group');

INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES ('3b000000-0000-0000-0000-000000000002','1b000000-0000-0000-0000-000000000001','Level 1', 1);

-- The class meets on WHATEVER DAY IT IS TODAY, so the lesson below always falls
-- inside the attendance window however far in the future this is run (§7.74).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT '3b000000-0000-0000-0000-000000000003', c.id, 'Stranger Class',
       lower(to_char(today_sg(),'FMday'))::day_of_week,
       '10:00','11:00','Pool S', 25, '3b000000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = '2b000000-0000-0000-0000-0000000000c2';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, level_id)
VALUES ('4b000000-0000-0000-0000-000000000001','Real Child','2017-03-03','assigned',
        '1b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000002');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '4b000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '2b000000-0000-0000-0000-0000000000d1';
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '1b000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '2b000000-0000-0000-0000-0000000000d1';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('4b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000003', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('5b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000003',
        today_sg(),'10:00','11:00');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('5b000000-0000-0000-0000-000000000001','4b000000-0000-0000-0000-000000000001',
        'present','2b000000-0000-0000-0000-0000000000c2');

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT '6b000000-0000-0000-0000-000000000001', p.id,'1b000000-0000-0000-0000-000000000001',
       to_char(today_sg() - INTERVAL '1 month','YYYY-MM'), 25, 25
  FROM parents p WHERE p.profile_id = '2b000000-0000-0000-0000-0000000000d1';

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status,
                           amount, class_title, session_date)
VALUES ('6b000000-0000-0000-0000-000000000001','4b000000-0000-0000-0000-000000000001',
        '5b000000-0000-0000-0000-000000000001','present',25,'Stranger Class', today_sg());

-- ── The probe harness ───────────────────────────────────────────────────────
-- Counts every base table in `public` AS THE CALLING ROLE. SECURITY INVOKER is
-- the whole point: run it as `authenticated` and RLS applies to the caller.
-- Its own scratch tables are excluded by the `__` prefix.
CREATE FUNCTION public.__visible_counts() RETURNS TABLE(tbl text, n bigint)
LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT cl.relname FROM pg_class cl
             JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public' AND cl.relkind = 'r'
              AND cl.relname NOT LIKE '\_\_%'
            ORDER BY cl.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO c;
    tbl := r.relname; n := c; RETURN NEXT;
  END LOOP;
END $fn$;

CREATE TABLE public.__probe_counts (persona text, tbl text, n bigint);
ALTER TABLE public.__probe_counts DISABLE ROW LEVEL SECURITY;

-- Since 20260804000400/000600 a new function and a new table are reachable by
-- NOBODY until granted. These two lines are that regime working as intended —
-- without them the probe fails loudly here rather than silently in production.
GRANT EXECUTE ON FUNCTION public.__visible_counts() TO authenticated;
GRANT INSERT   ON TABLE    public.__probe_counts     TO authenticated;

-- ── Collect: the real member, then the stranger ─────────────────────────────
SET LOCAL ROLE authenticated;

SET LOCAL "request.jwt.claims" TO '{"sub":"2b000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
INSERT INTO public.__probe_counts SELECT 'member', tbl, n FROM public.__visible_counts();

SET LOCAL "request.jwt.claims" TO '{"sub":"2b000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
INSERT INTO public.__probe_counts SELECT 'stranger', tbl, n FROM public.__visible_counts();

RESET ROLE;

-- ── 1. THE VACUITY GUARD. What a legitimate member sees, pinned exactly. ─────
-- Read this as the fixture's own self-test. If it starts failing because a
-- table dropped off the list, do NOT relax assertion 2 to match — the fixture
-- stopped populating something and assertion 2 has become vacuous for it.
SELECT is(
  (SELECT string_agg(tbl, ', ' ORDER BY tbl) FROM public.__probe_counts
    WHERE persona = 'member' AND n > 0),
  'attendance, class_categories, classes, coaches, invoice_items, invoices, '
  'lesson_sessions, parent_students, parent_tenants, parents, profiles, '
  'student_class_enrolments, students, tenant_levels, tenants',
  'control: a real member of the business sees their own family across 15 tables');

-- ── 2. THE SWEEP. The stranger sees nothing but their own two rows. ──────────
-- `profiles` and `parents` are the two rows the auth trigger creates for them
-- at signup — their own identity, reachable by `id = auth.uid()` and
-- `profile_id = auth.uid()`. Everything else in the schema must be zero.
SELECT is(
  (SELECT COALESCE(string_agg(tbl || ':' || n, ', ' ORDER BY tbl), '')
     FROM public.__probe_counts WHERE persona = 'stranger' AND n > 0),
  'parents:1, profiles:1',
  'a self-registered stranger sees only their own profile and parent row');

-- ── 3. EVERY TABLE WAS ACTUALLY SWEPT ───────────────────────────────────────
-- Guards the harness rather than the product: if `__visible_counts()` silently
-- stopped enumerating — a schema filter typo, a renamed relkind — assertions 1
-- and 2 would both still pass while testing almost nothing.
SELECT is(
  (SELECT count(DISTINCT tbl)::int FROM public.__probe_counts WHERE persona = 'stranger'),
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE '\_\_%'),
  'the sweep covered every base table in public, not a subset');

-- ── 4. THE STRANGER'S OWN ROWS ARE GENUINELY THEIR OWN ──────────────────────
-- "Sees 1 row" is not the same as "sees THEIR row". Without this, assertion 2
-- would pass just as well if the stranger were reading the real parent's
-- profile instead of their own.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"2b000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
SELECT is(
  (SELECT string_agg(full_name, ', ') FROM profiles),
  'Mallory Stranger',
  'the one profile a stranger can read is their own, not the family''s');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
