import { ENTITY_TYPES } from "../constants";

type Props = {
  entityFilter: string;
  setEntityFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  anyFilter: boolean;
  clearFilters: () => void;
};

const inputClass =
  "rounded-control border border-border-strong bg-surface px-3 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary";

export function HistoryFilters({
  entityFilter,
  setEntityFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  anyFilter,
  clearFilters,
}: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        Type
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">All types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        From
        <input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        To
        <input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
          className={inputClass}
        />
      </label>
      {anyFilter && (
        <button
          type="button"
          onClick={clearFilters}
          className="px-3 py-2.5 text-body font-medium text-primary hover:text-primary-hover hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
