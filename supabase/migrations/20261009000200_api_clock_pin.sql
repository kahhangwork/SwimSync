-- Pin the clock for UI drivers, M1: lock 2 relaxed for LOCAL runs only — a second private row lets API sessions pin.
-- docs/plans/PIN_DRIVER_CLOCK_PLAN.md (decisions D1–D4 are the user's; this is the "Lock 2, relaxed" section).
--
-- WHAT. `run-all-drivers.sh --now '<moment>'` sets swimsync.now at DATABASE level (as supabase_admin, §7.355) and
-- inserts the one row of private.clock_api_pin_enabled for the length of the run. With that row present, an API
-- session (session_user = authenticator: PostgREST and the edge functions) follows the pin like any other session,
-- so the browser, PostgREST, the drivers' SQL and the billing engine agree on one moment. With the row absent — every
-- database except a local stack mid-`--now` — lock 2 behaves exactly as before: the API never pins.
--
-- PROD IS IDENTICAL BY CONSTRUCTION, three times over.
--   1. Nothing on prod sets swimsync.now, so app_now() returns on its FIRST line, before any table is read — the
--      new line is never reached and costs nothing.
--   2. Even if a pin were set, the API row is absent on prod: no migration and no seed line ever inserts it (CI
--      guard: check-driver-clock.sh's prod-reach rule).
--   3. Even with both, lock 1 (clock_override_enabled, seed-only) still RAISEs — and it is checked AFTER the new
--      line, so an API row without the lock-1 row is loud, not silent.
--
-- The body below is pg_get_functiondef of the live app_now() (md5 6b0147dc5733ba131f104e47fc364465, local = prod,
-- 2026-10-09) with exactly THREE intended edits (§7.336, §7.354): the lock-2 line becomes two lines gated on the API
-- row, and both RETURN lines that read the wall clock carry a `-- clock-real:` marker for G2. Signature,
-- volatility, SECURITY DEFINER, search_path, owner and ACL are untouched. The markers deliberately name no clock
-- token: the frozen census in app_clock.test.sql counts tokens inside prosrc, comments included.
--
-- ROLLBACK: supabase/rollback/20261009000200_api_clock_pin_DOWN.sql — restores the old body. It KEEPS the table
-- (§7.335): bodies are not dependency-tracked, and an empty private table is inert.

-- ---- The flag (local-only API pin) ---------------------------------------------------------------------------
-- `private` already exists (20261006000300) and no API role can see into it.
CREATE TABLE private.clock_api_pin_enabled (enabled boolean PRIMARY KEY CHECK (enabled));
REVOKE ALL ON TABLE private.clock_api_pin_enabled FROM PUBLIC, anon, authenticated, service_role;

-- ---- The clock -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_now()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v text := current_setting('swimsync.now', true);
BEGIN
  IF v IS NULL OR v = '' THEN RETURN now(); END IF;                       -- clock-real: the prod path, every call
  IF session_user = 'authenticator'
     AND NOT EXISTS (SELECT 1 FROM private.clock_api_pin_enabled) THEN RETURN now(); END IF;  -- clock-real: lock 2, API is real unless the local-only API row exists
  IF NOT EXISTS (SELECT 1 FROM private.clock_override_enabled) THEN       -- lock 1: fail LOUD, not silent
    RAISE EXCEPTION 'swimsync.now is set but the clock override is disabled in this database';
  END IF;
  IF v !~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)$' THEN                           -- an offset, always (§7.337)
    RAISE EXCEPTION 'swimsync.now must carry a UTC offset, e.g. ''2026-09-15 10:00+08'' (got %)', v;
  END IF;
  RETURN v::timestamptz;
END $function$;
