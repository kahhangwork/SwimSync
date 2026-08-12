-- ============================================================================
-- CLASS-LEVEL SHADOW COACHES — a shadow belongs to the CLASS, not to one lesson
--
-- Plan, with the ranked risk review this was built from:
-- docs/plans/CLASS_SHADOW_COACHES_PLAN.md
--
-- A SUBSTITUTE stays what Wave 3 made it: a one-off, on one lesson, in
-- session_coaches. A SHADOW becomes a DATED ASSIGNMENT TO A WHOLE CLASS,
-- permanent until it is ended, paid at its own rate for every lesson that ran
-- unless the main coach records them absent.
--
-- WHY THE MODEL MOVED. `Clear` on the Lesson Coaches page is a plain DELETE of
-- a lesson's main row. With shadows living on the lesson too, clearing the main
-- could leave the class's own coach holding a shadow row on a main-less lesson:
-- coach_is_main_on_session() says they ARE the main (absence rule) while
-- lessonRole() reads their shadow row and says they may not mark. The lesson
-- leaves NEEDS MARKING and the screen goes read-only — and unmarked attendance
-- blocks the billing month with NO override (§8i) and nothing on any screen
-- saying why. 20260812000100 guarded the ADD path only. Moving shadows to the
-- class makes the state UNBUILDABLE rather than guarded.
--
-- THREE AXES NOW, AND THEY ARE DELIBERATELY DIFFERENT QUESTIONS:
--   ACCESS     — the roster + classes.coach_id + "am I a shadow TODAY?"
--   MONEY      — class_rate_on().paid_coach_id + "was I a shadow ON THAT DATE?"
--   MARKING    — the roster main, else the class's coach. A shadow NEVER marks.
-- 20260719000800 exists because ACCESS and MONEY were once the same query and
-- handing a class over re-priced its entire unpaid history. Do not merge them,
-- and do not merge the two shadow date questions either (plan RISK 11).
--
-- NO BACKFILL. session_coaches holds zero rows in production and no shadow
-- assignment has ever existed, so every lesson keeps its exact current
-- behaviour. That makes the DATA safe; it does NOT make the CODE safe — see
-- section 6, where dropping a column breaks six function bodies that Postgres
-- will not warn you about.
-- ============================================================================


-- ============================================================================
-- 1. THE ASSIGNMENT
--
-- Dated, never deleted. An undated row that is removed makes
-- coach_attributed_to_session() answer FALSE for every past lesson, and
-- Adjustments A (20260811000200) then re-asks "what is this coach owed now?"
-- for every already-paid session and writes the difference — an automatic
-- clawback of pay the coach genuinely earned. effective_to exists so that the
-- answer for a past lesson NEVER changes. (Plan RISK 12.)
-- ============================================================================

CREATE TABLE class_shadow_coaches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  coach_id       UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  assigned_by    UUID REFERENCES profiles(id),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_by       UUID REFERENCES profiles(id),
  ended_at       TIMESTAMPTZ,
  CONSTRAINT shadow_dates_ordered
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One ACTIVE assignment per (class, coach). Closed rows may overlap and that is
-- harmless: attribution is an EXISTS, so two overlapping rows cannot double-pay.
-- An EXCLUDE USING gist over daterange was considered and refused — it needs
-- btree_gist for no behaviour this system can observe.
CREATE UNIQUE INDEX one_active_shadow_per_class_coach
  ON class_shadow_coaches (class_id, coach_id) WHERE effective_to IS NULL;

CREATE INDEX ON class_shadow_coaches (coach_id);
CREATE INDEX ON class_shadow_coaches (tenant_id);
CREATE INDEX ON class_shadow_coaches (class_id, effective_from);

-- tenant_id is STAMPED, not derived through two joins in every policy — and the
-- cross-tenant refusal lives HERE rather than in a policy because RLS can hide
-- the counterparty row and a check that cannot see a row silently passes
-- (§7.125). Fires for UPDATE as well as INSERT (§7.57).
CREATE OR REPLACE FUNCTION public.class_shadow_stamp_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class_tenant UUID;
  v_coach_tenant UUID;
BEGIN
  SELECT c.tenant_id INTO v_class_tenant FROM classes c WHERE c.id = NEW.class_id;
  IF v_class_tenant IS NULL THEN
    RAISE EXCEPTION 'class % does not exist', NEW.class_id;
  END IF;

  SELECT co.tenant_id INTO v_coach_tenant FROM coaches co WHERE co.id = NEW.coach_id;
  IF v_coach_tenant IS DISTINCT FROM v_class_tenant THEN
    RAISE EXCEPTION
      'coach % belongs to a different business than this class', NEW.coach_id;
  END IF;

  NEW.tenant_id := v_class_tenant;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_class_shadow_stamp_tenant
  BEFORE INSERT OR UPDATE ON class_shadow_coaches
  FOR EACH ROW EXECUTE FUNCTION class_shadow_stamp_tenant();


-- ----------------------------------------------------------------------------
-- ⚠ THE GUARDS BELONG ON THE TABLE, NOT ONLY IN THE RPCs — AND THIS FILE GOT
-- THAT WRONG ONCE ALREADY.
--
-- class_shadow_coaches_write is `FOR ALL … can_admin_tenant(tenant_id)` with the
-- matching DML grants, because a tenant admin genuinely does own these rows. So
-- every rule that lived only inside assign_class_shadow() / end_class_shadow()
-- was one PostgREST call away from being skipped: MEASURED — as the seed tenant
-- admin, a direct INSERT put the class's OWN COACH on its own shadow roster
-- inside a SEALED month, and a direct DELETE then destroyed the row the pay
-- history depends on.
--
-- That is precisely the rule this wave graduated to §7 — "a seal is only a seal
-- if every writer that can change the answer is behind it" — broken in the
-- migration that wrote it. session_coach_absences got its seal as a TRIGGER for
-- exactly this reason ("so no client path can miss it"); its sibling, the OTHER
-- input to coach_attribution_kind(), did not.
--
-- ⚠ DELETE IS REFUSED ONLY WHEN IT REACHES A SEALED MONTH, not always. The harm
-- a DELETE does is to SETTLED pay: Adjustments A re-asks what every already-paid
-- session is worth, so removing an assignment that covered one emits a clawback
-- of money genuinely earned (RISK 12). A row whose months are all still draft
-- carries no such history, and refusing that would break every fixture teardown
-- in the repo for no safety gained.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.class_shadow_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    RECORD;
  v_tenant UUID;
BEGIN
  v_row := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;

  SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = v_row.class_id;

  -- The one state the whole model exists to make unbuildable: main by the
  -- absence rule and shadow by a row is a lesson that is unmarkable AND
  -- un-nagged.
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM classes c
     WHERE c.id = NEW.class_id AND c.coach_id = NEW.coach_id
  ) THEN
    RAISE EXCEPTION
      'that coach already teaches this class — they cannot also shadow it';
  END IF;

  -- ⚠ THE EARLIEST DATE THE WRITE COULD AFFECT, not just the new one. On an
  -- UPDATE that moves effective_from LATER, the months between the old start
  -- and the new one stop being covered — so the OLD value is what has to clear
  -- the seal. assert_payout_month_open() refuses any paid month at or after the
  -- date it is given, so passing the earlier of the two is the safe direction.
  IF v_tenant IS NOT NULL THEN
    PERFORM assert_payout_month_open(
      v_tenant,
      LEAST(v_row.effective_from,
            COALESCE((CASE TG_OP WHEN 'UPDATE' THEN OLD.effective_from END),
                     v_row.effective_from)),
      'change a shadow assignment');
  END IF;

  RETURN v_row;
