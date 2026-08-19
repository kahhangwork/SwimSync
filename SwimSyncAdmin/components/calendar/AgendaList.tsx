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
    <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-xl border border-gray-200 bg-white">
      {days.map((date) => {
        const list = byDate.get(date) ?? [];
        return (
          <div key={date} className="flex border-b border-gray-100 last:border-b-0">
            <div
              className={cn(
                "w-24 shrink-0 border-r border-gray-100 px-3 py-3 text-center",
                date === today && "bg-sky-50"
              )}
            >
              <div className={cn("text-2xl font-semibold", date === today ? "text-sky-700" : "text-gray-800")}>
                {Number(date.slice(8, 10))}
              </div>
              <div className="text-xs text-gray-500">
                {formatSgDate(date, { weekday: "short", month: "short" })}
              </div>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {list.length === 0 && <div className="px-1 py-2 text-xs text-gray-400">No lessons</div>}
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
                  <ul className="flex flex-1 flex-wrap content-start gap-x-3 gap-y-0.5 py-1 text-xs text-gray-700">
                    {l.students.map((s) => {
                      const g = statusGlyph(s);
                      return (
                        <li key={s.id} className="flex items-center gap-1">
                          <span className={cn("font-bold", g.className)} title={g.label}>
                            {g.glyph}
                          </span>
                          {s.name}
                          {s.kind !== "enrolled" && (
                            <span className="rounded bg-gray-100 px-1 text-[10px] uppercase text-gray-500">
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
