// Roles page — the 8 areas × None / View / Edit grid. Read-only unless `onChange`.

import { useId } from "react";

import { ADMIN_AREAS, ADMIN_LEVELS, AREA_HINTS, AREA_LABELS, gridProblem, type AdminLevel, type Grid } from "@/lib/permissions";

const LEVEL_LABEL: Record<AdminLevel, string> = { none: "None", view: "View", edit: "Edit" };

export function RoleGrid({ grid, onChange }: { grid: Grid; onChange?: (g: Grid) => void }) {
  const problem = onChange ? gridProblem(grid) : null;
  // Radio groups are PAGE-wide by name: every card and the editor share one
  // page, so without a per-grid id they would form a single group and editing
  // one grid would silently uncheck the others (caught by verify-roles).
  const gridId = useId();
  return (
    <div>
      <table className="w-full text-body">
        <thead>
          <tr className="text-left text-label uppercase tracking-wide text-ink-muted">
            <th className="py-2 font-medium">Area</th>
            {ADMIN_LEVELS.map((l) => (
              <th key={l} className="w-16 py-2 text-center font-medium">{LEVEL_LABEL[l]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ADMIN_AREAS.map((area) => (
            <tr key={area} className="border-t border-border">
              <td className="py-2 pr-3">
                <div className="font-medium text-ink">{AREA_LABELS[area]}</div>
                <div className="text-label text-ink-muted">{AREA_HINTS[area]}</div>
              </td>
              {ADMIN_LEVELS.map((level) => (
                <td key={level} className="text-center">
                  <input
                    type="radio"
                    name={`${gridId}-area-${area}`}
                    aria-label={`${AREA_LABELS[area]}: ${LEVEL_LABEL[level]}`}
                    checked={grid[area] === level}
                    disabled={!onChange}
                    onChange={() => onChange?.({ ...grid, [area]: level })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {problem && <p className="mt-2 text-body text-status-warning-text">{problem}</p>}
    </div>
  );
}
