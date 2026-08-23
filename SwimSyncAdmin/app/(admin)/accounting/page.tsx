"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { formatMonth, moneyOrDash, type WagesState } from "@/lib/accounting";

/**
 * OWNER-ONLY accounting — what the business earned and paid out, one closed
 * month at a time. Revenue is ACCRUAL (invoices issued for the month + outside
 * settlements covering it); Net = Revenue − accrued coach wages.
 *
 * Owner-gate, three ways, only the LAST of which is the boundary:
 *   - the nav link is visible to every admin (same as /admins) — hiding is not
 *     the boundary, so it is not attempted here;
 *   - the PAGE renders the owner-only notice for a resolved non-owner, and — the
 *     ⚠ RISK 6 rule — fires NO accounting RPC and shows NO figure until isOwner
 *     has RESOLVED true (the tri-state: null = not-yet-known renders loading,
 *     never figures and never the notice — §7.19's shape);
 *   - the two RPCs REFUSE anyone but the owner server-side (is_tenant_owner),
 *     which is the actual boundary. A misrendered page still cannot leak a
 *     figure.
 *
 * "Never a partial figure" (BACKLOG): when coach payouts have not been run for
 * every rated coach in the month, Wages and Net are WITHHELD (wages_state
 * 'run_payouts', RPC returns NULL) rather than shown as a silent under-sum; a
 * 'draft' state shows the number with a badge because it can still move.
 */

type Summary = {
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

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function Tile({
  label,
  value,
  sub,
  tone = "default",
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "muted" | "warn";
  testid?: string;
}) {
  const valueColor =
    tone === "warn"
      ? "text-amber-600"
      : tone === "muted"
        ? "text-gray-400"
        : "text-gray-900";
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5"
      data-testid={testid}
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export default function AccountingPage() {
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
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        if (!stale) setError("Could not verify your account. Reload to retry.");
        return;
      }
      const myId = auth.user?.id ?? null;
      const { data: tenants, error: tErr } = await supabase
        .from("tenants")
        .select("id, owner_profile_id");
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
    const { data, error: e } = await supabase.rpc("accounting_months", {
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
      const { data, error: e } = await supabase.rpc("accounting_summary", {
        p_tenant: tenantId,
        p_month: selected,
      });
      if (stale) return;
      if (e) {
        setError(e.message);
        setSummary(null);
      } else {
        const row = (data ?? [])[0];
        setSummary(
          row
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
            : null
        );
      }
      setLoadingSummary(false);
    })();
    return () => {
      stale = true;
    };
  }, [isOwner, tenantId, selected]);

  // ── Owner gate (⚠ RISK 6): loading until resolved; then owner or notice ─────
  // While ownership is unresolved we show loading — and the error, if a read
  // failed, so a stuck resolve does not read as an indefinite spinner.
  if (isOwner === null) {
    return error ? (
      <div>
        <PageHeader title="Accounting" />
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      </div>
    ) : (
      <p className="text-sm text-gray-500">Loading…</p>
    );
  }
  if (isOwner === false) {
    return (
      <div>
        <PageHeader title="Accounting" />
        <div
          className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600"
          data-testid="owner-only-notice"
        >
          <strong className="text-gray-800">Owner only.</strong> The accounting
          figures — revenue, wages and net — are visible to the business owner,
          not to co-admins.
        </div>
      </div>
    );
  }

  // ── Owner view ──────────────────────────────────────────────────────────────
  const wagesRun = summary?.wages_state === "run_payouts";
  const wagesDraft = summary?.wages_state === "draft";

  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle="What the business earned and paid out, per closed month"
        action={
          months.length > 0 ? (
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              data-testid="month-picker"
              className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {error && (
        <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!monthsLoaded ? (
        <p className="text-sm text-gray-500">Loading figures…</p>
      ) : months.length === 0 ? (
        // Suppressed on error: an errored month-load also leaves months empty,
        // and claiming "no closed months" then would be a false empty state.
        error ? null : (
          <div
            className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600"
            data-testid="no-months"
          >
            No closed months yet — figures appear after your first billing run.
          </div>
        )
      ) : loadingSummary || !summary ? (
        <p className="text-sm text-gray-500">Loading figures…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Revenue"
              value={moneyOrDash(summary.revenue)}
              sub={`Invoices ${moneyOrDash(summary.revenue_invoiced)} + settlements ${moneyOrDash(summary.revenue_settlements)}`}
              testid="tile-revenue"
            />
            <Tile
              label="Outstanding"
              value={moneyOrDash(summary.outstanding)}
              sub="Billed but not yet paid"
              testid="tile-outstanding"
            />
            <Tile
              label="Wages"
              value={wagesRun ? "—" : moneyOrDash(summary.wages)}
              tone={wagesRun ? "warn" : "default"}
              sub={
                wagesRun
                  ? "Run coach payouts to see"
                  : wagesDraft
                    ? "Payouts still draft — may change"
                    : "Coaching taught this month"
              }
              testid="tile-wages"
            />
            <Tile
              label="Net"
              value={wagesRun ? "—" : moneyOrDash(summary.net)}
              tone={wagesRun ? "warn" : "default"}
              sub={wagesRun ? "Needs coach payouts" : "Revenue − wages"}
              testid="tile-net"
            />
          </div>

          {/* Revenue breakdown — so a surprising figure is auditable without SQL.
              balance_adjustment is a prior month's debit folded onto this
              month's invoices; it is subtracted OUT of revenue. */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-semibold text-gray-700">
              Revenue breakdown
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm sm:max-w-md">
              <Line label="Gross billed" v={moneyOrDash(summary.revenue_gross)} />
              <Line label="− Packages applied" v={moneyOrDash(summary.revenue_package_applied)} />
              <Line label="− Credit applied" v={moneyOrDash(summary.revenue_credit_applied)} />
              <Line label="− Prior-month debit" v={moneyOrDash(summary.revenue_balance_adjustment)} />
              <Line label="= Invoiced revenue" v={moneyOrDash(summary.revenue_invoiced)} strong />
              <Line label="+ Outside settlements" v={moneyOrDash(summary.revenue_settlements)} />
              <Line label="= Revenue" v={moneyOrDash(summary.revenue)} strong />
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

function Line({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <>
      <dt className={`text-gray-500 ${strong ? "font-semibold text-gray-700" : ""}`}>
        {label}
      </dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>
        {v}
      </dd>
    </>
  );
}
