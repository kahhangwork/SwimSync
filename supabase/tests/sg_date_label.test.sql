-- pgTAP: every date a DB message shows reads "Sept", not "Sep" (20261009000100).
--
-- WHAT THIS FILE PROTECTS.
--   (1) the helper: September → "Sept" in each format the bodies use; other months and the 'Month' token
--       untouched; NULL stays NULL;
--   (2) one real message end to end — assert_markable_date, the text the coach app shows verbatim;
--   (3) THE CENSUS: no function in public formats a 'Mon' date through to_char any more. A function added
--       next month that reaches for to_char(…, 'DD Mon YYYY') turns this red on the day it is written —
--       a named list could not (same reasoning as function_grants.test.sql);
--   (4) grants: authenticated may call the helper (two INVOKER callers run as it); anon may not.
--
-- PROVEN RED (§7.25): against the 2026-10-09 bodies (the rollback file applied), (2) read "15 Sep 2026" and
-- (3) named all 13 functions.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-01 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);
SELECT is(app_today(), '2026-09-01'::date, 'clock pinned');

-- ── 1. THE HELPER ─────────────────────────────────────────────────────────────
SELECT is(sg_date_label('2026-09-06', 'DD Mon YYYY'), '06 Sept 2026', 'DD Mon YYYY → Sept');
SELECT is(sg_date_label('2026-09-06', 'FMDD Mon'),    '6 Sept',       'FMDD Mon → Sept');
SELECT is(sg_date_label('2026-09-06', 'Mon YYYY'),    'Sept 2026',    'Mon YYYY → Sept');
SELECT is(sg_date_label('2026-09-06', 'FMDD Month'),  '6 September',  'a Month token is not widened twice');
SELECT is(sg_date_label('2026-05-06', 'DD Mon YYYY'), '06 May 2026',  'every other month is plain to_char');
SELECT is(sg_date_label(NULL, 'DD Mon YYYY'),         NULL,           'NULL in, NULL out');

-- ── 2. ONE REAL MESSAGE ───────────────────────────────────────────────────────
-- A future date is refused before any tenant lookup matters; markable_floor() of an unknown tenant answers
-- with the calendar floor, so no fixture is needed.
SELECT throws_ok(
  $$SELECT assert_markable_date('2026-09-15', gen_random_uuid())$$,
  'P0001',
  'That lesson (15 Sept 2026) has not happened yet — attendance cannot be marked ahead of time.',
  'assert_markable_date names the month the way the apps do');

-- ── 3. THE CENSUS ─────────────────────────────────────────────────────────────
-- A to_char call whose format literal holds the word Mon — the argument may itself hold one level of
-- parentheses ((x AT TIME ZONE …)::date). Failures name the functions.
SELECT is(
  (SELECT COALESCE(string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosrc ~ $re$\mto_char\((?:[^()';]|'[^']*'|\([^()]*\))*'[^']*\mMon\M[^']*'\)$re$),
  '',
  'no public function formats a display date with to_char(…, ''Mon'') — use sg_date_label');

-- ── 4. GRANTS ─────────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.sg_date_label(date,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sg_date_label(date,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.sg_date_label(date,text)', 'EXECUTE'),
  'sg_date_label: authenticated only');

SELECT * FROM finish();
ROLLBACK;
