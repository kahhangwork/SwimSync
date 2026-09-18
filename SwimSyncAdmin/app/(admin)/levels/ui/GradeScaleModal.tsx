import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { LevelsState } from "../domain/useLevels";

// ── Grade scale editor ──────────────────────────────────────────────────────
// Hosted on /levels rather than on a new route, deliberately: same audience,
// same data family, and a new page would trip verify-platform-admin-
// scope.mjs's 24-page pin. Minimal by design — rename freely, add a
// grade; a grade a child holds cannot be deleted (the FK refuses, and
// removeGrade surfaces that as a friendly line).
export function GradeScaleModal(p: { l: LevelsState }) {
  return (
    <Modal open={p.l.scaleOpen} onClose={() => p.l.setScaleOpen(false)} title="Grading scale">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          The scale coaches grade each child&rsquo;s skills against, lowest
          first. The <span className="font-medium">top</span> grade counts a
          skill as done. Rename freely; a grade a child has been given
          can&rsquo;t be removed — their records are kept.
        </p>

        {p.l.gradeScale.length === 0 ? (
          <p className="text-sm text-gray-400">No grades yet.</p>
        ) : (
          <ol className="space-y-2">
            {p.l.gradeScale.map((g, i) => (
              <li key={g.id} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-gray-400">{i + 1}.</span>
                {/* Rename on blur or Enter — a curriculum's grade names are
                    edited rarely, so an explicit save button is overkill. */}
                <input
                  defaultValue={g.label}
                  onBlur={(e) => p.l.renameGrade(g, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  disabled={p.l.scaleBusy}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() => p.l.removeGrade(g)}
                  disabled={p.l.scaleBusy}
                  className="px-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                  aria-label="Remove grade"
                >
                  &times;
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex gap-2">
          <input
            value={p.l.newGrade}
            onChange={(e) => p.l.setNewGrade(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.l.addGrade();
            }}
            placeholder="Expert"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <Button onClick={p.l.addGrade} disabled={p.l.scaleBusy || !p.l.newGrade.trim()}>
            Add grade
          </Button>
        </div>

        {p.l.scaleError && <p className="text-sm text-red-600">{p.l.scaleError}</p>}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => p.l.setScaleOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
