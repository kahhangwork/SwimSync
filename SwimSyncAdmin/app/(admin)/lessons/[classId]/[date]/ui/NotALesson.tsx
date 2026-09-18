// The off-weekday refusal — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { dayOfWeekOf, formatSgDate } from "@/lib/lessonDates";
import { capitalise } from "../domain/lessonMarking";
import type { ClassInfo } from "../types";

export function NotALesson({ date, cls }: { date: string; cls: ClassInfo }) {
  return (
    <div data-testid="not-a-lesson" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">This class doesn&apos;t run on {capitalise(dayOfWeekOf(date) ?? "that day")}.</p>
      <p className="mt-1">
        {cls.title} runs on {capitalise(cls.day_of_week)}s and there is no lesson scheduled on {formatSgDate(date)}. If the lesson genuinely moved, schedule it as an extra lesson from the Classes page first.
      </p>
    </div>
  );
}
