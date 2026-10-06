import { useEffect, useState } from "react";
import { previousBillingMonth, todayInSg } from "@/lib/lessonDates";
import {
  INVOICE_MONTH_WINDOW,
  attentionSummary,
  deriveBillingMonths,
  mapBillingRun,
  monthsBefore,
  runDayOf,
  type BillingPeriod,
  type MonthFunding,
} from "@/lib/billingMonths";
import {
  getAuthUser,
  loadBillingMonthsInput,
  loadProfileTenantId,
} from "../dao/dashboard.repo";
import { packageMonthFunding } from "../dao/dashboard.rpc";

/** The Dashboard's one-line "a month still needs billing" alert (D1, D5: every
 *  admin of the business). Same derivation as the Invoices page's card, so the
 *  two never disagree. Its own effect, like useTenantCard's — never awaited into
 *  the metrics load. A platform admin has no tenant, so it stays null. A failed
 *  read also leaves it null: the alert is a nudge, and the Invoices card (which
 *  shows its errors) is the authority. */
export function useBillingAlert() {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await getAuthUser();
      if (!auth.user) return;
      const { data: profile } = await loadProfileTenantId(auth.user.id);
      const tenantId = profile?.tenant_id as string | undefined;
      if (!tenantId) return;

      const latestBillableMonth = previousBillingMonth();
      const [[tenant, periods, runs, invoices], funding] = await Promise.all([
        loadBillingMonthsInput(
          tenantId,
          monthsBefore(latestBillableMonth, INVOICE_MONTH_WINDOW)
        ),
        packageMonthFunding(tenantId),
      ]);
      if (tenant.error || periods.error || runs.error || invoices.error) return;

      const rows = deriveBillingMonths({
        periods: (periods.data ?? []) as BillingPeriod[],
        runs: (runs.data ?? []).map(mapBillingRun),
        invoiceMonths: [
          ...new Set((invoices.data ?? []).map((i) => i.billing_month as string)),
        ],
        latestBillableMonth,
        todaySg: todayInSg(),
        runDay: runDayOf(tenant.data?.invoice_run_day),
        // Wave 6 D2: a failed read fails CLOSED to today's alert, as on the card.
        funding: funding.error ? [] : ((funding.data ?? []) as MonthFunding[]),
      });
      setSummary(attentionSummary(rows));
    })();
  }, []);

  return { summary };
}
