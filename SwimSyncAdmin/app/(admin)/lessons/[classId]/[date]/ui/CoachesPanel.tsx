// Teaching coach, shadows, and the per-lesson substitute — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { SubstituteState } from "../domain/useSubstitute";

export function CoachesPanel({ ld, sub }: { ld: LessonDetail; sub: SubstituteState }) {
  const { mainName, attr, coaches } = ld;
  const { coachPick, setCoachPick, coachBusy, coachMsg, classCoachName, substituteOptions, assignCoach, removeCover } = sub;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="mb-2 font-semibold text-ink">Coaches</h2>
      <p className="text-body">
        Teaching: <span className="font-medium">{mainName}</span>
        {attr?.isCover && <span className="ml-1 font-semibold text-status-danger-text">(Sub)</span>}
      </p>
      {attr && attr.shadowIds.length > 0 && (
        <p className="mt-1 text-label text-ink-muted">
          Shadow: {attr.shadowIds.map((id) => coaches.find((c) => c.id === id)?.name ?? "Unknown").join(", ")} (read-only; managed on the Classes page)
        </p>
      )}
      <div className="mt-3">
        <p className="text-label font-medium text-ink-secondary">Assign a substitute for this lesson</p>
        <p className="mt-0.5 text-label text-ink-muted">
          Covers this one lesson only — it does not change {classCoachName}, the class&apos;s regular coach.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <select aria-label="Substitute coach" className="flex-1 rounded-control border border-border-strong bg-surface px-2 py-1.5 text-body" value={coachPick} onChange={(e) => setCoachPick(e.target.value)} disabled={coachBusy}>
            <option value="">Choose a substitute…</option>
            {substituteOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={assignCoach} disabled={!coachPick || coachBusy}>
            Assign
          </Button>
        </div>
      </div>
      {attr?.subRowId && (
        <Button variant="outline" size="sm" onClick={removeCover} disabled={coachBusy} className="mt-3">
          Remove substitute (back to {classCoachName})
        </Button>
      )}
      {coachMsg && <p className="mt-2 text-label text-status-danger-text">{coachMsg}</p>}
    </section>
  );
}
