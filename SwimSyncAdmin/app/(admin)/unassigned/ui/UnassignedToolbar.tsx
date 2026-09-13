// Unassigned page — search box.

type Props = {
  search: string;
  setSearch: (v: string) => void;
};

export function UnassignedToolbar(p: Props) {
  return (
    <div className="mb-4">
      <input
        type="text"
        placeholder="Search by student or parent name..."
        value={p.search}
        onChange={(e) => p.setSearch(e.target.value)}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
    </div>
  );
}
