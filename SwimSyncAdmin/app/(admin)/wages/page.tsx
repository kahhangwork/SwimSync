"use client";

import { PageHeader } from "@/components/PageHeader";
import { useWages } from "./domain/useWages";
import { usePayroll } from "./domain/usePayroll";
import { useRateEditor } from "./domain/useRateEditor";
import { PolicyCard } from "./ui/PolicyCard";
import { RatesCard } from "./ui/RatesCard";
import { PayrollCard } from "./ui/PayrollCard";

/**
 * Coach wages — the other half of the billing loop.
 *
 * SwimSync tracked every dollar coming IN from parents and nothing going OUT to
 * coaches, so the moment a coach is not the business owner, payroll is a
 * spreadsheet rebuilt by hand from attendance this app already holds.
 *
 * A coach appears here only if they HAVE A RATE. That is how a private coach
 * falls out of payroll without any private-vs-school branch: their income is
 * their parents' invoices, and there is nobody upstream to pay them.
 *
 * DRAFT payouts rebuild on every run — ordinary late corrections just flow in.
 * PAID ones freeze, because money has left the bank and the record has to
 * reconcile against a statement; a later correction to a frozen month appears
 * as an adjustment on the next one.
 *
 * SINCE THE LESSON-LEVEL ROSTER (2026-08-11) A LESSON IS NO LONGER ONE ROW.
 * A shadowed lesson pays two coaches out of two different payouts, and a
 * corrected one leaves a second item on the SAME payout. So the breakdown sums
 * a SET of items per lesson and counts DISTINCT lessons — `domain/payoutItems.ts`
 * holds that arithmetic, and its header explains why none of it may consult
 * `classes.coach_id`.
 *
 * A COVER IS SHOWN AS A DECISION, NEVER AS A DIFFERENT NUMBER. The expensive
 * failure here is not a wrong total; it is a right total nobody can explain —
 * a coach paid $40 less than last month with nothing on screen saying a lesson
 * was reassigned, which turns into a conversation the admin cannot win.
 *
 * Composition only (Admin L-C): the tenant/policy/coaches spine + shared
 * busy/message in domain/useWages, the payroll run (the stale-guarded multi-trip
 * load, Calculate, Mark paid) in domain/usePayroll, the rate editor in
 * domain/useRateEditor, row mapping + money/line labels in domain/wageRows, the
 * lesson-line arithmetic in domain/payoutItems (moved from @/lib — sole
 * importer), data in dao/wages.{repo,rpc}, markup in ui/.
 * See docs/refactor/BATCH_C_PLAN.md.
 */
export default function WagesPage() {
  const w = useWages();
  const pay = usePayroll(w.tenantId, w.coaches, w.setBusy, w.setMessage);
  const rate = useRateEditor(w.tenantId, w.loadCoaches, w.setBusy, w.setMessage);

  if (!w.tenantId) {
    return (
      <div>
        <PageHeader title="Wages" subtitle="Pay your coaches from attendance" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600">
          Wages are run per business, and your account is not attached to one.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Wages"
        subtitle="Calculated from the lessons your coaches actually taught"
      />

      {/* Policy */}
      <PolicyCard
        rainPays={w.rainPays}
        setRainPays={w.setRainPays}
        runDay={w.runDay}
        setRunDay={w.setRunDay}
        updateTenant={w.updateTenant}
      />

      {/* Rates */}
      <RatesCard
        rateSort={w.rateSort}
        visibleCoaches={w.visibleCoaches}
        rateFor={rate.rateFor}
        setRateFor={rate.setRateFor}
        rateRole={rate.rateRole}
        setRateRole={rate.setRateRole}
        rateAmount={rate.rateAmount}
        setRateAmount={rate.setRateAmount}
        rateUnit={rate.rateUnit}
        setRateUnit={rate.setRateUnit}
        rateFrom={rate.rateFrom}
        setRateFrom={rate.setRateFrom}
        busy={w.busy}
        handleSaveRate={rate.handleSaveRate}
      />

      {/* Payroll run */}
      <PayrollCard
        period={pay.period}
        setPeriod={pay.setPeriod}
        handleRun={pay.handleRun}
        busy={w.busy}
        message={w.message}
        loadError={pay.loadError}
        loadingPayouts={pay.loadingPayouts}
        payouts={pay.payouts}
        payoutSort={pay.payoutSort}
        visiblePayouts={pay.visiblePayouts}
        expanded={pay.expanded}
        setExpanded={pay.setExpanded}
        handleMarkPaid={pay.handleMarkPaid}
      />
    </div>
  );
}
