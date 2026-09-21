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
  "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

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
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
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
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
        From
        <input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
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
          className="px-3 py-2.5 text-sm font-medium text-sky-600 hover:text-sky-700 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
