"use client";

import { useEffect, useMemo, useRef } from "react";
import { layoutLanes, timeAxis, type CalendarLesson } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import { LessonCard } from "./LessonCard";

export const ROW_PX = 44; // one 30-minute row
export const GUTTER_PX = 64; // the sticky time column

type Props = {
  /** The day columns, ascending. One for the day view, seven for the week. */
  days: readonly string[];
  lessons: readonly CalendarLesson[];
  today: string;
  /** Minimum width of ONE lane — 220 in the day view, 150 in the week view. */
  laneMinPx: number;
  /** Minimum width of a day column even when empty. */
  dayMinPx: number;
  selectedKey: string | null;
  onOpen: (lesson: CalendarLesson) => void;
  onHover: (lesson: CalendarLesson | null, e: React.MouseEvent) => void;
  onPin: (lesson: CalendarLesson, e: React.MouseEvent) => void;
  onDayClick?: (date: string) => void;
};

function fmtAxis(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * The day / week grid. The scroll container scrolls BOTH ways; the time gutter
 * is `sticky left-0` and the day header `sticky top-0`, so many concurrent
 * lessons scroll sideways without the times leaving the screen.
 */
export function TimeGrid({
  days,
  lessons,
  today,
  laneMinPx,
  dayMinPx,
  selectedKey,
  onOpen,
  onHover,
  onPin,
  onDayClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const axis = useMemo(() => timeAxis(lessons), [lessons]);
  const rows = (axis.endMin - axis.startMin) / 30;
  const gridHeight = rows * ROW_PX;

  const columns = useMemo(() => {
    return days.map((date) => {
      const dayLessons = lessons.filter((l) => l.date === date);
      const lanes = layoutLanes(dayLessons);
      let maxLanes = 1;
      for (const p of lanes.values()) maxLanes = Math.max(maxLanes, p.lanes);
      const width = Math.max(dayMinPx, maxLanes * laneMinPx);
      return { date, dayLessons, lanes, width };
    });
  }, [days, lessons, laneMinPx, dayMinPx]);

  const totalWidth = GUTTER_PX + columns.reduce((s, c) => s + c.width, 0);

  // Land on 08:00 (or the axis start if later) on first paint of a range.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const eight = Math.max(0, (8 * 60 - axis.startMin) / 30) * ROW_PX;
    el.scrollTop = eight;
  }, [axis.startMin, days[0]]);

  return (
    <div
      ref={scrollRef}
      data-testid="time-grid-scroll"
      className="relative max-h-[calc(100vh-240px)] overflow-auto rounded-xl border border-gray-200 bg-white"
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        {/* Header row */}
        <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-white">
          <div
            data-testid="time-gutter-corner"
            className="sticky left-0 z-30 shrink-0 border-r border-gray-200 bg-white"
            style={{ width: GUTTER_PX }}
          />
          {columns.map((c) => {
            const isToday = c.date === today;
            return (
              <div
                key={c.date}
                className={cn(
                  "shrink-0 border-r border-gray-100 px-2 py-2 text-xs",
                  isToday && "bg-sky-50"
                )}
                style={{ width: c.width }}
              >
                <button
                  type="button"
                  onClick={() => onDayClick?.(c.date)}
                  className={cn(
                    "font-semibold hover:underline",
                    isToday ? "text-sky-700" : "text-gray-700"
                  )}
                >
                  {formatSgDate(c.date, { weekday: "short", day: "numeric", month: "short" })}
                </button>
                <span className="ml-2 text-gray-400">
                  {c.dayLessons.length} lesson{c.dayLessons.length === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex" style={{ height: gridHeight }}>
          {/* Time gutter */}
          <div
            data-testid="time-gutter"
            className="sticky left-0 z-10 shrink-0 border-r border-gray-200 bg-white"
            style={{ width: GUTTER_PX }}
          >
            {Array.from({ length: rows }, (_, i) => {
              const min = axis.startMin + i * 30;
              const hour = min % 60 === 0;
              return (
                <div
                  key={min}
                  className={cn(
                    "pr-2 text-right text-[11px] leading-none",
                    hour ? "font-semibold text-gray-700" : "text-gray-400"
                  )}
                  style={{ height: ROW_PX, paddingTop: 2 }}
                >
                  {fmtAxis(min)}
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {columns.map((c) => (
            <div
              key={c.date}
              data-testid="day-column"
              data-date={c.date}
              className={cn("relative shrink-0 border-r border-gray-100", c.date === today && "bg-sky-50/40")}
              style={{ width: c.width }}
            >
              {/* Row lines */}
              {Array.from({ length: rows }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    "absolute left-0 right-0 border-t",
                    (axis.startMin + i * 30) % 60 === 0 ? "border-gray-200" : "border-gray-100"
                  )}
                  style={{ top: i * ROW_PX }}
                />
              ))}
              {/* Cards */}
              {c.dayLessons.map((l) => {
                const p = c.lanes.get(l.key) ?? { lane: 0, lanes: 1 };
                const laneWidth = c.width / p.lanes;
                const top = ((l.startMin - axis.startMin) / 30) * ROW_PX;
                const height = Math.max(ROW_PX * 0.9, ((l.endMin - l.startMin) / 30) * ROW_PX - 2);
                return (
                  <LessonCard
                    key={l.key}
                    lesson={l}
                    selected={selectedKey === l.key}
                    onOpen={onOpen}
                    onHover={onHover}
                    onPin={onPin}
                    className="absolute"
                    style={{
                      top,
                      height,
                      left: p.lane * laneWidth + 2,
                      width: laneWidth - 4,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
