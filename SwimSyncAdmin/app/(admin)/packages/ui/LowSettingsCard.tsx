// "Running low" — the two thresholds that decide which families Generate
// renewal offers picks up, and what the Students page flags. Saved as typed.

import type { LowSettingsState } from "../domain/useLowSettings";

export function LowSettingsCard({ low }: { low: LowSettingsState }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">When is a package running low?</h2>
      <p className="mt-1 text-xs text-gray-500">
        A family is due a renewal offer — and flagged on the Students page — when its package has
      </p>
      <label className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
        <input
          value={low.threshold}
          onChange={(e) => low.saveThreshold(e.target.value)}
          inputMode="numeric"
          disabled={!low.loaded}
          className="w-14 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm"
          aria-label="Low-package threshold in lessons"
        />
        lessons or fewer left, or expires within
        <input
          value={low.expiryDays}
          onChange={(e) => low.saveExpiryDays(e.target.value)}
          inputMode="numeric"
          disabled={!low.loaded}
          className="w-14 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm"
          aria-label="Expiry warning window in days"
        />
        days.
      </label>
      {low.saveError ? <p className="mt-2 text-xs text-red-600">{low.saveError}</p> : null}
    </div>
  );
}
