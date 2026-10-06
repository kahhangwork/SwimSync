-- clock-free: this file tests the clock itself — it pins, unpins and breaks the pin per assertion, so G1's
--             single leading pin does not fit it.
-- pgTAP: THE INJECTABLE DATABASE CLOCK (20261006000300_app_clock, Wave 7 M1).
-- docs/plans/WAVE7_DB_CLOCK_PLAN.md — "M1 gate" lists what this file must hold.
--
-- WHAT THIS FILE PROTECTS.
--   * Unpinned, app_now() IS now() — the prod path, every call.
--   * Pinned (SELECT set_config('swimsync.now', '<ts with offset>', true)), every date decision reads the pin:
--     app_now(), app_today(), and the two re-bodied helpers today_sg() / session_window_start().
--   * Lock 1: a pin with no flag row RAISEs (§7.334 — loud, never a silent fallback to the real clock).
--   * A pin without a UTC offset RAISEs (§7.337).
--   * The invoker chain: today_sg() is SECURITY INVOKER and runs under authenticated inside
--     assert_markable_date, so authenticated must be able to reach app_now() through it.
--   * ACL parity (RISK 2): any role that can call today_sg() can call app_now()/app_today(); anon neither.
--   * Nothing but app_now() reads swimsync.now, and no public function calls set_config — so no
--     client-reachable path can set the pin.
--
-- NOT HERE: lock 2 (session_user = 'authenticator'). pgTAP runs with session_user = postgres and cannot
-- become authenticator (§7.333), so any assertion here would be vacuous. It is proven over a real login by
-- supabase/tests/http/app_clock_locks.sh.
BEGIN;
SELECT plan(26);

