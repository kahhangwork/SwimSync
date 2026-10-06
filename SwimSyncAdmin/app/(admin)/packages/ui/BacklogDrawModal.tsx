// "Lessons already marked" — the backdated-activation question (Wave 6 D5).
// Opens only when package_backlog_preview returned rows, after the package is
// already active. Two answers, and neither is a default: Draw from package /
// Keep as ad-hoc. After a draw it shows the DRAW's own count, not the preview's.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { formatSgStamp } from "@/lib/lessonDates";
import {
  backlogRowFunding,
  drawResultText,
  lessonCount,
  summariseBacklog,
} from "../domain/backlogDraw";
import type { BacklogDraw } from "../domain/useBacklogDraw";

const DM: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

export function BacklogDrawModal({ form }: { form: BacklogDraw }) {
  const { backlog, drawing, draw, dismiss } = form;
  const s = backlog ? summariseBacklog(backlog.rows) : null;
  const done = backlog?.drawn != null;

  return (
    <Modal
      open={backlog !== null}
      onClose={dismiss}
      title="Lessons already marked"
    >
      {backlog && s && (
        <>
          <p className="text-sm text-gray-600">
            <strong>{backlog.packageName}</strong> is active.{" "}
            {lessonCount(s.total)} since its start date{" "}
            {s.total === 1 ? "was" : "were"} marked before it was, and{" "}
            {s.total === 1 ? "hasn't" : "haven't"} been billed yet.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-gray-600" data-testid="backlog-summary">
            {s.thisPackage > 0 && <li>{lessonCount(s.thisPackage)} from this package</li>}
            {s.otherPackage > 0 && <li>{lessonCount(s.otherPackage)} from another package of the family</li>}
            {s.adhoc > 0 && <li>{lessonCount(s.adhoc)} no package can cover — these stay ad-hoc</li>}
          </ul>

          <div className="mt-3 max-h-48 overflow-y-auto rounded border border-gray-100">
            <table className="w-full text-xs">
              <tbody>
                {backlog.rows.map((r) => (
                  <tr key={`${r.session_date}:${r.student_id}`} className="border-b border-gray-50 last:border-0">
                    <td className="px-2 py-1 text-gray-700">{formatSgStamp(r.session_date, DM)}</td>
                    <td className="px-2 py-1 text-gray-700">{r.student_name}</td>
                    <td className="px-2 py-1 text-gray-500">{r.class_title}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{backlogRowFunding(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {backlog.error && (
            <p className="mt-3 text-sm text-red-600" role="alert">{backlog.error}</p>
          )}
          {done && (
            <p className="mt-3 text-sm font-medium text-emerald-700" data-testid="backlog-drawn">
              {drawResultText(backlog.drawn!)}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            {done ? (
              <Button onClick={dismiss}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={dismiss} disabled={drawing}>
                  Keep as ad-hoc
                </Button>
                <Button onClick={draw} disabled={drawing}>
                  {drawing ? "Drawing…" : "Draw from package"}
                </Button>
              </>
            )}
          </div>
          {!done && (
            <p className="mt-2 text-[11px] text-gray-400">
              Keep as ad-hoc bills them at the next run. Lessons already invoiced
              are never listed — the family pays that invoice.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
