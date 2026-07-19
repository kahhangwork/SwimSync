-- ============================================================
-- CLASS RATES — effective-dated pricing and pay attribution.
--
-- WHAT THIS FIXES. Two live defects of the same shape: a fact about a PAST
-- lesson was resolved by a LIVE lookup instead of being recorded as of the day
-- it happened.
--
--   1. `core.ts` priced each invoice item from `classes.price_per_lesson` at
--      GENERATION time. Editing a class's price on 3 Aug silently repriced
--      every unbilled July lesson. The exposure window is the lesson until the
--      invoice run — up to five weeks at the default run day of the 7th.
--
--   2. `session_pay_amount()` and the payout loop resolved the coach through
--      `classes.coach_id`, also live. Handing a class to another coach moved
--      the ENTIRE unpaid history with it: the outgoing coach's draft payout
--      dropped to zero and the incoming coach was paid, at their own rate, for
--      lessons they never taught.
--
-- Both are the same family as the UTC-derived billing month and as mutable
-- coach rates: a value that looks current being applied to the past. The cure
-- is the one `coach_rates` already uses — read "the row with the latest
-- effective_from that is <= the lesson's date".
--
-- WHY ONE TABLE AND NOT TWO. A row here is a COMPLETE snapshot of a class's
-- commercial terms as of a date: what the parent pays, and which coach earns
-- it. Splitting price and attribution into two effective-dated tables would
-- mean two lookups per lesson and two ways to miss — and a miss is a silently
-- wrong invoice. Changing either one inserts a row carrying both.
--
-- WHAT THIS TABLE DELIBERATELY DOES NOT DO — READ BEFORE EXTENDING.
-- `classes.coach_id` is NOT moved here and MUST NOT BE. It is load-bearing for
-- ROW-LEVEL SECURITY: coach_owns_class(), coach_owns_session(),
-- coach_serves_student() and coach_serves_parent() all resolve access through
-- it (20260309000600_rls_policies.sql:50-81). Moving it would rewrite the
-- largest permission surface in the codebase to fix a billing bug.
--
-- The split is therefore deliberate and load-bearing:
--
--   classes.coach_id       -> ACCESS + DISPLAY. "Who teaches this class now."
--   class_rates.paid_coach -> MONEY. "Who earns this lesson, on its date."
--
-- The consequence, stated so it is never a surprise: a coach who hands over a
-- class immediately loses access to its past lessons (already true today —
-- this changes nothing) while still being paid correctly for them. Late
-- corrections to those lessons are made by the current coach or the admin.
-- ============================================================

CREATE TABLE class_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id          UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  -- What the PARENT pays for one lesson. The billing source of truth;
  -- `classes.price_per_lesson` is a synced display copy (see the trigger below).
  price_per_lesson  NUMERIC(10, 2) NOT NULL CHECK (price_per_lesson >= 0),
  -- Which coach EARNS this lesson. Explicit and NOT NULL rather than "NULL
  -- means fall back to classes.coach_id": a fallback is exactly how the live
  -- lookup bug worked, and it would quietly reintroduce it.
  paid_coach_id     UUID NOT NULL REFERENCES coaches(id),
  effective_from    DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, effective_from)
);

CREATE INDEX ON class_rates (class_id, effective_from DESC);

