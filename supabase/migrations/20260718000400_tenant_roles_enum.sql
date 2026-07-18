-- ============================================================
-- Multi-tenancy, step 1 of 4: the new role values.
--
-- `superadmin` is doing two different jobs and must split (TENANCY_DESIGN.md §4):
--
--   platform_admin — SwimSync itself. Cross-tenant, tenant_id NULL. Support and
--                    (later) platform billing. There is one of these: the owner.
--   tenant_admin   — one business, entirely. A school owner, or a private coach
--                    (who also holds a `coaches` row — a tenant of one).
--
-- ALONE IN ITS OWN MIGRATION ON PURPOSE. Postgres allows ALTER TYPE ... ADD
-- VALUE inside a transaction, but the new value cannot be USED until that
-- transaction commits — and every migration file is one transaction. Adding the
-- values here lets 20260718000600_tenant_backfill.sql assign them.
--
-- `superadmin` is deliberately NOT dropped: existing rows still carry it until
-- the backfill migration converts them, and dropping an enum value in Postgres
-- means rewriting the type. It is retired by data, not by DDL.
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'platform_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'tenant_admin';
