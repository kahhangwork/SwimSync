// Slice 6 — the inline level picker in each table row. Stage 9 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// Inline rather than behind a modal: placing a child on the ladder is a
// glance-and-set action, and an admin doing it for a new intake would
// otherwise open a dialog per child.

import type { StudentRow } from "../types";

export function LevelSelect(p: {
  student: StudentRow;
  levels: { id: string; label: string }[];
  saving: boolean;
  onChange: (levelId: string | null) => void;
}) {
  return (
    <select
      value={p.student.level_id ?? ""}
      onChange={(e) => p.onChange(e.target.value || null)}
      disabled={p.levels.length === 0 || p.saving}
      className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
    >
      <option value="">{p.levels.length === 0 ? "No levels defined" : "—"}</option>
      {p.levels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
