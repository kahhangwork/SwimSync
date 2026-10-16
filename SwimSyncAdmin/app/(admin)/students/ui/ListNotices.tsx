// Slice 1 — the notices above the table: a failed load, the 1000-row cap, and
// the confirmation after Set inactive (the child leaves the Active list).
// Stage 4 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup lifted
// verbatim from page.tsx.

import { ROW_LIMIT } from "../constants";

export function ListNotices(p: {
  loading: boolean;
  loadError: string | null;
  capped: boolean;
  searching: boolean;
  flash: string | null;
  onDismissFlash: () => void;
}) {
  return (
    <>
      {p.flash && (
        // role="status": announced, and how a driver finds it. The banner shape
        // is AssessmentGrid's — the admin has no toast.
        <div
          role="status"
          className="mb-3 flex items-center justify-between rounded-card border border-status-success-border bg-status-success-bg px-4 py-3 text-body text-status-success-text"
        >
          <span>{p.flash}</span>
          <button onClick={p.onDismissFlash} className="text-label font-semibold">
            Dismiss
          </button>
        </div>
      )}

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
