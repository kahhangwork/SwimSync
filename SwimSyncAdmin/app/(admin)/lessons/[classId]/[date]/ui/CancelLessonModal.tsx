// Cancel this lesson (reason required) — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatSgDate } from "@/lib/lessonDates";
import type { CancelLessonState } from "../domain/useCancelLesson";
import type { ClassInfo } from "../types";

export function CancelLessonModal({ date, cls, cx }: { date: string; cls: ClassInfo; cx: CancelLessonState }) {
  const { cancelOpen, setCancelOpen, cancelReason, setCancelReason, cancelBusy, cancelError, doCancelLesson } = cx;

  return (
    <>
      {/* ── Cancel this lesson (reason required) ───────────────────────── */}
      <Modal title={`Cancel ${cls.title} on ${formatSgDate(date)}?`} open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">
            The whole lesson is called off — rain, the coach away. Every parent sees it struck out under Upcoming with your reason,
            the coach has nothing to mark, and the billing month does not wait for it. A single child not coming is an absence, not this.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reason (the parents and the coach see this)</span>
            <input
              aria-label="Cancellation reason"
              data-testid="cancel-reason"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
              placeholder="e.g. Heavy rain forecast — pool closed"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              disabled={cancelBusy}
            />
          </label>
          {cancelError && <p data-testid="cancel-error" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{cancelError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
              Keep the lesson
            </Button>
            <Button className="flex-1" data-testid="confirm-cancel-lesson" onClick={doCancelLesson} disabled={cancelBusy || cancelReason.trim() === ""}>
              {cancelBusy ? "Cancelling…" : "Cancel the lesson"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
