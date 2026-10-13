// Slice 1 — the search box, status pills, and the two toggles. Stage 4 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup lifted verbatim from
// page.tsx; every value and handler arrives as a prop.
//
// The "running low" thresholds are TENANT PACKAGE SETTINGS, edited on the
// Packages page since 2026-09-24. They are shown here READ-ONLY beside the
// filter, because the filter means nothing without them.

import Link from "next/link";
import { STATUS_FILTERS } from "../constants";
import type { SearchField } from "../types";

export type StudentToolbarProps = {
  search: string;
  onSearch: (v: string) => void;
  searchField: SearchField;
  onSearchField: (v: SearchField) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  unclaimedCount: number;
  unclaimedOnly: boolean;
  onToggleUnclaimed: () => void;
  lowOnly: boolean;
  onToggleLow: () => void;
  threshold: string;
  expiryDays: string;
};

export function StudentToolbar(p: StudentToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Scoped search: the dropdown picks the ONE column the term is pushed
          into, so it reaches the whole table in the DB instead of filtering
          the first 1000 rows in the browser (⚠ RISK 3). */}
      <div className="flex overflow-hidden rounded-control border border-border bg-surface focus-within:ring-2 focus-within:ring-primary">
        <select
          value={p.searchField}
          onChange={(e) => p.onSearchField(e.target.value as SearchField)}
          className="border-r border-border-strong bg-ground px-2 py-2.5 text-body text-ink-secondary focus:outline-none"
          aria-label="Search by"
        >
          <option value="student">Student</option>
          <option value="parent">Parent</option>
        </select>
        <input
          type="text"
          placeholder={p.searchField === "parent" ? "Search parent name…" : "Search student name…"}
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          className="w-56 px-4 py-2.5 text-body placeholder:text-ink-muted focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => p.onStatusFilter(f)}
            className={`rounded-control px-3 py-2 text-label font-semibold transition-colors ${
              p.statusFilter === f
                ? "bg-selected text-ink border border-border-strong"
                : "bg-surface border border-border text-ink-secondary hover:bg-ground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* Only offered when there ARE any: a permanently-visible filter that
            always returns nothing reads as a broken feature. */}
        {p.unclaimedCount > 0 && (
          <button
            onClick={p.onToggleUnclaimed}
            className={`rounded-control px-3 py-2 text-label font-semibold transition-colors ${
              p.unclaimedOnly
                ? "bg-selected text-ink border border-border-strong"
                : "bg-surface border border-border text-ink-secondary hover:bg-ground"
            }`}
            title="Children a coach added before the family registered. Their billable lessons cannot be invoiced, and they hold the billing month open until the parent is invited or the money is recorded as settled."
          >
            No parent account ({p.unclaimedCount})
          </button>
        )}
        <button
          onClick={p.onToggleLow}
          className={`rounded-control px-3 py-2 text-label font-semibold transition-colors ${
            p.lowOnly
              ? "bg-selected text-ink border border-border-strong"
              : "bg-surface border border-border text-ink-secondary hover:bg-ground"
          }`}
          title="Families whose prepaid package is nearly used up — time to remind them to renew. Counts lessons attended but not yet invoiced."
        >
          Package running low
        </button>
        {p.lowOnly && (
          <span className="text-label text-ink-secondary">
            at {p.threshold} lessons or fewer, or expiring within {p.expiryDays} days ·{" "}
            <Link href="/packages" className="font-semibold text-primary hover:underline">
              Change on Packages
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}
