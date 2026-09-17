import type { WagesState } from "./domain/accounting";

export type Summary = {
  revenue: number | null;
  revenue_invoiced: number | null;
  revenue_settlements: number | null;
  revenue_gross: number | null;
  revenue_package_applied: number | null;
  revenue_credit_applied: number | null;
  revenue_balance_adjustment: number | null;
  outstanding: number | null;
  wages: number | null;
  net: number | null;
  wages_state: WagesState;
};