-- ---- 1. The flag row (lock 1's switch) is present: seed.sql ran, or M1's hand insert did (§7.334) ----------
SELECT is((SELECT count(*)::int FROM private.clock_override_enabled), 1,
  'the clock-override flag row exists (seed.sql / the post-`migration up` insert)');

-- ---- 2. Unpinned: the real clock ---------------------------------------------------------------------------
SELECT is(app_now(), now(), 'unpinned: app_now() = now()');
SELECT is(app_today(), (now() AT TIME ZONE 'Asia/Singapore')::date, 'unpinned: app_today() = the SGT date of now()');
SELECT set_config('swimsync.now', '', true);
SELECT is(app_now(), now(), 'an empty pin is unpinned: app_now() = now()');

-- ---- 3. Pinned ---------------------------------------------------------------------------------------------
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(app_now(), '2026-09-15 10:00+08'::timestamptz, 'pinned: app_now() = the pin');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(app_today(), '2026-09-15'::date, 'pinned: app_today() = the pin''s SGT date');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(today_sg(), '2026-09-15'::date, 'pinned: today_sg() reads the pin (re-bodied)');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(session_window_start(), '2026-08-01'::date, 'pinned: session_window_start() = 1st of the previous SGT month');

-- 07:59 SGT on the 1st: UTC is still the previous day AND the previous month (§7.7).
SELECT set_config('swimsync.now', '2026-10-01 07:59+08', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(app_today(), '2026-10-01'::date, '07:59 SGT on the 1st: app_today() is the SGT date, not the UTC one');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(session_window_start(), '2026-09-01'::date, '07:59 SGT on the 1st: the window starts in the SGT previous month');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard

SELECT set_config('swimsync.now', '2026-09-30T23:59:00Z', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is(app_today(), '2026-10-01'::date, 'a Z-suffixed pin is accepted and read in SGT');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard

-- ---- 4. A pin must carry an offset (§7.337) ----------------------------------------------------------------
SELECT set_config('swimsync.now', '2026-10-01 07:59', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT throws_like($$SELECT app_now()$$, '%must carry a UTC offset%',
  'an offset-less pin RAISEs instead of being read as UTC');
SELECT throws_like($$SELECT today_sg()$$, '%must carry a UTC offset%',
  'an offset-less pin RAISEs through the helpers too');

-- ---- 5. Lock 1: a pin with no flag row RAISEs ----------------------------------------------------------------
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
DELETE FROM private.clock_override_enabled;
SELECT throws_ok($$SELECT app_now()$$, 'P0001',
  'swimsync.now is set but the clock override is disabled in this database',
  'lock 1: a pin in a database without the flag row RAISEs (prod shape)');
SELECT set_config('swimsync.now', '', true);
SELECT is(app_now(), now(), 'lock 1: without a pin, a flag-less database is the real clock (the prod path)');
INSERT INTO private.clock_override_enabled VALUES (true);

-- ---- 6. The invoker chain under authenticated -----------------------------------------------------------------
-- SET LOCAL ROLE keeps session_user = postgres, so the pin still applies; what this proves is the GRANTS:
-- authenticated reaches app_now() through SECURITY INVOKER today_sg().
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE clock_as_auth ON COMMIT DROP AS
  SELECT today_sg() AS today, session_window_start() AS win, app_today() AS app_today;
RESET ROLE;
SELECT is((SELECT today FROM clock_as_auth), '2026-09-15'::date, 'under authenticated: today_sg() returns the pinned date');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard
SELECT is((SELECT win FROM clock_as_auth), '2026-08-01'::date, 'under authenticated: session_window_start() follows the pin');
SELECT is((SELECT app_today FROM clock_as_auth), '2026-09-15'::date, 'under authenticated: app_today() is callable and pinned');  -- date-literal-ok: a clock pin or its readback — no write passes a floor guard

-- ---- 7. ACL parity (RISK 2) ------------------------------------------------------------------------------------
SELECT is_empty($$
  SELECT r FROM unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE has_function_privilege(r, 'public.today_sg()', 'EXECUTE')
     AND NOT (has_function_privilege(r, 'public.app_now()', 'EXECUTE')
              AND has_function_privilege(r, 'public.app_today()', 'EXECUTE'))
$$, 'ACL parity: every role that can call today_sg() can call app_now() and app_today()');
SELECT ok(NOT has_function_privilege('anon', 'public.app_now()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.app_today()', 'EXECUTE'),
  'anon can call neither app_now() nor app_today()');
SELECT is_empty($$
  SELECT r, p FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                   unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
   WHERE has_table_privilege(r, 'private.clock_override_enabled', p)
$$, 'no API role holds any privilege on the flag table');
SELECT is_empty($$
  SELECT r FROM unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE has_schema_privilege(r, 'private', 'USAGE') OR has_schema_privilege(r, 'private', 'CREATE')
$$, 'no API role can use or create in the private schema');

-- The general form of the parity: a SECURITY INVOKER function that calls the clock runs app_now() as ITS caller,
-- so every role that may execute it must hold app_now()/app_today() (M2's four invoker re-bodies, and any later).
SELECT is_empty($$
  SELECT p.proname, r
    FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT p.prosecdef
     AND p.prorettype <> 'trigger'::regtype   -- not callable directly; the trigger-writer check below covers them
     AND p.proname NOT IN ('app_now', 'app_today')
     AND p.prosrc ~ '(app_now|app_today|today_sg|session_window_start)\('
     AND has_function_privilege(r, p.oid, 'EXECUTE')
     AND NOT (has_function_privilege(r, 'public.app_now()', 'EXECUTE')
              AND has_function_privilege(r, 'public.app_today()', 'EXECUTE'))
$$, 'every role that can call an invoker function reading the clock can call app_now() and app_today()');

-- A SECURITY INVOKER trigger function runs as the role WRITING the table (EXECUTE on a trigger function is not
-- checked at fire time), so every role that can INSERT/UPDATE a table whose invoker trigger reads the clock must
-- hold app_now() — enforce_parent_package_lifecycle on parent_packages since M3.
SELECT is_empty($$
  SELECT tg.tgrelid::regclass, r
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
   CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE NOT tg.tgisinternal
     AND NOT p.prosecdef
     AND p.prosrc ~ '(app_now|app_today|today_sg|session_window_start)\('
     AND (has_table_privilege(r, tg.tgrelid, 'INSERT') OR has_table_privilege(r, tg.tgrelid, 'UPDATE'))
     AND NOT has_function_privilege(r, 'public.app_now()', 'EXECUTE')
$$, 'every role that can write a table whose invoker trigger reads the clock can call app_now()');

-- A column DEFAULT app_now() runs as the INSERTING role: every role that may insert must be able to call it.
SELECT is_empty($$
  SELECT c.table_name, r
    FROM information_schema.columns c,
         unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE c.table_schema = 'public'
     AND c.column_default ~ 'app_now\('
     AND has_table_privilege(r, format('public.%I', c.table_name), 'INSERT')
     AND NOT has_function_privilege(r, 'public.app_now()', 'EXECUTE')
$$, 'every role that can INSERT into a table defaulting to app_now() can call app_now()');

-- ---- 8. Nothing else can set or read the pin -------------------------------------------------------------------
SELECT is_empty($$
  SELECT proname FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname <> 'app_now'
     AND (prosrc ~ 'swimsync\.now' OR prosrc ~* 'set_config')
$$, 'no public function but app_now() mentions swimsync.now or calls set_config');

SELECT * FROM finish();
ROLLBACK;
