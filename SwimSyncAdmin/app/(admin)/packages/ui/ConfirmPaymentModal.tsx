// "Confirm payment received?" dialog (slice 5). Stage 5 of
// PACKAGES_REFACTOR_PLAN.md — markup verbatim; state + handlers as props.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { money } from "../constants";
import type { Purchase } from "../types";

export function ConfirmPaymentModal({
  confirming,
  confirmStart,
  setConfirmStart,
  busy,
  setConfirming,
  confirmPurchase,
}: {
  confirming: Purchase | null;
  confirmStart: string;
  setConfirmStart: (v: string) => void;
  busy: boolean;
  setConfirming: (p: Purchase | null) => void;
  confirmPurchase: (p: Purchase) => void;
}) {
  return (
    <Modal
      open={confirming !== null}
      onClose={() => setConfirming(null)}
      title="Confirm payment received?"
    >
      <p className="text-body text-ink-secondary">
        {confirming && (
          <>
            <strong>{confirming.parent_name}</strong> — {confirming.name} for{" "}
            <strong>{money(confirming.amount_payable)}</strong>
            {confirming.discount_amount > 0 && (
              <span className="text-status-success-text">
                {" "}(after a {money(confirming.discount_amount)} referral discount
                off {money(confirming.total_value)})
              </span>
            )}
            . Confirming activates the package; its validity runs from the
            start date below.
          </>
        )}
      </p>
      <div className="mt-4">
        <label className="mb-1 block text-body font-medium text-ink-secondary">
          Start date
        </label>
        {/* ⚠ RISK 3 — for an OFFER the parent already paid against this date;
            show it so the admin does not silently move the validity window. */}
        {confirming?.offered_by && confirming?.start_date && (
          <p className="mb-1 text-label font-medium text-primary">
            Offered start: {confirming.start_date}
          </p>
        )}
        <input
          type="date"
          value={confirmStart}
          onChange={(e) => setConfirmStart(e.target.value)}
          className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
        />
        <p className="mt-1 text-label text-ink-muted">
          {confirming?.offered_by
            ? "Defaults to the offered start above — change only if needed."
            : "Suggested from when this parent’s current coverage ends — adjust it freely."}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setConfirming(null)}
          disabled={busy}
        >
          Not yet
        </Button>
        <Button
          onClick={() => confirming && confirmPurchase(confirming)}
          disabled={busy}
        >
          {busy ? "Confirming…" : "Payment received"}
        </Button>
      </div>
    </Modal>
  );
}
