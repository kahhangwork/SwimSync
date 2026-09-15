// "Decline this request?" / "Cancel this package?" dialog (slice 6). Stage 5 of
// PACKAGES_REFACTOR_PLAN.md — markup verbatim; state + handlers as props.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { money } from "../constants";
import type { Purchase } from "../types";

export function CancelModal({
  cancelling,
  busy,
  setCancelling,
  cancelPurchase,
}: {
  cancelling: Purchase | null;
  busy: boolean;
  setCancelling: (p: Purchase | null) => void;
  cancelPurchase: (p: Purchase) => void;
}) {
  return (
    <Modal
      open={cancelling !== null}
      onClose={() => setCancelling(null)}
      title={
        cancelling?.status === "pending"
          ? "Decline this request?"
          : "Cancel this package?"
      }
    >
      <p className="text-sm text-gray-600">
        {cancelling?.status === "pending" ? (
          "The request is withdrawn. Nothing was charged."
        ) : (
          <>
            <strong>{money(cancelling?.value_remaining ?? 0)}</strong>{" "}
            remains on this package. Cancelling freezes it at that amount —
            settle any refund with the family directly; SwimSync keeps the
            record but does not move the money.
          </>
        )}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setCancelling(null)}
          disabled={busy}
        >
          Keep it
        </Button>
        <Button
          variant="danger"
          onClick={() => cancelling && cancelPurchase(cancelling)}
          disabled={busy}
        >
          {busy ? "Working…" : cancelling?.status === "pending" ? "Decline" : "Cancel package"}
        </Button>
      </div>
    </Modal>
  );
}
