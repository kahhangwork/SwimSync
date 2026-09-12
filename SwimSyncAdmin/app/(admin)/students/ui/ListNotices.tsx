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
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the students: {p.loadError}. The table below is incomplete
          — do not read it as the full list.
        </div>
      )}

      {!p.loading && !p.loadError && p.capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT} {p.searching ? "matches" : "students"}.{" "}
          {p.searching
            ? "Refine your search to narrow them."
            : "Use the search box to find a specific student."}
        </p>
      )}
    </>
  );
}
