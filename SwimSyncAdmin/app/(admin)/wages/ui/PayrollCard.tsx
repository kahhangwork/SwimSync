import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import { money } from "../domain/wageRows";
import type { PayoutRow } from "../types";
import { PayoutBreakdown } from "./PayoutBreakdown";

export function PayrollCard({
  period,
  setPeriod,
  handleRun,
  busy,
  message,
  loadError,
  loadingPayouts,
  payouts,
  payoutSort,
  visiblePayouts,
  expanded,
  setExpanded,
  handleMarkPaid,
}: {
  period: string;
  setPeriod: (p: string) => void;
  handleRun: () => void;
  busy: boolean;
  message: string | null;
  loadError: string | null;
  loadingPayouts: boolean;
  payouts: PayoutRow[];
  payoutSort: TableSort<PayoutRow>;
  visiblePayouts: PayoutRow[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  handleMarkPaid: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">
            Month
          </label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={handleRun}
          disabled={busy}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? "Working…" : "Calculate payroll"}
        </button>
      </div>

      {message && (
        <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {message}
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError} The amounts below are the ones that will be paid, but a
          lesson taught by a substitute may be showing without its label.
        </div>
      )}

      {/* "Loading" and "none" are DIFFERENT ANSWERS. Rendering the previous
          month's rows, or "no payouts yet", while a load is in flight puts a
          live "Mark paid" beside a month the picker no longer names — and
          marking paid is irreversible by design. */}
      {loadingPayouts ? (
        <p className="py-6 text-center text-sm text-gray-400">
          Loading payouts…
        </p>
      ) : payouts.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">
          No payouts for this month yet.
        </p>
      ) : (
        <Table>
          <Thead>
            <Th sort={payoutSort} sortKey="coach_name">Coach</Th>
            <Th sort={payoutSort} sortKey="lessons" firstDir="desc">Lessons</Th>
            <Th sort={payoutSort} sortKey="gross_amount" firstDir="desc">Amount</Th>
            <Th sort={payoutSort} sortKey="status">Status</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {visiblePayouts.map((p) => (
              <Fragment key={p.id}>
                <Tr>
                  <Td>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded(expanded === p.id ? null : p.id)
                      }
                      aria-expanded={expanded === p.id}
                      className="inline-flex items-center gap-1.5 font-medium text-gray-900 hover:text-sky-600"
                    >
                      {expanded === p.id ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                      {p.coach_name}
                    </button>
                  </Td>
                  <Td>
                    {p.summary.lessons}
                    {/* The adjustment is called out beside the count rather
                        than folded into it: a correction to an already-paid
                        month is the one line an admin has to be able to
                        explain to the coach receiving it. */}
                    {p.summary.adjustmentTotal !== 0 && (
                      <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {p.summary.adjustmentTotal > 0 ? "+" : ""}
                        {money(p.summary.adjustmentTotal)} correction
                      </span>
                    )}
                  </Td>
                  <Td>
                    {money(p.gross_amount)}
                    {!p.grossOk && (
                      <span
                        className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                        title={`The lessons below add up to ${money(p.summary.itemTotal)}. A draft payout rebuilds completely on every run, so re-running payroll for this month is the fix.`}
                      >
                        re-run payroll
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={
                        p.status === "paid"
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                      }
                    >
                      {p.status === "paid" ? "Paid" : "Draft"}
                    </span>
                  </Td>
                  <Td>
                    {p.status === "draft" ? (
                      <button
                        onClick={() => handleMarkPaid(p.id)}
                        disabled={busy}
                        className="text-sm font-medium text-sky-600 underline disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Frozen</span>
                    )}
                  </Td>
                </Tr>

                {expanded === p.id && (
                  <Tr>
                    <Td colSpan={5} className="bg-gray-50">
                      <PayoutBreakdown p={p} />
                    </Td>
                  </Tr>
                )}
              </Fragment>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
