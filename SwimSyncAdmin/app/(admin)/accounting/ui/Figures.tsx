import { moneyOrDash } from "../domain/accounting";
import type { Summary } from "../types";
import { Tile } from "./Tile";

// The owner's figures for one month: the four tiles and the revenue breakdown.
export function Figures({ summary }: { summary: Summary }) {
  const wagesRun = summary?.wages_state === "run_payouts";
  const wagesDraft = summary?.wages_state === "draft";

  return (
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
