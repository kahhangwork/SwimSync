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
        className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-72"
      />
      <label className="flex items-center gap-2 text-sm text-gray-600">
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
