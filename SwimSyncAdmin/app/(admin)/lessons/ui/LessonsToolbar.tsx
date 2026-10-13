import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftAnchor, type DateRange } from "@/lib/calendarLessons";
import { formatSgDate, todayInSg } from "@/lib/lessonDates";
import { cn } from "@/lib/utils";
import type { LessonsMode, SetParams } from "../domain/useLessons";

type Props = {
  mode: LessonsMode;
  anchor: string;
  range: DateRange;
  /** The floor-to-now backlog — the sidebar badge's own count (S8). null = unknown. */
  backlogCount: number | null;
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
  backlogCount,
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
      <div className="flex rounded-control border border-border-strong bg-surface p-0.5 text-body">
        <button type="button" aria-pressed={mode === "week"} onClick={() => setParams({ mode: "week" })} className={cn("rounded-tag px-3 py-1 font-medium", mode === "week" ? "bg-selected text-ink" : "text-ink-secondary hover:bg-ground")}>
          Week
        </button>
        <button type="button" aria-pressed={mode === "needs"} data-testid="needs-marking-toggle" onClick={() => { bumpFloor(); setParams({ mode: "needs" }); }} className={cn("rounded-tag px-3 py-1 font-medium", mode === "needs" ? "bg-selected text-ink" : "text-ink-secondary hover:bg-ground")}>
          Needs marking{mode === "week" && backlogCount ? ` (${backlogCount})` : ""}
        </button>
      </div>
      {mode === "week" && (
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous" onClick={() => setParams({ date: shiftAnchor("week", anchor, -1) })} className="rounded-control border border-border-strong bg-surface p-1.5 text-ink-secondary hover:bg-ground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Next" onClick={() => setParams({ date: shiftAnchor("week", anchor, 1) })} className="rounded-control border border-border-strong bg-surface p-1.5 text-ink-secondary hover:bg-ground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setParams({ date: todayInSg() })} className="ml-1 rounded-control border border-border-strong bg-surface px-3 py-1.5 text-body font-medium text-ink hover:bg-ground">
            Today
          </button>
          <span data-testid="lessons-label" className="ml-2 font-semibold text-ink">
            {formatSgDate(range.from, { day: "numeric", month: "short" })} – {formatSgDate(range.to, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      )}
      {mode === "needs" && (
        <span className="text-body text-ink-secondary">
          From <strong>{formatSgDate(range.from, { day: "numeric", month: "short", year: "numeric" })}</strong> (the marking floor) to today — {lessonsCount} lesson{lessonsCount === 1 ? "" : "s"} not fully marked.
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 text-body">
        <select aria-label="Location" value={location} onChange={(e) => setParams({ location: e.target.value })} className="h-9 rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Coach" value={coach} onChange={(e) => setParams({ coach: e.target.value })} className="h-9 rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary">
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
