import Link from "next/link";
import { ChevronRight as Arrow } from "lucide-react";
import { colourFor } from "@/lib/classColours";
import { formatCount, isFull, type CalendarLesson } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import type { LessonsMode } from "../domain/useLessons";
import { PROGRESS_LABEL } from "../constants";

type Props = {
  days: string[];
  byDate: Map<string, CalendarLesson[]>;
  mode: LessonsMode;
  today: string;
};

export function LessonsList({ days, byDate, mode, today }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {days
        .filter((d) => mode === "week" || (byDate.get(d) ?? []).length > 0)
        .map((d) => {
          const list = byDate.get(d) ?? [];
          return (
            <div key={d}>
              <div className={cn("border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700", d === today && "text-sky-700")}>
                {formatSgDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {d === today && " · Today"}
              </div>
              {list.length === 0 && <div className="px-4 py-2 text-xs text-gray-400">No lessons</div>}
              {list.map((l) => {
                const p = PROGRESS_LABEL[l.progress];
                const full = isFull(l.enrolled, l.guests, l.capacity);
                return (
                  <Link
                    key={l.key}
                    href={`/lessons/${l.classId}/${l.date}`}
                    data-testid="lesson-row"
                    className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-sm hover:bg-sky-50"
                  >
                    <span className="w-28 shrink-0 tabular-nums text-gray-600">
                      {l.start} – {l.end}
                    </span>
                    <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colourFor(l.colourKey).dot)} />
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                      {l.title}
                      {l.offPattern && <span className="ml-2 rounded bg-gray-100 px-1 text-[10px] text-gray-600">extra</span>}
                    </span>
                    <span className="w-44 shrink-0 truncate text-gray-700">
                      {l.mainCoach.name}
                      {l.mainCoach.isCover && <span className="ml-1 font-semibold text-red-600">(Sub)</span>}
                    </span>
                    <span className="w-28 shrink-0 truncate text-gray-500">{l.location}</span>
                    <span className={cn("w-16 shrink-0 text-right font-semibold tabular-nums", full && "text-red-600")}>
                      {formatCount(l.enrolled, l.guests, l.capacity)}
                    </span>
                    <span className={cn("w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium", p.cls)}>{p.text}</span>
                    <Arrow className="h-4 w-4 shrink-0 text-gray-400" />
                  </Link>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}
