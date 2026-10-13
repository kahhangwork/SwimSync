// Slice 1 — the two notices above the table: a failed load, and the 1000-row
// cap. Stage 4 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup lifted
// verbatim from page.tsx.

import { ROW_LIMIT } from "../constants";

export function ListNotices(p: {
  loading: boolean;
  loadError: string | null;
  capped: boolean;
  searching: boolean;
}) {
  return (
    <>
      {p.loadError && (
        <div className="mb-3 rounded-card border border-status-danger-border bg-status-danger-bg px-4 py-3 text-body text-status-danger-text">
          Could not load the students: {p.loadError}. The table below is incomplete
          — do not read it as the full list.
        </div>
      )}

      {!p.loading && !p.loadError && p.capped && (
        <p className="mb-3 text-body text-status-warning-text">
          Showing the first {ROW_LIMIT} {p.searching ? "matches" : "students"}.{" "}
          {p.searching
            ? "Refine your search to narrow them."
            : "Use the search box to find a specific student."}
        </p>
      )}
    </>
  );
}
