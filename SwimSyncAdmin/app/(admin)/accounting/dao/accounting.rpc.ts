// Postgres function calls for the Accounting page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. The two RPCs REFUSE anyone but the owner server-side
// (is_tenant_owner) — that is the actual boundary, and this layer must not
// pre-empt, default, or reshape it.
//
// The admin client is untyped (`createClient` with no `Database` generic), so
// each wrapper takes an explicit args type with every key REQUIRED — a dropped
// or renamed key is a compile error, not a silently wrong figure.
import { supabase } from "@/lib/supabase";

export type AccountingMonthsArgs = { p_tenant: string };
export function accountingMonths(args: AccountingMonthsArgs) {
  return supabase.rpc("accounting_months", args);
}

export type AccountingSummaryArgs = { p_tenant: string; p_month: string };
export function accountingSummary(args: AccountingSummaryArgs) {
  return supabase.rpc("accounting_summary", args);
}
