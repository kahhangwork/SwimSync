-- ============================================================
-- Multi-tenancy, step 2 of 4: the tenant tables and columns.
--
-- A TENANT is a business. A private coach is a tenant of ONE, where the same
-- person holds the admin and coach roles — not a separate product type. No rule
-- anywhere branches on private-vs-school; rules ask tenant + role. See
-- TENANCY_DESIGN.md §1.
--
-- Where the boundary falls (§2):
--   • PARENTS ARE GLOBAL — no tenant_id. A parent may have one child at a school
--     and another with a private coach (PRD §11.3, and per the user the COMMON
--     case). Tenanting the parent breaks that permanently.
--   • STUDENTS ARE TENANTED, via a real column rather than derived from their
--     enrolment. An unassigned child has no enrolment yet but must still appear
--     in exactly one admin's queue; and "Remove from class" deliberately keeps a
--     child in the business while removing them from the class, which
--     enrolment-derived tenancy would silently undo.
--
-- Columns are added NULLABLE here. The backfill tightens only the two whose
-- writers already supply a tenant (coaches, classes); the rest stay nullable
-- until the phase that updates their writer — expand/contract, see
-- TENANCY_PLAN.md phase 1.
-- ============================================================

CREATE TYPE tenant_kind AS ENUM ('private', 'school');

-- ------------------------------------------------------------
-- TENANTS
-- ------------------------------------------------------------

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  -- Onboarding copy and (later) pricing ONLY. MUST NEVER appear in an RLS
  -- policy: the moment authorisation branches on it, private and school become
  -- two products again and every money feature gets built twice.
  kind            tenant_kind NOT NULL DEFAULT 'private',

  -- Branding. Carried from day one because retrofitting means touching every
  -- email template and backfilling assets (TENANCY_DESIGN.md §7a).
  logo_url        TEXT,

  -- Parents pay the BUSINESS, not the individual coach — a three-coach school
  -- must present one payee. Moved here from coaches.paynow_qr_url by the
  -- backfill; for a private coach their tenant-of-one's QR is their own.
  paynow_qr_url   TEXT,

  -- What a parent types to join this business (TENANCY_DESIGN.md §6). Possession
  -- of the code is the proof of relationship — which is why there is no
  -- browsable tenant list. Regenerable if it leaks.
  join_code       TEXT NOT NULL UNIQUE,

  -- Per-tenant billing schedule. NOTE: the engine still reads app_settings until
  -- phase 2 rewrites it; these are seeded from the current global values so the
  -- switch is a no-op. app_settings remains the live source until then.
  auto_invoice_enabled BOOLEAN  NOT NULL DEFAULT TRUE,
  invoice_run_day      SMALLINT NOT NULL DEFAULT 7
                       CHECK (invoice_run_day BETWEEN 1 AND 28),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/**
 * A short, human-transcribable join code: SWIM-XXXX.
 *
 * Alphabet excludes 0/O/1/I/L — these get read aloud over the phone and
 * forwarded in WhatsApp, and a code a parent cannot retype is a support ticket.
 * Collisions are retried against the UNIQUE constraint by the caller.
 */
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out TEXT := '';
BEGIN
  FOR _ IN 1..4 LOOP
    out := out || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  END LOOP;
  RETURN 'SWIM-' || out;
END;
$$;

-- ------------------------------------------------------------
-- PARENT_TENANTS — which businesses a parent has joined.
--
-- Created when a parent enters a join code. This is what the add-child screen
-- offers as a picker: a parent with children at a school and two private
-- coaches sees three options, never a list of every tenant on the platform.
-- ------------------------------------------------------------

CREATE TABLE parent_tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_id, tenant_id)
);

-- ------------------------------------------------------------
-- PARENT_TENANT_BALANCES — credit, scoped to the business that owes it.
--
-- Replaces parents.credit_balance. Credit NEVER crosses tenants: a note earned
-- at a school is not spendable against a private coach's invoice, or one
-- business would be paying another's bill. It DOES pool freely within a tenant
-- across all of that parent's children there (invoices are one per parent per
-- tenant per month).
--
-- This explicitly reverses the earlier "credit is pooled per parent" decision,
-- with the user's go-ahead. parents.credit_balance is KEPT, deprecated and
-- dual-written, until its readers move (expand/contract).
-- ------------------------------------------------------------

CREATE TABLE parent_tenant_balances (
  parent_id      UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credit_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_id, tenant_id)
);

-- ------------------------------------------------------------
-- tenant_id columns (nullable here; tightened by the backfill)
-- ------------------------------------------------------------

-- NULL = a parent (global) or the platform admin (cross-tenant).
ALTER TABLE profiles    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE coaches     ADD COLUMN tenant_id UUID REFERENCES tenants(id);
-- Denormalised from coach_id on purpose: every policy reads it.
ALTER TABLE classes     ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE students    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE invoices    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE credit_notes ADD COLUMN tenant_id UUID REFERENCES tenants(id);
-- NULL = a platform-level action with no tenant.
ALTER TABLE audit_log   ADD COLUMN tenant_id UUID REFERENCES tenants(id);

CREATE INDEX ON coaches (tenant_id);
CREATE INDEX ON classes (tenant_id);
CREATE INDEX ON students (tenant_id);
CREATE INDEX ON invoices (tenant_id);
CREATE INDEX ON credit_notes (tenant_id);
CREATE INDEX ON parent_tenants (tenant_id);

-- ------------------------------------------------------------
-- billing_periods: sealing is PER TENANT.
--
-- billing_month was the entire primary key. Left alone, one tenant completing
-- July would seal July for EVERY tenant — every other business short-circuits
-- on "already_complete" and silently bills nothing. Same failure shape as the
-- vacuous empty-month seal that already reached production, but crossing a
-- business boundary.
-- ------------------------------------------------------------

-- Column added now; the PRIMARY KEY stays (billing_month) until phase 2, when
-- the engine actually becomes tenant-aware and starts writing the tenant.
-- Swapping the key first would make sealing insert NULLs (a PK forbids them)
-- and break every run in between.
ALTER TABLE billing_periods ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- ------------------------------------------------------------
-- invoices: one per parent PER TENANT per month.
--
-- The old constraint forbids the case the user expects to be COMMON — a parent
-- with children at two businesses must receive two invoices in the same month.
-- ------------------------------------------------------------

-- The UNIQUE swap to (parent_id, tenant_id, billing_month) also waits for
-- phase 2. Dropping it now while the engine still writes tenant_id NULL would
-- let two NULL-tenant invoices coexist for one parent-month — NULLs never
-- conflict in a UNIQUE index — which is DOUBLE BILLING, the one failure this
-- constraint exists to prevent.

-- ------------------------------------------------------------
-- RLS ON, explicitly.
--
-- Postgres does NOT enable RLS on a new table just because the rest of the
-- schema has it, and a table with policies but RLS disabled reads as though the
-- policies were never written — they are simply not consulted. Omitting this
-- left `tenants` fully readable by any signed-in user, JOIN CODES INCLUDED,
-- which would have quietly defeated the whole reason codes exist instead of a
-- browsable tenant picker. Caught by tenant_isolation.test.sql.
-- ------------------------------------------------------------

ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_tenant_balances ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON tenants TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON parent_tenants TO authenticated, service_role;
GRANT SELECT ON parent_tenant_balances TO authenticated, service_role;
GRANT UPDATE ON tenants TO authenticated, service_role;
GRANT ALL ON parent_tenant_balances TO service_role;
