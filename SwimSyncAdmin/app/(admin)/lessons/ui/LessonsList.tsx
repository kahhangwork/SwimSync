import Link from "next/link";
import { ChevronRight as Arrow } from "lucide-react";
import { colourFor } from "@/lib/classColours";
import { formatCount, isFull, type CalendarLesson } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import type { LessonsMode } from "../domain/useLessons";
import { Tag } from "@/components/ui/Tag";
import { progressTag } from "../constants";

type Props = {
  days: string[];
  byDate: Map<string, CalendarLesson[]>;
  mode: LessonsMode;
  today: string;
};

export function LessonsList({ days, byDate, mode, today }: Props) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      {days
        .filter((d) => mode === "week" || (byDate.get(d) ?? []).length > 0)
        .map((d) => {
          const list = byDate.get(d) ?? [];
          return (
            <div key={d}>
              <div className={cn("border-b border-divider bg-ground px-4 py-2 text-body font-semibold text-ink-secondary", d === today && "text-ink")}>
                {formatSgDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {d === today && " · Today"}
              </div>
              {list.length === 0 && <div className="px-4 py-2 text-label text-ink-muted">No lessons</div>}
              {list.map((l) => {
                const p = progressTag(l.progress, l.date, today);
                const full = isFull(l.enrolled, l.guests, l.capacity);
                return (
                  <Link
                    key={l.key}
                    href={`/lessons/${l.classId}/${l.date}`}
                    data-testid="lesson-row"
                    className="flex items-center gap-3 border-b border-divider px-4 py-2.5 text-body hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <span className="w-28 shrink-0 tabular-nums text-ink-secondary">
                      {l.start} – {l.end}
                    </span>
                    <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colourFor(l.colourKey).dot)} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">
                      {l.title}
                      {l.offPattern && <Tag tone="neutral" className="ml-2">extra</Tag>}
                    </span>
                    <span className="w-44 shrink-0 truncate text-ink-secondary">
                      {l.mainCoach.name}
                      {l.mainCoach.isCover && <span className="ml-1 font-semibold text-status-info-text">(Sub)</span>}
                    </span>
                    <span className="w-28 shrink-0 truncate text-ink-muted">{l.location}</span>
                    {/* Full is a fact, not a fault — Warning, never red (Red Means Stuck). */}
                    <span className={cn("w-16 shrink-0 text-right font-semibold tabular-nums text-ink", full && "text-status-warning-text")}>
                      {formatCount(l.enrolled, l.guests, l.capacity)}
                    </span>
                    <span className="w-32 shrink-0 text-center">
                      <Tag tone={p.tone}>{p.text}</Tag>
                    </span>
                    <Arrow className="h-4 w-4 shrink-0 text-ink-muted" />
                  </Link>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}
