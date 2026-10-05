// Prev/next lesson (same coach, same date) and prev/next coach — the admin
// lesson page (lessons/[classId]/[date]). State lives in domain/useLessonNav.
//
// ⚠ BUTTONS, NEVER <Link>. A Link navigates on its own and would skip `go`,
// which is the only thing standing between unsaved marks (or a running save)
// and a navigation that silently drops them (plan RISK 2).

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/Button";
import type { LessonNavState } from "../domain/useLessonNav";

// The strip's own height, reserved while it loads so the attendance panel does
// not jump under the admin's cursor when it arrives (plan RISK 7).
const STRIP_HEIGHT = "min-h-[4.5rem]";

export function LessonNavStrip({ nav: n }: { nav: LessonNavState }) {
  const { status, nav, busy, go } = n;

  if (status === "loading") return <div aria-hidden className={`mb-4 ${STRIP_HEIGHT}`} />;
  if (status === "unavailable") {
    return (
      <p data-testid="lesson-nav-unavailable" className="mb-4 text-xs text-gray-400">
        Lesson navigation unavailable
      </p>
    );
  }
  if (status !== "ready" || !nav) return null;

  return (
    <div data-testid="lesson-nav" className={`mb-4 flex flex-col gap-2 ${STRIP_HEIGHT}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="nav-prev-lesson"
          aria-label="Previous lesson for this coach"
          disabled={busy || !nav.lesson.prevHref}
          onClick={() => go(nav.lesson.prevHref)}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev lesson
        </Button>
        <span data-testid="nav-lesson-counter" className="min-w-[7rem] text-center text-sm text-gray-600">
          Lesson {nav.lesson.position} of {nav.lesson.total}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="nav-next-lesson"
          aria-label="Next lesson for this coach"
          disabled={busy || !nav.lesson.nextHref}
          onClick={() => go(nav.lesson.nextHref)}
        >
          Next lesson <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="nav-prev-coach"
          aria-label="Previous coach's first lesson"
          disabled={busy || !nav.coach.prevHref}
          onClick={() => go(nav.coach.prevHref)}
        >
          <ChevronsLeft className="h-3.5 w-3.5" /> Prev coach
        </Button>
        <span data-testid="nav-coach-counter" className="min-w-[7rem] text-center text-sm font-medium text-gray-800">
          {nav.coach.name} ({nav.coach.position} of {nav.coach.total})
        </span>
        <Button
          size="sm"
          variant="ghost"
          data-testid="nav-next-coach"
          aria-label="Next coach's first lesson"
          disabled={busy || !nav.coach.nextHref}
          onClick={() => go(nav.coach.nextHref)}
        >
          Next coach <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
