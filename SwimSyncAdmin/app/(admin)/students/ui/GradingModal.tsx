// Slice 6 — grade ONE child's skills. Stage 9 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// The same grid the Assessment tab uses, in compact mode: no paint toolbar,
// because there is no run of children to paint across. Sharing the component
// is deliberate — two implementations of "what does this grade mean" would
// eventually disagree, and only one of them would be the one the assessor
// trusts.

import { Modal } from "@/components/Modal";
import { AssessmentGrid } from "@/components/AssessmentGrid";
import { todayInSg } from "@/lib/lessonDates";
import type { GradingState } from "../domain/useGrading";

export function GradingModal(p: { grading: GradingState; tenantId: string | null }) {
  const g = p.grading;
  return (
    <Modal
      title={g.gradingFor ? `Grade ${g.gradingFor.full_name}` : "Grade skills"}
      open={g.gradingFor !== null}
      onClose={g.closeGrading}
    >
      {g.gradeError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load this child&apos;s skills: {g.gradeError}. Close and try
          again — an empty list here is a failed query, not an ungraded child.
        </div>
      ) : g.gradeLoading ? (
        <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
      ) : p.tenantId && g.gradingFor ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Click a grade to cycle it. Changes save straight away. Grades from
            before today show greyed with the date they were given.
          </p>
          <AssessmentGrid
            tenantId={p.tenantId}
            roster={g.gradeRoster}
            levels={g.gradeLevels}
            scale={g.gradeScale}
            since={todayInSg()}
            compact
            onReload={() => g.openGrading(g.gradingFor!)}
          />
        </div>
      ) : null}
    </Modal>
  );
}
