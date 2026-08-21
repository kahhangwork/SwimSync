"use client";

import Link from "next/link";
import { formatCount, type CalendarLesson, type CalendarStudent } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";

export function lessonHref(lesson: Pick<CalendarLesson, "classId" | "date">): string {
  return `/lessons/${lesson.classId}/${lesson.date}`;
}

/** One glyph per attendance state — the legend the user asked for on hover. */
export function statusGlyph(s: CalendarStudent): { glyph: string; label: string; className: string } {
  switch (s.status) {
    case "present":
      return { glyph: "✓", label: "Present", className: "text-emerald-600" };
    case "absent":
      return { glyph: "✗", label: "Absent", className: "text-red-600" };
    case "cancelled_rain":
      return { glyph: "~", label: "Cancelled (rain)", className: "text-sky-600" };
    case "cancelled_coach":
      return { glyph: "~", label: "Cancelled (coach)", className: "text-sky-600" };
    case "trial_paid":
      return { glyph: "T", label: "Trial (paid)", className: "text-violet-600" };
    case "trial_free":
      return { glyph: "T", label: "Trial (free)", className: "text-violet-600" };
    case "holiday":
      return { glyph: "H", label: "Public holiday", className: "text-gray-500" };
    default:
      return { glyph: "○", label: "Not marked", className: "text-gray-400" };
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
        "fixed z-50 rounded-lg border border-gray-700 bg-gray-800 p-3 text-xs text-gray-100 shadow-xl",
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
            className="-mr-1 -mt-1 rounded px-1 text-gray-400 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-0.5 text-gray-300">
        {formatSgDate(lesson.date, { weekday: "short", day: "numeric", month: "short" })} · {lesson.start}–{lesson.end}
        {" · "}
        {lesson.mainCoach.name}
        {lesson.mainCoach.isCover && <span className="text-red-300"> (Sub)</span>}
        {" · "}
        <span className="font-semibold">{formatCount(lesson.enrolled, lesson.guests, lesson.capacity)}</span>
      </div>
      {lesson.shadowNames.length > 0 && (
        <div className="text-gray-400">Shadow: {lesson.shadowNames.join(", ")}</div>
      )}
      {lesson.holidayName && <div className="text-gray-400">Public holiday: {lesson.holidayName}</div>}
      {lesson.progress === "cancelled" && (
        <div className="text-gray-400">Cancelled{lesson.cancellationReason ? `: ${lesson.cancellationReason}` : ""}</div>
      )}

      <ul className="mt-2 space-y-0.5">
        {lesson.students.length === 0 && <li className="text-gray-400">Nobody expected</li>}
        {lesson.students.map((s) => {
          const g = statusGlyph(s);
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className={cn("w-3 text-center font-bold", g.className)} title={g.label} aria-label={g.label}>
                {g.glyph}
              </span>
              <span className="truncate">{s.name}</span>
              {s.kind !== "enrolled" && (
                <span className="rounded bg-gray-700 px-1 text-[10px] uppercase tracking-wide text-gray-300">
                  {s.kind === "trial" ? "trial" : "make-up"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {pinned && (
        <div className="mt-2 border-t border-gray-700 pt-2">
          <Link href={lessonHref(lesson)} className="font-medium text-sky-300 hover:underline">
            Open lesson →
          </Link>
        </div>
      )}
    </div>
  );
}