-- ------------------------------------------------------------
-- Resolve the terms in force for a class on a given date.
--
-- The ONLY sanctioned way to price a lesson or attribute its pay. Returns no
-- row when nothing is in force, which callers MUST treat as a hard error —
-- see the note on the floor date below.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.class_rate_on(p_class_id UUID, p_date DATE)
RETURNS TABLE (price_per_lesson NUMERIC, paid_coach_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.price_per_lesson, r.paid_coach_id
    FROM class_rates r
   WHERE r.class_id = p_class_id
     AND r.effective_from <= p_date
   ORDER BY r.effective_from DESC
   LIMIT 1;
$$;

-- ------------------------------------------------------------
-- Every class has terms from the beginning of time.
--
-- THE FLOOR DATE IS A SAFETY PROPERTY, NOT A DETAIL. Callers treat "no rate in
-- force" as a hard failure that blocks billing, because the alternative —
-- COALESCE to 0 or back to classes.price_per_lesson — is the Number(null)/
-- Number("") failure this codebase has now shipped three times (an unset
-- invoice_run_day clamping to day 1; a blank wage rate saving as $0). A missing
-- rate must be loud.
--
-- That makes it essential no lesson can ever fall BEFORE its class's earliest
-- rate row. Dating the backfill at classes.created_at would do exactly that:
-- attendance is markable a month back, so a lesson legitimately predates the
-- row that created its class. Hence '2000-01-01' — earlier than any SwimSync
-- lesson can be, for backfilled AND newly-created classes alike.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_class_rate()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
  VALUES (NEW.id, NEW.price_per_lesson, NEW.coach_id, DATE '2000-01-01')
  ON CONFLICT (class_id, effective_from) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER classes_seed_rate
  AFTER INSERT ON classes
  FOR EACH ROW EXECUTE FUNCTION seed_class_rate();

-- Backfill: one floor-dated row per existing class, from its current values.
-- Correct by emptiness — production has zero lesson_sessions today, so there is
-- no history for these terms to be wrong about. This is the cheapest this
-- migration will ever be; after real attendance exists, a backfill would be a
-- plausible guess written into a payroll record.
INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
SELECT c.id, c.price_per_lesson, c.coach_id, DATE '2000-01-01'
  FROM classes c
ON CONFLICT (class_id, effective_from) DO NOTHING;

-- ------------------------------------------------------------
-- Keep classes.price_per_lesson as a DISPLAY copy.
--
-- Every screen that shows "what this class costs" keeps reading the column it
-- already reads — no display path is touched by this migration. Syncing it
-- from one writer is what stops the two becoming a second source of truth,
-- which is the drift disease this codebase has fought twice already
-- (is_active vs assignment_status; lessonDates.ts duplicated across apps).
--
-- "Current" means the row in force TODAY, not the newest row outright, so a
-- future-dated rate does not change the displayed price before it starts.
-- Known limitation: nothing re-syncs when that date merely arrives. Rather
-- than add a daily job, set_class_terms() (a later step) refuses a
-- future-dated effective_from. Relax both together if future-dating is ever
-- wanted.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_class_display_price()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class UUID := COALESCE(NEW.class_id, OLD.class_id);
  v_price NUMERIC;
BEGIN
  SELECT r.price_per_lesson INTO v_price
    FROM class_rates r
   WHERE r.class_id = v_class AND r.effective_from <= CURRENT_DATE
   ORDER BY r.effective_from DESC
   LIMIT 1;

  -- IS DISTINCT FROM: a no-op write would bump classes.updated_at on every
  -- rate insert, including the seeding one, for no change.
  UPDATE classes
     SET price_per_lesson = v_price
   WHERE id = v_class
     AND v_price IS NOT NULL
     AND price_per_lesson IS DISTINCT FROM v_price;

  RETURN NULL;
END;
$$;

CREATE TRIGGER class_rates_sync_display
  AFTER INSERT OR UPDATE OR DELETE ON class_rates
  FOR EACH ROW EXECUTE FUNCTION sync_class_display_price();

COMMENT ON COLUMN classes.price_per_lesson IS
  'DISPLAY ONLY — synced from class_rates by class_rates_sync_display. NOT the '
  'billing source: invoices and payroll price a lesson via class_rate_on(class, '
  'session_date). Writing here directly does not change what anyone is charged.';

-- ------------------------------------------------------------
-- RLS.
--
-- A new table does NOT inherit row-level security: CREATE TABLE leaves it OFF,
-- and a table with policies but RLS disabled reads as though the policies were
-- never written. Three tenancy tables shipped that way in development and left
-- every join code world-readable. Hence the explicit ENABLE below.
--
-- Scope matches class_rate_overrides: the business's admin manages its own
-- classes' terms. Coaches get SELECT because their own payout detail is built
-- from these rows, and price is not a secret from them — it already appears on
-- every invoice they can read. Amounts a coach is PAID stay in coach_rates,
-- which remains admin-only, so a colleague's earnings are still not inferable.
-- ------------------------------------------------------------

ALTER TABLE class_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_rates_admin ON class_rates FOR ALL TO authenticated
  USING (can_admin_tenant(class_tenant(class_id)))
  WITH CHECK (can_admin_tenant(class_tenant(class_id)));

CREATE POLICY class_rates_coach_select ON class_rates FOR SELECT TO authenticated
  USING (paid_coach_id = current_coach_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON class_rates TO authenticated;
GRANT ALL ON class_rates TO service_role;
