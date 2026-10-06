-- Wave 7, M1: the injectable database clock — app_now() / app_today() — and the two helpers re-bodied onto it.
-- docs/plans/WAVE7_DB_CLOCK_PLAN.md (decisions D1–D6 are the user's; Appendix A is the classification).
--
-- WHAT. A pgTAP file can pin "now" for its own transaction:
--     SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
-- and every date decision in the database reads the pin instead of the wall clock. today_sg() and
-- session_window_start() are re-bodied onto app_now(), which converts every caller of today_sg(),
-- session_window_start(), markable_floor() and markable_window_start() at once (24 on 2026-10-06).
--
-- PROD IS IDENTICAL BY CONSTRUCTION. Nothing on prod sets swimsync.now, so app_now() returns now() on its first
-- line. Two locks stop a pin ever moving prod's clock (D3):
--   lock 1 — private.clock_override_enabled holds a row ONLY where seed.sql ran (local + CI; seed never runs on
--            prod). A pin with no row RAISEs — loud, never a silent fallback (§7.334).
--   lock 2 — the API's login role (authenticator: PostgREST, edge functions) never pins. Proven over a REAL login
--            by supabase/tests/http/app_clock_locks.sh, not pgTAP (§7.333).
-- A pin must carry a UTC offset (§7.337): the server runs at UTC, so '2026-10-01 07:59' would silently mean
-- 15:59 SGT and the "07:59 SGT is still yesterday in UTC" edge would stop being tested.
--
-- The helper bodies below are pg_get_functiondef of the live bodies with ONE token changed each (now() →
-- app_now()); signature, volatility, SECURITY mode, search_path and ACL are untouched (§7.336, RISK 1).
--
-- ROLLBACK: supabase/rollback/20261006000300_app_clock_DOWN.sql — restores the two helper bodies. It never
-- drops app_now()/app_today()/the flag table/private (§7.335): bodies are not dependency-tracked.

-- ---- The flag (lock 1) -------------------------------------------------------------------------------------
-- `private` is not in config.toml's API schemas, and no API role can see into it.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.clock_override_enabled (enabled boolean PRIMARY KEY CHECK (enabled));
REVOKE ALL ON TABLE private.clock_override_enabled FROM PUBLIC, anon, authenticated, service_role;

-- ---- The clock -----------------------------------------------------------------------------------------------
-- GUC namespace swimsync.*, never request.* / app.* — PostgREST writes request.* from headers and the JWT.
-- SECURITY DEFINER so a caller needs no grant on `private`.
CREATE FUNCTION public.app_now() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v text := current_setting('swimsync.now', true);
BEGIN
  IF v IS NULL OR v = '' THEN RETURN now(); END IF;                       -- prod path, every call
  IF session_user = 'authenticator' THEN RETURN now(); END IF;            -- lock 2: the API never pins
  IF NOT EXISTS (SELECT 1 FROM private.clock_override_enabled) THEN       -- lock 1: fail LOUD, not silent
    RAISE EXCEPTION 'swimsync.now is set but the clock override is disabled in this database';
  END IF;
  IF v !~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)$' THEN                           -- an offset, always (§7.337)
    RAISE EXCEPTION 'swimsync.now must carry a UTC offset, e.g. ''2026-09-15 10:00+08'' (got %)', v;
  END IF;
  RETURN v::timestamptz;
END $$;

CREATE FUNCTION public.app_today() RETURNS date LANGUAGE sql STABLE
SET search_path = public AS $$ SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date $$;

-- A new function is callable by nobody until granted (§7.87), and PUBLIC gets EXECUTE by default — revoke it
-- (§7.82). authenticated MUST hold both: today_sg() is SECURITY INVOKER and fires inside assert_markable_date
-- under authenticated, so a missing grant would be `permission denied` on every attendance write.
REVOKE ALL ON FUNCTION public.app_now(), public.app_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_now(), public.app_today() TO authenticated, service_role;

-- ---- The lever: the two helpers, one token each --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.today_sg()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date $function$

;

CREATE OR REPLACE FUNCTION public.session_window_start()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('month', (app_now() AT TIME ZONE 'Asia/Singapore'))
          - INTERVAL '1 month')::date
$function$

;

