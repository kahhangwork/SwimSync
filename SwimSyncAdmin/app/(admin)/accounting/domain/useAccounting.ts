import { useCallback, useEffect, useState } from "react";
import { toSummary } from "./summaryRow";
import * as repo from "../dao/accounting.repo";
import * as rpc from "../dao/accounting.rpc";
import type { Summary } from "../types";

/**
 * All Accounting state and loads. The ⚠ RISK 6 owner gate lives here: nothing
 * past the ownership read fires until isOwner has RESOLVED true (null = not yet
 * known; see the page header for the three-way gate).
 */
export function useAccounting() {
  // null = not yet known. Figures and RPCs wait for a resolved TRUE (⚠ RISK 6).
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [months, setMonths] = useState<string[]>([]);
  const [monthsLoaded, setMonthsLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve ownership first. Everything else waits on isOwner === true. On a
  // read error we set an error and DELIBERATELY leave isOwner unresolved (null)
  // rather than resolving it to false — resolving false would show the real
  // owner the "Owner only" notice, a confident wrong answer (the server gate
  // still keeps it safe, but a transient failure must not read as "not owner").
  useEffect(() => {
    let stale = false;
    (async () => {
      const { data: auth, error: authErr } = await repo.getAuthUser();
      if (authErr) {
        if (!stale) setError("Could not verify your account. Reload to retry.");
        return;
      }
      const myId = auth.user?.id ?? null;
      const { data: tenants, error: tErr } = await repo.loadTenants();
      if (tErr) {
        if (!stale) setError("Could not load the business. Reload to retry.");
        return;
      }
      if (stale) return;
      const t = (tenants ?? [])[0];
      setTenantId(t?.id ?? null);
      setIsOwner(!!myId && !!t && t.owner_profile_id === myId);
    })();
    return () => {
      stale = true;
    };
  }, []);

  // The month list — only once we KNOW the caller is the owner.
  const loadMonths = useCallback(async () => {
    if (isOwner !== true || !tenantId) return;
    const { data, error: e } = await rpc.accountingMonths({
      p_tenant: tenantId,
    });
    if (e) {
      setError(e.message);
      setMonthsLoaded(true); // loaded WITH an error; the empty-state copy is suppressed on error
      return;
    }
    const list = (data ?? []).map((r: { billing_month: string }) => r.billing_month);
    setMonths(list);
    setMonthsLoaded(true);
    setSelected((cur) => cur ?? list[0] ?? null);
  }, [isOwner, tenantId]);

  useEffect(() => {
    loadMonths();
  }, [loadMonths]);

  // The figures for the selected month. Guarded against stale responses: when
  // the month changes, overlapping RPCs can return out of order, and the LAST
  // to arrive would win — rendering one month's figures under another month's
  // label (a silently mislabeled P&L). The cleanup flag drops a stale response.
  useEffect(() => {
    if (isOwner !== true || !tenantId || !selected) return;
    let stale = false;
    setLoadingSummary(true);
    setError(null);
    (async () => {
      const { data, error: e } = await rpc.accountingSummary({
        p_tenant: tenantId,
        p_month: selected,
      });
      if (stale) return;
      if (e) {
        setError(e.message);
        setSummary(null);
      } else {
        const row = (data ?? [])[0];
        setSummary(toSummary(row));
      }
      setLoadingSummary(false);
    })();
    return () => {
      stale = true;
    };
  }, [isOwner, tenantId, selected]);

  return {
    isOwner,
    months,
    monthsLoaded,
    selected,
    setSelected,
    summary,
    loadingSummary,
    error,
  };
}
