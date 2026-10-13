"use client";

import { useMemo } from "react";
import type { CalendarLesson } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import { LessonCard } from "./LessonCard";
import { statusGlyph } from "./LessonTooltip";

type Props = {
  days: readonly string[];
  lessons: readonly CalendarLesson[];
  today: string;
  selectedKey: string | null;
  onOpen: (lesson: CalendarLesson) => void;
  onHover: (lesson: CalendarLesson | null, e: React.MouseEvent) => void;
  onPin: (lesson: CalendarLesson, e: React.MouseEvent) => void;
};

/** Seven days as a list: one block per day, every lesson full-width with its first students. */
export function AgendaList({ days, lessons, today, selectedKey, onOpen, onHover, onPin }: Props) {
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarLesson[]>();
    for (const l of lessons) {
      const list = m.get(l.date);
      if (list) list.push(l);
      else m.set(l.date, [l]);
    }
    return m;
  }, [lessons]);

  return (
    <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-card border border-border bg-surface">
      {days.map((date) => {
        const list = byDate.get(date) ?? [];
        return (
          <div key={date} className="flex border-b border-border last:border-b-0">
            <div
              className={cn(
                "w-24 shrink-0 border-r border-border px-3 py-3 text-center",
                date === today && "bg-status-info-bg"
              )}
            >
              <div className={cn("text-2xl font-semibold", date === today ? "text-primary" : "text-ink")}>
                {Number(date.slice(8, 10))}
              </div>
              <div className="text-label text-ink-muted">
                {formatSgDate(date, { weekday: "short", month: "short" })}
              </div>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {list.length === 0 && <div className="px-1 py-2 text-label text-ink-muted">No lessons</div>}
              {list.map((l) => (
                <div key={l.key} className="flex items-stretch gap-2">
                  <LessonCard
                    lesson={l}
                    layout="full"
                    selected={selectedKey === l.key}
                    onOpen={onOpen}
                    onHover={onHover}
                    onPin={onPin}
                    className="w-72 shrink-0"
                  />
                  <ul className="flex flex-1 flex-wrap content-start gap-x-3 gap-y-0.5 py-1 text-label text-ink-secondary">
                    {l.students.map((s) => {
                      const g = statusGlyph(s);
                      return (
                        <li key={s.id} className="flex items-center gap-1">
                          <span className={cn("font-semibold", g.className)} title={g.label}>
                            {g.glyph}
                          </span>
                          {s.name}
                          {s.kind !== "enrolled" && (
                            <span className="rounded bg-status-neutral-bg px-1 text-label uppercase text-ink-muted">
                              {s.kind === "trial" ? "trial" : "make-up"}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
