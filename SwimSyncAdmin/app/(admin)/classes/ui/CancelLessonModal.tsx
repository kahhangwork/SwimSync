import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Field } from "./Field";
import type { ClassRow } from "../types";

export function CancelLessonModal({
  cancelFor,
  onClose,
  cancelDate,
  onCancelDate,
  cancelReason,
  onCancelReason,
  cancelSaving,
  cancelError,
  cancelDone,
  onCancelLesson,
}: {
  cancelFor: ClassRow | null;
  onClose: () => void;
  cancelDate: string;
  onCancelDate: (v: string) => void;
  cancelReason: string;
  onCancelReason: (v: string) => void;
  cancelSaving: boolean;
  cancelError: string | null;
  cancelDone: string | null;
  onCancelLesson: () => void;
}) {
  return (
    <Modal
      title={cancelFor ? `Cancel a lesson — ${cancelFor.title}` : "Cancel a lesson"}
      open={cancelFor !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Call off ONE upcoming lesson of this class — rain, the coach away.
          Parents see it struck out under Upcoming with your reason, the coach
          has nothing to mark, and the billing month does not wait for it.{" "}
          <span className="text-gray-700">A lesson that already happened</span>{" "}
          is recorded by the coach as cancelled (rain / coach) instead.
        </p>

        <Field
          label="Date"
          placeholder=""
          value={cancelDate}
          onChange={onCancelDate}
          type="date"
        />

        <Field
          label="Reason"
          value={cancelReason}
          onChange={onCancelReason}
          placeholder="e.g. Heavy rain forecast — pool closed"
        />
        <p className="-mt-2 text-xs text-gray-400">
          Shown to every parent in the class and to the coach.
        </p>

        {cancelError && (
          <p data-testid="cancel-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {cancelError}
          </p>
        )}

        {cancelDone && (
          <p data-testid="cancel-done" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            Cancelled for {cancelDone}. Open the lesson from the Calendar to restore it.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button
            className="flex-1"
            data-testid="confirm-cancel-lesson"
            onClick={onCancelLesson}
            disabled={cancelSaving || !cancelDate || cancelReason.trim() === ""}
          >
            {cancelSaving ? "Cancelling…" : "Cancel the lesson"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
