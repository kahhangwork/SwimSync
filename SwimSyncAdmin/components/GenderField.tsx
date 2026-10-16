"use client";

// The admin's gender picker — REQUIRED and NEVER pre-selected (user, 2026-10-16). A pre-selected value is one the
// admin did not choose, and it is saved if they don't notice it — the parent app's Edit Child silently recorded
// "Male" that way. Options and type: lib/gender.ts.
//
// The pressed state is `aria-pressed` (a toggle button), so a screen reader — and a driver — can tell which is
// chosen, or that none is (§7.378).

import { useId } from "react";
import { GENDER_OPTIONS, type Gender } from "@/lib/gender";

export function GenderField(p: { value: Gender | ""; onChange: (g: Gender) => void; disabled?: boolean }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-label font-semibold text-ink-secondary">
        Gender <span className="text-status-danger-text">*</span>
      </span>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {GENDER_OPTIONS.map((o) => {
          const on = p.value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={p.disabled}
              onClick={() => p.onChange(o.value)}
              className={`rounded-control border px-3 py-2 text-body ${
                on
                  ? "border-border-strong bg-selected font-semibold text-ink"
                  : "border-border bg-surface font-medium text-ink-secondary hover:bg-ground"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
