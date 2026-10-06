// Postgres function calls for the Accounting page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. The two RPCs REFUSE anyone but the owner server-side
// (is_tenant_owner) — that is the actual boundary, and this layer must not
// pre-empt, default, or reshape it.
//
// Each wrapper takes a hand-written args type with every key REQUIRED — a dropped
// key is a compile error, not a silently wrong figure — and asserts it against
// the generated Args, so a renamed param is one too (§7.345).
import { supabase } from "@/lib/supabase";
import type { Assert, DataOf, Extends, Rpc } from "@/lib/database.overrides";

export type AccountingMonthsArgs = { p_tenant: string };
type _CheckMonths = Assert<Extends<AccountingMonthsArgs, Rpc<"accounting_months">["Args"]>>;
export function accountingMonths(args: AccountingMonthsArgs) {
  return supabase.rpc("accounting_months", args);
}

export type AccountingSummaryArgs = { p_tenant: string; p_month: string };
type _CheckSummary = Assert<Extends<AccountingSummaryArgs, Rpc<"accounting_summary">["Args"]>>;
export function accountingSummary(args: AccountingSummaryArgs) {
  return supabase.rpc("accounting_summary", args);
}

/** One accounting_summary row (the RPC returns at most one). Every column is
 *  widened to `| null`: the generator types a RETURNS TABLE column as non-null,
 *  but the function returns NULL for a WITHHELD figure (summaryRow.ts keeps it
 *  null, never 0). */
export type AccountingSummaryRow = {
  [K in keyof DataOf<typeof accountingSummary>[number]]: DataOf<typeof accountingSummary>[number][K] | null;
};
