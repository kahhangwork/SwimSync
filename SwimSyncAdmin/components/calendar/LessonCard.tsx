"use client";

import { cn } from "@/lib/utils";
import { colourFor } from "@/lib/classColours";
import { formatCount, isFull, type CalendarLesson } from "@/lib/calendarLessons";

export type LessonCardProps = {
  lesson: CalendarLesson;
  /** `compact` = month chip (one line); `full` = agenda row (more room). */
  layout?: "grid" | "compact" | "full";
  selected?: boolean;
  onOpen?: (lesson: CalendarLesson) => void;
  onHover?: (lesson: CalendarLesson | null, e: React.MouseEvent) => void;
  onPin?: (lesson: CalendarLesson, e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * One lesson on the calendar. Reads only — the card navigates (double-click /
 * Enter) and never writes. Time is NOT printed on the grid card: the grid's
 * axis already says it, and the room goes to coach + count (the user's call).
 */
export function LessonCard({
  lesson,
  layout = "grid",
  selected = false,
  onOpen,
  onHover,
  onPin,
  className,
  style,
}: LessonCardProps) {
  const colour = colourFor(lesson.colourKey);
  const full = isFull(lesson.enrolled, lesson.guests, lesson.capacity);
  const count = formatCount(lesson.enrolled, lesson.guests, lesson.capacity);
  // Faded for the two "this lesson is not happening" states: a holiday void
  // and an advance cancellation.
  const dim = lesson.progress === "holiday" || lesson.progress === "cancelled";
  const needsMark = lesson.progress === "unmarked" || lesson.progress === "partial";

  const title = `${lesson.title} · ${lesson.start}–${lesson.end} · ${lesson.mainCoach.name}${
    lesson.mainCoach.isCover ? " (sub)" : ""
  } · ${count}`;

  if (layout === "compact") {
    return (
      <button
        type="button"
        data-testid="lesson-chip"
        data-lesson-key={lesson.key}
        title={title}
        onDoubleClick={() => onOpen?.(lesson)}
        onClick={(e) => onPin?.(lesson, e)}
        onMouseEnter={(e) => onHover?.(lesson, e)}
        onMouseLeave={(e) => onHover?.(null, e)}
        className={cn(
          "flex w-full items-center gap-1 truncate rounded border-l-4 px-1 py-0.5 text-left text-[11px] leading-tight",
          colour.card,
          dim && "opacity-50",
          selected && "ring-2 ring-sky-400",
          className
        )}
        style={style}
      >
        <span className="truncate font-semibold">{lesson.title}</span>
        <span className="ml-auto shrink-0 font-semibold tabular-nums">{count}</span>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="lesson-card"
      data-lesson-key={lesson.key}
      title={title}
      onDoubleClick={() => onOpen?.(lesson)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen?.(lesson);
      }}
      onClick={(e) => onPin?.(lesson, e)}
      onMouseEnter={(e) => onHover?.(lesson, e)}
      onMouseLeave={(e) => onHover?.(null, e)}
      className={cn(
        "group overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs leading-snug shadow-sm cursor-pointer select-none",
        colour.card,
        dim && "opacity-50",
        needsMark && "border-dashed",
        selected && "ring-2 ring-sky-400",
        layout === "full" && "py-2",
        className
      )}
      style={style}
    >
      <div className="flex items-start gap-1">
        <span className="truncate font-semibold">{lesson.title}</span>
        {lesson.offPattern && (
          <span className="ml-auto shrink-0 rounded bg-white/70 px-1 text-[10px] font-medium" title="Extra (off-schedule) lesson">
            extra
          </span>
        )}
        {lesson.progress === "holiday" && (
          <span className="ml-auto shrink-0 rounded bg-white/70 px-1 text-[10px] font-medium">Holiday</span>
        )}
        {lesson.progress === "cancelled" && (
          <span
            className="ml-auto shrink-0 rounded bg-white/70 px-1 text-[10px] font-medium"
            title={lesson.cancellationReason ? `Cancelled: ${lesson.cancellationReason}` : "Cancelled"}
          >
            Cancelled
          </span>
        )}
      </div>
      {layout === "full" && (
        <div className="text-[11px] opacity-80">
          {lesson.start}–{lesson.end} · {lesson.location}
        </div>
      )}
      <div className="truncate">
        <span className={cn(lesson.mainCoach.isCover && "font-medium")}>{lesson.mainCoach.name}</span>
        {lesson.mainCoach.isCover && (
          <span className="ml-1 text-red-600 font-semibold">(Sub)</span>
        )}
        {lesson.shadowNames.length > 0 && (
          <span className="ml-1 opacity-70" title={`Shadow: ${lesson.shadowNames.join(", ")}`}>
            +{lesson.shadowNames.length} shadow
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span
          data-testid="lesson-count"
          className={cn("font-bold tabular-nums", full && "text-red-600")}
          title={
            lesson.capacity == null
              ? `${lesson.enrolled} enrolled${lesson.guests ? `, ${lesson.guests} guest(s)` : ""} — no limit set`
              : `${lesson.enrolled} enrolled${lesson.guests ? ` + ${lesson.guests} guest(s)` : ""} of ${lesson.capacity}`
          }
        >
          {count}
        </span>
        {full && <span className="text-[10px] font-semibold text-red-600">FULL</span>}
        {needsMark && (
          <span className="ml-auto text-[10px] font-medium text-amber-700" title="Attendance not fully marked">
            {lesson.progress === "partial" ? `${lesson.marked}/${lesson.enrolled + lesson.guests} marked` : "unmarked"}
          </span>
        )}
        {lesson.progress === "complete" && (
          <span className="ml-auto text-[10px] text-emerald-700" title="Fully marked">✓</span>
        )}
      </div>
    </div>
  );
}
