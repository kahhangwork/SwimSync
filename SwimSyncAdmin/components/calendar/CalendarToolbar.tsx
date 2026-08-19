"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { CALENDAR_VIEWS, type CalendarView } from "@/lib/calendarLessons";
import { cn } from "@/lib/utils";

const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

type Props = {
  view: CalendarView;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onView: (v: CalendarView) => void;
  locations: readonly string[];
  location: string;
  onLocation: (v: string) => void;
  coaches: readonly { id: string; name: string }[];
  coach: string;
  onCoach: (v: string) => void;
  /** A short status line on the right of the filters (e.g. "12 lessons"). */
  summary?: string;
};

export function CalendarToolbar(p: Props) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous"
            onClick={p.onPrev}
            className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={p.onNext}
            className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={p.onToday}
            className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Today
          </button>
        </div>
        <div data-testid="calendar-label" className="text-base font-semibold text-gray-900">
          {p.label}
        </div>
        <div className="ml-auto flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={p.view === v}
              onClick={() => p.onView(v)}
              className={cn(
                "rounded-md px-3 py-1 font-medium",
                p.view === v ? "bg-sky-500 text-white" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 text-gray-600">
          Location
          <select
            aria-label="Location"
            value={p.location}
            onChange={(e) => p.onLocation(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All locations</option>
            {p.locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-gray-600">
          Coach
          <select
            aria-label="Coach"
            value={p.coach}
            onChange={(e) => p.onCoach(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All coaches</option>
            {p.coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {p.summary && <span className="ml-auto text-xs text-gray-500">{p.summary}</span>}
      </div>
    </div>
  );
}
