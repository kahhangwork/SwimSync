// The Loading and load-error states — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function LessonLoading() {
  return (
    <div>
      <PageHeader title="Lesson" />
      <p className="text-body text-ink-muted">Loading…</p>
    </div>
  );
}

export function LessonLoadError({ loadError }: { loadError: string | null }) {
  return (
    <div>
      <PageHeader title="Lesson" />
      <div className="rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">{loadError ?? "Not found."}</div>
      <Link href="/calendar" className="mt-3 inline-flex items-center gap-1 text-body text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Calendar
      </Link>
    </div>
  );
}