END;
$$;

CREATE TRIGGER trg_class_shadow_guard
  BEFORE INSERT OR UPDATE OR DELETE ON class_shadow_coaches
  FOR EACH ROW EXECUTE FUNCTION class_shadow_guard();


-- ============================================================================
-- 2. THE ABSENCE — the exception, not the rule
--
-- ⚠ A ROW MEANS THE COACH WAS **NOT** THERE. No row means they were, and they
-- are paid. The direction is chosen, not incidental, and inverting it trades a
-- recoverable failure for a silent one:
--
--   · An OVERPAYMENT appears as a line item on the Wages page and can be seen.
--     An UNDERPAYMENT appears nowhere and is indistinguishable from "the coach
--     wasn't there".
--   · Backdating an assignment works with no extra code — past lessons that are
--     already marked have no absence row, so they pay.
--   · Attendance saves as a direct .upsert() from the client, not an RPC, so
--     this is a SECOND write that can fail on its own. Under default-paid a
--     failed write leaves the coach PAID, which is the recoverable direction.
--
-- Only ever written for a SHADOW. The main coach marking the lesson is itself
-- the proof they were there.
-- ============================================================================

CREATE TABLE session_coach_absences (
  lesson_session_id UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  coach_id          UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marked_by         UUID REFERENCES profiles(id),
  marked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lesson_session_id, coach_id)
);

CREATE INDEX ON session_coach_absences (tenant_id);

-- Same body, same reason as its sibling above: the write policy says WHO may
-- write, and nothing else says the coach belongs to the same business as the
-- lesson (§7.125). Fires for UPDATE too (§7.57).
CREATE OR REPLACE FUNCTION public.session_absence_stamp_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class_tenant UUID;
  v_coach_tenant UUID;
BEGIN
  SELECT c.tenant_id INTO v_class_tenant
    FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = NEW.lesson_session_id;

  IF v_class_tenant IS NULL THEN
    RAISE EXCEPTION 'lesson session % does not exist', NEW.lesson_session_id;
  END IF;

  SELECT co.tenant_id INTO v_coach_tenant FROM coaches co WHERE co.id = NEW.coach_id;
  IF v_coach_tenant IS DISTINCT FROM v_class_tenant THEN
    RAISE EXCEPTION
      'coach % belongs to a different business than this lesson', NEW.coach_id;
  END IF;

  NEW.tenant_id := v_class_tenant;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_absence_stamp_tenant
  BEFORE INSERT OR UPDATE ON session_coach_absences
  FOR EACH ROW EXECUTE FUNCTION session_absence_stamp_tenant();


-- ----------------------------------------------------------------------------
-- 2.1 THE SEAL — and it belongs on BOTH tables, which is the whole finding
--
-- ⚠ A SEAL IS ONLY A SEAL IF EVERY WRITER THAT CAN CHANGE THE ANSWER IS BEHIND
-- IT. Sealing the assignment and leaving the absence open would be no seal at
-- all: both are inputs to coach_attribution_kind(), and markable_floor()
-- deliberately lets the main coach edit attendance for an already-paid month.
-- Two consequences, both money, neither visible on any screen:
--
--   · A tick REMOVED after the month is paid → Adjustments A re-asks
--     session_pay_amount(), gets 0, and emits an unguarded clawback.
--   · A tick RESTORED after the month is paid → Adjustments A is driven FROM
--     coach_payout_items and the shadow has no item; Adjustments B is driven
--     FROM session_coaches and a class shadow has no row there. Neither loop can
--     ever visit that (coach, lesson) pair. That is a PERMANENT SILENT
--     UNDERPAYMENT — the exact failure the wages cluster exists to remove.
--
-- ⚠ TENANT-WIDE, NOT PER-COACH. Adjustments B's own settled test
-- (20260811000200) reads `coach_payouts … tenant_id = … AND period_month = …
-- AND status = 'paid'` with NO coach_id filter. A per-coach seal would let an
-- admin backdate into a month the engine considers closed for a coach who has
-- no payout row of their own — precisely the coach this feature creates. Two
-- definitions of "settled" in one engine is a hole, not a duplication. This is
-- also the same shape set_class_terms() already uses.
--
-- There is deliberately NO OVERRIDE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_payout_month_open(
  p_tenant_id UUID,
  p_date      DATE,
  p_what      TEXT
)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM coach_payouts cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.status = 'paid'
       AND cp.period_month >= to_char(p_date, 'YYYY-MM')
  ) THEN
    RAISE EXCEPTION
      'cannot % for % — a coach payout for % or later has already been paid. '
      'Wages for that month are settled.',
      p_what, p_date, to_char(p_date, 'YYYY-MM');
  END IF;
END;
$$;

-- The absence table's own gate. A trigger rather than a check inside an RPC,
-- because the main coach writes these rows DIRECTLY from the attendance screen
-- (there is no RPC to hang it on) and no client path may be able to miss it.
CREATE OR REPLACE FUNCTION public.session_absence_seal_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     RECORD;
  v_date    DATE;
  v_tenant  UUID;
BEGIN
  v_row := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;

  SELECT ls.session_date, c.tenant_id INTO v_date, v_tenant
    FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = v_row.lesson_session_id;

  IF v_date IS NOT NULL THEN
    PERFORM assert_payout_month_open(
      v_tenant, v_date, 'change who attended this lesson');
  END IF;

  RETURN v_row;
END;
$$;

CREATE TRIGGER trg_session_absence_seal
  BEFORE INSERT OR UPDATE OR DELETE ON session_coach_absences
  FOR EACH ROW EXECUTE FUNCTION session_absence_seal_guard();


-- ============================================================================
-- 3. RLS + GRANTS for the two new tables
--
-- A new table is readable and writable by NOBODY until its own migration grants
-- it, and a policy without the matching GRANT throws `permission denied` in dev
-- (§7.87). supabase/tests/table_grants.test.sql goes red on any privilege no
-- policy permits — NEVER "fix" that with a blanket re-grant.
-- ============================================================================

ALTER TABLE class_shadow_coaches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_coach_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_shadow_coaches_select ON class_shadow_coaches
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR coach_id = current_coach_id()
  );

CREATE POLICY class_shadow_coaches_write ON class_shadow_coaches
  FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_shadow_coaches TO authenticated;

CREATE POLICY session_coach_absences_select ON session_coach_absences
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR coach_id = current_coach_id()
    -- The MAIN coach of the lesson ticks the box, so they must be able to read
    -- back what they wrote even though the row is about somebody else.
    OR coach_is_main_on_session(lesson_session_id)
  );

