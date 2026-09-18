// "Credit stays with the old business" — the advisory before a cross-business
// move. Stage 9 of docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim.
//
// ⚠ NO DRIVER OPENS THIS MODAL (grepped 2026-09-18: no verify-*.mjs contains
// "Credit stays" or "Move anyway"), and it is DORMANT on production — no
// cross-business move has happened since the RPC shipped (HANDOVER §3, §8.91).
// Hand-checked at Stage 9; a verify-platform-controls driver is owed.
//
// ⚠ BOTH EXITS CALL THE SAME onCancel. The dialog's onClose (backdrop/escape)
// and the Cancel button are two separate paths, and each must reset the
// uncontrolled picker — domain/useStudentMove.cancelMove() does both halves, so
// neither path can drift from the other.
//
// ⚠ Credit NEVER crosses businesses (PRD §5.6). This is a courtesy prompt so the
// operator can settle or spend it first, NOT a guard — "Move anyway" is a real
// and expected choice, which is why it is the primary button.
//
// ⚠ The checkFailed branch is not an error state to hide. It fires when the
// balance could not be READ, and it must still warn: an advisory that silently
// skips in exactly the case we cannot verify is worse than one shown twice.

import { Modal } from "@/components/Modal";

export function CreditWarningModal({
  pendingMove,
  onConfirm,
  onCancel,
}: {
  pendingMove: {
    studentId: string;
    tenantId: string;
    studentName: string;
    oldTenantName: string;
    credit: number;
    checkFailed: boolean;
  } | null;
  onConfirm: (studentId: string, tenantId: string) => void;
  onCancel: () => void;
}) {
  return (
      <Modal
        title="Credit stays with the old business"
        open={pendingMove !== null}
        onClose={onCancel}
      >
        {pendingMove && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {pendingMove.checkFailed ? (
                <>
                  Couldn&apos;t check whether{" "}
                  <strong>{pendingMove.studentName}</strong>&apos;s family holds
                  credit at <strong>{pendingMove.oldTenantName}</strong>. Credit
                  never moves between businesses (PRD §5.6), so any they have
                  there would become unspendable after the move.
                </>
              ) : (
                <>
                  <strong>{pendingMove.studentName}</strong>&apos;s family holds{" "}
                  <strong>S${pendingMove.credit.toFixed(2)}</strong> in credit at{" "}
                  <strong>{pendingMove.oldTenantName}</strong>. Credit never moves
                  between businesses (PRD §5.6), so it will become{" "}
                  <strong>unspendable</strong> once the child is moved. Settle or
                  spend it first if you can.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => onConfirm(pendingMove.studentId, pendingMove.tenantId)}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Move anyway
              </button>
              <button
                onClick={onCancel}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
  );
}
