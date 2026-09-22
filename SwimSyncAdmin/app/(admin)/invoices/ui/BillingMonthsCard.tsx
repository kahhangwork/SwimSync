"use client";

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
}) {
  if (!loaded) return null;
  const { visible, hiddenCount } = visibleMonths(rows, showAll);

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
            />
          ))}
        </ul>
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
};

function MonthRow({
  row,
  isExpanded,
  onToggle,
  note,
  onSelectMonth,
  onOpenUnclaimed,
  onOpenBlocked,
}: {
  row: BillingMonthRow;
  isExpanded: boolean;
  onToggle: () => void;
  /** Why the Unclaimed button is withheld (⚠ RISK 6), or null. */
  note: string | null;
  onSelectMonth: (month: string) => void;
  onOpenUnclaimed: (row: BillingMonthRow) => void;
  onOpenBlocked: (row: BillingMonthRow) => void;
}) {
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
