-- credit_notes.amount can never be negative (BACKLOG "A credit note's amount has no positivity check", 2026-11-18).
--
-- WHY. A credit note is money the business owes the family. `amount` has been NUMERIC(10,2) NOT NULL with no CHECK
-- since 20260309000100. Its only writer is handle_attendance_update(), which copies the billed invoice item's amount, so
-- a negative row should not occur today — but nothing enforced it. A negative note would print as `−S$-5.00` in the
-- parent app (UI restyle 3.2/3.9), and handle_attendance_update() would add it to parent_tenant_balances
-- .credit_balance — LOWERING the family's credit — while every screen calls it a credit: money moving the wrong way.
--
-- WHY `>= 0`, NOT THE BACKLOG'S `> 0`. A class can be priced at S$0 (class_rates_price_per_lesson_check is `>= 0`, so
-- are class_rate_overrides and coach_rates), the engine bills a present lesson at that price as a S$0 invoice item
-- (generate-invoices domain/tally.ts priceFor), and correcting that lesson to non-billable makes the trigger INSERT a
-- S$0 credit note. With `> 0` that INSERT would raise 23514 and the coach's attendance edit would FAIL — the guard
-- would block a correction. A S$0 note is harmless to the money: apply_credit_to_invoice() sees a remainder <= 0, marks
-- it applied and draws nothing (no credit_applications row, whose own CHECK is `> 0`). The S$0 correction is pinned in
-- constraints.test.sql (3c), so tightening this to `> 0` goes red there first.
-- Refusing S$0 notes outright would need the trigger to skip them instead — a CREATE OR REPLACE of a load-bearing
-- function, out of proportion to a guard against a row that cannot occur today.
--
-- DATA. Prod held 0 credit notes (0 negative) on 2026-11-18, read just before this was written, and 0 S$0 invoice
-- items / class rates — the constraint cannot conflict. A plain (validating) ADD CONSTRAINT: the table is tiny.
--
-- EXPAND-ONLY. No column, grant or policy change, so the generated app types and table_grants.test.sql are unaffected.
--
-- Rollback: ALTER TABLE public.credit_notes DROP CONSTRAINT credit_notes_amount_nonnegative;

ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_amount_nonnegative CHECK (amount >= 0);
