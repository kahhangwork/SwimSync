import { ROW_LIMIT } from "../constants";

type LocationOption = { id: string; name: string };

/**
 * The list toolbar: search, the location filter (shown only at >1 location),
 * the show-retired toggle, and the two standing banners — the top-level restore
 * error and the cap notice.
 *
 * ⚠ RISK 9 — the top-level retire banner is guarded `retireError && retireFor
 * === null` VERBATIM: it carries a RESTORE failure (reactivate_class cannot
 * refuse, so this is a network/permission error) and must never show at the
 * same time as a RETIRE refusal, which renders inside the retire modal.
 */
export function ClassToolbar({
  search,
  onSearch,
  locationOptions,
  locationFilter,
  onLocationFilter,
  showRetired,
  onShowRetired,
  retiredCount,
  loading,
  capped,
  retireError,
  retireFor,
}: {
  search: string;
  onSearch: (v: string) => void;
  locationOptions: LocationOption[];
  locationFilter: string;
  onLocationFilter: (v: string) => void;
  showRetired: boolean;
  onShowRetired: (v: boolean) => void;
  retiredCount: number;
  loading: boolean;
  capped: boolean;
  retireError: string | null;
  retireFor: unknown | null;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <input
          type="text"
          placeholder="Search by class name or coach..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        {locationOptions.length > 1 && (
          <select
            aria-label="Location"
            value={locationFilter}
            onChange={(e) => onLocationFilter(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <option value="">All locations</option>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {/* Always offered, even at zero, so the answer to "where did that class
            go?" is on the page rather than in someone's memory. */}
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => onShowRetired(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
          />
          Show retired classes
          {retiredCount > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {retiredCount}
            </span>
          )}
        </label>
      </div>

      {/* reactivate_class() cannot refuse, so this only ever carries a network
          or permission failure — but a restore that silently did nothing is
          exactly the dead end this page exists to prevent. */}
      {retireError && retireFor === null && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {retireError}
        </div>
      )}

      {!loading && capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT} classes — the list is truncated. This is
          not expected; contact support if you see it.
        </p>
      )}
    </>
  );
}
