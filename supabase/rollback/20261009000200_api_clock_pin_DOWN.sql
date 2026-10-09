-- ROLLBACK for 20261009000200_api_clock_pin.sql — restores app_now()'s previous body (md5
-- 6b0147dc5733ba131f104e47fc364465): lock 2 unconditional again, the API never pins.
--
-- It KEEPS private.clock_api_pin_enabled (§7.335): an empty private table is inert, and dropping it would break a
-- re-apply of the UP. It never touches app_today(), the lock-1 table or `private`.
-- Run on prod only if the UP itself misbehaves; then mark the migration reverted (supabase migration repair).

CREATE OR REPLACE FUNCTION public.app_now()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
END $function$;
