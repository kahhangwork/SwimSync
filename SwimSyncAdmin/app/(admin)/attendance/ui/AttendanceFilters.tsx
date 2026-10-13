import { Download } from "lucide-react";
import { Button } from "@/components/Button";
import { STATUS_FILTERS, STATUS_LABELS } from "../constants";

const inputClass =
  "rounded-control border border-border-strong bg-surface px-3 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary";

type Props = {
  search: string;
  coachFilter: string;
  classFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  coaches: { id: string; full_name: string }[];
  classes: { id: string; label: string }[];
  anyFilter: boolean;
  exportDisabled: boolean;
  onSearch: (v: string) => void;
  onCoach: (v: string) => void;
  onClass: (v: string) => void;
  onStatus: (v: string) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onClear: () => void;
  onExport: () => void;
};

export function AttendanceFilters(p: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <input
        type="text"
        placeholder="Search by student..."
        value={p.search}
        onChange={(e) => p.onSearch(e.target.value)}
        className={`${inputClass} w-52 placeholder:text-ink-muted px-4`}
      />
      <select value={p.coachFilter} onChange={(e) => p.onCoach(e.target.value)} className={inputClass}>
        <option value="All">All Coaches</option>
        {p.coaches.map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name}
          </option>
        ))}
      </select>
      <select value={p.classFilter} onChange={(e) => p.onClass(e.target.value)} className={inputClass}>
        <option value="All">All Classes</option>
        {p.classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select value={p.statusFilter} onChange={(e) => p.onStatus(e.target.value)} className={inputClass}>
        {STATUS_FILTERS.map((s) => (
          <option key={s} value={s}>
            {s === "All" ? "All Statuses" : STATUS_LABELS[s] ?? s}
          </option>
        ))}
      </select>

      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        From
        <input
          type="date"
          value={p.dateFrom}
          max={p.dateTo || undefined}
          onChange={(e) => p.onDateFrom(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        To
        <input
          type="date"
          value={p.dateTo}
          min={p.dateFrom || undefined}
          onChange={(e) => p.onDateTo(e.target.value)}
          className={inputClass}
        />
      </label>

      {p.anyFilter && (
        <button
          type="button"
          onClick={p.onClear}
          className="px-3 py-2.5 text-body font-medium text-primary hover:text-primary-hover hover:underline"
        >
          Clear filters
        </button>
      )}

      <div className="ml-auto">
        <Button variant="outline" disabled={p.exportDisabled} onClick={p.onExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
