"use client";

import { PageHeader } from "@/components/PageHeader";
import { useAccounting } from "./domain/useAccounting";
import { MonthPicker } from "./ui/MonthPicker";
import { Figures } from "./ui/Figures";

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
 *
 * Composition only (Admin L-C): state + the owner gate's loads in
 * domain/useAccounting, the row mapping in domain/summaryRow, the money/month
 * labels in domain/accounting (moved from @/lib — sole importer), data in
 * dao/accounting.{repo,rpc}, markup in ui/. See docs/refactor/BATCH_C_PLAN.md.
 */
export default function AccountingPage() {
  const {
    isOwner,
    months,
    monthsLoaded,
    selected,
    setSelected,
    summary,
    loadingSummary,
    error,
  } = useAccounting();

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
  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle="What the business earned and paid out, per closed month"
        action={
          months.length > 0 ? (
            <MonthPicker months={months} selected={selected} onSelect={setSelected} />
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
        <Figures summary={summary} />
      )}
    </div>
  );
}
