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
        <div className="mb-3 flex items-center justify-between rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
          <span>Could not load the calendar: {c.error}</span>
          <button type="button" className="font-medium underline" onClick={c.reload}>
            Retry
          </button>
        </div>
      )}

      {!c.loading && !c.error && c.data && c.data.classes.length === 0 && (
        <div className="rounded-card border border-dashed border-border-strong bg-surface p-8 text-center text-body text-ink-muted">
          No classes yet — create one on the Classes page and it will appear here on its weekday.
        </div>
      )}

      {!c.loading && !c.error && c.data && c.data.classes.length > 0 && c.lessons.length === 0 && c.allLessons.length > 0 && (
        <div className="mb-3 rounded-card bg-status-warning-bg px-3 py-2 text-body text-status-warning-text">
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
          // Week lanes 128px (were 150): seven days fit a 1440px screen beside
          // the sidebar unless a day double-books (BACKLOG: Week hid Sunday).
          laneMinPx={view === "day" ? 220 : 128}
          dayMinPx={view === "day" ? 320 : 128}
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

      <p className="mt-2 text-label font-normal text-ink-muted">
        Legend: <span className="font-semibold">4+1/6</span> = enrolled + guests / max (no max when the class has no
        limit) · <span className="font-semibold">(Sub)</span> = substitute coach · dashed border = attendance not
        fully marked · <span className="font-semibold">✓</span> = fully marked · faded = public-holiday void.
      </p>
    </>
  );
}
