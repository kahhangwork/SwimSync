"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/Button";
import { formatSgStamp } from "@/lib/lessonDates";
import {
  formatRunStamp,
  monthLabel,
  visibleMonths,
  type BillingMonthRow,
  type BillingRun,
} from "@/lib/billingMonths";
import {
  groupByMonth,
  mayNotHaveArrivedLabel,
  type UndeliveredEmail,
} from "../domain/undeliveredEmails";

/** The "may not have arrived" list's wiring (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.3). */
type UndeliveredProps = {
  undelivered: UndeliveredEmail[];
  undeliveredError: string | null;
  resendingInvoice: Set<string>;
  resendInvoiceError: Record<string, string>;
  onResendInvoice: (invoiceId: string) => void;
};

/** ── Billing months ──────────────────────────────────────────────────
 *  Which months are closed, which are still open and WHY, as of the last run
 *  (docs/plans/BILLING_MONTHS_PLAN.md). A STANDING card, directly above the
 *  Generate panel: the failure mode it fixes is a month sitting open with
 *  nobody knowing. Every open month always shows; only the newest three closed
 *  months do, so the card stays a few rows tall (D2). */
export function BillingMonthsCard({
  rows,
  loaded,
  loadError,
  showAll,
  setShowAll,
  expanded,
  setExpanded,
  staleNote,
  onSelectMonth,
  onOpenUnclaimed,
  onOpenBlocked,
  ...undeliveredProps
}: {
  rows: BillingMonthRow[];
  loaded: boolean;
  loadError: string | null;
  showAll: boolean;
  setShowAll: (b: boolean) => void;
  expanded: string | null;
  setExpanded: (m: string | null) => void;
  staleNote: { month: string; text: string } | null;
  onSelectMonth: (month: string) => void;
  onOpenUnclaimed: (row: BillingMonthRow) => void;
  onOpenBlocked: (row: BillingMonthRow) => void;
} & UndeliveredProps) {
  if (!loaded) return null;
  const { visible, hiddenCount } = visibleMonths(rows, showAll);
  const byMonth = groupByMonth(undeliveredProps.undelivered);
  // A closed month beyond the newest three is hidden (D2), and so would be its
  // count — which is exactly the kind of quiet failure this list exists to end.
  const shown = new Set(visible.map((r) => r.month));
  const offscreen = undeliveredProps.undelivered.filter((u) => !shown.has(u.billingMonth)).length;

  return (
    <div
      data-testid="billing-months"
      className="mb-5 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <p className="text-sm font-semibold text-gray-800">Billing months</p>

      {loadError ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Could not load billing months: {loadError}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {visible.map((row) => (
            <MonthRow
              key={row.month}
              row={row}
              isExpanded={expanded === row.month}
              onToggle={() => setExpanded(expanded === row.month ? null : row.month)}
              note={staleNote?.month === row.month ? staleNote.text : null}
              onSelectMonth={onSelectMonth}
              onOpenUnclaimed={onOpenUnclaimed}
              onOpenBlocked={onOpenBlocked}
              undelivered={byMonth.get(row.month) ?? []}
              resendingInvoice={undeliveredProps.resendingInvoice}
              resendInvoiceError={undeliveredProps.resendInvoiceError}
              onResendInvoice={undeliveredProps.onResendInvoice}
            />
          ))}
        </ul>
      )}

      {!loadError && offscreen > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {mayNotHaveArrivedLabel(offscreen)} in months not shown
          {!showAll && (
            <>
              {" — "}
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="font-medium text-sky-600 hover:underline"
              >
                show all months
              </button>
            </>
          )}
        </p>
      )}
      {undeliveredProps.undeliveredError && (
        <p className="mt-2 text-xs text-amber-700">
          Could not check for invoice emails that may not have arrived:{" "}
          {undeliveredProps.undeliveredError}
        </p>
      )}

      {!loadError && (hiddenCount > 0 || showAll) && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs font-medium text-sky-600 hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} months`}
        </button>
      )}
    </div>
  );
}

const STATE_STYLE: Record<BillingMonthRow["state"], { dot: string; label: string }> = {
  closed: { dot: "bg-green-500", label: "Closed" },
  open: { dot: "bg-red-500", label: "Open" },
  not_billed: { dot: "bg-amber-500", label: "Not billed yet" },
  not_run: { dot: "bg-gray-300", label: "Not run yet" },
  package_funded: { dot: "bg-sky-500", label: "Nothing to bill" },
};

function MonthRow({
  row,
  isExpanded,
  onToggle,
  note,
  onSelectMonth,
  onOpenUnclaimed,
  onOpenBlocked,
  undelivered,
  resendingInvoice,
  resendInvoiceError,
  onResendInvoice,
}: {
  row: BillingMonthRow;
  isExpanded: boolean;
  onToggle: () => void;
  /** Why the Unclaimed button is withheld (⚠ RISK 6), or null. */
  note: string | null;
  onSelectMonth: (month: string) => void;
  onOpenUnclaimed: (row: BillingMonthRow) => void;
  onOpenBlocked: (row: BillingMonthRow) => void;
  /** This month's MAY_HAVE_SENT invoice emails. */
  undelivered: UndeliveredEmail[];
  resendingInvoice: Set<string>;
  resendInvoiceError: Record<string, string>;
  onResendInvoice: (invoiceId: string) => void;
}) {
  const [showUndelivered, setShowUndelivered] = useState(false);
  const style = STATE_STYLE[row.state];
  const latest = row.recentRuns[0] ?? null;
  const unclaimedCount = latest?.unclaimed_students?.length ?? 0;
  const blockedCount = latest?.blocking?.length ?? 0;

  return (
    <li data-testid={`billing-month-${row.month}`} data-state={row.state} className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => onSelectMonth(row.month)}
          title="Set the Generate month to this month"
          className="w-20 text-left text-sm font-semibold text-gray-800 hover:text-sky-600"
        >
          {monthLabel(row.month)}
        </button>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          {style.label}
        </span>

        <span className="text-xs text-gray-600">
          {/* The close date only — NOT billing_periods.invoices_issued, which
              counts just the SEALING run's invoices (Aug 2026 sealed with 0
              while 9 existed from an earlier run). */}
          {row.state === "closed" && row.period
            ? `Closed on ${formatSgStamp(row.period.completed_at, {
                day: "numeric",
                month: "short",
              })}`
            : row.reason}
        </span>

        {row.state === "open" && latest && (
          <span className="text-[11px] text-gray-400">
            as of last run, {formatRunStamp(latest.ran_at)}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {/* Any state, closed months included: a sealed month can still hold
              an email whose delivery is unknown. Hidden when there are none. */}
          {undelivered.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowUndelivered(!showUndelivered)}
              aria-expanded={showUndelivered}
            >
              {mayNotHaveArrivedLabel(undelivered.length)}
            </Button>
          )}
          {row.state === "open" && blockedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => onOpenBlocked(row)}>
              Unmarked ({blockedCount})
            </Button>
          )}
          {row.state === "open" && unclaimedCount > 0 && !note && (
            <Button size="sm" variant="outline" onClick={() => onOpenUnclaimed(row)}>
              Unclaimed ({unclaimedCount})
            </Button>
          )}
          {row.recentRuns.length > 0 && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isExpanded}
              className="flex items-center text-[11px] text-gray-500 hover:text-gray-800"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {row.recentRuns.length} run{row.recentRuns.length === 1 ? "" : "s"}
            </button>
          )}
        </span>
      </div>

      {/* RISK 6: the stored list is stale, or could not be checked. */}
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}

      {showUndelivered && undelivered.length > 0 && (
        <div
          data-testid={`undelivered-${row.month}`}
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2"
        >
          <p className="mb-1.5 text-[11px] text-amber-900">
            These emails were being sent more than a day ago and never confirmed.
            They may have arrived. Resend only if the parent says they did not get it.
          </p>
          <ul className="space-y-1.5">
            {undelivered.map((u) => (
              <li key={u.invoiceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium text-gray-800">{u.parentName}</span>
                <span className="font-mono text-gray-500">{u.reference ?? "—"}</span>
                <span className="text-gray-500">
                  sending since{" "}
                  {formatSgStamp(u.claimedAt, {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResendInvoice(u.invoiceId)}
                  disabled={resendingInvoice.has(u.invoiceId)}
                >
                  {resendingInvoice.has(u.invoiceId) ? "Sending…" : "Resend"}
                </Button>
                {resendInvoiceError[u.invoiceId] && (
                  <span className="basis-full text-red-600">{resendInvoiceError[u.invoiceId]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isExpanded && (
        <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2">
          {row.recentRuns.map((r) => (
            <RunLine key={r.id} run={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

function RunLine({ run }: { run: BillingRun }) {
  const who = run.ran_by_name ?? (run.mode === "auto" ? "Automatic" : "—");
  return (
    <li className="text-[11px] text-gray-600">
      <span className="font-medium text-gray-800">{formatRunStamp(run.ran_at)}</span>
      {" · "}
      {who}
      {" · "}
      {run.invoices_created} created
      {" · "}
      {run.status === "error" ? (
        <span className="text-red-600">failed: {run.error}</span>
      ) : run.sealed ? (
        <span className="text-green-700">closed the month</span>
      ) : (
        run.status
      )}
    </li>
  );
}
