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
  // No ladder yet: one muted dash, not a greyed dropdown on every row (BACKLOG
  // fold-in; UI restyle 5.9). The title says where levels are made.
  if (p.levels.length === 0) {
    return (
      <span className="text-ink-muted" title="No levels defined — add them on the Levels page">
        —
      </span>
    );
  }
  return (
    <select
      value={p.student.level_id ?? ""}
      onChange={(e) => p.onChange(e.target.value || null)}
      disabled={p.levels.length === 0 || p.saving}
      className="h-[1.875rem] rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary disabled:bg-status-neutral-bg disabled:text-ink-muted"
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
