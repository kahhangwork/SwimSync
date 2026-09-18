// The attendance table, Set all, markability banner and save bar — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import { formatCount } from "@/lib/calendarLessons";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, SET_ALL_OPTIONS, rowEditable, type DbStatus } from "../domain/lessonMarking";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { AttendanceSaveState } from "../domain/useAttendanceSave";
import type { GuestBookingState } from "../domain/useGuestBooking";
import type { ClassInfo } from "../types";
import { StatusButtons } from "./StatusButtons";

export function AttendancePanel({ cls, ld, sv, gb }: { cls: ClassInfo; ld: LessonDetail; sv: AttendanceSaveState; gb: GuestBookingState }) {
  const { roster, draft, setDraft, cancelled, isFuture, markability, newRowsAllowed, full, enrolledCount, guestCount, dirty } = ld;
  const { saving, saveMsg, requestSave, setAll } = sv;
  const { cancelBooking } = gb;
  const countText = formatCount(enrolledCount, guestCount, cls.capacity);

  return (
    <section className="lg:col-span-2 rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <h2 className="font-semibold text-gray-900">Attendance</h2>
        <span data-testid="lesson-count" className={cn("rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums", full && "bg-red-50 text-red-700")} title="enrolled + guests / max">
          {countText}
          {full && " · FULL"}
        </span>
        {!cls.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Retired class</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-gray-500">Set all</label>
          <select
            aria-label="Set all to"
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
            value=""
            disabled={isFuture || roster.length === 0 || !!cancelled}
            onChange={(e) => {
              if (e.target.value) setAll(e.target.value as DbStatus);
            }}
          >
            <option value="">Set all to…</option>
            {SET_ALL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {markability && !markability.ok && (
        <div data-testid="markability" className={cn("mx-4 mt-3 rounded-lg px-3 py-2 text-sm", isFuture ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-900")}>
          <span className="font-semibold">{markability.title}.</span> {markability.detail}
          {!isFuture && roster.some((r) => r.prev !== null) && (
            <span> Rows that already have a mark can still be corrected.</span>
          )}
        </div>
      )}

      {roster.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">Nobody is expected at this lesson — no enrolled children on this date and no guests booked.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2">Student</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => {
              const editable = !isFuture && rowEditable(r.prev !== null, newRowsAllowed);
              const changed = (draft[r.studentId] ?? null) !== r.prev;
              return (
                <tr key={r.studentId} data-testid="roster-row" data-student={r.studentId} className={cn("border-t border-gray-100", changed && "bg-amber-50/40")}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-gray-900">{r.name}</span>
                    {r.kind !== "enrolled" && (
                      <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                        {r.kind === "trial" ? "Trial" : "Make-up"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusButtons
                      name={r.name}
                      kind={r.kind}
                      value={draft[r.studentId] ?? null}
                      disabled={!editable}
                      onChange={(next) => setDraft((d) => ({ ...d, [r.studentId]: next }))}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.bookingId && (
                      <button type="button" onClick={() => cancelBooking(r)} className="text-xs text-red-600 hover:underline">
                        Cancel booking
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
        <Button onClick={requestSave} disabled={saving || !dirty || isFuture || !!cancelled} data-testid="save-attendance">
          {saving ? "Saving…" : "Save attendance"}
        </Button>
        {dirty && !saving && <span className="text-xs text-gray-500">Unsaved changes</span>}
        {saveMsg && (
          <span data-testid="save-message" className={cn("text-sm", saveMsg.kind === "ok" ? "text-emerald-700" : "text-red-700")}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </section>
  );
}
