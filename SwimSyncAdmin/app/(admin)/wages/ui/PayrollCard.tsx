import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Tag } from "@/components/ui/Tag";
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
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-label font-semibold text-ink-muted mb-1">
            Month
          </label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-control border border-border-strong px-3 py-2 text-body"
          />
        </div>
        <button
          onClick={handleRun}
          disabled={busy}
          className="rounded-control bg-primary px-4 py-2 text-body font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? "Working…" : "Calculate payroll"}
        </button>
      </div>

      {message && (
        <div className="mb-3 rounded-card bg-status-info-bg px-3 py-2 text-body text-status-info-text">
          {message}
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-card border border-status-danger-border bg-status-danger-bg px-4 py-3 text-body text-status-danger-text">
          {loadError} The amounts below are the ones that will be paid, but a
          lesson taught by a substitute may be showing without its label.
        </div>
      )}

      {/* "Loading" and "none" are DIFFERENT ANSWERS. Rendering the previous
          month's rows, or "no payouts yet", while a load is in flight puts a
          live "Mark paid" beside a month the picker no longer names — and
          marking paid is irreversible by design. */}
      {loadingPayouts ? (
        <p className="py-6 text-center text-body text-ink-muted">
          Loading payouts…
        </p>
      ) : payouts.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-muted">
          No payouts for this month yet.
        </p>
      ) : (
        <Table>
          <Thead>
            <Th sort={payoutSort} sortKey="coach_name">Coach</Th>
            <Th sort={payoutSort} sortKey="lessons" firstDir="desc">Lessons</Th>
            <Th sort={payoutSort} sortKey="gross_amount" firstDir="desc" className="text-right">Amount</Th>
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
                      className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-primary"
                    >
                      {expanded === p.id ? (
                        <ChevronDown className="h-4 w-4 text-ink-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-ink-muted" />
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
                      <Tag tone="info" className="ml-1.5">
                        {p.summary.adjustmentTotal > 0 ? "+" : ""}
                        {money(p.summary.adjustmentTotal)} correction
                      </Tag>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums text-ink">
                    {money(p.gross_amount)}
                    {!p.grossOk && (
                      <Tag
                        tone="danger"
                        className="ml-1.5"
                        title={`The lessons below add up to ${money(p.summary.itemTotal)}. A draft payout rebuilds completely on every run, so re-running payroll for this month is the fix.`}
                      >
                        re-run payroll
                      </Tag>
                    )}
                  </Td>
                  <Td>
                    <Tag tone={p.status === "paid" ? "success" : "warning"}>
                      {p.status === "paid" ? "Paid" : "Draft"}
                    </Tag>
                  </Td>
                  <Td>
                    {p.status === "draft" ? (
                      <Button size="sm" variant="outline" onClick={() => handleMarkPaid(p.id)} disabled={busy}>
                        Mark paid
                      </Button>
                    ) : (
                      <span className="text-label text-ink-muted">Frozen</span>
                    )}
                  </Td>
                </Tr>

                {expanded === p.id && (
                  <Tr>
                    <Td colSpan={5} className="bg-ground">
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