CREATE POLICY session_coach_absences_write ON session_coach_absences
  FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id) OR coach_is_main_on_session(lesson_session_id))
  WITH CHECK (can_admin_tenant(tenant_id) OR coach_is_main_on_session(lesson_session_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_coach_absences TO authenticated;


-- ============================================================================
-- 4. THE TWO DATE QUESTIONS — deliberately two functions
--
-- Collapsing them is what this pair exists to prevent (plan RISK 11): one
-- function answering both means either an ex-shadow keeps seeing the class, or
-- a current shadow loses their pay history.
--
-- ⚠ NO HAND-ROLLED DATES. CURRENT_DATE is the SESSION's time zone, which is UTC
-- on this server, and class_terms.test.sql asserts that NO function in `public`
-- has CURRENT_DATE or now()::date anywhere in its prosrc — writing either turns
-- that assertion red for the whole suite. today_sg() (20260727000100), and
-- nothing else. The pay question takes its date as an ARGUMENT so it cannot
-- read a clock at all (§7.7's discipline).
-- ============================================================================

-- VISIBILITY: am I a shadow of this class TODAY?
CREATE OR REPLACE FUNCTION public.coach_is_active_class_shadow(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM class_shadow_coaches s
     WHERE s.class_id = p_class_id
       AND s.coach_id = current_coach_id()
       AND s.effective_from <= today_sg()
       AND (s.effective_to IS NULL OR s.effective_to >= today_sg())
  );
$$;

COMMENT ON FUNCTION public.coach_is_active_class_shadow(UUID) IS
  'Is the CALLING coach a shadow of this class TODAY? Drives VISIBILITY only. '
  'Pay asks a different question on a different date — coach_shadowed_class_on().';

-- PAY: was this coach a shadow of this class ON THAT LESSON'S DATE?
CREATE OR REPLACE FUNCTION public.coach_shadowed_class_on(
  p_class_id UUID,
  p_date     DATE,
  p_coach_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_coach_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM class_shadow_coaches s
     WHERE s.class_id = p_class_id
       AND s.coach_id = p_coach_id
       AND s.effective_from <= p_date
       AND (s.effective_to IS NULL OR s.effective_to >= p_date)
  );
$$;

COMMENT ON FUNCTION public.coach_shadowed_class_on(UUID, DATE, UUID) IS
  'Was this coach a shadow of this class on that date? Drives PAY. Takes the '
  'coach as an argument because the caller at payroll time is the ADMIN, not '
  'the coach being paid (§7.125), and takes the date so it cannot read a clock.';


-- ============================================================================
-- 5. THE RATE, NOW ROLE-DIMENSIONED
--
-- A coach may hold a MAIN rate and a SHADOW rate, each effective-dated on its
-- own timeline. Every existing row becomes a `main` rate, so nothing existing
-- changes behaviour on the day this lands.
--
-- ⚠ ABSENCE DOES **NOT** FALL BACK HERE. An earlier draft had "no shadow rate
-- means pay the main rate", which silently pays a trainee a full coach's rate —
-- the failure this whole feature exists to fix. The refusal is loud instead,
-- and it is the same refusal generate_coach_payouts already makes for a lesson
-- with no class terms in force.
-- ============================================================================

CREATE TYPE coach_rate_role AS ENUM ('main', 'shadow');

ALTER TABLE coach_rates
  ADD COLUMN role coach_rate_role NOT NULL DEFAULT 'main';

ALTER TABLE coach_rates
  DROP CONSTRAINT coach_rates_coach_id_effective_from_key;

ALTER TABLE coach_rates
  ADD CONSTRAINT coach_rates_coach_id_role_effective_from_key
  UNIQUE (coach_id, role, effective_from);

DROP INDEX IF EXISTS coach_rates_coach_id_effective_from_idx;
CREATE INDEX ON coach_rates (coach_id, role, effective_from DESC);

CREATE OR REPLACE FUNCTION public.coach_rate_on(
  p_coach_id UUID,
  p_date     DATE,
  p_role     coach_rate_role
)
RETURNS TABLE (amount NUMERIC, unit_minutes SMALLINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.amount, r.unit_minutes
    FROM coach_rates r
   WHERE r.coach_id = p_coach_id
     AND r.role = p_role
     AND r.effective_from <= p_date
   ORDER BY r.effective_from DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.coach_rate_on(UUID, DATE, coach_rate_role) IS
  'The rate in force for this coach, in this role, on this date. Returns no '
  'row when none is in force — callers must RAISE rather than treat that as '
  'zero, or a missing rate becomes a silent underpayment.';


-- ============================================================================
-- 6. THE SIX BODIES THAT READ session_coaches.role
--
-- ⚠ DROPPING A COLUMN SILENTLY BREAKS EVERY CLASSIC STRING-BODY FUNCTION THAT
-- READS IT. Postgres records no dependency, so `ALTER TABLE … DROP COLUMN role`
-- succeeds without a word and each of these throws `column sc.role does not
-- exist` at RUNTIME — on a POLICY EXPRESSION, which is an outage, not a bug
-- report. coach_is_main_on_session() is attendance_write's entire USING and
-- WITH CHECK: it throwing means NO COACH IN ANY BUSINESS CAN SAVE ATTENDANCE,
-- and unmarked attendance blocks the billing month with no override (§8i).
--
-- The six were enumerated mechanically, not from memory:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prosrc ~ 'session_coaches';
-- Run it again AFTER applying: no result may contain `role`.
--
-- Every body below was taken from pg_get_functiondef(), never from the
-- migration that first created it (§7.115) — assign_session_coach() had already
-- been replaced once by 20260812000100, and grep finds the oldest first.
--
-- With shadows gone, session_coaches holds AT MOST ONE ROW PER LESSON, so
-- "the row for this lesson" and "the main row for this lesson" are the same
-- thing and `role = 'main'` simply drops out of each predicate.
-- ============================================================================

-- 6.1 READ gate. Gains the class-level shadow arm: a shadow sees the class's
--     WHOLE schedule while assigned, which is the opposite of a substitute,
--     who sees only the lesson they were named on.
CREATE OR REPLACE FUNCTION public.coach_teaches_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM session_coaches sc
     WHERE sc.lesson_session_id = p_session_id
       AND sc.coach_id = current_coach_id()
  ) OR EXISTS (
    SELECT 1 FROM lesson_sessions ls
     WHERE ls.id = p_session_id
       AND coach_is_active_class_shadow(ls.class_id)
  ) OR (
    NOT EXISTS (
      SELECT 1 FROM session_coaches sc2
       WHERE sc2.lesson_session_id = p_session_id
    )
    AND EXISTS (
      SELECT 1 FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_session_id AND c.coach_id = current_coach_id()
    )
  );
$$;

-- 6.2 WRITE gate. UNCHANGED IN MEANING and rewritten in body. A shadow still
--     never marks — that is why the shadow arm added to 6.1 is absent here.
CREATE OR REPLACE FUNCTION public.coach_is_main_on_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT sc.coach_id = current_coach_id()
       FROM session_coaches sc
      WHERE sc.lesson_session_id = p_session_id),
    (SELECT c.coach_id = current_coach_id()
       FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
      WHERE ls.id = p_session_id),
    FALSE
  );
$$;

-- 6.3 Does this coach hold a roster row on any lesson of this class, or is
--     they an active shadow of it? Used by the class/enrolment/booking policies.
--
--     ⚠ IT DOES NOT BECOME A DIRECT LOOKUP. The substitute arm is still
--     per-lesson and keeps its join; only the new arm is cheap.
CREATE OR REPLACE FUNCTION public.coach_rostered_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coach_is_active_class_shadow(p_class_id) OR EXISTS (
    SELECT 1
      FROM session_coaches sc
      JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
     WHERE ls.class_id = p_class_id
       AND sc.coach_id = current_coach_id()
  );
$$;

-- 6.4 Students the current coach can reach BECAUSE OF A ROSTER ROW OR A SHADOW
--     ASSIGNMENT.
--
--     ⚠ THREE SOURCES, ONE PREDICATE, BY CONSTRUCTION. This used to be three
--     near-identical EXISTS blocks, and a reviewer cannot tell a missing arm
--     from a present one — which is how a missing guest arm ships. Missing one
--     is NOT a cosmetic gap: the engine expects the guest, nobody can mark
--     them, the month will not close, there is no override (§8i) and no screen
--     anywhere says why. The UNION ALL makes all three consume the same
--     coach_rostered_in_class() call.
--
--     Still a SEPARATE function from coach_serves_student(), which authorizes
--     set_students_active() — a coach covering one hour must not be able to
--     deactivate a child across the whole business.
CREATE OR REPLACE FUNCTION public.coach_rostered_with_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT e.class_id
          FROM student_class_enrolments e
         WHERE e.student_id = p_student_id AND e.is_active
        UNION ALL
        SELECT tb.class_id FROM trial_bookings  tb WHERE tb.student_id = p_student_id
        UNION ALL
        SELECT mb.class_id FROM makeup_bookings mb WHERE mb.student_id = p_student_id
      ) src(class_id)
     WHERE coach_rostered_in_class(src.class_id)
  );
