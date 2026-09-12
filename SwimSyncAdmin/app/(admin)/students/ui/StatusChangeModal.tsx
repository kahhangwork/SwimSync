// Slice 5 — the "Set inactive?" / "Remove from class?" confirmation, and the
// action error shown beneath it. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { StudentStatusState } from "../domain/useStudentStatus";

export function StatusChangeModal({ status }: { status: StudentStatusState }) {
  const { pending, siblings, family, takeSiblings, lastActive } = status;
  return (
    <>
      <Modal
        title={
          pending?.mode === "inactive"
            ? `Set ${pending.student.full_name} inactive?`
            : `Remove ${pending?.student.full_name} from ${pending?.cls?.title}?`
        }
        open={pending !== null}
        onClose={status.close}
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {pending.mode === "inactive"
                ? "They stop appearing on rosters and stop counting toward attendance. EVERY active class enrolment is closed at the same time."
                : `They come off this class's roster only. ${
                    (pending.student.classes.length ?? 0) > 1
                      ? "Their other classes are untouched."
                      : "This is their only class, so they return to Unassigned for you to place elsewhere."
                  } The enrolment is closed, not deleted.`}
            </p>
            {/* Siblings are a CHOICE — the admin may be removing one child
                while the others keep attending. Only shown when there are any. */}
            {pending.mode === "inactive" && siblings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-900">
                  {siblings.length === 1
                    ? `${siblings[0].full_name} is also in this family.`
                    : `${siblings.map((c) => c.full_name).join(", ")} are also in this family.`}
                </p>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={!takeSiblings}
                    onChange={() => status.setTakeSiblings(false)}
                  />
                  <span>
                    Just {pending.student.full_name}
                    {siblings.length === 1
                      ? ` — ${siblings[0].full_name} keeps attending`
                      : " — the others keep attending"}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={takeSiblings}
                    onChange={() => status.setTakeSiblings(true)}
                  />
                  <span>All {family.length} children in this family</span>
                </label>
              </div>
            )}

            {/* The family outcome is a CONSEQUENCE, not a question — a family
                with no active children here is no longer a customer here. So it
                is stated, not asked. */}
            {pending.mode === "inactive" && lastActive && (
              <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                That leaves no active children, so{" "}
                <strong>{pending.student.parent_name}</strong> will be marked
                inactive at this business too. They can rejoin any time with your
                join code.
              </p>
            )}

            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Attendance and billing history are kept, and lessons they have
              already attended this month will still be invoiced. Any credit
              balance is untouched.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={status.close}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={status.busyId !== null}
                onClick={() =>
                  status.handleStatusChange(pending.student, pending.mode, pending.cls)
                }
              >
                {pending.mode === "inactive" ? "Set inactive" : "Remove"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {status.actionError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {status.actionError}
        </p>
      )}
    </>
  );
}
