import type { WagesState } from "./accounting";
import type { Summary } from "../types";

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** One accounting_summary row -> the page's Summary (numeric strings -> numbers,
 *  null kept null so a withheld figure stays withheld). No row -> null. */
export function toSummary(row: any): Summary | null {
  return row
    ? {
        revenue: num(row.revenue),
        revenue_invoiced: num(row.revenue_invoiced),
        revenue_settlements: num(row.revenue_settlements),
        revenue_gross: num(row.revenue_gross),
        revenue_package_applied: num(row.revenue_package_applied),
        revenue_credit_applied: num(row.revenue_credit_applied),
        revenue_balance_adjustment: num(row.revenue_balance_adjustment),
        outstanding: num(row.outstanding),
        wages: num(row.wages),
        net: num(row.net),
        wages_state: row.wages_state as WagesState,
      }
    : null;
}
