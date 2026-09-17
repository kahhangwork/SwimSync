import { Download } from "lucide-react";
import { Button } from "@/components/Button";
import { STATUS_FILTERS } from "../constants";
import type { SearchField } from "../types";

export function CreditNotesToolbar({
  searchField,
  setSearchField,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  visibleCount,
  onExport,
}: {
  searchField: SearchField;
  setSearchField: (f: SearchField) => void;
  search: string;
  setSearch: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (f: string) => void;
  visibleCount: number;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {/* Scoped search — the dropdown picks the column the term is pushed into,
          so it reaches every note in the DB, not the first 1000 (⚠ RISK 3). */}
      <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-sky-400">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value as SearchField)}
          className="border-r border-gray-200 bg-gray-50 px-2 py-2.5 text-sm text-gray-600 focus:outline-none"
          aria-label="Search by"
        >
          <option value="student">Student</option>
          <option value="parent">Parent</option>
          <option value="reference">Reference</option>
        </select>
        <input
          type="text"
          placeholder={
            searchField === "parent"
              ? "Search parent name…"
              : searchField === "reference"
              ? "Search reference…"
              : "Search student name…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-52 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              statusFilter === f
                ? "bg-sky-500 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="ml-auto">
        <Button
          variant="outline"
          disabled={visibleCount === 0}
          onClick={onExport}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
