// The attendance table, Set all, markability banner and save bar — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import { formatCount } from "@/lib/calendarLessons";
import { cn } from "@/lib/utils";
import { Tag } from "@/components/ui/Tag";
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
    <section className="lg:col-span-2 rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-headline font-semibold text-ink">Attendance</h2>
        {/* A full lesson is a fact, not a fault: Warning, never red (Red Means Stuck). */}
        <span data-testid="lesson-count" className={cn("rounded-tag border border-status-neutral-border bg-status-neutral-bg px-1.5 py-0.5 text-label font-semibold tabular-nums text-status-neutral-text", full && "border-status-warning-border bg-status-warning-bg text-status-warning-text")} title="enrolled + guests / max">
          {countText}
          {full && " · FULL"}
        </span>
        {!cls.is_active && <Tag tone="neutral">Retired class</Tag>}
        <div className="ml-auto flex items-center gap-2">
          <label className="text-label text-ink-muted">Set all</label>
          <select
            aria-label="Set all to"
            className="rounded-control border border-border-strong bg-surface px-2 py-1 text-label"
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
        <div data-testid="markability" className={cn("mx-4 mt-3 rounded-control px-3 py-2 text-body", isFuture ? "bg-status-info-bg text-status-info-text" : "bg-status-warning-bg text-status-warning-text")}>
          <span className="font-semibold">{markability.title}.</span> {markability.detail}
          {!isFuture && roster.some((r) => r.prev !== null) && (
            <span> Rows that already have a mark can still be corrected.</span>
          )}
        </div>
      )}

      {roster.length === 0 ? (
        <p className="px-4 py-6 text-body text-ink-muted">Nobody is expected at this lesson — no enrolled children on this date and no guests booked.</p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-label uppercase tracking-wide text-ink-muted">
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
                <tr key={r.studentId} data-testid="roster-row" data-student={r.studentId} className={cn("border-t border-border", changed && "bg-status-warning-bg")}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    {r.kind !== "enrolled" && (
                      <Tag tone="info" className="ml-2">
                        {r.kind === "trial" ? "Trial" : "Make-up"}
                      </Tag>
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
                      <button type="button" onClick={() => cancelBooking(r)} className="text-label text-status-danger-text hover:underline">
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

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <Button onClick={requestSave} disabled={saving || !dirty || isFuture || !!cancelled} data-testid="save-attendance">
          {saving ? "Saving…" : "Save attendance"}
        </Button>
        {dirty && !saving && <span className="text-label text-ink-muted">Unsaved changes</span>}
        {saveMsg && (
          <span data-testid="save-message" className={cn("text-body", saveMsg.kind === "ok" ? "text-status-success-text" : "text-status-danger-text")}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </section>
  );
}
