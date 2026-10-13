// Parents page — search + include-inactive filter.

type Props = {
  search: string;
  setSearch: (v: string) => void;
  showInactive: boolean;
  setShowInactive: (v: boolean) => void;
};

export function ParentsToolbar(p: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="text"
        placeholder="Search by parent name or email..."
        value={p.search}
        onChange={(e) => p.setSearch(e.target.value)}
        className="rounded-control border border-border-strong bg-surface px-4 py-2.5 text-body placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary w-72"
      />
      <label className="flex items-center gap-2 text-body text-ink-secondary">
        <input
          type="checkbox"
          checked={p.showInactive}
          onChange={(e) => p.setShowInactive(e.target.checked)}
        />
        Include inactive
      </label>
    </div>
  );
}
