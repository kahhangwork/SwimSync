import { AssessmentGrid } from "@/components/AssessmentGrid";
import { gridVisibleWhileLoading } from "@/lib/assessment";
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

      {/* A RELOAD of this class keeps the grid mounted, so its "moved up to …"
          and "could not save … reloaded" messages survive the re-read. Only a
          first load (or another class's) shows Loading. */}
      {!gridVisibleWhileLoading(p.s.loading, p.s.loadedFor, p.s.classId) ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Loading…
        </p>
      ) : p.s.info ? (
        // While it re-reads, the grid stays visible but takes no clicks: a
        // click landing mid-reload would be re-seeded away by the new roster.
        <div aria-busy={p.s.loading} className={p.s.loading ? "pointer-events-none opacity-60" : undefined}>
          <AssessmentGrid
            tenantId={p.s.info.tenant_id}
            roster={p.s.roster}
            levels={p.s.levels}
            scale={p.s.scale}
            since={p.s.since}
            onReload={p.s.load}
            writes={p.s.gradeWrites}
          />
        </div>
      ) : null}
    </>
  );
}
