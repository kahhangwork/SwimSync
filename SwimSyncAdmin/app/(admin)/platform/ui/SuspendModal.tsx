// The Suspend / Unsuspend confirmation. Stage 8 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim.
//
// ⚠ DRIVER CONTRACT — verify-tenant-suspension reads these as EXACT text:
// "Suspend this business" / "Unsuspend this business" as the button's accessible
// name, "goes dark" and "Already-sent invoice links keep working" in the body.
// Rewording any of them breaks the driver even though the dialog still reads
// correctly to a human.
//
// ⚠ The suspend copy is accepted consequence 1's exact shape (WAVE_5_PLAN.md):
// the outstanding-receivables position is the owner's problem BEFORE suspension,
// and the dialog says so out loud rather than leaving it to be discovered. The
// "already-sent invoice links keep working" sentence is decision 8, not a
// caveat — do not soften it.
//
// ⚠ suspendError renders ABOVE the buttons and the modal stays open behind it,
// because the button is the retry path (see domain/useSuspend.ts).

import { Modal } from "@/components/Modal";

export function SuspendModal({
  suspendModal,
  suspendBusy,
  suspendError,
  onConfirm,
  onClose,
}: {
  suspendModal: { tenantId: string; tenantName: string; suspended: boolean } | null;
  suspendBusy: boolean;
  suspendError: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
        <Modal
          title={
            suspendModal?.suspended
              ? `Unsuspend ${suspendModal?.tenantName ?? ""}?`
              : `Suspend ${suspendModal?.tenantName ?? ""}?`
          }
          open={suspendModal !== null}
          onClose={onClose}
        >
          {suspendModal?.suspended ? (
            <p className="mb-4 text-sm text-gray-700">
              Staff logins come back and the app lights up again for this
              business&apos;s families. Staff who were individually disabled
              before the suspension stay disabled.
            </p>
          ) : (
            /* Accepted consequence 1's exact shape (WAVE_5_PLAN.md): the
               outstanding-receivables position is the owner's problem BEFORE
               suspension, and the dialog says so out loud. */
            <p className="mb-4 text-sm text-gray-700">
              The app goes dark for this business&apos;s staff and families:
              staff logins are blocked, parents stop seeing this
              business&apos;s data (a family with another business keeps that
              one), and no new invoices are generated.{" "}
              <span className="font-medium">
                Already-sent invoice links keep working
              </span>{" "}
              — settling outstanding invoices before suspending is the
              owner&apos;s responsibility.
            </p>
          )}
          {suspendError && (
            <p className="mb-3 text-sm font-medium text-red-600">
              {suspendError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onConfirm}
              disabled={suspendBusy}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                suspendModal?.suspended
                  ? "bg-sky-500 hover:bg-sky-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {suspendBusy
                ? suspendModal?.suspended
                  ? "Unsuspending…"
                  : "Suspending…"
                : suspendModal?.suspended
                  ? "Unsuspend this business"
                  : "Suspend this business"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
          </div>
        </Modal>
  );
}
