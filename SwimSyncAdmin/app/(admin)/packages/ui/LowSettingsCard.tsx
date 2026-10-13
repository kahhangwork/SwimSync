// "Running low" — the two thresholds that decide which families Generate
// renewal offers picks up, and what the Students page flags. Saved when the
// admin leaves the field (blur, or Enter) — never per keystroke.

import type { KeyboardEvent } from "react";
import type { LowSettingsState } from "../domain/useLowSettings";

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

export function LowSettingsCard({ low }: { low: LowSettingsState }) {
  return (
    <div className="mb-6 rounded-card border border-border bg-surface p-4">
      <h2 className="text-headline font-semibold text-ink">When is a package running low?</h2>
      <p className="mt-1 text-label text-ink-muted">
        A family is due a renewal offer — and flagged on the Students page — when its package has
      </p>
      <label className="mt-3 flex flex-wrap items-center gap-1.5 text-body text-ink-secondary">
        <input
          value={low.threshold}
          onChange={(e) => low.setThreshold(e.target.value)}
          onBlur={low.commitThreshold}
          onKeyDown={blurOnEnter}
          inputMode="numeric"
          disabled={!low.loaded}
          className="w-14 rounded-control border border-border-strong px-2 py-1.5 text-center text-body"
          aria-label="Low-package threshold in lessons"
        />
        lessons or fewer left, or expires within
        <input
          value={low.expiryDays}
          onChange={(e) => low.setExpiryDays(e.target.value)}
          onBlur={low.commitExpiryDays}
          onKeyDown={blurOnEnter}
          inputMode="numeric"
          disabled={!low.loaded}
          className="w-14 rounded-control border border-border-strong px-2 py-1.5 text-center text-body"
          aria-label="Expiry warning window in days"
        />
        days.
      </label>
      {low.saveError ? <p className="mt-2 text-label text-status-danger-text">{low.saveError}</p> : null}
    </div>
  );
}
