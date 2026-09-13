// Coaches page — reactivate modal.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { CoachRow } from "../types";

type Props = {
  reactivateModal: CoachRow | null;
  onClose: () => void;
  actionError: string | null;
  actionBusy: boolean;
  handleReactivate: () => void;
};

export function ReactivateCoachModal(p: Props) {
  return (
    <Modal
      title={`Reactivate ${p.reactivateModal?.full_name ?? ""}?`}
      open={!!p.reactivateModal}
      onClose={p.onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Their login and coach access return immediately. Classes handed
          over when they were disabled are <strong>not</strong> handed back —
          reassign any class deliberately from the Classes page.
        </p>

        {p.actionError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {p.actionError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={p.actionBusy} onClick={p.handleReactivate}>
            {p.actionBusy ? "Reactivating…" : "Reactivate coach"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
