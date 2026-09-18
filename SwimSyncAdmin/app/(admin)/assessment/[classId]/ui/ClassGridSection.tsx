import { AssessmentGrid } from "@/components/AssessmentGrid";
import type { AssessClassState } from "../domain/useAssessClass";

export function ClassGridSection(p: { s: AssessClassState }) {
  return (
    <>
      {p.s.error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load this class: {p.s.error}. Reload before assessing — an empty
          grid here is a failed query, not an empty roster.
        </div>
      ) : null}

      {p.s.loading ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Loading…
        </p>
      ) : p.s.info ? (
        <AssessmentGrid
          tenantId={p.s.info.tenant_id}
          roster={p.s.roster}
          levels={p.s.levels}
          scale={p.s.scale}
          since={p.s.since}
          onReload={p.s.load}
          writes={p.s.gradeWrites}
        />
      ) : null}
    </>
  );
}
