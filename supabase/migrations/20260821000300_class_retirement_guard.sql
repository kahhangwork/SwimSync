-- ============================================================
-- Close the raw-UPDATE retirement hole. (§7.199; BACKLOG "A raw PostgREST
-- UPDATE can retire a class, bypassing deactivate_class()"; found in the
-- 20260820000200 pre-deploy review.)
--
-- THE HOLE. `classes_write ON classes FOR ALL TO authenticated` (20260718000900)
-- plus `GRANT … UPDATE … ON public.classes` (20260804000600) let any tenant
-- admin run `UPDATE classes SET is_active = false, deactivated_at = now()`
-- straight over PostgREST — never entering deactivate_class() and never passing
-- its three refusals (children still on the roster, future guest bookings,
-- lessons still owed a mark). 20260810000100 added
-- classes_inactive_requires_deactivated_at and its comment CLAIMED "a raw
-- PostgREST UPDATE cannot supply the date" — that is WRONG (a raw UPDATE can
-- supply it), so the CHECK only blocks a NULL-date retire, not the real hole.
-- The calendar and the Lessons badge both reason "a retired class holds zero
-- active enrolments"; this path can break that invariant.
--
-- We cannot narrow classes_write to forbid an is_active flip: an RLS UPDATE
-- policy's WITH CHECK sees only the NEW row, never OLD, so it cannot compare
-- OLD.is_active to NEW.is_active. A BEFORE trigger can, and it catches EVERY
-- path — the RPC and a raw write alike.
--
-- FIX, two parts:
--   1. Extract deactivate_class()'s three refusals into ONE helper,
--      assert_class_retirable(), so there is a single source of truth (it also
--      lets deactivate_class() and the trigger below share it).
--   2. A BEFORE UPDATE trigger on classes fires that helper on any true->false
--      is_active transition FROM A USER CONTEXT (auth.uid() present).
--      deactivate_class() still calls it explicitly (so the refusal lands in the
--      RPC's natural order, before it prepares the audit row); the trigger
--      re-runs it as the backstop for a raw authenticated write. A no-user
--      context — service_role or superuser — is trusted and may force a state
--      (the engine's Deno tests and this schema's own fixtures rely on that);
--      see the trigger's trust-boundary note below.
--
-- reactivate_class() is UNTOUCHED, by standing prohibition (HANDOVER §3): the
-- trigger fires ONLY on true->false (and the date-move case below), so a
-- false->true reactivation never enters the helper. A raw retire that IS safe
-- (empty roster, no guests, all marked) with the date supplied still succeeds —
-- the invariant is what we protect, not the RPC's monopoly.
--
-- The trigger ALSO refuses a false->false raw UPDATE that MOVES deactivated_at
-- (a sibling of the retire hole: the engine reads that date, so shifting it on an
-- already-retired class widens its expectation window). See the trigger body.
-- (Audit completeness for a raw write is the remaining, lesser gap:
-- deactivate_class() writes the class_deactivated audit row; a raw UPDATE does
-- not. Noted, not closed here. A raw retire may also supply a fabricated first
-- date rather than now() — accepted; the load-bearing invariant is that a date,
-- once set, does not move.)
-- ============================================================

-- ── 1. The single source of truth — the three refusals, verbatim. ──────────
-- SECURITY DEFINER and callable by NOBODY (§7.87), exactly like
-- class_unmarked_lesson_dates() which refusal 3 leans on: it is reached only
-- through deactivate_class() and the trigger, both SECURITY DEFINER. A plain
-- helper would count under the caller's RLS and miss rows.
CREATE OR REPLACE FUNCTION public.assert_class_retirable(p_class_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_title  TEXT;
  v_floor  DATE;
  v_names  TEXT;
  v_dates  DATE[];
BEGIN
  SELECT c.tenant_id, c.title
    INTO v_tenant, v_title
    FROM classes c
   WHERE c.id = p_class_id;

  -- No row (a DELETE, or a bad id): nothing to strand, nothing to assert.
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  v_floor := markable_floor(v_tenant);

  -- ── Refusal 1: children still enrolled ───────────────────────────────────
  -- NOT `WHERE is_active` (§7.66 — that is a point-in-time flag, not a span).
  -- An enrolment closed YESTERDAY still has lessons this month that need marks,
  -- and retiring the class hides them.
  SELECT string_agg(DISTINCT s.full_name, ', ' ORDER BY s.full_name)
    INTO v_names
    FROM student_class_enrolments e
    JOIN students s ON s.id = e.student_id
   WHERE e.class_id = p_class_id
     AND (e.unenrolled_at IS NULL
          OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= v_floor);

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION
      '% still has children on its roster: %. Remove each of them from the class first (Students → Remove from class), which records the date they left. Nothing is closed for you — the leave date decides what they are billed.',
      v_title, v_names;
  END IF;

  -- ── Refusal 2: guests booked into a lesson that has not happened ─────────
  -- Both booking tables. book_makeup() already refuses an inactive host class,
  -- but nothing guarded retiring a class that ALREADY holds bookings — the
  -- guest is expected there and nowhere else.
  SELECT string_agg(b.label, ', ' ORDER BY b.label)
    INTO v_names
    FROM (
      SELECT s.full_name || ' on ' || to_char(tb.session_date, 'DD Mon YYYY') AS label
        FROM trial_bookings tb
        JOIN students s ON s.id = tb.student_id
       WHERE tb.class_id = p_class_id
         AND tb.cancelled_at IS NULL
         AND tb.session_date >= today_sg()
      UNION ALL
      SELECT s.full_name || ' on ' || to_char(mb.session_date, 'DD Mon YYYY')
        FROM makeup_bookings mb
        JOIN students s ON s.id = mb.student_id
       WHERE mb.class_id = p_class_id
         AND mb.cancelled_at IS NULL
         AND mb.session_date >= today_sg()
    ) b;

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION
      '% has guests booked into lessons that have not happened yet: %. Cancel those bookings first, or wait until the lessons have been taught and marked.',
      v_title, v_names;
  END IF;

  -- ── Refusal 3: lessons still owed a mark ─────────────────────────────────
  -- The structural one. Without it the deadlock is reachable by an admin doing
  -- nothing unreasonable: retire a class mid-month with last week unmarked, and
  -- the month blocks on a lesson the coach can no longer see.
  v_dates := class_unmarked_lesson_dates(p_class_id);

  IF array_length(v_dates, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      '% has lessons still waiting to be marked: %. Mark them before retiring the class — an unmarked lesson blocks the whole month from being billed, with no override, and an inactive class disappears from the coach''s screens.',
      v_title,
      (SELECT string_agg(to_char(d, 'DD Mon YYYY'), ', ' ORDER BY d)
         FROM unnest(v_dates) AS d);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_class_retirable(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.assert_class_retirable(uuid) IS
  'Raises if a class cannot be safely retired: children still on the roster by SPAN (§7.66), future trial/make-up guests, or lessons still owed a mark. The single source of truth for those three refusals, called by deactivate_class() AND the trg_class_retirement_guard BEFORE UPDATE trigger so a raw PostgREST UPDATE cannot bypass them (§7.199). Callable by nobody — reached only through SECURITY DEFINER callers.';

-- ── 2a. deactivate_class() now delegates its three refusals to the helper. ──
-- Everything else is byte-identical to 20260809000300: auth, idempotency, the
-- old/new snapshot, the UPDATE and the audit row. Only the three inline refusal
-- blocks (and the now-unused v_floor/v_names/v_dates locals) are gone.
CREATE OR REPLACE FUNCTION public.deactivate_class(p_class_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_title  TEXT;
  v_active BOOLEAN;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.title, c.is_active
    INTO v_tenant, v_title, v_active
    FROM classes c
   WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to deactivate this class';
  END IF;

  -- Idempotent. Re-deactivating must not move deactivated_at: that date is what
  -- the engine expects lessons up to, and rewriting it would silently widen the
  -- expectation window on a class already retired.
  IF NOT v_active THEN
    RETURN;
  END IF;

  -- The three refusals, now shared with the raw-UPDATE trigger (§7.199).
  -- Called here so the refusal lands before the audit snapshot below, keeping
  -- this function's order and error messages exactly as they were.
  PERFORM assert_class_retirable(p_class_id);

  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET is_active      = FALSE,
         deactivated_at = NOW(),
         updated_at     = NOW()
   WHERE id = p_class_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (v_actor, 'class_deactivated', 'Class', p_class_id, v_old,
          (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id));
END;
$function$;

-- ── 2b. The backstop trigger — every USER-CONTEXT path, not just the RPC. ──
-- Fires ONLY on a true->false is_active transition, so reactivate_class()
-- (false->true) and ordinary edits (title, capacity, …) never enter the helper.
-- SECURITY DEFINER so the helper's counts see all rows regardless of the raw
-- caller's RLS.
--
-- THE TRUST BOUNDARY: `auth.uid() IS NOT NULL`. The hole this closes is an
-- AUTHENTICATED tenant admin's raw PostgREST UPDATE — those always carry a user
-- JWT, so auth.uid() is set and the guard enforces. RLS (classes_write is
-- can_admin_tenant, and its USING clause) has already scoped that write to the
-- caller's own tenant before the trigger sees a row, so there is no cross-tenant
-- reach here — the only writer who arrives is an admin retiring their own class.
-- A NO-USER context — service_role (the edge functions and the Deno engine
-- tests, which force retired-class states the engine must still read correctly)
-- and a superuser (migrations, seed, pgTAP fixtures) — has auth.uid() = null and
-- is trusted, so it may force a state past the refusals. anon cannot reach this
-- trigger at all (no classes UPDATE grant/policy). deactivate_class() enforces
-- unconditionally on its own, above, so the RPC path is covered either way.
CREATE OR REPLACE FUNCTION public.guard_class_retirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Trust boundary: only a user-context write is guarded (see note above).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.is_active AND NOT NEW.is_active THEN
    -- Retiring: the three refusals.
    PERFORM assert_class_retirable(NEW.id);
  ELSIF NOT OLD.is_active AND NOT NEW.is_active
        AND NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    -- Already retired, staying retired: the date must NOT move. deactivate_class()
    -- refuses to rewrite it because the engine reads deactivated_at as how far the
    -- class was expected to run, and moving it silently widens that window on a
    -- class no coach screen renders. This closes the same hole on the raw path: a
    -- raw `UPDATE classes SET deactivated_at = <other>` where is_active stays false
    -- would otherwise sail through classes_write + the UPDATE grant (§7.199).
    -- (Clearing it to NULL is already blocked by classes_inactive_requires_
    -- deactivated_at; reactivation goes false->true and is never guarded.)
    RAISE EXCEPTION
      'a retired class''s retirement date cannot be changed — reactivate it first if it is running again, then retire it afresh';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_class_retirement_guard
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.guard_class_retirement();

COMMENT ON CONSTRAINT classes_inactive_requires_deactivated_at ON public.classes IS
  'A retired class must record WHEN it was retired. generate-invoices reads deactivated_at to decide how far an inactive class was expected to run; a NULL there means "expect nothing", which is safe for a derived weekday date and would be a silent underbill if ever applied to a booking. NOTE (20260821000300): this constraint does NOT, on its own, force retirement through deactivate_class() — a raw UPDATE can supply the date. The three retirement refusals are enforced for every path by trg_class_retirement_guard (§7.199); this CHECK only guarantees the date is present.';

-- ── Apply-time probes — RAISE, do not warn (§7.87). ────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.assert_class_retirable(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.assert_class_retirable(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assert_class_retirable is EXECUTE-able by a client role — it must be callable by nobody (§7.87)';
  END IF;
  -- deactivate_class()'s CREATE OR REPLACE must not have moved its own ACL: the
  -- admin Classes page calls it, and anon never may (§7.87, §7.123).
  IF NOT has_function_privilege('authenticated', 'public.deactivate_class(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'deactivate_class lost EXECUTE for authenticated — the admin Classes page would fail with permission denied';
  END IF;
  IF has_function_privilege('anon', 'public.deactivate_class(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'deactivate_class is EXECUTE-able by anon — see §7.82';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.classes'::regclass
       AND tgname = 'trg_class_retirement_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_class_retirement_guard is missing — the raw-UPDATE retirement hole is open (§7.199)';
  END IF;
END $$;
