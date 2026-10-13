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
import { gridVisibleWhileLoading } from "@/lib/assessment";
import { gradeWrites, type GradingState } from "../domain/useGrading";

export function GradingModal(p: { grading: GradingState; tenantId: string | null }) {
  const g = p.grading;
  return (
    <Modal
      title={g.gradingFor ? `Grade ${g.gradingFor.full_name}` : "Grade skills"}
      open={g.gradingFor !== null}
      onClose={g.closeGrading}
    >
      {g.gradeError ? (
        <div className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
          Could not load this child&apos;s skills: {g.gradeError}. Close and try
          again — an empty list here is a failed query, not an ungraded child.
        </div>
      ) : g.gradingFor &&
        !gridVisibleWhileLoading(g.gradeLoading, g.gradeRoster[0]?.id ?? null, g.gradingFor.id) ? (
        // A reload of THIS child keeps the grid (and its messages) mounted.
        <p className="py-6 text-center text-body text-ink-muted">Loading…</p>
      ) : p.tenantId && g.gradingFor ? (
        // Visible but click-proof while it re-reads (see ClassGridSection).
        <div aria-busy={g.gradeLoading} className={`space-y-3${g.gradeLoading ? " pointer-events-none opacity-60" : ""}`}>
          <p className="text-body text-ink-secondary">
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
            writes={gradeWrites}
          />
        </div>
      ) : null}
    </Modal>
  );
}
