import { Tag } from "@/components/ui/Tag";
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
          className="w-full max-w-sm rounded-control border border-border-strong bg-surface px-4 py-2.5 text-body placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {locationOptions.length > 1 && (
          <select
            aria-label="Location"
            value={locationFilter}
            onChange={(e) => onLocationFilter(e.target.value)}
            className="rounded-control border border-border-strong bg-surface px-3 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary"
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
        <label className="inline-flex items-center gap-2 text-body text-ink-secondary">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => onShowRetired(e.target.checked)}
            className="h-4 w-4 rounded-control border-border-strong text-primary focus:ring-primary"
          />
          Show retired classes
          {retiredCount > 0 && (
            <Tag tone="neutral">{retiredCount}</Tag>
          )}
        </label>
      </div>

      {/* reactivate_class() cannot refuse, so this only ever carries a network
          or permission failure — but a restore that silently did nothing is
          exactly the dead end this page exists to prevent. */}
      {retireError && retireFor === null && (
        <div className="mb-4 rounded-card border border-status-danger-border bg-status-danger-bg px-4 py-3 text-body text-status-danger-text">
          {retireError}
        </div>
      )}

      {!loading && capped && (
        <p className="mb-3 text-body text-status-warning-text">
          Showing the first {ROW_LIMIT} classes — the list is truncated. This is
          not expected; contact support if you see it.
        </p>
      )}
    </>
  );
}
