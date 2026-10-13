"use client";

import Link from "next/link";
import { formatCount, type CalendarLesson, type CalendarStudent } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";

export function lessonHref(lesson: Pick<CalendarLesson, "classId" | "date">): string {
  return `/lessons/${lesson.classId}/${lesson.date}`;
}

/** One glyph per attendance state — the legend the user asked for on hover.
 *  Tones follow lib/statusTone.ts: Present success, Trial info, the rest neutral
 *  (an absence is not a fault; UI restyle 5.11). */
export function statusGlyph(s: CalendarStudent): { glyph: string; label: string; className: string } {
  switch (s.status) {
    case "present":
      return { glyph: "✓", label: "Present", className: "text-status-success-text" };
    case "absent":
      return { glyph: "✗", label: "Absent", className: "text-status-neutral-text" };
    case "cancelled_rain":
      return { glyph: "~", label: "Cancelled (rain)", className: "text-status-neutral-text" };
    case "cancelled_coach":
      return { glyph: "~", label: "Cancelled (coach)", className: "text-status-neutral-text" };
    case "trial_paid":
      return { glyph: "T", label: "Trial (paid)", className: "text-status-info-text" };
    case "trial_free":
      return { glyph: "T", label: "Trial (free)", className: "text-status-info-text" };
    case "holiday":
      return { glyph: "H", label: "Public holiday", className: "text-ink-muted" };
    default:
      return { glyph: "○", label: "Not marked", className: "text-ink-muted" };
  }
}

type Props = {
  lesson: CalendarLesson;
  /** Viewport coordinates of the pointer (fixed positioning). */
  x: number;
  y: number;
  pinned: boolean;
  onClose?: () => void;
};

const WIDTH = 280;

export function LessonTooltip({ lesson, x, y, pinned, onClose }: Props) {
  // Keep it on screen: flip left of the pointer near the right edge, and clamp
  // the bottom.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(x + 12, vw - WIDTH - 8));
  const estHeight = 120 + lesson.students.length * 20;
  const top = Math.max(8, Math.min(y + 12, vh - estHeight - 8));

  return (
    <div
      role="tooltip"
      data-testid="lesson-tooltip"
      className={cn(
        "fixed z-50 rounded-card border border-border bg-surface p-3 text-label text-ink shadow-float",
        pinned ? "pointer-events-auto" : "pointer-events-none"
      )}
      style={{ left, top, width: WIDTH }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{lesson.title}</div>
        {pinned && (
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-tag px-1 text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-0.5 text-ink-muted">
        {formatSgDate(lesson.date, { weekday: "short", day: "numeric", month: "short" })} · {lesson.start}–{lesson.end}
        {" · "}
        {lesson.mainCoach.name}
        {lesson.mainCoach.isCover && <span className="font-semibold text-ink-secondary"> (Sub)</span>}
        {" · "}
        <span className="font-semibold">{formatCount(lesson.enrolled, lesson.guests, lesson.capacity)}</span>
      </div>
      {lesson.shadowNames.length > 0 && (
        <div className="text-ink-muted">Shadow: {lesson.shadowNames.join(", ")}</div>
      )}
      {lesson.holidayName && <div className="text-ink-muted">Public holiday: {lesson.holidayName}</div>}
      {lesson.progress === "cancelled" && (
        <div className="text-ink-muted">Cancelled{lesson.cancellationReason ? `: ${lesson.cancellationReason}` : ""}</div>
      )}

      <ul className="mt-2 space-y-0.5">
        {lesson.students.length === 0 && <li className="text-ink-muted">Nobody expected</li>}
        {lesson.students.map((s) => {
          const g = statusGlyph(s);
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className={cn("w-3 text-center font-semibold", g.className)} title={g.label} aria-label={g.label}>
                {g.glyph}
              </span>
              <span className="truncate">{s.name}</span>
              {s.kind !== "enrolled" && (
                <span className="rounded-tag border border-status-info-border bg-status-info-bg px-1 text-label text-status-info-text">
                  {s.kind === "trial" ? "trial" : "make-up"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {pinned && (
        <div className="mt-2 border-t border-divider pt-2">
          <Link href={lessonHref(lesson)} className="font-medium text-primary hover:underline underline-offset-2">
            Open lesson →
          </Link>
        </div>
      )}
    </div>
  );
}
