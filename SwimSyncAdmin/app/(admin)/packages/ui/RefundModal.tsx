// "Record a refund" + "Reverse this refund?" dialogs (PACKAGE_REVENUE_REFUNDS_PLAN.md
// U2). State/handlers come as one `form` prop (useRefund). The Reverse confirm is
// a Modal — never window.confirm (drivers auto-accept it, §7.279) nor Alert.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { formatSgStamp, todayInSg, toSgDate } from "@/lib/lessonDates";
import { money } from "../constants";
import type { RefundForm } from "../domain/useRefund";

const DMY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

export function RefundModal({ form, busy }: { form: RefundForm; busy: boolean }) {
  const {
    refunding,
    setRefunding,
    amount,
    setAmount,
    refundedOn,
    setRefundedOn,
    note,
    setNote,
    refundError,
    submitRefund,
  } = form;

  return (
    <Modal
      open={refunding !== null}
      onClose={() => setRefunding(null)}
      title="Record a refund"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Record money you have <strong>already sent</strong> to{" "}
          <strong>{refunding?.parent_name}</strong> for{" "}
          <strong>{refunding?.name}</strong>. It comes off Revenue in the month
          of the date below.
        </p>
        <div>
          <label htmlFor="refund-amount" className="mb-1 block text-sm font-medium text-gray-700">
            Amount refunded (S$)
          </label>
          {/* No figure in the placeholder — nothing is suggested (decided 2026-09-27). */}
          <input
            id="refund-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500" data-testid="refund-ceiling">
            Up to {money(refunding?.amount_payable ?? 0)} — what the family paid.
          </p>
        </div>
        <div>
          <label htmlFor="refund-date" className="mb-1 block text-sm font-medium text-gray-700">
            Date paid out
          </label>
          <input
            id="refund-date"
            type="date"
            value={refundedOn}
            max={todayInSg()}
            min={refunding?.confirmed_at ? toSgDate(refunding.confirmed_at) : undefined}
            onChange={(e) => setRefundedOn(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="refund-note" className="mb-1 block text-sm font-medium text-gray-700">
            Note <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="refund-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Family moved away"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {refundError && (
          <p className="text-sm text-red-600" role="alert" data-testid="refund-error">
            {refundError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRefunding(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submitRefund} disabled={busy}>
            {busy ? "Recording…" : "Record refund"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ReverseRefundModal({ form, busy }: { form: RefundForm; busy: boolean }) {
  const { reversing, setReversing, reverseError, submitReverse } = form;
  return (
    <Modal
      open={reversing !== null}
      onClose={() => setReversing(null)}
      title="Reverse this refund?"
    >
      <p className="text-sm text-gray-600">
        The refund of <strong>{money(reversing?.refund.amount ?? 0)}</strong> on{" "}
        {reversing ? formatSgStamp(reversing.refund.refunded_on, DMY) : ""} is kept
        on record as reversed, and no longer counts on Accounting. You can then
        record the correct one.
      </p>
      {reverseError && (
        <p className="mt-3 text-sm text-red-600" role="alert" data-testid="reverse-error">
          {reverseError}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => setReversing(null)} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" onClick={submitReverse} disabled={busy}>
          {busy ? "Working…" : "Reverse refund"}
        </Button>
      </div>
    </Modal>
  );
}
