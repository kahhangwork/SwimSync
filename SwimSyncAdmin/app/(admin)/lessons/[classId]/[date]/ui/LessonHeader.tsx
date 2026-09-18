// Back link + title + cancel/restore — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { colourFor } from "@/lib/classColours";
import { formatSgDate } from "@/lib/lessonDates";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { CancelLessonState } from "../domain/useCancelLesson";
import type { ClassInfo } from "../types";

export function LessonHeader({ date, cls, ld, cx }: { date: string; cls: ClassInfo; ld: LessonDetail; cx: CancelLessonState }) {
  const { cancelled, notALesson, isFuture } = ld;
  const { cancelBusy, doRestoreLesson, setCancelError, setCancelOpen } = cx;
  const backHref = `/calendar?view=day&date=${date}`;
  const colour = colourFor(cls.colour);

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Calendar · {formatSgDate(date, { weekday: "short", day: "numeric", month: "short" })}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("inline-block h-3 w-3 rounded-full", colour.dot)} />
            {cls.title}
          </span>
        }
        subtitle={`${formatSgDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${formatTime(cls.start_time)} – ${formatTime(cls.end_time)} · ${cls.location_name}`}
        action={
          <div className="flex items-center gap-3">
            {/* Cancel is offered only for a FUTURE lesson of a running class —
                the RPC refuses today/past anyway (the coach's cancelled_rain /
                cancelled_coach mark is that path). Restore whenever cancelled;
                its sealed-month refusal is rendered from the RPC. */}
            {cancelled ? (
              <Button size="sm" variant="outline" data-testid="restore-lesson" onClick={doRestoreLesson} disabled={cancelBusy}>
                {cancelBusy ? "Restoring…" : "Restore this lesson"}
              </Button>
            ) : (
              !notALesson && isFuture && cls.is_active && (
                <Button size="sm" variant="outline" data-testid="cancel-lesson" onClick={() => { setCancelError(null); setCancelOpen(true); }}>
                  Cancel this lesson
                </Button>
              )
            )}
            <Link href="/classes" className="text-sm text-sky-700 hover:underline">
              Classes page →
            </Link>
          </div>
        }
      />
    </>
  );
}
