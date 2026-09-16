"use client";

import { formatSgDate } from "@/lib/lessonDates";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type BlockedLesson = {
  class_id: string;
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

/** Server refused: attendance is incomplete. Distinct from the pre-flight
 *  dialog — the client-side coverage check and the engine compute the rule
 *  separately, so this fires when they disagree (and is the authoritative
 *  answer). */
export function BlockedLessonsModal({
  blockedLessons,
  onClose,
}: {
  blockedLessons: BlockedLesson[];
  onClose: () => void;
}) {
  return (
    <Modal
      title="Cannot generate invoices"
      open={blockedLessons.length > 0}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-red-700">
            {blockedLessons.length} lesson
            {blockedLessons.length === 1 ? "" : "s"} still need attendance
            marked.
          </p>
          <ul className="mt-2 space-y-1">
            {blockedLessons.map((b) => (
              <li
                key={`${b.class_id}-${b.session_date}`}
                className="text-xs text-gray-700"
              >
                <span className="font-semibold">{b.class_title}</span> ·{" "}
                {formatSgDate(b.session_date)}
                <span className="text-red-700">
                  {" "}
                  ({b.unmarked_student_count} student
                  {b.unmarked_student_count === 1 ? "" : "s"})
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-gray-600">
          Mark these in the coach&apos;s app — or mark them{" "}
          <strong>cancelled</strong> if the lesson didn&apos;t run — then
          generate again. Nothing was billed, so there is nothing to undo.
        </p>
        <Button className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
