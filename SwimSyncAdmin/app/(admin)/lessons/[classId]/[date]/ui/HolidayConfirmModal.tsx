// Confirm: void as a public holiday — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { AttendanceSaveState } from "../domain/useAttendanceSave";

export function HolidayConfirmModal({ ld, sv }: { ld: LessonDetail; sv: AttendanceSaveState }) {
  const { holidayDays } = ld;
  const { confirmHoliday, setConfirmHoliday, doSave } = sv;

  return (
    <>
      {/* ── Confirm: holiday void ───────────────────────────────────────── */}
      <Modal title="Void as a public holiday?" open={confirmHoliday !== null} onClose={() => setConfirmHoliday(null)}>
        <p className="text-sm text-gray-700">
          This marks <strong>{confirmHoliday}</strong> student{confirmHoliday === 1 ? "" : "s"} as <em>public holiday</em>: the lesson bills nothing for them and each of their prepaid packages is extended by <strong>{holidayDays} day{holidayDays === 1 ? "" : "s"}</strong>. A billed lesson turning into a holiday issues a credit note. This can be reversed by marking them again.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmHoliday(null)}>
            Cancel
          </Button>
          <Button className="flex-1" data-testid="confirm-holiday" onClick={() => { setConfirmHoliday(null); void doSave(); }}>
            Void {confirmHoliday} as holiday
          </Button>
        </div>
      </Modal>
    </>
  );
}
