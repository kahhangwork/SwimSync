-- ============================================================
-- Phase 5: coach wages — schema.
--
-- SwimSync has always tracked money coming IN from parents and nothing going
-- OUT to coaches. The moment a coach is not also the business owner, payroll is
-- a spreadsheet rebuilt by hand each month from attendance the app already
-- holds. This is the other half of the loop.
--
-- NO private-vs-school BRANCH ANYWHERE (TENANCY_DESIGN.md §1). A wage exists
-- when a coach HAS A RATE. A private coach simply has none — they are paid by
-- their parents' invoices, and there is nobody upstream to pay them. Data
-- driven, not a rule, which also lets a school owner who teaches pay themselves
-- if they want to.
-- ============================================================

-- ------------------------------------------------------------
-- Per-tenant wage policy.
-- ------------------------------------------------------------

ALTER TABLE tenants
  -- Does a rained-off lesson pay the coach? The coach travelled to a closed
  -- pool, so schools differ. Per-session override lives in
  -- session_pay_overrides; this is the default that applies when there is none.
  ADD COLUMN rain_pays_coach BOOLEAN NOT NULL DEFAULT FALSE,
  -- Independent of invoice_run_day: a school may bill parents on the 7th and
  -- pay coaches on the 15th. Collect before you disburse.
  ADD COLUMN wage_run_day SMALLINT NOT NULL DEFAULT 15
    CHECK (wage_run_day BETWEEN 1 AND 28);

-- ------------------------------------------------------------
-- RATES — effective-dated, never mutated in place.
--
-- THE SINGLE MOST IMPORTANT LINE IN THIS PHASE. If a rate were a mutable column
-- on `coaches`, giving someone a raise in June would silently reprice every
-- earlier month the moment anything recomputed — a coach's March payout would
-- change because of a decision made in June. Same class of bug as the
-- UTC-derived billing month: a value that looks current but is being applied to
-- the past.
--
-- Reading a rate therefore always means "the row with the latest
-- effective_from that is <= the lesson's date".
-- ------------------------------------------------------------

CREATE TABLE coach_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id       UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  -- Amount per `unit_minutes` of teaching, e.g. 30.00 per 60 min. Storing the
  -- unit rather than assuming an hour keeps a "$15 per half hour" school honest
  -- without anyone doing mental arithmetic.
  amount         NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  unit_minutes   SMALLINT NOT NULL DEFAULT 60 CHECK (unit_minutes > 0),
  effective_from DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_id, effective_from)
);

CREATE INDEX ON coach_rates (coach_id, effective_from DESC);

-- A class may pay a flat amount instead of the duration calculation — a coach
-- teaching classes 1-3 at their normal hourly rate and class 4 at a special
-- flat rate. REPLACES the calculation, not a modifier on it.
CREATE TABLE class_rate_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  flat_amount    NUMERIC(10, 2) NOT NULL CHECK (flat_amount >= 0),
  effective_from DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, effective_from)
);

CREATE INDEX ON class_rate_overrides (class_id, effective_from DESC);

-- Per-session escape hatch for the rain case: the admin decides this one.
CREATE TABLE session_pay_overrides (
  lesson_session_id UUID PRIMARY KEY REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  pays_coach        BOOLEAN NOT NULL,
  set_by            UUID REFERENCES profiles(id),
  set_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- PAYOUTS — draft, then frozen.
--
-- Deliberately NOT the credit-note model. An invoice freezes on generation
-- because the parent has already been sent one; a payout has no external
-- artefact until money moves, so a draft window costs nothing and removes most
-- adjustments entirely. Ordinary late corrections just flow in.
--
-- Once PAID it freezes: money has left the bank, and a record that silently
-- changes afterwards cannot be reconciled against a bank statement.
-- ------------------------------------------------------------

CREATE TYPE payout_status AS ENUM ('draft', 'paid');

CREATE TABLE coach_payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coach_id       UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  period_month   CHAR(7) NOT NULL,          -- YYYY-MM, calendar month
  gross_amount   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status         payout_status NOT NULL DEFAULT 'draft',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at        TIMESTAMPTZ,
  paid_marked_by UUID REFERENCES profiles(id),
  UNIQUE (tenant_id, coach_id, period_month)
);

CREATE INDEX ON coach_payouts (tenant_id, period_month);
CREATE INDEX ON coach_payouts (coach_id);

CREATE TABLE coach_payout_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id         UUID NOT NULL REFERENCES coach_payouts(id) ON DELETE CASCADE,
  lesson_session_id UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  class_title       TEXT NOT NULL,          -- snapshot; a class may be renamed
  session_date      DATE NOT NULL,
  -- 'duration' or 'flat' — why this line is the amount it is, so a coach
  -- querying their payslip can be answered without re-deriving it.
  basis             TEXT NOT NULL,
  minutes           SMALLINT,
  amount            NUMERIC(10, 2) NOT NULL,
  -- A correction to an ALREADY-PAID period lands here, on the next payout,
  -- carrying the month it belongs to so it stays traceable.
  is_adjustment     BOOLEAN NOT NULL DEFAULT FALSE,
  original_period   CHAR(7),
  UNIQUE (payout_id, lesson_session_id, is_adjustment)
);

CREATE INDEX ON coach_payout_items (payout_id);

ALTER TABLE coach_rates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_rate_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_pay_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_payouts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_payout_items    ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS.
--
-- A coach sees THEIR OWN payout and nobody else's — that is the point of the
-- feature for them, and it removes the monthly "how much am I getting?"
-- message. Rates are ADMIN-ONLY even from the coach they belong to: what a
-- colleague earns must not be inferable, and a rate row is per-coach.
-- ------------------------------------------------------------

CREATE POLICY coach_rates_admin ON coach_rates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM coaches c WHERE c.id = coach_id AND can_admin_tenant(c.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM coaches c WHERE c.id = coach_id AND can_admin_tenant(c.tenant_id)));

CREATE POLICY class_rate_overrides_admin ON class_rate_overrides FOR ALL TO authenticated
  USING (can_admin_tenant(class_tenant(class_id)))
  WITH CHECK (can_admin_tenant(class_tenant(class_id)));

CREATE POLICY session_pay_overrides_admin ON session_pay_overrides FOR ALL TO authenticated
  USING (can_admin_tenant(session_tenant(lesson_session_id)))
  WITH CHECK (can_admin_tenant(session_tenant(lesson_session_id)));

CREATE POLICY coach_payouts_select ON coach_payouts FOR SELECT TO authenticated
  USING (
    can_admin_tenant(tenant_id)
    OR coach_id = current_coach_id()
  );

CREATE POLICY coach_payouts_write ON coach_payouts FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

CREATE POLICY coach_payout_items_select ON coach_payout_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM coach_payouts p
      WHERE p.id = payout_id
        AND (can_admin_tenant(p.tenant_id) OR p.coach_id = current_coach_id())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON coach_rates, class_rate_overrides,
  session_pay_overrides, coach_payouts, coach_payout_items
  TO authenticated, service_role;
