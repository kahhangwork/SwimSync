-- DOWN for 20260818000200_apply_credit_to_invoice.sql
--
-- ⚠ ROLLBACK ORDER (docs/DEPLOYMENT.md / plan Item 2): redeploy the PREVIOUS
-- generate-invoices build FIRST — it carries the old in-JS drawdown — and run
-- this DOWN only after. The new engine calls apply_credit_to_invoice by name;
-- dropping it under the new engine makes the .rpc() fail, which sets
-- invoiceWriteFailed and leaves the month UNSEALED (the §7.17 retry path) —
-- never a silent underbill, but sequence it properly anyway.
--
-- Dropping the function loses NO data: credit_applications, credit_notes and
-- parent_tenant_balances rows it wrote all remain.

DROP FUNCTION IF EXISTS public.apply_credit_to_invoice(UUID);
