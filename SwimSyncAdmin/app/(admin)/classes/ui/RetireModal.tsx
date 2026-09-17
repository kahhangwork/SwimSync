import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { ClassRow } from "../types";

/**
 * Retire a class. The three refusals are enforced in deactivate_class() and
 * their messages are shown verbatim below — they name the children, the booked
 * guests or the unmarked dates in the way. This is an ordinary React dialog,
 * not Alert.alert: this is the Next.js panel, and the RN-web no-op does not
 * apply here.
 */
export function RetireModal({
  retireFor,
  onClose,
  retireError,
  retireSaving,
  onRetire,
}: {
  retireFor: ClassRow | null;
  onClose: () => void;
  retireError: string | null;
  retireSaving: boolean;
  onRetire: () => void;
}) {
  return (
    <Modal
      title={retireFor ? `Retire ${retireFor.title}?` : "Retire class"}
      open={retireFor !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          This class stops being scheduled. It disappears from the coach&apos;s
          app, and no new lessons can be marked on it.
        </p>
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">
            Lessons it has already taught still bill as normal.
          </span>{" "}
          You can put it back at any time with <em>Restore</em>.
        </p>

        {retireError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {retireError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onRetire} disabled={retireSaving}>
            {retireSaving ? "Retiring…" : "Retire class"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
