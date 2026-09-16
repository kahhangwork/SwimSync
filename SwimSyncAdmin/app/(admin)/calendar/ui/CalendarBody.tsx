import { CalendarToolbar } from "@/components/calendar/CalendarToolbar";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { AgendaList } from "@/components/calendar/AgendaList";
import { LessonTooltip } from "@/components/calendar/LessonTooltip";
import { shiftAnchor } from "@/lib/calendarLessons";
import { todayInSg } from "@/lib/lessonDates";
import type { CalendarState } from "../domain/useCalendar";

// Presentation for the admin Calendar: toolbar, the view grids, the pinned/hover
// tooltip and the legend. All data + handlers come from useCalendar; the grids
// are the shared @/components/calendar primitives.
export function CalendarBody(c: CalendarState) {
  const { view, anchor, location, coach, setParams } = c;

  return (
    <>
      <CalendarToolbar
        view={view}
        label={c.label}
        onPrev={() => setParams({ date: shiftAnchor(view, anchor, -1) })}
        onNext={() => setParams({ date: shiftAnchor(view, anchor, 1) })}
        onToday={() => setParams({ date: todayInSg() })}
        onView={(v) => setParams({ view: v })}
        locations={c.locations}
        location={location}
        onLocation={(v) => setParams({ location: v })}
        coaches={c.data?.coachOptions ?? []}
        coach={coach}
        onCoach={(v) => setParams({ coach: v })}
        summary={c.summary}
      />

      {c.error && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>Could not load the calendar: {c.error}</span>
          <button type="button" className="font-medium underline" onClick={c.reload}>
            Retry
          </button>
        </div>
      )}

      {!c.loading && !c.error && c.data && c.data.classes.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No classes yet — create one on the Classes page and it will appear here on its weekday.
        </div>
      )}

      {!c.loading && !c.error && c.data && c.data.classes.length > 0 && c.lessons.length === 0 && c.allLessons.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No lessons {location ? `at ${location}` : ""} {coach ? "for that coach" : ""} in this {view === "month" ? "month" : view === "day" ? "day" : "week"}.
          {" "}
          <button type="button" className="font-medium underline" onClick={() => setParams({ location: "", coach: "" })}>
            Clear filters
          </button>
        </div>
      )}

      {(view === "day" || view === "week") && (
        <TimeGrid
          days={c.days}
          lessons={c.lessons}
          today={c.today}
          laneMinPx={view === "day" ? 220 : 150}
          dayMinPx={view === "day" ? 320 : 150}
          selectedKey={c.pinned?.lesson.key ?? null}
          onOpen={c.onOpen}
          onHover={c.onHover}
          onPin={c.onPin}
          onDayClick={(date) => setParams({ view: "day", date })}
        />
      )}
      {view === "month" && (
        <MonthGrid
          anchor={anchor}
          lessons={c.lessons}
          today={c.today}
          selectedKey={c.pinned?.lesson.key ?? null}
          onOpen={c.onOpen}
          onHover={c.onHover}
          onPin={c.onPin}
          onDayOpen={(date) => setParams({ view: "day", date })}
        />
      )}
      {view === "agenda" && (
        <AgendaList
          days={c.days}
          lessons={c.lessons}
          today={c.today}
          selectedKey={c.pinned?.lesson.key ?? null}
          onOpen={c.onOpen}
          onHover={c.onHover}
          onPin={c.onPin}
        />
      )}

      {c.tooltip && (
        <LessonTooltip
          lesson={c.tooltip.lesson}
          x={c.tooltip.x}
          y={c.tooltip.y}
          pinned={c.pinned !== null}
          onClose={c.clearPin}
        />
      )}

      <p className="mt-2 text-xs text-gray-400">
        Legend: <span className="font-semibold">4+1/6</span> = enrolled + guests / max ·{" "}
        <span className="text-red-600 font-semibold">(Sub)</span> = substitute coach · dashed border = attendance not
        fully marked · <span className="text-emerald-700">✓</span> = fully marked · faded = public-holiday void.
      </p>
    </>
  );
}
