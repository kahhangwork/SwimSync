import { useState } from "react";
import { previousBillingMonth, todayInSg } from "@/lib/lessonDates";
import {
  INVOICE_MONTH_WINDOW,
  deriveBillingMonths,
  mapBillingRun,
  monthsBefore,
  runDayOf,
  stillUnclaimed,
  type BillingMonthRow,
  type BillingPeriod,
  type RunUnclaimedStudent,
} from "@/lib/billingMonths";
import * as repo from "../dao/invoices.repo";

/** The Billing months card: which months are closed, which are open and why
 *  (docs/plans/BILLING_MONTHS_PLAN.md). The page reloads it after a generate —
 *  INCLUDING a failed one, because a client-side timeout can hide a run that
 *  completed on the server — and after a settlement. */
export function useBillingMonths() {
  const [rows, setRows] = useState<BillingMonthRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // A note under one month's row when its stored unclaimed list cannot be
  // offered: fully stale (everyone claimed or settled since the run), or the
  // check itself failed. Cleared on every load — a new run is a new list.
  const [staleNote, setStaleNote] = useState<{ month: string; text: string } | null>(null);

  /** Reads its own run day rather than taking it from useTenantBilling: the
   *  page calls this before that hook's state has settled (loadTenant returns
   *  only the id), and a stale default would flip D6's amber on the wrong day. */
  async function load(tenantId: string) {
    setStaleNote(null);
    const latestBillableMonth = previousBillingMonth();
    const [tenant, periods, runs, invoices] = await Promise.all([
      repo.fetchTenant(tenantId),
      repo.fetchBillingPeriods(tenantId),
      repo.fetchBillingRuns(tenantId),
      repo.fetchInvoiceMonths(
        tenantId,
        monthsBefore(latestBillableMonth, INVOICE_MONTH_WINDOW)
      ),
    ]);
    const error = tenant.error ?? periods.error ?? runs.error ?? invoices.error;
    if (error) {
      // Said plainly rather than rendering an empty card, which would read as
      // "every month is fine".
      setLoadError(error.message);
      setLoaded(true);
      return;
    }
    setLoadError(null);
    setRows(
      deriveBillingMonths({
        periods: (periods.data ?? []) as BillingPeriod[],
        runs: (runs.data ?? []).map(mapBillingRun),
        invoiceMonths: [
          ...new Set((invoices.data ?? []).map((i) => i.billing_month as string)),
        ],
        latestBillableMonth,
        todaySg: todayInSg(),
        // Same default and clamp as useTenantBilling's display of it.
        runDay: runDayOf(tenant.data?.invoice_run_day),
      })
    );
    setLoaded(true);
  }

  /** ⚠ RISK 6: the stored run's unclaimed students minus anyone claimed or
   *  settled since.
   *  Returns [] when the snapshot is fully stale — the card then says
   *  "Generate again to refresh" instead of opening the modal. */
  async function currentUnclaimed(
    students: RunUnclaimedStudent[] | null
  ): Promise<RunUnclaimedStudent[] | null> {
    const ids = (students ?? []).map((s) => s.student_id);
    if (!ids.length) return [];
    const [claimed, settled] = await Promise.all([
      repo.fetchClaimedStudentIds(ids),
      repo.fetchLiveSettlements(ids),
    ]);
    // Fail CLOSED: if we cannot tell who is still unclaimed, offer nothing to
    // settle rather than a list that may be stale (null = could not check).
    if (claimed.error || settled.error) return null;
    const through = new Map<string, string>();
    for (const r of settled.data ?? []) {
      const id = r.student_id as string;
      const d = r.settled_through as string;
      if (!through.has(id) || d > through.get(id)!) through.set(id, d);
    }
    return stillUnclaimed(
      students,
      new Set((claimed.data ?? []).map((r) => r.student_id as string)),
      through
    );
  }

  /** D4: open the existing Unclaimed modal from a stored run. Cross-slice
   *  setters are passed at call time by the page's compose layer (the same
   *  pattern as useUnclaimed.handleSettle), which keeps the slices acyclic. */
  async function openUnclaimed(
    row: BillingMonthRow,
    setGenMonth: (m: string) => void,
    setUnclaimed: (rows: RunUnclaimedStudent[]) => void
  ) {
    setGenMonth(row.month);
    const current = await currentUnclaimed(row.recentRuns[0]?.unclaimed_students ?? null);
    if (current === null) {
      setStaleNote({
        month: row.month,
        text: "Could not check who is still unclaimed. Reload the page and try again.",
      });
    } else if (!current.length) {
      setStaleNote({
        month: row.month,
        text: "Everyone on this list has been claimed or settled since the last run. Generate this month again to refresh.",
      });
    } else {
      setStaleNote(null);
      setUnclaimed(current);
    }
  }

  return {
    rows,
    loaded,
    loadError,
    showAll,
    setShowAll,
    expanded,
    setExpanded,
    staleNote,
    load,
    openUnclaimed,
  };
}
