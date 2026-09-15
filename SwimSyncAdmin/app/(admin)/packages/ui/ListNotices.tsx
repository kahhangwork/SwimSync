// The page-level error banner (list-core, slice 1). Stage 4 of
// PACKAGES_REFACTOR_PLAN.md. Renders nothing when there is no error.

export function ListNotices({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error}
    </div>
  );
}
