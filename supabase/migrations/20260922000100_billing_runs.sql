-- billing_runs: one row per generate-invoices ATTEMPT, per tenant.
--
-- Plan: docs/plans/BILLING_MONTHS_PLAN.md (decisions D1–D7 settled with the
-- user; eleven /plan-review risks, each mitigated under the step it governs).
--
-- WHY. billing_periods records a month only once it SEALS. A run that leaves a
-- month open — unmarked lessons, an unclaimed child, an error — left no trace
-- anywhere the admin could read: the reason was shown once in the Invoices
-- page's result line and gone on reload, and the only durable evidence was the
-- Edge Function log. Billing August 2026 for real cost an evening of prod data
-- dumps to answer "why is this month still open?" (BACKLOG, raised 2026-09-17).
-- This table is the admin-readable record the Billing months card reads.
--
-- ATTEMPTS ONLY. The engine's early returns — before_run_day, auto_disabled,
-- tenant_suspended, month_not_ended, already_complete — are refusals to
-- attempt, and runLog.ts writes NO row for them (⚠ RISK 3): once cron is on,
-- every daily tick would otherwise write one per tenant and make every month
-- look "open" from the 1st. That filter lives in the engine, not here.

CREATE TABLE public.billing_runs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE (⚠ RISK 5): the Deno suite's teardown deletes its
  -- scenario tenant as service_role, which holds no DELETE here by design. A
  -- plain FK would make that delete fail, leak the tenant, and run the second
  -- test.sh pass on leaked state (§7.15). A run log has no meaning without its
  -- tenant, so cascading loses nothing.
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_month             CHAR(7) NOT NULL,                 -- YYYY-MM
  ran_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ⚠ RISK 2: ON DELETE SET NULL, never the default RESTRICT. delete-admin
  -- removes the auth user and relies on the auth.users → profiles cascade; a
  -- RESTRICT FK here would make any co-admin who ever pressed Generate
  -- undeletable. NULL = the cron, or an admin since deleted.
  ran_by                    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  mode                      TEXT,
  status                    TEXT NOT NULL,                    -- engine status, or 'error'
  sealed                    BOOLEAN NOT NULL DEFAULT false,
  invoices_created          INTEGER NOT NULL DEFAULT 0,
  classes_still_incomplete  INTEGER,
  unclaimed_billable        INTEGER,
  earlier_unbilled_month    CHAR(7),
  blocking                  JSONB,                            -- BlockingLesson[]
  unclaimed_students        JSONB,                            -- UnclaimedStudent[]
  message                   TEXT,
  error                     TEXT,                             -- message only, ≤ 500 chars (⚠ RISK 11)
  CONSTRAINT billing_runs_month_format CHECK (billing_month ~ '^\d{4}-\d{2}$')
);

CREATE INDEX billing_runs_tenant_month
  ON public.billing_runs (tenant_id, billing_month, ran_at DESC);

COMMENT ON TABLE public.billing_runs IS
  'One row per generate-invoices ATTEMPT per tenant (never for an early-return '
  'refusal such as before_run_day). Written only by the engine (service_role); '
  'read by the tenant''s admins for the Billing months card. The reason a month '
  'is open is the latest row''s snapshot — see docs/plans/BILLING_MONTHS_PLAN.md.';

ALTER TABLE public.billing_runs ENABLE ROW LEVEL SECURITY;

-- Same audience as billing_periods_select and invoices: the business's admins
-- (owner AND co-admins — D5) and the platform admin. Nobody else.
CREATE POLICY billing_runs_select ON public.billing_runs FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_tenant_admin(tenant_id));

-- ── Grants ──────────────────────────────────────────────────────────────────
-- authenticated: SELECT only — the one privilege the one policy can exercise
-- (§7.87; table_grants.test.sql goes red on anything more).
--
-- service_role: ⚠ RISK 1 — NOT INHERITED. 20260814000300 revoked service_role's
-- DEFAULT privileges on new tables, so without this line the engine's insert
-- fails with permission denied — and recordRuns is best-effort (it never
-- throws, so billing is never held hostage to the log), which means the
-- failure would be SILENT in every environment and the feature would ship as a
-- no-op. table_grants.test.sql deliberately does not cover service_role, so
-- billing_runs.test.sql pins this explicitly. SELECT + INSERT only: the log is
-- append-only; nothing updates or deletes a run. (Test teardown removes rows
-- through the tenant FK's cascade, not a DELETE grant.)
REVOKE ALL ON public.billing_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.billing_runs TO authenticated;
GRANT SELECT, INSERT ON public.billing_runs TO service_role;
