"use client";

import { useMemo } from "react";
import { monthGridDates, type CalendarLesson } from "@/lib/calendarLessons";
import { cn } from "@/lib/utils";
import { LessonCard } from "./LessonCard";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

type Props = {
  anchor: string;
  lessons: readonly CalendarLesson[];
  today: string;
  selectedKey: string | null;
  onOpen: (lesson: CalendarLesson) => void;
  onHover: (lesson: CalendarLesson | null, e: React.MouseEvent) => void;
  onPin: (lesson: CalendarLesson, e: React.MouseEvent) => void;
  /** "+N more" and the day number both jump to that day's day view. */
  onDayOpen: (date: string) => void;
};

export function MonthGrid({ anchor, lessons, today, selectedKey, onOpen, onHover, onPin, onDayOpen }: Props) {
  const dates = useMemo(() => monthGridDates(anchor), [anchor]);
  const month = anchor.slice(0, 7);
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
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-[840px]">
        <div className="grid grid-cols-7 border-b border-gray-200 text-xs font-semibold text-gray-500">
          {DOW.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {dates.map((date) => {
            const inMonth = date.slice(0, 7) === month;
            const list = byDate.get(date) ?? [];
            const extra = list.length - MAX_CHIPS;
            return (
              <div
                key={date}
                data-testid="month-cell"
                data-date={date}
                className={cn(
                  "min-h-[104px] border-b border-r border-gray-100 p-1",
                  !inMonth && "bg-gray-50 text-gray-400"
                )}
              >
                <button
                  type="button"
                  onClick={() => onDayOpen(date)}
                  className={cn(
                    "mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold hover:bg-gray-100",
                    date === today && "bg-sky-600 text-white hover:bg-sky-700"
                  )}
                  title="Open this day"
                >
                  {Number(date.slice(8, 10))}
                </button>
                <div className="space-y-0.5">
                  {list.slice(0, MAX_CHIPS).map((l) => (
                    <LessonCard
                      key={l.key}
                      lesson={l}
                      layout="compact"
                      selected={selectedKey === l.key}
                      onOpen={onOpen}
                      onHover={onHover}
                      onPin={onPin}
                    />
                  ))}
                  {extra > 0 && (
                    <button
                      type="button"
                      onClick={() => onDayOpen(date)}
                      className="px-1 text-[11px] font-medium text-sky-700 hover:underline"
                    >
                      +{extra} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