$$;

-- 6.5 The substitute writer. DELETE-then-INSERT inside one function, because
--     PostgREST's .upsert() cannot target a partial unique index — and the
--     index stops being partial in section 9, but the RPC stays because a
--     FUTURE lesson has no lesson_sessions row for a direct insert to reference.
CREATE OR REPLACE FUNCTION public.set_session_main_coach(p_session_id UUID, p_coach_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_admin_tenant(session_tenant(p_session_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  DELETE FROM session_coaches WHERE lesson_session_id = p_session_id;

  INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
  VALUES ('00000000-0000-0000-0000-000000000000', p_session_id, p_coach_id, auth.uid());
END;
$$;


-- ============================================================================
-- 7. PAY — ONE ordered function, so the predicate and the rate cannot disagree
--
-- ⚠ A BOOLEAN PREDICATE CANNOT SAY **WHICH** ARM MATCHED, AND THAT IS THE BUG.
-- One coach can satisfy two arms at once: T shadows the class all term, and on
-- the 12th T also covers because the main coach is sick. If the predicate
-- returns a bare boolean, session_pay_amount() has to re-derive which arm won
-- in order to pick a rate — two places encoding one rule, which is §7.129
-- exactly, inside the very function §7.129 was written about. §7.129 cost this
-- codebase a real double payment (Coach A 30.00 + Coach B 50.00 on one 50.00
-- lesson).
--
-- So the ORDER IS THE FUNCTION. coach_attributed_to_session() becomes a thin
-- `IS NOT NULL` over it, keeping its name and signature because the payout
-- builder's selection query and its GRANT both reference it.
--
-- SUBSTITUTE BEATS SHADOW. They actually taught it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.coach_attribution_kind(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class UUID;
  v_date  DATE;
BEGIN
  IF p_coach_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ls.class_id, ls.session_date INTO v_class, v_date
    FROM lesson_sessions ls WHERE ls.id = p_session_id;

  IF v_class IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. SUBSTITUTE — a roster row names them for this one lesson.
  IF EXISTS (
    SELECT 1 FROM session_coaches sc
     WHERE sc.lesson_session_id = p_session_id AND sc.coach_id = p_coach_id
  ) THEN
    RETURN 'substitute';
  END IF;

  -- 2. TERMS — nobody is covering, and the class's terms paid them on that
  --    date. This is the ordinary case and the only one that existed before
  --    Wave 3.
  IF NOT EXISTS (
        SELECT 1 FROM session_coaches sc WHERE sc.lesson_session_id = p_session_id)
     AND EXISTS (
        SELECT 1 FROM class_rate_on(v_class, v_date) r
         WHERE r.paid_coach_id = p_coach_id)
  THEN
    RETURN 'terms';
  END IF;

  -- 3. SHADOW — assigned to the class on that date, and NOT recorded absent.
  --    The absence test belongs to this arm alone: a substitute's presence is
  --    proved by them marking the lesson.
  IF coach_shadowed_class_on(v_class, v_date, p_coach_id)
     AND NOT EXISTS (
        SELECT 1 FROM session_coach_absences a
         WHERE a.lesson_session_id = p_session_id AND a.coach_id = p_coach_id)
  THEN
    RETURN 'shadow';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.coach_attribution_kind(UUID, UUID) IS
  'WHY this coach is owed something for this lesson: substitute / terms / '
  'shadow, or NULL for nothing. Ordered — substitute beats shadow, because a '
  'coach can be both. The rate choice reads this, never a second copy of the '
  'rule (§7.129).';

CREATE OR REPLACE FUNCTION public.coach_attributed_to_session(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coach_attribution_kind(p_session_id, p_coach_id) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.session_pay_amount(
  p_session_id UUID,
  p_coach_id   UUID
)
RETURNS TABLE (amount NUMERIC, basis TEXT, minutes SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date   DATE;
  v_class  UUID;
  v_mins   SMALLINT;
  v_flat   NUMERIC;
  v_amt    NUMERIC;
  v_unit   SMALLINT;
  v_terms  UUID;
  v_kind   TEXT;
BEGIN
  SELECT ls.session_date, ls.class_id,
         EXTRACT(EPOCH FROM (c.end_time - c.start_time)) / 60
    INTO v_date, v_class, v_mins
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = p_session_id;

  IF v_date IS NULL OR p_coach_id IS NULL THEN
    RETURN;
  END IF;

  -- A coach this lesson is not attributed to is owed NOTHING for it. This is
  -- what makes "the substituted coach is paid nothing" survive a correction:
  -- the adjustment loop asks what they are owed NOW, gets nothing, and the
  -- difference against what they were paid is a clawback.
  v_kind := coach_attribution_kind(p_session_id, p_coach_id);
  IF v_kind IS NULL THEN
    RETURN;
  END IF;

  SELECT r.paid_coach_id INTO v_terms FROM class_rate_on(v_class, v_date) r;

  IF v_terms IS NULL THEN
    RAISE EXCEPTION
      'no class terms in force for class % on % — refusing to price this lesson',
      v_class, v_date;
  END IF;

  -- A class FLAT amount is a property of the class's own coach TEACHING it.
  -- A substitute falls through to their own rate, and a SHADOW falls through
  -- for the same reason — they are not teaching it at all. Written as the
  -- condition rather than a note, so a flat-rate class inherits it without
  -- anyone having to remember. (No flat-rate class exists yet.)
  IF v_kind <> 'shadow' AND p_coach_id = v_terms THEN
    SELECT o.flat_amount INTO v_flat
      FROM class_rate_overrides o
     WHERE o.class_id = v_class AND o.effective_from <= v_date
     ORDER BY o.effective_from DESC
     LIMIT 1;

    IF v_flat IS NOT NULL THEN
      RETURN QUERY SELECT v_flat, 'flat'::TEXT, v_mins;
      RETURN;
    END IF;
  END IF;

  SELECT r.amount, r.unit_minutes INTO v_amt, v_unit
    FROM coach_rate_on(
           p_coach_id,
           v_date,
           CASE WHEN v_kind = 'shadow' THEN 'shadow' ELSE 'main' END::coach_rate_role
         ) r;

  -- ⚠ A SHADOW WITH NO SHADOW RATE IS A REFUSAL, NOT A ZERO AND NOT A FALLBACK.
  -- Falling back to their main rate pays a trainee a full coach's rate, which
  -- is the thing this feature exists to stop; returning nothing drops them off
  -- payroll in silence, which is worse. Same refusal, same reason, as the
  -- "no class terms in force" one above.
  IF v_amt IS NULL AND v_kind = 'shadow' THEN
    RAISE EXCEPTION
      'coach % has no shadow rate in force on % — refusing to price this '
      'lesson rather than pay the wrong rate', p_coach_id, v_date;
  END IF;

  IF v_amt IS NULL THEN
    RETURN;   -- no main rate in effect: this coach is not on payroll
  END IF;

  RETURN QUERY SELECT ROUND(v_amt * (v_mins::NUMERIC / v_unit), 2), 'duration'::TEXT, v_mins;
END;
$$;

-- The one-arg compat form. Resolves "whose lesson is it" and delegates.
CREATE OR REPLACE FUNCTION public.session_pay_amount(p_session_id UUID)
RETURNS TABLE (amount NUMERIC, basis TEXT, minutes SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach UUID;
BEGIN
  SELECT sc.coach_id INTO v_coach
    FROM session_coaches sc
   WHERE sc.lesson_session_id = p_session_id;

  IF v_coach IS NULL THEN
    SELECT r.paid_coach_id INTO v_coach
      FROM lesson_sessions ls
      CROSS JOIN LATERAL class_rate_on(ls.class_id, ls.session_date) r
     WHERE ls.id = p_session_id;
  END IF;

  RETURN QUERY SELECT * FROM session_pay_amount(p_session_id, v_coach);
END;
$$;


-- ============================================================================
-- 8. THE ASSIGNMENT RPCs
--
-- The admin never handles a class_shadow_coaches id when assigning; ending one
-- names the (class, coach) pair, which is unique among ACTIVE rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_class_shadow(
  p_class_id       UUID,
  p_coach_id       UUID,
  p_effective_from DATE DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_from   DATE := COALESCE(p_effective_from, today_sg());
  v_id     UUID;
BEGIN
  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'a shadow assignment cannot start in the future (got %)', v_from;
  END IF;

  -- ⚠ ALSO ENFORCED BY trg_class_shadow_guard, DELIBERATELY TWICE. This copy
  -- names the failure in the admin's own words; the trigger is what covers every
  -- caller that is not this function, including a direct PostgREST write, which
  -- is how this rule was measured to be bypassable.
  IF EXISTS (SELECT 1 FROM classes c
              WHERE c.id = p_class_id AND c.coach_id = p_coach_id) THEN
    RAISE EXCEPTION
      'that coach already teaches this class — they cannot also shadow it';
  END IF;

  -- The trigger enforces this too; this copy exists for the wording.
  PERFORM assert_payout_month_open(v_tenant, v_from, 'start a shadow assignment');

  INSERT INTO class_shadow_coaches
    (tenant_id, class_id, coach_id, effective_from, assigned_by)
  VALUES
    ('00000000-0000-0000-0000-000000000000', p_class_id, p_coach_id, v_from, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_class_shadow(
  p_class_id     UUID,
  p_coach_id     UUID,
  p_effective_to DATE DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_to     DATE := COALESCE(p_effective_to, today_sg());
  v_from   DATE;
BEGIN
  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  SELECT s.effective_from INTO v_from
    FROM class_shadow_coaches s
   WHERE s.class_id = p_class_id AND s.coach_id = p_coach_id AND s.effective_to IS NULL;

  IF v_from IS NULL THEN
    RAISE EXCEPTION 'that coach is not currently shadowing this class';
  END IF;

  IF v_to < v_from THEN
    RAISE EXCEPTION
      'a shadow assignment cannot end (%) before it started (%)', v_to, v_from;
  END IF;

  -- Ending an assignment CHANGES PAY for every lesson after the end date, so it
  -- is sealed on exactly the same terms as starting one.
  PERFORM assert_payout_month_open(v_tenant, v_to, 'end a shadow assignment');

  UPDATE class_shadow_coaches
     SET effective_to = v_to, ended_by = auth.uid(), ended_at = NOW()
   WHERE class_id = p_class_id AND coach_id = p_coach_id AND effective_to IS NULL;
END;
$$;


-- ============================================================================
-- 9. session_coaches SIMPLIFIES — it is the SUBSTITUTE table now
--
-- At most one row per lesson. The partial unique index becomes a plain one.
-- ============================================================================

-- Local fixture state only: production holds zero session_coaches rows of any
-- kind. Without this the UNIQUE below would fail on a lesson that has both a
-- main and a shadow.
DELETE FROM session_coaches WHERE role = 'shadow';

DROP INDEX one_main_coach_per_session;

ALTER TABLE session_coaches DROP COLUMN role;

ALTER TABLE session_coaches
  ADD CONSTRAINT one_substitute_per_session UNIQUE (lesson_session_id);


-- ============================================================================
-- 10. assign_session_coach — 3-arg, plus the 4-arg COMPAT SHIM
--
-- ⚠ §7.123: A CHANGED SIGNATURE IS A LIVE BREAKAGE UNLESS THE OLD ONE SURVIVES
-- THE WINDOW. Migrations go out before the Vercel build of `main`, so between
-- `supabase db push` and that build the DEPLOYED admin panel is still calling
-- the 4-arg form. Without the shim, assigning any coach to any lesson is broken
-- in production for that window — the same failure, on the same page, as the
-- one measured on 2026-08-11.
--
-- The ENUM and the COLUMN therefore part company: the column goes above, the
-- TYPE survives here for the shim's argument list. A follow-up migration drops
-- the shim and the type once the app build is confirmed live — filed in
-- BACKLOG.md so it cannot be forgotten. One schema change in flight (§7.55).
--
-- \df assign_session_coach must show exactly TWO rows after this migration.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session UUID;
BEGIN
  IF NOT can_admin_tenant(class_tenant(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NULL THEN
    -- Refuse a date the class does not run on. A roster row against a
    -- fabricated date is a lesson that will be marked, paid and BILLED on a day
    -- the class never met. An existing row is honoured either way, because a
    -- rescheduled or extra lesson is legitimately off-pattern.
    PERFORM assert_class_runs_on(p_class_id, p_session_date);

    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT (class_id, session_date) DO NOTHING;

    SELECT ls.id INTO v_session
      FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;
  END IF;

  PERFORM set_session_main_coach(v_session, p_coach_id);

  RETURN v_session;
END;
$$;

-- The shim. Same signature as the function that is deployed today, so this is a
-- plain CREATE OR REPLACE and its GRANT carries forward.
CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID,
  p_role         session_coach_role
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Compat shim for the deployed admin panel across the §7.123 window. Dropped
  -- by the follow-up migration once Vercel has built main. 'shadow' is no
  -- longer a lesson-level concept, so it is REFUSED LOUDLY, never ignored —
  -- silently treating it as a main assignment would move a lesson's pay.
  IF p_role <> 'main' THEN
    RAISE EXCEPTION
      'shadows are now assigned to the whole class, not to one lesson — '
      'reload this page and use the Classes page';
  END IF;

  RETURN assign_session_coach(p_class_id, p_session_date, p_coach_id);
END;
$$;


-- ============================================================================
-- 11. set_class_terms — refuse a handover ONTO an active shadow
--
-- ⚠ GATED ON A CHANGING coach_id, AND PLACED BEFORE THE `UPDATE classes`.
-- This function runs on EVERY class edit — a rename or a time change sends the
-- UNCHANGED p_coach_id through the same path — so an ungated check would make a
-- shadowed class permanently uneditable. And the function RETURNS EARLY when
-- only money is unchanged, so a guard below that line would never run for a
-- rename at all.
--
-- It cannot fire for an assignment that has already ENDED, so history never
-- blocks a handover. The admin's flow is: end the shadow, then hand the class
-- over. Doing it in the other order is what this refuses.
--
-- The 11-argument signature is UNCHANGED, so this is a plain CREATE OR REPLACE
-- with no §7.123 exposure.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_class_terms(
  p_class_id         UUID,
  p_title            TEXT,
  p_day_of_week      day_of_week,
  p_start_time       TIME,
  p_end_time         TIME,
  p_location_name    TEXT,
  p_price_per_lesson NUMERIC,
  p_coach_id         UUID,
  p_effective_from   DATE    DEFAULT NULL,
  p_correct_in_place BOOLEAN DEFAULT FALSE,
  p_location_address TEXT    DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_from     DATE := COALESCE(p_effective_from, today_sg());
  v_cur      RECORD;
  v_old      JSONB;
  v_month    TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to edit this class';
  END IF;

  IF p_price_per_lesson IS NULL OR p_price_per_lesson < 0 THEN
    -- Checked BEFORE any coercion. A blank field reaching Number() is how a
    -- $0 wage rate shipped, and how an unset run day became day 1.
    RAISE EXCEPTION 'price per lesson must be zero or more';
  END IF;

  -- The coach must belong to THIS business. The engine bypasses RLS and this
  -- function is SECURITY DEFINER, so neither would catch a cross-tenant id.
  IF NOT EXISTS (
    SELECT 1 FROM coaches c WHERE c.id = p_coach_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that coach does not belong to this business';
  END IF;

  -- ── The handover guard ──────────────────────────────────────────────────
  -- Only when the coach is actually CHANGING, and before anything is written.
  --
  -- ⚠ THE `IS DISTINCT FROM` GATE IS DEFENCE IN DEPTH, NOT THE LOAD-BEARING
  -- PART, and it is worth knowing which. Because the EXISTS is keyed on
  -- p_coach_id, and because assign_class_shadow() refuses the class's own coach,
  -- "the class's coach is also an active shadow of it" is unbuildable — so the
  -- gate cannot currently fire. Measured: removing it turns NO test red.
  -- What the gate protects against is the BROADER spelling a future edit invites
  -- — "does this class have ANY active shadow" — which makes a shadowed class
  -- permanently unrenameable. That form DOES turn class_shadow_coaches.test.sql
  -- case 10b red, which is why the case exists and why the narrow form stays.
  IF p_coach_id IS DISTINCT FROM (SELECT c.coach_id FROM classes c WHERE c.id = p_class_id)
     AND EXISTS (
       SELECT 1 FROM class_shadow_coaches s
        WHERE s.class_id = p_class_id
          AND s.coach_id = p_coach_id
          AND s.effective_to IS NULL)
  THEN
    RAISE EXCEPTION
      'that coach is currently shadowing this class — end their shadow '
      'assignment first, then hand the class over. Their past shadow pay is '
      'kept either way.';
  END IF;

  -- No future-dating. The display sync (classes.price_per_lesson) tracks the
  -- rate in force TODAY and nothing re-runs it when a future date merely
  -- arrives, so a future row would show the wrong price until something
  -- happened to touch the class. Relax this and the sync together, not alone.
  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'terms cannot start in the future (got %)', v_from;
  END IF;

  -- ── Non-dated attributes ────────────────────────────────────────────────
  -- classes.coach_id follows the CURRENT teacher: it drives access (RLS) and
  -- display. Historical pay attribution lives in class_rates and is untouched
  -- by this write — that separation is the point of 20260719000800.
  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET title            = p_title,
         day_of_week      = p_day_of_week,
         start_time       = p_start_time,
         end_time         = p_end_time,
         location_name    = p_location_name,
         location_address = p_location_address,
         coach_id         = p_coach_id,
         updated_at       = NOW()
   WHERE id = p_class_id;

  -- ── Money: only if it actually moved ────────────────────────────────────
  SELECT r.price_per_lesson, r.paid_coach_id
    INTO v_cur
    FROM class_rate_on(p_class_id, v_from) r;

  IF v_cur.price_per_lesson IS NOT DISTINCT FROM p_price_per_lesson
     AND v_cur.paid_coach_id IS NOT DISTINCT FROM p_coach_id THEN
    RETURN;   -- a rename or a time change: nothing dated to record
  END IF;

  -- Settled money must not move under either intent. A correction rewrites
  -- history outright; a change from date D reprices every lesson on or after
  -- it. Both are refused once that period has been invoiced or paid out.
  v_month := to_char(v_from, 'YYYY-MM');

  IF EXISTS (
    SELECT 1 FROM billing_periods bp
     WHERE bp.tenant_id = v_tenant AND bp.billing_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — % or a later month has already been '
      'invoiced and sealed. Issue a credit note instead.', v_from, v_month;
  END IF;

  IF EXISTS (
    SELECT 1 FROM coach_payouts cp
     WHERE cp.tenant_id = v_tenant AND cp.status = 'paid'
       AND cp.period_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — a coach payout for % or later has already '
      'been paid. The correction will surface as an adjustment instead.',
      v_from, v_month;
  END IF;

  IF p_correct_in_place THEN
    -- Rewrite the row currently in force. There was never a period at the old
    -- number, so no new row is created and history reads as if the typo never
    -- happened.
    UPDATE class_rates r
       SET price_per_lesson = p_price_per_lesson,
           paid_coach_id    = p_coach_id
     WHERE r.class_id = p_class_id
       AND r.effective_from = (
         SELECT MAX(r2.effective_from) FROM class_rates r2
          WHERE r2.class_id = p_class_id AND r2.effective_from <= v_from
       );
  ELSE
    INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
    VALUES (p_class_id, p_price_per_lesson, p_coach_id, v_from)
    ON CONFLICT (class_id, effective_from)
    DO UPDATE SET price_per_lesson = EXCLUDED.price_per_lesson,
                  paid_coach_id    = EXCLUDED.paid_coach_id;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (
    v_actor,
    CASE WHEN p_correct_in_place THEN 'class_terms_corrected'
         ELSE 'class_terms_changed' END,
    'Class',
    p_class_id,
    v_old,
    jsonb_build_object(
      'effective_from',   v_from,
      'price_per_lesson', p_price_per_lesson,
      'paid_coach_id',    p_coach_id,
      'class',            (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id)
    ),
    v_tenant
  );
END;
$$;


-- ============================================================================
-- 12. GRANTS — §7.87
--
-- A new function is callable by NOBODY until its own migration grants it, and
-- DROP+CREATE does not carry a grant the way CREATE OR REPLACE does (§7.124).
-- assign_session_coach's 4-arg form keeps its existing grant because the shim
-- replaced it in place; the 3-arg form is a NEW signature and needs its own.
-- ============================================================================

REVOKE ALL ON FUNCTION public.coach_is_active_class_shadow(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_shadowed_class_on(UUID, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_rate_on(UUID, DATE, coach_rate_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_attribution_kind(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_payout_month_open(UUID, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_class_shadow(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_class_shadow(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_session_coach(UUID, DATE, UUID) FROM PUBLIC;

-- Read by policies, so `authenticated` must be able to evaluate them.
GRANT EXECUTE ON FUNCTION public.coach_is_active_class_shadow(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_shadowed_class_on(UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_rate_on(UUID, DATE, coach_rate_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_attribution_kind(UUID, UUID) TO authenticated;

-- The admin's two assignment RPCs.
GRANT EXECUTE ON FUNCTION public.assign_class_shadow(UUID, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_class_shadow(UUID, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_session_coach(UUID, DATE, UUID) TO authenticated;

-- assert_payout_month_open() is an internal helper called only from other
-- SECURITY DEFINER bodies and from a trigger. It is deliberately NOT granted:
-- nothing outside the database ever calls it.


-- ============================================================================
-- 13. THE PAYOUT BUILDER
--
-- Three changes, and no more than three:
--   · a PRE-FLIGHT refusal for a shadow with no shadow rate, in the same place
--     and the same style as the "no class terms in force" one above it;
--   · a comment pinning the on-payroll EXISTS as deliberately ROLE-BLIND;
--   · Adjustments B's driving query gains the class-shadow arm.
--
-- ⚠ ADJUSTMENTS B WAS DRIVEN FROM session_coaches ALONE, AND A CLASS SHADOW HAS
-- NO ROW THERE. Left as it was, a shadow newly owed money for a settled period
-- would be invisible to it — and Adjustments A cannot see them either, because
-- it is driven FROM coach_payout_items and they have no item. Neither loop could
-- ever visit that (coach, lesson) pair: a PERMANENT SILENT UNDERPAYMENT. The
-- seal in section 2.1 is what makes that unreachable today; this arm is what
-- makes it stay unreachable if the seal is ever relaxed. Three lines, and it
-- removes the failure mode rather than merely guarding it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_coach_payouts(
  p_tenant_id    UUID,
  p_period_month TEXT
)
RETURNS TABLE (coach_id UUID, coach_name TEXT, gross NUMERIC, status TEXT, items INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_coach RECORD;
  v_pay   RECORD;
  v_sess  RECORD;
  v_payout UUID;
  v_gross NUMERIC;
  v_items INT;
  v_status payout_status;
  v_bad   RECORD;
BEGIN
  IF NOT can_admin_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'not permitted to run payroll for this business';
  END IF;

  IF p_period_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'period must be YYYY-MM';
  END IF;

  v_start := (p_period_month || '-01')::DATE;
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- A lesson whose class has no terms in force belongs to NO coach, so it would
  -- vanish from every payout rather than raise. Check the whole period up front
  -- and refuse: a silent underpayment is the failure mode this cluster exists
  -- to remove, and it must not be reintroduced by a quiet skip.
  --
  -- CARRIED THROUGH WAVE 3 UNCHANGED, AND IT CAUGHT THE WAVE'S OWN REGRESSION.
  -- The first draft of this rewrite dropped this block and moved attribution
  -- into the selection query's WHERE, where a NULL paid_coach_id simply fails
  -- to match and the lesson leaves payroll in silence — the exact "quiet skip"
  -- the paragraph above forbids. coach_wages.test.sql 33 went red on it.
  IF EXISTS (
    SELECT 1
      FROM lesson_sessions ls
      JOIN classes c ON c.id = ls.class_id
     WHERE c.tenant_id = p_tenant_id
       AND ls.session_date BETWEEN v_start AND v_end
       AND NOT EXISTS (
         SELECT 1 FROM class_rates r
          WHERE r.class_id = ls.class_id AND r.effective_from <= ls.session_date
       )
  ) THEN
    RAISE EXCEPTION
      'a lesson in % has no class terms in force — refusing to run payroll '
      'rather than silently underpay', p_period_month;
  END IF;

  -- ── The same refusal, for a shadow with no SHADOW rate ──────────────────
  -- The user's decision, taken deliberately over a fallback to the coach's main
  -- rate: falling back pays a trainee a full coach's rate, which is the thing
  -- the shadow rate exists to prevent. Loud beats wrong.
  --
  -- This covers the period being RUN. session_pay_amount() raises on the same
  -- condition, which is the backstop for a historical lesson reached through
  -- the adjustment loops — that message names the coach and the date too.
  SELECT co.id, p.full_name AS coach_name, c.title AS class_title, ls.session_date
    INTO v_bad
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    JOIN class_shadow_coaches s
      ON s.class_id = ls.class_id
     AND s.effective_from <= ls.session_date
     AND (s.effective_to IS NULL OR s.effective_to >= ls.session_date)
    JOIN coaches co ON co.id = s.coach_id
    JOIN profiles p ON p.id = co.profile_id
   WHERE c.tenant_id = p_tenant_id
     AND ls.session_date BETWEEN v_start AND v_end
     -- ⚠ ONLY WHERE THE SHADOW IS ACTUALLY OWED SOMETHING. Without these two
     -- the refusal is strictly stricter than session_pay_amount(): a shadow the
     -- main coach unticked on every lesson, or one whose lessons were all
     -- coach-cancelled, is owed nothing anywhere — and payroll for the WHOLE
     -- business would still refuse, with no override, for a non-condition.
     AND coach_attribution_kind(ls.id, s.coach_id) = 'shadow'
     AND session_pays_coach(ls.id)
     AND NOT EXISTS (
       SELECT 1 FROM coach_rates r
        WHERE r.coach_id = s.coach_id
          AND r.role = 'shadow'
          AND r.effective_from <= ls.session_date
     )
   ORDER BY ls.session_date
   LIMIT 1;

  IF v_bad.id IS NOT NULL THEN
    RAISE EXCEPTION
      'a shadow coach has no shadow rate in force — refusing to run payroll '
      'rather than pay the wrong rate: % on %, %',
      v_bad.coach_name, v_bad.class_title, v_bad.session_date;
  END IF;

  FOR v_coach IN
    SELECT c.id, p.full_name
      FROM coaches c JOIN profiles p ON p.id = c.profile_id
     WHERE c.tenant_id = p_tenant_id
       -- On payroll only if a rate exists at all. A private coach has none.
       --
       -- ⚠ DELIBERATELY ROLE-BLIND. A coach who holds ONLY a shadow rate must
       -- still enter this loop, or their pay is skipped in silence before the
       -- refusal above can ever fire. Do not add `AND r.role = 'main'`.
       AND EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)
     ORDER BY p.full_name
  LOOP
    SELECT cp.id, cp.status INTO v_payout, v_status
      FROM coach_payouts cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.coach_id = v_coach.id
       AND cp.period_month = p_period_month;

    IF v_status = 'paid' THEN
      SELECT cp.gross_amount INTO v_gross FROM coach_payouts cp WHERE cp.id = v_payout;
      SELECT COUNT(*) INTO v_items FROM coach_payout_items WHERE payout_id = v_payout;
      RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'paid'::TEXT, v_items;
      CONTINUE;
    END IF;

    IF v_payout IS NULL THEN
      INSERT INTO coach_payouts (tenant_id, coach_id, period_month)
      VALUES (p_tenant_id, v_coach.id, p_period_month)
      RETURNING id INTO v_payout;
    ELSE
      DELETE FROM coach_payout_items WHERE payout_id = v_payout;
    END IF;

    v_gross := 0;
    v_items := 0;

    -- ---- This period's own sessions -------------------------------------
    -- Three sources now, all behind ONE predicate: the roster names this coach
    -- as the substitute, OR nobody is covering and the class's terms paid them
    -- on that date, OR they were an assigned class shadow and were not recorded
    -- absent. coach_attribution_kind() is the ordered form of that rule and
    -- session_pay_amount() reads the SAME call, so the two cannot disagree.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = p_tenant_id
         AND ls.session_date BETWEEN v_start AND v_end
         AND coach_attributed_to_session(ls.id, v_coach.id)
       ORDER BY ls.session_date
    LOOP
      CONTINUE WHEN NOT session_pays_coach(v_sess.id);

      SELECT * INTO v_pay FROM session_pay_amount(v_sess.id, v_coach.id);
      CONTINUE WHEN v_pay.amount IS NULL;

      DECLARE
        v_carried NUMERIC;
        v_net     NUMERIC;
      BEGIN
        -- Net out anything already carried for this session on another payout.
        -- Without this, an admin who re-runs a settled period AFTER a later
        -- period already carried the correction pays the same money twice.
        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);
        v_net := v_pay.amount - v_carried;

        IF v_net <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis, minutes, amount)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             v_pay.basis, v_pay.minutes, v_net);

          v_gross := v_gross + v_net;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    -- ---- Adjustments A: sessions already paid, whose pay has since changed
    FOR v_sess IN
      SELECT i.lesson_session_id AS id, i.session_date, i.class_title AS title,
             i.amount AS paid_amount, prev.period_month AS orig
        FROM coach_payout_items i
        JOIN coach_payouts prev ON prev.id = i.payout_id
       WHERE prev.tenant_id = p_tenant_id
         AND prev.coach_id = v_coach.id
         AND prev.status = 'paid'
         AND prev.period_month < p_period_month
         AND NOT i.is_adjustment
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        SELECT COALESCE(SUM(i2.amount), 0) INTO v_carried
          FROM coach_payout_items i2
          JOIN coach_payouts p2 ON p2.id = i2.payout_id
         WHERE p2.tenant_id = p_tenant_id
           AND p2.coach_id = v_coach.id
           AND i2.lesson_session_id = v_sess.id
           AND i2.is_adjustment
           AND p2.id <> v_payout;

        v_diff := v_now - v_sess.paid_amount - v_carried;

        IF v_diff <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis,
             amount, is_adjustment, original_period)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             'adjustment', v_diff, TRUE, v_sess.orig)
          ON CONFLICT DO NOTHING;
          v_gross := v_gross + v_diff;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    -- ---- Adjustments B: NEWLY OWED for a settled period -------------------
    --
    -- Adjustments A is driven FROM EXISTING ITEMS, so it can only ever visit a
    -- coach who was already paid something in that period. A substitute named
    -- after the month was settled has no item and no payout at all, so their
    -- money is invisible to it: A's -$40 lands and B's +$55 never does.
    --
    -- ⚠ TWO SOURCES OF CANDIDATE, NOT ONE. A class shadow holds no
    -- session_coaches row, so the substitute arm alone cannot see them. Both
    -- arms are only a CANDIDATE set — session_pay_amount() applies the real
    -- attribution, so being slightly wide here costs nothing and being narrow
    -- costs a coach their money.
    --
    -- Same three-term form as A, with paid_originally = 0, and the SAME
    -- carried-once helper — written as "emit once then suppress" it would
    -- re-emit forever, which is exactly the bug 20260719000900 closed.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title,
             to_char(ls.session_date, 'YYYY-MM') AS orig
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = p_tenant_id
         AND ls.session_date < v_start
         AND (
           EXISTS (SELECT 1 FROM session_coaches sc
                    WHERE sc.lesson_session_id = ls.id
                      AND sc.coach_id = v_coach.id)
           OR coach_shadowed_class_on(ls.class_id, ls.session_date, v_coach.id)
         )
         AND EXISTS (
           SELECT 1 FROM coach_payouts settled
            WHERE settled.tenant_id = p_tenant_id
              AND settled.period_month = to_char(ls.session_date, 'YYYY-MM')
              AND settled.status = 'paid'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM coach_payout_items i3
             JOIN coach_payouts p3 ON p3.id = i3.payout_id
            WHERE p3.tenant_id = p_tenant_id
              AND p3.coach_id = v_coach.id
              AND i3.lesson_session_id = ls.id
              AND NOT i3.is_adjustment
         )
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);

        v_diff := v_now - 0 - v_carried;

        IF v_diff <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis,
             amount, is_adjustment, original_period)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             'adjustment', v_diff, TRUE, v_sess.orig)
          ON CONFLICT DO NOTHING;
          v_gross := v_gross + v_diff;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    UPDATE coach_payouts
       SET gross_amount = v_gross, generated_at = NOW()
     WHERE id = v_payout;

    RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'draft'::TEXT, v_items;
  END LOOP;
END;
$$;


-- ============================================================================
-- 14. WHO SHADOWS THIS LESSON — for the coach who is about to mark it
--
-- ⚠ AN RPC, NOT A TABLE READ, AND BOTH HALVES OF THAT ARE FORCED.
--
-- 1. RLS. class_shadow_coaches_select is `admin OR coach_id = current_coach_id()`,
--    so the SUBSTITUTE covering a lesson — the very person who must tick the
--    box — can read NONE of its shadows. Widening that policy would hand every
--    coach the whole business's assignments; this is §7.134's shape exactly, and
--    the answer is the same one: a SECURITY DEFINER gate that can see the row
--    the caller cannot.
--
-- 2. The client cannot be trusted to know WHO IT IS. `me` is resolved from a
--    session that is not always hydrated when a deep-linked screen loads — it
--    comes back NULL and a client-side `coach_id = me.id` filter then silently
--    matches nothing (§7.141). current_coach_id() is evaluated server-side and
--    cannot be absent.
--
-- ⚠ IT TAKES (CLASS, DATE), NOT A SESSION ID, AND THAT IS NOT A CONVENIENCE.
-- lesson_sessions rows are created LAZILY at the first attendance save (PRD
-- §7.5), so on the visit where a coach FIRST marks a lesson there is no session
-- id to ask about. A session-keyed version returns nothing exactly then, and the
-- coach cannot record an absence until they re-open a lesson they have already
-- saved — which is the visit they have no reason to make.
--
-- ⚠ THE DATE RANGE IS THE **LESSON'S**, NOT TODAY'S. This answers a PAY
-- question — "was this coach assigned when the lesson ran" — so a shadow
-- assigned tomorrow must not appear on last week's lesson, and one whose
-- assignment has since ended must still appear on the lessons inside it.
-- coach_is_active_class_shadow() asks the other question and is not usable here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_shadow_coaches(
  p_class_id     UUID,
  p_session_date DATE
)
RETURNS TABLE (coach_id UUID, full_name TEXT, absent BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session UUID;
  v_may     BOOLEAN;
BEGIN
  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NOT NULL THEN
    -- The SAME predicate attendance_write uses, so the list and the save can
    -- never disagree about who may act.
    v_may := coach_is_main_on_session(v_session);
  ELSE
    -- No session row means nobody has been assigned to it — a substitute
    -- assignment creates one — so the class's own coach is its marker by the
    -- absence rule, and they are the only person who may ask.
    v_may := EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = p_class_id AND c.coach_id = current_coach_id()
    );
  END IF;

  IF NOT v_may THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.coach_id,
         p.full_name,
         v_session IS NOT NULL AND EXISTS (
           SELECT 1 FROM session_coach_absences a
            WHERE a.lesson_session_id = v_session
              AND a.coach_id = s.coach_id
         ) AS absent
    FROM class_shadow_coaches s
    JOIN coaches  c ON c.id = s.coach_id
    JOIN profiles p ON p.id = c.profile_id
   WHERE s.class_id = p_class_id
     AND s.effective_from <= p_session_date
     AND (s.effective_to IS NULL OR s.effective_to >= p_session_date)
   ORDER BY p.full_name;
END;
$$;

COMMENT ON FUNCTION public.session_shadow_coaches(UUID, DATE) IS
  'The shadows assigned to this class ON THAT LESSON DATE, with whether each is '
  'already recorded absent. Readable only by the coach who marks that lesson. '
  'SECURITY DEFINER because class_shadow_coaches_select hides a shadow''s row '
  'from the substitute who must tick it (§7.134). Takes (class, date) because '
  'the lesson_sessions row does not exist until the first save.';

REVOKE ALL ON FUNCTION public.session_shadow_coaches(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_shadow_coaches(UUID, DATE) TO authenticated;
