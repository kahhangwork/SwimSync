-- Rollback for 20261006000300_app_clock.sql (Wave 7, M1 — the injectable clock).
--
-- ORDER: the DOWNs of M5 → M2 run first. This file then restores today_sg() and session_window_start() to their
-- pre-M1 bodies (pg_get_functiondef captures, byte-identical) and checks nothing else still calls the clock.
--
-- ⚠ It NEVER drops app_now(), app_today(), private.clock_override_enabled or the private schema (§7.335).
-- sql/plpgsql bodies are not dependency-tracked, so DROP FUNCTION succeeds while callers remain, and every
-- caller then fails at RUNTIME — on prod, not at deploy. Unused, they are harmless: prod never sets
-- swimsync.now and its flag table is empty.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000300';

-- First, before touching anything: every OTHER caller of the clock must already be gone. One left behind means
-- the M5→M2 DOWNs were skipped; refuse rather than leave a half-rolled-back clock.
DO $$
DECLARE v_left text;
BEGIN
  SELECT string_agg(proname, ', ' ORDER BY proname) INTO v_left
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname NOT IN ('app_now', 'app_today', 'today_sg', 'session_window_start')
     AND prosrc ~ 'app_(now|today)\(';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'M1 DOWN: these functions still call app_now()/app_today() — run the M5→M2 DOWNs first: %', v_left;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.today_sg()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT (now() AT TIME ZONE 'Asia/Singapore')::date $function$

;

CREATE OR REPLACE FUNCTION public.session_window_start()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
          - INTERVAL '1 month')::date
$function$

;

