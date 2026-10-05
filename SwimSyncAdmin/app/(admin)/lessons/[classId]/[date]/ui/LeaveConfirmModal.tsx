// Confirm: leave this lesson with unsaved marks — the admin lesson page
// (lessons/[classId]/[date]). Opened by the prev/next strip; state lives in
// domain/useLessonNav.
//
// ⚠ DISMISSING NEVER NAVIGATES. The backdrop, the X and "Stay" all call stay();
// only the confirm button leaves. A Modal, never window.confirm — drivers
// auto-accept browser dialogs (§7.279).

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { LessonNavState } from "../domain/useLessonNav";

export function LeaveConfirmModal({ nav }: { nav: LessonNavState }) {
  const { leaveOpen, stay, leave } = nav;

  return (
    <Modal title="Leave without saving?" open={leaveOpen} onClose={stay}>
      <p className="text-sm text-gray-700">
        You have unsaved marks on this lesson. If you leave now they are discarded.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" data-testid="nav-leave-stay" onClick={stay}>
          Stay
        </Button>
        <Button variant="danger" className="flex-1" data-testid="nav-leave-confirm" onClick={leave}>
          Leave anyway
        </Button>
      </div>
    </Modal>
  );
}
