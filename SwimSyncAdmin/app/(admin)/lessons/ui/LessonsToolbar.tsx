import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftAnchor, type DateRange } from "@/lib/calendarLessons";
import { formatSgDate, todayInSg } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import type { LessonsMode, SetParams } from "../domain/useLessons";

type Props = {
  mode: LessonsMode;
  anchor: string;
  range: DateRange;
  needsCount: number;
  location: string;
  coach: string;
  locations: string[];
  coachOptions: { id: string; name: string }[];
  lessonsCount: number;
  setParams: SetParams;
  bumpFloor: () => void;
};

export function LessonsToolbar({
  mode,
  anchor,
  range,
  needsCount,
  location,
  coach,
  locations,
  coachOptions,
  lessonsCount,
  setParams,
  bumpFloor,
}: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        <button type="button" aria-pressed={mode === "week"} onClick={() => setParams({ mode: "week" })} className={cn("rounded-md px-3 py-1 font-medium", mode === "week" ? "bg-sky-500 text-white" : "text-gray-600 hover:bg-gray-100")}>
          Week
        </button>
        <button type="button" aria-pressed={mode === "needs"} data-testid="needs-marking-toggle" onClick={() => { bumpFloor(); setParams({ mode: "needs" }); }} className={cn("rounded-md px-3 py-1 font-medium", mode === "needs" ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-100")}>
          Needs marking{mode === "week" && needsCount > 0 ? ` (${needsCount})` : ""}
        </button>
      </div>
      {mode === "week" && (
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous" onClick={() => setParams({ date: shiftAnchor("week", anchor, -1) })} className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Next" onClick={() => setParams({ date: shiftAnchor("week", anchor, 1) })} className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setParams({ date: todayInSg() })} className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Today
          </button>
          <span data-testid="lessons-label" className="ml-2 font-semibold text-gray-900">
            {formatSgDate(range.from, { day: "numeric", month: "short" })} – {formatSgDate(range.to, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      )}
      {mode === "needs" && (
        <span className="text-sm text-gray-600">
          From <strong>{formatSgDate(range.from, { day: "numeric", month: "short", year: "numeric" })}</strong> (the marking floor) to today — {lessonsCount} lesson{lessonsCount === 1 ? "" : "s"} not fully marked.
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 text-sm">
        <select aria-label="Location" value={location} onChange={(e) => setParams({ location: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Coach" value={coach} onChange={(e) => setParams({ coach: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
          <option value="">All coaches</option>
          {coachOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
